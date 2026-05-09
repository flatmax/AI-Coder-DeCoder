// Shadow-DOM style synchronisation.
//
// Monaco emits its theme styles to document.head; for
// a Lit element with a closed-style shadow root those
// styles aren't visible, so the editor renders without
// theming. We work around this by cloning every style
// + linked stylesheet from document.head into our
// shadow root, then keeping the clones in sync via a
// MutationObserver.
//
// KaTeX CSS is special: it isn't in document.head
// either (we import it as a raw string), so we inject
// it explicitly and tag it with a separate marker so
// the Monaco-clone sweep doesn't touch it.

import {
  _CLONED_STYLE_MARKER,
  _KATEX_CSS_MARKER,
  katexCssText,
} from './constants.js';

/**
 * Clone all document.head styles into the shadow root.
 * Runs every editor creation; removes prior clones
 * first so the count doesn't grow across re-creations.
 */
export function syncAllStyles(host) {
  if (!host.shadowRoot) return;
  const prior = host.shadowRoot.querySelectorAll(
    `[data-${_CLONED_STYLE_MARKER.replace(
      /([A-Z])/g,
      '-$1',
    ).toLowerCase()}]`,
  );
  for (const el of prior) el.remove();
  const heads = document.head.querySelectorAll('style, link');
  for (const el of heads) {
    if (el.tagName === 'LINK') {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      if (rel !== 'stylesheet') continue;
    }
    const clone = el.cloneNode(true);
    clone.dataset[_CLONED_STYLE_MARKER] = 'true';
    host.shadowRoot.appendChild(clone);
  }
  ensureKatexCss(host);
}

/**
 * Inject the KaTeX stylesheet into the shadow root if
 * not already present. Idempotent — only one copy ever
 * lives in the shadow root regardless of how many
 * times syncAllStyles runs.
 */
export function ensureKatexCss(host) {
  if (!host.shadowRoot) return;
  const attrName = _KATEX_CSS_MARKER.replace(
    /([A-Z])/g,
    '-$1',
  ).toLowerCase();
  const existing = host.shadowRoot.querySelector(
    `[data-${attrName}]`,
  );
  if (existing) return;
  const style = document.createElement('style');
  style.dataset[_KATEX_CSS_MARKER] = 'true';
  style.textContent = katexCssText;
  host.shadowRoot.appendChild(style);
}

export function ensureStyleObserver(host) {
  if (host._styleObserver) return;
  if (typeof MutationObserver === 'undefined') return;
  try {
    host._styleObserver = new MutationObserver(
      host._onHeadMutation,
    );
    host._styleObserver.observe(document.head, {
      childList: true,
    });
  } catch (_) {
    // No MutationObserver — full re-sync on every
    // editor creation is the fallback.
  }
}

export function disposeStyleObserver(host) {
  if (host._styleObserver) {
    try {
      host._styleObserver.disconnect();
    } catch (_) {}
    host._styleObserver = null;
  }
}

export function onHeadMutation(host, mutations) {
  if (!host.shadowRoot) return;
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (
        node.nodeType === 1 &&
        (node.tagName === 'STYLE' || node.tagName === 'LINK')
      ) {
        if (node.tagName === 'LINK') {
          const rel = (
            node.getAttribute('rel') || ''
          ).toLowerCase();
          if (rel !== 'stylesheet') continue;
        }
        const clone = node.cloneNode(true);
        clone.dataset[_CLONED_STYLE_MARKER] = 'true';
        host.shadowRoot.appendChild(clone);
      }
    }
    for (const node of m.removedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.tagName !== 'STYLE' && node.tagName !== 'LINK') {
        continue;
      }
      const clones = host.shadowRoot.querySelectorAll(
        `[data-${_CLONED_STYLE_MARKER.replace(
          /([A-Z])/g,
          '-$1',
        ).toLowerCase()}]`,
      );
      for (const c of clones) {
        if (
          (node.tagName === 'STYLE' &&
            c.textContent === node.textContent) ||
          (node.tagName === 'LINK' &&
            c.getAttribute('href') === node.getAttribute('href'))
        ) {
          c.remove();
        }
      }
    }
  }
}