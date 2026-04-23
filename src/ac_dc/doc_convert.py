"""DocConvert RPC service — Layer 4.5.

The DocConvert service is the backend half of the Doc Convert tab.
It scans the repository for convertible documents (`.docx`, `.pdf`,
`.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp`), classifies each by
status (new / current / stale / conflict), and — on explicit user
request — converts them to markdown via a pipeline that dispatches
by file type through several optional dependencies (markitdown,
LibreOffice, PyMuPDF, python-pptx, openpyxl).

This module delivers **Pass A — foundation only**. Scope:

- `DocConvert` class registered via `server.add_class(doc_convert)`.
- `is_available()` — probes every optional dependency independently
  and reports each via the specs4-specified shape `{available,
  libreoffice, pymupdf, pdf_pipeline}`.
- `scan_convertible_files()` — walks the repo (respecting the same
  exclusion list as the symbol and doc indexes), classifies each
  source file against its potential output via the provenance-header
  round-trip defined in specs4/4-features/doc-convert.md.
- `convert_files()` — stubbed to raise `NotImplementedError`. The
  localhost-only guard IS wired, so restricted callers get the
  correct error shape today; localhost callers get a clear signal
  that conversion hasn't landed yet.
- Provenance-header parsing — reads the `<!-- docuvert: source=... sha256=...
  images=... -->` comment off the first lines of an output file and
  extracts source / hash / image-ref fields. Lenient — unknown fields
  ignored, missing optional fields allowed.

Pass A2 will ship the markitdown path for `.docx`, `.rtf`, `.odt`
plus provenance-header writing and image-from-data-URI extraction.
Pass A3 adds xlsx colour extraction via openpyxl. Pass A4 adds pptx
fallback via python-pptx. Pass A5 adds the full PDF pipeline
(LibreOffice → PyMuPDF → text extraction + SVG export + image
externalization).

Governing spec: ``specs4/4-features/doc-convert.md``.
Restriction pattern: ``specs4/1-foundation/communication-layer.md#restricted-operations``.

Design decisions pinned here:

- **Availability reports are authoritative.** The frontend decides
  whether to show the tab based on what this returns. A dependency
  that imports but doesn't actually work (e.g., PyMuPDF installed
  without its bundled binaries) should show as unavailable — we
  don't pre-import to verify, because import itself is cheap but
  running the converter isn't. Imports are the best cheap signal;
  true runtime availability surfaces via per-file conversion errors
  when the user actually clicks Convert.

- **LibreOffice probe uses PATH lookup, not subprocess.** Running
  `soffice --version` would be slow (LibreOffice starts a UNO
  listener on every invocation on some platforms) and unnecessary.
  `shutil.which("soffice")` returning non-None is a reliable
  indicator that the binary is installed; failures at conversion
  time produce clean error messages for the affected files.

- **Status classification priority.** For each source file, check:
  1. No output file exists → `new`
  2. Output exists, no docuvert header → `conflict`
  3. Output exists, header present, source hash matches → `current`
  4. Output exists, header present, source hash doesn't match → `stale`

  The `conflict` status is deliberately distinct from `stale` —
  specs4 is explicit that overwriting a file the user manually
  authored (or converted with a different tool) requires explicit
  opt-in. The UI highlights `conflict` files with a warning icon.

- **Directory exclusions mirror the indexers.** `.git`, `.ac-dc`,
  `node_modules`, `__pycache__`, `.venv`, `venv`, `dist`, `build`,
  `.egg-info`, and hidden directories (except `.github`). Imported
  duplicates would be brittle — the doc-convert scan has the same
  philosophy as the indexers (skip build artefacts, skip tooling
  directories) but is a separate code path, so we redefine the set
  rather than import.

- **Output path is the source stem + `.md` as a sibling.** `docs/
  architecture.docx` → `docs/architecture.md`. The per-source
  assets subdirectory (`docs/architecture/`) is created during
  conversion, not scan. Scan only cares about the `.md` output;
  assets subdirectory is an implementation detail of conversion.

- **Source size filter is advisory.** Files larger than
  `max_source_size_mb` appear in the scan with an over-size flag
  so the UI can show a warning badge. They're also rejected at
  conversion time. Including them in the scan (rather than
  excluding outright) means the user sees WHY a file isn't being
  converted, rather than wondering where it went.

- **Config is read-through, not snapshot.** The `enabled` flag,
  `extensions` list, and `max_source_size_mb` all come from
  `config.doc_convert_config` on every call. Hot-reloaded config
  values take effect immediately — useful during development and
  matches the pattern other services use.

- **`is_available()` is always callable.** Even when `enabled=false`
  in config, the availability probe runs — the frontend uses it to
  decide whether to show the tab at all, which is separate from the
  enabled flag. Enabled/disabled is a user opt-out; availability is
  a capability query.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Default extensions recognised as convertible. The config can
# override via `doc_convert.extensions`; this tuple is the fallback
# when config is absent or malformed. Matches specs4 exactly.
_DEFAULT_EXTENSIONS: tuple[str, ...] = (
    ".docx",
    ".pdf",
    ".pptx",
    ".xlsx",
    ".csv",
    ".rtf",
    ".odt",
    ".odp",
)


# Directories we never walk. Mirrors the indexers' exclusion list —
# rebuilt here rather than imported because the doc-convert scan is a
# separate code path from indexing, and coupling them would make the
# indexer refactorable-but-only-if-you-also-update-convert.
_EXCLUDED_DIRS: frozenset[str] = frozenset({
    ".git",
    ".ac-dc",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
})


# Provenance-header regex. Matches the marker comment at the top of a
# converted file. Captures the whole body so we can parse the
# space-separated key=value pairs ourselves — re-using capture groups
# for each possible field would miss unknown ones, and we want to be
# forward-compatible with future field additions.
_PROVENANCE_RE = re.compile(
    r"<!--\s*docuvert:\s*([^>]+?)\s*-->",
    re.IGNORECASE,
)


# Pattern for one key=value pair inside the provenance body. Values
# are either bare tokens or comma-separated lists. We don't enforce
# field names here — the parser keeps unknown keys in the dict so
# future schema additions don't silently lose data on an older
# version reading a newer file.
_PROV_FIELD_RE = re.compile(r"(\w+)=([^\s]+)")


# How much of each output file we scan when looking for the
# provenance header. The header lives on the first line; a few
# hundred bytes is plenty, even accounting for a stray blank line
# or two preceding it.
_PROVENANCE_PROBE_BYTES = 2048


# ---------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProvenanceHeader:
    """Parsed docuvert provenance comment.

    Fields match the spec-defined header format. All fields
    optional except `source` and `sha256` — those are the minimum
    to classify status.

    Frozen because the parser returns these to the scanner and the
    scanner should never mutate them; immutability is a small
    safety win.
    """

    source: str
    sha256: str
    images: tuple[str, ...] = ()
    extra: dict[str, str] | None = None


# ---------------------------------------------------------------------------
# DocConvert
# ---------------------------------------------------------------------------


class DocConvert:
    """Document-to-markdown conversion service.

    Construct with a :class:`ConfigManager` and optional :class:`Repo`.
    The repo argument lets the scanner report paths relative to the
    repository root — without it, paths are resolved against CWD,
    which matches the convention used by tests that don't want to
    construct a full repo.

    Register via ``server.add_class(doc_convert)`` alongside the other
    services. In collab mode, `main.py` sets `_collab` on the
    instance after construction; in single-user mode the attribute
    stays None and every caller is treated as localhost.
    """

    def __init__(
        self,
        config: "ConfigManager",
        repo: Any = None,
    ) -> None:
        """Construct the service.

        Parameters
        ----------
        config:
            The config manager — used for reading `doc_convert_config`
            and (in future passes) for getting the working directory
            when the PDF pipeline needs temp space.
        repo:
            Optional :class:`Repo` instance. When provided, scans
            resolve against the repo root; when None, scans resolve
            against CWD. Kept as `Any` to avoid the circular import
            between Layer 1 (Repo) and Layer 4 (DocConvert).
        """
        self._config = config
        self._repo = repo
        # Collab reference, set by main.py when collab mode is active.
        # None in single-user mode, which means every caller is
        # treated as localhost. Matches the pattern on Repo,
        # LLMService, and Settings.
        self._collab: Any = None

    # ------------------------------------------------------------------
    # Localhost-only guard
    # ------------------------------------------------------------------

    def _check_localhost_only(self) -> dict[str, Any] | None:
        """Return a restricted-error dict when caller is non-localhost.

        Same contract as the other services' guards. Fails closed on
        collab-check exceptions — a raising collab denies the call
        rather than letting it through. The frontend's RpcMixin
        surfaces the restricted shape as a distinct error class.
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
        """Read-through to `config.doc_convert_config['enabled']`."""
        return bool(self._config.doc_convert_config.get("enabled", True))

    @property
    def _extensions(self) -> tuple[str, ...]:
        """Lowercased configured extensions, with defaults fallback.

        Normalises to a tuple so the result is hashable and
        comparable. Lowercases the entries because the extension
        matching in `_is_convertible` compares lowercased suffixes —
        a config entry of `.DOCX` should still work.
        """
        configured = self._config.doc_convert_config.get("extensions")
        if not configured or not isinstance(configured, (list, tuple)):
            return _DEFAULT_EXTENSIONS
        return tuple(str(ext).lower() for ext in configured)

    @property
    def _max_size_bytes(self) -> int:
        """Size threshold in bytes (config stores it in MB)."""
        mb = int(
            self._config.doc_convert_config.get("max_source_size_mb", 50)
        )
        return mb * 1024 * 1024

    # ------------------------------------------------------------------
    # Repo-root resolution
    # ------------------------------------------------------------------

    def _root(self) -> Path:
        """Return the root directory for scans.

        Uses `repo.root` when a Repo is attached; falls back to CWD
        when not. The fallback is for tests that don't construct a
        full repo, not for production — production always passes
        `repo`.
        """
        if self._repo is not None:
            # Repo exposes `.root` as a Path property.
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
            - ``available`` — True when markitdown is importable.
              Without it, no conversion is possible at all (even the
              PDF path ultimately produces markdown output, though
              via PyMuPDF text extraction rather than markitdown).
              The frontend uses this to decide whether to render the
              Doc Convert tab at all.
            - ``libreoffice`` — True when `soffice` is on PATH.
              Enables the pptx/odp → PDF conversion step.
            - ``pymupdf`` — True when `fitz` is importable. Enables
              the PDF-to-markdown pipeline (text extraction + image
              detection + SVG export).
            - ``pdf_pipeline`` — True only when BOTH LibreOffice and
              PyMuPDF are available. The pptx/odp route needs both;
              pdf alone needs only PyMuPDF, but the frontend shows
              a single "PDF pipeline" capability to keep the UI
              simple.

        Safe to call frequently — each probe is a single import or
        PATH lookup. No subprocess launches, no network calls.
        Always callable regardless of the `enabled` config flag
        (availability is a capability query, not a feature toggle).
        """
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
        """Return True when `module_name` can be imported.

        Broad exception catch — a module that installs but fails on
        import (version mismatch, missing binary dependency, corrupted
        install) should show as unavailable rather than propagating
        the exception into what is meant to be a cheap probe.
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
        - ``status`` — one of `"new"`, `"current"`, `"stale"`,
          `"conflict"`
        - ``output_path`` — prospective output path, relative to root
        - ``over_size`` — True when size exceeds `max_source_size_mb`
          (advisory — the file still appears in the scan so the UI
          can show a warning badge; conversion will refuse it)

        Returns an empty list when `enabled=false` in config. The
        result is stable-sorted by path for deterministic frontend
        rendering.

        Never raises — filesystem errors on individual files produce
        a debug log and that file is skipped. A pathological repo
        (weird symlinks, permission denied on a directory) should not
        prevent the rest of the scan from succeeding.
        """
        if not self._enabled:
            return []

        root = self._root()
        if not root.is_dir():
            logger.warning(
                "DocConvert scan root is not a directory: %s", root
            )
            return []

        extensions = self._extensions
        max_bytes = self._max_size_bytes

        entries: list[dict[str, Any]] = []
        for source_abs in self._iter_candidates(root, extensions):
            try:
                rel_path = source_abs.relative_to(root)
            except ValueError:
                # Shouldn't happen — the walker is rooted at `root` —
                # but be defensive.
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

        # Deterministic sort by source path so repeated scans produce
        # byte-identical output. Frontend relies on stable ordering
        # for UI state (selected checkboxes, scroll position).
        entries.sort(key=lambda e: e["path"])
        return entries

    def _iter_candidates(
        self,
        root: Path,
        extensions: tuple[str, ...],
    ) -> Any:
        """Walk `root`, yielding files with matching extensions.

        Skips every directory in `_EXCLUDED_DIRS` plus hidden
        directories (except `.github` which some repos use for CI
        config that might contain docs worth converting).

        Uses `os.walk` rather than `Path.rglob` because it's easier
        to mutate the directory list in place (the standard way to
        prune a walk). `Path.rglob` has no equivalent prune hook;
        filtering after the fact would still descend into
        `node_modules`.
        """
        extensions_set = set(extensions)
        for dirpath, dirnames, filenames in os.walk(root):
            # Prune excluded and hidden dirs in place. The walker
            # respects in-place mutation of `dirnames`.
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

        1. No output file exists → `new`
        2. Output exists but has no docuvert header → `conflict`
           (manually authored or externally converted)
        3. Header present, source hash matches → `current`
        4. Header present, source hash doesn't match → `stale`

        Defensive — any I/O failure reading the output file or
        hashing the source is treated as `new`, so a permissions
        hiccup doesn't silently show `current` for a file the user
        can't actually read.
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
    # Provenance header parsing
    # ------------------------------------------------------------------

    def _read_provenance_header(
        self,
        output_abs: Path,
    ) -> ProvenanceHeader | None:
        """Read the provenance header from a converted output file.

        Returns None when the file has no header (manually authored),
        when the header is malformed, or when required fields
        (source, sha256) are missing. Lenient on everything else:
        unknown fields land in the `extra` dict for forward
        compatibility with future header additions.

        Reads only the first few KB of the file — the header lives
        on the first line. Reading the whole file would slow
        scanning on repos with large converted outputs.
        """
        try:
            with output_abs.open("rb") as fh:
                probe = fh.read(_PROVENANCE_PROBE_BYTES)
        except OSError as exc:
            logger.debug(
                "DocConvert: failed to read header from %s: %s",
                output_abs, exc,
            )
            return None

        text = probe.decode("utf-8", errors="replace")
        match = _PROVENANCE_RE.search(text)
        if match is None:
            return None

        return self.parse_provenance_body(match.group(1))

    @staticmethod
    def parse_provenance_body(body: str) -> ProvenanceHeader | None:
        """Parse the key=value pairs inside a docuvert header.

        Returns None when required fields are missing. Exposed as a
        static method so tests and future utilities can exercise the
        parser directly without needing a DocConvert instance.

        Recognised fields:

        - ``source`` — source filename (required)
        - ``sha256`` — source content hash (required)
        - ``images`` — comma-separated list of extracted image
          filenames (optional)

        Any other key=value pairs are captured in `extra` for
        forward compatibility. A future release adding a new
        field (e.g., ``tool_version``) won't cause older clients to
        fail — they just won't display the new field.
        """
        fields: dict[str, str] = {
            match.group(1).lower(): match.group(2)
            for match in _PROV_FIELD_RE.finditer(body)
        }

        source = fields.pop("source", None)
        sha256 = fields.pop("sha256", None)
        if not source or not sha256:
            return None

        images_raw = fields.pop("images", "")
        images = tuple(
            name.strip() for name in images_raw.split(",")
            if name.strip()
        )

        return ProvenanceHeader(
            source=source,
            sha256=sha256,
            images=images,
            extra=fields or None,
        )

    # ------------------------------------------------------------------
    # Source hashing
    # ------------------------------------------------------------------

    @staticmethod
    def _hash_file(path: Path) -> str:
        """SHA-256 hex digest of a file's content.

        Streams in 64 KB chunks so large files don't need to fit in
        memory. The hex output is what goes into the provenance
        header (shorter prefix would risk collisions across a repo
        with thousands of source files).
        """
        h = hashlib.sha256()
        with path.open("rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()

    # ------------------------------------------------------------------
    # convert_files — not yet implemented
    # ------------------------------------------------------------------

    def convert_files(
        self,
        paths: list[str],
    ) -> dict[str, Any]:
        """Convert the named source files to markdown.

        Pass A — stub. The guard runs (so non-localhost callers get
        the correct restricted-error shape today), but the actual
        conversion raises `NotImplementedError`. Pass A2 will wire
        markitdown for the simple formats.

        Parameters
        ----------
        paths:
            Repo-relative source file paths.

        Returns
        -------
        dict
            Restricted-error shape for non-localhost callers.
            `NotImplementedError` raised for localhost callers —
            deliberately a hard failure so nobody accidentally
            ships code calling this during Pass A.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        _ = paths  # reserved for Pass A2
        raise NotImplementedError(
            "DocConvert.convert_files is not yet implemented; "
            "Pass A2 lands markitdown for .docx/.rtf/.odt"
        )