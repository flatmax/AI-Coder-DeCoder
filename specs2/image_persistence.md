# Image Persistence

## Overview

Images pasted into the chat input are persisted to disk so they can be displayed when loading previous sessions. Images are stored as individual files in `.ac-dc/images/`, referenced by content hash. The JSONL history stores hash references instead of inline base64 data, keeping the history file lean.

## Storage

### Directory

```
{repo_root}/.ac-dc/
    images/
        1736956800000-a1b2c3d4e5f6.png
        1736956860000-f7g8h9i0j1k2.png
        ...
```

The `images/` directory is created on first image save. It lives inside `.ac-dc/` which is already gitignored.

### File Naming

Each image file is named with a timestamp prefix followed by a content hash, with the appropriate extension extracted from the MIME type:

```
{epoch_ms}-{hash12}.{ext}
```

Example: `1736956800000-a1b2c3d4e5f6.png`

- **Timestamp**: millisecond epoch at time of save — provides chronological sort order on disk
- **Hash**: first 12 characters of the SHA-256 hash of the base64 data URI string — provides deduplication key

| MIME type | Extension |
|-----------|-----------|
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |
| fallback | `.png` |

Duplicate images (same content pasted twice within the same millisecond) produce the same filename and are stored only once. Images with the same content at different times get separate files — this is acceptable since exact duplicate pastes across messages are rare, and the small redundancy is preferable to the complexity of a separate dedup index.

### Writing

When `append_message` is called with image data:

1. For each base64 data URI in the images list:
   a. Compute SHA-256 hash of the full data URI string (first 12 hex chars)
   b. Extract MIME type from the `data:image/TYPE;base64,` prefix
   c. Decode the base64 payload to binary
   d. Generate filename: `{epoch_ms}-{hash12}.{ext}`
   e. Write to `.ac-dc/images/{filename}` (skip if file already exists)
2. Store the list of filenames in the JSONL message as `image_refs`

### Reading

When loading a session, for each message with `image_refs`:

1. For each filename in `image_refs`:
   a. Read the binary file from `.ac-dc/images/{filename}`
   b. Determine MIME type from extension
   c. Encode as base64 data URI: `data:image/{type};base64,{encoded}`
2. Attach the reconstructed data URIs to the message for display

If an image file is missing (deleted manually, corrupted), skip it silently and log a warning. The message still loads — just without that image.

## History Store Changes

### Message Schema

The `images` field changes from an integer count to a list of filename references:

```pseudo
HistoryMessage:
    ...existing fields...
    image_refs: string[]?    # e.g. ["a1b2c3d4e5f6.png", "f7g8h9i0j1k2.png"]
    images: integer?         # DEPRECATED — kept for backward compatibility reading
```

### Backward Compatibility

Old messages with `images: integer` continue to load correctly — they just won't have displayable images (the count is informational only, as before). New messages use `image_refs` instead.

### `append_message` Signature Change

```pseudo
append_message(
    session_id, role, content,
    files?, files_modified?, edit_results?,
    images?        # Changes from int to list[str] (base64 data URIs)
) -> dict
```

When `images` is a list of strings (data URIs), the method:
1. Saves each image to `.ac-dc/images/`
2. Stores the resulting filenames as `image_refs` in the JSONL record

When `images` is an integer (legacy callers), stores it as before.

## LLM Service Changes

### Persisting Images

In `_stream_chat`, pass the actual image data URIs to `append_message` instead of `len(images)`:

```pseudo
self._history_store.append_message(
    session_id=self._session_id,
    role="user",
    content=message,
    files=valid_files or None,
    images=images if images else None,    # Pass full list, not len()
)
```

### Loading Sessions

`load_session_into_context` and `get_session_messages_for_context` reconstruct images from `image_refs` so the frontend can display them.

`history_get_session` also reconstructs images for the history browser.

## Frontend Changes

### Message Display

When messages loaded from a session contain `images` (as data URI arrays), the chat panel renders them as thumbnails in user message cards — identical to the current in-session display.

### History Browser

Session messages in the history browser also display image thumbnails when available.

## What Does NOT Change

- **Images are NOT re-sent to the LLM** on subsequent messages or session reload. They are display-only after the original send. The LLM context assembly (`assemble_messages` / `assemble_tiered_messages`) only attaches images from the current request.
- **Token counting** for images is unchanged — images are counted once when sent, not on reload.
- **Image size limits** are unchanged (5MB per image, 5 images per message).

## Cleanup

No automatic cleanup of orphaned image files. The `.ac-dc/` directory is already ephemeral per-repo storage. Users can delete `.ac-dc/images/` to reclaim space without affecting functionality (session messages will just show without images).

A future enhancement could add `history_cleanup_images()` that cross-references all `image_refs` in the JSONL against files in the images directory and removes orphans.