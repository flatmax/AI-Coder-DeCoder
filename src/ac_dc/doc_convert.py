"""Document Convert — convert non-markdown documents to markdown.

Converts .docx, .pdf, .pptx, .xlsx, .csv, .rtf, .odt, .odp files
to markdown using markitdown (pure Python). Presentation and PDF files
produce per-page SVG exports via headless LibreOffice + PyMuPDF for
full visual fidelity. Images embedded as data URIs are extracted and
saved as separate files.
"""

import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Provenance header pattern
_DOCUVERT_RE = re.compile(r'<!--\s*docuvert:\s*(.+?)\s*-->')

# Default supported extensions
DEFAULT_EXTENSIONS = [
    ".docx", ".pdf", ".pptx", ".xlsx", ".csv",
    ".rtf", ".odt", ".odp",
]

# Directories to skip during scan
_SKIP_DIRS = {
    ".git", ".ac-dc", "node_modules", "__pycache__",
    ".venv", "venv", "dist", "build", ".egg-info",
}

# Regex to match data-URI href/xlink:href in <image> elements.
# Handles both href="data:..." and xlink:href="data:..." with optional
# whitespace around the base64 payload and newlines within it.
_SVG_DATA_URI_RE = re.compile(
    r'((?:xlink:)?href=")\s*data:image/([a-zA-Z0-9.+-]+);base64,\s*([^"]+?)\s*(")',
    re.DOTALL,
)

# Regex matching truncated data-URI image references emitted by markitdown.
# These look like ![alt](data:image/png;base64...) — note the literal "..."
# with no actual base64 payload.
_TRUNCATED_URI_RE = re.compile(
    r'(!\[[^\]]*\]\()data:image/[a-zA-Z0-9.+-]+;base64\.{2,}\)?'
)


def _is_markitdown_available():
    """Check if markitdown is installed."""
    try:
        import markitdown  # noqa: F401
        return True
    except ImportError:
        return False


