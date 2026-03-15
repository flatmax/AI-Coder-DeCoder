"""Document Convert — conversion of Office/PDF/CSV to markdown.

Registered via jrpc-oo as DocConvert.* RPC endpoints.
Converts non-markdown documents to markdown files with provenance headers.
Requires markitdown[all] for basic conversion; PyMuPDF and LibreOffice
for enhanced PDF/presentation pipelines.
"""

import asyncio
import base64
import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from ac_dc.repo import EXCLUDED_DIRS, Repo

logger = logging.getLogger(__name__)

# Provenance header pattern
_PROVENANCE_RE = re.compile(
    r'^<!--\s*docuvert:\s*(.+?)\s*-->', re.MULTILINE
)

# Default supported extensions
_DEFAULT_EXTENSIONS = [
    ".docx", ".pdf", ".pptx", ".xlsx",
    ".csv", ".rtf", ".odt", ".odp",
]

# Image MIME to extension mapping
_MIME_EXT = {
    "png": ".png",
    "jpeg": ".jpg",
    "jpg": ".jpg",
    "gif": ".gif",
    "bmp": ".bmp",
    "tiff": ".tiff",
    "tif": ".tiff",
    "webp": ".webp",
    "svg+xml": ".svg",
    "svg": ".svg",
}

# Significant drawing operations for PDF image detection
_SIGNIFICANT_OPS = {"c", "qu"}  # Bézier curves, quadratic curves


