"""DocConvert RPC service — Layer 4.5.

The DocConvert service is the backend half of the Doc Convert tab.
It scans the repository for convertible documents (`.docx`, `.pdf`,
`.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp`), classifies each by
status (new / current / stale / conflict), and — on explicit user
request — converts them to markdown via a pipeline that dispatches
by file type through several optional dependencies (markitdown,
LibreOffice, PyMuPDF, python-pptx, openpyxl).

Current scope — **Pass A (foundation) + Pass A2 (markitdown for
simple formats)**. What's delivered:

- `DocConvert` class registered via `server.add_class(doc_convert)`.
- `is_available()` — probes every optional dependency and reports
  each via the specs4-specified shape `{available, libreoffice,
  pymupdf, pdf_pipeline}`.
- `scan_convertible_files()` — walks the repo, classifies each
  source file via the provenance-header round-trip.
- `convert_files(paths)` — Pass A2: dispatches by extension.
  `.docx`, `.rtf`, `.odt` route through markitdown with full
  provenance-header writing, data-URI image extraction, DOCX
  truncated-URI workaround, and orphan-image cleanup on
  re-conversion. Other extensions (`.pdf`, `.pptx`, `.xlsx`,
  `.csv`, `.odp`) return per-file "not yet supported" results
  — caller sees specific failures rather than a blanket
  NotImplementedError.
- Clean-tree gate — refuses conversion if the repo has
  uncommitted changes. Matches the Code Review prerequisite in
  specs4/4-features/doc-convert.md.

Pass A3 will add xlsx colour extraction via openpyxl. Pass A4
adds pptx fallback via python-pptx. Pass A5 adds the full PDF
pipeline (LibreOffice → PyMuPDF → text extraction + SVG export
+ image externalization).

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

import base64
import hashlib
import logging
import os
import re
import shutil
import zipfile
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


# Extensions handled by the markitdown path. `.csv` is included
# because markitdown produces clean markdown tables for simple
# CSVs — good enough until a dedicated pass lands if we ever
# need colour-aware CSV (unlikely; CSVs don't carry formatting).
_MARKITDOWN_EXTENSIONS: frozenset[str] = frozenset({
    ".docx",
    ".rtf",
    ".odt",
    ".csv",
})


# Extensions handled by the openpyxl-based colour-aware xlsx
# pipeline. Separated from the markitdown path because xlsx
# conversion preserves cell background colours as emoji markers
# — markitdown ignores formatting entirely, which loses
# information for spreadsheets used to track status (red =
# blocked, green = done, etc.).
_XLSX_EXTENSIONS: frozenset[str] = frozenset({
    ".xlsx",
})


# RGB values treated as "effectively no fill" during xlsx
# extraction. Near-white and near-black fills are almost always
# defaults (unformatted cells, borders) rather than meaningful
# status markers — emitting an emoji for every such cell would
# overwhelm the output. The threshold is a per-channel distance.
_IGNORE_NEAR_WHITE_THRESHOLD = 20  # per-channel delta from 255
_IGNORE_NEAR_BLACK_THRESHOLD = 20  # per-channel delta from 0

# RGB Euclidean distance below which two colours are treated as
# the same cluster for the fallback marker assignment. Tuned so
# three visibly-distinct shades of brown each get their own
# marker, but slight rendering variations of the same "red"
# collapse together.
_COLOUR_CLUSTER_DISTANCE = 40.0

# Well-known hue markers — named colours that users reach for
# first when adding cell fills. Order doesn't matter; lookup is
# by closest match within the named-hue set.
_NAMED_COLOURS: tuple[tuple[str, tuple[int, int, int], str], ...] = (
    ("red",    (255,   0,   0), "🔴"),
    ("green",  (  0, 200,   0), "🟢"),
    ("yellow", (255, 230,   0), "🟡"),
    ("blue",   (  0, 100, 255), "🔵"),
    ("orange", (255, 140,   0), "🟠"),
    ("purple", (150,   0, 200), "🟣"),
    ("pink",   (255, 130, 200), "🩷"),
    ("brown",  (139,  69,  19), "🟤"),
)

# Distance threshold for matching against named colours. An
# unknown colour closer than this to a named colour is assigned
# the named marker; otherwise it falls through to the fallback
# clustering. Larger than the cluster distance because named
# colours are allowed to absorb a wider range of shades (every
# "pinkish red" should get 🔴 rather than proliferating fallback
# markers).
_NAMED_COLOUR_DISTANCE = 80.0

# Fallback markers assigned in order to unique colour clusters
# that don't match any named hue. Distinct enough visually to
# differentiate three shades of brown without confusing the
# reader. More than eight clusters is rare in practice.
_FALLBACK_MARKERS: tuple[str, ...] = (
    "⬛", "◆", "▲", "●", "■", "★", "◉", "◈",
)


# Regex matching `![alt](data:mime;base64,payload)` — the shape
# markitdown emits for embedded images. Group 1 is the whole
# `data:...` URL; group 2 is the MIME subtype (e.g. `png`);
# group 3 is the base64 payload OR the literal `...` for the
# DOCX truncated case.
#
# The payload allows `=` (base64 padding) and `/`, `+`
# (standard alphabet). We use `[^)]*` rather than a strict
# base64 charset because some markitdown outputs include stray
# whitespace or newlines that a strict pattern would break on
# — decoding catches real errors, and we don't want regex
# strictness to drop legitimately-encoded payloads.
_DATA_URI_IMAGE_RE = re.compile(
    r"!\[([^\]]*)\]\((data:image/([^;]+);base64,([^)]+))\)",
    re.IGNORECASE,
)


# Regex matching the DOCX truncated-URI shape:
# `data:image/png;base64...` (literal ellipsis, no closing paren
# fence because markitdown sometimes emits these without one).
# Group 1 is the MIME subtype. Handles both the wrapped form
# `![alt](data:image/png;base64...)` and the bare reference.
_TRUNCATED_URI_RE = re.compile(
    r"data:image/([^;]+);base64\.{3}",
    re.IGNORECASE,
)


# Per-image MIME-to-extension map for image extraction. Covers
# the formats DOCX / ODT / RTF realistically embed. Unknown
# MIMEs fall through to `.bin` so the file still lands on disk
# and the provenance header still records it — the user can
# rename if needed, but we never silently drop.
_MIME_TO_EXT: dict[str, str] = {
    "png": ".png",
    "jpeg": ".jpg",
    "jpg": ".jpg",
    "gif": ".gif",
    "webp": ".webp",
    "bmp": ".bmp",
    "tiff": ".tif",
    "svg+xml": ".svg",
}


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
    # convert_files — Pass A2 markitdown path
    # ------------------------------------------------------------------

    def convert_files(
        self,
        paths: list[str],
    ) -> dict[str, Any]:
        """Convert the named source files to markdown.

        Pass A2 dispatches by extension. `.docx`, `.rtf`, `.odt`
        route through markitdown with provenance-header writing
        and image extraction. Other supported extensions
        (`.pdf`, `.pptx`, `.xlsx`, `.csv`, `.odp`) return
        per-file "not yet supported" entries — the caller sees
        specific failures instead of a blanket NotImplementedError.

        Runs the clean-tree gate first (specs4/4-features/doc-convert.md):
        refuses if the repo has uncommitted changes. Without a git
        working tree to diff against, the converted output wouldn't
        be reviewable before commit. The gate requires a repo with
        an `is_clean()` method; when the service was constructed
        without a repo (tests, standalone CLI use), the gate is
        skipped — caller accepts the risk.

        Parameters
        ----------
        paths:
            Repo-relative source file paths.

        Returns
        -------
        dict
            On non-localhost callers, the specs4 restricted-error
            shape. On dirty working tree, ``{"error": ...}``. On
            successful dispatch, ``{"status": "ok", "results":
            [per_file_result, ...]}`` — each entry has ``path``,
            ``status`` (one of ``"ok"``, ``"skipped"``, ``"error"``),
            and optional ``message``, ``output_path``, ``images``.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted

        # Clean-tree gate — matches the Code Review pattern. When
        # no repo is attached (tests, CLI use), we skip — caller
        # owns the consistency guarantee in that case.
        if self._repo is not None:
            is_clean_fn = getattr(self._repo, "is_clean", None)
            if is_clean_fn is not None and not is_clean_fn():
                return {
                    "error": (
                        "Working tree has uncommitted changes. "
                        "Commit or stash before converting — "
                        "converted files must produce a clean diff."
                    )
                }

        root = self._root()
        results: list[dict[str, Any]] = []
        for rel_path in paths:
            result = self._convert_one(root, rel_path)
            results.append(result)
        return {"status": "ok", "results": results}

    def _convert_one(
        self,
        root: Path,
        rel_path: str,
    ) -> dict[str, Any]:
        """Convert a single file. Returns a per-file result dict.

        Entry point for the per-file dispatch. Handles validation
        (path inside root, file exists, size within budget),
        extension routing, and wraps every failure in a result
        dict rather than propagating. One failing file shouldn't
        abort the whole batch — the user may have mixed supported
        and unsupported files in one selection.
        """
        # Resolve and validate the path is inside the scan root.
        # A traversal attempt (`../foo.docx`) would be caught by
        # relative_to below, but we normalise first so the error
        # message names the requested path, not the resolved one.
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

        # Size check — mirrors the scan's over_size flag. A file
        # over the budget produces a skip result with an
        # explanatory message so the UI can render a warning
        # rather than silently dropping.
        try:
            size = source_abs.stat().st_size
        except OSError as exc:
            return self._fail(rel_path, f"Stat failed: {exc}")
        if size > self._max_size_bytes:
            return self._skip(
                rel_path,
                f"File exceeds {self._max_size_bytes // (1024 * 1024)}MB limit",
            )

        suffix = source_abs.suffix.lower()

        # markitdown handles the simple formats (.docx, .rtf,
        # .odt, .csv).
        if suffix in _MARKITDOWN_EXTENSIONS:
            return self._convert_via_markitdown(root, source_abs, rel_path)

        # xlsx uses a dedicated openpyxl-based pipeline so cell
        # background colours survive as emoji markers. Falls back
        # to markitdown if openpyxl is unavailable or fails.
        if suffix in _XLSX_EXTENSIONS:
            return self._convert_via_openpyxl(root, source_abs, rel_path)

        # Other supported extensions — explicit "not yet
        # supported" rather than a silent skip. Users see exactly
        # which files the current release can convert.
        if suffix in self._extensions:
            return self._skip(
                rel_path,
                (
                    f"{suffix} conversion is not yet implemented; "
                    "ships in a later pass"
                ),
            )

        # Extension isn't recognised at all. Should be unreachable
        # if the caller used `scan_convertible_files` as its source
        # of truth, but handle defensively.
        return self._fail(
            rel_path,
            f"Unsupported extension: {suffix}",
        )

    def _convert_via_markitdown(
        self,
        root: Path,
        source_abs: Path,
        rel_path: str,
    ) -> dict[str, Any]:
        """Convert via markitdown — the `.docx`/`.rtf`/`.odt` path.

        Orchestrates the full per-file pipeline:

        1. Compute source hash (for provenance header)
        2. Read prior provenance (for orphan-image cleanup on stale)
        3. Call markitdown to produce markdown text
        4. For DOCX: pre-extract images from zip `word/media/`,
           substitute truncated URIs
        5. Extract data-URI images, save to assets subdir,
           rewrite markdown references
        6. Clean up orphan images from prior conversion
        7. Remove empty assets subdir if no images were saved
        8. Write markdown with provenance header
        """
        # Lazy import — markitdown is an optional dependency.
        # Surfacing the error here rather than at module load
        # means the rest of DocConvert (scan, is_available) works
        # in stripped-down releases.
        try:
            from markitdown import MarkItDown
        except ImportError:
            return self._fail(
                rel_path,
                (
                    "markitdown is not installed. Install with: "
                    "pip install 'ac-dc[docs]'"
                ),
            )

        output_abs = source_abs.with_suffix(".md")
        try:
            output_rel = output_abs.relative_to(root)
        except ValueError:
            return self._fail(
                rel_path,
                "Output path escapes repository root",
            )

        # Hash the source — written into the provenance header and
        # used by future scans to classify this output as `current`.
        try:
            source_hash = self._hash_file(source_abs)
        except OSError as exc:
            return self._fail(rel_path, f"Source hash failed: {exc}")

        # Read prior provenance — we'll diff its image list against
        # the new one to identify orphans. If there's no prior
        # header (new or conflict), there are no orphans to clean.
        prior_images: tuple[str, ...] = ()
        if output_abs.is_file():
            prior_header = self._read_provenance_header(output_abs)
            if prior_header is not None:
                prior_images = prior_header.images

        # Run markitdown. Broad exception catch — library errors
        # vary wildly (CorruptedFileError, InvalidArgumentError,
        # NotImplementedError for unsupported variants). Wrap
        # into a per-file error result rather than propagating.
        try:
            md = MarkItDown()
            result = md.convert(str(source_abs))
            markdown_text = result.text_content or ""
        except Exception as exc:
            return self._fail(
                rel_path,
                f"markitdown conversion failed: {exc}",
            )

        # DOCX workaround — markitdown truncates large embedded
        # images to `data:image/png;base64...` with no payload.
        # Pre-extract the real images from the zip archive and
        # substitute the truncated references in order. Only
        # runs for `.docx`; other formats don't have the same
        # truncation issue.
        if source_abs.suffix.lower() == ".docx":
            markdown_text = self._replace_docx_truncated_uris(
                source_abs, markdown_text
            )

        # Assets subdirectory — `docs/architecture.docx` produces
        # `docs/architecture/` for image storage. Created on
        # demand; removed at the end if no images were saved.
        assets_dir = source_abs.with_suffix("")
        stem = source_abs.stem

        # Extract data-URI images and rewrite the markdown.
        markdown_text, saved_images = self._extract_data_uri_images(
            markdown_text, assets_dir, stem
        )

        # Orphan cleanup — images listed in the prior provenance
        # header but NOT produced by this conversion are deleted.
        # Prevents the assets subdir accumulating stale files
        # across re-conversions of a changing source.
        new_image_set = set(saved_images)
        for orphan in prior_images:
            if orphan in new_image_set:
                continue
            orphan_path = assets_dir / orphan
            try:
                orphan_path.unlink()
            except OSError as exc:
                # Non-fatal — log and continue. A leftover orphan
                # is cosmetic; a failed conversion from a missing
                # file isn't.
                logger.debug(
                    "Failed to remove orphan image %s: %s",
                    orphan_path, exc,
                )

        # Remove the assets subdir if empty (no images extracted
        # AND the dir is empty — which could be the case if orphan
        # cleanup just emptied it).
        if assets_dir.is_dir():
            try:
                # `iterdir` is cheaper than listing; we just need
                # to know if anything remains.
                if not any(assets_dir.iterdir()):
                    assets_dir.rmdir()
            except OSError as exc:
                logger.debug(
                    "Failed to remove empty assets dir %s: %s",
                    assets_dir, exc,
                )

        # Build the final output: provenance header + markdown.
        provenance_line = self._build_provenance_header(
            source_name=source_abs.name,
            source_hash=source_hash,
            images=saved_images,
        )
        final_content = (
            provenance_line + "\n\n" + markdown_text.lstrip("\n")
        )

        # Write output. Parent dir already exists (source is
        # there), but be defensive for symlink edge cases.
        try:
            output_abs.parent.mkdir(parents=True, exist_ok=True)
            output_abs.write_text(final_content, encoding="utf-8")
        except OSError as exc:
            return self._fail(
                rel_path,
                f"Failed to write output: {exc}",
            )

        return {
            "path": rel_path,
            "status": "ok",
            "output_path": str(output_rel).replace("\\", "/"),
            "images": list(saved_images),
        }

    # ------------------------------------------------------------------
    # DOCX image pre-extraction (truncated-URI workaround)
    # ------------------------------------------------------------------

    def _replace_docx_truncated_uris(
        self,
        source_abs: Path,
        markdown_text: str,
    ) -> str:
        """Substitute markitdown's truncated DOCX URIs with real images.

        markitdown emits `data:image/png;base64...` (literal
        ellipsis, no payload) for large embedded images in
        `.docx` files. We work around by pre-extracting the
        images from `word/media/` inside the zip archive and
        substituting the truncated references in order.

        The order-of-appearance substitution is the best we can
        do without deeper docx parsing — markitdown doesn't
        surface the image relationship IDs that would let us
        map each reference to its exact source. In practice the
        order is correct because both markitdown and our zip
        walker iterate in document order.

        Returns the modified markdown. When no truncated URIs
        are present, or when the zip has no extractable images,
        the input is returned unchanged.
        """
        # Find truncated URIs in order of appearance.
        truncated_matches = list(_TRUNCATED_URI_RE.finditer(markdown_text))
        if not truncated_matches:
            return markdown_text

        # Extract images from the docx zip. Order matches
        # `zipfile.namelist()`'s document-order return.
        extracted_images = self._extract_docx_media(source_abs)
        if not extracted_images:
            # Truncated URIs but no zip images — odd, but we
            # can't substitute. Leave the markdown as-is; the
            # caller sees broken image refs which is better than
            # silently dropping them.
            return markdown_text

        # Re-encode each extracted image as a full data URI so
        # `_extract_data_uri_images` can handle it uniformly on
        # the next pass. Match count to the min of truncated
        # occurrences and available images.
        count = min(len(truncated_matches), len(extracted_images))
        for i in range(count):
            mime, payload = extracted_images[i]
            full_uri = f"data:image/{mime};base64,{payload}"
            # Substitute only the first remaining truncated URI
            # on each pass — multi-substitute with `re.sub` risks
            # replacing all occurrences at once, which we don't
            # want (each truncated ref maps to a different image).
            markdown_text = _TRUNCATED_URI_RE.sub(
                full_uri, markdown_text, count=1,
            )
        return markdown_text

    @staticmethod
    def _extract_docx_media(
        source_abs: Path,
    ) -> list[tuple[str, str]]:
        """Extract (mime_subtype, base64_payload) pairs from a docx zip.

        Walks the zip archive's `word/media/` directory in
        document order (zipfile's `namelist` preserves storage
        order, which for well-formed docx matches the order
        image refs appear in the document). Returns pairs suitable
        for re-encoding as `data:image/{mime};base64,{payload}`.

        Failures (not a valid zip, no media directory,
        unreadable members) return an empty list — caller treats
        as "no substitutions possible" and leaves the markdown
        as-is.
        """
        images: list[tuple[str, str]] = []
        try:
            with zipfile.ZipFile(source_abs, "r") as zf:
                for name in zf.namelist():
                    if not name.startswith("word/media/"):
                        continue
                    # Extract the extension to derive the MIME
                    # subtype. `word/media/image1.png` → `png`.
                    ext = Path(name).suffix.lstrip(".").lower()
                    if not ext:
                        continue
                    # Normalise `jpg` → `jpeg` for the MIME
                    # subtype — browsers accept both but the
                    # canonical form is `jpeg`.
                    mime_sub = "jpeg" if ext == "jpg" else ext
                    try:
                        raw = zf.read(name)
                    except (KeyError, RuntimeError) as exc:
                        logger.debug(
                            "DOCX media read failed for %s: %s",
                            name, exc,
                        )
                        continue
                    payload = base64.b64encode(raw).decode("ascii")
                    images.append((mime_sub, payload))
        except zipfile.BadZipFile:
            logger.debug(
                "Not a valid zip: %s (docx extraction skipped)",
                source_abs,
            )
        except OSError as exc:
            logger.debug(
                "DOCX media extraction failed for %s: %s",
                source_abs, exc,
            )
        return images

    # ------------------------------------------------------------------
    # Data-URI image extraction
    # ------------------------------------------------------------------

    def _extract_data_uri_images(
        self,
        markdown_text: str,
        assets_dir: Path,
        stem: str,
    ) -> tuple[str, tuple[str, ...]]:
        """Decode data-URI images, save to disk, rewrite references.

        Parameters
        ----------
        markdown_text:
            Output from markitdown, potentially containing
            `![alt](data:image/...;base64,...)` references.
        assets_dir:
            Per-source assets directory. Created on demand.
            Names follow `{stem}_img{N}{ext}` so repeated
            conversions produce stable filenames — matters for
            orphan detection and git diffs.
        stem:
            Source file stem for naming extracted images
            (e.g. `architecture` → `architecture_img1.png`).

        Returns
        -------
        tuple
            `(rewritten_markdown, image_filenames)`. The
            filename list is ordered by appearance; caller uses
            it for the provenance header and orphan cleanup.
            Empty tuple when no images were extracted.

        Images that fail decoding are left as-is in the
        markdown — the broken reference is preferable to
        silently dropping the image.
        """
        matches = list(_DATA_URI_IMAGE_RE.finditer(markdown_text))
        if not matches:
            return markdown_text, ()

        saved: list[str] = []
        # We iterate matches and build the new text by splicing
        # — simpler than re.sub with a callback because we need
        # to increment the counter AND create the assets dir
        # lazily.
        output_parts: list[str] = []
        cursor = 0
        for match in matches:
            alt_text = match.group(1)
            mime_sub = match.group(3).lower()
            payload = match.group(4)

            # Append text before the match verbatim.
            output_parts.append(markdown_text[cursor:match.start()])

            # Decode the payload. Failure (invalid base64,
            # truncated `...` slipping through) leaves the
            # original data URI in place so the markdown renders
            # a broken image rather than nothing.
            try:
                # Strip whitespace — markitdown sometimes wraps
                # long payloads. Decoding is tolerant of `=`
                # padding errors when we strip them first; we
                # don't bother because valid base64 decoders
                # handle missing padding gracefully in `b64decode`
                # with `validate=False`.
                image_bytes = base64.b64decode(payload, validate=False)
            except (ValueError, Exception) as exc:
                logger.debug(
                    "Data URI decode failed: %s", exc,
                )
                output_parts.append(match.group(0))
                cursor = match.end()
                continue

            # Decoded successfully. Create assets dir on first
            # successful extraction only — avoids empty dirs.
            try:
                assets_dir.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                logger.debug(
                    "Assets dir create failed %s: %s",
                    assets_dir, exc,
                )
                output_parts.append(match.group(0))
                cursor = match.end()
                continue

            # Name the image. `{stem}_img{N}{ext}` — `N` is
            # 1-indexed for user-friendliness.
            ext = _MIME_TO_EXT.get(mime_sub, ".bin")
            image_index = len(saved) + 1
            image_name = f"{stem}_img{image_index}{ext}"
            image_path = assets_dir / image_name

            try:
                image_path.write_bytes(image_bytes)
            except OSError as exc:
                logger.debug(
                    "Image write failed %s: %s",
                    image_path, exc,
                )
                output_parts.append(match.group(0))
                cursor = match.end()
                continue

            saved.append(image_name)
            # Rewrite the reference to point at the saved file.
            # Path is relative from the markdown file's location:
            # `{stem}/{image_name}` (the assets dir is a sibling
            # of the `.md` named after the source stem).
            rel_ref = f"{assets_dir.name}/{image_name}"
            output_parts.append(f"![{alt_text}]({rel_ref})")
            cursor = match.end()

        # Trailing text after the last match.
        output_parts.append(markdown_text[cursor:])
        return "".join(output_parts), tuple(saved)

    # ------------------------------------------------------------------
    # xlsx — colour-aware extraction via openpyxl
    # ------------------------------------------------------------------

    def _convert_via_openpyxl(
        self,
        root: Path,
        source_abs: Path,
        rel_path: str,
    ) -> dict[str, Any]:
        """Convert an .xlsx file, preserving cell background colours.

        Two-pass approach:

        1. Pass 1 — walk every cell in every sheet, collecting
           text values (normalised) and raw hex fill colours. The
           set of unique non-ignorable fills is built during this
           pass.
        2. Colour mapping — well-known hues (red, green, yellow,
           blue, purple, etc.) get named emoji markers. Remaining
           colours are clustered by Euclidean RGB distance and
           assigned fallback markers per cluster.
        3. Pass 2 — emit markdown tables sheet by sheet, cells
           prefixed with their colour marker.

        Empty columns and fully-empty rows are stripped. A
        legend mapping markers to colour names appears at the end.

        Falls back to markitdown on any openpyxl failure
        (ImportError, corrupt file, unexpected structure) — the
        user still gets SOMETHING rather than an error result.
        """
        # Lazy import — openpyxl is optional in stripped-down
        # releases. ImportError is expected in that case and
        # means "use markitdown instead", not "fail the
        # conversion".
        try:
            from openpyxl import load_workbook
        except ImportError:
            logger.debug(
                "openpyxl not installed; falling back to "
                "markitdown for %s",
                rel_path,
            )
            return self._convert_via_markitdown(
                root, source_abs, rel_path
            )

        output_abs = source_abs.with_suffix(".md")
        try:
            output_rel = output_abs.relative_to(root)
        except ValueError:
            return self._fail(
                rel_path,
                "Output path escapes repository root",
            )

        # Hash source for provenance — matches the markitdown
        # path so status classification works uniformly.
        try:
            source_hash = self._hash_file(source_abs)
        except OSError as exc:
            return self._fail(
                rel_path, f"Source hash failed: {exc}"
            )

        # Open workbook in read-only mode for performance on
        # large files. Also pass data_only=False so we see
        # formulas as formulas (not cached values) — mostly
        # defensive; formula cells rarely have fills anyway.
        try:
            workbook = load_workbook(
                filename=str(source_abs),
                read_only=False,  # need .fill on cells
                data_only=True,
            )
        except Exception as exc:
            # Corrupt xlsx, password-protected, etc. — fall back
            # to markitdown rather than erroring. markitdown may
            # still extract something useful.
            logger.debug(
                "openpyxl failed to open %s: %s; "
                "falling back to markitdown",
                rel_path, exc,
            )
            return self._convert_via_markitdown(
                root, source_abs, rel_path
            )

        # Pass 1: collect cells and unique fills across all sheets.
        try:
            sheets_data, unique_fills = self._xlsx_pass1_collect(
                workbook
            )
        except Exception as exc:
            logger.debug(
                "openpyxl pass-1 failed for %s: %s; "
                "falling back to markitdown",
                rel_path, exc,
            )
            workbook.close()
            return self._convert_via_markitdown(
                root, source_abs, rel_path
            )
        finally:
            workbook.close()

        # Build colour → marker map.
        colour_map = self._xlsx_build_colour_map(unique_fills)

        # Pass 2: emit markdown per sheet.
        body_parts: list[str] = []
        for sheet_name, rows in sheets_data:
            sheet_md = self._xlsx_render_sheet(
                sheet_name, rows, colour_map
            )
            if sheet_md:
                body_parts.append(sheet_md)

        if not body_parts:
            # Workbook had no data in any sheet. Still produce
            # an output file so the scan classifies it as
            # `current`, but with an informative placeholder.
            body_parts.append("(empty spreadsheet)")

        # Append legend mapping each used marker to its colour name.
        legend = self._xlsx_render_legend(colour_map)
        if legend:
            body_parts.append(legend)

        markdown_text = "\n\n".join(body_parts) + "\n"

        # Write output with provenance header. xlsx path never
        # produces embedded images, so we skip the data-URI
        # extraction pipeline entirely.
        provenance_line = self._build_provenance_header(
            source_name=source_abs.name,
            source_hash=source_hash,
            images=(),
        )
        final_content = (
            provenance_line + "\n\n" + markdown_text.lstrip("\n")
        )

        try:
            output_abs.parent.mkdir(parents=True, exist_ok=True)
            output_abs.write_text(final_content, encoding="utf-8")
        except OSError as exc:
            return self._fail(
                rel_path,
                f"Failed to write output: {exc}",
            )

        return {
            "path": rel_path,
            "status": "ok",
            "output_path": str(output_rel).replace("\\", "/"),
            "images": [],
        }

    def _xlsx_pass1_collect(
        self,
        workbook: Any,
    ) -> tuple[
        list[tuple[str, list[list[tuple[str, str | None]]]]],
        set[str],
    ]:
        """First pass over an xlsx workbook.

        Returns a list of `(sheet_name, rows)` pairs and the set
        of unique non-ignorable hex fill colours across the
        workbook. Each row is a list of `(value, hex_fill)`
        tuples where `hex_fill` is None for ignorable fills.

        Cell values are normalised — None becomes empty string,
        "nan"/"none" (case-insensitive) become empty string, and
        all non-string values are stringified. Whitespace is
        preserved except that leading/trailing is trimmed.

        Exceptions from openpyxl propagate; the caller wraps
        with a fallback-to-markitdown path.
        """
        sheets_data: list[
            tuple[str, list[list[tuple[str, str | None]]]]
        ] = []
        unique_fills: set[str] = set()

        for sheet in workbook.worksheets:
            rows: list[list[tuple[str, str | None]]] = []
            # iter_rows with values_only=False gives us Cell
            # objects (needed for .fill). We walk the used range
            # only — iter_rows defaults to the sheet's dimension.
            for row in sheet.iter_rows():
                row_cells: list[tuple[str, str | None]] = []
                for cell in row:
                    value = self._normalise_cell_value(cell.value)
                    fill_hex = self._extract_cell_fill(cell)
                    if fill_hex is not None:
                        unique_fills.add(fill_hex)
                    row_cells.append((value, fill_hex))
                rows.append(row_cells)
            sheets_data.append((sheet.title, rows))

        return sheets_data, unique_fills

    @staticmethod
    def _normalise_cell_value(value: Any) -> str:
        """Normalise a raw cell value for markdown emission.

        - None → empty string
        - Pandas/numpy artifacts "nan" / "none" (case-insensitive)
          → empty string. These crop up when a spreadsheet was
          generated from a DataFrame with missing values.
        - Everything else is stringified and stripped of
          leading/trailing whitespace.

        Pipe characters are escaped as `\\|` since they would
        otherwise break the markdown table row.
        """
        if value is None:
            return ""
        text = str(value).strip()
        if text.lower() in ("nan", "none"):
            return ""
        # Escape pipes so they don't break table rows. Literal
        # backslashes in cell values are rare; we don't escape
        # those.
        return text.replace("|", r"\|")

    @staticmethod
    def _extract_cell_fill(cell: Any) -> str | None:
        """Return the cell's fill as a hex string, or None.

        Ignorable fills (near-white, near-black, no fill at all)
        return None so they don't produce emoji markers. The
        hex string is lowercase without a leading hash.

        openpyxl's fill model is verbose — cells with no explicit
        fill still have a PatternFill with fgColor set to a
        default theme colour. We filter those by checking the
        patternType and the raw RGB.
        """
        try:
            fill = cell.fill
            if fill is None:
                return None
            # Only solid fills carry meaningful colour info.
            # patternType "none" means no explicit fill.
            pattern_type = getattr(fill, "patternType", None)
            if pattern_type not in ("solid", "lightGrid", "darkGrid"):
                return None
            fg = fill.fgColor
            if fg is None:
                return None
            # fgColor.rgb is an 8-char hex string (AARRGGBB)
            # when set. Theme colours return None here; we can't
            # resolve them without the workbook's theme table,
            # which isn't worth the complexity for a diagnostic
            # marker.
            raw = getattr(fg, "rgb", None)
            if not raw or not isinstance(raw, str):
                return None
            # Some versions of openpyxl return the rgb as a
            # Value wrapper — coerce defensively.
            raw = str(raw).strip().lower()
            # Strip alpha channel if present.
            if len(raw) == 8:
                raw = raw[2:]
            if len(raw) != 6:
                return None
            # Filter ignorable colours.
            try:
                r = int(raw[0:2], 16)
                g = int(raw[2:4], 16)
                b = int(raw[4:6], 16)
            except ValueError:
                return None
            # Near-white → ignore.
            if (
                (255 - r) < _IGNORE_NEAR_WHITE_THRESHOLD
                and (255 - g) < _IGNORE_NEAR_WHITE_THRESHOLD
                and (255 - b) < _IGNORE_NEAR_WHITE_THRESHOLD
            ):
                return None
            # Near-black → ignore.
            if (
                r < _IGNORE_NEAR_BLACK_THRESHOLD
                and g < _IGNORE_NEAR_BLACK_THRESHOLD
                and b < _IGNORE_NEAR_BLACK_THRESHOLD
            ):
                return None
            return raw
        except Exception:
            # Anything unexpected — treat as no fill. Defensive
            # against openpyxl API drift.
            return None

    @staticmethod
    def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
        """Convert a 6-char hex string to an (r, g, b) tuple.

        Input is assumed valid (produced by `_extract_cell_fill`
        which already validates). No error handling on the
        integer parses — if they fail, the caller has a bug.
        """
        return (
            int(hex_str[0:2], 16),
            int(hex_str[2:4], 16),
            int(hex_str[4:6], 16),
        )

    @staticmethod
    def _colour_distance(
        a: tuple[int, int, int],
        b: tuple[int, int, int],
    ) -> float:
        """Euclidean RGB distance.

        Perceptually naive (doesn't weight green higher like
        proper colour-diff metrics) but fine for the "are these
        two reds the same colour?" question the clustering needs.
        """
        dr = a[0] - b[0]
        dg = a[1] - b[1]
        db = a[2] - b[2]
        return (dr * dr + dg * dg + db * db) ** 0.5

    def _xlsx_build_colour_map(
        self,
        unique_fills: set[str],
    ) -> dict[str, tuple[str, str]]:
        """Assign an emoji marker and colour name to each fill.

        Returns a dict mapping hex colour → `(marker, name)`
        tuple. The name is either a named-colour label (red,
        green, etc.) or a synthesised label for fallback
        clusters ("cluster-1", "cluster-2", …).

        Algorithm:

        1. For each unique fill, find the closest named colour
           within `_NAMED_COLOUR_DISTANCE`. If found, assign the
           named marker.
        2. For remaining fills (no named match), cluster by
           proximity — fills within `_COLOUR_CLUSTER_DISTANCE` of
           an existing cluster join it; otherwise start a new
           cluster. Assign fallback markers in order.

        Named colours can be shared by multiple fills (all
        "reddish" cells get 🔴 regardless of exact shade).
        Fallback clusters each get their own marker.
        """
        result: dict[str, tuple[str, str]] = {}

        # Sort fills for deterministic assignment — two runs on
        # the same workbook produce the same markers. Without
        # this, set iteration order would vary.
        sorted_fills = sorted(unique_fills)

        unmatched: list[tuple[str, tuple[int, int, int]]] = []

        # Step 1 — assign named colours where close enough.
        for hex_fill in sorted_fills:
            rgb = self._hex_to_rgb(hex_fill)
            best_name: str | None = None
            best_marker: str | None = None
            best_dist = _NAMED_COLOUR_DISTANCE
            for name, named_rgb, marker in _NAMED_COLOURS:
                dist = self._colour_distance(rgb, named_rgb)
                if dist < best_dist:
                    best_dist = dist
                    best_name = name
                    best_marker = marker
            if best_name is not None and best_marker is not None:
                result[hex_fill] = (best_marker, best_name)
            else:
                unmatched.append((hex_fill, rgb))

        # Step 2 — cluster remaining fills. Each cluster holds a
        # representative RGB and the set of hex strings assigned
        # to it.
        clusters: list[tuple[tuple[int, int, int], list[str]]] = []
        for hex_fill, rgb in unmatched:
            joined = False
            for i, (cluster_rgb, cluster_hexes) in enumerate(clusters):
                if self._colour_distance(rgb, cluster_rgb) < _COLOUR_CLUSTER_DISTANCE:
                    cluster_hexes.append(hex_fill)
                    joined = True
                    break
            if not joined:
                clusters.append((rgb, [hex_fill]))

        # Assign fallback markers. More clusters than we have
        # markers — cycle through and append an index to the
        # name so entries remain distinguishable in the legend.
        for i, (_rgb, cluster_hexes) in enumerate(clusters):
            marker = _FALLBACK_MARKERS[i % len(_FALLBACK_MARKERS)]
            name = f"cluster-{i + 1}"
            for hex_fill in cluster_hexes:
                result[hex_fill] = (marker, name)

        return result

    def _xlsx_render_sheet(
        self,
        sheet_name: str,
        rows: list[list[tuple[str, str | None]]],
        colour_map: dict[str, tuple[str, str]],
    ) -> str:
        """Render one sheet as a markdown section.

        - Empty columns (all values empty across every row) are
          dropped.
        - Fully-empty rows are dropped.
        - First non-empty row becomes the table header. If every
          cell in that row is a string with meaningful content,
          it's used as-is; otherwise synthetic headers
          (`col1`, `col2`, …) are generated.
        - Coloured cells get their marker prepended with a
          space separator.

        Returns an empty string when the sheet has no data after
        stripping — the caller skips those sheets.
        """
        # Drop fully-empty rows.
        non_empty_rows = [
            row for row in rows
            if any(value for value, _ in row)
        ]
        if not non_empty_rows:
            return ""

        # Find the widest row — column count is the max width
        # across all non-empty rows. Shorter rows are padded
        # with empty cells during render.
        max_width = max(len(row) for row in non_empty_rows)
        if max_width == 0:
            return ""

        # Drop fully-empty columns. A column is empty if every
        # non-empty row has an empty value at that position.
        keep_columns: list[int] = []
        for col_idx in range(max_width):
            for row in non_empty_rows:
                if col_idx < len(row) and row[col_idx][0]:
                    keep_columns.append(col_idx)
                    break

        if not keep_columns:
            return ""

        # Header row — use the first non-empty row's values if
        # they look like headers (all non-empty strings, no
        # colour markers). Otherwise synthesise column names.
        first_row = non_empty_rows[0]
        use_first_as_header = all(
            col_idx < len(first_row) and first_row[col_idx][0]
            for col_idx in keep_columns
        )

        header_cells: list[str]
        data_rows: list[list[tuple[str, str | None]]]
        if use_first_as_header:
            header_cells = [
                first_row[col_idx][0] for col_idx in keep_columns
            ]
            data_rows = non_empty_rows[1:]
        else:
            header_cells = [
                f"col{i + 1}" for i in range(len(keep_columns))
            ]
            data_rows = non_empty_rows

        # Build markdown.
        lines: list[str] = [f"## {sheet_name}", ""]
        lines.append(
            "| " + " | ".join(header_cells) + " |"
        )
        lines.append(
            "|" + "|".join("---" for _ in keep_columns) + "|"
        )
        for row in data_rows:
            rendered_cells: list[str] = []
            for col_idx in keep_columns:
                if col_idx < len(row):
                    value, fill_hex = row[col_idx]
                else:
                    value, fill_hex = "", None
                if fill_hex is not None and fill_hex in colour_map:
                    marker = colour_map[fill_hex][0]
                    rendered_cells.append(
                        f"{marker} {value}" if value else marker
                    )
                else:
                    rendered_cells.append(value)
            lines.append(
                "| " + " | ".join(rendered_cells) + " |"
            )

        return "\n".join(lines)

    @staticmethod
    def _xlsx_render_legend(
        colour_map: dict[str, tuple[str, str]],
    ) -> str:
        """Render the colour-marker legend at the end of the output.

        Lists each unique (marker, name) pair exactly once. The
        colour map may contain multiple hex values mapped to the
        same named colour (all reddish fills → 🔴 red); the
        legend shows the named entry once rather than repeating
        per-hex.

        Returns an empty string when no markers were used.
        """
        if not colour_map:
            return ""
        # Collect unique (marker, name) pairs.
        seen: set[tuple[str, str]] = set()
        ordered_entries: list[tuple[str, str]] = []
        for marker, name in colour_map.values():
            key = (marker, name)
            if key in seen:
                continue
            seen.add(key)
            ordered_entries.append(key)
        if not ordered_entries:
            return ""
        lines = ["## Legend", ""]
        for marker, name in ordered_entries:
            lines.append(f"- {marker} {name}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Provenance header writing
    # ------------------------------------------------------------------

    @staticmethod
    def _build_provenance_header(
        source_name: str,
        source_hash: str,
        images: tuple[str, ...],
    ) -> str:
        """Build the `<!-- docuvert: ... -->` header string.

        Fields rendered in a stable order (source, sha256,
        images) so diff noise is minimal when a file is
        re-converted with only one field changing.

        The images field is omitted entirely when no images
        were extracted — keeps the header compact for text-only
        documents. The scan's parser tolerates both shapes
        (pinned by Pass A's `test_empty_images_list_is_empty_tuple`).
        """
        parts = [
            f"source={source_name}",
            f"sha256={source_hash}",
        ]
        if images:
            parts.append(f"images={','.join(images)}")
        body = " ".join(parts)
        return f"<!-- docuvert: {body} -->"

    # ------------------------------------------------------------------
    # Result-dict builders
    # ------------------------------------------------------------------

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

        Distinct from `error` so the frontend can render a
        different icon — skipped files may be retried later
        (over-size, extension deferred to a later pass) while
        errors typically indicate a real problem.
        """
        return {
            "path": rel_path,
            "status": "skipped",
            "message": message,
        }