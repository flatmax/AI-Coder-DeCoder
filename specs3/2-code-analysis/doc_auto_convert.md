# Document Auto-Convert

## Overview

The document auto-convert feature automatically converts non-markdown documents (`.docx`, `.pdf`, `.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`) to markdown files, placing the converted output alongside the original. Converted markdown is strictly superior in a git repo — it's diffable, human-readable, greppable, and editable by the LLM via the standard edit block protocol. Auto-convert brings this benefit without requiring the user to run external tools manually.

This feature integrates with the [Document Index](document_mode.md) — converted `.md` files are indexed exactly like hand-written markdown, flowing through the same extraction, keyword enrichment, and cache tiering pipeline.

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

If `markitdown` is not installed, auto-convert is disabled with a warning (same graceful degradation pattern as KeyBERT — see [Document Mode — Graceful Degradation in Packaged Releases](document_mode.md#graceful-degradation-in-packaged-releases)). Users running from source can install it with:

```bash
pip install ac-dc[docs]
# or
uv sync --extra docs
```

The `[docs]` extra already includes `keybert`; `markitdown` is added to the same extra so a single install enables both document features.

## Output Placement

Converted files are placed as **siblings** to the original:

```
docs/
    architecture.docx     ← source (gitignored)
    architecture.md       ← converted output (tracked by git)
    budget.xlsx           ← source (gitignored)
    budget.md             ← converted output (tracked by git)
    presentation.pptx     ← source (gitignored)
    presentation.md       ← converted output (tracked by git)
```

## Image Handling

Images embedded in source documents (e.g., figures in `.docx`, charts in `.pptx`) are extracted alongside the converted markdown:

- **Raster images** (PNG, JPEG, GIF, BMP, TIFF) are saved as-is in their original format next to the markdown file, and linked from the markdown via standard image syntax (`![alt](image.png)`)
- **Vector images** (EMF, WMF, SVG embedded in Office documents) are saved as `.svg` where the source format permits lossless conversion; otherwise saved as raster
- **No raster-to-SVG conversion** is attempted — wrapping a bitmap in an SVG container adds no value
- **Extracted image files** are added to the gitignore prompt alongside their source documents (see [Gitignore Management](#gitignore-management))

Image filenames are derived from the source document name with a numeric suffix:

```
docs/
    architecture.docx              ← source (gitignored)
    architecture.md                ← converted output (tracked)
    architecture_img_001.png       ← extracted image (gitignored)
    architecture_img_002.svg       ← extracted vector (tracked)
```

SVG images extracted from documents are indexed by the doc index (via `SvgExtractor`) like any other SVG file — they appear in the document outline with their text labels and structural content. Raster images are not indexed.

## Scan and Conversion Trigger

Auto-convert runs at two points, both piggy-backing on existing operations rather than requiring a dedicated file watcher:

1. **On startup** — during the deferred initialization phase, auto-convert runs **before** `_start_background_doc_index()`. This ensures converted `.md` files exist on disk when the doc index scans for files to extract and enrich. The sequence is: code index → auto-convert scan → doc index build (structure) → doc index enrichment (background)
2. **After file mutations** — a re-scan is triggered only when relevant: (a) when a file with a convertible extension is written via `write_file` or `create_file`, or (b) after git operations that may introduce new files (`reset_hard`, `checkout`). Writes to non-convertible files (`.py`, `.js`, etc.) do not trigger a scan. The scan is server-side — not on every `get_file_tree` RPC call from the frontend

This avoids the overhead of a persistent file system watcher (`inotify`/`fswatch`). The scan itself is cheap — it walks the repo looking for files matching the supported extensions, filtered by the same directory exclusion list used by the symbol index and doc index.

## Directory Exclusions

The auto-convert scanner skips the same directories excluded by the symbol index and doc index walkers:

- `.git/`, `.ac-dc/`
- `node_modules/`, `__pycache__/`, `.venv/`, `venv/`
- `dist/`, `build/`, `.egg-info/`
- Hidden directories (starting with `.`) except `.github/`
- Any directory matching patterns in `.gitignore` (via the same git-based filtering used by `Repo.get_flat_file_list()`)

## Staleness Detection

Each source document is hashed (SHA-256 of file content) before conversion. The hash is stored in a manifest file at `.ac-dc/autoconvert_manifest.json`:

```json
{
  "docs/architecture.docx": {
    "source_hash": "a1b2c3d4...",
    "output_path": "docs/architecture.md",
    "output_hash": "e5f6a7b8...",
    "converted_at": "2025-01-15T14:30:00Z",
    "images": ["docs/architecture_img_001.png", "docs/architecture_img_002.svg"]
  }
}
```

On each scan:
1. **New file** (not in manifest) → convert, add to manifest
2. **Changed file** (hash mismatch) → check if the `.md` output has been modified by the user (see [User-Edit Protection](#user-edit-protection)); if safe, re-convert and update manifest
3. **Unchanged file** (hash matches) → skip
4. **Deleted source file** → remove from manifest; leave the `.md` output in place (the user may want to keep it)
5. **Pending user response** (action toast shown but not yet answered) → skip; do not show a duplicate toast. The manifest records a `"pending": true` flag for files awaiting user response

When re-conversion occurs, images listed in the manifest's `images` array that are no longer produced by the new conversion are deleted from disk (orphan cleanup). New images are added to the manifest.

## User-Edit Protection

When a source document has changed and needs re-conversion, but the corresponding `.md` output has also been modified since the last conversion (i.e., the user edited the markdown directly), the system **does not overwrite silently**. Instead:

1. The conversion is paused for that file
2. An **action toast** is shown in the UI: `"⚠️ report.md has been edited since conversion from report.docx. Overwrite with new conversion? [Overwrite] [Skip]"`. This is a persistent toast with action buttons — a new toast variant extending the existing toast system (see [Chat Interface — Toast System](../5-webapp/chat_interface.md#toast-system)). Action toasts do not auto-dismiss; they remain until the user clicks a button
3. If the user clicks **Overwrite**, the markdown is regenerated from the updated source document (user edits are lost)
4. If the user clicks **Skip**, the file is left as-is and the manifest is updated to record the skip (so the warning doesn't repeat on every scan)

User-edit detection compares the `.md` file's current SHA-256 hash against the `output_hash` recorded in the manifest at conversion time. If the markdown was modified only by the auto-convert system (not by the user or LLM), the hashes match and re-conversion proceeds silently.

**LLM edits to converted files** are treated identically to user edits — if the LLM modifies `architecture.md` via edit blocks, and later `architecture.docx` is updated, the overwrite warning fires. This is correct behavior: the LLM's edits to the markdown are meaningful work that shouldn't be silently discarded.

## Naming Conflicts

If a markdown file already exists at the output path **before any auto-convert has run** (i.e., it's not in the manifest and wasn't created by a previous conversion), the system treats this as a conflict:

1. An **action toast** is shown: `"⚠️ docs/report.md already exists. Convert report.docx anyway? [Overwrite] [Skip]"` (persistent, same action toast variant as user-edit protection)
2. **Overwrite** replaces the existing file and begins tracking it in the manifest
3. **Skip** leaves the existing file untouched and records the skip in the manifest

This handles the case where a user previously converted manually (following the old workflow) and now auto-convert wants to take over.

## Gitignore Management

Source documents and extracted raster images should be in `.gitignore` so they aren't committed to the repository. Rather than modifying `.gitignore` automatically (which would alter a tracked file without user consent), the system **prompts the user** on first detection:

When convertible files are found and `.gitignore` does not already contain patterns for their extensions, a **one-time action toast** (persistent, with buttons) appears:

```
📄 Found 3 convertible documents (.docx, .pdf, .xlsx).
   Auto-convert will create .md files alongside them.
   [Add to .gitignore] [Dismiss]
```

Clicking **Add to .gitignore** appends a block of patterns for **source document extensions only**:

```gitignore
# Auto-convert source documents (originals kept locally, .md tracked)
*.docx
*.pdf
*.pptx
*.xlsx
*.csv
*.rtf
*.odt
```

Extracted raster images are **not** covered by blanket gitignore patterns — many repos contain intentional image assets (screenshots, logos, UI mockups) that must remain tracked. Instead, extracted image files are gitignored individually: when a conversion produces images, the auto-convert system appends their specific paths to `.gitignore` (e.g., `docs/architecture_img_001.png`). These per-file entries are managed automatically — added on conversion, removed on manifest cleanup.

The user can review and edit the `.gitignore` to be more specific (e.g., `docs/*.docx` instead of `*.docx`) if blanket document patterns are too broad. The prompt only fires once — a flag in `.ac-dc/autoconvert_manifest.json` records that the user has been prompted (`"gitignore_prompted": true`).

## Configuration

Auto-convert is controlled via `app.json`:

```json
{
  "doc_auto_convert": {
    "enabled": true,
    "extensions": [".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt"],
    "max_source_size_mb": 50
  }
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Enable/disable auto-convert entirely |
| `extensions` | list[str] | All supported | Which file extensions to convert. Remove entries to skip formats |
| `max_source_size_mb` | int | `50` | Source files larger than this are skipped with a warning toast. Prevents enormous CSVs or PDFs from producing unwieldy markdown |

When `enabled` is `false`, the scanner does not run and no toasts appear. Existing converted files and the manifest remain in place, so re-enabling does not re-prompt for files that were already converted or skipped.

## Integration with Document Index

Converted `.md` files are indexed by the document index exactly like any other markdown file — no special treatment. The indexing pipeline does not know or care whether a `.md` file was hand-written or auto-converted. The standard two-phase indexing applies:

1. **Structure extraction** (instant) — headings, links, section sizes extracted from the `.md` file
2. **Keyword enrichment** (background) — KeyBERT processes the converted content

Extracted `.svg` images are also indexed by the doc index via `SvgExtractor`, providing structural awareness of diagrams and illustrations embedded in the original documents.

## Auto-Convert Pipeline Sequence

```
File tree refresh / startup scan
    │
    ├── Walk repo directories (excluding node_modules, venv, .git, etc.)
    ├── Find files matching configured extensions
    ├── For each convertible file:
    │     ├── Check file size against max_source_size_mb → skip with warning toast if exceeded
    │     ├── Check manifest for existing entry
    │     ├── Hash source file (SHA-256)
    │     ├── If new → convert, save .md + images, update manifest
    │     ├── If changed (hash mismatch):
    │     │     ├── Check if .md output was user-edited (hash comparison)
    │     │     ├── If user-edited → show warning toast, wait for response
    │     │     └── If not user-edited → re-convert silently, update manifest
    │     └── If unchanged → skip
    ├── If first run and .gitignore lacks patterns → show gitignore prompt toast
    ├── Trigger doc index re-scan for any new/changed .md files
    └── Send autoconvert_complete via compactionEvent → frontend updates scan status
        (action toasts for user-edit/naming conflicts remain until the user responds)
```

## Graceful Degradation

When `markitdown` is not installed:

1. **Backend:** `doc_auto_convert_available` property returns `False`. No scanning or conversion occurs
2. **Frontend:** If the user has `enabled: true` in config but the library is missing, a one-time warning toast appears: `"📄 Document auto-convert requires markitdown. Install with: pip install ac-dc[docs]"`
3. **Terminal:** A `logger.warning` is emitted during startup

The feature is entirely optional — the document index, mode toggle, keyword enrichment, and all other doc-mode features work without it.

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Repo scan for convertible files | <100ms | Simple extension matching during directory walk |
| SHA-256 hash of source document | <10ms | Even for large (50MB) files |
| Convert `.docx` (10 pages) | ~200-500ms | markitdown, depends on content complexity |
| Convert `.pdf` (50 pages) | ~1-5s | Depends on text extraction complexity |
| Convert `.xlsx` (5 sheets) | ~100-300ms | Table formatting is fast |
| Convert `.pptx` (30 slides) | ~300-800ms | Slide text extraction |
| Full scan + convert (10 new docs) | ~2-10s | Runs in background, non-blocking |

Conversion runs in a background executor (same pattern as keyword enrichment) and never blocks user interaction. Progress is not reported per-file for conversions — the operation is fast enough that a simple completion toast suffices.

## Testing

- Scan discovers files matching configured extensions in repo directories
- Scan skips excluded directories (node_modules, venv, .git, etc.)
- New file conversion creates sibling `.md` with correct content
- Changed source file triggers re-conversion when `.md` is unmodified
- Changed source file with user-edited `.md` does not overwrite silently
- Unchanged source file is skipped (hash match)
- Deleted source file leaves `.md` in place
- Naming conflict with pre-existing `.md` shows warning
- Manifest records source hash, output hash, output path, conversion timestamp, image list
- Gitignore prompt fires once on first detection, records prompted state
- Extracted images are linked from markdown with correct relative paths
- Graceful degradation when markitdown is not installed
- Configuration `enabled: false` disables all scanning
- Custom extension list in config is respected
- Files exceeding `max_source_size_mb` are skipped with a warning
- Converted `.md` files are indexed normally by doc index
- Orphan images cleaned up on re-conversion
- Pending action toasts not duplicated on re-scan