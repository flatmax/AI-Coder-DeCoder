// Tests for webapp/src/image-utils.js — pure helpers for
// MIME validation, size estimation, clipboard extraction,
// and multimodal message normalisation.

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  estimateDataUriBytes,
  extractImagesFromClipboard,
  isAcceptedImageMime,
  normalizeMessageContent,
} from './image-utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('limits', () => {
  it('MAX_IMAGE_BYTES is 5 MiB', () => {
    // Pinned because the backend has its own 5 MiB check
    // and a mismatch would let the frontend pass images
    // the server will reject. Specs3/specs4 both 5 MiB.
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('MAX_IMAGES_PER_MESSAGE is 5', () => {
    expect(MAX_IMAGES_PER_MESSAGE).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// isAcceptedImageMime
// ---------------------------------------------------------------------------

describe('isAcceptedImageMime', () => {
  it('accepts the four documented formats', () => {
    for (const mime of [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]) {
      expect(isAcceptedImageMime(mime)).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(isAcceptedImageMime('IMAGE/PNG')).toBe(true);
    expect(isAcceptedImageMime('Image/Jpeg')).toBe(true);
  });

  it('rejects SVG (not in the accepted set)', () => {
    // Deliberate exclusion — SVG can contain scripts and
    // external references, safer to reject at paste.
    expect(isAcceptedImageMime('image/svg+xml')).toBe(false);
  });

  it('rejects non-image MIMEs', () => {
    expect(isAcceptedImageMime('text/plain')).toBe(false);
    expect(isAcceptedImageMime('application/pdf')).toBe(false);
    expect(isAcceptedImageMime('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isAcceptedImageMime(null)).toBe(false);
    expect(isAcceptedImageMime(undefined)).toBe(false);
    expect(isAcceptedImageMime(42)).toBe(false);
    expect(isAcceptedImageMime({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// estimateDataUriBytes
// ---------------------------------------------------------------------------

describe('estimateDataUriBytes', () => {
  it('returns 0 for non-string input', () => {
    expect(estimateDataUriBytes(null)).toBe(0);
    expect(estimateDataUriBytes(undefined)).toBe(0);
    expect(estimateDataUriBytes(42)).toBe(0);
  });

  it('returns 0 for strings without a comma', () => {
    expect(estimateDataUriBytes('not a data uri')).toBe(0);
  });

  it('returns 0 for non-base64 data URIs', () => {
    // Percent-encoded SVG. Our estimator only handles
    // base64, so it returns 0 rather than guessing.
    expect(estimateDataUriBytes('data:image/svg+xml,<svg/>')).toBe(0);
  });

  it('approximates payload size for a known input', () => {
    // base64 of "hello" = "aGVsbG8=", payload 8 chars with
    // 1 byte padding → decoded = 5 bytes.
    const uri = 'data:image/png;base64,aGVsbG8=';
    expect(estimateDataUriBytes(uri)).toBe(5);
  });

  it('handles double-padded base64', () => {
    // base64 of "hi" = "aGk=" — wait, that's 1 padding.
    // "h" base64 is "aA==" — 2 paddings, decoded = 1 byte.
    const uri = 'data:image/png;base64,aA==';
    expect(estimateDataUriBytes(uri)).toBe(1);
  });

  it('handles no-padding base64', () => {
    // base64 of "hey!" = "aGV5IQ==" — 4 chars payload
    // decoded = 3 bytes. Hmm let me pick a better example.
    // base64 of "abc" = "YWJj" — no padding, 4 chars,
    // decoded = 3.
    const uri = 'data:image/png;base64,YWJj';
    expect(estimateDataUriBytes(uri)).toBe(3);
  });

  it('handles large payloads reasonably', () => {
    // 4 MB of 'a' characters → base64 adds ~33%.
    // Don't assert exact byte count (the estimator is
    // an approximation), but confirm it's in the right
    // ballpark.
    const payload = 'a'.repeat(4 * 1024 * 1024);
    const uri = `data:image/png;base64,${payload}`;
    const estimated = estimateDataUriBytes(uri);
    // Should be roughly 3 MB (4 MB of base64 encodes
    // ~3 MB of bytes).
    expect(estimated).toBeGreaterThan(2.9 * 1024 * 1024);
    expect(estimated).toBeLessThan(3.1 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// extractImagesFromClipboard
// ---------------------------------------------------------------------------

describe('extractImagesFromClipboard', () => {
  /** Build a fake ClipboardData-like object. */
  function fakeClipboard(items) {
    return { items };
  }

  /** Build a fake clipboard item with a File payload. */
  function fakeItem(kind, type, fileContent) {
    return {
      kind,
      type,
      getAsFile() {
        if (fileContent === null) return null;
        // In jsdom, File extends Blob and FileReader
        // works with both. Construct a small one.
        return new Blob([fileContent || 'x'], { type });
      },
    };
  }

  it('returns empty array for null input', async () => {
    expect(await extractImagesFromClipboard(null)).toEqual([]);
    expect(await extractImagesFromClipboard(undefined)).toEqual([]);
    expect(await extractImagesFromClipboard({})).toEqual([]);
  });

  it('extracts a single image item', async () => {
    const cb = fakeClipboard([fakeItem('file', 'image/png', 'PNGDATA')]);
    const results = await extractImagesFromClipboard(cb);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^data:image\/png;base64,/);
  });

  it('skips text items', async () => {
    const cb = fakeClipboard([
      fakeItem('string', 'text/plain', 'hello'),
      fakeItem('file', 'image/png', 'PNGDATA'),
    ]);
    const results = await extractImagesFromClipboard(cb);
    expect(results).toHaveLength(1);
  });

  it('skips non-accepted MIME types', async () => {
    const cb = fakeClipboard([
      fakeItem('file', 'image/svg+xml', '<svg/>'),
      fakeItem('file', 'application/pdf', 'pdf'),
      fakeItem('file', 'image/png', 'PNGDATA'),
    ]);
    const results = await extractImagesFromClipboard(cb);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^data:image\/png;/);
  });

  it('skips items whose getAsFile returns null', async () => {
    // Some browsers occasionally return null for items —
    // skip rather than crash.
    const cb = fakeClipboard([
      fakeItem('file', 'image/png', null),
      fakeItem('file', 'image/jpeg', 'JPEG'),
    ]);
    const results = await extractImagesFromClipboard(cb);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^data:image\/jpeg;/);
  });

  it('extracts multiple images in clipboard order', async () => {
    const cb = fakeClipboard([
      fakeItem('file', 'image/png', 'first'),
      fakeItem('file', 'image/jpeg', 'second'),
      fakeItem('file', 'image/gif', 'third'),
    ]);
    const results = await extractImagesFromClipboard(cb);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatch(/^data:image\/png;/);
    expect(results[1]).toMatch(/^data:image\/jpeg;/);
    expect(results[2]).toMatch(/^data:image\/gif;/);
  });

  it('continues past a reader failure', async () => {
    // An item whose getAsFile returns a blob that will
    // fail FileReader.readAsDataURL. We fake this by
    // installing a broken reader temporarily.
    const originalReader = globalThis.FileReader;
    let callCount = 0;
    class FlakeyFileReader {
      readAsDataURL() {
        callCount += 1;
        // First call fails, subsequent calls succeed.
        if (callCount === 1) {
          setTimeout(() => {
            this.error = new Error('flake');
            this.onerror?.();
          }, 0);
        } else {
          setTimeout(() => {
            this.result = 'data:image/png;base64,T0s=';
            this.onload?.();
          }, 0);
        }
      }
    }
    globalThis.FileReader = FlakeyFileReader;
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      const cb = fakeClipboard([
        fakeItem('file', 'image/png', 'first'),
        fakeItem('file', 'image/png', 'second'),
      ]);
      const results = await extractImagesFromClipboard(cb);
      // First failed, second succeeded.
      expect(results).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      globalThis.FileReader = originalReader;
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeMessageContent
// ---------------------------------------------------------------------------

describe('normalizeMessageContent', () => {
  it('string content returns content, empty images', () => {
    expect(normalizeMessageContent({ content: 'hello' })).toEqual({
      content: 'hello',
      images: [],
    });
  });

  it('null or missing content returns empty', () => {
    expect(normalizeMessageContent({ content: null })).toEqual({
      content: '',
      images: [],
    });
    expect(normalizeMessageContent({})).toEqual({
      content: '',
      images: [],
    });
    expect(normalizeMessageContent(null)).toEqual({
      content: '',
      images: [],
    });
  });

  it('extracts text blocks from multimodal array', () => {
    const msg = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    };
    const result = normalizeMessageContent(msg);
    expect(result.content).toBe('hello\nworld');
    expect(result.images).toEqual([]);
  });

  it('extracts image_url data URIs', () => {
    const msg = {
      content: [
        { type: 'text', text: 'see this' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AAA' },
        },
      ],
    };
    const result = normalizeMessageContent(msg);
    expect(result.content).toBe('see this');
    expect(result.images).toEqual(['data:image/png;base64,AAA']);
  });

  it('skips external image URLs (non-data URIs)', () => {
    // External URLs shouldn't appear in normal backend
    // output, but if they do we can't render them
    // without a fetch. Skip.
    const msg = {
      content: [
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/img.png' },
        },
      ],
    };
    const result = normalizeMessageContent(msg);
    expect(result.images).toEqual([]);
  });

  it('skips malformed blocks', () => {
    const msg = {
      content: [
        null,
        undefined,
        { type: 'unknown' },
        { type: 'text' }, // no text field
        { type: 'image_url' }, // no image_url field
        { type: 'image_url', image_url: null },
        { type: 'image_url', image_url: { url: null } },
        { type: 'text', text: 'valid' },
      ],
    };
    const result = normalizeMessageContent(msg);
    expect(result.content).toBe('valid');
    expect(result.images).toEqual([]);
  });

  it('preserves order of multiple images', () => {
    const msg = {
      content: [
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AAA' },
        },
        {
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,BBB' },
        },
      ],
    };
    const result = normalizeMessageContent(msg);
    expect(result.images).toEqual([
      'data:image/png;base64,AAA',
      'data:image/jpeg;base64,BBB',
    ]);
  });

  it('handles non-array non-string content defensively', () => {
    expect(normalizeMessageContent({ content: 42 })).toEqual({
      content: '',
      images: [],
    });
    expect(normalizeMessageContent({ content: {} })).toEqual({
      content: '',
      images: [],
    });
  });
});