# Image Persistence

**Status:** stub

Images pasted into the chat input are persisted to disk so they can be displayed when loading previous sessions. Stored as individual files in the per-repo working directory, referenced by content hash in the JSONL history.

## Storage Location

- Images subdirectory within the per-repo working directory
- Created on working directory init and on history store construction (both idempotent, whichever runs first wins)

## File Naming

- Timestamp prefix plus short content-hash suffix
- Extension derived from MIME type with a fallback for unknown types
- Deduplication via content hash — identical data URIs produce identical filenames

### MIME to Extension Mapping

| MIME | Extension |
|---|---|
| PNG | .png |
| JPEG | .jpg |
| GIF | .gif |
| WebP | .webp |
| Fallback | .png |

## Writing Flow

- When a user message with images is persisted, each base64 data URI is processed
- Hash computed, MIME extracted, data decoded, filename generated
- Write to images directory, skip if file already exists (deduplication)
- Store filenames list as image refs in the JSONL record

## Reading Flow

- For each image ref filename, read binary data
- Determine MIME from extension
- Encode as base64 data URI
- Missing files skipped with a warning

## Message Schema Interaction

- Image refs field on JSONL records — list of filenames in the images directory
- Legacy image count field — kept for backward compatibility, deprecated
- Old messages with count-only field load correctly but won't have displayable images

## LLM Service Integration

- Streaming handler passes the actual image data URIs (list of strings) to the persistence layer, not just a count
- The persistence method accepts either a list of strings (saves each image, stores filenames as refs) or an integer (legacy path, stored as-is)

## Session Loading

- Load-session-into-context, get-session-messages-for-context, and history-get-session all reconstruct images from refs
- Frontend receives data URI arrays ready to render
- Each reconstruction is independent — a failed image read does not prevent other images from loading

## Frontend Paste Input

- Accepted formats — PNG, JPEG, GIF, WebP
- Size limit per image (default 5MB) — reject before encoding with a visible error
- Maximum images per message (default 5)
- Encoding — base64 data URI
- Display — thumbnail previews with remove button, below textarea
- Token counting — provider's image token formula; fallback estimate per image

## Frontend Message Display

- Thumbnails in user cards with a re-attach overlay button (appears on hover)
- Clicking a thumbnail opens a lightbox overlay
- Lightbox — full-size view, Escape to close, re-attach action button at bottom
- Overlay is focusable for keyboard handling but does not implement full focus trapping

## Re-Attaching Previous Images

Two interaction paths to re-attach an image to the current input:

- Thumbnail overlay — small button (top-right, on hover) on the thumbnail
- Lightbox action — button at the bottom of the lightbox view

### Behavior

- Adds the data URI to the pending images array (same array used by paste)
- Respects the per-message limit — toast on overflow
- Duplicate detection — same data URI cannot be attached twice
- Confirmation toast on success
- Image appears in the thumbnail preview strip below the textarea, identical to a freshly pasted image
- Lightbox action button turns a success color on click for visual confirmation; lightbox stays open

### Scope

- Current session messages (stored as data URI arrays on message objects)
- Loaded history sessions (reconstructed from refs as multimodal content blocks)
- Both rendering paths wrap thumbnails so the overlay button is consistent

## What Does Not Change

- Images are not automatically re-sent to the LLM on subsequent messages — display-only after original send (but can be manually re-attached)
- Token counting for images unchanged
- Image size and count limits unchanged

## Cleanup

- No automatic cleanup
- Users can delete the images directory to reclaim space without affecting functionality (messages load without images, no errors)
- A future enhancement could add an explicit cleanup method that cross-references all refs in the JSONL against files in the images directory and removes orphans

## Invariants

- Identical image data URIs produce identical filenames (content-hash-based)
- Writing is idempotent — re-persisting a message never produces duplicate files
- Missing image files never fail message load — just skipped with a warning
- Per-message image count limit is enforced at paste, re-attach, and message send
- Re-attach never bypasses the deduplication or count limit