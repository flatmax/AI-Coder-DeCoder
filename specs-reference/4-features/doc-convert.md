# Reference: Document Convert

**Supplements:** `specs4/4-features/doc-convert.md`

## Byte-level formats

### Markdown output provenance header

The first line of every converted `.md` file is an HTML comment with exact shape:

```
<!-- docuvert: source={source_filename} sha256={hex_digest} images={comma_separated_filenames} -->
```

Example with images:

```
<!-- docuvert: source=architecture.docx sha256=a1b2c3d4e5f6789... images=architecture_img1.png,architecture_img2.svg -->
```

Example without images (omitted entirely, not present as empty list):

```
<!-- docuvert: source=report.docx sha256=f6e5d4c3b2a1... -->
```

Field rules:

| Field | Required | Format |
|---|---|---|
| `source` | ✓ | Filename of the source document (no path; always a sibling in the same directory) |
| `sha256` | ✓ | Full 64-char lowercase hex digest of the source file's content at conversion time |
| `images` | optional | Comma-separated list of image filenames without paths; omitted entirely when no images were extracted |

The header is always on line 1 of the file. No blank line before the comment — converters that add a BOM or whitespace prefix break the parser.

### Extracted SVG provenance header

SVG images extracted by the converter carry an XML comment at the top:

```xml
<!-- docuvert: parent={parent_md_filename} source={source_filename} sha256={hex_digest} img_index={1-based-integer} -->
<svg xmlns="http://www.w3.org/2000/svg" ...>
```

Field rules:

