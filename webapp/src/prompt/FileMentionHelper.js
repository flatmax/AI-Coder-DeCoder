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

  let result = htmlContent;
  const foundFiles = [];
  const selectedSet = selectedFiles ? new Set(selectedFiles) : new Set();

  // Sort by length descending to match longer paths first.
  // Reuse previous sort if the input array reference is the same.
  if (mentionedFiles !== highlightFileMentions._lastInput) {
    highlightFileMentions._lastInput = mentionedFiles;
    highlightFileMentions._lastSorted = [...mentionedFiles].sort((a, b) => b.length - a.length);
  }
  const sortedFiles = highlightFileMentions._lastSorted;

  // Pre-filter: skip files whose path doesn't even appear as a substring.
  // This avoids expensive regex construction + execution for the vast majority
  // of repo files that aren't mentioned in the content.
  const lowercaseResult = result.toLowerCase();

  for (const filePath of sortedFiles) {
    // Fast substring check before expensive regex
    if (!lowercaseResult.includes(filePath.toLowerCase())) continue;

    const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<!<[^>]*)(?<!class=")\\b(${escaped})\\b(?![^<]*>)`, 'g');

    // Test against `result` (not original) to ensure consistency
    if (regex.test(result)) {
      foundFiles.push(filePath);
      const contextClass = selectedSet.has(filePath) ? ' in-context' : '';
      regex.lastIndex = 0;
      result = result.replace(regex, `<span class="file-mention${contextClass}" data-file="${filePath}">$1</span>`);
    }
  }

  return { html: result, foundFiles };
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
