// Image utility helpers — MIME validation, size estimation,
// extraction from ClipboardEvent.
//
// Pulled out of chat-panel.js so the validation logic is
// unit-testable without mounting a Lit component or faking
// a paste event. The chat panel is the only consumer.
//
// Design principle — the frontend deals only in data URIs
// (strings), never in Blob / File objects. The backend's
// HistoryStore writes binary to disk and serves data URIs
// back on session restore, so keeping the frontend
// string-native avoids two conversions per image.

/** Accepted image MIME types. Matches specs4/4-features/images.md. */
const ACCEPTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/** Maximum bytes per image. 5 MiB per specs. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Maximum images per message. 5 per specs. */
export const MAX_IMAGES_PER_MESSAGE = 5;

/**
 * Return true if the MIME type is an accepted image format.
 * Defensive against non-string input — clipboard items can
 * come through with unexpected shapes in some browsers.
 */
export function isAcceptedImageMime(mime) {
  if (typeof mime !== 'string') return false;
  return ACCEPTED_IMAGE_MIMES.has(mime.toLowerCase());
}

/**
 * Estimate decoded byte size from a base64 data URI.
 *
 * A base64 data URI has shape `data:{mime};base64,{payload}`.
 * The decoded size is `ceil(payload.length * 3 / 4)` minus
 * padding. We approximate with `payload.length * 0.75` which
 * is accurate to within 2 bytes — close enough for a 5 MiB
 * limit check.
 *
 * Returns 0 for anything that isn't a recognisable base64
 * data URI so validation treats malformed input as "over
 * limit = reject" only after a separate MIME check. Callers
 * that get a 0 should NOT assume the image is fine; they
 * should have already validated the MIME and shape.
 */
export function estimateDataUriBytes(dataUri) {
  if (typeof dataUri !== 'string') return 0;
  const commaIdx = dataUri.indexOf(',');
  if (commaIdx === -1) return 0;
  // Confirm this is actually a base64 data URI; non-base64
  // URIs (like `data:image/svg+xml,<svg>...`) are percent-
  // encoded and our size estimator doesn't apply.
  const header = dataUri.slice(0, commaIdx);
  if (!header.includes(';base64')) return 0;
  const payload = dataUri.slice(commaIdx + 1);
  // Subtract padding so we don't over-count — each trailing
  // `=` represents one fewer decoded byte.
  let padding = 0;
  if (payload.endsWith('==')) padding = 2;
  else if (payload.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor(payload.length * 0.75) - padding);
}

/**
 * Extract image data URIs from a ClipboardEvent.
 *
 * The clipboard API exposes items via `clipboardData.items`
 * — each item has `kind` ('file' | 'string') and `type`
 * (MIME). Image pastes come through with `kind === 'file'`
 * (browsers wrap the pasted bitmap in a File) and an
 * image/* MIME type.
 *
 * Returns a Promise for an array of data URIs. Non-image
 * items are skipped. Items with unreadable blobs are
 * skipped with a warning — don't fail the whole paste
 * because one item misbehaved.
 *
 * The FileReader calls are sequential rather than parallel.
 * Typical clipboard paste is one image; the overhead of
 * `Promise.all` + `Promise.allSettled` vs sequential await
 * is irrelevant for n=1, and sequential processing gives
 * deterministic order in the multi-image case.
 */
export async function extractImagesFromClipboard(clipboardData) {
  if (!clipboardData || !clipboardData.items) return [];
  const results = [];
  // Iterate via a plain for loop — DataTransferItemList is
  // array-like but not a true array, so `for...of` works
  // but indexed access is more obviously safe.
  for (let i = 0; i < clipboardData.items.length; i += 1) {
    const item = clipboardData.items[i];
    if (!item) continue;
    if (item.kind !== 'file') continue;
    if (!isAcceptedImageMime(item.type)) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    try {
      const dataUri = await _blobToDataUri(blob);
      if (dataUri) results.push(dataUri);
    } catch (err) {
      console.warn('[image-utils] blob read failed', err);
    }
  }
  return results;
}

/**
 * Read a Blob into a base64 data URI string via FileReader.
 * Wraps the callback-style API in a Promise so callers can
 * await it naturally.
 *
 * @private
 */
function _blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('FileReader produced non-string result'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Normalise a message whose `content` may be a plain string
 * or an array of multimodal blocks (the backend's format
 * for messages with images). Returns `{content, images}`
 * where content is always a string and images is always an
 * array (possibly empty).
 *
 * Multimodal block shapes handled:
 *   - `{type: 'text', text: '...'}` → append to content
 *   - `{type: 'image_url', image_url: {url: '...'}}` →
 *     append to images if the URL is a data URI
 *   - Any other shape is skipped (unknown block types,
 *     malformed entries).
 *
 * External URLs in image_url blocks are NOT added to
 * images — the chat panel only renders data URIs. If the
 * backend ever sends external image references, we'd need
 * to fetch them; for now, skipping is safe.
 */
export function normalizeMessageContent(msg) {
  if (!msg || typeof msg !== 'object') {
    return { content: '', images: [] };
  }
  const raw = msg.content;
  if (typeof raw === 'string') {
    return { content: raw, images: [] };
  }
  if (!Array.isArray(raw)) {
    // Content is neither string nor array — defensive
    // fallback, treat as empty.
    return { content: '', images: [] };
  }
  const textParts = [];
  const images = [];
  for (const block of raw) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if (
      block.type === 'image_url' &&
      block.image_url &&
      typeof block.image_url.url === 'string' &&
      block.image_url.url.startsWith('data:')
    ) {
      images.push(block.image_url.url);
    }
  }
  return {
    content: textParts.join('\n'),
    images,
  };
}