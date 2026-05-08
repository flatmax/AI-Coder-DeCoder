// Tab strip module for the ChatPanel component.
//
// Owns:
//   - Tab state lookup by request ID (routes
//     stream chunks/completions to the right tab)
//   - Active-tab snapshot/restore for URL chips
//     (singleton ac-url-chips element shows the
//     active tab's chips; we snapshot on switch)
//   - Tab activation, close, overflow menu
//   - Tab strip rendering
//   - Agent-tab spawning when the orchestrator's
//     response carries agent blocks
//   - Alt+` chat-tab keyboard shortcut
//
// Functions take the chat-panel instance as their
// first parameter rather than living on the
// prototype. The component class binds them as
// methods (or as event handlers) in its
// constructor — `installTabHandlers(panel)` is
// the entry point that does the binding.
//
// Why instance-as-parameter rather than mixin or
// subclass: the chat-panel module has too many
// concerns to share one prototype, and Lit's
// reactive-property machinery doesn't compose
// cleanly with multi-class inheritance. Functional
// modules with explicit `panel` parameters keep
// the dependencies visible and the call graph
// flat.

import { html } from 'lit';
import { deriveAgentTabLabel, parseAgentTabId } from './helpers.js';
import { makeTabState } from './state.js';

// ---------------------------------------------------------------
// Request-ID → tab routing
// ---------------------------------------------------------------

/**
 * Find which tab owns ``requestId``, or null.
 *
 * Matching rules:
 *
 *   1. Exact match against any tab's
 *      ``currentRequestId`` — the tab that initiated
 *      the request is the primary owner.
 *   2. Prefix match against ``{parentId}-`` —
 *      parallel-agent mode spawns N child streams
 *      under a parent turn; each child's request ID
 *      is ``{parent}-agent-NN``. The chat panel's
 *      tab strip carries one tab per agent, each
 *      with its own request ID, so this prefix
 *      match is rarely hit in practice — but
 *      keeping it wired in means future spawn paths
 *      don't have to re-touch streaming routing.
 *
 * Returns the tab ID or null when no tab claims
 * the request. Collaboration broadcasts (a remote
 * user's stream reaching our panel) also return
 * null.
 */
export function findTabForRequest(panel, requestId) {
  if (!requestId) return null;
  // Fast path — exact match against the active tab.
  const active = panel._tabs.get(panel._activeTabId);
  if (active && active.currentRequestId === requestId) {
    return panel._activeTabId;
  }
  // General scan. Two passes so exact matches on any
  // tab win over prefix matches — a request ID that
  // exactly equals one tab's ID shouldn't be treated
  // as a child of another tab whose ID happens to be
  // a prefix.
  for (const [tabId, tab] of panel._tabs) {
    if (tab.currentRequestId === requestId) {
      return tabId;
    }
  }
  for (const [tabId, tab] of panel._tabs) {
    const parentId = tab.currentRequestId;
    if (parentId && requestId.startsWith(`${parentId}-`)) {
      return tabId;
    }
  }
  return null;
}

// ---------------------------------------------------------------
// Active-tab transition + URL-chip snapshot/restore
// ---------------------------------------------------------------

/**
 * Snapshot the leaving tab's URL chip state from the
 * singleton ``ac-url-chips`` element.
 *
 * Runs synchronously before ``_activeTabIdValue`` flips
 * so the Map read still reflects the departing tab.
 *
 * Defensive against early calls — before any render the
 * element doesn't exist in shadowRoot, in which case
 * there's nothing to snapshot.
 *
 * Stores a shallow copy so subsequent mutations to the
 * element's live Map don't retroactively alter the
 * snapshot. The chip-state values are themselves
 * objects; we don't deep-clone them because chip-state
 * mutation goes through ``_chips = new Map(...)``
 * reassignment in the component, not in-place edits.
 */
export function snapshotUrlChipsForTab(panel, tabId) {
  if (typeof tabId !== 'string' || !tabId) return;
  const tab = panel._tabs.get(tabId);
  if (!tab) return;
  const chipsEl = panel.shadowRoot?.querySelector('ac-url-chips');
  if (!chipsEl || !chipsEl._chips) return;
  tab.urlChips = new Map(chipsEl._chips);
}

