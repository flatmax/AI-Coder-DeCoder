# Document Convert

## Overview

Document convert is a **dialog-driven tool** (not a background auto-convert) for converting non-markdown documents (`.docx`, `.pdf`, `.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp`) to markdown files. PDFs and presentations use a hybrid pipeline: text is extracted into markdown paragraphs, and only pages containing images or vector graphics produce companion SVG files. It requires a clean git working tree — the same gate as code review mode — so all converted files appear as clear, reviewable diffs. The user selects which files to convert, reviews the results, and commits normally.

Converted markdown is strictly superior in a git repo — it's diffable, human-readable, greppable, and editable by the LLM via the standard edit block protocol. Document convert brings this benefit without requiring the user to run external tools manually.

Converted `.md` files are indexed by the [Document Index](../2-code-analysis/document_mode.md) exactly like hand-written markdown, flowing through the same extraction, keyword enrichment, and cache tiering pipeline.

## Supported Formats

| Extension | Source Type | Conversion Notes |
|-----------|-----------|-----------------|
| `.docx` | Word document | Full content including tables, headings, lists |
| `.pdf` | PDF document | Text extracted into markdown paragraphs; pages with images/vector graphics also get per-page SVG exports |
| `.pptx` | PowerPoint | Text extracted into markdown via PyMuPDF; slides with images/diagrams also get SVG exports. Falls back to python-pptx (full SVG per slide) when LibreOffice/PyMuPDF unavailable |
| `.xlsx` | Excel spreadsheet | Sheet names as headings, data as markdown tables. Cell background colours preserved via emoji markers with a legend |
| `.csv` | Comma-separated values | Converted to a markdown table |
| `.rtf` | Rich text format | Text content with basic formatting |
| `.odt` | OpenDocument text | Full content similar to `.docx` |
| `.odp` | OpenDocument presentation | Markdown via markitdown |

## Conversion Backend

Simple document formats (`.docx`, `.xlsx`, `.csv`, `.rtf`, `.odt`) use **pure Python libraries** with no external binary dependencies. PDF and presentation formats (`.pdf`, `.pptx`, `.odp`) additionally benefit from **LibreOffice** (headless, for format conversion to PDF) and **PyMuPDF** (for per-page text extraction and SVG export). The system degrades gracefully when these are unavailable.

### markitdown

