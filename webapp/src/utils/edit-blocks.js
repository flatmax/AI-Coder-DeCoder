/**
 * Edit block display utilities.
 * Matches the server-side edit protocol markers for rendering.
 */

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
 * Compute a simple unified diff for display.
 * Returns array of { type: 'context'|'add'|'remove', text }
 */
export function computeDiff(oldLines, newLines) {
  const result = [];

  // Find common prefix (anchor)
  let anchor = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  for (let i = 0; i < minLen; i++) {
    if (oldLines[i] === newLines[i]) anchor++;
    else break;
  }

  // Context lines (anchor)
  for (let i = 0; i < anchor; i++) {
    result.push({ type: 'context', text: oldLines[i] });
  }
  // Removed lines
  for (let i = anchor; i < oldLines.length; i++) {
    result.push({ type: 'remove', text: oldLines[i] });
  }
  // Added lines
  for (let i = anchor; i < newLines.length; i++) {
    result.push({ type: 'add', text: newLines[i] });
  }

  return result;
}
