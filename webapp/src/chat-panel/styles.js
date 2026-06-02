// Static styles for the ChatPanel component, extracted
// from chat-panel.js.
//
// One large `css` template literal. Lit reads `static
// styles` once at class definition time and adopts the
// resulting CSSStyleSheet onto every instance's shadow
// root.
//
// Sections (informational — the file is one block):
//   - Host + tab strip + overflow menu
//   - Messages area, scroll wrapper, file-search overlay
//   - Message cards, role labels, search highlight
//   - Finish-reason badges
//   - Message action toolbars (copy / paste)
//   - Markdown content (code blocks, copy buttons,
//     headings, tables)
//   - Streaming cursor
//   - Input area, action bar, search bar, mode toggle
//   - Snippet drawer
//   - Send button column
//   - Edit blocks (cards, diff lines, error messages)
//   - Edit summary banner
//   - File mentions, file summary chips
//   - Pending images, message images
//   - Lightbox overlay

import { css } from 'lit';

export const STYLES = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-primary, #0d1117);
    color: var(--text-primary, #c9d1d9);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  /* Tab strip — renders in normal flow at the top of
   * the chat panel. Always rendered (even with just
   * the Main tab) because the per-tab 📊 Context
   * icon is the only path to the Context overlay,
   * now that the dialog-level Context icon has been
   * removed.
   *
   * Inner .tab-strip-scroll is the scrollable row
   * of buttons; .tab-strip-overflow is pinned at
   * the right as an always-available direct-jump
   * affordance. */
  .tab-strip {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    background: rgba(22, 27, 34, 0.6);
    border-bottom: 1px solid rgba(240, 246, 252, 0.1);
    position: relative;
    /* The tab strip is the dialog drag handle now that
     * the LED row has been removed. Pointerdown handler
     * in dialog.js detects drag origin via the
     * data-drag-handle attribute on the strip's outer
     * div. Clicks on individual tab buttons skip drag
     * via the closest('button') guard, so dragging
     * works on the strip's empty background space and
     * the gap between tab buttons / overflow button. */
    cursor: grab;
  }
  .dialog.dragging .tab-strip {
    cursor: grabbing;
  }
  .tab-strip-scroll {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.25rem 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
    /* Thin scrollbar — macOS and most Linux themes
     * auto-hide scrollbars; Firefox and Windows show
     * them. A 4px track keeps the strip compact
     * regardless of platform default. */
    scrollbar-width: thin;
  }
  .tab-strip-scroll::-webkit-scrollbar {
    height: 4px;
  }
  .tab-strip-scroll::-webkit-scrollbar-thumb {
    background: rgba(240, 246, 252, 0.15);
    border-radius: 2px;
  }
  .tab-strip-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .tab-strip-tab {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary, #8b949e);
    padding: 0.3rem 0.75rem;
    border-radius: 4px 4px 0 0;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8125rem;
    white-space: nowrap;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 120ms ease, color 120ms ease;
  }
  .tab-strip-tab:hover {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
  }
  .tab-strip-tab.active {
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent-primary, #58a6ff);
    border-color: rgba(88, 166, 255, 0.3);
    border-bottom-color: rgba(22, 27, 34, 0.6);
  }

  /* Streaming pulse indicator (D21 Phase D1). Small
   * animated dot that appears on tab labels when the
   * tab has an in-flight stream. Visible on ALL
   * tabs regardless of active state — the point is
   * to let users see work happening on tabs they
   * aren't currently looking at. Positioned inline
   * with the label text; the tab button's existing
   * layout accommodates it without re-flow because
   * the dot has fixed width. */
  .tab-streaming-indicator {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary, #58a6ff);
    margin-right: 0.35rem;
    vertical-align: middle;
    animation: tab-pulse 1.5s ease-in-out infinite;
  }
  @keyframes tab-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }

  /* Close button on agent tabs (D21 Phase B3). Small
   * ✕ glyph inline with the label, visible only on
   * hover / focus to avoid visual noise when many
   * tabs are present. Nested inside the tab button
   * so it shares the tab's layout, but uses its own
   * click handler with stopPropagation so clicking
   * the ✕ doesn't also flip activeTabId to the tab
   * we're about to close. Main tab never renders
   * this button. */
  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-left: 0.4rem;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0;
    cursor: pointer;
    border-radius: 3px;
    font-size: 0.85rem;
    line-height: 1;
    padding: 0;
    transition: opacity 100ms ease, background 100ms ease;
  }
  .tab-strip-tab:hover .tab-close,
  .tab-strip-tab.active .tab-close,
  .tab-close:focus-visible {
    opacity: 0.7;
  }
  .tab-close:hover {
    opacity: 1 !important;
    background: rgba(240, 246, 252, 0.15);
  }

  /* Per-tab context icon — opens the Context overlay
   * scoped to this tab's conversation. Same fade-in
   * pattern as .tab-close: invisible by default,
   * visible on tab hover / active state / focus.
   * Sits to the left of the close button when both are
   * present. The icon is purely an affordance — the
   * tab's own click handler still activates the tab,
   * and the close button still closes it; this icon
   * adds a third gesture without taking space when
   * the user isn't reaching for it. */
  .tab-context {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 14px;
    margin-left: 0.4rem;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0;
    cursor: pointer;
    border-radius: 3px;
    font-size: 0.75rem;
    line-height: 1;
    padding: 0;
    transition: opacity 100ms ease, background 100ms ease;
  }
  .tab-strip-tab:hover .tab-context,
  .tab-strip-tab.active .tab-context,
  .tab-context:focus-visible {
    opacity: 0.7;
  }
  .tab-context:hover {
    opacity: 1 !important;
    background: rgba(88, 166, 255, 0.15);
  }

  /* Overflow menu — three-dots button at the right
   * edge, always visible when the strip is visible
   * (at least 2 tabs). Clicking opens a dropdown
   * listing every tab by label for direct jumping.
   *
   * The button is outside the scroll region so it
   * stays pinned regardless of scroll position —
   * users with 15 agent tabs can always find the
   * jump menu without scrolling to the end. */
  .tab-strip-overflow {
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-left: 1px solid rgba(240, 246, 252, 0.08);
    color: var(--text-secondary, #8b949e);
    padding: 0 0.6rem;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    transition: background 120ms ease, color 120ms ease;
  }
  .tab-strip-overflow:hover {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
  }
  .tab-strip-overflow[aria-expanded="true"] {
    background: rgba(240, 246, 252, 0.08);
    color: var(--text-primary, #c9d1d9);
  }
  /* Minimize button — sits at the right edge of the
   * tab strip after the overflow ⋯ button. Same
   * neutral styling as the overflow button so the
   * strip's right cluster reads as a single
   * dialog-level control group. The ▾ glyph
   * matches the dialog header's old minimize button
   * for visual continuity. */
  .tab-strip-minimize {
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-left: 1px solid rgba(240, 246, 252, 0.08);
    color: var(--text-secondary, #8b949e);
    padding: 0 0.6rem;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1;
    transition: background 120ms ease, color 120ms ease;
  }
  .tab-strip-minimize:hover {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
  }
  .tab-strip-overflow-menu {
    position: absolute;
    top: 100%;
    right: 0.25rem;
    z-index: 20;
    background: var(--bg-primary, #0d1117);
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 0.25rem;
    min-width: 12rem;
    max-width: 20rem;
    max-height: 24rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .tab-strip-overflow-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-primary, #c9d1d9);
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-strip-overflow-item:hover {
    background: rgba(240, 246, 252, 0.08);
  }
  .tab-strip-overflow-item.active {
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent-primary, #58a6ff);
  }

  /* LED row (D21 Phase E). Compact dot row sitting
   * directly under the tab strip in the main tab
   * header. One dot per agent tab; click activates the
   * agent's tab (same effect as clicking the tab).
   * Three colour variants:
   *
   *   .led-cyan  — agent stream is in flight (flashing)
   *   .led-green — last completion clean
   *   .led-red   — last completion errored
   *
   * The row hides itself by being empty when there are
   * no agent tabs — renderLedRow returns an empty
   * template which produces no DOM. flex-wrap means 8+ agents
   * flow onto a second row rather than truncating, per
   * specs4/5-webapp/agent-browser.md § Layout.
   *
   * The active-tab dot is slightly enlarged so users
   * can see at a glance which agent's transcript is
   * currently shown in the message area. */
  /* LED strip — compact horizontal bar centered below
   * the input row, above the compaction-capacity bar.
   * Replaces the earlier full-width LED row that sat
   * at the top of the chat panel. The strip reuses the
   * same dot styling (cyan/green/red, click-to-activate,
   * tooltip per state) but takes minimal vertical space
   * — just enough to host the dots themselves.
   *
   * Centered horizontally so the dots align below the
   * textarea regardless of how wide the dialog is. No
   * background or border — the strip blends into the
   * input area's surface. */
  .led-strip {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    /* Right padding mirrors the send-column width (4rem
     * Send button + 0.5rem input-row gap) so the
     * justify-content:center rule centers the dots
     * underneath the textarea instead of underneath the
     * full input area. */
    padding: 0.1rem 4.5rem 0 0;
    margin-top: 0;
    line-height: 0;
  }
  .led-dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid transparent;
    padding: 0;
    cursor: pointer;
    background: var(--text-secondary, #8b949e);
    transition: transform 100ms ease, box-shadow 100ms ease;
  }
  .led-dot:hover {
    transform: scale(1.25);
  }
  .led-dot.active {
    width: 12px;
    height: 12px;
    box-shadow: 0 0 0 2px rgba(240, 246, 252, 0.25);
  }
  .led-dot.led-cyan {
    background: #4fc3f7;
    animation: led-pulse 1.2s ease-in-out infinite;
  }
  .led-dot.led-green {
    background: #7ee787;
  }
  .led-dot.led-red {
    background: #f85149;
  }
  @keyframes led-pulse {
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 0 0 rgba(79, 195, 247, 0.5);
    }
    50% {
      opacity: 0.55;
      box-shadow: 0 0 0 4px rgba(79, 195, 247, 0);
    }
  }
  /* Active dot in cyan state — keep the white outline
   * ring (so users see it's active) on top of the
   * pulsing cyan glow. The ring uses a separate
   * outline so the keyframe's box-shadow can still
   * pulse without fighting the ring. */
  .led-dot.led-cyan.active {
    outline: 2px solid rgba(240, 246, 252, 0.4);
    outline-offset: 1px;
  }

  .messages-wrapper {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .messages.messages-hidden {
    display: none;
  }
  /* File search overlay — fills the wrapper, scroll
   * independent of messages. Messages stay in DOM so
   * state (scroll position, streaming cards) survives
   * across mode toggles. */
  .file-search-overlay {
    position: absolute;
    inset: 0;
    background: var(--bg-primary, #0d1117);
    overflow-y: auto;
    padding: 0.5rem 0;
  }
  .file-search-empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-secondary, #8b949e);
    font-style: italic;
  }
  .file-search-section {
    border-bottom: 1px solid rgba(240, 246, 252, 0.06);
  }
  .file-search-section:last-child {
    border-bottom: none;
  }
  .file-section-header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0.4rem 1rem;
    background: rgba(22, 27, 34, 0.95);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    border-bottom: 1px solid rgba(240, 246, 252, 0.08);
  }
  .file-section-header:hover {
    background: rgba(240, 246, 252, 0.04);
  }
  .file-section-path {
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 0.8125rem;
    color: var(--accent-primary, #58a6ff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .file-section-count {
    font-size: 0.75rem;
    color: var(--text-secondary, #8b949e);
    background: rgba(13, 17, 23, 0.6);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  .file-match-row {
    display: flex;
    gap: 0.75rem;
    padding: 0.2rem 1rem 0.2rem 2rem;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 0.8125rem;
    cursor: pointer;
    line-height: 1.4;
  }
  .file-match-row:hover {
    background: rgba(240, 246, 252, 0.04);
  }
  .file-match-row.focused {
    background: rgba(88, 166, 255, 0.12);
    border-left: 3px solid var(--accent-primary, #58a6ff);
    padding-left: calc(2rem - 3px);
  }
  .file-match-row.context {
    color: var(--text-secondary, #8b949e);
    opacity: 0.7;
    cursor: default;
  }
  .file-match-row.context:hover {
    background: transparent;
  }
  .file-match-linenum {
    color: var(--text-secondary, #8b949e);
    text-align: right;
    width: 3.5rem;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .file-match-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .file-match-highlight {
    background: rgba(210, 153, 34, 0.25);
    border-radius: 2px;
    padding: 0 2px;
    margin: 0 -2px;
  }

  .empty-state {
    margin: auto;
    opacity: 0.5;
    font-style: italic;
    text-align: center;
  }

  .message-card {
    border-radius: 8px;
    padding: 0.75rem 1rem;
    max-width: 100%;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  .message-card.role-user {
    background: rgba(88, 166, 255, 0.08);
    border: 1px solid rgba(88, 166, 255, 0.2);
  }
  .message-card.role-assistant {
    background: rgba(240, 246, 252, 0.03);
    border: 1px solid rgba(240, 246, 252, 0.1);
  }
  .message-card.role-system {
    background: rgba(240, 246, 252, 0.03);
    border: 1px dashed rgba(240, 246, 252, 0.2);
    color: var(--text-secondary, #8b949e);
    font-style: italic;
  }
  .message-card.streaming {
    border-color: var(--accent-primary, #58a6ff);
  }
  /* Search highlight — current match gets an accent border
   * and subtle glow. Applied via the 'search-highlight'
   * class when a message's data-msg-index matches the
   * _searchCurrentIndex state. Transparent default border
   * on every card makes the transition smooth (no layout
   * shift when the highlight comes and goes). */
  .message-card {
    transition: border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .message-card.search-highlight {
    border-color: var(--accent-primary, #58a6ff);
    box-shadow: 0 0 0 1px var(--accent-primary, #58a6ff),
      0 0 12px rgba(79, 195, 247, 0.15);
  }

  .role-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
    margin-bottom: 0.375rem;
  }
  .finish-reason-badge {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.05rem 0.4rem;
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: normal;
    border-radius: 3px;
    /* Default (amber) — used for uncategorised non-natural
     * stops. Specific reasons override via the modifier
     * classes below. */
    background: rgba(210, 153, 34, 0.15);
    color: #d29922;
    border: 1px solid rgba(210, 153, 34, 0.3);
    opacity: 1;
  }
  /* Red variants for the two most disruptive stop reasons —
   * truncation (hit max_tokens) and content-filter blocks.
   * Specs3 §Finish Reason calls these out as "red badge +
   * error toast"; the amber default is for everything else
   * non-natural (tool_calls, function_call, unknown).
   * Override both background and border so the pill
   * visually pops against the amber variant. */
  .finish-reason-badge.severity-error {
    background: rgba(248, 81, 73, 0.15);
    color: #f85149;
    border-color: rgba(248, 81, 73, 0.4);
  }
  /* Muted green variant for natural completions (stop,
   * end_turn). Per specs-reference/5-webapp/chat.md §
   * Finish-reason badge labels — natural reasons produce
   * a visible-but-quiet badge so users get positive
   * confirmation the stream ended cleanly, without the
   * badge dominating the role label on every successful
   * turn. Reduced opacity keeps the pill readable but
   * visually secondary to the role label text. */
  .finish-reason-badge.severity-natural {
    background: rgba(126, 231, 135, 0.1);
    color: #7ee787;
    border-color: rgba(126, 231, 135, 0.25);
    opacity: 0.6;
  }

  /* Footer slot for the natural-completion finish
   * badge — anchored bottom-left, mirroring the
   * bottom toolbar's bottom-right anchor. Sits at
   * the same baseline as the copy/paste icons so
   * the badge reads as a peer of the message
   * actions rather than a separate row. Muted
   * styling on the badge itself keeps it from
   * competing with the role label or body content
   * for attention.
   *
   * The card reserves bottom padding via the
   * .has-finish-footer modifier so the absolute
   * badge doesn't overlap the last line of body
   * content. */
  .message-card.has-finish-footer {
    padding-bottom: 2rem;
  }
  .finish-reason-footer {
    position: absolute;
    left: 0.5rem;
    bottom: 0.4rem;
    z-index: 1;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .message-card:hover .finish-reason-footer {
    opacity: 1;
  }

  /* Message action toolbars — hover-only copy and paste
   * buttons, at top-right and bottom-right of each card.
   * Both ends because long messages might be partially
   * scrolled off either side of the viewport; having a
   * toolbar at each end saves the user from scrolling to
   * reach actions.
   *
   * position:relative on the card + absolute on the
   * toolbars keeps them anchored regardless of card
   * content height. Hover-only via opacity transition —
   * the buttons don't steal space or draw attention
   * during normal reading, and are discoverable via
   * mouseover. */
  .message-card {
    position: relative;
  }
  .message-toolbar {
    position: absolute;
    right: 0.5rem;
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 120ms ease;
    /* Buttons should be above the card's text content
     * so they're clickable when visible. */
    z-index: 1;
  }
  .message-toolbar.top {
    top: 0.4rem;
  }
  .message-toolbar.bottom {
    bottom: 0.4rem;
  }
  .message-card:hover .message-toolbar {
    opacity: 1;
  }
  .message-action-button {
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid rgba(240, 246, 252, 0.2);
    color: var(--text-primary, #c9d1d9);
    padding: 0.15rem 0.4rem;
    font-size: 0.75rem;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    line-height: 1;
  }
  .message-action-button:hover {
    background: rgba(240, 246, 252, 0.1);
    border-color: rgba(240, 246, 252, 0.4);
  }
  .message-action-button:active {
    transform: translateY(1px);
  }

  /* Markdown-rendered content inherits the message card's
   * styling but tightens up paragraphs and adds a subtle
   * background on code blocks. */
  .md-content :first-child {
    margin-top: 0;
  }
  .md-content :last-child {
    margin-bottom: 0;
  }
  .md-content p {
    margin: 0.5rem 0;
  }
  .md-content pre {
    background: rgba(13, 17, 23, 0.9);
    border: 1px solid rgba(240, 246, 252, 0.1);
    border-radius: 6px;
    padding: 0.75rem;
    overflow-x: auto;
    margin: 0.75rem 0;
  }
  /* Code block chrome — floating copy button at top-right,
   * small language pill. Positioned absolute within the
   * pre element so they float over content rather than
   * pushing it. Button hidden by default (opacity 0) and
   * fades in on hover — avoids streaming flicker when
   * markdown re-renders mid-chunk. */
  .md-content pre.code-block {
    position: relative;
  }
  .md-content pre.code-block .code-lang {
    position: absolute;
    top: 0.35rem;
    right: 2.5rem;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary, #8b949e);
    opacity: 0.5;
    font-family: inherit;
    pointer-events: none;
    user-select: none;
  }
  .md-content pre.code-block .code-copy-btn {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    width: 26px;
    height: 26px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(22, 27, 34, 0.85);
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 4px;
    color: var(--text-secondary, #8b949e);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease, color 120ms ease,
      background 120ms ease, border-color 120ms ease;
  }
  .md-content pre.code-block:hover .code-copy-btn,
  .md-content pre.code-block .code-copy-btn:focus-visible {
    opacity: 1;
  }
  .md-content pre.code-block .code-copy-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: rgba(240, 246, 252, 0.1);
    border-color: rgba(240, 246, 252, 0.3);
  }
  .md-content pre.code-block .code-copy-btn.copied {
    color: #7ee787;
    border-color: rgba(126, 231, 135, 0.4);
    opacity: 1;
  }
  .md-content pre.code-block .code-copy-icon {
    display: block;
  }
  .md-content code {
    background: rgba(13, 17, 23, 0.6);
    border-radius: 3px;
    padding: 0.1rem 0.35rem;
    font-size: 0.875em;
  }
  .md-content pre code {
    background: transparent;
    padding: 0;
    font-size: 0.875em;
  }
  .md-content h1,
  .md-content h2,
  .md-content h3 {
    margin: 1rem 0 0.5rem;
    line-height: 1.3;
  }
  .md-content table {
    border-collapse: collapse;
    margin: 0.75rem 0;
  }
  .md-content th,
  .md-content td {
    border: 1px solid rgba(240, 246, 252, 0.15);
    padding: 0.35rem 0.6rem;
  }

  .cursor {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    background: var(--accent-primary, #58a6ff);
    vertical-align: text-bottom;
    margin-left: 2px;
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    to {
      opacity: 0;
    }
  }

  /* Input area at the bottom. */
  .input-area {
    flex-shrink: 0;
    border-top: 1px solid rgba(240, 246, 252, 0.1);
    padding: 0.75rem 1rem 0.15rem;
    background: rgba(13, 17, 23, 0.6);
  }
  .action-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    min-height: 1.75rem;
  }
  .action-bar .spacer {
    flex: 1;
  }
  .action-bar .action-divider {
    width: 1px;
    height: 1.25rem;
    background: rgba(240, 246, 252, 0.15);
    flex-shrink: 0;
  }
  .action-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .action-button {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary, #8b949e);
    padding: 0.25rem 0.5rem;
    font-size: 0.8125rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .action-button:hover {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
    border-color: rgba(240, 246, 252, 0.1);
  }
  .action-button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .action-button:disabled:hover {
    background: transparent;
    border-color: transparent;
  }
  .action-button.active {
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent-primary, #58a6ff);
    border-color: rgba(88, 166, 255, 0.3);
    box-shadow:
      0 0 0 1px rgba(88, 166, 255, 0.55),
      0 0 8px rgba(88, 166, 255, 0.45);
  }
  /* Search bar — sits inside the action bar between the
   * snippet-drawer toggle and the session buttons. Flex-1
   * to take the middle space. Inline toggles live inside
   * the input's border so the whole search area visually
   * groups as one element. */
  .search-bar {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }
  /* When the search bar has focus, hide the
   * surrounding action-bar buttons (mode +
   * cross-ref toggle on the left, new-session +
   * history on the right) so the search bar
   * itself — input, mode toggle, count, prev/next
   * — can claim the whole row.
   *
   * The hidden buttons get a 'search-collapsible'
   * class. When focus leaves the search bar
   * (Escape, click outside, Tab away), they
   * reappear. The hide is achieved by collapsing
   * the parent action-group / control wrapper to
   * zero width via 'display: none', so flex gaps
   * around them collapse too — no awkward empty
   * space. */
  .action-bar:has(.search-bar:focus-within) .search-collapsible {
    display: none;
  }
  /* Symmetric rule: when the search bar does NOT
   * have focus, hide every affordance except the
   * input itself — the 💬/📁 segmented mode
   * toggle, the option toggles (Aa / .* / ab),
   * the match counter, and the prev/next arrows.
   * Rest state collapses to a single text box
   * whose placeholder ("Search messages…" /
   * "Search files…") indicates the active mode.
   * As soon as focus enters the search bar
   * (clicking the input itself counts), the full
   * toolbar reappears via the :focus-within
   * branch above so the user can pick a mode,
   * flip an option, or step through matches. */
  .search-bar:not(:focus-within) .search-mode-segmented,
  .search-bar:not(:focus-within) .search-toggle,
  .search-bar:not(:focus-within) .search-counter,
  .search-bar:not(:focus-within) .search-nav {
    display: none;
  }
  .search-input-wrapper {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    background: rgba(13, 17, 23, 0.8);
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 4px;
    overflow: hidden;
  }
  .search-input-wrapper:focus-within {
    border-color: var(--accent-primary, #58a6ff);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    background: transparent;
    border: none;
    color: var(--text-primary, #c9d1d9);
    font-family: inherit;
    font-size: 0.8125rem;
  }
  .search-input:focus {
    outline: none;
  }
  .search-toggle {
    background: transparent;
    border: none;
    color: var(--text-secondary, #8b949e);
    padding: 0.25rem 0.4rem;
    font-size: 0.7rem;
    font-family: 'SFMono-Regular', Consolas, monospace;
    cursor: pointer;
    border-radius: 2px;
    line-height: 1;
  }
  .search-toggle:hover {
    background: rgba(240, 246, 252, 0.08);
    color: var(--text-primary, #c9d1d9);
  }
  .search-toggle.active {
    background: rgba(88, 166, 255, 0.2);
    color: var(--accent-primary, #58a6ff);
    box-shadow:
      0 0 0 1px rgba(88, 166, 255, 0.55),
      0 0 8px rgba(88, 166, 255, 0.45);
  }
  .search-counter {
    font-size: 0.75rem;
    color: var(--text-secondary, #8b949e);
    font-variant-numeric: tabular-nums;
    padding: 0 0.5rem;
    white-space: nowrap;
  }
  .search-counter.no-match {
    color: #f85149;
  }
  .search-nav {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }
  .search-nav-button {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary, #8b949e);
    padding: 0.2rem 0.4rem;
    font-size: 0.75rem;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1;
  }
  .search-nav-button:hover {
    background: rgba(240, 246, 252, 0.08);
    color: var(--text-primary, #c9d1d9);
  }
  .search-nav-button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  /* Search mode segmented control — two side-by-side
   * buttons at the left of the search bar
   * (💬 messages / 📁 files). Always visible
   * regardless of focus state so the active mode and
   * the toggle to the other mode are both immediately
   * discoverable. Mirrors the .mode-segmented pattern
   * used for the code/doc toggle. */
  .search-mode-segmented {
    display: inline-flex;
    flex-shrink: 0;
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 4px;
  }
  .search-mode-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #8b949e);
    padding: 0.25rem 0.4rem;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .search-mode-btn:first-child {
    border-radius: 3px 0 0 3px;
  }
  .search-mode-btn:last-child {
    border-radius: 0 3px 3px 0;
  }
  .search-mode-btn:hover {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
  }
  .search-mode-btn.active {
    background: rgba(88, 166, 255, 0.22);
    color: var(--accent-primary, #58a6ff);
    border-radius: 3px;
    box-shadow:
      0 0 0 1px rgba(88, 166, 255, 0.55),
      0 0 8px rgba(88, 166, 255, 0.45);
  }
  /* Mode + cross-ref buttons — sit at the right end of
   * the search bar. Compact icon-only presentation
   * matches the search nav arrows. */
  .mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .mode-segmented {
    display: inline-flex;
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 4px;
  }
  .mode-segmented .mode-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #8b949e);
    padding: 0.25rem 0.4rem;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .mode-segmented .mode-btn:first-child {
    border-radius: 3px 0 0 3px;
  }
  .mode-segmented .mode-btn:last-child {
    border-radius: 0 3px 3px 0;
  }
  .mode-segmented .mode-btn.active {
    border-radius: 3px;
  }
  .mode-segmented .mode-btn:hover:not([disabled]) {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
  }
  .mode-segmented .mode-btn.active {
    background: rgba(88, 166, 255, 0.22);
    color: var(--accent-primary, #58a6ff);
    box-shadow:
      0 0 0 1px rgba(88, 166, 255, 0.55),
      0 0 8px rgba(88, 166, 255, 0.45);
  }
  .mode-segmented .mode-btn[disabled] {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .crossref-btn {
    background: transparent;
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 4px;
    color: var(--text-secondary, #8b949e);
    padding: 0.25rem 0.4rem;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .crossref-btn:hover:not([disabled]) {
    background: rgba(240, 246, 252, 0.06);
    color: var(--text-primary, #c9d1d9);
  }
  .crossref-btn.active {
    background: rgba(210, 153, 34, 0.22);
    border-color: rgba(210, 153, 34, 0.65);
    color: #d29922;
    box-shadow:
      0 0 0 1px rgba(210, 153, 34, 0.5),
      0 0 8px rgba(210, 153, 34, 0.4);
  }
  .crossref-btn[disabled] {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .snippet-drawer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.5rem 0;
    margin-bottom: 0.5rem;
    border-top: 1px solid rgba(240, 246, 252, 0.08);
    border-bottom: 1px solid rgba(240, 246, 252, 0.08);
  }
  .snippet-empty {
    padding: 0.25rem 0.5rem;
    color: var(--text-secondary, #8b949e);
    font-style: italic;
    font-size: 0.8125rem;
  }
  .snippet-button {
    background: rgba(13, 17, 23, 0.6);
    border: 1px solid rgba(240, 246, 252, 0.1);
    color: var(--text-primary, #c9d1d9);
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8125rem;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .snippet-button:hover {
    background: rgba(240, 246, 252, 0.06);
    border-color: rgba(240, 246, 252, 0.2);
  }
  .snippet-icon {
    font-size: 0.9375rem;
  }
  .snippet-label {
    color: var(--text-secondary, #8b949e);
  }
  .input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }
  /* Stack a top row (snippets + microphone, side by
   * side) above the send button at the right edge of
   * the input row. align-items:stretch lets the top
   * row's combined width drive the send button's
   * width so the column sits on a clean vertical
   * axis. */
  .send-column {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: stretch;
    flex-shrink: 0;
  }
  .send-column-top {
    display: flex;
    gap: 0;
    align-items: stretch;
  }
  .input-textarea {
    flex: 1;
    min-height: 2.25rem;
    max-height: 12rem;
    resize: none;
    padding: 0.5rem 0.75rem;
    background: rgba(13, 17, 23, 0.8);
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 6px;
    color: var(--text-primary, #c9d1d9);
    font-family: inherit;
    font-size: inherit;
    line-height: 1.4;
  }
  .input-textarea:focus {
    outline: none;
    border-color: var(--accent-primary, #58a6ff);
  }
  .input-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .send-button {
    flex-shrink: 0;
    min-width: 4rem;
    padding: 0.5rem 1rem;
    background: var(--accent-primary, #58a6ff);
    border: none;
    border-radius: 6px;
    color: #0d1117;
    font-weight: 600;
    cursor: pointer;
  }
  .send-button:hover {
    filter: brightness(1.1);
  }
  .send-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .send-button.stop {
    background: #f85149;
    color: #fff;
  }

  /* Disconnected banner — shown when RPC isn't ready so users
   * understand why the Send button is inert. */
  .disconnected-note {
    padding: 0.5rem 1rem;
    background: rgba(248, 81, 73, 0.1);
    color: #f85149;
    font-size: 0.8125rem;
    border-top: 1px solid rgba(248, 81, 73, 0.25);
  }

  /* Edit blocks — visual cards for edits proposed by the
   * assistant. Minimal styling here; Phase 2d adds the
   * character-level diff highlighting. */
  .assistant-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .edit-block-card {
    border: 1px solid rgba(240, 246, 252, 0.15);
    border-radius: 6px;
    background: rgba(13, 17, 23, 0.4);
    overflow: hidden;
    font-size: 0.875rem;
  }
  .edit-block-card.edit-status-applied {
    border-color: rgba(126, 231, 135, 0.4);
  }
  .edit-block-card.edit-status-failed {
    border-color: rgba(248, 81, 73, 0.45);
  }
  .edit-block-card.edit-status-skipped,
  .edit-block-card.edit-status-not-in-context {
    border-color: rgba(210, 153, 34, 0.4);
  }
  .edit-block-card.edit-status-pending,
  .edit-block-card.edit-status-new {
    border-color: rgba(88, 166, 255, 0.35);
  }
  .edit-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: rgba(22, 27, 34, 0.7);
    border-bottom: 1px solid rgba(240, 246, 252, 0.08);
  }
  .edit-file-path {
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 0.8125rem;
    color: var(--accent-primary, #58a6ff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
    margin: -0.1rem -0.25rem;
    border-radius: 3px;
    transition: background 120ms ease;
  }
  .edit-file-path:hover {
    background: rgba(88, 166, 255, 0.12);
    text-decoration: underline;
  }
  .edit-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    background: rgba(13, 17, 23, 0.6);
  }
  .edit-status-icon {
    font-size: 0.875rem;
  }
  .edit-status-applied {
    color: #7ee787;
  }
  .edit-status-failed {
    color: #f85149;
  }
  .edit-status-skipped,
  .edit-status-not-in-context {
    color: #d29922;
  }
  .edit-status-pending,
  .edit-status-new {
    color: var(--accent-primary, #58a6ff);
  }
  .edit-status-unknown {
    color: var(--text-secondary, #8b949e);
  }
  .edit-body {
    display: flex;
    flex-direction: column;
  }
  .edit-pane {
    border-bottom: 1px solid rgba(240, 246, 252, 0.05);
  }
  .edit-pane:last-child {
    border-bottom: none;
  }
  .edit-pane-label {
    padding: 0.25rem 0.75rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--text-secondary, #8b949e);
    background: rgba(22, 27, 34, 0.4);
  }
  .edit-pane-old .edit-pane-label {
    color: #f85149;
  }
  .edit-pane-new .edit-pane-label {
    color: #7ee787;
  }
  .edit-pane-content {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    border-radius: 0;
    overflow-x: auto;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-primary, #c9d1d9);
  }
  /* Unified-diff line styling inside an edit card. Each
   * line renders as a span.diff-line with a TYPE modifier
   * (context/add/remove), a non-selectable prefix column
   * carrying the +/-/space glyph, and a text column.
   * Line-level background colours echo GitHub / GitLab
   * diff conventions — green for add, red for remove,
   * transparent for context — so a reader can scan
   * vertically without parsing the prefix glyphs. */
  .diff-line {
    display: block;
    white-space: pre;
    padding: 0 0.25rem;
    margin: 0 -0.25rem;
    border-left: 2px solid transparent;
  }
  .diff-line.context {
    color: var(--text-primary, #c9d1d9);
  }
  .diff-line.add {
    background: rgba(126, 231, 135, 0.12);
    border-left-color: rgba(126, 231, 135, 0.5);
    color: #a6e3af;
  }
  .diff-line.remove {
    background: rgba(248, 81, 73, 0.12);
    border-left-color: rgba(248, 81, 73, 0.5);
    color: #ff9b93;
  }
  /* Prefix column — single-char glyph with fixed width
   * so text aligns vertically regardless of content. */
  .diff-prefix {
    display: inline-block;
    width: 1em;
    user-select: none;
    opacity: 0.55;
    margin-right: 0.25rem;
  }
  .diff-text {
    display: inline;
  }
  /* Word-level highlight within an already-coloured
   * line. Paired remove/add runs pick up a
   * span.diff-change around the specific words that
   * changed — a saturated background on top of the
   * line-level colour draws the eye to the actual
   * edit without hiding the surrounding context. */
  .diff-change {
    border-radius: 2px;
    padding: 0 1px;
  }
  .diff-line.add .diff-change {
    background: rgba(126, 231, 135, 0.35);
    color: #fff;
  }
  .diff-line.remove .diff-change {
    background: rgba(248, 81, 73, 0.35);
    color: #fff;
  }
  .edit-error-message {
    padding: 0.4rem 0.75rem;
    background: rgba(248, 81, 73, 0.08);
    color: #f85149;
    font-size: 0.8125rem;
    border-top: 1px solid rgba(248, 81, 73, 0.15);
  }

  /* Agent-spawn cards — rendered inline in the
   * orchestrator's assistant message when it emits a
   * 🟧🟧🟧 AGENT block. Symmetric to edit-block cards
   * but with a magenta accent so users can tell at a
   * glance whether a card is "the LLM proposes a file
   * edit" vs. "the LLM spawned a worker agent".
   *
   * The id chip is clickable and, when the agent's tab
   * exists, switches the chat panel to that tab. Click
   * delegation lives on the wrapper div in rendering.js.
   * Per specs4/7-future/parallel-agents.md § Frontend
   * agent-block rendering. */
  .agent-block-wrapper {
    display: contents;
  }
  .agent-block-card {
    border: 1px solid rgba(210, 168, 255, 0.35);
    border-radius: 6px;
    background: rgba(210, 168, 255, 0.04);
    overflow: hidden;
    font-size: 0.875rem;
  }
  .agent-block-card.agent-status-streaming {
    border-color: rgba(210, 168, 255, 0.55);
    box-shadow: 0 0 0 1px rgba(210, 168, 255, 0.15);
  }
  .agent-block-card.agent-status-complete {
    border-color: rgba(126, 231, 135, 0.4);
  }
  .agent-block-card.agent-status-error {
    border-color: rgba(248, 81, 73, 0.45);
  }
  .agent-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: rgba(22, 27, 34, 0.7);
    border-bottom: 1px solid rgba(240, 246, 252, 0.08);
  }
  .agent-card-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }
  .agent-id-chip {
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 0.8125rem;
    color: #c8a2ff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    margin: -0.1rem -0.35rem;
    border-radius: 3px;
    transition: background 120ms ease;
  }
  .agent-id-chip:hover {
    background: rgba(210, 168, 255, 0.15);
    text-decoration: underline;
  }
  .agent-id-chip:focus-visible {
    outline: 2px solid #c8a2ff;
    outline-offset: 1px;
  }
  .agent-id-chip.agent-id-empty {
    color: var(--text-secondary, #8b949e);
    cursor: default;
    font-style: italic;
  }
  .agent-id-chip.agent-id-empty:hover {
    background: transparent;
    text-decoration: none;
  }
  .agent-mode-pill {
    flex-shrink: 0;
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    background: rgba(13, 17, 23, 0.6);
    color: var(--text-secondary, #8b949e);
    border: 1px solid rgba(240, 246, 252, 0.1);
    border-radius: 3px;
    font-family: 'SFMono-Regular', Consolas, monospace;
  }
  .agent-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    background: rgba(13, 17, 23, 0.6);
  }
  .agent-status-icon {
    font-size: 0.875rem;
  }
  .agent-status-badge.agent-status-pending {
    color: var(--text-secondary, #8b949e);
  }
  .agent-status-badge.agent-status-streaming {
    color: #c8a2ff;
  }
  .agent-status-badge.agent-status-streaming .agent-status-icon {
    animation: agent-pulse 1.5s ease-in-out infinite;
  }
  @keyframes agent-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .agent-status-badge.agent-status-complete {
    color: #7ee787;
  }
  .agent-status-badge.agent-status-error {
    color: #f85149;
  }
  .agent-task-body {
    padding: 0.5rem 0.75rem;
  }
  .agent-task-empty {
    padding: 0.5rem 0.75rem;
    color: var(--text-secondary, #8b949e);
    font-style: italic;
    font-size: 0.8125rem;
  }
  .agent-task-long {
    padding: 0;
  }
  .agent-task-long .agent-task-summary {
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    color: var(--text-secondary, #8b949e);
    font-size: 0.8125rem;
    user-select: none;
  }
  .agent-task-long .agent-task-summary:hover {
    background: rgba(240, 246, 252, 0.04);
    color: var(--text-primary, #c9d1d9);
  }
  .agent-task-long[open] .agent-task-summary {
    border-bottom: 1px solid rgba(240, 246, 252, 0.08);
  }
  .agent-task-long .agent-task-markdown {
    padding: 0.5rem 0.75rem;
  }
  .agent-task-markdown :first-child {
    margin-top: 0;
  }
  .agent-task-markdown :last-child {
    margin-bottom: 0;
  }

  /* Edit summary banner — rendered at the end of an
   * assistant message (after all edit cards) when the
   * response contained at least one edit. Shows aggregate
   * counts as color-coded stat badges; lists individual
   * failures; notes when a retry prompt was populated.
   * Per specs4/5-webapp/chat.md §Edit Summary Banner. */
  .edit-summary {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: rgba(22, 27, 34, 0.6);
    border: 1px solid rgba(240, 246, 252, 0.1);
    border-radius: 6px;
    font-size: 0.8125rem;
  }
  .edit-summary-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .edit-summary-title {
    font-weight: 600;
    color: var(--text-secondary, #8b949e);
    margin-right: 0.25rem;
  }
  .edit-summary-stat {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .edit-summary-stat.applied {
    background: rgba(126, 231, 135, 0.12);
    color: #7ee787;
    border: 1px solid rgba(126, 231, 135, 0.3);
  }
  .edit-summary-stat.failed {
    background: rgba(248, 81, 73, 0.12);
    color: #f85149;
    border: 1px solid rgba(248, 81, 73, 0.3);
  }
  .edit-summary-stat.skipped,
  .edit-summary-stat.not-in-context {
    background: rgba(210, 153, 34, 0.12);
    color: #d29922;
    border: 1px solid rgba(210, 153, 34, 0.3);
  }
  .edit-summary-failures {
    margin-top: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid rgba(240, 246, 252, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .edit-summary-failure {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.8125rem;
  }
  .edit-summary-failure-path {
    font-family: 'SFMono-Regular', Consolas, monospace;
    color: var(--accent-primary, #58a6ff);
    cursor: pointer;
  }
  .edit-summary-failure-path:hover {
    text-decoration: underline;
  }
  .edit-summary-failure-type {
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    background: rgba(248, 81, 73, 0.15);
    color: #f85149;
    border-radius: 3px;
    text-transform: lowercase;
  }
  .edit-summary-failure-message {
    color: var(--text-secondary, #8b949e);
    flex: 1 1 100%;
    padding-left: 0.5rem;
  }
  .edit-summary-retry-note {
    margin-top: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid rgba(240, 246, 252, 0.08);
    font-size: 0.8125rem;
    color: var(--text-secondary, #8b949e);
    font-style: italic;
  }

  /* File mentions — clickable path references inside
   * assistant prose. Styled to look like a link without
   * actually being one (no underline by default to keep
   * prose readable; underline on hover for affordance). */
  .file-mention {
    color: var(--accent-primary, #58a6ff);
    cursor: pointer;
    border-radius: 3px;
    padding: 0 0.15rem;
    transition: background 120ms ease;
  }
  .file-mention:hover {
    background: rgba(88, 166, 255, 0.12);
    text-decoration: underline;
  }

  /* Historical (read-only) tab styling. Tabs
   * loaded from the archive via the View Agents
   * affordance carry a muted appearance so users
   * can distinguish them at a glance from live
   * tabs. The 📜 prefix in the label is the
   * primary signal; the dimmed background +
   * border is the secondary one. Active state
   * still uses the accent border so the user can
   * see which historical tab they're reading. */
  .tab-strip-tab.read-only {
    opacity: 0.7;
    font-style: italic;
  }
  .tab-strip-tab.read-only.active {
    opacity: 1;
    background: rgba(240, 246, 252, 0.06);
    border-color: rgba(240, 246, 252, 0.25);
    border-bottom-color: rgba(22, 27, 34, 0.6);
  }

  /* View-agents affordance — small button below
   * agentic-turn assistant messages that aren't
   * the active turn. Visible only on hover by
   * default to avoid visual noise on every
   * agentic message; full opacity on focus so
   * keyboard users can find it. */
  .view-agents-affordance {
    margin-top: 0.5rem;
    opacity: 0.4;
    transition: opacity 120ms ease;
  }
  .message-card:hover .view-agents-affordance,
  .view-agents-affordance:focus-within {
    opacity: 1;
  }
  .view-agents-button {
    background: transparent;
    border: 1px solid rgba(240, 246, 252, 0.15);
    color: var(--text-secondary, #8b949e);
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    font-family: inherit;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    line-height: 1.3;
    transition: background 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }
  .view-agents-button:hover {
    background: rgba(240, 246, 252, 0.06);
    border-color: rgba(240, 246, 252, 0.25);
    color: var(--text-primary, #c9d1d9);
  }
  .view-agents-button:focus-visible {
    outline: 2px solid var(--accent-primary, #58a6ff);
    outline-offset: 2px;
  }

  /* File summary section — renders below the assistant
   * message body, shows every file the message referenced
   * (via edit blocks or inline mentions) as a chip. The
   * chips are deliberately NOT styled as links — they're
   * buttons that toggle selection, not navigation. */
  .file-summary-section {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(240, 246, 252, 0.08);
  }
  .file-summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .file-summary-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary, #8b949e);
  }
  .file-summary-add-all {
    background: rgba(88, 166, 255, 0.1);
    border: 1px solid rgba(88, 166, 255, 0.3);
    color: var(--accent-primary, #58a6ff);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: 500;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .file-summary-add-all:hover {
    background: rgba(88, 166, 255, 0.2);
    border-color: rgba(88, 166, 255, 0.5);
  }
  .file-summary-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(13, 17, 23, 0.6);
    border: 1px solid rgba(240, 246, 252, 0.1);
    color: var(--text-primary, #c9d1d9);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8125rem;
    font-family: 'SFMono-Regular', Consolas, monospace;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .file-chip:hover {
    background: rgba(240, 246, 252, 0.06);
    border-color: rgba(240, 246, 252, 0.25);
  }
  /* In-context files — muted presentation. They're
   * already selected; no call-to-action needed. */
  .file-chip.in-context {
    color: var(--text-secondary, #8b949e);
    border-color: rgba(126, 231, 135, 0.25);
  }
  .file-chip.in-context:hover {
    color: var(--text-primary, #c9d1d9);
    border-color: rgba(126, 231, 135, 0.4);
  }
  .file-chip.in-context .file-chip-mark {
    color: #7ee787;
  }
  /* Not-in-context files — accent presentation. This
   * is the action chip; clicking adds the file to
   * context. */
  .file-chip.not-in-context {
    border-color: rgba(88, 166, 255, 0.3);
  }
  .file-chip.not-in-context:hover {
    background: rgba(88, 166, 255, 0.1);
    border-color: rgba(88, 166, 255, 0.5);
  }
  .file-chip.not-in-context .file-chip-mark {
    color: var(--accent-primary, #58a6ff);
    font-weight: 600;
  }
  .file-chip-mark {
    font-size: 0.875rem;
    line-height: 1;
  }
  .file-chip-path {
    /* Truncate very long paths. Full path is in the
     * tooltip. */
    max-width: 24rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Pending images strip below the textarea, shown while
   * composing. Thumbnails with a remove button overlay. */
  .pending-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }
  .pending-image-wrapper {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(240, 246, 252, 0.15);
  }
  .pending-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    cursor: pointer;
  }
  .pending-image-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    padding: 0;
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid rgba(240, 246, 252, 0.3);
    border-radius: 50%;
    color: var(--text-primary, #c9d1d9);
    font-size: 0.75rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pending-image-remove:hover {
    background: rgba(248, 81, 73, 0.9);
    border-color: rgba(248, 81, 73, 1);
  }

  /* Image thumbnails inside user message cards. Same
   * shape as pending images but with a re-attach button
   * (📎) instead of remove. */
  .message-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .message-image-wrapper {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(240, 246, 252, 0.15);
  }
  .message-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    cursor: pointer;
  }
  .message-image-reattach {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    padding: 0;
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid rgba(240, 246, 252, 0.3);
    border-radius: 3px;
    color: var(--text-primary, #c9d1d9);
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .message-image-wrapper:hover .message-image-reattach {
    opacity: 1;
  }
  .message-image-reattach:hover {
    background: rgba(88, 166, 255, 0.9);
    border-color: var(--accent-primary, #58a6ff);
    color: #fff;
  }

  /* Retry-progress banner — inserted at the bottom of
   * the messages list when the backend's retry wrapper
   * emits a streamRetry event. Shows attempt counter,
   * error-type label, a filling progress bar, and the
   * provider's original message. Updates every 100ms
   * via a panel-level ticker in streaming.js.
   *
   * Severity variants:
   *   .severity-amber — rate_limit, api_connection,
   *     timeout, service_unavailable. These are the
   *     retryable-by-design cases where waiting helps.
   *   .severity-neutral — anything else that somehow
   *     made it into the retry loop. Muted grey so it
   *     doesn't shout. */
  .retry-banner {
    margin-top: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-radius: 6px;
    border: 1px solid rgba(240, 246, 252, 0.15);
    background: rgba(22, 27, 34, 0.7);
    font-size: 0.8125rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .retry-banner.severity-amber {
    border-color: rgba(210, 153, 34, 0.5);
    background: rgba(210, 153, 34, 0.08);
  }
  .retry-banner.severity-neutral {
    border-color: rgba(240, 246, 252, 0.15);
    background: rgba(240, 246, 252, 0.04);
  }
  .retry-banner-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .retry-banner-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }
  .retry-banner-title {
    flex: 1;
    font-weight: 500;
    color: var(--text-primary, #c9d1d9);
  }
  .retry-banner.severity-amber .retry-banner-title {
    color: #d29922;
  }
  .retry-banner-remaining {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: var(--text-secondary, #8b949e);
  }
  .retry-banner-track {
    height: 4px;
    border-radius: 2px;
    background: rgba(240, 246, 252, 0.08);
    overflow: hidden;
  }
  .retry-banner-fill {
    height: 100%;
    background: var(--accent-primary, #58a6ff);
    transition: width 100ms linear;
    border-radius: 2px;
  }
  .retry-banner.severity-amber .retry-banner-fill {
    background: #d29922;
  }
  .retry-banner-detail {
    font-size: 0.75rem;
    color: var(--text-secondary, #8b949e);
    line-height: 1.4;
    word-break: break-word;
  }

  /* Lightbox overlay — full-screen with centered content.
   * z-index above the dialog so it doesn't disappear
   * behind the chat panel. */
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    outline: none;
  }
  .lightbox-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    max-width: 100%;
    max-height: 100%;
  }
  .lightbox-image {
    max-width: 100%;
    max-height: calc(100vh - 8rem);
    border-radius: 4px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  }
  .lightbox-actions {
    display: flex;
    gap: 0.75rem;
  }
  .lightbox-button {
    padding: 0.5rem 1rem;
    background: rgba(22, 27, 34, 0.9);
    border: 1px solid rgba(240, 246, 252, 0.2);
    color: var(--text-primary, #c9d1d9);
    font-family: inherit;
    font-size: 0.875rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .lightbox-button:hover {
    background: rgba(240, 246, 252, 0.08);
  }
`;