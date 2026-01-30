/**
 * Compute unified diff between two arrays of lines using LCS algorithm.
 * Returns array of diff entries in display order.
 * 
 * @param {string[]} oldLines - Original lines
 * @param {string[]} newLines - New lines  
 * @returns {Array<{type: 'context'|'add'|'remove', line: string, pair?: object}>}
 */
export function computeLineDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  
  // Build DP table for LCS
  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to build diff
  const result = [];
  let i = n, j = m;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'context', line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }
  
  const reversed = result.reverse();
  
  // Post-process to pair adjacent remove/add lines for inline highlighting
  return pairModifiedLines(reversed);
}

/**
 * Pair adjacent remove/add lines that likely represent modifications.
 * Adds a 'pair' property with character-level diff info.
 */
function pairModifiedLines(diff) {
  const result = [];
  let i = 0;
  
  while (i < diff.length) {
    const current = diff[i];
    const next = diff[i + 1];
    
    // Check if this is a remove followed by add (modification pattern)
    if (current.type === 'remove' && next?.type === 'add') {
      // Compute character-level diff between the two lines
      const charDiff = computeCharDiff(current.line, next.line);
      
      // Only use inline highlighting if lines are similar enough
      // (avoid highlighting when entire line is different)
      if (charDiff.similarity > 0.7) {
        result.push({ ...current, pair: { charDiff: charDiff.oldSegments } });
        result.push({ ...next, pair: { charDiff: charDiff.newSegments } });
        i += 2;
        continue;
      }
    }
    
    result.push(current);
    i++;
  }
  
  return result;
}

/**
 * Compute word-level diff between two strings using LCS.
 * Falls back to character-level for very similar words.
 * Returns segments for both old and new strings, plus similarity score.
 * 
 * @param {string} oldStr - Original string
 * @param {string} newStr - New string
 * @returns {{oldSegments: Array, newSegments: Array, similarity: number}}
 */
export function computeCharDiff(oldStr, newStr) {
  // Tokenize into words and whitespace
  const oldTokens = tokenize(oldStr);
  const newTokens = tokenize(newStr);
  const n = oldTokens.length;
  const m = newTokens.length;
  
  // Handle edge cases
  if (n === 0 && m === 0) {
    return { oldSegments: [], newSegments: [], similarity: 1 };
  }
  if (n === 0) {
    return { 
      oldSegments: [], 
      newSegments: [{ type: 'add', text: newStr }],
      similarity: 0 
    };
  }
  if (m === 0) {
    return { 
      oldSegments: [{ type: 'remove', text: oldStr }], 
      newSegments: [],
      similarity: 0 
    };
  }
  
  // Build DP table for LCS on tokens
  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to build token-level diff
  const oldResult = [];
  const newResult = [];
  let i = n, j = m;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      oldResult.push({ type: 'same', text: oldTokens[i - 1] });
      newResult.push({ type: 'same', text: newTokens[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newResult.push({ type: 'add', text: newTokens[j - 1] });
      j--;
    } else {
      oldResult.push({ type: 'remove', text: oldTokens[i - 1] });
      i--;
    }
  }
  
  // Reverse to get correct order
  const oldSegments = mergeTokenSegments(oldResult.reverse());
  const newSegments = mergeTokenSegments(newResult.reverse());
  
  // Calculate similarity as ratio of common tokens
  const lcsLength = dp[n][m];
  const similarity = (2 * lcsLength) / (n + m);
  
  return { oldSegments, newSegments, similarity };
}

/**
 * Tokenize a string into words and whitespace, preserving all characters.
 * Punctuation is kept with adjacent words or as separate tokens.
 */
function tokenize(str) {
  // Split on word boundaries, keeping whitespace and punctuation as separate tokens
  const tokens = [];
  let current = '';
  let currentType = null; // 'word', 'space', 'punct'
  
  for (const char of str) {
    let charType;
    if (/\s/.test(char)) {
      charType = 'space';
    } else if (/\w/.test(char)) {
      charType = 'word';
    } else {
      charType = 'punct';
    }
    
    if (currentType === null) {
      currentType = charType;
      current = char;
    } else if (charType === currentType) {
      current += char;
    } else {
      tokens.push(current);
      current = char;
      currentType = charType;
    }
  }
  
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

/**
 * Merge consecutive tokens of the same type into segments.
 */
function mergeTokenSegments(tokens) {
  if (tokens.length === 0) return [];
  
  const segments = [];
  let current = { type: tokens[0].type, text: tokens[0].text };
  
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].type === current.type) {
      current.text += tokens[i].text;
    } else {
      segments.push(current);
      current = { type: tokens[i].type, text: tokens[i].text };
    }
  }
  segments.push(current);
  
  return segments;
}
