/**
 * Parse edit blocks from assistant message content.
 * Format: file.py\n««« EDIT\n...\n═══════ REPL\n...\n»»» EDIT END
 */

/**
 * Parse edit blocks from content and return structured data.
 * @param {string} content - Raw message content
 * @returns {Array<{filePath: string, editLines: string, replLines: string, startIndex: number, endIndex: number}>}
 */
export function parseEditBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');

  let state = 'IDLE';
  let currentBlock = null;
  let potentialPath = null;
  let editLines = [];
  let replLines = [];
  let blockStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (state === 'IDLE') {
      if (trimmed && !trimmed.startsWith('```') && !trimmed.startsWith('#')) {
        potentialPath = trimmed;
        state = 'EXPECT_START';
      }
    } else if (state === 'EXPECT_START') {
      if (trimmed === '««« EDIT') {
        blockStartIndex = i - 1;
        currentBlock = { filePath: potentialPath, startIndex: blockStartIndex };
        editLines = [];
        state = 'EDIT_SECTION';
      } else if (trimmed) {
        potentialPath = trimmed;
      } else {
        state = 'IDLE';
        potentialPath = null;
      }
    } else if (state === 'EDIT_SECTION') {
      if (trimmed === '═══════ REPL') {
        currentBlock.editLines = editLines.join('\n');
        replLines = [];
        state = 'REPL_SECTION';
      } else {
        editLines.push(line);
      }
    } else if (state === 'REPL_SECTION') {
      if (trimmed === '»»» EDIT END') {
        currentBlock.replLines = replLines.join('\n');
        currentBlock.endIndex = i;
        blocks.push(currentBlock);
        state = 'IDLE';
        currentBlock = null;
        potentialPath = null;
      } else {
        replLines.push(line);
      }
    }
  }

  return blocks;
}

/**
 * Get edit result for a specific file path.
 * @param {Array} editResults - Array of {file_path, status, reason, estimated_line}
 * @param {string} filePath - File path to look up
 * @returns {object|null}
 */
export function getEditResultForFile(editResults, filePath) {
  if (!editResults || editResults.length === 0) return null;
  const normalize = (p) => p?.replace(/^\.\//, '').replace(/\\/g, '/').trim();
  const normalizedSearch = normalize(filePath);
  return editResults.find(r => normalize(r.file_path) === normalizedSearch);
}