/**
 * Install the entering tab's URL chip snapshot into the
 * ``ac-url-chips`` element.
 *
 * Defers through ``updateComplete`` so the setter's
 * ``requestUpdate`` cycle finishes first — reading
 * shadowRoot synchronously after a property flip can
 * return a stale reference in some edge cases.
 *
 * An entering tab with no snapshot (freshly spawned
 * agent, or main tab in a new session) gets a fresh
 * empty Map. The chip component's render path handles
 * empty Maps by hiding the strip entirely.
 */
export function restoreUrlChipsForTab(panel, tabId) {
  panel.updateComplete.then(() => {
    const chipsEl = panel.shadowRoot?.querySelector('ac-url-chips');
    if (!chipsEl) return;
    const tab = panel._tabs.get(tabId);
    if (!tab) return;
    chipsEl._chips = tab.urlChips
      ? new Map(tab.urlChips)
      : new Map();
  });
}

// ---------------------------------------------------------------
// Tab activation, close, overflow menu
// ---------------------------------------------------------------

/**
 * Handle a tab button click. Flips ``_activeTabId``,
 * which fires the ``active-tab-changed`` event so
 * the files-tab picker swaps its selection state to
 * match the newly-active tab.
 *
 * Same-tab clicks are no-ops because the setter
 * short-circuits on equal values.
 */
export function onTabClick(panel, tabId) {
  if (typeof tabId !== 'string' || !tabId) return;
  panel._activeTabId = tabId;
}

/**
 * Toggle the overflow menu open/closed. Attaches
 * capture-phase document listeners for outside-click
 * and Escape dismissal when opening; detaches them
 * when closing.
 */
export function toggleOverflowMenu(panel) {
  if (panel._tabStripOverflowOpen) {
    closeOverflowMenu(panel);
  } else {
    openOverflowMenu(panel);
  }
}

export function openOverflowMenu(panel) {
  if (panel._tabStripOverflowOpen) return;
  panel._tabStripOverflowOpen = true;
  // Capture phase so we see the event before any
  // child handler stops propagation.
  document.addEventListener(
    'click',
    panel._onOverflowOutsideClick,
    true,
  );
  document.addEventListener(
    'keydown',
    panel._onOverflowKeyDown,
    true,
  );
}

export function closeOverflowMenu(panel) {
  if (!panel._tabStripOverflowOpen) return;
  panel._tabStripOverflowOpen = false;
  document.removeEventListener(
    'click',
    panel._onOverflowOutsideClick,
    true,
  );
  document.removeEventListener(
    'keydown',
    panel._onOverflowKeyDown,
    true,
  );
}

/**
 * Document-level click listener (capture phase)
 * installed while the overflow menu is open. Walks
 * ``composedPath()`` to see if the click originated
 * inside the menu or its toggle button — if yes,
 * let it through. Otherwise close the menu.
 */
export function onOverflowOutsideClick(panel, event) {
  const path = event.composedPath ? event.composedPath() : [];
  const hit = path.some(
    (el) =>
      el instanceof Element &&
      (el.classList?.contains('tab-strip-overflow') ||
        el.classList?.contains('tab-strip-overflow-menu')),
  );
  if (!hit) closeOverflowMenu(panel);
}

/**
 * Document-level keydown listener (capture phase).
 * Escape closes the menu and stops propagation so
 * the textarea's own Escape handler doesn't also
 * fire.
 */
export function onOverflowKeyDown(panel, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeOverflowMenu(panel);
  }
}

/**
 * Handle an overflow menu item click — jumps to the
 * target tab and closes the menu.
 */
export function onOverflowItemClick(panel, tabId) {
  closeOverflowMenu(panel);
  onTabClick(panel, tabId);
}

/**
 * Document-level keyboard handler for chat-tab
 * cycling. Alt+` moves to the next tab; Alt+Shift+`
 * moves to the previous. Wraps at both ends.
 *
 * Gated on:
 *   - ``event.altKey`` without Ctrl/Meta
 *   - ``event.key === '\`'``
 *   - ``_tabs.size > 1`` — single-tab mode has nothing
 *     to cycle through.
 *
 * Does NOT fire on Alt+1..9 — those belong to
 * app-shell's dialog-tab shortcuts.
 */
