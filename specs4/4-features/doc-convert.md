# Document Convert

A dialog-driven tool (not a background auto-convert) for converting non-markdown documents to markdown files. Requires a clean git working tree so converted files appear as clear, reviewable diffs. The user selects which files to convert, reviews the results, and commits normally. Converted files are placed as siblings to the originals and indexed by the document index like any other markdown.
## Supported Formats
| Extension | Source | Conversion notes |
|---|---|---|
| `.docx` | Word document | Full content including tables, headings, lists |
| `.pdf` | PDF document | Text extracted into paragraphs; pages with images/vector graphics also get per-page SVG exports |
| `.pptx` | PowerPoint | Text via PyMuPDF; slides with images/diagrams also get SVG exports. Fallback to python-pptx (full SVG per slide) |
| `.xlsx` | Excel spreadsheet | Sheet names as headings, data as markdown tables; cell background colours preserved via emoji markers |
| `.csv` | CSV | Converted to a markdown table |
| `.rtf` | Rich text format | Text with basic formatting |
| `.odt` | OpenDocument text | Similar to `.docx` |
| `.odp` | OpenDocument presentation | Via markitdown |
## Conversion Backends
- **markitdown** — primary backend with broad format coverage (docx, xlsx, csv, rtf, odt, pdf fallback); pure Python, fits packaging model
- **LibreOffice** (headless) — system dependency used to convert pptx/odp to PDF before PyMuPDF extraction
- **PyMuPDF** — PDF text extraction, image detection, per-page SVG export
- **python-pptx** — fallback for pptx when LibreOffice is unavailable (renders slides as SVG with embedded images)
- **odfpy** — transitive dep of markitdown, handles ODF parsing
- **openpyxl** — dedicated pipeline for xlsx to preserve cell background colours
## PDF Pipeline (Hybrid Text + SVG)
For each PDF page:
| Page content | Markdown output | SVG file? |
|---|---|---|
| Text only | Extracted text paragraphs | No |
| Text + images/diagrams | Extracted text + image link | Yes (graphics only) |
| Images/diagrams only | Image link | Yes (graphics only) |
### Image Detection Heuristics
- Raster images always significant
- Curves (Bézier, quadratic) significant
- Filled polygons with more than two segments significant
- Complex paths with more than a few segments significant
- Minimum count of significant drawings required to trigger SVG export (below the threshold — treated as text-only)
- Simple borders, underlines, and table rules ignored
### SVG Text Preservation
- SVG export emits text as text elements rather than decomposing each character into individual glyph paths
- Keeps sentences intact, produces smaller SVGs, makes text selectable and searchable in the SVG viewer
- Extracted text is always written to the companion markdown file for searchability and LLM context
- Origin-aware dedup: whether SVG text survives depends on how the page reached the PyMuPDF stage
- For real PDFs (report pages where text flows in paragraphs), `<text>` and `<tspan>` elements are stripped from the SVG when the page also has extractable text — the markdown carries the paragraphs, the SVG carries only the graphics, and duplicating text in both places would bloat output without benefit
- For presentations (pptx/odp routed through LibreOffice → intermediate PDF → PyMuPDF), text stripping is disabled on every page — slide text like "Runtime Environment" or "Calibration Unit" labels the shapes in a diagram and dropping it leaves meaningless coloured rectangles
- Figure-only pages (no extractable text) always keep their SVG text regardless of source — any `<text>` element there probably labels the figure itself (axis labels, legend entries)
- Result for PDFs — text in markdown, graphics in SVG, no duplication on text pages
- Result for presentations — text in both SVG (so the diagram renders correctly) and markdown (for grep)
### SVG Image Externalization
- SVGs produced by the PDF pipeline may contain embedded base64 image data URIs
- Externalization scans the SVG, extracts the embedded images, saves them as separate files
- Data URIs in the SVG replaced with relative filename references
- Handles both forms of href attributes
- Whitespace and newlines stripped from base64 payloads before decoding
- Sequential naming by page and counter within the page's output directory
- When a page has both readable text AND externalized raster images, the markdown embeds the individual raster images directly instead of linking the full-page SVG (avoids visual duplication — the SVG contains the same text already in markdown)
- Externalized image filenames tracked alongside SVG filenames in the provenance header for orphan cleanup on re-conversion
### Text-Only Page Fallback
- Pages with no extractable text AND no detected images still get a full-page SVG export as a fallback
- Ensures pages with only lightweight vector content are never silently dropped
## Presentation Pipeline
### Primary (LibreOffice + PyMuPDF)
- pptx/odp converted to PDF via headless LibreOffice
- PDF handed to the PyMuPDF pipeline for text extraction and selective SVG export
### Fallback (python-pptx)
When LibreOffice or PyMuPDF is unavailable:
- Each slide rendered as an SVG via python-pptx
- Text shapes → text elements with font size, weight, color, alignment
- Images → embedded base64 data URIs in image elements
- Tables → rect borders with cell text
- Slide dimensions converted from EMU to pixels
In the fallback pipeline, slide SVGs are stored in a subdirectory named after the source file, with zero-padded filenames. An index markdown file links each slide SVG with heading and image syntax.
## Excel Pipeline (Colour-Aware)
Dedicated openpyxl-based pipeline instead of markitdown, preserving cell background colours as emoji markers.
### Two-Pass Approach
1. **Pass 1** — read all cells across all sheets, collect text values and raw hex fill colours; normalize "nan" / "none" values (case-insensitive) to empty strings; build set of unique non-ignorable fills (near-white and near-black fills ignored)
2. **Colour mapping** — well-known hues (red, green, yellow, blue, purple, etc.) assigned named emoji markers; remaining colours clustered by RGB Euclidean distance and assigned distinct fallback markers per cluster
3. **Pass 2** — emit markdown tables using the colour map; coloured cells get their marker prepended; empty columns and fully-empty rows stripped; legend mapping markers to colour names appended
### Fallback
- If openpyxl is not installed or fails to read the file, fall back to markitdown
## DOCX Image Extraction
markitdown's handling of embedded images is unreliable — for some images it emits truncated data URIs (references where the base64 payload is replaced with an ellipsis), for others it drops the reference entirely, and for small images it may successfully inline a real data URI. The zip archive is the authoritative source of "what images does this .docx contain?", not markitdown's output.

