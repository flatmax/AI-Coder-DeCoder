/**
 * Mixin for Monaco editor loading and initialization.
 */

// Use CDN in production, node_modules in dev
const MONACO_VERSION = '0.45.0';
const MONACO_CDN = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
const MONACO_LOCAL = '/node_modules/monaco-editor/min/vs';
const MONACO_BASE = import.meta.env.DEV ? MONACO_LOCAL : MONACO_CDN;

let monacoLoadStarted = false;
const monacoReadyCallbacks = [];

export function loadMonaco() {
  if (monacoLoadStarted) return;
  if (window.monaco?.editor) {
    monacoReadyCallbacks.forEach(cb => cb());
    monacoReadyCallbacks.length = 0;
    return;
  }
  monacoLoadStarted = true;

  const loaderScript = document.createElement('script');
  loaderScript.src = `${MONACO_BASE}/loader.js`;
  loaderScript.onerror = () => {
    monacoLoadStarted = false;
  };
  loaderScript.onload = () => {
    window.require.config({
      paths: { 'vs': MONACO_BASE }
    });
    window.require(['vs/editor/editor.main'], () => {
      monacoReadyCallbacks.forEach(cb => cb());
      monacoReadyCallbacks.length = 0;
    }, () => {
      monacoLoadStarted = false;
    });
  };
  document.head.appendChild(loaderScript);
}

export function onMonacoReady(callback) {
  if (window.monaco?.editor) {
    callback();
  } else {
    monacoReadyCallbacks.push(callback);
  }
}

export const MonacoLoaderMixin = (superClass) => class extends superClass {
  initMonaco() {
    loadMonaco();
  }

  injectMonacoStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `@import url('${MONACO_BASE}/editor/editor.main.css');`;
    this.shadowRoot.appendChild(styleElement);
  }
};