export function onChatTabShortcut(panel, event) {
  if (!event.altKey) return;
  if (event.ctrlKey || event.metaKey) return;
  if (event.key !== '`') return;
  if (panel._tabs.size <= 1) return;
  event.preventDefault();
  const tabIds = Array.from(panel._tabs.keys());
  const currentIdx = tabIds.indexOf(panel._activeTabId);
  if (currentIdx < 0) return;
  const delta = event.shiftKey ? -1 : 1;
  // Modular arithmetic with positive modulo — JS's
  // ``%`` returns negative values for negative
  // dividends, so add the length before taking the
  // modulo to force a positive result.
  const nextIdx =
    (currentIdx + delta + tabIds.length) % tabIds.length;
  panel._activeTabId = tabIds[nextIdx];
}

/**
 * Close a tab. Removes the tab from ``_tabs`` and
 * ``_tabLabels``; if the closed tab was active,
 * switches to Main. Main tab can never be closed
 * (the button isn't rendered for it) but a defensive
 * guard here makes the intent explicit.
 *
 * Dispatches ``close-tab`` so future backend
 * integrations can hook in. Fires
 * ``LLMService.close_agent_context`` to free the
 * scope server-side; the archive file on disk is
 * preserved.
 *
 * Fire-and-forget — local state is already mutated
 * (optimistic close), and the RPC is idempotent. A
 * failure means the backend scope lingers until
 * session end; the user-visible tab is gone
 * regardless.
 *
 * Restricted-caller errors for non-localhost
 * participants DO surface as a toast because they're
 * actionable: the user can ask the host to close the
 * tab for them.
 */
export function onTabClose(panel, tabId) {
  if (typeof tabId !== 'string' || !tabId) return;
  if (tabId === 'main') return;
  if (!panel._tabs.has(tabId)) return;
  const wasActive = panel._activeTabId === tabId;
  panel._tabs.delete(tabId);
  panel._tabLabels.delete(tabId);
  panel._tabModes.delete(tabId);
  // Switch to Main first (if the closed tab was
  // active) so the active-tab-changed event fires
  // with a valid target. Otherwise the render below
  // would still see _activeTabId pointing at the
  // deleted tab, and every per-tab getter would
  // lazy-create a fresh empty state at the stale
  // key.
  if (wasActive) {
    panel._activeTabId = 'main';
  }
  // Force a re-render so the strip reflects the
  // deletion — _tabs mutations don't trigger Lit's
  // dirty-check on their own.
  panel.requestUpdate();

  panel.dispatchEvent(
    new CustomEvent('close-tab', {
      detail: { tabId },
      bubbles: true,
      composed: true,
    }),
  );

  const agentTag = parseAgentTabId(tabId);
  if (agentTag && panel.rpcConnected) {
    panel
      .rpcExtract('LLMService.close_agent_context', agentTag)
      .then((result) => {
        if (
          result
          && typeof result === 'object'
          && result.error === 'restricted'
        ) {
          panel._emitToast(
            result.reason || 'Restricted operation',
            'warning',
          );
        }
      })
      .catch((err) => {
        // Tab is already gone locally; toasting would
        // misrepresent the state. Operators debugging
        // "why did the scope leak" can find the log
        // entry.
        console.debug('[chat] close_agent_context failed', err);
      });
  }
}

// ---------------------------------------------------------------
// Tab strip rendering
// ---------------------------------------------------------------

/**
 * Render the tab strip. Returns an empty template
 * when only the main tab exists — the strip consumes
 * vertical space, and users running single-agent
 * operation (the common case) shouldn't pay that
 * cost. The strip appears the moment a second tab
 * materialises.
 */
