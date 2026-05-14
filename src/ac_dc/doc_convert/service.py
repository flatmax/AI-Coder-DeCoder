"""DocConvert RPC service — orchestrator.

Owns the public service surface — construction, the localhost
guard, configuration readers, repo-walk-and-classify scanning,
and per-file dispatch into format-specific pipelines. The
pipelines themselves live in sibling modules:

- :mod:`.markitdown_pipeline` — `.docx` / `.rtf` / `.odt` / `.csv`
- :mod:`.xlsx_pipeline` — `.xlsx` (colour-aware via openpyxl)
- :mod:`.pptx_pipeline` — `.pptx` python-pptx fallback
- :mod:`.pdf_pipeline` — `.pdf` direct, plus the LibreOffice →
  PDF → PyMuPDF route for `.pptx` / `.odp`

This module was the original ``doc_convert.py`` before the
package split; the per-format conversion code moved out, but
every other behaviour (scan, status classification, async/sync
``convert_files`` orchestration, config readers, the localhost
guard) stayed because the orchestrator is the public face of
the service. Pipeline modules don't talk to each other — they
all return through this orchestrator, so the dispatch in
``_convert_one`` is the only routing point.

Governing spec: ``specs4/4-features/doc-convert.md``.
Restriction pattern:
``specs4/1-foundation/communication-layer.md#restricted-operations``.

Design decisions are pinned in the docstrings of the
pre-split monolith and remain authoritative — see the
constants module and pipeline modules for per-area
rationale.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .constants import (
    _DEFAULT_EXTENSIONS,
    _EXCLUDED_DIRS,
    _LIBREOFFICE_EXTENSIONS,
    _MARKITDOWN_EXTENSIONS,
    _PDF_EXTENSIONS,
    _PPTX_EXTENSIONS,
    _XLSX_EXTENSIONS,
)
from .markitdown_pipeline import MarkitdownPipeline
from .pdf_pipeline import PdfPipeline
from .pptx_pipeline import PptxPipeline
from .provenance import (
    ProvenanceHeader,
    hash_file,
    parse_provenance_body,
    read_provenance_header,
)
from .xlsx_pipeline import XlsxPipeline

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager

logger = logging.getLogger(__name__)


class DocConvert:
    """Document-to-markdown conversion service.

    Construct with a :class:`ConfigManager` and optional
    :class:`Repo`. The repo argument lets the scanner report
    paths relative to the repository root — without it, paths
    are resolved against CWD, which matches the convention used
    by tests that don't want to construct a full repo.

    Register via ``server.add_class(doc_convert)`` alongside the
    other services. In collab mode, ``main.py`` sets ``_collab``
    on the instance after construction; in single-user mode the
    attribute stays ``None`` and every caller is treated as
    localhost.
    """

    def __init__(
        self,
        config: "ConfigManager",
        repo: Any = None,
        event_callback: Any = None,
    ) -> None:
        """Construct the service.

        Parameters
        ----------
        config:
            The config manager — used for reading
            ``doc_convert_config`` and (in future passes) for
            getting the working directory when the PDF pipeline
            needs temp space.
        repo:
            Optional :class:`Repo` instance. When provided,
            scans resolve against the repo root; when ``None``,
            scans resolve against CWD. Kept as ``Any`` to avoid
            the circular import between Layer 1 (Repo) and
            Layer 4 (DocConvert).
        event_callback:
            Optional async callable
            ``(event_name, *args) -> awaitable`` for pushing
            progress events to the browser. Wired by ``main.py``
            to the shared event dispatcher so
            ``docConvertProgress`` events reach the webapp. When
            ``None`` (tests, standalone CLI use), events are
            silently dropped and ``convert_files`` falls back to
            fully synchronous operation returning inline
            results.
        """
        self._config = config
        self._repo = repo
        self._event_callback = event_callback
        # Collab reference, set by main.py when collab mode is
        # active. None in single-user mode — every caller is
        # treated as localhost. Matches the pattern on Repo,
        # LLMService, and Settings.
        self._collab: Any = None

        # Pipeline instances. Each takes the result builders
        # (`_fail` / `_skip`) so per-pipeline failures surface
        # in the same shape the orchestrator emits. The PDF
        # pipeline additionally takes the import probe and the
        # two fallback callables so the LibreOffice route can
        # downgrade to format-specific paths when soffice or
        # PyMuPDF is missing.
        self._markitdown = MarkitdownPipeline(
            fail=self._fail,
            skip=self._skip,
        )
        self._xlsx = XlsxPipeline(
            fail=self._fail,
            skip=self._skip,
            markitdown_fallback=self._markitdown.convert,
        )
        self._pptx = PptxPipeline(
            fail=self._fail,
            skip=self._skip,
        )
        # ``probe_import`` is wrapped in a lambda rather than
        # passed as ``self._probe_import`` directly so that
        # tests which monkey-patch ``DocConvert._probe_import``
        # after the service is constructed still take effect —
        # binding the method at construction would freeze the
        # original.
        self._pdf = PdfPipeline(
            fail=self._fail,
            skip=self._skip,
            probe_import=lambda name: self._probe_import(name),
            markitdown_fallback=self._markitdown.convert,
            python_pptx_fallback=self._pptx.convert,
        )

    # ------------------------------------------------------------------
    # Localhost-only guard
    # ------------------------------------------------------------------

    def _check_localhost_only(self) -> dict[str, Any] | None:
        """Return a restricted-error dict when caller is non-localhost.

        Same contract as the other services' guards. Fails
        closed on collab-check exceptions — a raising collab
        denies the call rather than letting it through. The
        frontend's RpcMixin surfaces the restricted shape as a
        distinct error class.
        """
        if self._collab is None:
            return None
        try:
            is_local = self._collab.is_caller_localhost()
        except Exception as exc:
            logger.warning(
                "Collab localhost check raised: %s; denying",
                exc,
            )
            return {
                "error": "restricted",
                "reason": (
                    "Internal error checking caller identity"
                ),
            }
        if is_local:
            return None
        return {
            "error": "restricted",
            "reason": (
                "Participants cannot perform this action"
            ),
        }

    # ------------------------------------------------------------------
    # Configuration readers
    # ------------------------------------------------------------------

    @property
    def _enabled(self) -> bool:
        """Read-through to ``config.doc_convert_config['enabled']``."""
        return bool(
            self._config.doc_convert_config.get("enabled", True)
        )

    @property
    def _extensions(self) -> tuple[str, ...]:
        """Lowercased configured extensions, with defaults fallback.

        Normalises to a tuple so the result is hashable and
        comparable. Lowercases the entries because the
        extension matching in dispatch compares lowercased
        suffixes — a config entry of ``.DOCX`` should still
        work.
        """
        configured = self._config.doc_convert_config.get(
            "extensions"
        )
        if not configured or not isinstance(
            configured, (list, tuple)
        ):
            return _DEFAULT_EXTENSIONS
        return tuple(str(ext).lower() for ext in configured)

    @property
    def _max_size_bytes(self) -> int:
        """Size threshold in bytes (config stores it in MB)."""
        mb = int(
            self._config.doc_convert_config.get(
                "max_source_size_mb", 50
            )
        )
        return mb * 1024 * 1024

    # ------------------------------------------------------------------
    # Repo-root resolution
    # ------------------------------------------------------------------

    def _root(self) -> Path:
        """Return the root directory for scans.

        Uses ``repo.root`` when a Repo is attached; falls back
        to CWD when not. The fallback is for tests that don't
        construct a full repo, not for production — production
        always passes ``repo``.
        """
        if self._repo is not None:
            root = getattr(self._repo, "root", None)
            if root is not None:
                return Path(root)
        return Path.cwd()

    # ------------------------------------------------------------------
    # is_available — optional dependency probe
    # ------------------------------------------------------------------

    def is_available(self) -> dict[str, bool]:
        """Probe every optional dependency and report status.

        Returns
        -------
        dict
            - ``available`` — True when markitdown is
              importable. Without it, no conversion is possible
              at all (even the PDF path ultimately produces
              markdown output, though via PyMuPDF text
              extraction rather than markitdown). The frontend
              uses this to decide whether to render the Doc
              Convert tab at all.
            - ``libreoffice`` — True when ``soffice`` is on
              PATH. Enables the pptx/odp → PDF conversion step.
            - ``pymupdf`` — True when ``fitz`` is importable.
              Enables the PDF-to-markdown pipeline (text
              extraction + image detection + SVG export).
            - ``pdf_pipeline`` — True only when BOTH
              LibreOffice and PyMuPDF are available. The
              pptx/odp route needs both; pdf alone needs only
              PyMuPDF, but the frontend shows a single "PDF
              pipeline" capability to keep the UI simple.

        Safe to call frequently — each probe is a single import
        or PATH lookup. No subprocess launches, no network
        calls. Always callable regardless of the ``enabled``
        config flag (availability is a capability query, not a
        feature toggle).
        """
        import shutil

        markitdown_ok = self._probe_import("markitdown")
        pymupdf_ok = self._probe_import("fitz")
        libreoffice_ok = shutil.which("soffice") is not None
        return {
            "available": markitdown_ok,
            "libreoffice": libreoffice_ok,
            "pymupdf": pymupdf_ok,
            "pdf_pipeline": libreoffice_ok and pymupdf_ok,
        }

    @staticmethod
    def _probe_import(module_name: str) -> bool:
        """Return True when ``module_name`` can be imported.

        Broad exception catch — a module that installs but
        fails on import (version mismatch, missing binary
        dependency, corrupted install) should show as
        unavailable rather than propagating the exception into
        what is meant to be a cheap probe.
        """
        import importlib

        try:
            importlib.import_module(module_name)
            return True
        except Exception as exc:
            logger.debug(
                "DocConvert probe: %s not available (%s)",
                module_name, exc,
            )
            return False

    # ------------------------------------------------------------------
    # scan_convertible_files — repository walk + status classification
    # ------------------------------------------------------------------

    def scan_convertible_files(self) -> list[dict[str, Any]]:
        """Walk the repo and classify every convertible source file.

        Each entry is a dict with:

        - ``path`` — source path relative to the root
        - ``name`` — basename
        - ``size`` — source file size in bytes
        - ``status`` — one of ``"new"``, ``"current"``,
          ``"stale"``, ``"conflict"``
        - ``output_path`` — prospective output path, relative
          to root
        - ``over_size`` — True when size exceeds
          ``max_source_size_mb`` (advisory — the file still
          appears in the scan so the UI can show a warning
          badge; conversion will refuse it)

        Returns an empty list when ``enabled=false`` in config.
        The result is stable-sorted by path for deterministic
        frontend rendering.

        Never raises — filesystem errors on individual files
        produce a debug log and that file is skipped. A
        pathological repo (weird symlinks, permission denied
        on a directory) should not prevent the rest of the scan
        from succeeding.
        """
        if not self._enabled:
            return []

        root = self._root()
        if not root.is_dir():
            logger.warning(
                "DocConvert scan root is not a directory: %s",
                root,
            )
            return []

        extensions = self._extensions
        max_bytes = self._max_size_bytes

        entries: list[dict[str, Any]] = []
        for source_abs in self._iter_candidates(root, extensions):
            try:
                rel_path = source_abs.relative_to(root)
            except ValueError:
                # Shouldn't happen — the walker is rooted at
                # `root` — but be defensive.
                continue
            try:
                size = source_abs.stat().st_size
            except OSError as exc:
                logger.debug(
                    "DocConvert scan: stat failed for %s: %s",
                    source_abs, exc,
                )
                continue

            output_abs = source_abs.with_suffix(".md")
            try:
                output_rel = output_abs.relative_to(root)
            except ValueError:
                continue

            status = self._classify_status(source_abs, output_abs)

            entries.append({
                "path": str(rel_path).replace("\\", "/"),
                "name": source_abs.name,
                "size": size,
                "status": status,
                "output_path": str(output_rel).replace("\\", "/"),
                "over_size": size > max_bytes,
            })

        # Deterministic sort by source path so repeated scans
        # produce byte-identical output. Frontend relies on
        # stable ordering for UI state (selected checkboxes,
        # scroll position).
        entries.sort(key=lambda e: e["path"])
        return entries

    def _iter_candidates(
        self,
        root: Path,
        extensions: tuple[str, ...],
    ) -> Any:
        """Walk ``root``, yielding files with matching extensions.

        Skips every directory in ``_EXCLUDED_DIRS`` plus hidden
        directories (except ``.github`` which some repos use
        for CI config that might contain docs worth converting).

        Uses ``os.walk`` rather than ``Path.rglob`` because it's
        easier to mutate the directory list in place (the
        standard way to prune a walk). ``Path.rglob`` has no
        equivalent prune hook; filtering after the fact would
        still descend into ``node_modules``.
        """
        extensions_set = set(extensions)
        for dirpath, dirnames, filenames in os.walk(root):
            # Prune excluded and hidden dirs in place. The
            # walker respects in-place mutation of `dirnames`.
            dirnames[:] = [
                d for d in dirnames
                if d not in _EXCLUDED_DIRS
                and (not d.startswith(".") or d == ".github")
            ]
            dir_path = Path(dirpath)
            for filename in filenames:
                suffix = Path(filename).suffix.lower()
                if suffix not in extensions_set:
                    continue
                yield dir_path / filename

    def _classify_status(
        self,
        source_abs: Path,
        output_abs: Path,
    ) -> str:
        """Classify the source file's conversion status.

        Order of checks matters:

        1. No output file exists → ``new``
        2. Output exists but has no docuvert header →
           ``conflict`` (manually authored or externally
           converted)
        3. Header present, source hash matches → ``current``
        4. Header present, source hash doesn't match → ``stale``

        Defensive — any I/O failure reading the output file or
        hashing the source is treated as ``new``, so a
        permissions hiccup doesn't silently show ``current``
        for a file the user can't actually read.
        """
        if not output_abs.is_file():
            return "new"

        header = self._read_provenance_header(output_abs)
        if header is None:
            return "conflict"

        try:
            current_hash = self._hash_file(source_abs)
        except OSError as exc:
            logger.debug(
                "DocConvert scan: hash failed for %s: %s",
                source_abs, exc,
            )
            return "new"

        if header.sha256 == current_hash:
            return "current"
        return "stale"

    # ------------------------------------------------------------------
    # Provenance shims — preserve the old method surface
    # ------------------------------------------------------------------
    #
    # The pre-split DocConvert exposed `_read_provenance_header`,
    # `parse_provenance_body`, `_hash_file`, and
    # `_build_provenance_header` as instance / static methods.
    # Tests and (potentially) external callers reach for them
    # by attribute on a DocConvert instance. Forwarding them to
    # the new free functions keeps that surface intact without
    # duplicating the implementations.

    @staticmethod
    def _read_provenance_header(
        output_abs: Path,
    ) -> ProvenanceHeader | None:
        return read_provenance_header(output_abs)

    @staticmethod
    def parse_provenance_body(
        body: str,
    ) -> ProvenanceHeader | None:
        return parse_provenance_body(body)

    @staticmethod
    def _hash_file(path: Path) -> str:
        return hash_file(path)

    # ------------------------------------------------------------------
    # convert_files — public entry point
    # ------------------------------------------------------------------

    def convert_files(
        self,
        paths: list[str],
    ) -> dict[str, Any]:
        """Convert the named source files to markdown.

        Dispatches by extension. ``.docx``/``.rtf``/``.odt``/
        ``.csv`` use markitdown; ``.xlsx`` uses openpyxl;
        ``.pptx``/``.odp`` use LibreOffice + PyMuPDF when
        available, falling back to python-pptx (pptx) or
        markitdown (odp); ``.pdf`` uses PyMuPDF directly.

        Runs the clean-tree gate first: refuses if the repo has
        uncommitted changes. Without a git working tree to diff
        against, the converted output wouldn't be reviewable
        before commit. The gate requires a repo with an
        ``is_clean()`` method; when constructed without a repo
        (tests, standalone CLI use), the gate is skipped —
        caller accepts the risk.

        Two execution modes:

        - **Background (async)** — when an asyncio event loop
          is running AND an event callback is wired, launches
          per-file conversion as a background task and returns
          ``{"status": "started", "count": N}`` immediately.
          Per-file progress and the final summary arrive via
          ``docConvertProgress`` server-push events.
        - **Inline (sync)** — when no event loop is running
          (tests, CLI use without websocket) or no event
          callback is wired, runs conversions inline and
          returns ``{"status": "ok", "results": [...]}``
          directly. Matches the pre-async contract so tests
          don't need event-loop setup.

        The guard and gate run identically in both modes, so
        restricted/dirty-tree errors surface the same way.

        Parameters
        ----------
        paths:
            Repo-relative source file paths.

        Returns
        -------
        dict
            Restricted-error on non-localhost callers,
            dirty-tree error on dirty working tree,
            ``{"status": "started", "count": N}`` when running
            in background mode, or
            ``{"status": "ok", "results": [...]}`` when running
            inline.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted

        # Clean-tree gate — refuse conversion if the repo has
        # uncommitted changes. Without a working tree to diff
        # against, converted output can't be reviewed before
        # commit. Only runs when a repo with is_clean() is
        # attached; tests and CLI use without a full repo
        # skip the gate (caller accepts the risk).
        if self._repo is not None:
            is_clean_fn = getattr(self._repo, "is_clean", None)
            if callable(is_clean_fn):
                try:
                    clean = is_clean_fn()
                except Exception as exc:
                    logger.debug(
                        "Repo is_clean() raised: %s", exc,
                    )
                    return {
                        "error": (
                            "Could not verify working tree "
                            f"state: {exc}"
                        ),
                    }
                if not clean:
                    return {
                        "error": (
                            "Working tree has uncommitted "
                            "changes. Commit or stash before "
                            "converting."
                        ),
                    }

        # Decide execution mode. Background requires both a
        # running loop AND a wired callback — if either is
        # missing, fall back to inline so tests and CLI callers
        # get results directly.
        import asyncio

        loop: asyncio.AbstractEventLoop | None = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None and self._event_callback is not None:
            asyncio.ensure_future(
                self._convert_files_background(paths)
            )
            return {
                "status": "started",
                "count": len(paths),
            }

        # Inline fallback — synchronous execution.
        return self._convert_files_sync(paths)

    def _convert_files_sync(
        self,
        paths: list[str],
    ) -> dict[str, Any]:
        """Synchronous per-file conversion. Returns results inline.

        Used by tests and by the CLI-without-websocket path.
        The background path uses the same per-file loop but
        emits progress events between files.
        """
        root = self._root()
        results: list[dict[str, Any]] = []
        for rel_path in paths:
            result = self._convert_one(root, rel_path)
            results.append(result)
        return {"status": "ok", "results": results}

    async def _convert_files_background(
        self,
        paths: list[str],
    ) -> None:
        """Background conversion task with progress events.

        Each file is converted in the default thread executor
        so the event loop stays responsive — individual file
        conversions (especially PDFs via PyMuPDF) routinely
        block for many seconds, and running them directly on
        the loop would stall the websocket and prevent the
        ``start`` and ``file`` events from reaching the
        browser until the whole batch finished. That produced
        a "Converting 0 of N…" hang with no progress events
        visible in the UI.

        Emits three event stages:

        - ``start`` — before the first file, carrying the
          total count so the UI can size its progress display
        - ``file`` — per-file, after conversion completes,
          carrying the result dict and the running index
        - ``complete`` — after all files, carrying the full
          results list so the UI has the final summary even
          if it missed some per-file events

        Event failures are swallowed so a broken frontend
        subscriber can't abort an in-flight conversion batch.
        """
        import asyncio

        root = self._root()
        total = len(paths)
        await self._send_convert_event({
            "stage": "start",
            "count": total,
        })

        loop = asyncio.get_running_loop()
        results: list[dict[str, Any]] = []
        for index, rel_path in enumerate(paths):
            try:
                result = await loop.run_in_executor(
                    None,
                    self._convert_one,
                    root,
                    rel_path,
                )
            except Exception as exc:
                # Defensive — a bug in a per-file conversion
                # shouldn't abort the whole batch. Surface as
                # an error result so the UI shows the specific
                # file that failed, not a silent drop.
                logger.exception(
                    "DocConvert: unhandled error converting %s",
                    rel_path,
                )
                result = self._fail(
                    rel_path,
                    f"Internal error: {exc}",
                )
            results.append(result)
            await self._send_convert_event({
                "stage": "file",
                "index": index,
                "total": total,
                "result": result,
            })

        await self._send_convert_event({
            "stage": "complete",
            "results": results,
        })

    async def _send_convert_event(
        self,
        data: dict[str, Any],
    ) -> None:
        """Dispatch a docConvertProgress event. Swallows failures.

        Wrapped so a throwing callback (unmounted frontend,
        websocket error) doesn't abort the conversion loop.
        The event is lost for that frontend client; the batch
        continues and the final ``complete`` event carries the
        full results list so a reconnecting client can recover
        the state.
        """
        if self._event_callback is None:
            return
        try:
            await self._event_callback(
                "docConvertProgress",
                data,
            )
        except Exception as exc:
            logger.debug(
                "DocConvertProgress event dispatch failed: %s",
                exc,
            )

    def _convert_one(
        self,
        root: Path,
        rel_path: str,
    ) -> dict[str, Any]:
        """Convert a single file. Returns a per-file result dict.

        Entry point for the per-file dispatch. Handles
        validation (path inside root, file exists, size within
        budget), extension routing, and wraps every failure in
        a result dict rather than propagating. One failing file
        shouldn't abort the whole batch — the user may have
        mixed supported and unsupported files in one selection.
        """
        # Resolve and validate the path is inside the scan
        # root. A traversal attempt (`../foo.docx`) would be
        # caught by relative_to below, but we normalise first
        # so the error message names the requested path, not
        # the resolved one.
        try:
            source_abs = (root / rel_path).resolve()
            source_abs.relative_to(root.resolve())
        except (OSError, ValueError):
            return self._fail(
                rel_path,
                "Path must be within repository root",
            )

        if not source_abs.is_file():
            return self._fail(rel_path, "File not found")

        # Size check — mirrors the scan's over_size flag. A
        # file over the budget produces a skip result with an
        # explanatory message so the UI can render a warning
        # rather than silently dropping.
        try:
            size = source_abs.stat().st_size
        except OSError as exc:
            return self._fail(
                rel_path, f"Stat failed: {exc}"
            )
        if size > self._max_size_bytes:
            return self._skip(
                rel_path,
                (
                    f"File exceeds "
                    f"{self._max_size_bytes // (1024 * 1024)}"
                    "MB limit"
                ),
            )

        suffix = source_abs.suffix.lower()

        # Detect password-protected OOXML files at dispatch
        # (.docx / .xlsx / .pptx). Encrypted Office documents
        # are wrapped in a CDFV2 (OLE compound) container with
        # the signature D0 CF 11 E0 A1 B1 1A E1, instead of the
        # ZIP/OPC PK\x03\x04 prefix a real OOXML file uses.
        # Catching this at dispatch saves the user from a
        # silent LibreOffice failure followed by a misleading
        # "Package not found" from python-pptx — both spend
        # real time before producing an opaque error. ODF
        # formats (.odt / .odp) use a different ZIP-based
        # encryption scheme that doesn't surface as CDFV2,
        # so they're not in scope for this check.
        if suffix in (".docx", ".xlsx", ".pptx"):
            encrypted = self._is_encrypted_ooxml(
                source_abs, rel_path
            )
            if encrypted is not None:
                return encrypted

        # markitdown handles the simple formats (.docx, .rtf,
        # .odt, .csv).
        if suffix in _MARKITDOWN_EXTENSIONS:
            return self._markitdown.convert(
                root, source_abs, rel_path
            )

        # xlsx uses a dedicated openpyxl-based pipeline so cell
        # background colours survive as emoji markers. Falls
        # back to markitdown if openpyxl is unavailable or
        # fails.
        if suffix in _XLSX_EXTENSIONS:
            return self._xlsx.convert(
                root, source_abs, rel_path
            )

        # pptx / odp route through LibreOffice + PyMuPDF when
        # available — gives proper text extraction plus
        # per-page SVGs for diagrams. Falls back to
        # format-specific paths when dependencies are missing.
        if suffix in _LIBREOFFICE_EXTENSIONS:
            return self._pdf.convert_libreoffice(
                root, source_abs, rel_path
            )

        # pptx uses the python-pptx fallback pipeline — only
        # reached when LibreOffice isn't available (the
        # libreoffice path would have handled .pptx above).
        if suffix in _PPTX_EXTENSIONS:
            return self._pptx.convert(
                root, source_abs, rel_path
            )

        # pdf goes directly to PyMuPDF — hybrid text + SVG
        # output. Text extracted into markdown paragraphs;
        # pages with significant graphics also get companion
        # SVGs with glyphs stripped (text already in markdown).
        if suffix in _PDF_EXTENSIONS:
            return self._pdf.convert_pymupdf(
                root, source_abs, rel_path
            )

        # Other supported extensions — explicit "not yet
        # supported" rather than a silent skip. Users see
        # exactly which files the current release can convert.
        if suffix in self._extensions:
            return self._skip(
                rel_path,
                (
                    f"{suffix} conversion is not yet "
                    "implemented; ships in a later pass"
                ),
            )

        # Extension isn't recognised at all. Should be
        # unreachable if the caller used
        # ``scan_convertible_files`` as its source of truth,
        # but handle defensively.
        return self._fail(
            rel_path,
            f"Unsupported extension: {suffix}",
        )

    # ------------------------------------------------------------------
    # Result-dict builders
    # ------------------------------------------------------------------

    @staticmethod
    def _is_encrypted_ooxml(
        source_abs: Path,
        rel_path: str,
    ) -> dict[str, Any] | None:
        """Return an error result if the file is encrypted, else None.

        Encrypted Office documents (Word, Excel, PowerPoint
        with a password set) wrap their payload in a CDFV2
        compound container starting with the OLE signature
        ``D0 CF 11 E0 A1 B1 1A E1``. A normal OOXML file is a
        ZIP archive starting with ``PK\\x03\\x04``. python-pptx
        / openpyxl / markitdown all raise opaque errors on
        encrypted input ("Package not found", "not a zip
        file"), and LibreOffice's headless converter exits
        silently without producing a PDF when no
        ``--password`` is supplied.

        Detecting encryption at dispatch saves the user from
        a useless soffice subprocess followed by a misleading
        downstream error. The result message tells them how
        to resolve it (remove the password in the source
        application, or decrypt with msoffcrypto-tool).

        Returns ``None`` when the file is not encrypted (or
        unreadable, or shorter than 8 bytes — those cases are
        handled by the pipeline-level error paths). I/O
        failures here fall through to the pipeline so the
        user sees one error per file, not two.

        ``rel_path`` is echoed verbatim into the result's
        ``path`` field so the webapp can match the per-file
        error back to the request — webapp keys progress
        rows by the path it sent, not by the file's basename.
        """
        try:
            with open(source_abs, "rb") as fh:
                header = fh.read(8)
        except OSError:
            return None
        if not header.startswith(
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        ):
            return None
        return {
            "path": rel_path,
            "status": "error",
            "message": (
                "File is password-protected (encrypted "
                "CDFV2 container). Remove the password in the "
                "source application (File → Info → Protect "
                "Document → Encrypt with Password → clear and "
                "save) or decrypt with msoffcrypto-tool, then "
                "retry."
            ),
        }

    @staticmethod
    def _fail(rel_path: str, message: str) -> dict[str, Any]:
        """Per-file error result."""
        return {
            "path": rel_path,
            "status": "error",
            "message": message,
        }

    @staticmethod
    def _skip(rel_path: str, message: str) -> dict[str, Any]:
        """Per-file skip result (not a failure, just not converted).

        Distinct from ``error`` so the frontend can render a
        different icon — skipped files may be retried later
        (over-size, extension deferred to a later pass) while
        errors typically indicate a real problem.
        """
        return {
            "path": rel_path,
            "status": "skipped",
            "message": message,
        }