import { escapeHtml } from '../utils/formatters.js';
import { computeLineDiff } from '../utils/diff.js';
import { getEditResultForFile } from './EditBlockParser.js';

/**
 * Render an edit block as HTML with unified diff view.
 * @param {object} block - Parsed edit block
 * @param {Array} editResults - Edit results array
 * @returns {string} HTML string
 */
export function renderEditBlock(block, editResults) {
  const result = getEditResultForFile(editResults, block.filePath);
  const status = result ? result.status : 'pending';
  const statusLabel = status === 'applied' ? '✓ Applied' :
                      status === 'failed' ? '✗ Failed' :
                      '○ Pending';

  let errorHtml = '';
  if (result && result.status === 'failed' && result.reason) {
    const lineInfo = result.estimated_line ? ` (near line ${result.estimated_line})` : '';
    errorHtml = `<div class="edit-block-error">Error: ${escapeHtml(result.reason)}${lineInfo}</div>`;
  }

  const lineInfo = result && result.estimated_line
    ? `<span class="edit-block-line-info">line ${result.estimated_line}</span>`
    : '';

  const diffHtml = formatUnifiedDiff(block.editLines, block.replLines);

  const editLines = block.editLines ? block.editLines.split('\n') : [];
  const searchContext = editLines.find(line => line.trim().length > 0) || '';
  const encodedContext = escapeHtml(searchContext).replace(/"/g, '&quot;');

  return `
    <div class="edit-block" data-file="${escapeHtml(block.filePath)}">
      <div class="edit-block-header">
        <span class="edit-block-file" data-file="${escapeHtml(block.filePath)}" data-context="${encodedContext}">${escapeHtml(block.filePath)}</span>
        <div>
          ${lineInfo}
          <span class="edit-block-status ${status}">${statusLabel}</span>
        </div>
      </div>
      <div class="edit-block-content">
        ${diffHtml}
      </div>
      ${errorHtml}
    </div>
  `;
}

/**
 * Render edits summary section.
 * @param {Array} editResults - Edit results array
 * @returns {string} HTML string
 */
export function renderEditsSummary(editResults) {
  if (!editResults || editResults.length === 0) return '';

  const tagsHtml = editResults.map(result => {
    const isApplied = result.status === 'applied';
    const statusClass = isApplied ? 'applied' : 'failed';
    const icon = isApplied ? '✓' : '✗';
    const tooltip = isApplied ? 'Applied successfully' : `Failed: ${result.reason || 'Unknown error'}`;
    return `<span class="edit-tag ${statusClass}" title="${escapeHtml(tooltip)}" data-file="${escapeHtml(result.file_path)}"><span class="edit-tag-icon">${icon}</span>${escapeHtml(result.file_path)}</span>`;
  }).join('');

  const appliedCount = editResults.filter(r => r.status === 'applied').length;
  const failedCount = editResults.length - appliedCount;

  let summaryText = '';
  if (appliedCount > 0 && failedCount > 0) {
    summaryText = `${appliedCount} applied, ${failedCount} failed`;
  } else if (appliedCount > 0) {
    summaryText = `${appliedCount} edit${appliedCount > 1 ? 's' : ''} applied`;
  } else {
    summaryText = `${failedCount} edit${failedCount > 1 ? 's' : ''} failed`;
  }

  return `
    <div class="edits-summary">
      <div class="edits-summary-header">✏️ Edits: ${summaryText}</div>
      <div class="edits-summary-list">${tagsHtml}</div>
    </div>
  `;
}

/**
 * Format edit/repl content as unified diff HTML using LCS algorithm.
 * @param {string} editContent
 * @param {string} replContent
 * @returns {string} HTML string
 */
export function formatUnifiedDiff(editContent, replContent) {
  const oldLines = editContent ? editContent.split('\n') : [];
  const newLines = replContent ? replContent.split('\n') : [];

  if (oldLines.length === 0 && newLines.length === 0) return '';

  const diff = computeLineDiff(oldLines, newLines);

  const lines = diff.map(entry => {
    const prefix = entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' ';

    if (entry.pair?.charDiff) {
      const highlightedContent = renderInlineHighlight(entry.pair.charDiff, entry.type);
      return `<span class="diff-line ${entry.type}"><span class="diff-line-prefix">${prefix}</span>${highlightedContent}</span>`;
    }

    const escapedLine = escapeHtml(entry.line);
    return `<span class="diff-line ${entry.type}"><span class="diff-line-prefix">${prefix}</span>${escapedLine}</span>`;
  });

  return lines.join('\n');
}

/**
 * Render line content with inline character-level highlighting.
 * @param {Array<{type: 'same'|'add'|'remove', text: string}>} segments
 * @param {string} lineType - 'add' or 'remove'
 * @returns {string} HTML string
 */
export function renderInlineHighlight(segments, lineType) {
  return segments.map(segment => {
    const escapedText = escapeHtml(segment.text);

    if (segment.type === 'same') return escapedText;

    if ((lineType === 'remove' && segment.type === 'remove') ||
        (lineType === 'add' && segment.type === 'add')) {
      return `<span class="diff-change">${escapedText}</span>`;
    }

    return escapedText;
  }).join('');
}

/**
 * Render an in-progress edit block with live partial diff (during streaming).
 * @param {string} filePath - File path being edited
 * @param {string[]} [partialLines] - Lines received so far inside the edit block
 * @returns {string} HTML string
 */
export function renderInProgressEditBlock(filePath, partialLines) {
  let contentHtml = '<div class="streaming-edit-pulse"></div>';

  if (partialLines && partialLines.length > 0) {
    const replMarkerIndex = partialLines.findIndex(l => l.startsWith('═══════'));

    if (replMarkerIndex === -1) {
      // Only EDIT section so far — show as context lines
      contentHtml = partialLines
        .map(line => `<span class="diff-line context"><span class="diff-line-prefix"> </span>${escapeHtml(line)}</span>`)
        .join('\n');
    } else {
      // Have both EDIT and (partial) REPL sections — render as diff
      const editLines = partialLines.slice(0, replMarkerIndex);
      const replLines = partialLines.slice(replMarkerIndex + 1);
      contentHtml = renderPartialDiff(editLines, replLines);
    }

    // Add pulse at the end to show more content is expected
    contentHtml += '\n<div class="streaming-edit-pulse"></div>';
  }

  return `
    <div class="edit-block in-progress">
      <div class="edit-block-header">
        <span class="edit-block-file">${escapeHtml(filePath)}</span>
        <div>
          <span class="edit-block-status pending">⏳ Writing...</span>
        </div>
      </div>
      <div class="edit-block-content">
        ${contentHtml}
      </div>
    </div>
  `;
}

/**
 * Render a partial diff from EDIT and REPL lines during streaming.
 * Computes a shared prefix (context lines) and shows remaining
 * EDIT lines as removals and REPL lines as additions.
 * @param {string[]} editLines
 * @param {string[]} replLines
 * @returns {string} HTML string
 */
function renderPartialDiff(editLines, replLines) {
  // Find shared prefix (context lines)
  let prefixLen = 0;
  const maxPrefix = Math.min(editLines.length, replLines.length);
  while (prefixLen < maxPrefix && editLines[prefixLen] === replLines[prefixLen]) {
    prefixLen++;
  }

  const lines = [];

  // Context lines (shared prefix)
  for (let i = 0; i < prefixLen; i++) {
    lines.push(`<span class="diff-line context"><span class="diff-line-prefix"> </span>${escapeHtml(editLines[i])}</span>`);
  }

  // Remove lines (remaining EDIT lines after prefix)
  for (let i = prefixLen; i < editLines.length; i++) {
    lines.push(`<span class="diff-line remove"><span class="diff-line-prefix">-</span>${escapeHtml(editLines[i])}</span>`);
  }

  // Add lines (remaining REPL lines after prefix)
  for (let i = prefixLen; i < replLines.length; i++) {
    lines.push(`<span class="diff-line add"><span class="diff-line-prefix">+</span>${escapeHtml(replLines[i])}</span>`);
  }

  return lines.join('\n');
}
