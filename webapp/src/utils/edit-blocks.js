/**
 * Edit block display utilities.
 * Matches the server-side edit protocol markers for rendering.
 */

import { diffLines, diffWords } from 'diff';

const EDIT_START = '<<<< EDIT';
const EDIT_SEP = '==== REPLACE';
const EDIT_END = '>>>> EDIT END';

/**
 * Split assistant text into segments: plain text and edit blocks.
 * Returns array of { type: 'text'|'edit', content, filePath?, oldLines?, newLines? }
 */
export function segmentResponse(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const segments = [];
  let textBuf = [];
  let state = 'text'; // text | old | new
  let candidatePath = '';
  let oldLines = [];
  let newLines = [];

  function flushText() {
    if (textBuf.length > 0) {
      segments.push({ type: 'text', content: textBuf.join('\n') });
      textBuf = [];
    }
  }

  for (const line of lines) {
    if (state === 'text') {
      if (line.trim() === EDIT_START && candidatePath) {
        flushText();
        // Remove the path line from text buffer — it was already flushed or is candidatePath
        state = 'old';
        oldLines = [];
        newLines = [];
        continue;
      }
      if (_looksLikePath(line.trim())) {
        candidatePath = line.trim();
      } else {
        candidatePath = '';
      }
      textBuf.push(line);

    } else if (state === 'old') {
      if (line.trim() === EDIT_SEP) {
        state = 'new';
      } else {
        oldLines.push(line);
      }

    } else if (state === 'new') {
      if (line.trim() === EDIT_END) {
        // Remove the trailing path line from previous text segment
        if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
          const prev = segments[segments.length - 1];
          const prevLines = prev.content.split('\n');
          if (prevLines.length > 0 && prevLines[prevLines.length - 1].trim() === candidatePath) {
            prevLines.pop();
            prev.content = prevLines.join('\n');
            if (!prev.content.trim()) segments.pop();
          }
        }

        segments.push({
          type: 'edit',
          filePath: candidatePath,
          oldLines: [...oldLines],
          newLines: [...newLines],
          isCreate: oldLines.length === 0,
        });
        state = 'text';
        candidatePath = '';
        oldLines = [];
        newLines = [];
      } else {
        newLines.push(line);
      }
    }
  }

  // Flush remaining
  if (state === 'text') {
    flushText();
  } else {
    // Incomplete edit block — render as in-progress
    flushText();
    if (candidatePath) {
      segments.push({
        type: 'edit-pending',
        filePath: candidatePath,
        oldLines: [...oldLines],
        newLines: [...newLines],
      });
    }
  }

  return segments;
}

function _looksLikePath(s) {
  if (!s || s.length > 200) return false;
  if (s.startsWith('#') || s.startsWith('//') || s.startsWith('/*') ||
      s.startsWith('*') || s.startsWith('-') || s.startsWith('>') ||
      s.startsWith('```')) return false;
  return s.includes('/') || s.includes('\\') ||
    (s.includes('.') && !s.includes(' '));
}

/**
 * Compute a unified diff for display using Myers diff (via 'diff' library).
 * Returns array of:
 *   { type: 'context', text }
 *   { type: 'remove', text, charDiff? }
 *   { type: 'add', text, charDiff? }
 *
 * Adjacent remove+add runs are paired for character-level highlighting
 * on similar lines, matching GitHub's diff rendering style.
 */
export function computeDiff(oldLines, newLines) {
  const oldStr = oldLines.join('\n');
  const newStr = newLines.join('\n');
  const changes = diffLines(oldStr, newStr);

  // First pass: collect raw lines with types
  const raw = [];
  for (const part of changes) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    const type = part.added ? 'add' : part.removed ? 'remove' : 'context';
    for (const line of lines) {
      raw.push({ type, text: line });
    }
  }

  // Second pass: pair adjacent remove/add runs for char-level diff
  const result = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i].type === 'context') {
      result.push(raw[i]);
      i++;
      continue;
    }

    // Collect consecutive remove lines
    const removes = [];
    while (i < raw.length && raw[i].type === 'remove') {
      removes.push(raw[i].text);
      i++;
    }
    // Collect consecutive add lines
    const adds = [];
    while (i < raw.length && raw[i].type === 'add') {
      adds.push(raw[i].text);
      i++;
    }

    // Pair removes and adds for char-level highlighting
    const paired = Math.min(removes.length, adds.length);
    for (let j = 0; j < paired; j++) {
      const charDiff = computeCharDiff(removes[j], adds[j]);
      result.push({ type: 'remove', text: removes[j], charDiff: charDiff.old });
      result.push({ type: 'add', text: adds[j], charDiff: charDiff.new });
    }
    for (let j = paired; j < removes.length; j++) {
      result.push({ type: 'remove', text: removes[j] });
    }
    for (let j = paired; j < adds.length; j++) {
      result.push({ type: 'add', text: adds[j] });
    }
  }

  return result;
}

/**
 * Compute character-level diff between two strings using word-level diffing.
 * Returns { old: segments[], new: segments[] } where each segment is
 * { type: 'equal'|'delete'|'insert', text }.
 *
 * The 'old' array contains 'equal' and 'delete' segments.
 * The 'new' array contains 'equal' and 'insert' segments.
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
 * Merge consecutive segments of the same type.
 */
function _mergeSegments(segs) {
  if (segs.length === 0) return [];
  const merged = [{ ...segs[0] }];
  for (let i = 1; i < segs.length; i++) {
    const last = merged[merged.length - 1];
    if (segs[i].type === last.type) {
      last.text += segs[i].text;
    } else {
      merged.push({ ...segs[i] });
    }
  }
  return merged;
}