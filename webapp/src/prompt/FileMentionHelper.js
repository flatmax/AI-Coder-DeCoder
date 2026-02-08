import { escapeHtml } from '../utils/formatters.js';

/**
 * Highlight file mentions in HTML content and track which files were found.
 * @param {string} htmlContent - Processed HTML
 * @param {Array<string>} mentionedFiles - Files to look for
 * @param {Array<string>} selectedFiles - Files currently in context
 * @returns {{html: string, foundFiles: string[]}}
 */
export function highlightFileMentions(htmlContent, mentionedFiles, selectedFiles) {
  if (!mentionedFiles || mentionedFiles.length === 0) {
    return { html: htmlContent, foundFiles: [] };
  }

  const selectedSet = selectedFiles ? new Set(selectedFiles) : new Set();
  const lowercaseContent = htmlContent.toLowerCase();

  // Pre-filter: only files whose path appears as substring
  const candidates = mentionedFiles.filter(f => lowercaseContent.includes(f.toLowerCase()));

  if (candidates.length === 0) {
    return { html: htmlContent, foundFiles: [] };
  }

  // Sort by length descending so longer paths match first in alternation
  candidates.sort((a, b) => b.length - a.length);

  // Build single combined regex — one pass instead of N
  const escapedPaths = candidates.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const combined = new RegExp(
    `(${escapedPaths.join('|')})`,
    'g'
  );

  const foundSet = new Set();

  // Build a set of ranges inside <pre>...</pre> blocks (fenced code blocks)
  // File paths inside these should not be highlighted — they're code examples
  // Inline <code> is fine to highlight (that's how users reference files)
  const preRanges = [];
  const preTagRegex = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi;
  let tagMatch;
  while ((tagMatch = preTagRegex.exec(htmlContent)) !== null) {
    preRanges.push([tagMatch.index, tagMatch.index + tagMatch[0].length]);
  }

  const isInsidePreBlock = (offset) => {
    for (const [start, end] of preRanges) {
      if (offset >= start && offset < end) return true;
      if (start > offset) break; // ranges are in order
    }
    return false;
  };

  // Replace file paths, but skip matches inside HTML tags and pre blocks
  const result = htmlContent.replace(combined, (match, filePath, offset) => {
    // Skip if inside a <pre> code block
    if (isInsidePreBlock(offset)) {
      return match;
    }

    // Skip if inside an HTML tag: find last < and > before this offset
    const before = htmlContent.substring(Math.max(0, offset - 500), offset);
    const lastOpen = before.lastIndexOf('<');
    const lastClose = before.lastIndexOf('>');
    if (lastOpen > lastClose) {
      return match;
    }

    // Skip if already wrapped in a file-mention span
    const precedingChunk = htmlContent.substring(Math.max(0, offset - 50), offset);
    if (precedingChunk.includes('class="file-mention')) {
      return match;
    }

    foundSet.add(filePath);
    const contextClass = selectedSet.has(filePath) ? ' in-context' : '';
    return `<span class="file-mention${contextClass}" data-file="${filePath}">${filePath}</span>`;
  });

  return { html: result, foundFiles: [...foundSet] };
}

/**
 * Render files summary section.
 * @param {string[]} foundFiles - Files found in content
 * @param {string[]} selectedFiles - Files currently in context
 * @returns {string} HTML string
 */
export function renderFilesSummary(foundFiles, selectedFiles) {
  if (foundFiles.length === 0) return '';

  const notInContextFiles = foundFiles.filter(f => !selectedFiles || !selectedFiles.includes(f));
  const hasFilesToAdd = notInContextFiles.length > 1;

  const filesHtml = foundFiles.map(filePath => {
    const isInContext = selectedFiles && selectedFiles.includes(filePath);
    const chipClass = isInContext ? 'in-context' : 'not-in-context';
    const icon = isInContext ? '✓' : '+';
    return `<span class="file-chip ${chipClass}" data-file="${escapeHtml(filePath)}"><span class="chip-icon">${icon}</span>${escapeHtml(filePath)}</span>`;
  }).join('');

  const selectAllBtn = hasFilesToAdd
    ? `<button class="select-all-btn" data-files='${JSON.stringify(notInContextFiles)}'>+ Add All (${notInContextFiles.length})</button>`
    : '';

  return `
    <div class="files-summary">
      <div class="files-summary-header">📁 Files Referenced ${selectAllBtn}</div>
      <div class="files-summary-list">${filesHtml}</div>
    </div>
  `;
}
