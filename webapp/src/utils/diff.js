/**
 * Compute unified diff between two arrays of lines using LCS algorithm.
 * Returns array of diff entries in display order.
 * 
 * @param {string[]} oldLines - Original lines
 * @param {string[]} newLines - New lines  
 * @returns {Array<{type: 'context'|'add'|'remove', line: string}>}
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
  
  return result.reverse();
}
