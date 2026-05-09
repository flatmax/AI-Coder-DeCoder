"""Shared constants for the doc_convert pipelines.

Extracted from the original monolithic ``doc_convert.py`` during
the package split. Every constant defined here is referenced by
one or more of the pipeline modules (markitdown, xlsx, pptx,
libreoffice, pymupdf) and by the orchestrator. Keeping them in
one place avoids circular imports between the pipeline modules
and ensures a single source of truth — for example, the list
of "ignorable" near-white fills used by the xlsx pipeline lives
here so future tweaks don't need to be mirrored across files.

The leading-underscore naming is preserved verbatim from the
original module: these were module-private in the monolith and
remain module-private to the package. Pipeline modules import
them directly via ``from .constants import _FOO``.
"""

from __future__ import annotations

import re


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
    ".ac-dc4",
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


# Extensions handled by the python-pptx fallback pipeline. The
# primary path for presentations is LibreOffice + PyMuPDF
# (Pass A5) which produces text+SVG hybrid output; this
# fallback runs when those dependencies aren't installed and
# renders each slide as a full SVG via python-pptx.
_PPTX_EXTENSIONS: frozenset[str] = frozenset({
    ".pptx",
})


# Extensions handled directly by the PyMuPDF pipeline (no
# LibreOffice conversion needed — PyMuPDF reads PDFs natively).
# pptx and odp use PyMuPDF too but go through LibreOffice first
# to produce an intermediate PDF (handled by Pass A5b).
_PDF_EXTENSIONS: frozenset[str] = frozenset({
    ".pdf",
})


# Extensions routed through the LibreOffice → PDF → PyMuPDF
# pipeline when available. Falls back to format-specific paths
# when LibreOffice or PyMuPDF is missing:
#   .pptx → python-pptx fallback
#   .odp  → markitdown fallback
_LIBREOFFICE_EXTENSIONS: frozenset[str] = frozenset({
    ".pptx",
    ".odp",
})


# Timeout (seconds) for the `soffice --headless --convert-to
# pdf` subprocess. LibreOffice launches its UNO listener lazily
# and can take several seconds on first invocation; subsequent
# invocations are faster. 120 seconds is generous but bounded —
# prevents hung conversions from wedging the executor.
_LIBREOFFICE_TIMEOUT_SECONDS = 120


# Minimum number of "significant" drawings on a page before we
# trigger SVG export alongside text extraction. Below this
# threshold, the page is treated as text-only — no SVG produced.
# Tuned so pages with just borders or table rules (which every
# PDF generator emits for layout) don't bloat the output.
_PAGE_GRAPHICS_THRESHOLD = 3


# Minimum segment counts for a vector drawing to count as
# "significant". Simple rectangles and straight lines don't
# qualify; curves and multi-segment paths do.
_PATH_SIGNIFICANT_SEGMENTS = 4
_POLYGON_SIGNIFICANT_SEGMENTS = 2


# EMU (English Metric Units) — python-pptx's native unit for
# all dimensions. 914400 EMU per inch.
_EMU_PER_INCH = 914400

# Screen DPI for SVG viewBox dimensions. SVG's default user
# unit is 1px at 96 DPI; using 96 here produces SVGs that
# render at the same visual size as the original slide when
# displayed in a 1:1 viewer. User units in SVG scale cleanly,
# so this is just a reference point — nothing in the pipeline
# actually depends on the literal pixel values.
_SVG_DPI = 96

# Conversion factor EMU → pixels.
_EMU_TO_PX = _SVG_DPI / _EMU_PER_INCH

# Default slide dimensions in EMU when python-pptx reports None.
# Standard 4:3 slide at 10" x 7.5" — the pptx default. Rarely
# encountered (real files always have a slide size) but keeps
# the pipeline robust against corrupted or exotic templates.
_DEFAULT_SLIDE_WIDTH_EMU = 9144000   # 10 inches
_DEFAULT_SLIDE_HEIGHT_EMU = 6858000  # 7.5 inches

# Fallback font size in points when python-pptx reports None.
# Matches PowerPoint's default body text size.
_DEFAULT_FONT_SIZE_PT = 18

# Fallback font colour when python-pptx reports None.
# Black reads correctly against the default white slide
# background; slides with dark themes will need future work
# to resolve background-colour-aware defaults.
_DEFAULT_FONT_COLOR = "#000000"

# Pixels per font-size point for SVG font-size attribute.
# SVG font-size is in user units (pixels at 96 DPI); 1pt =
# 1/72 inch, so 1pt * 96/72 = 4/3 pixels.
_PT_TO_PX = 96 / 72

# Zero-padding width for slide filenames. Two digits covers
# presentations up to 99 slides; longer decks pad to three.
# Using a fixed width per deck keeps the file listing sorted
# correctly in every tool.
_SLIDE_NUMBER_MIN_WIDTH = 2


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