The primary conversion backend is **markitdown** (Microsoft's Python library) installed with the `[all]` extra to enable all format-specific converters:

- `markitdown[all]` pulls in `python-docx`, `odfpy`, `pdfminer`, `openpyxl`, and other format-specific dependencies
- Handles `.docx`, `.pdf`, `.xlsx`, `.csv`, `.rtf`, `.odt` in a single library
- Pure Python — fits the existing packaging model (PyInstaller can bundle it)
- Actively maintained, broad format coverage

### LibreOffice (Headless PDF Conversion)

For `.pptx` and `.odp` files, the primary pipeline converts the source to PDF via **headless LibreOffice** (`soffice --headless --convert-to pdf`), then hands the PDF to PyMuPDF for extraction. LibreOffice is a **system dependency** — it must be installed separately and `soffice` must be on `PATH`.

| Scenario | Behaviour |
|----------|-----------|
| LibreOffice available | `.pptx` / `.odp` → PDF → PyMuPDF text + SVG pipeline |
| LibreOffice unavailable, `.pptx` | Falls back to python-pptx (full SVG per slide, no text extraction) |
| LibreOffice unavailable, `.odp` | Falls back to markitdown |
| `.pdf` files | LibreOffice not needed — PyMuPDF reads PDF directly |

### PyMuPDF (PDF Text Extraction and SVG Export)

**PyMuPDF** (`fitz`) provides the core PDF processing:

- **Text extraction** — `page.get_text("dict")` extracts text blocks with line/span structure, converted to markdown paragraphs
- **Image detection** — `page.get_images()` and `page.get_drawings()` determine which pages have visual content beyond styled text
- **SVG export** — `page.get_svg_image()` renders the full page as SVG, then post-processing strips text glyph elements (since text is already in the markdown)

#### Hybrid Text + SVG Pipeline

For each PDF page:

| Page content | Markdown output | SVG file? |
|---|---|---|
| Text only | Extracted text paragraphs | No |
| Text + images/diagrams | Extracted text + `![Page N](link)` | Yes (graphics only) |
| Images/diagrams only | `![Page N](link)` | Yes (graphics only) |

#### Image Detection Heuristics

Not all vector drawing commands indicate real images — PDF generators emit rectangles and lines for borders, table rules, and underlines. The detector uses a significance threshold:

- **Raster images** (`page.get_images()`) → always significant
- **Curves** (Bézier `c`, quadratic `qu` operations) → significant
- **Filled polygons** with >2 segments → significant
- **Complex paths** with >4 segments → significant
- **Threshold**: ≥3 significant drawings required to trigger SVG export
- Simple borders, underlines, and table rules → ignored

#### SVG Text Preservation

SVG export uses `text_as_path=0` so that PyMuPDF emits text as `<text>` elements rather than decomposing each character into individual font-glyph `<use>`/`<path>` elements. This keeps sentences intact, produces much smaller SVGs, and makes the text selectable and searchable within the SVG viewer.

The extracted text is **also** written to the companion markdown file for searchability and LLM context. This means text appears in both places:

- **SVG** — as `<text>` elements for visual fidelity and selectability
- **Markdown** — for grep, doc index, and LLM edit access

### python-pptx (Presentation SVG Export — Fallback)

When LibreOffice and PyMuPDF are unavailable, PowerPoint (`.pptx`) files fall back to **python-pptx** for direct SVG rendering. Each slide is rendered as an SVG file containing:

- **Text shapes** — rendered as `<text>` elements with font size, weight, color, and alignment extracted from the slide
- **Images** — embedded as base64 data URIs in `<image>` elements
- **Tables** — rendered as `<rect>` borders with `<text>` cell content
- **Slide dimensions** — converted from EMU (English Metric Units) to pixels at 96 DPI

In the fallback pipeline, slide SVGs are stored in a subdirectory named after the source file, with zero-padded slide numbers:

```
docs/
    presentation.pptx               ← source
    presentation.md                  ← index markdown linking all slides
    presentation/
        01_slide.svg                 ← slide 1
        02_slide.svg                 ← slide 2
        ...
```

The index `.md` file links each slide SVG with heading and image syntax, making slides individually viewable in the SVG viewer and navigable from the document index.

When the primary PyMuPDF pipeline is used, text-only slides appear as markdown paragraphs without a companion SVG. Only slides containing images or diagrams produce SVG files, so the subdirectory may contain fewer files than the total slide count.

### odfpy

**odfpy** is included as an explicit dependency alongside `markitdown[all]` (which also pulls it in transitively). It provides native ODF format parsing for `.odt` files. The explicit dependency ensures `.odt` support is available even if markitdown's dependency groups change in future versions.

### Colour-Aware Excel Extraction

`.xlsx` files use a dedicated **openpyxl-based pipeline** (`_extract_xlsx_with_colors`) instead of markitdown, preserving cell background colours as emoji markers in the markdown output. The pipeline uses a two-pass approach:

1. **Pass 1** — Read all cells across all sheets, collecting text values and raw hex fill colours. Build a set of all unique non-ignorable fills (near-white and near-black fills are ignored)
2. **Colour mapping** — Well-known hues (red, green, yellow, blue, etc.) are assigned named emoji markers (🔴, 🟢, 🟡, 🔵). Remaining colours are clustered by Euclidean RGB distance (threshold 40) and assigned distinct fallback markers (⬛, ◆, ▲, ●, ■, ★) per cluster. This ensures visually distinct shades — e.g. three shades of brown — each get their own symbol
3. **Pass 2** — Emit markdown tables using the colour map. Coloured cells get their marker prepended. Empty columns and fully-empty rows are stripped. A legend mapping markers to colour names is appended

If openpyxl is not installed or fails to read the file, the pipeline falls back to markitdown.

### Installation

If `markitdown` is not installed, the Doc Convert tab is hidden and conversion is unavailable (same graceful degradation pattern as KeyBERT — see [Document Mode — Graceful Degradation in Packaged Releases](../2-code-analysis/document_mode.md#graceful-degradation-in-packaged-releases)). Users running from source can install it with:

```bash
pip install ac-dc[docs]
# or
uv sync --extra docs
```

The `[docs]` extra includes `keybert`, `markitdown[all]`, `odfpy`, `python-pptx`, and `pymupdf` — a single install enables all document features.

For the full PDF/presentation pipeline, **LibreOffice** must also be installed as a system dependency (`soffice` on PATH). Without it, `.pptx` falls back to python-pptx and `.pdf` is handled directly by PyMuPDF (no LibreOffice needed for `.pdf`).

## Clean Working Tree Gate

Document convert requires a **clean git working tree** before any conversion runs — the same prerequisite as [Code Review Mode](code_review.md#clean-working-tree). This ensures:

- All new/modified files from conversion are clearly attributable to the convert operation
- The user can review diffs, edit results, and commit — or discard everything with `git checkout . && git clean -fd`
- No risk of interleaving conversion output with unrelated uncommitted changes

If the working tree is dirty when the user opens the Doc Convert tab, a message is shown: *"Commit or stash your changes before converting documents."* The conversion controls are disabled until the tree is clean.

## Provenance Headers

Converted files carry **self-documenting provenance** via HTML comments — no external manifest file is needed.

### Markdown Output Header

An HTML comment at the top of each converted `.md` file:

```markdown
<!-- docuvert: source=architecture.docx sha256=a1b2c3d4e5f6... images=architecture_img_001.png,architecture_img_002.svg -->

# Architecture

...converted content...
```

| Field | Description |
|-------|-------------|
| `source` | Filename of the source document (same directory) |
| `sha256` | SHA-256 hash of the source document's content at conversion time |
| `images` | Comma-separated list of extracted image filenames (omitted if none) |

### Extracted SVG Header

An XML comment at the top of each extracted SVG:

```xml
<!-- docuvert: parent=architecture.md source=architecture.docx sha256=a1b2c3d4e5f6... img_index=2 -->
<svg xmlns="http://www.w3.org/2000/svg" ...>
```

| Field | Description |
|-------|-------------|
| `parent` | The `.md` file this image is linked from |
| `source` | Original source document |
| `sha256` | SHA-256 hash of the source document (same as parent `.md` header) |
| `img_index` | 1-based index of this image within the conversion output |

### Why HTML Comments

- **Invisible to renderers** — GitHub, VS Code preview, and the doc index's `MarkdownExtractor` all ignore HTML comments. YAML front matter would appear as a rendered table on GitHub and would need explicit skipping in the markdown extractor
- **Format-native** — HTML comments are valid in both markdown and SVG/XML
- **Self-contained** — no external manifest file to keep in sync; provenance travels with the file through renames, moves, and branch operations
- **Staleness detection** — on re-entry to the Doc Convert tab, the system compares each source file's current SHA-256 against the hash in the header to detect changed sources

### Header Parsing

The provenance header is parsed with a simple regex matching `<!-- docuvert: ... -->` on the first line (or first few lines) of the file. Fields are space-separated `key=value` pairs. The parser is lenient — unrecognised fields are ignored, missing optional fields (like `images`) are fine. Files without a docuvert header are treated as non-converted (manually authored).

## Output Placement

Converted files are placed as **siblings** to the original. Presentation and PDF slides/pages are placed in a subdirectory (only for pages with graphics):

```
docs/
    architecture.docx              ← source
    architecture.md                ← converted output
    architecture_img1.png          ← extracted raster image
    architecture_img2.svg          ← extracted vector image
    budget.xlsx                    ← source
    budget.md                      ← converted output
    presentation.pptx              ← source
    presentation.md                ← markdown with text + image links
    presentation/                  ← slide subdirectory (graphics only)
        03_slide.svg               ← slide 3 (had diagrams)
        07_slide.svg               ← slide 7 (had images)
    report.pdf                     ← source
    report.md                      ← markdown with text + image links
    report/                        ← page subdirectory (graphics only)
        02_page.svg                ← page 2 (had figures)
        05_page.svg                ← page 5 (had charts)
```

Text-only pages/slides appear as markdown paragraphs in the `.md` file without companion SVGs. The subdirectory is only created when at least one page has graphical content.

## Image Handling

Images embedded in source documents (e.g., figures in `.docx`) are extracted alongside the converted markdown. markitdown embeds images as base64 data URIs in its output; the image extraction pipeline decodes these and saves them as files.

### Extraction Pipeline

1. **Scan** markdown output for `![...](data:image/...;base64,...)` patterns using string scanning (not regex — base64 data commonly contains `)` characters that break regex quantifiers)
2. **Decode** the base64 payload and detect the MIME subtype
3. **Save** raster images (PNG, JPEG, GIF, BMP, TIFF, WebP) in their native format — no format conversion is performed
4. **Save** vector images (SVG) directly with a provenance header injected
5. **Replace** data URIs in the markdown with relative file paths to the saved images
6. **Verify** file-referenced images (non-data-URI) that markitdown may have written to disk

### Design Decisions

- **No raster-to-SVG conversion** — wrapping a bitmap in an SVG container adds no value
- **Native format preservation** — images are saved exactly as embedded, avoiding any lossy re-encoding
- **String scanning over regex** — base64 payloads are extremely long and may contain characters that confuse regex engines; the parser uses `str.find()` to locate `![`, `](`, `data:image/`, and the closing `)` sequentially

### Filename Convention

Image filenames are derived from the source document stem with a numeric suffix:

```
architecture_img1.png      ← first image, raster
architecture_img2.svg      ← second image, vector
architecture_img3.jpg      ← third image, raster
```

Extracted SVG images carry a provenance header (see above) and are indexed by the doc index via `SvgExtractor`.

### Presentation Images

For `.pptx` files, images are not extracted separately — they are embedded directly as base64 data URIs inside the per-slide SVG `<image>` elements. This preserves the spatial layout (position and size) of images within each slide.

## Doc Convert Tab

Document convert is accessed via a dedicated **Doc Convert tab** in the `ac-dialog` component, alongside the existing Files, Search, Context, Cache, and Settings tabs.

### Tab Visibility

The tab is only visible when:
1. `markitdown` is installed (`doc_convert_available` property is `true`)
2. Convertible files exist in the repository (at least one file matching configured extensions)

When hidden, no tab slot is consumed — the layout is identical to a repo without convertible documents.

### Layout

The tab contains:

1. **Status banner** — shows working tree state. Green checkmark when clean, amber warning when dirty with "Commit or stash changes first" message. Controls below are disabled when dirty
2. **Toolbar** — "Select All" / "Deselect All" buttons, file count summary ("3 of 7 selected"), "Convert Selected (N)" button disabled when nothing is selected or tree is dirty
3. **Filter bar** — text input with fuzzy matching against file paths. Shows match count ("3 / 12") when a filter is active. Uses the same character-by-character fuzzy algorithm as the cache tab — each character in the filter must appear in order in the file path, but not necessarily consecutively
4. **File list** — scrollable list of convertible files (filtered when a filter is active), each row showing:
   - Checkbox for selective conversion
   - File path (relative to repo root)
   - File size
   - Status badge (see below)
5. **Progress area** — replaces the file list during conversion, showing per-file progress

### Status Badges

Each convertible file shows a status badge based on whether a converted output already exists:

| Badge | Color | Meaning |
|-------|-------|---------|
| `new` | Green | No existing `.md` output — first conversion |
| `stale` | Amber | `.md` exists with docuvert header, but source hash has changed since conversion |
| `current` | Grey | `.md` exists with docuvert header and source hash matches — no conversion needed |
| `conflict` | Red | `.md` exists but has no docuvert header — manually authored or externally converted |

Status is determined by:
1. Check if sibling `.md` file exists at the expected output path
2. If no `.md` → `new`
3. If `.md` exists, parse first line for `<!-- docuvert: ... -->` header
4. If no header → `conflict`
5. If header found, compare `sha256` field against current source file hash
6. If match → `current`; if mismatch → `stale`

`current` files are shown but visually muted — they don't need re-conversion. `conflict` files show a warning icon; hovering reveals a tooltip: *"report.md exists and wasn't created by doc convert"*.

### Conversion Flow

1. User opens Doc Convert tab
2. Clean tree check runs. If dirty → banner warning, controls disabled
3. File list populates with all convertible files and status badges
4. User selects files via checkboxes (none pre-selected — opt-in)
5. User clicks "Convert Selected (N)"
6. Progress view replaces file list, showing per-file status:
   - ⏳ Pending
   - 🔄 Converting...
   - ✅ Done
   - ❌ Failed: {reason}
7. Conversions run sequentially — presentation files produce SVG subdirectories, other formats produce sibling `.md` files
8. Data URI images in markitdown output are decoded and saved as separate files
9. On completion, progress view shows summary: "Converted 5 files. 1 failed."
10. File picker refreshes — new `.md`, `.svg`, and image files appear as untracked
11. User reviews diffs in the diff viewer, edits if needed, commits normally

### Conflict Handling

When a `conflict` file is selected and converted:
- The existing `.md` is **overwritten** with the converted content (including the docuvert provenance header)
- Since the working tree was clean on entry, the overwritten file appears as a modification in `git diff`
- The user can review the diff and decide whether to commit or discard

This is safe because the clean-tree gate ensures the original `.md` content is committed and recoverable via `git checkout -- file.md`.

### Re-Conversion of Stale Files

When a `stale` file is selected and converted:
- The existing `.md` is overwritten with fresh conversion output
- The provenance header is updated with the new source hash
- Any images listed in the old header but not produced by the new conversion are deleted (orphan cleanup)
- New images are written and linked

If the user has edited the `.md` since the last conversion, those edits are lost. This is acceptable because:
1. The clean-tree gate means the user's edits are committed and recoverable
2. The `stale` badge signals that the source has changed, implying the old conversion is outdated
3. The user explicitly opted in by selecting the file

## Directory Exclusions

The file scanner skips the same directories excluded by the symbol index and doc index walkers:

- `.git/`, `.ac-dc/`
- `node_modules/`, `__pycache__/`, `.venv/`, `venv/`
- `dist/`, `build/`, `.egg-info/`
- Hidden directories (starting with `.`) except `.github/`
- Any directory matching patterns in `.gitignore` (via the same git-based filtering used by `Repo.get_flat_file_list()`)

## Configuration

Document convert is controlled via `app.json`:

```json
{
  "doc_convert": {
    "enabled": true,
    "extensions": [".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt", ".odp"],
    "max_source_size_mb": 50
  }
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Enable/disable doc convert entirely. When `false`, the tab is hidden |
| `extensions` | list[str] | All supported | Which file extensions to show for conversion. Remove entries to skip formats |
| `max_source_size_mb` | int | `50` | Source files larger than this are shown with a warning badge and skipped during conversion. Prevents enormous CSVs or PDFs from producing unwieldy markdown |

## Integration with Document Index

Converted `.md` files are indexed by the document index exactly like any other markdown file — no special treatment. The indexing pipeline does not know or care whether a `.md` file was hand-written or converted via this tool. The standard two-phase indexing applies:

1. **Structure extraction** (instant) — headings, links, section sizes extracted from the `.md` file. The `<!-- docuvert: ... -->` HTML comment is invisible to the markdown extractor
2. **Keyword enrichment** (background) — KeyBERT processes the converted content

Extracted `.svg` images are also indexed by the doc index via `SvgExtractor`, providing structural awareness of diagrams and illustrations embedded in the original documents.

After conversion completes and the file picker refreshes, the doc index picks up new `.md` and `.svg` files on the next structure re-extraction pass (triggered by chat or mode switch). No explicit integration hook is needed — the standard mtime-based cache invalidation handles it.

## Graceful Degradation

When `markitdown` is not installed:

1. **Backend:** `doc_convert_available` property returns `False`
2. **Frontend:** Doc Convert tab is hidden entirely — no empty tab, no error state
3. **Terminal:** A `logger.info` is emitted during startup (not a warning — the feature is optional)

When `python-pptx` is not installed, `.pptx` conversion raises a clear error message directing the user to `pip install ac-dc[docs]`.

When **PyMuPDF** is not installed:
- `.pdf` conversion is unavailable (clear error message)
- `.pptx` and `.odp` fall back to non-PDF pipelines (python-pptx or markitdown)

When **LibreOffice** is not installed:
- `.pptx` falls back to python-pptx (full SVG per slide, no text extraction)
- `.odp` falls back to markitdown
- `.pdf` files are unaffected (PyMuPDF reads them directly)

The `is_available()` RPC method reports the status of each dependency:

```python
{
    "available": True,        # markitdown installed
    "libreoffice": True,      # soffice on PATH
    "pymupdf": True,          # fitz importable
    "pdf_pipeline": True,     # both LibreOffice and PyMuPDF available
}
```

The feature is entirely optional — the document index, mode toggle, keyword enrichment, and all other doc-mode features work without it.

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Repo scan for convertible files | <100ms | Simple extension matching during directory walk |
| SHA-256 hash of source document | <10ms | Even for large (50MB) files |
| Provenance header parsing | <1ms | Single regex on first line |
| Convert `.docx` (10 pages) | ~200-500ms | markitdown, depends on content complexity |
| Convert `.pdf` (50 pages, text-only) | ~1-3s | PyMuPDF text extraction, no SVG export |
| Convert `.pdf` (50 pages, mixed) | ~3-8s | Text extraction + SVG export + text stripping for image pages |
| Convert `.xlsx` (5 sheets) | ~100-300ms | Table formatting is fast |
| Convert `.pptx` (30 slides) | ~300-800ms | python-pptx SVG export |
| Convert `.odp` (30 slides) | ~300-800ms | markitdown |
| Data URI image extraction | ~10-50ms/image | Base64 decode + file write |
| Full conversion (10 files) | ~2-10s | Sequential in background executor |

Conversion runs in a background executor and does not block UI interaction. The progress view provides per-file feedback.

## RPC Methods

| Method | Description |
|--------|-------------|
| `DocConvert.scan_convertible_files()` | Returns list of convertible files with status badges. Includes clean-tree check |
| `DocConvert.convert_files(paths: list[str])` | Converts selected files. Returns per-file results. Requires clean tree |
| `DocConvert.is_available()` | Returns dict with availability of markitdown, LibreOffice, PyMuPDF, and combined pdf_pipeline status |

## Testing

- Scan discovers files matching configured extensions in repo directories
- Scan skips excluded directories (node_modules, venv, .git, etc.)
- Status detection: `new` for missing `.md`, `stale` for hash mismatch, `current` for hash match, `conflict` for `.md` without docuvert header
- Provenance header written to converted `.md` files with correct source, hash, and image list
- Provenance header written to extracted `.svg` files with correct parent, source, hash, and index
- Provenance header parsing is lenient — unknown fields ignored, missing optional fields accepted
- Clean tree gate prevents conversion when working tree is dirty
- New file conversion creates sibling `.md` with correct content and provenance header
- Stale file re-conversion overwrites `.md` with updated content and hash
- Conflict file conversion overwrites existing `.md` and adds provenance header
- Data URI images decoded from markitdown output and saved as separate files
- Data URIs in markdown replaced with relative paths to saved image files
- Raster images saved in native format (PNG, JPEG, etc.) — no format conversion
- SVG images saved with provenance header injected
- Orphan images cleaned up on re-conversion (images in old header but not in new output)
- PPTX files produce per-slide SVG files in a subdirectory with zero-padded filenames
- PPTX slide SVGs contain text, images, and tables from each slide
- PPTX index markdown links all slide SVGs with heading and image syntax
- Graceful degradation when markitdown is not installed (tab hidden, no errors)
- Graceful degradation when python-pptx is not installed (clear error message)
- Graceful degradation when PyMuPDF is not installed (`.pdf` unavailable, fallbacks used)
- Graceful degradation when LibreOffice is not installed (`.pptx` falls back to python-pptx, `.odp` falls back to markitdown)
- `is_available()` reports status of all dependencies (markitdown, LibreOffice, PyMuPDF, pdf_pipeline)
- PDF text-only pages produce markdown paragraphs without SVG files
- PDF pages with raster images produce companion SVG with text stripped
- PDF pages with non-trivial vector graphics (curves, filled shapes) produce SVG
- PDF pages with only simple borders/underlines are treated as text-only
- SVG export emits text as `<text>` elements (`text_as_path=0`) for visual fidelity and selectability
- Extracted text also appears in companion markdown for searchability
- Image detection threshold requires ≥3 significant drawings (not just decorative rules)
- Configuration `enabled: false` hides the tab
- Custom extension list in config is respected
- Files exceeding `max_source_size_mb` are shown with warning and skipped during conversion
- Converted `.md` files are indexed normally by doc index (HTML comment invisible to extractor)
- Colour-aware xlsx extraction preserves cell background colours as emoji markers
- Named-bucket colours (red, green, yellow, blue, purple) get their standard emoji markers
- Near-white and near-black fills are ignored (not marked)
- Unrecognised colours are clustered by RGB distance; visually distinct shades get distinct fallback markers
- Identical fills across cells receive the same marker
- A colour legend is appended to the markdown output listing all markers used
- Empty columns and fully-empty rows are stripped from xlsx output
- Multiple sheets each get an `## SheetName` heading
- Falls back to markitdown if openpyxl is unavailable