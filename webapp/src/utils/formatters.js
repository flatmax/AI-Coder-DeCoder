/**
 * Format token count with K/M suffixes
 * @param {number} count 
 * @returns {string}
 */
export function formatTokens(count) {
  if (!count) return '0';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

/**
 * Format ISO timestamp to locale string
 * @param {string} isoString 
 * @returns {string}
 */
export function formatTimestamp(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString();
}

/**
 * Format ISO timestamp as relative time (e.g., "5 min ago") or date
 * @param {string} isoString 
 * @returns {string}
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

/**
 * Truncate content with ellipsis
 * @param {string} content 
 * @param {number} maxLength 
 * @returns {string}
 */
export function truncateContent(content, maxLength = 100) {
  if (!content || content.length <= maxLength) return content;
  return content.substring(0, maxLength) + '...';
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
