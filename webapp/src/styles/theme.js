/**
 * Shared design tokens and base styles.
 */

import { css } from 'lit';

export const theme = css`
  :host {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --bg-overlay: #1c2128;

    --text-primary: #c9d1d9;
    --text-secondary: #8b949e;
    --text-muted: #6e7681;

    --border-primary: #30363d;
    --border-secondary: #21262d;

    --accent-primary: #4fc3f7;
    --accent-green: #7ee787;
    --accent-red: #ffa198;
    --accent-orange: #f0883e;
    --accent-yellow: #d29922;

    --font-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;

    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;

    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);

    --z-dialog: 100;
    --z-overlay: 200;
    --z-modal: 300;
    --z-toast: 400;
    --z-hud: 10000;
  }
`;

export const scrollbarStyles = css`
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--border-primary);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }
`;