def _sha256_file(path):
    """Compute SHA-256 hash of a file's contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_provenance(text):
    """Parse a docuvert provenance header from text.

    Returns dict of key=value pairs, or None if no header found.
    Looks at the first 5 lines only.
    """
    for line in text.splitlines()[:5]:
        m = _DOCUVERT_RE.search(line)
        if m:
            raw = m.group(1)
            result = {}
            for part in raw.split():
                if "=" in part:
                    k, v = part.split("=", 1)
                    result[k] = v
            return result
    return None


def _build_provenance_header(source_name, sha256, images=None):
    """Build a markdown provenance header comment.

    Args:
        source_name: filename of the source document
        sha256: hex digest of the source file
        images: optional list of extracted image filenames

    Returns:
        str: HTML comment line
    """
    parts = [f"source={source_name}", f"sha256={sha256}"]
    if images:
        parts.append(f"images={','.join(images)}")
    return f"<!-- docuvert: {' '.join(parts)} -->"


def _build_svg_provenance_header(parent_md, source_name, sha256, img_index):
    """Build an SVG provenance header comment.

    Args:
        parent_md: the .md file this image is linked from
        source_name: original source document filename
        sha256: hex digest of the source file
        img_index: 1-based index of this image

    Returns:
        str: XML comment line
    """
    return (
        f"<!-- docuvert: parent={parent_md} source={source_name} "
        f"sha256={sha256} img_index={img_index} -->"
    )


def _output_path_for(source_path):
    """Compute the sibling .md output path for a source document.

    Args:
        source_path: relative path to the source file

    Returns:
        str: relative path for the converted .md output
    """
    p = Path(source_path)
    return str(p.with_suffix(".md"))


# Extensions that produce per-page/per-slide SVG output instead of markdown
_SVG_EXPORT_EXTENSIONS = {".pptx", ".odp", ".pdf"}

# Extensions handled by the openpyxl colour-aware pipeline
_XLSX_EXTENSIONS = {".xlsx", ".xls"}


def _fill_to_hex(cell):
    """Return the background colour hex of a cell, or None."""
    fill = cell.fill
    if fill is None or fill.patternType in (None, "none"):
        return None
    color = fill.fgColor
    if color is None:
        return None
    if color.type == "rgb" and color.rgb and isinstance(color.rgb, str):
        rgb = color.rgb
        if len(rgb) == 8:
            rgb = rgb[2:]
        if len(rgb) == 6 and rgb != "000000":
            return rgb.lower()
    return None


_COLOR_BUCKETS = [
    (lambda r, g, b: r > 180 and g < 120 and b < 120, "🔴", "red"),
    (lambda r, g, b: r > 180 and g > 100 and g < 170 and b < 80, "🟠", "orange"),
    (lambda r, g, b: r > 180 and g > 170 and b < 120, "🟡", "yellow"),
    (lambda r, g, b: g > 140 and g > r and g > b, "🟢", "green"),
    (lambda r, g, b: b > 140 and b > r and g > 120, "🔵", "light blue"),
    (lambda r, g, b: b > 150 and r < 100 and g < 100, "🔷", "blue"),
    (lambda r, g, b: r > 120 and b > 120 and g < 100, "🟣", "purple"),
]

# Ordered pool of markers for colours that don't match a named bucket.
# Each distinct colour cluster gets the next available marker.
_FALLBACK_MARKERS = ["⬛", "◆", "▲", "●", "■", "★", "◇", "▶"]


def _is_ignorable_fill(hex_rgb):
    """Return True if a hex colour is too close to white or black to mark."""
    if not hex_rgb:
        return True
    try:
        r = int(hex_rgb[0:2], 16)
        g = int(hex_rgb[2:4], 16)
        b = int(hex_rgb[4:6], 16)
    except (ValueError, IndexError):
        return True
    brightness = (r + g + b) / 3
    return brightness > 230 or brightness < 25


def _classify_fill_color(hex_rgb):
    """Map a hex RGB colour to a named-bucket marker and colour name.

    Returns ``(marker, name)`` for well-known hues, or
    ``(None, None)`` for colours that need relative clustering.
    Near-white and near-black fills also return ``(None, None)``.
    """
    if not hex_rgb:
        return None, None
    if _is_ignorable_fill(hex_rgb):
        return None, None
    try:
        r = int(hex_rgb[0:2], 16)
        g = int(hex_rgb[2:4], 16)
        b = int(hex_rgb[4:6], 16)
    except (ValueError, IndexError):
        return None, None
    for test_fn, marker, name in _COLOR_BUCKETS:
        if test_fn(r, g, b):
            return marker, name
    return None, None


def _color_distance(hex_a, hex_b):
    """Euclidean RGB distance between two 6-char hex colours."""
    ra, ga, ba = int(hex_a[0:2], 16), int(hex_a[2:4], 16), int(hex_a[4:6], 16)
    rb, gb, bb = int(hex_b[0:2], 16), int(hex_b[2:4], 16), int(hex_b[4:6], 16)
    return ((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5


def _cluster_colors(hex_set, threshold=40):
    """Group hex colours into clusters by proximity.

    Returns a list of ``(representative_hex, {member_hexes})`` tuples,
    sorted darkest-first so that the most prominent shade gets the
    first marker.
    """
    # Sort by brightness (darkest first) for stable marker assignment
    def _brightness(h):
        return int(h[0:2], 16) + int(h[2:4], 16) + int(h[4:6], 16)

    ordered = sorted(hex_set, key=_brightness)
    clusters = []  # [(rep, {members})]
    for h in ordered:
        placed = False
        for rep, members in clusters:
            if _color_distance(rep, h) < threshold:
                members.add(h)
                placed = True
                break
        if not placed:
            clusters.append((h, {h}))
    return clusters


def _build_color_map(unique_hexes):
    """Build a mapping from hex colour → (marker, legend_description).

    Named-bucket colours (red, green, etc.) keep their emoji marker.
    Remaining colours are clustered by proximity and assigned fallback
    markers so that visually distinct shades get distinct symbols.

    Returns ``{hex_rgb: (marker, description)}``.
    """
    result = {}
    unclustered = set()

    for h in unique_hexes:
        marker, name = _classify_fill_color(h)
        if marker:
            result[h] = (marker, name)
        elif not _is_ignorable_fill(h):
            unclustered.add(h)

    if not unclustered:
        return result

    clusters = _cluster_colors(unclustered)

    # If every unclustered colour lands in one cluster, use a single
    # marker — no need for numbered descriptions.
    for ci, (rep, members) in enumerate(clusters):
        marker = _FALLBACK_MARKERS[ci % len(_FALLBACK_MARKERS)]
        desc = f"#{rep}"
        if len(clusters) > 1 and len(members) > 1:
            desc = f"#{rep} (and similar)"
        for h in members:
            result[h] = (marker, desc)

    return result


def _extract_xlsx_with_colors(abs_path):
    """Read an .xlsx workbook preserving cell background colours.

    Returns markdown with one section per sheet.  Coloured cells get a
    marker emoji.  Empty columns and fully-empty rows are stripped.
    A legend of observed colours is appended.  Returns None if openpyxl
    is not installed or the file cannot be read.

    Uses a two-pass approach: first collects all unique fill colours
    across the entire workbook, clusters visually similar shades, and
    assigns distinct markers per cluster so that e.g. three shades of
    brown each get their own symbol.
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        return None
    try:
        wb = load_workbook(str(abs_path), data_only=True)
    except Exception as e:
        logger.warning("openpyxl failed to open %s: %s", abs_path, e)
        return None

    # --- Pass 1: read all cells, collect text + raw hex fills -----------
    sheet_data = []  # [(title, rows)]  where rows = [[(text, hex|None)]]
    all_hexes = set()

    for ws in wb.worksheets:
        rows_raw = []
        max_col = 0
        for row in ws.iter_rows():
            cells = []
            for cell in row:
                val = cell.value
                text = "" if val is None else str(val).strip()
                if text.lower() in ("nan", "none"):
                    text = ""
                hex_col = _fill_to_hex(cell)
                if hex_col and not _is_ignorable_fill(hex_col):
                    all_hexes.add(hex_col)
                cells.append((text, hex_col))
            rows_raw.append(cells)
            if len(cells) > max_col:
                max_col = len(cells)
        sheet_data.append((ws.title, rows_raw, max_col))

    wb.close()

    # Build a unified colour map across the whole workbook
    color_map = _build_color_map(all_hexes)

    # --- Pass 2: emit markdown using the colour map --------------------
    md_parts = []
    legend = {}

    for title, rows_raw, max_col in sheet_data:
        if not rows_raw or max_col == 0:
            continue

        # Pad rows to uniform width
        for row in rows_raw:
            while len(row) < max_col:
                row.append(("", None))

        # Find columns with any content (text or colour)
        keep_cols = [
            ci for ci in range(max_col)
            if any(row[ci][0] or (row[ci][1] and row[ci][1] in color_map)
                   for row in rows_raw)
        ]
        if not keep_cols:
            continue

        # Apply colour markers and project to kept columns
        rendered_rows = []
        for row in rows_raw:
            rendered = []
            for ci in keep_cols:
                text, hex_col = row[ci]
                if hex_col and hex_col in color_map:
                    marker, desc = color_map[hex_col]
                    legend[marker] = desc
                    text = f"{marker} {text}".strip() if text else marker
                rendered.append(text)
            rendered_rows.append(rendered)

        # Drop fully-empty rows
        rendered_rows = [r for r in rendered_rows if any(c for c in r)]
        if not rendered_rows:
            continue

        md_parts.append(f"## {title}\n")
        header = rendered_rows[0]
        md_parts.append("| " + " | ".join(header) + " |")
        md_parts.append("| " + " | ".join("---" for _ in header) + " |")
        for row in rendered_rows[1:]:
            while len(row) < len(header):
                row.append("")
            md_parts.append("| " + " | ".join(row) + " |")
        md_parts.append("")

    if legend:
        md_parts.append("---\n")
        md_parts.append("**Cell colour legend:**")
        for marker, name in sorted(legend.items(), key=lambda x: x[1]):
            md_parts.append(f"- {marker} = {name}")
        md_parts.append("")

    return "\n".join(md_parts) if md_parts else None


def _is_libreoffice_available():
    """Check if LibreOffice is available on the PATH."""
    for name in ("libreoffice", "soffice"):
        if shutil.which(name):
            return name
    return None