export function renderTabStrip(panel) {
  if (panel._tabs.size <= 1) {
    return '';
  }
  // Iteration order of a Map is insertion order, so
  // 'main' comes first and agent tabs follow in
  // spawn order.
  const tabs = Array.from(panel._tabs.keys());
  return html`
    <div class="tab-strip">
      <div class="tab-strip-scroll" role="tablist">
        ${tabs.map((tabId) => {
          const label = panel._tabLabels.get(tabId) || tabId;
          const active = tabId === panel._activeTabId;
          const closable = tabId !== 'main';
          // Streaming indicator — read the tab's own
          // streaming flag directly from the Map
          // rather than through the active-tab
          // getters. Shown regardless of active state
          // so users see work happening on tabs they
          // aren't currently looking at.
          const tab = panel._tabs.get(tabId);
          const streaming = !!(tab && tab.streaming);
          // Tooltip carries the agent's mode so users
          // can disambiguate at a glance — two agents
          // tasked with similar prose differ only in
          // mode + cross-ref state. Main tab uses its
          // bare label (mode is reflected in the
          // action-bar toggle).
          const mode = panel._tabModes?.get(tabId);
          const tooltip = mode ? `${label} (${mode})` : label;
          return html`
            <button
              class="tab-strip-tab ${active ? 'active' : ''}"
              role="tab"
              aria-selected=${active}
              aria-busy=${streaming}
              data-tab-id=${tabId}
              @click=${() => onTabClick(panel, tabId)}
              title=${tooltip}
            >${streaming
              ? html`<span
                  class="tab-streaming-indicator"
                  aria-hidden="true"
                ></span>`
              : ''}${label}${closable
              ? html`<span
                  class="tab-close"
                  role="button"
                  tabindex="0"
                  aria-label="Close ${label}"
                  title="Close tab"
                  @click=${(e) => {
                    e.stopPropagation();
                    onTabClose(panel, tabId);
                  }}
                  @keydown=${(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onTabClose(panel, tabId);
                    }
                  }}
                >✕</span>`
              : ''}</button>
          `;
        })}
      </div>
      <button
        class="tab-strip-overflow"
        aria-label="Tab list"
        aria-haspopup="menu"
        aria-expanded=${panel._tabStripOverflowOpen}
        title="Jump to tab"
        @click=${() => toggleOverflowMenu(panel)}
      >⋯</button>
      ${panel._tabStripOverflowOpen
        ? renderOverflowMenu(panel, tabs)
        : ''}
    </div>
  `;
}

/**
 * Render the overflow dropdown menu contents. One
 * item per tab, labelled the same way as the strip
 * button. Clicking jumps directly.
 */
export function renderOverflowMenu(panel, tabs) {
  return html`
    <div class="tab-strip-overflow-menu" role="menu">
      ${tabs.map((tabId) => {
        const label = panel._tabLabels.get(tabId) || tabId;
        const active = tabId === panel._activeTabId;
        const tab = panel._tabs.get(tabId);
        const streaming = !!(tab && tab.streaming);
        const mode = panel._tabModes?.get(tabId);
        const tooltip = mode ? `${label} (${mode})` : label;
        return html`
          <button
            class="tab-strip-overflow-item ${active ? 'active' : ''}"
            role="menuitem"
            data-tab-id=${tabId}
            title=${tooltip}
            aria-busy=${streaming}
            @click=${() => onOverflowItemClick(panel, tabId)}
          >${streaming
            ? html`<span
                class="tab-streaming-indicator"
                aria-hidden="true"
              ></span>`
            : ''}${label}</button>
        `;
      })}
    </div>
  `;
}

// ---------------------------------------------------------------
// Agent tab spawning
// ---------------------------------------------------------------

/**
 * Create agent tab state for each valid block.
 *
 * Called when the main-tab result carries
 * ``turn_id`` + one or more agent blocks. Creates a
 * ``_tabs`` entry and a ``_tabLabels`` entry per
 * block. Does NOT switch to any of the new tabs —
 * the user's focus stays on the main tab.
 *
 * Tab ID = the agent's LLM-chosen id. Identity is
 * flat at the backend (registry keyed by id alone),
 * and the tab id mirrors that so ``parseAgentTabId``
 * can return the id directly with no parsing. The
 * padded numeric index is still used for the child
 * stream's request id and for the on-disk archive
 * file name (``{turn_id}/agent-NN.jsonl``), but
 * those are routing details and not the agent's
 * identity.
 *
 * Tab state seeding: the agent's initial user
 * message is the task text. Users switching to an
 * agent tab should see what the main LLM asked it
 * to do without having to scroll through the
 * archive — the task IS the prompt. The selection
 * list starts as a copy of the main tab's selection
 * so the agent inherits context per the
 * parallel-agents spec.
 *
 * Idempotent: if a tab for the same agent id
 * already exists, the existing tab is preserved.
 *
 * @param {object} panel — chat-panel instance
 * @param {string} turnId — the backend's turn_id
 * @param {Array<object>} agentBlocks — validated
 *   block entries with {id, task, agent_idx}
 * @param {string} [parentRequestId] — the main
 *   LLM's request ID. The backend streams each
 *   agent on child request IDs of the form
 *   ``{parent}-agent-{NN:02d}``; we seed each new
 *   tab's ``currentRequestId`` + flip its
 *   ``streaming`` flag so ``findTabForRequest``
 *   routes the child's chunks to the correct tab.
 */
