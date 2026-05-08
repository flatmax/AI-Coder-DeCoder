"""Markitdown-based conversion pipeline for `.docx`, `.rtf`, `.odt`, and `.csv`. Extracted from the original monolithic `doc_convert.py` during the package split."""

from __future__ import annotations

import base64
import logging
import zipfile
from pathlib import Path
from typing import Any

from .constants import (
    _DATA_URI_IMAGE_RE,
    _MIME_TO_EXT,
    _TRUNCATED_URI_RE,
)
from .provenance import (
    build_provenance_header,
    hash_file,
    read_provenance_header,
)

logger = logging.getLogger(__name__)


class MarkitdownPipeline:
    def __init__(self, fail, skip):
        self._fail = fail
        self._skip = skip

    def convert(
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
            source_hash = hash_file(source_abs)
        except OSError as exc:
            return self._fail(rel_path, f"Source hash failed: {exc}")

        # Read prior provenance — we'll diff its image list against
        # the new one to identify orphans. If there's no prior
        # header (new or conflict), there are no orphans to clean.
        prior_images: tuple[str, ...] = ()
        if output_abs.is_file():
            prior_header = read_provenance_header(output_abs)
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

        # Assets subdirectory — `docs/architecture.docx` produces
        # `docs/architecture/` for image storage. Created on
        # demand; removed at the end if no images were saved.
        assets_dir = source_abs.with_suffix("")
        stem = source_abs.stem

        # DOCX: unconditionally extract images from the zip's
        # ``word/media/`` directory BEFORE running the data-URI
        # pipeline. markitdown's behaviour with DOCX images is
        # unreliable — for some files it emits truncated
        # ``data:image/...base64...`` placeholders (handled by
        # `_replace_docx_truncated_uris` below), for others it
        # drops the reference entirely. The zip is the
        # authoritative source of "what images does this .docx
        # contain?", matching how the old AC-DC system worked.
        #
        # The data-URI pipeline runs afterwards to handle any
        # real inline data URIs markitdown did successfully
        # emit (small images sometimes survive intact). That
        # pass uses a disjoint filename range — its counter
        # starts at ``len(zip_extracted) + 1`` via the
        # ``start_index`` parameter — so filenames stay unique
        # across the two sources.
        zip_extracted: list[str] = []
        if source_abs.suffix.lower() == ".docx":
            zip_extracted = self._save_docx_zip_images(
                source_abs, assets_dir, stem
            )
            markdown_text = self._replace_docx_truncated_uris(
                markdown_text,
                zip_extracted,
                assets_dir.name,
            )

        # Extract data-URI images and rewrite the markdown.
        # Start numbering after the zip-extracted images so
        # filenames don't collide when both paths produce
        # output for the same source.
        markdown_text, data_uri_saved = self._extract_data_uri_images(
            markdown_text, assets_dir, stem,
            start_index=len(zip_extracted) + 1,
        )
        # Merge both sources in deterministic order: zip
        # images first (document-order within the archive),
        # then any data-URI extras. This list feeds the
        # provenance header and the orphan-cleanup diff.
        saved_images = tuple(zip_extracted) + data_uri_saved

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
        provenance_line = build_provenance_header(
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
    # DOCX image pre-extraction (zip-based, unconditional)
    # ------------------------------------------------------------------

    def _save_docx_zip_images(
        self,
        source_abs: Path,
        assets_dir: Path,
        stem: str,
    ) -> list[str]:
        """Unconditionally extract images from ``word/media/``.

        DOCX files are zip archives; embedded images live
        under ``word/media/``. markitdown does not reliably
        surface these in the markdown output — for some
        files it emits truncated ``data:image/...base64...``
        placeholders (the ellipsis case handled below), for
        others it drops the reference entirely, and for small
        inline images it may inline a real data URI.

        The old AC-DC system extracted every media file
        unconditionally and then reconciled with the markdown
        separately. That's what we do here too: the source of
        truth for "what images does this .docx contain?" is
        the zip, not markitdown's output.

        Returns the list of saved filenames in document order
        (as emitted by ``zipfile.namelist()``), with names of
        the form ``{stem}_img{N}{ext}`` matching the
        data-URI pipeline's convention so the provenance
        header lists both sources with the same naming.

        Empty list on any failure (not a zip, no media dir,
        unreadable entries) — caller treats as "no images"
        and proceeds.
        """
        saved: list[str] = []
        try:
            with zipfile.ZipFile(source_abs, "r") as zf:
                # Sort media entries so the output is stable
                # across extractions of the same file —
                # zipfile.namelist preserves storage order
                # which for well-formed docx matches document
                # order, but a belt-and-braces sort costs
                # nothing and protects against oddly-assembled
                # archives.
                media_names = sorted(
                    name for name in zf.namelist()
                    if name.startswith("word/media/")
                )
                if not media_names:
                    return []
                for name in media_names:
                    ext = Path(name).suffix.lower()
                    if not ext:
                        continue
                    # Normalise `.jpeg` → `.jpg` to match the
                    # old system's convention; leaves other
                    # extensions untouched.
                    if ext == ".jpeg":
                        ext = ".jpg"
                    try:
                        raw = zf.read(name)
                    except (KeyError, RuntimeError) as exc:
                        logger.debug(
                            "DOCX media read failed for %s: %s",
                            name, exc,
                        )
                        continue
                    # Create assets dir lazily — only if we
                    # have at least one byte to write, so
                    # image-free docs still skip the dir.
                    try:
                        assets_dir.mkdir(
                            parents=True, exist_ok=True,
                        )
                    except OSError as exc:
                        logger.debug(
                            "Assets dir create failed %s: %s",
                            assets_dir, exc,
                        )
                        return saved
                    image_index = len(saved) + 1
                    image_name = f"{stem}_img{image_index}{ext}"
                    image_path = assets_dir / image_name
                    try:
                        image_path.write_bytes(raw)
                    except OSError as exc:
                        logger.debug(
                            "Image write failed %s: %s",
                            image_path, exc,
                        )
                        continue
                    saved.append(image_name)
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
        return saved

    def _replace_docx_truncated_uris(
        self,
        markdown_text: str,
        extracted_names: list[str],
        assets_dir_name: str,
    ) -> str:
        """Substitute truncated ``data:image`` placeholders.

        markitdown emits ``data:image/png;base64...`` (literal
        ellipsis, no payload) for large embedded images.
        Now that we've already extracted the real images from
        the zip in :meth:`_save_docx_zip_images`, simply
        rewrite each truncated reference to point at the
        corresponding extracted file.

        Order-of-appearance matching is the best we can do
        without docx relationship parsing — markitdown
        doesn't surface rIds. In practice the zip's document
        order and markitdown's emission order align for
        well-formed files.

        Returns the markdown unchanged when no truncated
        URIs are present.
        """
        if not extracted_names:
            return markdown_text
        truncated_matches = list(
            _TRUNCATED_URI_RE.finditer(markdown_text)
        )
        if not truncated_matches:
            return markdown_text
        count = min(len(truncated_matches), len(extracted_names))
        for i in range(count):
            rel_ref = f"{assets_dir_name}/{extracted_names[i]}"
            # Substitute one at a time so each truncated
            # reference gets its own filename, not all
            # replaced with the same one.
            markdown_text = _TRUNCATED_URI_RE.sub(
                rel_ref, markdown_text, count=1,
            )
        return markdown_text

    # ------------------------------------------------------------------
    # Data-URI image extraction
    # ------------------------------------------------------------------

    def _extract_data_uri_images(
        self,
        markdown_text: str,
        assets_dir: Path,
        stem: str,
        start_index: int = 1,
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
        start_index:
            First image counter value. DOCX callers pass
            ``len(zip_extracted) + 1`` so data-URI images
            numbered after the zip-extracted images and
            filenames stay unique across the two sources.
            Defaults to 1 for non-DOCX callers.

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
            # 1-indexed for user-friendliness. DOCX callers
            # offset past zip-extracted images via
            # ``start_index``; other callers get the default
            # of 1.
            ext = _MIME_TO_EXT.get(mime_sub, ".bin")
            image_index = len(saved) + start_index
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