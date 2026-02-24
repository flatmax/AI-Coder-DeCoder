"""Document Convert — convert non-markdown documents to markdown.

Converts .docx, .pdf, .pptx, .xlsx, .csv, .rtf, .odt, .odp files
to markdown using markitdown (pure Python). PPTX files produce per-slide
SVG exports via python-pptx. Images embedded as data URIs are extracted
and saved as separate files. Requires a clean git working tree.
"""

import hashlib
import logging
import os
import re
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
_SVG_EXPORT_EXTENSIONS = {".pptx", ".odp"}


def _should_skip_dir(dirname):
    """Check if a directory should be skipped during scanning."""
    if dirname in _SKIP_DIRS:
        return True
    if dirname.startswith(".") and dirname != ".github":
        return True
    return False


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

    @property
    def _doc_convert_config(self):
        return self._config.doc_convert_config

    @property
    def available(self):
        """Whether markitdown is installed."""
        return _is_markitdown_available()

    def is_available(self):
        """RPC: Check if doc convert is available."""
        return {
            "available": self.available,
        }

    def scan_convertible_files(self):
        """RPC: Scan repo for convertible files with status badges.

        Returns:
            {
                clean: bool,
                clean_message: str | None,
                files: [{path, size, status, output_path}],
                available: bool,
                pypandoc_available: bool,
            }
        """
        if not self._repo:
            return {"error": "No repository available"}

        # Check clean working tree
        is_clean = self._repo.is_clean()
        clean_msg = None
        if not is_clean:
            clean_msg = (
                "Commit or stash your changes before converting documents."
            )

        config = self._doc_convert_config
        if not config.get("enabled", True):
            return {
                "clean": is_clean,
                "clean_message": clean_msg,
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

        return {
            "clean": is_clean,
            "clean_message": clean_msg,
            "files": files,
            "available": self.available,
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

    def convert_files(self, paths):
        """RPC: Convert selected files to markdown.

        Args:
            paths: list of relative paths to source documents

        Returns:
            {
                results: [{path, status, output_path, error?, images?}],
                summary: {converted, failed, skipped}
            }
        """
        if not self._repo:
            return {"error": "No repository available"}

        # Verify clean tree first — this gate applies regardless of tooling
        if not self._repo.is_clean():
            return {
                "error": "Working tree has uncommitted changes. "
                         "Commit or stash changes before converting."
            }

        if not self.available:
            return {"error": "markitdown is not installed. Install with: pip install ac-dc[docs]"}

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

        # Presentation formats → per-slide SVG export
        if ext in _SVG_EXPORT_EXTENSIONS:
            return self._convert_presentation_to_svgs(
                rel_path, abs_path, output_rel, output_abs,
                source_name, source_hash, ext,
            )

        # Convert using markitdown
        md_content = self._convert_with_markitdown(abs_path)

        if md_content is None:
            return {
                "path": rel_path,
                "status": "failed",
                "error": "Conversion produced no output",
            }

        # Extract and save images from the conversion result
        images = self._extract_and_save_images(
            md_content, rel_path, abs_path, source_name, source_hash
        )
        image_names = [img["filename"] for img in images]

        # Replace data URIs in the markdown with saved file paths
        md_content = self._replace_data_uris(md_content, images)

        # Build provenance header
        header = _build_provenance_header(source_name, source_hash, image_names or None)

        # Write output
        full_content = header + "\n\n" + md_content
        output_abs.parent.mkdir(parents=True, exist_ok=True)
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

        logger.info(f"Converted {rel_path} → {output_rel}")

        result = {
            "path": rel_path,
            "status": "converted",
            "output_path": output_rel,
        }
        if image_names:
            result["images"] = image_names
        return result

    def _convert_presentation_to_svgs(self, rel_path, abs_path, output_rel,
                                       output_abs, source_name, source_hash, ext):
        """Convert a presentation file to per-slide SVG files + index markdown.

        Each slide becomes an SVG file. A markdown index file links them all.

        Returns dict with {path, status, output_path, images?}
        """
        if ext == ".pptx":
            slides = self._extract_pptx_slides(abs_path)
        else:
            # .odp — try markitdown fallback, no SVG export yet
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

        if not slides:
            return {
                "path": rel_path,
                "status": "failed",
                "error": "No slides extracted",
            }

        output_dir = output_abs.parent
        output_dir.mkdir(parents=True, exist_ok=True)
        stem = Path(rel_path).stem

        # Create subdirectory for slide SVGs
        slides_dir = output_dir / stem
        slides_dir.mkdir(parents=True, exist_ok=True)

        # Zero-pad slide numbers based on total count
        n_digits = len(str(len(slides)))

        svg_filenames = []
        for i, slide_svg in enumerate(slides, start=1):
            padded = str(i).zfill(n_digits)
            filename = f"{padded}_slide.svg"
            rel_filename = f"{stem}/{filename}"
            svg_path = slides_dir / filename
            prov = _build_svg_provenance_header(
                f"{stem}.md", source_name, source_hash, i,
            )
            svg_path.write_text(prov + "\n" + slide_svg)
            svg_filenames.append(rel_filename)
            logger.info(f"Saved slide {i}: {rel_filename}")

        # Build index markdown
        header = _build_provenance_header(
            source_name, source_hash, svg_filenames,
        )
        md_lines = [header, "", f"# {stem}", ""]
        n_digits_md = len(str(len(svg_filenames)))
        for i, filename in enumerate(svg_filenames, start=1):
            padded = str(i).zfill(n_digits_md)
            md_lines.append(f"## Slide {padded}")
            md_lines.append("")
            md_lines.append(f"![Slide {padded}]({filename})")
            md_lines.append("")

        output_abs.write_text("\n".join(md_lines))
        logger.info(
            f"Converted {rel_path} → {output_rel} "
            f"({len(svg_filenames)} slides)"
        )

        return {
            "path": rel_path,
            "status": "converted",
            "output_path": output_rel,
            "images": svg_filenames,
        }

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
                                  source_name, source_hash):
        """Extract images from conversion output and save them.

        Handles two cases:
        1. Data URIs (base64-encoded) — decoded and saved as files
        2. File references — verified to exist on disk

        Returns a list of {filename, path} dicts.
        """
        import base64

        images = []
        output_dir = Path(abs_path).parent
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
                images.append(saved)
            search_start = paren_close + 1

        if data_uri_index > 0:
            logger.info(
                f"Found {data_uri_index} data URI images, "
                f"saved {len(images)}"
            )

        # File-referenced images (non-data-URI)
        file_img_re = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
        for m in file_img_re.finditer(md_content):
            img_path = m.group(2)

            if img_path.startswith(("data:", "http://", "https://")):
                continue

            full_img = output_dir / img_path
            if full_img.exists():
                images.append({
                    "filename": os.path.basename(img_path),
                    "path": img_path,
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

        try:
            img_bytes = base64.b64decode(encoded_data)
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
        # Filter to only images that were saved from data URIs
        # (file-referenced images don't need replacement)
        data_uri_images = [
            img for img in images
            if not img["path"].startswith(("http://", "https://"))
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