export function spawnAgentTabs(panel, turnId, agentBlocks, parentRequestId) {
  if (typeof turnId !== 'string' || !turnId) return;
  if (!Array.isArray(agentBlocks)) return;
  let anySpawned = false;
  // Snapshot of the main tab's selection. Each new
  // agent tab gets its own copy so mutations on one
  // don't leak into another. Reading from _tabs
  // directly (not via the ``selectedFiles`` getter)
  // because the getter would return the ACTIVE
  // tab's list — which is main here, but being
  // explicit keeps the spawn path robust against
  // future changes to the getter.
  const mainTab = panel._tabs.get('main');
  const mainSelection = Array.isArray(mainTab?.selectedFiles)
    ? [...mainTab.selectedFiles]
    : [];
  for (const block of agentBlocks) {
    if (!block || typeof block !== 'object') continue;
    const agentIdx = block.agent_idx;
    if (typeof agentIdx !== 'number' || agentIdx < 0) continue;
    const agentId = typeof block.id === 'string' ? block.id : '';
    if (!agentId) continue;
    const task = typeof block.task === 'string' ? block.task : '';
    const paddedIdx = String(Math.floor(agentIdx)).padStart(2, '0');
    const tabId = agentId;
    if (panel._tabs.has(tabId)) continue;
    // Fresh tab state with the task seeded as the
    // initial user message.
    const state = makeTabState();
    state.messages = [{ role: 'user', content: task }];
    state.selectedFiles = [...mainSelection];
    // Route child stream chunks to this tab. The
    // backend's child request ID format is
    // ``{parent}-agent-{NN:02d}``.
    if (typeof parentRequestId === 'string' && parentRequestId) {
      const childId = `${parentRequestId}-agent-${paddedIdx}`;
      state.currentRequestId = childId;
      state.streaming = true;
    }
    panel._tabs.set(tabId, state);
    panel._tabLabels.set(
      tabId, deriveAgentTabLabel(agentIdx, task),
    );
    // Mode comes from the backend's resolved value in
    // the agentsSpawned payload — empty block.mode on
    // the orchestrator side has already been resolved
    // to the inherited orchestrator mode. Defensive
    // string check tolerates older backends that don't
    // populate the field.
    const blockMode =
      typeof block.mode === 'string' ? block.mode : '';
    if (blockMode) {
      panel._tabModes.set(tabId, blockMode);
    }
    anySpawned = true;
  }
  if (anySpawned) {
    // Force a re-render so the tab strip appears.
    // ``_tabs`` is a Map mutation (not a reactive
    // property assignment) so Lit doesn't observe
    // the change automatically.
    panel.requestUpdate();
  }
}

// ---------------------------------------------------------------
// Handler binding
// ---------------------------------------------------------------

/**
 * Bind tab-related handlers onto the chat-panel
 * instance. Called once at construction time.
 *
 * The component class accesses these via
 * ``panel._onOverflowOutsideClick``, etc. — they
 * need to be stable function references for
 * add/removeEventListener pairs to match.
 *
 * Bound at the panel level (not module-scoped)
 * because the listeners need ``panel`` in their
 * closure.
 */
export function installTabHandlers(panel) {
  panel._onOverflowOutsideClick = (event) =>
    onOverflowOutsideClick(panel, event);
  panel._onOverflowKeyDown = (event) =>
    onOverflowKeyDown(panel, event);
  panel._onChatTabShortcut = (event) =>
    onChatTabShortcut(panel, event);
}