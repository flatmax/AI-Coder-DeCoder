"""PDF and LibreOffice → PDF → PyMuPDF pipelines.

Routes `.pdf` directly through PyMuPDF; routes `.pptx`/`.odp`
through LibreOffice to produce an intermediate PDF, then through
PyMuPDF. Extracted from the original monolithic `doc_convert.py`
during the package split.
"""

from __future__ import annotations

import base64
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .constants import (
    _LIBREOFFICE_TIMEOUT_SECONDS,
    _MIME_TO_EXT,
    _PAGE_GRAPHICS_THRESHOLD,
    _PATH_SIGNIFICANT_SEGMENTS,
    _POLYGON_SIGNIFICANT_SEGMENTS,
    _SLIDE_NUMBER_MIN_WIDTH,
)
from .provenance import build_provenance_header, hash_file, read_prior_images

logger = logging.getLogger(__name__)


class PdfPipeline:
    """PDF and LibreOffice → PDF → PyMuPDF conversion pipelines."""

    def __init__(
        self,
        fail,
        skip,
        probe_import,
        markitdown_fallback,
        python_pptx_fallback,
    ) -> None:
        self._fail = fail
        self._skip = skip
        self._probe_import = probe_import
        self._markitdown_fallback = markitdown_fallback
        self._python_pptx_fallback = python_pptx_fallback

    # ------------------------------------------------------------------
    # pptx / odp — LibreOffice → PDF → PyMuPDF pipeline (primary)
    # ------------------------------------------------------------------

    def convert_libreoffice(
        self,
        root: Path,
        source_abs: Path,
        rel_path: str,
    ) -> dict[str, Any]:
        """Convert a pptx/odp via LibreOffice + PyMuPDF.

        Spawns ``soffice --headless --convert-to pdf`` to produce
        an intermediate PDF in a temp directory, then routes that
        PDF through :meth:`convert_pymupdf` with overridden
        display name and hash source so the provenance header
        records the original filename and hash.

        Graceful fallback — when either LibreOffice or PyMuPDF is
        unavailable, or when the soffice invocation fails for any
        reason (timeout, non-zero exit, missing output), falls
        back to the format-specific path:

        - ``.pptx`` → python-pptx fallback
        - ``.odp`` → markitdown fallback

        Fallback rather than error because the user asked for a
        conversion; producing some output (even lower-fidelity)
        beats failing the whole file.

        Temp directory lifetime is bounded by the method call —
        ``TemporaryDirectory`` cleans up on exit regardless of
        which branch returns.
        """
        # Pre-flight — check both deps before spending subprocess
        # time. shutil.which is cheap and doesn't launch soffice.
        soffice_path = shutil.which("soffice")
        if soffice_path is None:
            return self._libreoffice_fallback(
                root, source_abs, rel_path,
                reason="LibreOffice (soffice) not on PATH",
            )
        if not self._probe_import("fitz"):
            return self._libreoffice_fallback(
                root, source_abs, rel_path,
                reason="PyMuPDF not installed",
            )

        # Run LibreOffice in a temp dir. The --outdir flag tells
        # soffice where to write the PDF; it picks the filename
        # from the source stem.
        with tempfile.TemporaryDirectory(
            prefix="ac-dc-libreoffice-"
        ) as tmpdir:
            tmp_path = Path(tmpdir)
            try:
                proc = subprocess.run(
                    [
                        soffice_path,
                        "--headless",
                        "--convert-to", "pdf",
                        "--outdir", str(tmp_path),
                        str(source_abs),
                    ],
                    capture_output=True,
                    timeout=_LIBREOFFICE_TIMEOUT_SECONDS,
                    text=True,
                )
            except subprocess.TimeoutExpired:
                logger.debug(
                    "LibreOffice timed out for %s; falling back",
                    rel_path,
                )
                return self._libreoffice_fallback(
                    root, source_abs, rel_path,
                    reason="LibreOffice timed out",
                )
            except (OSError, subprocess.SubprocessError) as exc:
                logger.debug(
                    "LibreOffice subprocess failed for %s: %s; "
                    "falling back",
                    rel_path, exc,
                )
                return self._libreoffice_fallback(
                    root, source_abs, rel_path,
                    reason=f"LibreOffice launch failed: {exc}",
                )

            if proc.returncode != 0:
                logger.debug(
                    "LibreOffice exited %d for %s (stderr: %s); "
                    "falling back",
                    proc.returncode, rel_path,
                    proc.stderr.strip() if proc.stderr else "",
                )
                return self._libreoffice_fallback(
                    root, source_abs, rel_path,
                    reason=(
                        f"LibreOffice exited with code "
                        f"{proc.returncode}"
                    ),
                )

            # soffice names the output as {source_stem}.pdf in
            # the --outdir. Find it rather than assuming.
            expected_pdf = tmp_path / (source_abs.stem + ".pdf")
            if not expected_pdf.is_file():
                # Some locale / template configs produce
                # differently-named output. Fall back to scanning
                # the tmp dir for any .pdf.
                candidates = list(tmp_path.glob("*.pdf"))
                if not candidates:
                    logger.debug(
                        "LibreOffice produced no PDF for %s; "
                        "falling back",
                        rel_path,
                    )
                    return self._libreoffice_fallback(
                        root, source_abs, rel_path,
                        reason="LibreOffice produced no output",
                    )
                expected_pdf = candidates[0]

            # Route through the PyMuPDF pipeline. source_abs
            # stays as the original (.pptx/.odp) so output lands
            # next to the original, not in the temp dir. The
            # display_name and hash_source overrides ensure the
            # provenance header records the original file.
            # strip_text_when_present=False disables the
            # direct-PDF text-dedup pass: presentation text
            # labels the diagram shapes, so stripping it would
            # leave meaningless coloured rectangles. See
            # specs-reference/4-features/doc-convert.md
            # § "SVG text preservation in PDF pipeline".
            return self.convert_pymupdf(
                root=root,
                source_abs=source_abs,
                rel_path=rel_path,
                pdf_source=expected_pdf,
                display_name=source_abs.name,
                hash_source=source_abs,
                strip_text_when_present=False,
                always_emit_svg=True,
            )

    def _libreoffice_fallback(
        self,
        root: Path,
        source_abs: Path,
        rel_path: str,
        reason: str,
    ) -> dict[str, Any]:
        """Route to the format-specific fallback path.

        ``.pptx`` falls back to python-pptx (per-slide SVG
        rendering). ``.odp`` falls back to markitdown (plain-text
        extraction). Both are lower-fidelity than the LibreOffice
        path but produce SOMETHING — better than failing the
        whole conversion.
        """
        logger.debug(
            "LibreOffice path unavailable for %s: %s; "
            "using format-specific fallback",
            rel_path, reason,
        )
        suffix = source_abs.suffix.lower()
        if suffix == ".pptx":
            return self._python_pptx_fallback(
                root, source_abs, rel_path
            )
        if suffix == ".odp":
            return self._markitdown_fallback(
                root, source_abs, rel_path
            )
        # Shouldn't happen — caller only dispatches extensions
        # in _LIBREOFFICE_EXTENSIONS. Defensive.
        return self._fail(
            rel_path,
            f"No fallback available for {suffix}",
        )

    # ------------------------------------------------------------------
    # pdf — PyMuPDF hybrid text + SVG pipeline
    # ------------------------------------------------------------------

    def convert_pymupdf(
        self,
        root: Path,
        source_abs: Path,
        rel_path: str,
        *,
        pdf_source: Path | None = None,
        display_name: str | None = None,
        hash_source: Path | None = None,
        strip_text_when_present: bool = True,
        always_emit_svg: bool = False,
    ) -> dict[str, Any]:
        """Convert a PDF via PyMuPDF's hybrid text + SVG pipeline.

        For each page:

        - Text is extracted into markdown paragraphs via
          ``page.get_text("dict")``. Paragraphs are separated by
          blank lines. Font info is captured but not currently
          rendered (heading detection is a future enhancement).
        - Images and vector drawings are detected. If the page
          has any raster images OR at least
          :data:`_PAGE_GRAPHICS_THRESHOLD` significant drawings,
          a companion SVG is exported for that page.
        - SVGs preserve ``<text>`` elements when the page has no
          extractable text (figure-only pages, where the text
          likely labels the figure itself) OR when the caller
          sets ``strip_text_when_present=False`` (the LibreOffice
          → PDF → PyMuPDF route for pptx/odp, where the text IS
          the diagram). On direct-PDF pages that DO have
          extractable text, the `<text>` and `<tspan>` elements
          are stripped after export so the same prose doesn't
          appear twice — once in the markdown paragraphs, once
          embedded in the SVG.
        - Embedded raster images in the SVG are externalised —
          base64 data URIs replaced with relative file refs.
        - Text-only pages produce no SVG. Pages with no text AND
          no detected images/drawings still get a full-page SVG
          as a fallback, so lightweight vector content isn't
          silently dropped.

        Output layout:

            docs/report.pdf                   ← source
            docs/report.md                     ← index + text
            docs/report/
                02_page.svg                    ← page 2 (had figures)
                05_page.svg                    ← page 5 (had charts)
                02_page_img01.png              ← externalized raster

        Fails with a per-file error when PyMuPDF isn't installed.
        Unlike xlsx (which falls back to markitdown), PyMuPDF is
        the only reliable PDF extractor — no fallback.

        Parameters
        ----------
        root:
            Repository root.
        source_abs:
            Absolute path used to compute the output location.
            Pass A5b note — when converting via LibreOffice,
            this remains the ORIGINAL source (.pptx/.odp) so the
            output markdown lands next to the original, not next
            to the intermediate PDF in the temp dir.
        rel_path:
            Relative path for per-file result reporting.
        pdf_source:
            Optional — when set, PyMuPDF opens this PDF instead
            of `source_abs`. Used by Pass A5b to route an
            intermediate PDF produced by LibreOffice through
            the pipeline while keeping output paths anchored to
            the original source.
        display_name:
            Optional — what appears in `source=` of the
            provenance header. Defaults to `source_abs.name`.
            Pass A5b uses this so a converted .pptx records
            `source=deck.pptx`, not `source=deck.pdf`.
        hash_source:
            Optional — file to hash for the provenance header.
            Defaults to `source_abs`. Pass A5b hashes the
            original .pptx so re-running against an unchanged
            source classifies as `current` regardless of whether
            LibreOffice produces byte-identical intermediate
            PDFs across runs (it doesn't — timestamps vary).
        strip_text_when_present:
            When True (the default, used by the direct-PDF
            path), pages that have extractable text get their
            ``<text>`` / ``<tspan>`` elements stripped from the
            generated SVG. The same text already appears in the
            companion markdown, so duplicating it in the SVG
            bloats output without benefit for real PDFs (papers,
            reports). When False (used by the LibreOffice route
            for pptx/odp), SVG text is preserved unconditionally
            — presentation text labels the diagram shapes, and
            stripping it would leave meaningless coloured
            rectangles.
        """
        # Lazy import — PyMuPDF is optional in stripped-down
        # releases. Clean error with install hint on ImportError.
        try:
            import fitz  # PyMuPDF
        except ImportError:
            return self._fail(
                rel_path,
                (
                    "PyMuPDF is not installed. Install with: "
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

        # Hash source for provenance. Use hash_source when given
        # (A5b path) so the hash reflects the original file the
        # user actually edits, not the intermediate PDF.
        hash_target = hash_source if hash_source is not None else source_abs
        try:
            source_hash = hash_file(hash_target)
        except OSError as exc:
            return self._fail(
                rel_path, f"Source hash failed: {exc}"
            )

        # Resolve display name for the provenance header. Defaults
        # to the original source's basename so converted files
        # carry the user-recognisable name, not the intermediate
        # PDF's.
        resolved_display_name = (
            display_name if display_name is not None
            else source_abs.name
        )

        # Open the document. Broad catch — corrupt PDFs, wrong
        # version, encrypted without a password all produce
        # various PyMuPDF exception types. When pdf_source is
        # given, open that instead of the original source — the
        # A5b path hands us an intermediate PDF to process.
        open_target = pdf_source if pdf_source is not None else source_abs
        try:
            doc = fitz.open(str(open_target))
        except Exception as exc:
            return self._fail(
                rel_path,
                f"PyMuPDF failed to open: {exc}",
            )

        try:
            return self._process_pdf_document(
                doc=doc,
                root=root,
                source_abs=source_abs,
                output_abs=output_abs,
                output_rel=output_rel,
                source_hash=source_hash,
                rel_path=rel_path,
                display_name=resolved_display_name,
                strip_text_when_present=strip_text_when_present,
                always_emit_svg=always_emit_svg,
            )
        finally:
            # Always close — PyMuPDF holds file handles.
            try:
                doc.close()
            except Exception:
                pass

    def _process_pdf_document(
        self,
        doc: Any,
        root: Path,
        source_abs: Path,
        output_abs: Path,
        output_rel: Path,
        source_hash: str,
        rel_path: str,
        display_name: str | None = None,
        strip_text_when_present: bool = True,
        always_emit_svg: bool = False,
    ) -> dict[str, Any]:
        """Walk the pages of an open PDF document and emit output.

        Split out from :meth:`convert_pymupdf` so the
        `doc.close()` is guaranteed in the caller's finally
        block regardless of which branch we exit through.

        ``display_name`` defaults to the original source's
        basename when None — used by Pass A5b to override for
        converted pptx/odp (the provenance header shows the
        original filename, not the intermediate PDF's).

        ``strip_text_when_present`` is forwarded to
        :meth:`_process_pdf_page`; see :meth:`convert_pymupdf`
        for the full rationale.
        """
        page_count = doc.page_count
        if page_count == 0:
            # Empty PDF — placeholder output so scan classifies
            # as `current`.
            return self._write_pdf_output(
                output_abs=output_abs,
                output_rel=output_rel,
                source_abs=source_abs,
                source_hash=source_hash,
                markdown_text="(empty PDF)\n",
                rel_path=rel_path,
                artefacts=(),
                display_name=display_name,
            )

        # Per-page filename width — 2 digits for small PDFs,
        # 3+ for larger ones. Matches the pptx path.
        pad_width = max(
            _SLIDE_NUMBER_MIN_WIDTH, len(str(page_count))
        )

        # Assets subdir — created lazily on the first page that
        # actually needs it. Avoids empty subdirs for text-only
        # PDFs.
        assets_dir = source_abs.with_suffix("")
        assets_created = False

        body_parts: list[str] = []
        artefacts: list[str] = []  # all files under assets_dir
        prior_artefacts = read_prior_images(output_abs)

        for page_index in range(page_count):
            try:
                page = doc.load_page(page_index)
            except Exception as exc:
                logger.debug(
                    "PDF page %d load failed for %s: %s",
                    page_index, rel_path, exc,
                )
                body_parts.append(
                    f"## Page {page_index + 1}\n\n"
                    "*(page load failed)*"
                )
                continue

            try:
                page_result = self._process_pdf_page(
                    page=page,
                    page_index=page_index,
                    pad_width=pad_width,
                    assets_dir=assets_dir,
                    assets_created=assets_created,
                    strip_text_when_present=strip_text_when_present,
                    always_emit_svg=always_emit_svg,
                )
            except Exception as exc:
                logger.debug(
                    "PDF page %d of %s render failed: %s",
                    page_index + 1, rel_path, exc,
                )
                body_parts.append(
                    f"## Page {page_index + 1}\n\n"
                    "*(page rendering failed)*"
                )
                continue

            assets_created = assets_created or page_result["assets_created"]
            body_parts.append(page_result["markdown"])
            artefacts.extend(page_result["artefacts"])

        markdown_text = "\n\n".join(body_parts) + "\n"

        # Orphan cleanup — anything listed in the old provenance
        # header that we didn't re-produce this round gets
        # unlinked.
        if prior_artefacts and assets_dir.is_dir():
            new_set = set(artefacts)
            for orphan in prior_artefacts:
                if orphan in new_set:
                    continue
                orphan_path = assets_dir / orphan
                try:
                    orphan_path.unlink()
                except OSError as exc:
                    logger.debug(
                        "Failed to remove orphan artefact %s: %s",
                        orphan_path, exc,
                    )

        # If the assets dir was created but is now empty (every
        # artefact was an orphan removed above), clean it up.
        if assets_dir.is_dir():
            try:
                if not any(assets_dir.iterdir()):
                    assets_dir.rmdir()
            except OSError as exc:
                logger.debug(
                    "Failed to remove empty assets dir %s: %s",
                    assets_dir, exc,
                )

        return self._write_pdf_output(
            output_abs=output_abs,
            output_rel=output_rel,
            source_abs=source_abs,
            source_hash=source_hash,
            markdown_text=markdown_text,
            rel_path=rel_path,
            artefacts=tuple(artefacts),
            display_name=display_name,
        )

    def _process_pdf_page(
        self,
        page: Any,
        page_index: int,
        pad_width: int,
        assets_dir: Path,
        assets_created: bool,
        strip_text_when_present: bool = True,
        always_emit_svg: bool = False,
    ) -> dict[str, Any]:
        """Emit markdown + optional SVG for one PDF page.

        Returns ``{"markdown": str, "artefacts": list[str],
        "assets_created": bool}`` where ``artefacts`` is the list
        of filenames (SVG plus externalized images) produced for
        this page.

        Page processing logic:

        1. Extract text — if non-empty, emit as markdown paragraphs
        2. Detect images and significant drawings
        3. If the page has ANY raster images, emit an SVG AND
           embed image refs in markdown (both places are visible
           to the LLM — markdown for grep, SVG for visual
           fidelity)
        4. Else if the page has significant drawings AND text,
           emit a companion SVG (for the graphics)
        5. Else if the page has NO text AND NO detected content,
           emit a full-page SVG as a safety net (lightweight
           vector graphics that don't reach the "significant"
           threshold)
        6. Text-only pages emit no SVG

        ``<text>`` preservation in the emitted SVG depends on
        ``strip_text_when_present`` AND whether the page has
        extractable text. Direct-PDF pages with text strip the
        SVG's ``<text>`` / ``<tspan>`` elements (the markdown
        already carries the paragraphs); LibreOffice-routed
        pptx/odp pages always keep text (it labels the diagram
        shapes); figure-only pages keep text regardless of the
        flag (the text likely labels the figure). See
        :meth:`_export_pdf_page_svg` for the strip implementation.
        """
        page_number = page_index + 1
        slide_name = f"{str(page_number).zfill(pad_width)}_page.svg"

        # Extract text.
        text_paragraphs = self._extract_pdf_text(page)
        has_text = bool(text_paragraphs)

        # Detect images and drawings.
        raster_images = self._count_pdf_raster_images(page)
        significant_drawings = self._count_significant_drawings(page)
        has_raster = raster_images > 0
        has_significant_graphics = (
            significant_drawings >= _PAGE_GRAPHICS_THRESHOLD
        )

        # Decide whether to emit an SVG for this page.
        # The LibreOffice route (pptx/odp → PDF) passes
        # always_emit_svg=True because every slide is a
        # visual artefact — the direct-PDF heuristic would
        # suppress SVGs for slides with text plus a single
        # diagram element (below the significance threshold),
        # which loses the visual representation of most
        # presentation content.
        emit_svg = (
            always_emit_svg
            or has_raster
            or has_significant_graphics
            or (not has_text and not has_raster)
        )

        markdown_parts: list[str] = [f"## Page {page_number}"]
        artefacts: list[str] = []

        if has_text:
            markdown_parts.extend(text_paragraphs)

        if emit_svg:
            # Ensure assets dir exists.
            if not assets_created:
                try:
                    assets_dir.mkdir(parents=True, exist_ok=True)
                    assets_created = True
                except OSError as exc:
                    logger.debug(
                        "Assets dir create failed %s: %s",
                        assets_dir, exc,
                    )
                    # Without the dir we can't write the SVG —
                    # skip the SVG for this page and continue.
                    return {
                        "markdown": "\n\n".join(markdown_parts),
                        "artefacts": [],
                        "assets_created": assets_created,
                    }

            # Decide whether to strip SVG text for this page.
            # Two conditions must both hold:
            #   1. The caller asked for stripping (direct-PDF
            #      path; LibreOffice route passes False to
            #      preserve diagram labels).
            #   2. The page has extractable text — otherwise
            #      the SVG's <text> elements probably ARE the
            #      figure labels and stripping would lose them.
            # See specs-reference/4-features/doc-convert.md
            # § "SVG text preservation in PDF pipeline".
            strip_svg_text = strip_text_when_present and has_text
            svg_text, image_files = self._export_pdf_page_svg(
                page=page,
                svg_name_stem=slide_name.removesuffix(".svg"),
                assets_dir=assets_dir,
                strip_text=strip_svg_text,
            )
            svg_path = assets_dir / slide_name
            try:
                svg_path.write_text(svg_text, encoding="utf-8")
                artefacts.append(slide_name)
                artefacts.extend(image_files)
            except OSError as exc:
                logger.debug(
                    "SVG write failed %s: %s", svg_path, exc
                )

            # Add markdown image ref so LLM sees the SVG link.
            # Two cases:
            # - Page has text + images: markdown has text AND a
            #   link to the SVG (visual fidelity is in the SVG).
            # - Page has no text: the SVG is the content.
            rel_ref = f"{assets_dir.name}/{slide_name}"
            markdown_parts.append(f"![Page {page_number}]({rel_ref})")

        if len(markdown_parts) == 1:
            # Only the heading — page had no text and no SVG.
            # This shouldn't happen given the fallback logic
            # but be defensive.
            markdown_parts.append("*(blank page)*")

        return {
            "markdown": "\n\n".join(markdown_parts),
            "artefacts": artefacts,
            "assets_created": assets_created,
        }

    def _extract_pdf_text(self, page: Any) -> list[str]:
        """Extract text from a page as markdown paragraphs.

        Uses ``page.get_text("dict")`` which returns structured
        data. Each text block becomes one paragraph; spans
        within lines are joined by spaces; lines within a block
        by spaces too. A future enhancement could detect
        heading levels from font sizes.

        Returns an empty list when the page has no extractable
        text.
        """
        try:
            data = page.get_text("dict")
        except Exception as exc:
            logger.debug("get_text failed: %s", exc)
            return []

        paragraphs: list[str] = []
        for block in data.get("blocks", []):
            if block.get("type", 0) != 0:
                # type 1 is image; skip.
                continue
            lines_text: list[str] = []
            for line in block.get("lines", []):
                spans: list[str] = []
                for span in line.get("spans", []):
                    span_text = span.get("text", "") or ""
                    if span_text.strip():
                        spans.append(span_text)
                if spans:
                    lines_text.append(" ".join(spans))
            if lines_text:
                # Join lines within a block with spaces — block
                # already represents a visually-grouped run of
                # text, so line breaks within it are usually
                # visual-wrap rather than semantic-paragraph.
                paragraph = " ".join(lines_text).strip()
                if paragraph:
                    paragraphs.append(paragraph)
        return paragraphs

    @staticmethod
    def _count_pdf_raster_images(page: Any) -> int:
        """Return the number of raster images on the page."""
        try:
            return len(page.get_images())
        except Exception as exc:
            logger.debug("get_images failed: %s", exc)
            return 0

    @staticmethod
    def _count_significant_drawings(page: Any) -> int:
        """Return the count of "significant" vector drawings.

        Significance rules (from specs4/4-features/doc-convert.md):

        - Any drawing containing Bézier (``c``) or quadratic
          (``qu``) curves → significant
        - A filled path with more than
          :data:`_POLYGON_SIGNIFICANT_SEGMENTS` segments →
          significant
        - Any drawing with more than
          :data:`_PATH_SIGNIFICANT_SEGMENTS` segments →
          significant
        - Simple rectangles and single lines → NOT significant
          (these are just borders and table rules that every
          PDF emits for layout)
        """
        try:
            drawings = page.get_drawings()
        except Exception as exc:
            logger.debug("get_drawings failed: %s", exc)
            return 0

        count = 0
        for drawing in drawings:
            items = drawing.get("items", [])
            if not items:
                continue

            # Check for curves (always significant).
            has_curves = any(
                item and len(item) > 0 and item[0] in ("c", "qu")
                for item in items
            )
            if has_curves:
                count += 1
                continue

            # Check for filled path with multiple segments.
            is_filled = drawing.get("fill") is not None
            if (
                is_filled
                and len(items) > _POLYGON_SIGNIFICANT_SEGMENTS
            ):
                count += 1
                continue

            # Check for complex path (many segments).
            if len(items) > _PATH_SIGNIFICANT_SEGMENTS:
                count += 1
                continue

        return count

    def _export_pdf_page_svg(
        self,
        page: Any,
        svg_name_stem: str,
        assets_dir: Path,
        strip_text: bool = False,
    ) -> tuple[str, list[str]]:
        """Export a page to SVG, externalizing any raster images.

        PyMuPDF emits ``<text>`` elements (text_as_path=0) so the
        output is compact and selectable. What happens next
        depends on ``strip_text``:

        - ``strip_text=False`` (figure-only pages, and every
          page on the LibreOffice → PDF → PyMuPDF route):
          ``<text>`` and ``<tspan>`` elements are preserved.
          For presentations this matters — diagram labels like
          "Runtime Environment" or "Calibration Unit" anchor
          the coloured shapes, and dropping them leaves the
          user staring at nameless rectangles.
        - ``strip_text=True`` (direct-PDF pages with
          extractable text): ``<text>`` and ``<tspan>``
          elements are removed. The same prose already appears
          in the companion markdown file as extracted
          paragraphs, and duplicating it inside the SVG just
          bloats output for real PDFs (papers, reports).

        See specs-reference/4-features/doc-convert.md
        § "SVG text preservation in PDF pipeline" for the
        rationale behind the origin-aware behaviour.

        Parameters
        ----------
        page:
            A PyMuPDF ``Page`` object.
        svg_name_stem:
            Stem used for naming externalized raster image files
            (e.g. ``"02_page"`` → ``02_page_img01.png``).
        assets_dir:
            Directory to save externalized images into.
        strip_text:
            When True, remove ``<text>`` / ``<tspan>`` elements
            from the generated SVG. Default False so callers
            that don't care (tests, figure-only pages) get the
            safe preserve-everything behaviour.

        Returns
        -------
        tuple
            ``(svg_text, externalized_filenames)``.
            ``svg_text`` has any base64 raster images rewritten
            to refer to externalized files and, when
            ``strip_text`` is True, has ``<text>`` / ``<tspan>``
            elements removed.
        """
        try:
            # text_as_path=0 keeps text as <text> elements rather
            # than decomposing into paths. Makes the SVG
            # selectable in a viewer and much smaller.
            svg_text = page.get_svg_image(text_as_path=0)
        except Exception as exc:
            logger.debug("get_svg_image failed: %s", exc)
            # Emit a minimal empty SVG so callers don't crash.
            return (
                '<svg xmlns="http://www.w3.org/2000/svg"/>',
                [],
            )

        # Externalize embedded raster images.
        svg_text, image_files = self._externalize_svg_images(
            svg_text=svg_text,
            stem=svg_name_stem,
            assets_dir=assets_dir,
        )

        # Strip text elements on the direct-PDF path. Runs
        # after image externalization so we can't accidentally
        # strip text from inside an <image> tag's href (not
        # that PyMuPDF would ever produce that, but the
        # ordering keeps each pass independent and easy to
        # reason about).
        if strip_text:
            svg_text = self._strip_svg_text_elements(svg_text)

        return svg_text, image_files

    def _externalize_svg_images(
        self,
        svg_text: str,
        stem: str,
        assets_dir: Path,
    ) -> tuple[str, list[str]]:
        """Extract base64 images from an SVG, save as files.

        PyMuPDF's SVG output embeds raster images as base64
        data URIs inside ``<image>`` elements. For large
        images this bloats the SVG severely; externalising
        them into sibling files keeps the SVG compact and
        matches the approach the DocConvert tab uses
        elsewhere.

        Returns the modified SVG text (with ``data:image/...``
        references replaced by relative filename refs) and
        the list of saved filenames.

        Failures (decode error, write error) leave the original
        data URI in place — broken image ref is better than
        silent content loss.
        """
        saved: list[str] = []

        def _replace(match: re.Match[str]) -> str:
            attr_name = match.group("attr")
            mime_sub = match.group("mime").lower()
            payload = match.group("payload")
            try:
                image_bytes = base64.b64decode(
                    payload, validate=False
                )
            except Exception as exc:
                logger.debug(
                    "SVG image decode failed: %s", exc
                )
                return match.group(0)

            ext = _MIME_TO_EXT.get(mime_sub, ".bin")
            image_index = len(saved) + 1
            image_name = f"{stem}_img{image_index:02d}{ext}"
            image_path = assets_dir / image_name
            try:
                image_path.write_bytes(image_bytes)
            except OSError as exc:
                logger.debug(
                    "SVG image write failed %s: %s",
                    image_path, exc,
                )
                return match.group(0)

            saved.append(image_name)
            # Return the attribute with the relative filename.
            return f'{attr_name}="{image_name}"'

        # Match both `href="data:..."` and
        # `xlink:href="data:..."` attribute forms.
        pattern = re.compile(
            r'(?P<attr>(?:xlink:)?href)='
            r'"data:image/(?P<mime>[^;]+);base64,'
            r'(?P<payload>[^"]+)"',
            re.IGNORECASE,
        )
        modified = pattern.sub(_replace, svg_text)
        return modified, saved

    @staticmethod
    def _strip_svg_text_elements(svg_text: str) -> str:
        """Remove ``<text>...</text>`` and any leftover ``<tspan>``
        elements from an SVG string.

        Used by :meth:`_export_pdf_page_svg` on the direct-PDF
        path when the page has extractable text — the markdown
        already carries the prose, so keeping it in the SVG too
        is just duplication.

        Regex rather than XML parse: PyMuPDF's output is
        consistently structured and regex keeps us dependency-
        free and fast. ``re.DOTALL`` matters for multi-line
        ``<text>`` blocks where tspans span several lines.
        ``re.IGNORECASE`` is defensive — SVG tag names are
        normatively lowercase but case-insensitive matching
        costs nothing and protects against edge cases.

        Two passes:
        1. Strip whole ``<text>...</text>`` blocks (which
           includes any nested tspans).
        2. Strip any stray ``<tspan>...</tspan>`` blocks that
           somehow survived (e.g. tspan outside a text parent —
           invalid but possible in malformed SVG).

        Self-closing variants (``<text ... />``) are rare in
        PyMuPDF output but handled by the first pass too.
        """
        # <text ... />  — self-closing.
        svg_text = re.sub(
            r"<text\b[^>]*/\s*>",
            "",
            svg_text,
            flags=re.IGNORECASE,
        )
        # <text ...>...</text>  — block form.
        svg_text = re.sub(
            r"<text\b[^>]*>.*?</text\s*>",
            "",
            svg_text,
            flags=re.DOTALL | re.IGNORECASE,
        )
        # Stray <tspan>...</tspan> outside a parent text.
        svg_text = re.sub(
            r"<tspan\b[^>]*>.*?</tspan\s*>",
            "",
            svg_text,
            flags=re.DOTALL | re.IGNORECASE,
        )
        # Self-closing tspan.
        svg_text = re.sub(
            r"<tspan\b[^>]*/\s*>",
            "",
            svg_text,
            flags=re.IGNORECASE,
        )
        return svg_text

    def _write_pdf_output(
        self,
        output_abs: Path,
        output_rel: Path,
        source_abs: Path,
        source_hash: str,
        markdown_text: str,
        rel_path: str,
        artefacts: tuple[str, ...],
        display_name: str | None = None,
    ) -> dict[str, Any]:
        """Write PDF pipeline output with provenance header.

        Shared for the normal and empty-PDF cases. The
        ``artefacts`` tuple lists every file produced under the
        assets subdirectory — page SVGs AND externalized images
        — so the orphan-cleanup pass on re-conversion can diff
        against this list.

        ``display_name`` defaults to ``source_abs.name`` — Pass
        A5b overrides it so converted pptx/odp files record the
        original filename in provenance, not the intermediate
        PDF's.
        """
        provenance_line = build_provenance_header(
            source_name=display_name or source_abs.name,
            source_hash=source_hash,
            images=artefacts,
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
            "images": list(artefacts),
        }