def _sha256_file(path: Path) -> str:
    """Compute SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _parse_provenance(text: str) -> Optional[dict]:
    """Parse a docuvert provenance header from text.

    Returns dict of key=value pairs, or None if no header found.
    """
    m = _PROVENANCE_RE.search(text)
    if not m:
        return None
    raw = m.group(1)
    result = {}
    for part in raw.split():
        if "=" in part:
            key, value = part.split("=", 1)
            result[key] = value
    return result


def _build_md_provenance(source: str, sha256: str,
                         images: Optional[list[str]] = None) -> str:
    """Build a markdown provenance header comment."""
    parts = [f"source={source}", f"sha256={sha256}"]
    if images:
        parts.append(f"images={','.join(images)}")
    return f"<!-- docuvert: {' '.join(parts)} -->"


def _build_svg_provenance(parent: str, source: str, sha256: str,
                          img_index: int) -> str:
    """Build an SVG provenance header comment."""
    return (
        f"<!-- docuvert: parent={parent} source={source} "
        f"sha256={sha256} img_index={img_index} -->"
    )


def _check_markitdown() -> bool:
    """Check if markitdown is importable."""
    try:
        import markitdown  # noqa: F401
        return True
    except ImportError:
        return False


def _check_pymupdf() -> bool:
    """Check if PyMuPDF (fitz) is importable."""
    try:
        import fitz  # noqa: F401
        return True
    except ImportError:
        return False


def _check_libreoffice() -> bool:
    """Check if soffice is on PATH."""
    return shutil.which("soffice") is not None


def _check_python_pptx() -> bool:
    """Check if python-pptx is importable."""
    try:
        import pptx  # noqa: F401
        return True
    except ImportError:
        return False


def _check_openpyxl() -> bool:
    """Check if openpyxl is importable."""
    try:
        import openpyxl  # noqa: F401
        return True
    except ImportError:
        return False


class DocConvert:
    """Document conversion service — exposed via jrpc-oo as DocConvert.* endpoints.

    All public methods (not prefixed with _) are automatically exposed.
    """

    def __init__(self, repo: Repo, config_manager=None):
        self._repo = repo
        self._config = config_manager
        self._event_callback = None
        self._collab = None

    # ── RPC Methods ───────────────────────────────────────────────

    def is_available(self) -> dict:
        """Check availability of conversion dependencies."""
        markitdown = _check_markitdown()
        libreoffice = _check_libreoffice()
        pymupdf = _check_pymupdf()
        return {
            "available": markitdown,
            "libreoffice": libreoffice,
            "pymupdf": pymupdf,
            "pdf_pipeline": libreoffice and pymupdf,
        }

    def scan_convertible_files(self) -> dict:
        """Scan repo for convertible files with status badges.

        Returns {files: [...], clean: bool, message?: str}
        """
        # Clean tree check
        clean = self._repo.is_clean()

        extensions = self._get_extensions()
        max_size = self._get_max_size_bytes()

        files = []
        for rel_path in self._walk_convertible(extensions):
            abs_path = self._repo.root / rel_path
            try:
                size = abs_path.stat().st_size
            except OSError:
                continue

            over_size = size > max_size if max_size > 0 else False
            output_path = self._output_path(rel_path)
            status = self._detect_status(rel_path, abs_path, output_path)

            files.append({
                "path": rel_path,
                "name": Path(rel_path).name,
                "size": size,
                "status": status,
                "output_path": str(output_path) if output_path else None,
                "over_size": over_size,
            })

        return {
            "files": files,
            "clean": clean,
            "message": None if clean else (
                "Commit or stash your changes before converting documents."
            ),
        }

    def convert_files(self, paths: list[str]) -> list[dict]:
        """Convert selected files to markdown.

        Returns list of per-file results.
        Requires clean working tree.
        """
        if self._collab and not self._collab._is_caller_localhost():
            return [{"path": p, "status": "error",
                     "message": "Participants cannot perform this action"}
                    for p in paths]

        if not _check_markitdown():
            return [{"path": p, "status": "error",
                     "message": "markitdown not installed"}
                    for p in paths]

        if not self._repo.is_clean():
            return [{"path": p, "status": "error",
                     "message": "Working tree has uncommitted changes"}
                    for p in paths]

        max_size = self._get_max_size_bytes()
        results = []
        for path in paths:
            abs_path = self._repo.root / path
            if not abs_path.exists():
                results.append({
                    "path": path, "status": "error",
                    "message": f"File not found: {path}",
                })
                continue

            if max_size > 0 and abs_path.stat().st_size > max_size:
                results.append({
                    "path": path, "status": "error",
                    "message": "Exceeds size limit",
                })
                continue

            try:
                result = self._convert_single(path)
                results.append(result)
            except Exception as e:
                logger.warning(f"Conversion failed for {path}: {e}")
                results.append({
                    "path": path, "status": "error",
                    "message": str(e),
                })

        return results

    # ── Internal Conversion ───────────────────────────────────────

    def _convert_single(self, rel_path: str) -> dict:
        """Convert a single file. Returns result dict."""
        abs_path = self._repo.root / rel_path
        ext = abs_path.suffix.lower()
        source_name = abs_path.name
        sha = _sha256_file(abs_path)

        output_rel = self._output_path(rel_path)
        output_abs = self._repo.root / output_rel

        # Create assets subdirectory
        stem = abs_path.stem
        assets_dir_rel = str(Path(rel_path).parent / stem)
        assets_dir_abs = self._repo.root / assets_dir_rel

        # Clean up old images from previous conversion
        self._cleanup_old_images(output_abs, assets_dir_abs)

        # Create assets dir
        assets_dir_abs.mkdir(parents=True, exist_ok=True)

        all_images = []

        # Route by format
        if ext == ".xlsx" and _check_openpyxl():
            md_content = self._extract_xlsx_with_colors(abs_path)
        elif ext == ".pdf" and _check_pymupdf():
            md_content, images = self._convert_pdf_pymupdf(
                abs_path, stem, assets_dir_abs, assets_dir_rel,
            )
            all_images.extend(images)
        elif ext == ".pptx":
            md_content, images = self._convert_pptx(
                abs_path, stem, assets_dir_abs, assets_dir_rel, sha,
            )
            all_images.extend(images)
        else:
            # Default: markitdown
            md_content = self._convert_with_markitdown(abs_path)

        # Extract and save data URI images from markdown output
        if md_content:
            md_content, extracted = self._extract_and_save_images(
                md_content, stem, assets_dir_abs, assets_dir_rel, sha,
            )
            all_images.extend(extracted)

        # Handle DOCX truncated data URIs
        if ext == ".docx":
            docx_images = self._extract_docx_images(abs_path, stem, assets_dir_abs)
            if docx_images:
                md_content = self._replace_truncated_uris(md_content, docx_images,
                                                          assets_dir_rel)
                all_images.extend(docx_images)

        # Remove assets dir if empty
        if assets_dir_abs.exists() and not list(assets_dir_abs.iterdir()):
            assets_dir_abs.rmdir()

        # Build provenance header
        header = _build_md_provenance(
            source_name, sha,
            images=all_images if all_images else None,
        )
        final_content = header + "\n\n" + md_content

        # Write output
        output_abs.parent.mkdir(parents=True, exist_ok=True)
        output_abs.write_text(final_content, encoding="utf-8")

        return {
            "path": rel_path,
            "status": "ok",
            "output_path": str(output_rel),
            "images": all_images,
        }

    def _convert_with_markitdown(self, abs_path: Path) -> str:
        """Convert using markitdown."""
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert(str(abs_path))
        return result.text_content or ""

    def _extract_xlsx_with_colors(self, abs_path: Path) -> str:
        """Extract XLSX with cell background colors as emoji markers."""
        try:
            import openpyxl
        except ImportError:
            return self._convert_with_markitdown(abs_path)

        try:
            wb = openpyxl.load_workbook(str(abs_path), data_only=True)
        except Exception:
            return self._convert_with_markitdown(abs_path)

        # Named color buckets
        _COLOR_NAMES = {
            "red": "🔴", "green": "🟢", "yellow": "🟡",
            "blue": "🔵", "purple": "🟣", "orange": "🟠",
            "brown": "🟤", "white": "⚪",
        }
        _FALLBACK_MARKERS = ["⬛", "◆", "▲", "●", "■", "★"]

        def _hex_to_rgb(hex_color: str) -> Optional[tuple]:
            """Convert hex color to (r, g, b) tuple."""
            h = hex_color.lstrip("#")
            if len(h) == 8:
                h = h[2:]  # Strip alpha
            if len(h) != 6:
                return None
            try:
                return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
            except ValueError:
                return None

        def _is_near_white(rgb: tuple) -> bool:
            return all(c > 240 for c in rgb)

        def _is_near_black(rgb: tuple) -> bool:
            return all(c < 15 for c in rgb)

        def _rgb_distance(a: tuple, b: tuple) -> float:
            return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5

        def _classify_color(rgb: tuple) -> Optional[str]:
            """Classify RGB to a named color bucket."""
            r, g, b = rgb
            hue_map = [
                ("red", (255, 0, 0)),
                ("green", (0, 180, 0)),
                ("yellow", (255, 255, 0)),
                ("blue", (0, 0, 255)),
                ("purple", (128, 0, 128)),
                ("orange", (255, 165, 0)),
                ("brown", (139, 69, 19)),
            ]
            best = None
            best_dist = 120  # threshold
            for name, ref in hue_map:
                d = _rgb_distance(rgb, ref)
                if d < best_dist:
                    best = name
                    best_dist = d
            return best

        # Pass 1: Collect all fills
        all_fills: set[str] = set()
        sheets_data = []

        for ws in wb.worksheets:
            rows_data = []
            for row in ws.iter_rows():
                row_data = []
                for cell in row:
                    val = cell.value
                    fill_hex = None
                    if cell.fill and cell.fill.fgColor and cell.fill.fgColor.rgb:
                        raw = str(cell.fill.fgColor.rgb)
                        if raw and raw != "00000000" and raw.upper() != "NONE":
                            rgb = _hex_to_rgb(raw)
                            if rgb and not _is_near_white(rgb) and not _is_near_black(rgb):
                                fill_hex = raw
                                all_fills.add(fill_hex)
                    row_data.append((val, fill_hex))
                rows_data.append(row_data)
            sheets_data.append((ws.title, rows_data))

        # Build color mapping
        color_map: dict[str, str] = {}
        used_fallbacks: list[str] = []
        clusters: list[tuple[tuple, str]] = []

        for fill_hex in sorted(all_fills):
            rgb = _hex_to_rgb(fill_hex)
            if not rgb:
                continue
            name = _classify_color(rgb)
            if name and _COLOR_NAMES.get(name) not in color_map.values():
                color_map[fill_hex] = _COLOR_NAMES[name]
            else:
                # Cluster by RGB distance
                found_cluster = False
                for c_rgb, c_marker in clusters:
                    if _rgb_distance(rgb, c_rgb) < 40:
                        color_map[fill_hex] = c_marker
                        found_cluster = True
                        break
                if not found_cluster:
                    idx = len(used_fallbacks)
                    if idx < len(_FALLBACK_MARKERS):
                        marker = _FALLBACK_MARKERS[idx]
                    else:
                        marker = f"[{idx + 1}]"
                    used_fallbacks.append(marker)
                    clusters.append((rgb, marker))
                    color_map[fill_hex] = marker

        # Pass 2: Emit markdown
        parts = []
        for sheet_name, rows_data in sheets_data:
            if len(sheets_data) > 1:
                parts.append(f"## {sheet_name}\n")

            if not rows_data:
                continue

            # Find non-empty columns
            max_cols = max(len(r) for r in rows_data) if rows_data else 0
            non_empty_cols = set()
            for row in rows_data:
                for ci, (val, _) in enumerate(row):
                    if val is not None and str(val).strip():
                        non_empty_cols.add(ci)
            if not non_empty_cols:
                continue

            col_indices = sorted(non_empty_cols)

            # Emit table
            table_rows = []
            for row in rows_data:
                cells = []
                all_empty = True
                for ci in col_indices:
                    if ci < len(row):
                        val, fill = row[ci]
                        text = str(val) if val is not None else ""
                        if text.strip():
                            all_empty = False
                        marker = color_map.get(fill, "") if fill else ""
                        if marker:
                            text = f"{marker} {text}" if text else marker
                        cells.append(text)
                    else:
                        cells.append("")
                if not all_empty:
                    table_rows.append(cells)

            if not table_rows:
                continue

            # Header row
            parts.append("| " + " | ".join(table_rows[0]) + " |")
            parts.append("| " + " | ".join("---" for _ in col_indices) + " |")
            for row_cells in table_rows[1:]:
                parts.append("| " + " | ".join(row_cells) + " |")

            parts.append("")

        # Legend
        if color_map:
            parts.append("### Color Legend\n")
            seen = set()
            for fill_hex, marker in sorted(color_map.items(), key=lambda x: x[1]):
                if marker in seen:
                    continue
                seen.add(marker)
                rgb = _hex_to_rgb(fill_hex)
                name = _classify_color(rgb) if rgb else None
                label = name or f"#{fill_hex[-6:]}"
                parts.append(f"- {marker} = {label}")
            parts.append("")

        return "\n".join(parts)

    def _convert_pdf_pymupdf(
        self, abs_path: Path, stem: str,
        assets_dir: Path, assets_dir_rel: str,
    ) -> tuple[str, list[str]]:
        """Convert PDF using PyMuPDF — text extraction + selective SVG export."""
        import fitz

        doc = fitz.open(str(abs_path))
        md_parts = []
        image_files = []

        for page_num in range(len(doc)):
            page = doc[page_num]

            # Extract text
            text = self._extract_page_text(page)

            # Check for significant images/drawings
            has_images = self._page_has_significant_graphics(page)

            if has_images:
                # Export SVG
                svg_name = f"{page_num + 1:02d}_page.svg"
                svg_path = assets_dir / svg_name
                svg_content = page.get_svg_image(text_as_path=0)

                # Externalize embedded images
                svg_content, ext_images = self._externalize_svg_images(
                    svg_content, stem, page_num, assets_dir, assets_dir_rel,
                )
                image_files.extend(ext_images)

                svg_path.write_text(svg_content, encoding="utf-8")
                image_files.append(svg_name)

                if text and text.strip():
                    md_parts.append(text)
                    if ext_images:
                        # Embed raster images directly instead of full-page SVG
                        for img_name in ext_images:
                            img_rel = f"{assets_dir_rel}/{img_name}"
                            md_parts.append(f"![{img_name}]({img_rel})")
                    else:
                        svg_rel = f"{assets_dir_rel}/{svg_name}"
                        md_parts.append(f"![Page {page_num + 1}]({svg_rel})")
                else:
                    svg_rel = f"{assets_dir_rel}/{svg_name}"
                    md_parts.append(f"![Page {page_num + 1}]({svg_rel})")
            else:
                if text and text.strip():
                    md_parts.append(text)

        doc.close()
        return "\n\n".join(md_parts), image_files

    def _extract_page_text(self, page) -> str:
        """Extract readable text from a PDF page as markdown paragraphs."""
        try:
            data = page.get_text("dict")
        except Exception:
            return page.get_text("text") or ""

        paragraphs = []
        for block in data.get("blocks", []):
            if block.get("type") != 0:  # text block
                continue
            lines = []
            for line in block.get("lines", []):
                spans_text = []
                for span in line.get("spans", []):
                    t = span.get("text", "").strip()
                    if t:
                        spans_text.append(t)
                if spans_text:
                    lines.append(" ".join(spans_text))
            if lines:
                paragraphs.append(" ".join(lines))

        return "\n\n".join(paragraphs)

    def _page_has_significant_graphics(self, page) -> bool:
        """Check if a PDF page has significant visual content beyond text."""
        # Raster images
        try:
            if page.get_images():
                return True
        except Exception:
            pass

        # Vector drawings
        try:
            drawings = page.get_drawings()
        except Exception:
            return False

        significant_count = 0
        for d in drawings:
            items = d.get("items", [])
            for item in items:
                op = item[0] if item else ""
                if op in _SIGNIFICANT_OPS:
                    significant_count += 1
                elif op == "l" and len(items) > 4:  # complex path
                    significant_count += 1
                elif op == "re" and d.get("fill"):  # filled rectangle
                    # Only count if part of a complex shape
                    if len(items) > 2:
                        significant_count += 1

        return significant_count >= 3

    def _externalize_svg_images(
        self, svg_content: str, stem: str, page_num: int,
        assets_dir: Path, assets_dir_rel: str,
    ) -> tuple[str, list[str]]:
        """Extract base64 <image> data URIs from SVG and save as files."""
        image_files = []
        counter = 0

        # Match both href and xlink:href
        pattern = re.compile(
            r'((?:xlink:)?href)\s*=\s*"(data:image/([^;]+);base64,([^"]*?))"',
            re.DOTALL,
        )

        def replacer(m):
            nonlocal counter
            attr_name = m.group(1)
            mime_sub = m.group(3)
            b64_data = m.group(4)

            # Strip whitespace from base64
            b64_clean = re.sub(r'\s+', '', b64_data)

            ext = _MIME_EXT.get(mime_sub, ".png")
            counter += 1
            img_name = f"{stem}_img{page_num + 1}_{counter}{ext}"
            img_path = assets_dir / img_name

            try:
                data = base64.b64decode(b64_clean)
                img_path.write_bytes(data)
                image_files.append(img_name)
                return f'{attr_name}="{img_name}"'
            except Exception as e:
                logger.warning(f"Failed to externalize image: {e}")
                return m.group(0)

        result = pattern.sub(replacer, svg_content)
        return result, image_files

    def _convert_pptx(
        self, abs_path: Path, stem: str,
        assets_dir: Path, assets_dir_rel: str, sha: str,
    ) -> tuple[str, list[str]]:
        """Convert PPTX — try PyMuPDF pipeline first, fall back to python-pptx."""
        if _check_libreoffice() and _check_pymupdf():
            return self._convert_pptx_via_pdf(
                abs_path, stem, assets_dir, assets_dir_rel,
            )
        elif _check_python_pptx():
            return self._convert_pptx_direct(
                abs_path, stem, assets_dir, assets_dir_rel, sha,
            )
        else:
            # Fall back to markitdown
            md = self._convert_with_markitdown(abs_path)
            return md, []

    def _convert_pptx_via_pdf(
        self, abs_path: Path, stem: str,
        assets_dir: Path, assets_dir_rel: str,
    ) -> tuple[str, list[str]]:
        """Convert PPTX via LibreOffice → PDF → PyMuPDF."""
        tmp_dir = tempfile.mkdtemp(prefix="ac_dc_pptx_")
        try:
            # Convert to PDF via LibreOffice
            result = subprocess.run(
                ["soffice", "--headless", "--convert-to", "pdf",
                 "--outdir", tmp_dir, str(abs_path)],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0:
                raise RuntimeError(f"LibreOffice conversion failed: {result.stderr[:200]}")

            pdf_path = Path(tmp_dir) / f"{abs_path.stem}.pdf"
            if not pdf_path.exists():
                raise RuntimeError("PDF output not found after LibreOffice conversion")

            return self._convert_pdf_pymupdf(
                pdf_path, stem, assets_dir, assets_dir_rel,
            )
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def _convert_pptx_direct(
        self, abs_path: Path, stem: str,
        assets_dir: Path, assets_dir_rel: str, sha: str,
    ) -> tuple[str, list[str]]:
        """Convert PPTX directly using python-pptx — SVG per slide."""
        try:
            from pptx import Presentation
            from pptx.util import Emu
        except ImportError:
            raise RuntimeError(
                "python-pptx not installed. Install with: pip install ac-dc[docs]"
            )

        prs = Presentation(str(abs_path))
        slide_width = prs.slide_width or Emu(9144000)  # default 10"
        slide_height = prs.slide_height or Emu(6858000)  # default 7.5"

        # Convert EMU to pixels at 96 DPI
        w_px = int(slide_width) * 96 // 914400
        h_px = int(slide_height) * 96 // 914400

        md_parts = []
        image_files = []

        for i, slide in enumerate(prs.slides):
            slide_num = i + 1
            svg_name = f"{slide_num:02d}_slide.svg"
            svg_path = assets_dir / svg_name

            svg = self._render_slide_svg(slide, w_px, h_px)

            # Add provenance
            provenance = _build_svg_provenance(
                f"{stem}.md", abs_path.name, sha, slide_num,
            )
            svg = provenance + "\n" + svg

            svg_path.write_text(svg, encoding="utf-8")
            image_files.append(svg_name)

            svg_rel = f"{assets_dir_rel}/{svg_name}"
            md_parts.append(f"## Slide {slide_num}\n\n![Slide {slide_num}]({svg_rel})")

        return "\n\n".join(md_parts), image_files

    def _render_slide_svg(self, slide, w_px: int, h_px: int) -> str:
        """Render a single PPTX slide as SVG."""
        from pptx.util import Emu

        elements = []
        for shape in slide.shapes:
            left = int(shape.left or 0) * 96 // 914400
            top = int(shape.top or 0) * 96 // 914400
            width = int(shape.width or 0) * 96 // 914400
            height = int(shape.height or 0) * 96 // 914400

            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        # Get font size
                        font_size = 14
                        if para.runs:
                            run = para.runs[0]
                            if run.font and run.font.size:
                                font_size = int(run.font.size) * 96 // 914400

                        # Escape XML
                        text = (text.replace("&", "&amp;")
                                .replace("<", "&lt;").replace(">", "&gt;"))
                        elements.append(
                            f'<text x="{left + 5}" y="{top + font_size + 5}" '
                            f'font-size="{font_size}">{text}</text>'
                        )

            if hasattr(shape, "image") and shape.image:
                try:
                    img_bytes = shape.image.blob
                    content_type = shape.image.content_type or "image/png"
                    b64 = base64.b64encode(img_bytes).decode("ascii")
                    elements.append(
                        f'<image x="{left}" y="{top}" '
                        f'width="{width}" height="{height}" '
                        f'href="data:{content_type};base64,{b64}"/>'
                    )
                except Exception:
                    pass

            if shape.has_table:
                table = shape.table
                row_h = height // max(len(table.rows), 1)
                col_w = width // max(len(table.columns), 1)
                for ri, row in enumerate(table.rows):
                    for ci, cell in enumerate(row.cells):
                        cx = left + ci * col_w
                        cy = top + ri * row_h
                        elements.append(
                            f'<rect x="{cx}" y="{cy}" '
                            f'width="{col_w}" height="{row_h}" '
                            f'fill="none" stroke="#ccc"/>'
                        )
                        text = (cell.text.strip()
                                .replace("&", "&amp;")
                                .replace("<", "&lt;").replace(">", "&gt;"))
                        if text:
                            elements.append(
                                f'<text x="{cx + 3}" y="{cy + 14}" '
                                f'font-size="11">{text}</text>'
                            )

        body = "\n  ".join(elements)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {w_px} {h_px}" '
            f'width="{w_px}" height="{h_px}">\n  {body}\n</svg>'
        )

    def _extract_and_save_images(
        self, md_content: str, stem: str,
        assets_dir: Path, assets_dir_rel: str, sha: str,
    ) -> tuple[str, list[str]]:
        """Extract data URI images from markdown and save as files."""
        image_files = []
        counter = 0

        # Use string scanning (not regex) for data URIs
        result_parts = []
        pos = 0
        while pos < len(md_content):
            # Find next image pattern
            img_start = md_content.find("![", pos)
            if img_start == -1:
                result_parts.append(md_content[pos:])
                break

            # Find the ](
            alt_end = md_content.find("](", img_start)
            if alt_end == -1:
                result_parts.append(md_content[pos:])
                break

            uri_start = alt_end + 2

            # Check if this is a data URI
            if not md_content[uri_start:].startswith("data:image/"):
                result_parts.append(md_content[pos:uri_start])
                pos = uri_start
                continue

            # Find the closing )
            # Can't use simple find because base64 may contain )
            depth = 1
            uri_end = uri_start
            while uri_end < len(md_content) and depth > 0:
                if md_content[uri_end] == "(":
                    depth += 1
                elif md_content[uri_end] == ")":
                    depth -= 1
                uri_end += 1
            uri_end -= 1  # back up to the )

            data_uri = md_content[uri_start:uri_end]

            # Parse MIME type
            try:
                header, b64_data = data_uri.split(",", 1)
                mime_part = header.split(":")[1].split(";")[0]
                mime_sub = mime_part.split("/")[1] if "/" in mime_part else "png"
            except (ValueError, IndexError):
                result_parts.append(md_content[pos:uri_end + 1])
                pos = uri_end + 1
                continue

            ext = _MIME_EXT.get(mime_sub, ".png")
            counter += 1
            img_name = f"{stem}_img{counter}{ext}"
            img_path = assets_dir / img_name

            try:
                img_data = base64.b64decode(b64_data)
                img_path.write_bytes(img_data)
                image_files.append(img_name)

                # Add SVG provenance if SVG
                if ext == ".svg":
                    svg_text = img_data.decode("utf-8", errors="replace")
                    provenance = _build_svg_provenance(
                        f"{stem}.md", f"{stem}{ext}", sha, counter,
                    )
                    img_path.write_text(
                        provenance + "\n" + svg_text, encoding="utf-8",
                    )

                # Replace data URI with file path
                img_rel = f"{assets_dir_rel}/{img_name}"
                result_parts.append(md_content[pos:uri_start])
                result_parts.append(f"{img_rel})")
                pos = uri_end + 1
            except Exception as e:
                logger.warning(f"Failed to extract image: {e}")
                result_parts.append(md_content[pos:uri_end + 1])
                pos = uri_end + 1

        return "".join(result_parts), image_files

    def _extract_docx_images(
        self, abs_path: Path, stem: str, assets_dir: Path,
    ) -> list[str]:
        """Extract images from DOCX zip archive."""
        import zipfile

        image_files = []
        try:
            with zipfile.ZipFile(str(abs_path), "r") as zf:
                media_files = [
                    n for n in zf.namelist()
                    if n.startswith("word/media/")
                ]
                for i, name in enumerate(sorted(media_files), 1):
                    ext = Path(name).suffix.lower()
                    if ext == ".jpeg":
                        ext = ".jpg"
                    img_name = f"{stem}_img{i}{ext}"
                    img_path = assets_dir / img_name
                    data = zf.read(name)
                    img_path.write_bytes(data)
                    image_files.append(img_name)
        except (zipfile.BadZipFile, OSError) as e:
            logger.warning(f"Cannot extract DOCX images: {e}")
            return []

        return image_files

    def _replace_truncated_uris(
        self, md_content: str, image_files: list[str],
        assets_dir_rel: str,
    ) -> str:
        """Replace truncated data URI references with extracted image filenames."""
        img_iter = iter(image_files)

        # Pattern: data:image/...;base64...  (ending with literal ...)
        pattern = re.compile(
            r'data:image/[^;]+;base64\.\.\.'
        )

        def replacer(m):
            try:
                img_name = next(img_iter)
                return f"{assets_dir_rel}/{img_name}"
            except StopIteration:
                return m.group(0)

        return pattern.sub(replacer, md_content)

    def _cleanup_old_images(self, output_abs: Path, assets_dir: Path):
        """Remove images from a previous conversion (listed in provenance header)."""
        if not output_abs.exists():
            return

        try:
            text = output_abs.read_text(encoding="utf-8")
        except OSError:
            return

        prov = _parse_provenance(text)
        if not prov:
            return

        images_str = prov.get("images", "")
        if not images_str:
            return

        for img_name in images_str.split(","):
            img_name = img_name.strip()
            if not img_name:
                continue
            img_path = assets_dir / img_name
            if img_path.exists():
                try:
                    img_path.unlink()
                except OSError:
                    pass

    # ── File Discovery ────────────────────────────────────────────

    def _walk_convertible(self, extensions: set[str]) -> list[str]:
        """Walk repo for files matching configured extensions."""
        files = []
        root = self._repo.root

        for dirpath, dirnames, filenames in os.walk(root):
            # Filter excluded directories
            dirnames[:] = [
                d for d in dirnames
                if d not in EXCLUDED_DIRS
                and not (d.startswith(".") and d != ".github")
            ]

            for fname in filenames:
                ext = Path(fname).suffix.lower()
                if ext in extensions:
                    rel = os.path.relpath(
                        os.path.join(dirpath, fname), root,
                    )
                    rel = rel.replace("\\", "/")
                    files.append(rel)

        return sorted(files)

    def _output_path(self, rel_path: str) -> str:
        """Compute the output .md path for a source file."""
        p = Path(rel_path)
        return str(p.parent / (p.stem + ".md"))

    def _detect_status(self, rel_path: str, abs_path: Path,
                       output_rel: str) -> str:
        """Detect conversion status: new, stale, current, conflict."""
        output_abs = self._repo.root / output_rel
        if not output_abs.exists():
            return "new"

        try:
            text = output_abs.read_text(encoding="utf-8")
        except OSError:
            return "new"

        prov = _parse_provenance(text)
        if not prov:
            return "conflict"

        stored_sha = prov.get("sha256", "")
        if not stored_sha:
            return "conflict"

        current_sha = _sha256_file(abs_path)
        if current_sha == stored_sha:
            return "current"
        return "stale"

    # ── Configuration ─────────────────────────────────────────────

    def _get_extensions(self) -> set[str]:
        """Get configured extensions."""
        if self._config:
            dc = self._config.doc_convert_config
            exts = dc.get("extensions", _DEFAULT_EXTENSIONS)
            return set(exts)
        return set(_DEFAULT_EXTENSIONS)

    def _get_max_size_bytes(self) -> int:
        """Get max source size in bytes."""
        if self._config:
            dc = self._config.doc_convert_config
            mb = dc.get("max_source_size_mb", 50)
            return mb * 1024 * 1024
        return 50 * 1024 * 1024