# Image Persistence

## Overview

Images pasted into the chat input are persisted to disk so they can be displayed when loading previous sessions. Stored as individual files in `.ac-dc/images/`, referenced by content hash in the JSONL history.

## Storage

### Directory

```
{repo_root}/.ac-dc/images/
    1736956800000-a1b2c3d4e5f6.png
    ...
```

### File Naming

`{epoch_ms}-{hash12}.{ext}` — timestamp for sort order, first 12 chars of SHA-256 of the data URI string for deduplication.

| MIME type | Extension |
|-----------|-----------|
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |
| fallback | `.png` |

### Writing

When `append_message` is called with image data:
1. For each base64 data URI: compute hash, extract MIME, decode, generate filename
2. Write to `.ac-dc/images/` (skip if exists)
3. Store filenames as `image_refs` in the JSONL record

### Reading

For each `image_refs` filename: read binary, determine MIME from extension, encode as base64 data URI. Missing files are skipped with a warning.

## History Schema Changes

```pseudo
image_refs: string[]?    # NEW: filenames in .ac-dc/images/
images: integer?         # DEPRECATED: kept for backward compat
```

Old messages with `images: integer` load correctly but won't have displayable images.

## What Does NOT Change

- Images are NOT re-sent to the LLM on subsequent messages — display-only after original send
- Token counting for images unchanged
- Image size limits unchanged (5MB per image, 5 per message)

## Cleanup

No automatic cleanup. Users can delete `.ac-dc/images/` to reclaim space.