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
 * Compute a unified diff for display with modify-pair detection.
 * Returns array of:
 *   { type: 'context', text }
 *   { type: 'remove', text, charDiff? }
 *   { type: 'add', text, charDiff? }
 *
 * Adjacent delete+insert pairs that are similar are tagged as modify pairs
 * with charDiff arrays for character-level highlighting.
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

  // Collect raw deletes and inserts
  const deletes = [];
  for (let i = anchor; i < oldLines.length; i++) {
    deletes.push(oldLines[i]);
  }
  const inserts = [];
  for (let i = anchor; i < newLines.length; i++) {
    inserts.push(newLines[i]);
  }

  // Pair adjacent deletes and inserts that are similar → modify pairs
  const paired = Math.min(deletes.length, inserts.length);
  for (let i = 0; i < paired; i++) {
    const sim = _lineSimilarity(deletes[i], inserts[i]);
    if (sim > 0.3) {
      // Similar enough — treat as a modify pair with char-level diff
      const charDiff = computeCharDiff(deletes[i], inserts[i]);
      result.push({ type: 'remove', text: deletes[i], charDiff: charDiff.old });
      result.push({ type: 'add', text: inserts[i], charDiff: charDiff.new });
    } else {
      result.push({ type: 'remove', text: deletes[i] });
      result.push({ type: 'add', text: inserts[i] });
    }
  }
  // Remaining unpaired lines
  for (let i = paired; i < deletes.length; i++) {
    result.push({ type: 'remove', text: deletes[i] });
  }
  for (let i = paired; i < inserts.length; i++) {
    result.push({ type: 'add', text: inserts[i] });
  }

  return result;
}

/**
 * Compute similarity ratio between two strings (0–1).
 * Based on shared token count vs total tokens.
 */
function _lineSimilarity(a, b) {
  const tokA = _tokenize(a);
  const tokB = _tokenize(b);
  if (tokA.length === 0 && tokB.length === 0) return 1;
  if (tokA.length === 0 || tokB.length === 0) return 0;
  const setB = new Set(tokB);
  let shared = 0;
  for (const t of tokA) {
    if (setB.has(t)) shared++;
  }
  return (shared * 2) / (tokA.length + tokB.length);
}

/**
 * Tokenize a string on word boundaries for diffing.
 * "foo.bar()" → ["foo", ".", "bar", "(", ")"]
 */
function _tokenize(str) {
  if (!str) return [];
  const tokens = [];
  const re = /\w+|[^\w\s]|\s+/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Compute character-level diff between two strings using token-level LCS.
 * Returns { old: segments[], new: segments[] } where each segment is
 * { type: 'equal'|'delete'|'insert', text }.
 *
 * The 'old' array contains 'equal' and 'delete' segments.
 * The 'new' array contains 'equal' and 'insert' segments.
 */
export function computeCharDiff(oldStr, newStr) {
  const oldToks = _tokenize(oldStr);
  const newToks = _tokenize(newStr);

  // LCS of token arrays
  const lcs = _lcs(oldToks, newToks);

  // Build old segments (equal + delete)
  const oldSegs = [];
  let li = 0;
  let oi = 0;
  for (const [lcsOi, lcsNi] of lcs) {
    // Tokens in old before this LCS match are deletions
    if (oi < lcsOi) {
      oldSegs.push({ type: 'delete', text: oldToks.slice(oi, lcsOi).join('') });
    }
    oldSegs.push({ type: 'equal', text: oldToks[lcsOi] });
    oi = lcsOi + 1;
  }
  if (oi < oldToks.length) {
    oldSegs.push({ type: 'delete', text: oldToks.slice(oi).join('') });
  }

  // Build new segments (equal + insert)
  const newSegs = [];
  let ni = 0;
  for (const [lcsOi, lcsNi] of lcs) {
    if (ni < lcsNi) {
      newSegs.push({ type: 'insert', text: newToks.slice(ni, lcsNi).join('') });
    }
    newSegs.push({ type: 'equal', text: newToks[lcsNi] });
    ni = lcsNi + 1;
  }
  if (ni < newToks.length) {
    newSegs.push({ type: 'insert', text: newToks.slice(ni).join('') });
  }

  // Merge consecutive segments of same type
  return {
    old: _mergeSegments(oldSegs),
    new: _mergeSegments(newSegs),
  };
}

/**
 * Compute LCS of two token arrays. Returns array of [oldIdx, newIdx] pairs.
 */
function _lcs(a, b) {
  const m = a.length;
  const n = b.length;

  // Build DP table
  // For large inputs, use a space-optimized approach
  if (m > 500 || n > 500) {
    // Fallback: no LCS, treat everything as changed
    return [];
  }

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find pairs
  const pairs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  pairs.reverse();
  return pairs;
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