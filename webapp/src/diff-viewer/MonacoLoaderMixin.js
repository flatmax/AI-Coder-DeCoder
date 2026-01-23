/**
 * Mixin for Monaco editor loading and initialization.
 */

let monacoLoading = false;
let monacoLoaded = false;

export function loadMonaco() {
  if (monacoLoaded || monacoLoading) return;
  monacoLoading = true;
  
  const loaderScript = document.createElement('script');
  loaderScript.src = '/node_modules/monaco-editor/min/vs/loader.js';
  loaderScript.onload = () => {
    window.require.config({ 
      paths: { 'vs': '/node_modules/monaco-editor/min/vs' }
    });
    window.require(['vs/editor/editor.main'], () => {
      monacoLoaded = true;
    });
  };
  document.head.appendChild(loaderScript);
}

export function isMonacoLoaded() {
  return monacoLoaded && window.monaco;
}

export const MonacoLoaderMixin = (superClass) => class extends superClass {

  initMonaco() {
    loadMonaco();
  }

  injectMonacoStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `@import url('/node_modules/monaco-editor/min/vs/editor/editor.main.css');`;
    this.shadowRoot.appendChild(styleElement);
  }

  waitForMonaco(callback) {
    if (isMonacoLoaded()) {
      callback();
    } else {
      setTimeout(() => this.waitForMonaco(callback), 100);
    }
  }
};
