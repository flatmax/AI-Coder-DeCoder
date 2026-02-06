import { getEditResultForFile } from './EditBlockParser.js';

/**
 * Click delegation for CardMarkdown.
 * Maps CSS selectors to handler functions, checked in priority order.
 */

function handleFileMentionClick(target, component) {
  const filePath = target.dataset.file;
  if (filePath) {
    component.dispatchEvent(new CustomEvent('file-mention-click', {
      detail: { path: filePath },
      bubbles: true,
      composed: true
    }));
  }
}

function handleEditBlockFileClick(target, component) {
  const filePath = target.dataset.file;
  const searchContext = target.dataset.context;
  if (filePath) {
    const result = getEditResultForFile(component.editResults, filePath);
    component.dispatchEvent(new CustomEvent('edit-block-click', {
      detail: {
        path: filePath,
        line: result?.estimated_line || 1,
        status: result?.status || 'pending',
        searchContext: searchContext || null
      },
      bubbles: true,
      composed: true
    }));
  }
}

function handleEditTagClick(target, component) {
  const filePath = target.dataset.file;
  if (filePath) {
    const result = getEditResultForFile(component.editResults, filePath);
    component.dispatchEvent(new CustomEvent('edit-block-click', {
      detail: {
        path: filePath,
        line: result?.estimated_line || 1,
        status: result?.status || 'pending',
        searchContext: null
      },
      bubbles: true,
      composed: true
    }));
  }
}

function handleFileChipClick(target, component) {
  const filePath = target.dataset.file;
  if (filePath) {
    component.dispatchEvent(new CustomEvent('file-mention-click', {
      detail: { path: filePath },
      bubbles: true,
      composed: true
    }));
  }
}

function handleSelectAllClick(target, component) {
  try {
    const files = JSON.parse(target.dataset.files || '[]');
    for (const filePath of files) {
      component.dispatchEvent(new CustomEvent('file-mention-click', {
        detail: { path: filePath },
        bubbles: true,
        composed: true
      }));
    }
  } catch (e) {
    console.error('Failed to parse files:', e);
  }
}

function handleEditBlockClick(target, component) {
  const filePath = target.dataset.file;
  if (filePath) {
    const result = getEditResultForFile(component.editResults, filePath);
    component.dispatchEvent(new CustomEvent('edit-block-click', {
      detail: {
        path: filePath,
        line: result?.estimated_line || 1,
        status: result?.status || 'pending',
        searchContext: null
      },
      bubbles: true,
      composed: true
    }));
  }
}

// Priority-ordered: more specific selectors first
const CLICK_HANDLERS = [
  { selector: '.file-mention', handler: handleFileMentionClick },
  { selector: '.edit-block-file', handler: handleEditBlockFileClick },
  { selector: '.edit-tag', handler: handleEditTagClick },
  { selector: '.file-chip', handler: handleFileChipClick },
  { selector: '.select-all-btn', handler: handleSelectAllClick },
  { selector: '.edit-block', handler: handleEditBlockClick },
];

export function dispatchClick(e, component) {
  for (const { selector, handler } of CLICK_HANDLERS) {
    const target = e.target.closest(selector);
    if (target) {
      handler(target, component);
      return;
    }
  }
}