def _libreoffice_to_pdf(source_path, output_dir):
    """Convert a document to PDF using headless LibreOffice.

    Args:
        source_path: absolute path to the source file
        output_dir: directory to write the PDF into

    Returns:
        Path to the generated PDF, or None on failure.
    """
    lo = _is_libreoffice_available()
    if not lo:
        return None

    try:
        result = subprocess.run(
            [
                lo,
                "--headless",
                "--convert-to", "pdf",
                "--outdir", str(output_dir),
                str(source_path),
            ],
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning(
                "LibreOffice PDF conversion failed: %s",
                result.stderr.decode(errors="replace").strip(),
            )
            return None
    except FileNotFoundError:
        logger.warning("LibreOffice not found on PATH")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("LibreOffice conversion timed out")
        return None

    stem = Path(source_path).stem
    pdf_path = Path(output_dir) / f"{stem}.pdf"
    if pdf_path.exists():
        return pdf_path
    # LibreOffice sometimes normalises the name — look for any PDF
    for f in Path(output_dir).glob("*.pdf"):
        return f
    return None




def _pdf_page_has_images(page):
    """Check if a PDF page contains raster images or non-trivial vector graphics.

    Returns True only when there is visual content beyond styled text —
    i.e. embedded raster images, curves, filled shapes, or complex paths.
    Simple lines/rectangles used for borders and underlines are ignored.
    """
    # Check for raster images
    if page.get_images(full=True):
        return True

    # Check for non-trivial vector drawings.
    # get_drawings() returns path dicts for every line, rect, curve, etc.
    # Many PDF generators emit rectangles and lines for borders, table
    # rules, and underlines — we filter those out.
    drawings = page.get_drawings()
    significant = 0
    for d in drawings:
        items = d.get("items", [])
        has_curve = False
        has_fill = d.get("fill") is not None  # filled shape (not just stroked)
        n_points = 0
        for item in items:
            op = item[0]
            if op in ("c", "qu"):
                has_curve = True
                break
            n_points += 1

        if has_curve:
            significant += 1
        elif has_fill and n_points > 2:
            # Filled polygon with > 2 segments — likely a real shape
            significant += 1
        elif n_points > 4:
            # Complex path with many segments
            significant += 1

        # Threshold: a handful of decorative rects/lines is not "images"
        if significant >= 3:
            return True

    return False


def _pdf_extract_page_text(page):
    """Extract structured text from a PDF page as markdown.

    Uses PyMuPDF's text extraction with block/line structure to produce
    readable markdown with paragraph breaks.
    """
    blocks = page.get_text("dict")["blocks"]
    md_parts = []

    for block in blocks:
        if block["type"] != 0:  # 0 = text block
            continue

        block_lines = []
        for line in block.get("lines", []):
            spans_text = []
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if text:
                    spans_text.append(text)
            if spans_text:
                block_lines.append(" ".join(spans_text))

        if block_lines:
            paragraph = " ".join(block_lines)
            md_parts.append(paragraph)

    return "\n\n".join(md_parts)


def _pdf_page_to_svg(page):
    """Convert a single PDF page to an SVG string using PyMuPDF.

    Uses ``text_as_path=0`` so that text is emitted as ``<text>``
    elements rather than decomposed into individual per-character
    font-glyph ``<use>``/``<path>`` elements.  This keeps sentences
    intact and produces much smaller, more readable SVGs.

    The extracted text is also written separately to the companion
    markdown for searchability.

    Args:
        page: a PyMuPDF page object
    """
    return page.get_svg_image(text_as_path=0)


def _pdf_extract_pages(pdf_path):
    """Extract content from each page of a PDF.

    For each page, extracts text as markdown.  Pages that also contain
    images or vector graphics get an SVG export of the full page.

    Args:
        pdf_path: path to the PDF file

    Returns:
        list of dicts per page:
            {"text": str, "svg": str|None, "has_images": bool}
        or None if PyMuPDF is unavailable.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning(
            "PyMuPDF (fitz) is required for PDF conversion. "
            "Install with: pip install pymupdf"
        )
        return None

    pages = []
    try:
        doc = fitz.open(str(pdf_path))
        for page_num, page in enumerate(doc, 1):
            text = _pdf_extract_page_text(page)
            has_images = _pdf_page_has_images(page)
            text_ok = bool(text and text.strip())
            # Text is emitted as <text> elements (text_as_path=0) so
            # sentences stay intact.  The extracted text is also
            # written to the companion markdown for search.
            svg = _pdf_page_to_svg(page) if has_images else None
            # If no text was extracted and no SVG was generated yet,
            # export the full page as SVG so the visual content is
            # preserved.
            if not text_ok and svg is None:
                svg = _pdf_page_to_svg(page)
                if svg and svg.strip():
                    has_images = True
            pages.append({
                "text": text,
                "svg": svg,
                "has_images": has_images,
            })
        doc.close()
    except Exception as e:
        logger.error("PyMuPDF extraction failed: %s", e)
        return None

    return pages


def _should_skip_dir(dirname):
    """Check if a directory should be skipped during scanning."""
    if dirname in _SKIP_DIRS:
        return True
    if dirname.startswith(".") and dirname != ".github":
        return True
    return False


def _externalize_svg_images(svg_text, output_dir, stem, page_index):
    """Extract embedded base64 images from SVG and save as separate files.

    Finds all ``<image>`` elements whose ``href`` or ``xlink:href``
    contains a ``data:image/…;base64,…`` URI, decodes the payload,
    writes each image to *output_dir*, and replaces the data URI in the
    SVG with a relative filename reference.

    Args:
        svg_text: the full SVG string (may contain embedded data URIs)
        output_dir: Path to the directory where image files are saved
        stem: base filename stem used for naming (e.g. ``"04_slide"``)
        page_index: 1-based page/slide index, used in filenames

    Returns:
        (modified_svg_text, saved_filenames) — the SVG with data URIs
        replaced by relative paths, and a list of saved image filenames.
    """
    import base64 as _b64

    ext_map = {
        "png": ".png",
        "jpeg": ".jpg",
        "jpg": ".jpg",
        "gif": ".gif",
        "svg+xml": ".svg",
        "webp": ".webp",
        "bmp": ".bmp",
        "tiff": ".tiff",
    }

    saved = []
    counter = 0

    def _replace_match(m):
        nonlocal counter
        counter += 1
        prefix = m.group(1)       # 'href="' or 'xlink:href="'
        mime_sub = m.group(2)      # e.g. 'png', 'jpeg'
        encoded = m.group(3)       # raw base64 (may contain newlines)
        suffix = m.group(4)        # closing '"'

        # Strip all whitespace from the base64 payload
        clean_data = re.sub(r'\s+', '', encoded)
        try:
            img_bytes = _b64.b64decode(clean_data)
        except Exception as e:
            logger.warning(
                "Failed to decode base64 image %d in %s: %s",
                counter, stem, e,
            )
            return m.group(0)  # leave unchanged

        ext = ext_map.get(mime_sub.lower(), f".{mime_sub.lower()}")
        filename = f"{stem}_img{page_index}_{counter}{ext}"
        out_path = Path(output_dir) / filename

        try:
            out_path.write_bytes(img_bytes)
        except Exception as e:
            logger.warning(
                "Failed to save externalized image %s: %s", filename, e,
            )
            return m.group(0)  # leave unchanged

        logger.info("Externalized embedded image: %s", filename)
        saved.append(filename)
        return f'{prefix}{filename}{suffix}'

    modified = _SVG_DATA_URI_RE.sub(_replace_match, svg_text)
    return modified, saved


def _extract_docx_images(abs_path, output_dir, stem):
    """Extract embedded images from a .docx archive.

    Opens the docx as a zip, finds all files under ``word/media/``,
    and writes them to *output_dir* with sequential names like
    ``stem_img1.png``.

    Args:
        abs_path: Path to the .docx file
        output_dir: directory to write extracted images into
        stem: base filename stem for naming output files

    Returns:
        list of saved filenames in archive order, e.g.
        ``["report_img1.png", "report_img2.jpeg"]``
    """
    import zipfile

    saved = []
    try:
        with zipfile.ZipFile(str(abs_path), "r") as zf:
            media = sorted(
                n for n in zf.namelist()
                if n.startswith("word/media/") and not n.endswith("/")
            )
            for idx, member in enumerate(media, start=1):
                ext = os.path.splitext(member)[1].lower() or ".bin"
                # Normalise common variants
                if ext == ".jpeg":
                    ext = ".jpg"
                filename = f"{stem}_img{idx}{ext}"
                out_path = Path(output_dir) / filename
                try:
                    data = zf.read(member)
                    out_path.write_bytes(data)
                    saved.append(filename)
                    logger.info("Extracted docx image: %s → %s", member, filename)
                except Exception as e:
                    logger.warning("Failed to extract %s: %s", member, e)
    except zipfile.BadZipFile:
        logger.warning("Cannot open %s as a zip — skipping image extraction", abs_path)
    except Exception as e:
        logger.warning("docx image extraction failed for %s: %s", abs_path, e)

    return saved


def _replace_truncated_uris(md_content, image_filenames):
    """Replace truncated data-URI image references with real filenames.

    markitdown emits ``![alt](data:image/png;base64...)`` with a literal
    ``...`` instead of actual base64 data.  This function substitutes each
    such reference with the next filename from *image_filenames*.

    Args:
        md_content: markdown text containing truncated URIs
        image_filenames: ordered list of extracted image filenames

    Returns:
        modified markdown text
    """
    it = iter(image_filenames)

    def _repl(m):
        prefix = m.group(1)  # '![alt]('
        fn = next(it, None)
        if fn is None:
            return m.group(0)  # no more images — leave as-is
        return f"{prefix}{fn})"

    return _TRUNCATED_URI_RE.sub(_repl, md_content)


class DocConvert:
    """RPC service for document conversion.

    Public methods are exposed as DocConvert.method_name RPC endpoints.
    """

    def __init__(self, repo, config_manager):
        """Initialize DocConvert.

        Args:
            repo: Repo instance
            config_manager: ConfigManager instance
        """
        self._repo = repo
        self._config = config_manager
        self._collab = None  # Set by main.py when --collab is passed
        self._event_callback = None  # Set by main.py for progress events

    @property
    def _doc_convert_config(self):
        return self._config.doc_convert_config

    @property
    def available(self):
        """Whether markitdown is installed."""
        return _is_markitdown_available()

    def is_available(self):
        """RPC: Check if doc convert is available."""
        lo = _is_libreoffice_available()
        has_pymupdf = False
        try:
            import fitz  # noqa: F401
            has_pymupdf = True
        except ImportError:
            pass
        return {
            "available": self.available,
            "libreoffice": lo is not None,
            "pymupdf": has_pymupdf,
            "pdf_pipeline": lo is not None and has_pymupdf,
        }

    def scan_convertible_files(self):
        """RPC: Scan repo for convertible files with status badges.

        Returns:
            {
                files: [{path, size, status, output_path}],
                available: bool,
            }
        """
        if not self._repo:
            return {"error": "No repository available"}

        config = self._doc_convert_config
        if not config.get("enabled", True):
            return {
                "files": [],
                "available": self.available,
            }

        extensions = set(config.get("extensions", DEFAULT_EXTENSIONS))
        max_size_mb = config.get("max_source_size_mb", 50)
        max_size_bytes = max_size_mb * 1024 * 1024

        files = []
        root = self._repo.root

        for dirpath, dirnames, filenames in os.walk(root):
            # Filter out skipped directories in-place
            dirnames[:] = [
                d for d in dirnames if not _should_skip_dir(d)
            ]

            rel_dir = os.path.relpath(dirpath, root)
            if rel_dir == ".":
                rel_dir = ""

            for fname in filenames:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in extensions:
                    continue

                rel_path = os.path.join(rel_dir, fname) if rel_dir else fname
                rel_path = rel_path.replace("\\", "/")
                abs_path = os.path.join(dirpath, fname)

                try:
                    size = os.path.getsize(abs_path)
                except OSError:
                    size = 0

                over_size = size > max_size_bytes

                # Determine status
                output_rel = _output_path_for(rel_path)
                output_abs = root / output_rel

                status = self._detect_status(
                    abs_path, output_abs, output_rel
                )

                entry = {
                    "path": rel_path,
                    "size": size,
                    "status": status,
                    "output_path": output_rel,
                    "over_size": over_size,
                }

                files.append(entry)

        # Sort by path
        files.sort(key=lambda f: f["path"])

        lo = _is_libreoffice_available()
        has_pymupdf = False
        try:
            import fitz  # noqa: F401
            has_pymupdf = True
        except ImportError:
            pass

        return {
            "files": files,
            "available": self.available,
            "pdf_pipeline": lo is not None and has_pymupdf,
        }

    def _detect_status(self, source_abs, output_abs, output_rel):
        """Detect conversion status for a source file.

        Returns: "new", "stale", "current", or "conflict"
        """
        if not os.path.exists(output_abs):
            return "new"

        try:
            md_text = Path(output_abs).read_text(errors="replace")
        except OSError:
            return "new"

        prov = _parse_provenance(md_text)
        if not prov:
            return "conflict"

        stored_hash = prov.get("sha256", "")
        if not stored_hash:
            return "conflict"

        try:
            current_hash = _sha256_file(source_abs)
        except OSError:
            return "stale"

        if current_hash == stored_hash:
            return "current"
        return "stale"

    def _check_localhost_only(self):
        """Return error dict if caller is a non-localhost remote, else None."""
        if self._collab and not self._collab._is_caller_localhost():
            return {"error": "restricted", "reason": "Participants cannot perform this action"}
        return None

    def convert_files(self, paths):
        """RPC: Convert selected files to markdown.

        Returns immediately with {status: "started"} and sends per-file
        progress events via _event_callback. The final event contains
        the full summary.

        Args:
            paths: list of relative paths to source documents

        Returns:
            {status: "started", total: int} immediately
        """
        restricted = self._check_localhost_only()
        if restricted:
            return restricted

        if not self._repo:
            return {"error": "No repository available"}

        if not self.available:
            return {"error": "markitdown is not installed. Install with: pip install ac-dc[docs]"}

        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(self._convert_files_background(list(paths)))
            else:
                # Fallback: synchronous conversion (shouldn't happen in normal flow)
                return self._convert_files_sync(list(paths))
        except Exception:
            return self._convert_files_sync(list(paths))

        return {"status": "started", "total": len(paths)}

    async def _convert_files_background(self, paths):
        """Background task: convert files one at a time with progress events."""
        import asyncio
        import traceback
        from concurrent.futures import ThreadPoolExecutor

        config = self._doc_convert_config
        max_size_mb = config.get("max_source_size_mb", 50)
        max_size_bytes = max_size_mb * 1024 * 1024

        root = self._repo.root
        results = []
        converted = 0
        failed = 0
        skipped = 0
        total = len(paths)

        # Use a dedicated single-thread executor so conversion work
        # doesn't compete with the default executor used by the server.
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="docconv")

        try:
            for i, rel_path in enumerate(paths, start=1):
                abs_path = root / rel_path
                output_rel = _output_path_for(rel_path)
                output_abs = root / output_rel

                # Send "converting" progress event
                try:
                    await self._send_convert_event({
                        "stage": "converting",
                        "path": rel_path,
                        "index": i,
                        "total": total,
                    })
                except Exception:
                    pass

                result_entry = None

                # Validate path
                try:
                    self._repo._resolve_path(rel_path)
                except ValueError as e:
                    result_entry = {
                        "path": rel_path,
                        "status": "failed",
                        "error": str(e),
                    }
                    failed += 1

                # Check existence
                if result_entry is None and not abs_path.exists():
                    result_entry = {
                        "path": rel_path,
                        "status": "failed",
                        "error": "File not found",
                    }
                    failed += 1

                # Check size
                if result_entry is None:
                    try:
                        size = abs_path.stat().st_size
                    except OSError:
                        size = 0

                    if size > max_size_bytes:
                        result_entry = {
                            "path": rel_path,
                            "status": "skipped",
                            "error": f"File exceeds {max_size_mb}MB limit",
                        }
                        skipped += 1

                # Convert
                if result_entry is None:
                    try:
                        loop = asyncio.get_event_loop()
                        result_entry = await loop.run_in_executor(
                            executor,
                            lambda rp=rel_path, ap=abs_path, orel=output_rel, oabs=output_abs:
                                self._convert_single(rp, ap, orel, oabs),
                        )
                        if result_entry["status"] == "converted":
                            converted += 1
                        else:
                            failed += 1
                    except Exception as e:
                        logger.error("Conversion failed for %s: %s\n%s", rel_path, e, traceback.format_exc())
                        result_entry = {
                            "path": rel_path,
                            "status": "failed",
                            "error": str(e),
                        }
                        failed += 1

                results.append(result_entry)

                # Send per-file result event
                try:
                    await self._send_convert_event({
                        "stage": "file_done",
                        "path": rel_path,
                        "index": i,
                        "total": total,
                        "result": result_entry,
                    })
                except Exception:
                    pass

                # Yield to event loop so WebSocket frames flush
                await asyncio.sleep(0.1)
        except Exception as e:
            logger.error("_convert_files_background crashed: %s\n%s", e, traceback.format_exc())
        finally:
            executor.shutdown(wait=False)

        # Send final summary event
        summary = {
            "converted": converted,
            "failed": failed,
            "skipped": skipped,
        }
        try:
            await self._send_convert_event({
                "stage": "complete",
                "results": results,
                "summary": summary,
            })
        except Exception as e:
            logger.error("Failed to send final convert event: %s", e)

    async def _send_convert_event(self, data):
        """Send a doc convert progress event to all clients."""
        if self._event_callback:
            try:
                await self._event_callback("docConvertProgress", data)
            except Exception as e:
                logger.warning(f"Failed to send convert progress event: {e}")

    def _convert_files_sync(self, paths):
        """Synchronous fallback for convert_files (no event loop available)."""
        config = self._doc_convert_config
        max_size_mb = config.get("max_source_size_mb", 50)
        max_size_bytes = max_size_mb * 1024 * 1024

        root = self._repo.root
        results = []
        converted = 0
        failed = 0
        skipped = 0

        for rel_path in paths:
            abs_path = root / rel_path
            output_rel = _output_path_for(rel_path)
            output_abs = root / output_rel

            # Validate path
            try:
                self._repo._resolve_path(rel_path)
            except ValueError as e:
                results.append({
                    "path": rel_path,
                    "status": "failed",
                    "error": str(e),
                })
                failed += 1
                continue

            # Check existence
            if not abs_path.exists():
                results.append({
                    "path": rel_path,
                    "status": "failed",
                    "error": "File not found",
                })
                failed += 1
                continue

            # Check size
            try:
                size = abs_path.stat().st_size
            except OSError:
                size = 0

            if size > max_size_bytes:
                results.append({
                    "path": rel_path,
                    "status": "skipped",
                    "error": f"File exceeds {max_size_mb}MB limit",
                })
                skipped += 1
                continue

            # Convert
            try:
                result = self._convert_single(
                    rel_path, abs_path, output_rel, output_abs
                )
                results.append(result)
                if result["status"] == "converted":
                    converted += 1
                else:
                    failed += 1
            except Exception as e:
                logger.error(f"Conversion failed for {rel_path}: {e}")
                results.append({
                    "path": rel_path,
                    "status": "failed",
                    "error": str(e),
                })
                failed += 1

        return {
            "results": results,
            "summary": {
                "converted": converted,
                "failed": failed,
                "skipped": skipped,
            },
        }

    def _convert_single(self, rel_path, abs_path, output_rel, output_abs):
        """Convert a single file.

        Returns dict with {path, status, output_path, images?}
        """
        ext = os.path.splitext(rel_path)[1].lower()
        source_name = os.path.basename(rel_path)
        source_hash = _sha256_file(abs_path)

        # Clean up old orphan images if re-converting
        old_images = self._get_old_images(output_abs)

        # Presentation and PDF formats → per-page SVG export
        if ext in _SVG_EXPORT_EXTENSIONS:
            return self._convert_presentation_to_svgs(
                rel_path, abs_path, output_rel, output_abs,
                source_name, source_hash, ext,
            )

        # Spreadsheets: try colour-aware extraction first
        md_content = None
        if ext in _XLSX_EXTENSIONS:
            md_content = _extract_xlsx_with_colors(abs_path)
            if md_content:
                logger.info("Used colour-aware extraction for %s", rel_path)

        # Fallback to markitdown for all formats
        if md_content is None:
            md_content = self._convert_with_markitdown(abs_path)

        if md_content is None:
            return {
                "path": rel_path,
                "status": "failed",
                "error": "Conversion produced no output",
            }

        # Create a subdirectory named after the stem for all associated
        # images and auxiliary files (mirrors presentation/PDF behaviour).
        stem = Path(rel_path).stem
        output_dir = output_abs.parent
        output_dir.mkdir(parents=True, exist_ok=True)
        assets_dir = output_dir / stem
        assets_dir.mkdir(parents=True, exist_ok=True)

        # For .docx files, extract real images from the zip archive and
        # replace markitdown's truncated data-URI placeholders.
        docx_image_names = []
        if ext == ".docx":
            raw_docx_names = _extract_docx_images(
                abs_path, assets_dir, stem,
            )
            # Prefix with subdirectory so markdown links resolve correctly
            docx_image_names = [f"{stem}/{n}" for n in raw_docx_names]
            if docx_image_names:
                md_content = _replace_truncated_uris(md_content, docx_image_names)

        # Extract and save images from the conversion result (real
        # base64 data URIs only — truncated ones were already handled).
        images = self._extract_and_save_images(
            md_content, rel_path, abs_path, source_name, source_hash,
            assets_dir=assets_dir,
        )
        image_names = docx_image_names + [img["filename"] for img in images]

        # Replace remaining real data URIs with saved file paths
        md_content = self._replace_data_uris(md_content, images)

        # Build provenance header
        header = _build_provenance_header(source_name, source_hash, image_names or None)

        # Write output
        full_content = header + "\n\n" + md_content
        output_abs.write_text(full_content)

        # Clean up orphan images from previous conversion
        if old_images:
            new_image_set = set(image_names)
            for old_img in old_images:
                if old_img not in new_image_set:
                    old_img_path = output_abs.parent / old_img
                    if old_img_path.exists():
                        try:
                            old_img_path.unlink()
                            logger.info(f"Removed orphan image: {old_img}")
                        except OSError:
                            pass

        # Remove the assets subdirectory if it ended up empty
        try:
            if assets_dir.exists() and not any(assets_dir.iterdir()):
                assets_dir.rmdir()
        except OSError:
            pass

        logger.info(f"Converted {rel_path} → {output_rel}")

        result = {
            "path": rel_path,
            "status": "converted",
            "output_path": output_rel,
        }
        if image_names:
            result["images"] = image_names
        return result

    def _convert_to_svgs_via_pdf(self, abs_path):
        """Convert a document to SVG pages via LibreOffice PDF + PyMuPDF.

        Returns a list of SVG strings, or None if the pipeline is unavailable.
        """
        pages = self._extract_pdf_pages(abs_path)
        if pages is None:
            return None
        # Legacy interface: return just the SVG strings for each page.
        # Pages without images get a full SVG export as fallback.
        svgs = []
        for page in pages:
            if page["svg"]:
                svgs.append(page["svg"])
            else:
                # Text-only page — still need an SVG for the slide-based flow
                svgs.append(page.get("svg") or "")
        return svgs if any(svgs) else None

    def _extract_pdf_pages(self, abs_path):
        """Extract structured content from a PDF via LibreOffice + PyMuPDF.

        Returns a list of page dicts from _pdf_extract_pages, or None.
        """
        tmpdir = None
        try:
            tmpdir = tempfile.mkdtemp(prefix="docuvert_")

            ext = abs_path.suffix.lower()
            if ext == ".pdf":
                pdf_path = abs_path
            else:
                pdf_path = _libreoffice_to_pdf(abs_path, tmpdir)
                if pdf_path is None:
                    return None

            return _pdf_extract_pages(pdf_path)
        finally:
            if tmpdir:
                try:
                    shutil.rmtree(tmpdir, ignore_errors=True)
                except Exception:
                    pass

    def _convert_presentation_to_svgs(self, rel_path, abs_path, output_rel,
                                       output_abs, source_name, source_hash, ext):
        """Convert a presentation/PDF to markdown with optional SVG images.

        Pipeline: source → LibreOffice → PDF → PyMuPDF → text + SVGs.

        Text-only pages become markdown paragraphs in the output .md file.
        Pages with images/vector graphics also get an SVG export that is
        linked from the markdown.

        Falls back to python-pptx for .pptx if LibreOffice/PyMuPDF unavailable.

        Returns dict with {path, status, output_path, images?}
        """
        # Try the hybrid text+SVG pipeline first
        pages = self._extract_pdf_pages(abs_path)

        # Fallback for .pptx if the PDF pipeline is not available
        if not pages and ext == ".pptx":
            logger.info(
                "PDF pipeline unavailable, falling back to python-pptx "
                "for %s", rel_path,
            )
            slides = self._extract_pptx_slides(abs_path)
            if slides:
                # Wrap in page dicts for unified handling below
                pages = [
                    {"text": "", "svg": svg, "has_images": True}
                    for svg in slides
                ]

        # Fallback for .odp — try markitdown
        if not pages and ext == ".odp":
            md_content = self._convert_with_markitdown(abs_path)
            if md_content is None:
                return {
                    "path": rel_path,
                    "status": "failed",
                    "error": "Conversion produced no output",
                }
            header = _build_provenance_header(source_name, source_hash)
            output_abs.parent.mkdir(parents=True, exist_ok=True)
            output_abs.write_text(header + "\n\n" + md_content)
            return {
                "path": rel_path,
                "status": "converted",
                "output_path": output_rel,
            }

        # For .pdf with no pipeline, return error
        if not pages:
            return {
                "path": rel_path,
                "status": "failed",
                "error": (
                    "PDF conversion requires PyMuPDF. "
                    "Install with: pip install pymupdf"
                ),
            }

        output_dir = output_abs.parent
        output_dir.mkdir(parents=True, exist_ok=True)
        stem = Path(rel_path).stem

        # Create subdirectory for page SVGs (only if needed)
        slides_dir = output_dir / stem
        has_any_svg = any(p["svg"] for p in pages)
        if has_any_svg:
            slides_dir.mkdir(parents=True, exist_ok=True)

        # Zero-pad page numbers based on total count
        n_pages = len(pages)
        n_digits = len(str(n_pages))
        page_label = "slide" if ext in (".pptx", ".odp") else "page"
        heading_label = "Slide" if ext in (".pptx", ".odp") else "Page"

        svg_filenames = []
        ext_image_filenames = []
        md_lines = []

        for i, page_data in enumerate(pages, start=1):
            padded = str(i).zfill(n_digits)
            text = page_data.get("text", "").strip()
            svg = page_data.get("svg")

            md_lines.append(f"## {heading_label} {padded}")
            md_lines.append("")

            # Add extracted text as markdown
            if text:
                md_lines.append(text)
                md_lines.append("")

            # Add SVG image link for pages with graphics
            if svg:
                filename = f"{padded}_{page_label}.svg"
                rel_filename = f"{stem}/{filename}"
                svg_path = slides_dir / filename

                # Externalize embedded base64 images before writing
                svg_stem = Path(filename).stem
                svg, ext_images = _externalize_svg_images(
                    svg, slides_dir, svg_stem, i,
                )
                for img_fn in ext_images:
                    ext_image_filenames.append(f"{stem}/{img_fn}")

                prov = _build_svg_provenance_header(
                    f"{stem}.md", source_name, source_hash, i,
                )
                svg_path.write_text(prov + "\n" + svg)
                svg_filenames.append(rel_filename)

                # When a page has both readable text and externalized
                # raster images, embed those images directly instead of
                # the full-page SVG (which duplicates the text visually).
                # Fall back to the full-page SVG when there is no text
                # or no externalized images.
                if text and ext_images:
                    for img_fn in ext_images:
                        img_label = Path(img_fn).stem
                        md_lines.append(f"![{img_label}]({stem}/{img_fn})")
                        md_lines.append("")
                else:
                    md_lines.append(f"![{heading_label} {padded}]({rel_filename})")
                    md_lines.append("")
                logger.info(f"Saved {page_label} {i}: {rel_filename}")

        # Build final markdown with provenance header
        all_image_filenames = svg_filenames + ext_image_filenames
        header = _build_provenance_header(
            source_name, source_hash, all_image_filenames or None,
        )
        full_md = header + "\n\n" + f"# {stem}\n\n" + "\n".join(md_lines)
        output_abs.write_text(full_md)

        svg_count = len(svg_filenames)
        text_only = n_pages - svg_count
        ext_count = len(ext_image_filenames)
        logger.info(
            f"Converted {rel_path} → {output_rel} "
            f"({n_pages} {page_label}s: {text_only} text-only, "
            f"{svg_count} with images, {ext_count} externalized)"
        )

        result = {
            "path": rel_path,
            "status": "converted",
            "output_path": output_rel,
        }
        if all_image_filenames:
            result["images"] = all_image_filenames
        return result

    def _extract_pptx_slides(self, abs_path):
        """Extract slides from a .pptx file as SVG strings.

        Uses python-pptx to read shapes and render them into SVG.
        Returns a list of SVG strings, one per slide.
        """
        try:
            from pptx import Presentation
            from pptx.util import Emu
        except ImportError:
            logger.error(
                "python-pptx is required for PPTX slide export. "
                "Install with: pip install python-pptx"
            )
            raise RuntimeError(
                "python-pptx not installed. Install with: pip install ac-dc[docs]"
            )

        import base64

        prs = Presentation(str(abs_path))
        slide_width = prs.slide_width or Emu(9144000)   # default 10"
        slide_height = prs.slide_height or Emu(6858000)  # default 7.5"
        w_px = int(slide_width / 914400 * 96)  # EMU → pixels at 96 DPI
        h_px = int(slide_height / 914400 * 96)

        svgs = []
        for slide_num, slide in enumerate(prs.slides, start=1):
            elements = []
            elements.append(
                f'<svg xmlns="http://www.w3.org/2000/svg"'
                f' xmlns:xlink="http://www.w3.org/1999/xlink"'
                f' width="{w_px}" height="{h_px}"'
                f' viewBox="0 0 {w_px} {h_px}">'
            )
            # White background
            elements.append(
                f'  <rect width="{w_px}" height="{h_px}" fill="white"/>'
            )

            for shape in slide.shapes:
                x = int(shape.left / 914400 * 96) if shape.left else 0
                y = int(shape.top / 914400 * 96) if shape.top else 0
                sw = int(shape.width / 914400 * 96) if shape.width else 0
                sh = int(shape.height / 914400 * 96) if shape.height else 0

                # Image shapes
                if shape.shape_type is not None and hasattr(shape, "image"):
                    try:
                        img_bytes = shape.image.blob
                        content_type = shape.image.content_type or "image/png"
                        b64 = base64.b64encode(img_bytes).decode("ascii")
                        elements.append(
                            f'  <image x="{x}" y="{y}"'
                            f' width="{sw}" height="{sh}"'
                            f' href="data:{content_type};base64,{b64}"/>'
                        )
                        continue
                    except Exception:
                        pass

                # Text shapes
                if shape.has_text_frame:
                    self._render_text_frame_to_svg(
                        shape.text_frame, x, y, sw, sh, elements,
                    )

                # Table shapes
                if shape.has_table:
                    self._render_table_to_svg(
                        shape.table, x, y, sw, sh, elements,
                    )

            elements.append("</svg>")
            svgs.append("\n".join(elements))

        return svgs

    def _render_text_frame_to_svg(self, text_frame, x, y, w, h, elements):
        """Render a text frame's paragraphs into SVG text elements."""
        if not text_frame.paragraphs:
            return

        # Estimate line height from shape height and paragraph count
        n_paras = len(text_frame.paragraphs)
        line_height = max(16, min(h / max(n_paras, 1), 40))
        current_y = y + line_height  # start below top edge

        for para in text_frame.paragraphs:
            text = para.text.strip()
            if not text:
                current_y += line_height * 0.5
                continue

            # Determine font properties from first run
            font_size = 14
            font_weight = "normal"
            font_color = "#333333"
            if para.runs:
                run = para.runs[0]
                if run.font.size:
                    font_size = int(run.font.size / 914400 * 96)
                    font_size = max(8, min(font_size, 72))
                if run.font.bold:
                    font_weight = "bold"
                try:
                    if run.font.color and run.font.color.rgb:
                        font_color = f"#{run.font.color.rgb}"
                except AttributeError:
                    pass

            # Determine text anchor from alignment
            anchor = "start"
            tx = x + 4
            try:
                from pptx.enum.text import PP_ALIGN
                if para.alignment == PP_ALIGN.CENTER:
                    anchor = "middle"
                    tx = x + w // 2
                elif para.alignment == PP_ALIGN.RIGHT:
                    anchor = "end"
                    tx = x + w - 4
            except (ImportError, AttributeError):
                pass

            escaped = self._escape_svg_text(text)
            elements.append(
                f'  <text x="{tx}" y="{int(current_y)}"'
                f' font-size="{font_size}" font-weight="{font_weight}"'
                f' fill="{font_color}" text-anchor="{anchor}"'
                f' font-family="sans-serif">{escaped}</text>'
            )
            current_y += line_height

    def _render_table_to_svg(self, table, x, y, w, h, elements):
        """Render a table into SVG rect/text elements."""
        n_rows = len(table.rows)
        n_cols = len(table.columns)
        if n_rows == 0 or n_cols == 0:
            return

        row_h = h / n_rows
        col_w = w / n_cols

        for ri, row in enumerate(table.rows):
            for ci, cell in enumerate(row.cells):
                cx = x + int(ci * col_w)
                cy = y + int(ri * row_h)
                cw = int(col_w)
                ch = int(row_h)

                # Cell border
                elements.append(
                    f'  <rect x="{cx}" y="{cy}"'
                    f' width="{cw}" height="{ch}"'
                    f' fill="none" stroke="#cccccc" stroke-width="1"/>'
                )

                # Cell text
                text = cell.text.strip()
                if text:
                    font_size = max(8, min(int(row_h * 0.5), 14))
                    escaped = self._escape_svg_text(text)
                    elements.append(
                        f'  <text x="{cx + 4}" y="{cy + int(row_h * 0.65)}"'
                        f' font-size="{font_size}" fill="#333333"'
                        f' font-family="sans-serif">{escaped}</text>'
                    )

    @staticmethod
    def _escape_svg_text(text):
        """Escape text for safe SVG embedding."""
        return (
            text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )

    def _convert_with_markitdown(self, abs_path):
        """Convert a file using markitdown.

        Returns the markdown text, or None on failure.
        """
        try:
            from markitdown import MarkItDown

            converter = MarkItDown()
            result = converter.convert(str(abs_path))
            return result.text_content if result else None
        except Exception as e:
            logger.error(f"markitdown conversion failed: {e}")
            raise

    def _extract_and_save_images(self, md_content, rel_path, abs_path,
                                  source_name, source_hash,
                                  assets_dir=None):
        """Extract images from conversion output and save them.

        Handles two cases:
        1. Data URIs (base64-encoded) — decoded and saved as files
        2. File references — verified to exist on disk

        Truncated data URIs (ending with literal ``...``) are skipped —
        those are handled by ``_replace_truncated_uris`` instead.

        Args:
            assets_dir: optional Path to the subdirectory for saving images.
                If provided, images are saved there and filenames are prefixed
                with the subdirectory name so markdown links resolve correctly.

        Returns a list of {filename, path, source} dicts where *source*
        is ``"data_uri"`` or ``"file"``.
        """
        import base64

        images = []
        output_dir = assets_dir if assets_dir else Path(abs_path).parent
        stem = Path(rel_path).stem

        # Extract data URI images by finding ![...]( then scanning for
        # the matching close paren.  We cannot use a simple regex because
        # base64 data may contain characters that confuse greedy/lazy
        # quantifiers across very long strings.
        data_uri_index = 0
        search_start = 0
        while True:
            marker = md_content.find("![", search_start)
            if marker == -1:
                break
            paren_open = md_content.find("](", marker)
            if paren_open == -1:
                break
            uri_start = paren_open + 2
            # Check if this is a data URI
            if not md_content[uri_start:uri_start + 11].startswith("data:image/"):
                search_start = uri_start
                continue
            # Find the closing paren — scan for the first ')' that follows
            # the base64 payload.  Base64 never contains ')'.
            paren_close = md_content.find(")", uri_start)
            if paren_close == -1:
                search_start = uri_start
                continue
            data_uri = md_content[uri_start:paren_close]

            # Skip truncated URIs emitted by markitdown (literal "...")
            if data_uri.endswith("...") and ";base64," not in data_uri:
                search_start = paren_close + 1
                continue

            data_uri_index += 1
            logger.debug(
                f"Found data URI image {data_uri_index}: "
                f"{data_uri[:60]}... ({len(data_uri)} chars)"
            )
            saved = self._save_data_uri_image(
                data_uri, output_dir, stem, data_uri_index,
                source_name, source_hash,
            )
            if saved:
                saved["source"] = "data_uri"
                # Prefix with subdirectory name so markdown links resolve
                if assets_dir:
                    saved["filename"] = f"{stem}/{saved['filename']}"
                images.append(saved)
            search_start = paren_close + 1

        if data_uri_index > 0:
            logger.info(
                f"Found {data_uri_index} data URI images, "
                f"saved {len(images)}"
            )

        # File-referenced images (non-data-URI)
        file_img_re = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
        parent_dir = Path(abs_path).parent
        for m in file_img_re.finditer(md_content):
            img_path = m.group(2)

            if img_path.startswith(("data:", "http://", "https://")):
                continue

            # Check in the assets subdirectory first, then the parent dir
            full_img = output_dir / img_path
            if not full_img.exists():
                full_img = parent_dir / img_path
            if full_img.exists():
                images.append({
                    "filename": os.path.basename(img_path),
                    "path": img_path,
                    "source": "file",
                })

        return images

    def _save_data_uri_image(self, data_uri, output_dir, stem, index,
                              source_name, source_hash):
        """Decode a data URI and save it as an image file.

        Args:
            data_uri: the full data:... URI string
            output_dir: directory to write the image file
            stem: base name for the output file (from the source document)
            index: 1-based image index
            source_name: original source filename (for SVG provenance)
            source_hash: SHA-256 of the source file (for SVG provenance)

        Returns:
            {filename, path} dict, or None on failure
        """
        import base64

        # Parse data URI: data:[<mediatype>][;base64],<data>
        match = re.match(
            r'data:image/([a-zA-Z0-9.+-]+)(?:;base64)?,(.+)',
            data_uri,
            re.DOTALL,
        )
        if not match:
            logger.warning(f"Could not parse data URI for image {index}")
            return None

        mime_subtype = match.group(1).lower()
        encoded_data = match.group(2)

        # Strip whitespace — markitdown may wrap long base64 with newlines
        clean_data = re.sub(r'\s+', '', encoded_data)
        try:
            img_bytes = base64.b64decode(clean_data)
        except Exception as e:
            logger.warning(f"Failed to decode base64 image {index}: {e}")
            return None

        # Map MIME subtype to file extension
        ext_map = {
            "png": ".png",
            "jpeg": ".jpg",
            "jpg": ".jpg",
            "gif": ".gif",
            "svg+xml": ".svg",
            "webp": ".webp",
            "bmp": ".bmp",
            "tiff": ".tiff",
        }
        ext = ext_map.get(mime_subtype, f".{mime_subtype}")

        # Save raster images in their native format
        if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"):
            filename = f"{stem}_img{index}{ext}"
            out_path = output_dir / filename
            try:
                out_path.write_bytes(img_bytes)
                logger.info(f"Saved raster image: {filename}")
                return {"filename": filename, "path": filename}
            except Exception as e:
                logger.warning(f"Failed to save raster image {index}: {e}")
                return None

        # Native SVG — save directly
        filename = f"{stem}_img{index}.svg"
        out_path = output_dir / filename
        try:
            # Inject provenance comment for SVG
            svg_text = img_bytes.decode("utf-8", errors="replace")
            parent_md = f"{stem}.md"
            prov = _build_svg_provenance_header(
                parent_md, source_name, source_hash, index,
            )
            svg_text = prov + "\n" + svg_text
            out_path.write_text(svg_text)
            logger.info(f"Saved SVG image: {filename}")
            return {"filename": filename, "path": filename}
        except Exception as e:
            logger.warning(f"Failed to save SVG image {index}: {e}")
            return None

    def _replace_data_uris(self, md_content, images):
        """Replace data URI image references in markdown with saved file paths.

        Uses string scanning (not regex) to match data URIs reliably,
        same approach as _extract_and_save_images.
        """
        # Filter to only images that were actually saved from data URIs
        # (file-referenced images don't need replacement)
        data_uri_images = [
            img for img in images
            if img.get("source") == "data_uri"
        ]
        if not data_uri_images:
            return md_content

        result = []
        idx = 0
        search_start = 0

        while True:
            marker = md_content.find("![", search_start)
            if marker == -1:
                break
            paren_open = md_content.find("](", marker)
            if paren_open == -1:
                break
            uri_start = paren_open + 2
            if not md_content[uri_start:uri_start + 11].startswith("data:image/"):
                search_start = uri_start
                continue
            paren_close = md_content.find(")", uri_start)
            if paren_close == -1:
                search_start = uri_start
                continue

            # Append everything before the URI (including "![alt](")
            result.append(md_content[search_start:uri_start])

            # Replace data URI with filename
            if idx < len(data_uri_images):
                result.append(data_uri_images[idx]["filename"])
                idx += 1
            else:
                # No more saved images — keep original
                result.append(md_content[uri_start:paren_close])

            search_start = paren_close

        # Append remainder
        result.append(md_content[search_start:])
        return "".join(result)

    def _get_old_images(self, output_abs):
        """Get list of image filenames from an existing output's provenance header."""
        if not output_abs.exists():
            return []
        try:
            text = output_abs.read_text(errors="replace")
        except OSError:
            return []
        prov = _parse_provenance(text)
        if not prov:
            return []
        images_str = prov.get("images", "")
        if not images_str:
            return []
        return [img.strip() for img in images_str.split(",") if img.strip()]