Unconditional three-step pipeline:

1. **Extract all media from the zip** — open the docx as a zip archive, find every file under the media directory, save each with sequential names (`{stem}_img{N}{ext}`); JPEG extensions normalized to `.jpg`; corrupt (non-zip) docx handled gracefully by skipping extraction. Runs even when markdown output appears to reference no images — the zip may contain images markitdown dropped.
2. **Replace truncated references** — scan markdown for truncated patterns (the ellipsis form) and rewrite each to point at the corresponding already-extracted file, in document order. When no truncated references exist, this step is a no-op; the images are still on disk from step 1.
3. **Process any remaining real data URIs** — the standard data-URI extraction pipeline handles images markitdown did successfully inline. Its image counter is offset past the zip-extracted images (starts at `len(zip_extracted) + 1`) so filenames don't collide across the two sources.

All saved images from both steps 1 and 3 are listed in the provenance header so orphan cleanup on re-conversion diffs against the complete set. When markitdown drops an image reference entirely (no truncated marker, no real data URI), the file still lands on disk and appears in provenance — but no markdown link points at it. A future enhancement could parse the docx relationship table (`word/_rels/document.xml.rels`) to map rIds to media paths and inject links, but that requires walking `document.xml` and isn't part of the current pipeline.
## Image Extraction Pipeline
Images embedded in source documents (e.g. figures in docx) are extracted alongside converted markdown.
### Pipeline
1. Scan markdown output for base64 image references using string scanning (not regex — base64 data commonly contains characters that break regex quantifiers)
2. Decode base64 payload and detect MIME subtype
3. Save raster images (PNG, JPEG, GIF, BMP, TIFF, WebP) in their native format — no format conversion
4. Save vector images (SVG) directly with a provenance header injected
5. Replace data URIs in markdown with relative file paths to saved images
6. Verify file-referenced images (non-data-URI) that markitdown may have written to disk
### Design Decisions
- No raster-to-SVG conversion — wrapping a bitmap in an SVG container adds no value
- Native format preservation — images saved exactly as embedded, avoiding lossy re-encoding
- String scanning over regex — base64 payloads are long and may contain characters that confuse regex engines
### Filename Convention
- Image filenames derived from source document stem with a numeric suffix
- Extracted SVG images carry a provenance header and are indexed by the doc index
## Clean Working Tree Gate
Document convert requires a clean git working tree — same prerequisite as code review mode. Ensures:
- All new/modified files from conversion are clearly attributable to the convert operation
- User can review diffs, edit results, and commit — or discard everything via git commands
- No risk of interleaving conversion output with unrelated uncommitted changes
If the working tree is dirty when the user opens the Doc Convert tab, a message is shown telling the user to commit or stash changes first. Conversion controls are disabled until clean.
## Provenance Headers
Converted files carry self-documenting provenance via HTML/XML comments — no external manifest file needed.
### Markdown Output Header
An HTML comment at the top of each converted `.md` file records:
- Source filename (same directory)
- SHA-256 hash of source document content at conversion time
- Comma-separated list of extracted image filenames (omitted if none)
### Extracted SVG Header
An XML comment at the top of each extracted SVG records:
- Parent markdown file
- Original source document
- SHA-256 hash of source (same as parent markdown's hash)
- Image index within the conversion output (1-based)
### Why HTML Comments
- Invisible to renderers — GitHub, editor previews, markdown extractor all ignore them
- Format-native — valid in both markdown and SVG/XML
- Self-contained — no external manifest to keep in sync; provenance travels with the file through renames, moves, branch operations
- Staleness detection — on re-entry to the Doc Convert tab, each source file's current hash is compared against the header's hash
### Header Parsing
- Simple regex matching a docuvert-tagged comment on the first line (or first few lines)
- Fields are space-separated key=value pairs
- Parser is lenient — unrecognised fields ignored, missing optional fields fine
- Files without a docuvert header are treated as non-converted (manually authored)
## Output Placement
Converted files placed as siblings to the original. Extracted images and auxiliary files placed in a subdirectory named after the source file stem. The subdirectory is created for all formats during conversion — if no images are extracted, it is automatically removed after conversion.
```
docs/
    architecture.docx              ← source
    architecture.md                ← converted output
    architecture/                  ← assets subdirectory
        architecture_img1.png      ← extracted raster
        architecture_img2.svg      ← extracted vector
    presentation.pptx
    presentation.md                ← markdown with text + image links
    presentation/
        03_slide.svg               ← slide 3 (had diagrams)
        07_slide.svg               ← slide 7 (had images)
    report.pdf
    report.md
    report/
        02_page.svg                ← page 2 (had figures)
```
Image filenames in the markdown are prefixed with the subdirectory name so relative links resolve correctly from the sibling markdown.
Text-only pages/slides appear as markdown paragraphs in the `.md` without companion SVGs. Subdirectory is only populated when at least one page has graphical content.
## Doc Convert Tab
Accessed via a dedicated Doc Convert tab in the dialog.
### Tab Visibility
Visible only when:
1. markitdown is installed (availability query returns true)
2. At least one convertible file exists in the repository
When hidden — no tab slot consumed, layout identical to a repo without convertible documents.
### Layout
- Status banner — shows working tree state (clean or dirty with remediation); controls below disabled when dirty
- Toolbar — select-all / deselect-all buttons, file count summary, "Convert Selected (N)" button disabled when nothing selected or tree dirty
- Filter bar — text input with fuzzy matching against file paths; match count when filter active
- File list — scrollable list of convertible files (filtered when filter active), each row shows checkbox, file path, size, status badge
- Progress area — replaces the file list during conversion, showing per-file progress

### Status Badges

Each convertible file shows a status badge based on whether a converted output already exists:

| Badge | Meaning |
|---|---|
| new | No existing converted output — first conversion |
| stale | Converted output exists with docuvert header, but source hash has changed since conversion |
| current | Converted output exists with docuvert header and source hash matches — no conversion needed |
| conflict | Converted output exists but has no docuvert header — manually authored or externally converted |

Status determined by:

1. Check if sibling output file exists at the expected path
2. If no output — new
3. If output exists, parse first line(s) for a docuvert header
4. If no header — conflict
5. If header found, compare recorded hash against current source file hash
6. Match — current; mismatch — stale

- `current` files are shown but visually muted — they don't need re-conversion
- `conflict` files show a warning icon with tooltip explaining the file wasn't created by doc convert

### Conversion Flow

1. User opens Doc Convert tab
2. Clean tree check runs — if dirty, banner warning, controls disabled
3. File list populates with all convertible files and status badges
4. User selects files via checkboxes (none pre-selected — opt-in)
5. User clicks Convert Selected
6. Progress view replaces file list, showing per-file status — pending, converting, done, failed with reason
7. Conversions run sequentially
8. Data URI images in markdown output decoded and saved as separate files
9. On completion — progress view shows summary with counts
10. File picker refreshes — new files appear as untracked
11. User reviews diffs in the diff viewer, edits if needed, commits normally

### Conflict Handling

When a conflict file is selected and converted:

- Existing output is overwritten with converted content (including docuvert provenance header)
- Since working tree was clean on entry, overwritten file appears as a modification in git diff
- User can review the diff and decide whether to commit or discard
- Safe because clean-tree gate ensures original content is committed and recoverable

### Re-Conversion of Stale Files

When a stale file is selected and converted:

- Existing output is overwritten with fresh conversion
- Provenance header updated with new source hash
- Any images listed in the old header but not produced by the new conversion are deleted (orphan cleanup)
- New images are written and linked
- If user edited the output since last conversion, those edits are lost — acceptable because the clean-tree gate means edits are committed and recoverable, and the stale badge explicitly signals outdated content

## Directory Exclusions

File scanner skips the same directories excluded by the symbol index and doc index walkers:

- Hidden directories (starting with `.`), except common whitelisted ones
- Build/dependency directories — `node_modules`, `__pycache__`, `.venv`, `venv`, `dist`, `build`, `.egg-info`
- `.git`, the application's working directory
- Any directory matching gitignore patterns (via the same git-based filtering used for the flat file list)

## Configuration

Doc convert controlled via app config:

- Enabled flag — when false, the tab is hidden
- Supported extensions list — customize which file extensions are shown
- Maximum source size — source files larger than this shown with a warning badge and skipped during conversion; prevents enormous CSVs or PDFs from producing unwieldy markdown

## Integration with Document Index

- Converted markdown files are indexed by the document index exactly like hand-written markdown — no special treatment
- Indexing pipeline does not know or care whether a file was hand-written or converted
- Standard two-phase indexing applies — structural extraction (instant) then keyword enrichment (background)
- The docuvert HTML comment is invisible to the markdown extractor
- Extracted SVG files also indexed via the SVG extractor, providing structural awareness of diagrams
- After conversion and file picker refresh, the doc index picks up new files on the next structure re-extraction pass

## Graceful Degradation

When optional dependencies are missing, the feature degrades gracefully:

| Missing dependency | Behavior |
|---|---|
| markitdown | Tab hidden entirely — no empty tab, no error |
| python-pptx | pptx conversion fails with clear error message |
| PyMuPDF | pdf unavailable; pptx/odp fall back to python-pptx or markitdown |
| LibreOffice | pptx falls back to python-pptx; odp falls back to markitdown; pdf unaffected |

The availability query reports status of each dependency:

- markitdown available
- LibreOffice on PATH
- PyMuPDF importable
- Combined PDF pipeline available (both LibreOffice and PyMuPDF)

The feature is entirely optional — document index, mode toggle, keyword enrichment, and all other doc-mode features work without it.

## Progress Events

- Conversion runs in a dedicated single-thread executor, separate from the server's default executor
- Does not block UI interaction or the asyncio event loop
- Per-file progress and final summary delivered via server-push events using the same channel as other progress events
- Progress events post from the worker thread back to the event loop via thread-safe scheduling
- Synchronous fallback — when no event loop is running (e.g. in tests), conversion runs synchronously and returns the full results dict inline

## Service Methods

- Scan convertible files — returns list with status badges; includes clean-tree check
- Convert files — returns started status immediately, progress via events, requires clean tree; falls back to synchronous conversion if no event loop
- Is available — returns dict with availability of all dependencies

## Invariants

- Converted files always carry a docuvert provenance header
- Provenance header is invisible to markdown renderers and to the document index extractor
- Clean working tree is enforced — a dirty tree can never trigger conversion
- Error results are never silently overwritten — all conversion failures are reported
- Re-conversion of a stale file always cleans up orphan images from the previous conversion
- Files without a docuvert header are always treated as conflict — never silently overwritten without user selection
- The tab is hidden when markitdown is unavailable, never shown empty or errored