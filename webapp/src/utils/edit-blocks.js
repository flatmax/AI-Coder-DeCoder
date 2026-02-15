/**
 * Edit block segmentation and diffing for chat panel rendering.
 *
 * Splits raw LLM response text into text and edit segments,
 * computes line-level and character-level diffs using the `diff` library.
 */

import { diffLines, diffWords } from 'diff';

// Edit block markers (must match edit_parser.py)
const EDIT_START = '««« EDIT';
const EDIT_SEP   = '═══════ REPL';
const EDIT_END   = '»»» EDIT END';

/**
 * Check whether a line looks like a file path.
 */
function _isFilePath(line) {
  const s = line.trim();
  if (!s || s.length > 200) return false;
  if (/^[#\/*\->]|^```/.test(s)) return false;
  if (s.includes('/') || s.includes('\\')) return true;
  if (/^[\w\-.]+\.\w+$/.test(s)) return true;
  return false;
}

/**
 * Segment an LLM response into text and edit blocks.
 *
 * Returns an array of:
 *   { type: 'text', content: string }
 *   { type: 'edit', filePath, oldLines, newLines, isCreate }
 *   { type: 'edit-pending', filePath, oldLines, newLines }
 *
 * @param {string} text - Raw LLM response text
 * @returns {Array} segments
 */
export function segmentResponse(text) {
  const lines = text.split('\n');
  const segments = [];
  let textBuf = [];
  let state = 'text'; // text | expect_edit | old | new
  let filePath = '';
  let oldLines = [];
  let newLines = [];

  function flushText() {
    if (textBuf.length > 0) {
      segments.push({ type: 'text', content: textBuf.join('\n') });
      textBuf = [];
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const stripped = line.trim();

    if (state === 'text') {
      if (_isFilePath(stripped) && stripped !== EDIT_START) {
        filePath = stripped;
        state = 'expect_edit';
      } else {
        textBuf.push(line);
      }
    } else if (state === 'expect_edit') {
      if (stripped === EDIT_START) {
        // Strip wrapping code fence if the LLM wrapped the edit block in ```
        if (textBuf.length > 0 && /^`{3,}\s*\w*$/.test(textBuf[textBuf.length - 1].trim())) {
          textBuf.pop();
        }
        flushText();
        oldLines = [];
        newLines = [];
        state = 'old';
      } else if (_isFilePath(stripped) && stripped !== EDIT_START) {
        textBuf.push(filePath); // previous path was just text
        filePath = stripped;
      } else {
        textBuf.push(filePath);
        textBuf.push(line);
        filePath = '';
        state = 'text';
      }
    } else if (state === 'old') {
      if (stripped === EDIT_SEP || stripped.startsWith('═══════')) {
        state = 'new';
      } else {
        oldLines.push(line);
      }
    } else if (state === 'new') {
      if (stripped === EDIT_END) {
        const isCreate = oldLines.length === 0;
        segments.push({
          type: 'edit',
          filePath,
          oldLines: [...oldLines],
          newLines: [...newLines],
          isCreate,
        });
        filePath = '';
        oldLines = [];
        newLines = [];
        state = 'text';
        // Skip trailing code fence if LLM wrapped the edit block in ```
        if (li + 1 < lines.length && /^`{3,}\s*$/.test(lines[li + 1].trim())) {
          li++;
        }
      } else {
        newLines.push(line);
      }
    }
  }

  // Flush remaining — incomplete edit blocks become 'edit-pending'
  if (state === 'old' || state === 'new') {
    segments.push({
      type: 'edit-pending',
      filePath,
      oldLines: [...oldLines],
      newLines: [...newLines],
    });
  } else {
    if (state === 'expect_edit') {
      textBuf.push(filePath);
    }
    flushText();
  }

  return segments;
}

/**
 * Merge consecutive char-diff segments of the same type.
 */
function _mergeSegments(segs) {
  if (segs.length === 0) return segs;
  const merged = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    const prev = merged[merged.length - 1];
    if (segs[i].type === prev.type) {
      prev.text += segs[i].text;
    } else {
      merged.push(segs[i]);
    }
  }
  return merged;
}

/**
 * Compute character-level (word-level) diff between two single lines.
 *
 * Returns { old: [{type, text}], new: [{type, text}] }
 *   type: 'equal' | 'delete' | 'insert'
 */
export function computeCharDiff(oldStr, newStr) {
  const changes = diffWords(oldStr, newStr);

  const oldSegs = [];
  const newSegs = [];

  for (const part of changes) {
    if (part.added) {
      newSegs.push({ type: 'insert', text: part.value });
    } else if (part.removed) {
      oldSegs.push({ type: 'delete', text: part.value });
    } else {
      oldSegs.push({ type: 'equal', text: part.value });
      newSegs.push({ type: 'equal', text: part.value });
    }
  }

  return {
    old: _mergeSegments(oldSegs),
    new: _mergeSegments(newSegs),
  };
}

/**
 * Compute line-level diff between old and new line arrays.
 *
 * Returns an array of:
 *   { type: 'context'|'remove'|'add', text: string, charDiff?: [{type, text}] }
 *
 * Adjacent remove/add runs are paired for character-level highlighting.
 */
export function computeDiff(oldLines, newLines) {
  const oldStr = oldLines.join('\n');
  const newStr = newLines.join('\n');

  const changes = diffLines(oldStr, newStr);

  // First pass: build flat line objects
  const flat = [];
  for (const part of changes) {
    // diffLines may include trailing newline in value; split and handle
    const partLines = part.value.replace(/\n$/, '').split('\n');
    for (const line of partLines) {
      if (part.added) {
        flat.push({ type: 'add', text: line });
      } else if (part.removed) {
        flat.push({ type: 'remove', text: line });
      } else {
        flat.push({ type: 'context', text: line });
      }
    }
  }

  // Second pass: pair adjacent remove/add runs for char-level diffing
  let i = 0;
  while (i < flat.length) {
    // Collect consecutive removes
    const removeStart = i;
    while (i < flat.length && flat[i].type === 'remove') i++;
    const removeEnd = i;

    // Collect consecutive adds immediately following
    const addStart = i;
    while (i < flat.length && flat[i].type === 'add') i++;
    const addEnd = i;

    const removeCount = removeEnd - removeStart;
    const addCount = addEnd - addStart;

    if (removeCount > 0 && addCount > 0) {
      // Pair 1:1 for char diff
      const pairCount = Math.min(removeCount, addCount);
      for (let j = 0; j < pairCount; j++) {
        const charResult = computeCharDiff(
          flat[removeStart + j].text,
          flat[addStart + j].text,
        );
        flat[removeStart + j].charDiff = charResult.old;
        flat[addStart + j].charDiff = charResult.new;
      }
    }

    // If we didn't advance (context line or other), move forward
    if (i === removeStart) i++;
  }

  return flat;
}