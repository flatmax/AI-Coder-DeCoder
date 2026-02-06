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
    `(?<!<[^>]*)(?<!class=")\\b(${escapedPaths.join('|')})\\b(?![^<]*>)`,
    'g'
  );

  const foundSet = new Set();

  const result = htmlContent.replace(combined, (match, filePath) => {
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