| Field | Required | Format |
|---|---|---|
| `parent` | ✓ | The `.md` filename this SVG is linked from |
| `source` | ✓ | Original source document filename (same as parent's `source`) |
| `sha256` | ✓ | Same SHA-256 as parent — full 64-char lowercase hex |
| `img_index` | ✓ | 1-based integer index of this image within the parent's conversion output |

### Header parser

The parser scans the first 2048 bytes of the file for a regex match:

```
<!-- docuvert: ([^>]+?) -->
```

Within the captured body, fields are extracted as space-separated `key=value` pairs. The parser is lenient:

- Unknown fields are captured into an `extra` dict and ignored by downstream consumers
- Missing optional fields (like `images` on markdown, or extras) don't fail the parse
- Missing required fields (`source`, `sha256`) cause the parser to return None — the file is treated as non-converted
- Files without any `<!-- docuvert: ... -->` comment return None cleanly

### Image filename conventions

| Context | Pattern |
|---|---|
| Images extracted from `.docx` / `.rtf` / `.odt` data URIs | `{stem}_img{N}{ext}` where N is 1-based sequential |
| DOCX zip-extracted images (truncated-URI replacement) | `{stem}_img{N}{ext}` where N is 1-based sequential; JPEG extensions normalized to `.jpg` |
| PowerPoint slide SVGs (fallback pipeline only) | `{NN}_slide.svg` with zero-padded slide number |
| PDF page SVGs (PyMuPDF pipeline) | `{NN}_page.svg` with zero-padded page number |
| SVG externalized images from PDF/PPTX | `{svg_stem}_img{page_index}_{counter}{ext}` |

Zero-padding width matches the total slide/page count — a 7-slide deck pads to `01`..`07`, a 100-slide deck pads to `001`..`100`.

Image assets are placed in a subdirectory named after the source file stem, created as a sibling of the converted `.md`:

```
docs/
    architecture.docx              ← source
    architecture.md                ← output with provenance header
    architecture/                  ← assets subdirectory (source stem)
        architecture_img1.png      ← extracted image
        architecture_img2.svg      ← extracted image
```

Image references inside the `.md` use the subdirectory prefix (`architecture/architecture_img1.png`) so relative links resolve correctly from the sibling output file.

If no images are extracted, the subdirectory is removed after conversion.

### Status classification logic

For each convertible file found during scanning, the status is determined by the following ordered decision tree:

1. Does the output `.md` file exist? → No: **new**
2. Read first 2048 bytes of output, scan for `<!-- docuvert: ... -->` header
3. Header absent? → **conflict** (manually authored or externally converted)
4. Parse header; missing required fields (`source`, `sha256`)? → **conflict** (malformed header)
5. Compute current source file SHA-256; matches header's `sha256`? → **current**
6. Hash differs? → **stale**

Status values are literal strings: `"new"`, `"stale"`, `"current"`, `"conflict"`.

## Numeric constants

### Header probe size

```
2048 bytes
```

The provenance parser reads only the first 2048 bytes of the output file to find the header. Large enough for any realistic header placement (header is always on line 1); small enough that scanning is cheap even for very large converted files. Files with no header in the first 2048 bytes are treated as headerless (conflict status).

### Default supported extensions

Configured in `doc_convert.extensions` (see `specs-reference/1-foundation/configuration.md`). Hardcoded default when config omits the list:

```
[".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt", ".odp"]
```

Extension matching is case-insensitive — `.DOCX` matches.

### Default maximum source size

```
50 MB
```

Configured in `doc_convert.max_source_size_mb`. Files larger than this show a warning badge in the UI and are skipped during conversion (not converted, not marked stale — explicit skip status in the result).

### PDF image detection thresholds

A PDF page triggers SVG export when one of these conditions holds:

| Condition | Rule |
|---|---|
| Raster images present | `page.get_images()` returns any entry → significant |
| Significant drawings | `page.get_drawings()` produces drawings matching rules below |

Drawing significance rules:

| Drawing type | Significant? |
|---|---|
| Curves (Bézier `c`, quadratic `qu` operations) | Always significant |
| Filled polygons with >2 segments | Significant |
| Complex paths with >4 segments | Significant |
| Simple rectangles, single lines | Not significant |

**Threshold**: at least 3 significant drawings required to trigger SVG export. Pages below the threshold with no raster images are treated as text-only and produce no companion SVG. Pages with zero extractable text AND zero detected content still receive a full-page SVG as a fallback to avoid silently dropping lightweight vector content.

### Excel colour clustering thresholds

Cell fill colours are classified via distance in RGB space:

| Constant | Value | Purpose |
|---|---|---|
| Near-white ignore distance | 20 | RGB Euclidean distance below which a fill is treated as unfilled (ignores default white + near-whites used by spreadsheet themes) |
| Near-black ignore distance | 20 | Same treatment for borders or dark-theme defaults |
| Named-colour match radius | 40 | RGB distance under which a fill is matched to a named emoji marker (🔴 red, 🟢 green, 🟡 yellow, 🔵 blue, etc.) |
| Fallback clustering radius | 20 | RGB distance under which unnamed fills cluster together and receive the same fallback marker symbol |

Named colour markers and fallback symbols:

| Named colour | Emoji |
|---|---|
| red | 🔴 |
| green | 🟢 |
| yellow | 🟡 |
| blue | 🔵 |
| orange | 🟠 |
| purple | 🟣 |
| brown | 🟤 |
| black | ⚫ |
| white | ⚪ |
| Fallback cluster 1 | ⬛ |
| Fallback cluster 2 | ◆ |
| Fallback cluster 3 | ▲ |
| Fallback cluster 4 | ● |
| Fallback cluster 5 | ■ |
| Fallback cluster 6+ | ★ (cycles) |

### PowerPoint EMU-to-pixel conversion

python-pptx exposes slide dimensions in English Metric Units (EMU). Conversion for SVG output:

```
1 inch = 914400 EMU
1 inch = 96 pixels (web standard at 100% zoom)
1 EMU = 96 / 914400 pixels
```

SVG viewBox uses the pixel-converted dimensions directly.

### LibreOffice subprocess timeout

```
60 seconds
```

Applied to `soffice --headless --convert-to pdf ...` invocations in the pptx/odp pipeline. If LibreOffice hangs or takes longer, the pipeline falls back to python-pptx (for pptx) or markitdown (for odp).

### PyMuPDF subprocess behavior

No subprocess — PyMuPDF is a Python library (`fitz`). No timeout is applied; PyMuPDF operations are CPU-bound and return when complete.

## Schemas

### Scan result per-file entry

`DocConvert.scan_convertible_files()` returns a list of entries. Each entry:

```pseudo
ScanEntry:
    path: string                    // Repo-relative path to source file
    name: string                    // Basename only
    size: int                       // Source file size in bytes
    status: "new" | "stale" | "current" | "conflict"
    output_path: string             // Repo-relative path where the .md would land or already exists
    over_size: bool?                // Present when size > max_source_size_mb; UI warning badge
```

### Convert result per-file entry

`DocConvert.convert_files(paths)` eventually delivers a result per path (via `docConvertProgress` events). Each result:

```pseudo
ConvertResult:
    path: string                     // Source file path (same as input)
    status: "ok" | "error" | "skipped"
    message: string?                 // Error detail or skip reason
    output_path: string?             // Written .md path on success
    images: list[string]?            // Extracted image filenames on success
```

### Pattern regexes

Three regexes are load-bearing in the conversion pipeline:

**Provenance header match** (applied to first 2048 bytes):

```
<!-- docuvert: ([^>]+?) -->
```

**Data URI image reference** (found in markitdown output, extracted and replaced with file links):

```
!\[([^\]]*)\]\(data:image/([^;]+);base64,([^)]+)\)
```

Captured groups: `(alt_text, mime_subtype, base64_payload)`. Used to decode and save images to the assets subdirectory.

**DOCX truncated URI** (markitdown-specific output for large embedded images):

```
!\[([^\]]*)\]\(data:image/([^;]+);base64\.{3}\)
```

Three literal dots inside the parens where the base64 payload should be. Matched references are replaced with filenames from DOCX zip media in document order.

## Dependency quirks

### markitdown truncated URI behavior

For `.docx` files with large embedded images, markitdown produces references of the form `![alt](data:image/png;base64...)` where the base64 payload is literally three dots (not actual image data). The conversion pipeline handles this in two steps:

1. **Extract real images from the docx zip** — `.docx` is a ZIP archive; images live under `word/media/`. Unzip and save each as `{stem}_img{N}{ext}` in document order
2. **Substitute references** — for each truncated URI in markitdown's output, replace with the next filename from the extracted list

The two steps must run in order. Real data URIs (with actual payloads) in the same output are handled by the standard data-URI extraction pipeline afterwards.

### SHA-256 on source, not output

The provenance header's `sha256` field is the hash of the **source file** (the `.docx`, `.pdf`, etc.), not the generated markdown. Rationale: detecting stale output requires comparing source-then against source-now. Hashing the output would require reading and re-converting the source to see if the output would change, which is what we're trying to avoid.

### JPEG extension normalization

Images extracted from `.docx` zips or data URIs may have MIME subtype `jpeg` or `jpg`. The converter normalizes all of these to `.jpg` (three-character extension). The provenance header's `images=` field lists the normalized filenames.

### SVG image externalization

SVG files generated by the PDF pipeline may contain embedded base64 `<image>` data URIs (inline raster images from PDF pages). The `_externalize_svg_images()` pass:

1. Scans SVG text for `href="data:image/...;base64,..."` and `xlink:href="data:image/...;base64,..."` (both attribute forms)
2. Strips whitespace and newlines from the base64 payload (PyMuPDF wraps long payloads)
3. Decodes and saves each image as `{svg_stem}_img{page_index}_{counter}{ext}` in the assets subdirectory
4. Replaces the data URI in the SVG with a filename reference

Externalized image filenames are included in the parent `.md`'s `images=` field for orphan cleanup on re-conversion.

### SVG text preservation in PDF pipeline

PyMuPDF's `page.get_svg_image()` emits text as `<text>` elements when called with `text_as_path=0`. This preserves selectable text and produces smaller SVGs. Text content is also duplicated into the companion markdown file for searchability — so the same text exists in both the SVG (for visual fidelity and selection) and the markdown (for grep and LLM context). This is deliberate, not a bug.

### LibreOffice path dependency

The pptx/odp primary pipeline requires the `soffice` binary on PATH. When absent:

- `.pptx` falls back to python-pptx (full SVG per slide via direct rendering)
- `.odp` falls back to markitdown (plain text extraction; loses slide structure)

`.pdf` files are unaffected — PyMuPDF reads PDF directly without needing LibreOffice.

## Cross-references

- Behavioral pipeline dispatch, clean-tree gate, tab visibility, conversion flow, graceful degradation: `specs4/4-features/doc-convert.md`
- Config defaults for `doc_convert` section (enabled, extensions, max_source_size_mb): `specs-reference/1-foundation/configuration.md`
- Document index consumes converted `.md` files: `specs4/2-indexing/document-index.md`
- SVG extractor indexes extracted SVG images: `specs-reference/2-indexing/document-index.md` (when created; for now see `specs4/2-indexing/document-index.md`)