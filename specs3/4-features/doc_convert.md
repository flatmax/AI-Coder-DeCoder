# Document Convert

## Overview

Document convert is a **dialog-driven tool** (not a background auto-convert) for converting non-markdown documents (`.docx`, `.pdf`, `.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`) to markdown files. It requires a clean git working tree — the same gate as code review mode — so all converted files appear as clear, reviewable diffs. The user selects which files to convert, reviews the results, and commits normally.

Converted markdown is strictly superior in a git repo — it's diffable, human-readable, greppable, and editable by the LLM via the standard edit block protocol. Document convert brings this benefit without requiring the user to run external tools manually.

Converted `.md` files are indexed by the [Document Index](../2-code-analysis/document_mode.md) exactly like hand-written markdown, flowing through the same extraction, keyword enrichment, and cache tiering pipeline.

## Supported Formats

| Extension | Source Type | Conversion Notes |
|-----------|-----------|-----------------|
| `.docx` | Word document | Full content including tables, headings, lists |
| `.pdf` | PDF document | Text extraction; layout-heavy PDFs may lose formatting |
| `.pptx` | PowerPoint | Slide headings and text content; one section per slide |
| `.xlsx` | Excel spreadsheet | Sheet names as headings, data as markdown tables |
| `.csv` | Comma-separated values | Converted to a markdown table |
| `.rtf` | Rich text format | Text content with basic formatting |
| `.odt` | OpenDocument text | Full content similar to `.docx` |

## Conversion Backend

The primary conversion backend is **markitdown** (Microsoft's Python library):

- Pure Python — no external binary dependency (unlike `pandoc`)
- Handles all supported formats in a single library
- Fits the existing packaging model (PyInstaller can bundle it)
- Actively maintained, broad format coverage

If `markitdown` is not installed, the Doc Convert tab is hidden and conversion is unavailable (same graceful degradation pattern as KeyBERT — see [Document Mode — Graceful Degradation in Packaged Releases](../2-code-analysis/document_mode.md#graceful-degradation-in-packaged-releases)). Users running from source can install it with:

```bash
pip install ac-dc[docs]
# or
uv sync --extra docs
```

The `[docs]` extra already includes `keybert`; `markitdown` is added to the same extra so a single install enables both document features.

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

Converted files are placed as **siblings** to the original:

```
docs/
    architecture.docx              ← source
    architecture.md                ← converted output
    architecture_img_001.png       ← extracted raster image
    architecture_img_002.svg       ← extracted vector image
    budget.xlsx                    ← source
    budget.md                      ← converted output
```

## Image Handling

Images embedded in source documents (e.g., figures in `.docx`, charts in `.pptx`) are extracted alongside the converted markdown:

- **Raster images** (PNG, JPEG, GIF, BMP, TIFF) are saved as-is in their original format next to the markdown file, and linked from the markdown via standard image syntax (`![alt](image.png)`)
- **Vector images** (EMF, WMF, SVG embedded in Office documents) are saved as `.svg` where the source format permits lossless conversion; otherwise saved as raster
- **No raster-to-SVG conversion** is attempted — wrapping a bitmap in an SVG container adds no value

Image filenames are derived from the source document name with a numeric suffix (e.g., `architecture_img_001.png`). Extracted SVG images carry a provenance header (see above) and are indexed by the doc index via `SvgExtractor`.

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
2. **File list** — scrollable list of all convertible files in the repo, each row showing:
   - Checkbox for selective conversion
   - File path (relative to repo root)
   - File size
   - Status badge (see below)
3. **Toolbar** — "Select All" / "Deselect All" buttons, file count summary ("3 of 7 selected")
4. **Convert button** — "Convert Selected (N)" at the bottom, disabled when nothing is selected or tree is dirty
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
7. Conversions run sequentially in a background executor
8. On completion, progress view shows summary: "Converted 5 files. 1 failed."
9. File picker refreshes — new `.md` and image files appear as untracked
10. User reviews diffs in the diff viewer, edits if needed, commits normally

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
    "extensions": [".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt"],
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

The feature is entirely optional — the document index, mode toggle, keyword enrichment, and all other doc-mode features work without it.

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Repo scan for convertible files | <100ms | Simple extension matching during directory walk |
| SHA-256 hash of source document | <10ms | Even for large (50MB) files |
| Provenance header parsing | <1ms | Single regex on first line |
| Convert `.docx` (10 pages) | ~200-500ms | markitdown, depends on content complexity |
| Convert `.pdf` (50 pages) | ~1-5s | Depends on text extraction complexity |
| Convert `.xlsx` (5 sheets) | ~100-300ms | Table formatting is fast |
| Convert `.pptx` (30 slides) | ~300-800ms | Slide text extraction |
| Full conversion (10 files) | ~2-10s | Sequential in background executor |

Conversion runs in a background executor and does not block UI interaction. The progress view provides per-file feedback.

## RPC Methods

| Method | Description |
|--------|-------------|
| `DocConvert.scan_convertible_files()` | Returns list of convertible files with status badges. Includes clean-tree check |
| `DocConvert.convert_files(paths: list[str])` | Converts selected files. Returns per-file results. Requires clean tree |
| `DocConvert.is_available()` | Returns whether markitdown is installed |

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
- Extracted images linked from markdown with correct relative paths
- Orphan images cleaned up on re-conversion (images in old header but not in new output)
- Graceful degradation when markitdown is not installed (tab hidden, no errors)
- Configuration `enabled: false` hides the tab
- Custom extension list in config is respected
- Files exceeding `max_source_size_mb` are shown with warning and skipped during conversion
- Converted `.md` files are indexed normally by doc index (HTML comment invisible to extractor)