/**
 * Edit block segmentation and diff rendering for chat messages.
 *
 * Segments LLM response text into prose and edit blocks.
 * Uses the `diff` npm package for line-level and word-level diffs.
 */

import { diffLines, diffWords } from 'diff';

// Edit block markers (must match backend edit_parser.py)
const EDIT_START = '<<<<<<< SEARCH';
const EDIT_SEPARATOR = '======= REPLACE';
const EDIT_END = '>>>>>>> END';

// Legacy markers (for backward compatibility with older responses)
const LEGACY_EDIT_START = '\u00ab\u00ab\u00ab EDIT';
const LEGACY_EDIT_SEPARATOR = '\u2550\u2550\u2550\u2550\u2550\u2550\u2550 REPL';
const LEGACY_EDIT_END = '\u00bb\u00bb\u00bb EDIT END';

/**
 * Check if a line looks like a file path.
 */
function _isFilePath(line) {
  const s = line.trim();
  if (!s || s.length > 200) return false;
  if (/^[#/*\->]/.test(s)) return false;
  if (s.startsWith('```')) return false;
  if (s.includes('/') || s.includes('\\')) return true;
  if (/^[\w.-]+\.\w+$/.test(s)) return true;
  return false;
}

/**
 * Segment a response into text and edit blocks.
 *
 * Returns an array of segments:
 *   { type: 'text', content: string }
 *   { type: 'edit', filePath, oldLines, newLines, isCreate }
 *   { type: 'edit-pending', filePath, oldLines, newLines }
 */
export function segmentResponse(text) {
  if (!text) return [{ type: 'text', content: '' }];

  const lines = text.split('\n');
  const segments = [];
  let state = 'text';
  let textBuf = [];
  let filePath = '';
  let oldLines = [];
  let newLines = [];

  function flushText() {
    if (textBuf.length) {
      // Strip trailing code fence if it immediately precedes an edit
      const content = textBuf.join('\n');
      segments.push({ type: 'text', content });
      textBuf = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    switch (state) {
      case 'text':
        if (_isFilePath(trimmed)) {
          filePath = trimmed;
          state = 'expect_edit';
        } else {
          textBuf.push(line);
        }
        break;

      case 'expect_edit':
        if (trimmed === EDIT_START || trimmed === LEGACY_EDIT_START) {
          // Strip trailing code fence from text buffer
          while (textBuf.length && textBuf[textBuf.length - 1].trim().startsWith('```')) {
            textBuf.pop();
          }
          flushText();
          oldLines = [];
          newLines = [];
          state = 'old';
        } else if (_isFilePath(trimmed)) {
          // Previous path was just text
          textBuf.push(filePath);
          filePath = trimmed;
        } else {
          // Not an edit marker — path was just text
          textBuf.push(filePath);
          textBuf.push(line);
          filePath = '';
          state = 'text';
        }
        break;

      case 'old':
        if (trimmed === EDIT_SEPARATOR || trimmed === LEGACY_EDIT_SEPARATOR) {
          state = 'new';
        } else {
          oldLines.push(line);
        }
        break;

      case 'new':
        if (trimmed === EDIT_END || trimmed === LEGACY_EDIT_END) {
          // Skip trailing code fence
          if (i + 1 < lines.length && lines[i + 1].trim() === '```') {
            i++; // skip it
          }
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
        } else {
          newLines.push(line);
        }
        break;
    }
  }

  // Handle incomplete blocks
  if (state === 'old' || state === 'new') {
    segments.push({
      type: 'edit-pending',
      filePath,
      oldLines: [...oldLines],
      newLines: [...newLines],
    });
  } else if (state === 'expect_edit') {
    textBuf.push(filePath);
    flushText();
  } else {
    flushText();
  }

  return segments;
}

/**
 * Compute a two-level diff (line-level + character-level for paired lines).
 *
 * Returns array of line objects:
 *   { type: 'context'|'remove'|'add', text, charDiff? }
 */
export function computeDiff(oldLines, newLines) {
  const oldText = oldLines.join('\n');
  const newText = newLines.join('\n');
  const changes = diffLines(oldText, newText);

  const result = [];
  const removeRun = [];
  const addRun = [];

  function flushRuns() {
    // Pair remove/add runs for character-level diff
    const pairCount = Math.min(removeRun.length, addRun.length);
    for (let i = 0; i < pairCount; i++) {
      const charDiff = computeCharDiff(removeRun[i], addRun[i]);
      result.push({ type: 'remove', text: removeRun[i], charDiff: charDiff.old });
      result.push({ type: 'add', text: addRun[i], charDiff: charDiff.new });
    }
    // Remaining unpaired lines
    for (let i = pairCount; i < removeRun.length; i++) {
      result.push({ type: 'remove', text: removeRun[i] });
    }
    for (let i = pairCount; i < addRun.length; i++) {
      result.push({ type: 'add', text: addRun[i] });
    }
    removeRun.length = 0;
    addRun.length = 0;
  }

  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, '').split('\n');
    if (change.removed) {
      // Flush any pending add run before starting removes
      if (addRun.length && !removeRun.length) flushRuns();
      removeRun.push(...changeLines);
    } else if (change.added) {
      addRun.push(...changeLines);
    } else {
      flushRuns();
      for (const line of changeLines) {
        result.push({ type: 'context', text: line });
      }
    }
  }
  flushRuns();

  return result;
}

/**
 * Compute character-level diff between two strings.
 * Returns { old: [{type, text}], new: [{type, text}] }
 */
export function computeCharDiff(oldStr, newStr) {
  const changes = diffWords(oldStr, newStr);
  const oldSegs = [];
  const newSegs = [];

  for (const change of changes) {
    if (change.removed) {
      oldSegs.push({ type: 'delete', text: change.value });
    } else if (change.added) {
      newSegs.push({ type: 'insert', text: change.value });
    } else {
      oldSegs.push({ type: 'equal', text: change.value });
      newSegs.push({ type: 'equal', text: change.value });
    }
  }

  return { old: _mergeSegments(oldSegs), new: _mergeSegments(newSegs) };
}

function _mergeSegments(segs) {
  const merged = [];
  for (const seg of segs) {
    if (merged.length && merged[merged.length - 1].type === seg.type) {
      merged[merged.length - 1].text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}