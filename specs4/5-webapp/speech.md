# Speech

Two independent, browser-native speech features, both built on the Web Speech API:

- **Dictation (speech → text)** — continuous voice transcription into the chat textarea.
- **Read Aloud (text → speech)** — reading any message's text back to the user, with a floating transport for play/pause, speed, and position.

The two are unrelated at runtime (one captures audio, the other synthesises it) but share a browser-support philosophy: detect capability, hide the affordance when unsupported, never block text-only operation.

---

# Dictation (Speech to Text)

Continuous voice dictation using the browser's Web Speech API. A single toggle button starts and stops auto-transcribing mode. Transcribed text is inserted at the current cursor position in the chat textarea with automatic space separators, preserving any existing input.

## Component Role

A dedicated component rendered inside the chat input area. Hosted by the chat panel, which owns the interaction lifecycle and wires transcript events into the textarea.

## Auto-Transcribe Mode

### On

1. Start a speech recognition session
2. On utterance end — auto-restart after a short delay so dictation feels continuous
3. Each utterance dispatches a transcript custom event with the recognized text
4. Continues until the user clicks the button again

### Off

- Recognition session is stopped cleanly

### Configuration

- Continuous flag set to false (the auto-restart loop provides the continuous feel)
- Interim results disabled — only final transcripts are emitted
- Language follows the browser's configured language

Why not use the API's native continuous mode — it produces inconsistent silence handling across browsers; the explicit auto-restart loop gives more predictable behavior and lets the component detect speech boundaries reliably.

## LED States

A small indicator on the toggle button reflects recognition state:

| State | Class | Appearance |
|---|---|---|
| Inactive | (none) | Default muted |
| Listening | Listening | Pulsing accent color (waiting for speech) |
| Speaking | Speaking | Solid accent color (speech detected) |

The state transitions are driven by the recognition API's audio-start, speech-start, and speech-end events.

## Event Flow

```
Speech component → transcript event { text }
    → Chat panel receives event
    → Insert at cursor position in textarea
    → Add space separators if needed (before/after)
    → Reposition cursor after inserted text
    → Auto-resize the textarea
    → Run URL detection on the updated text
```

### Cursor Insertion Rules

- Insert at the current caret position, not appended to the end
- If the character before insertion is non-whitespace, prepend a space
- If the character after insertion is non-whitespace, append a space
- After insertion, move the caret to the end of the inserted text so subsequent dictation continues naturally

### Preserving User Input

- Existing input in the textarea is never overwritten
- The user can type or paste in between utterances without losing content
- Multiple utterances accumulate in the textarea until the user sends

## Error Handling

- Recognition error — stop the session, dispatch an error event, revert LED to inactive
- Component disconnect — stop the recognition session cleanly to release the microphone
- Persistent errors (network, permission denied) do not auto-retry; user must toggle again

## Browser Compatibility

- Web Speech recognition is available only in Chromium-based browsers
- If the recognition interface is not available on the window object, hide the toggle button
- No fallback for unsupported browsers — text entry works as normal without dictation

## Interaction with Chat Input

- Toggle button placed in the chat input area (typically near other input controls)
- Clicking the button while recognition is active immediately stops it — no delay
- Clicking while inactive starts it
- No keyboard shortcut — microphone control should be an explicit user action

## Privacy and Microphone Access

- First activation prompts the browser's microphone permission dialog (browser handles this, not the component)
- Permission state is browser-managed; component reacts to permission-denied as a recognition error
- No audio recording is done by the application — the recognition API handles audio capture locally and returns text

---

# Read Aloud (Text to Speech)

Reads a message's text back to the user via the browser's speech synthesis API. Every message card carries a speaker button; activating it starts playback and surfaces a small floating transport that offers play/pause, a speed control, and per-sentence position. Closing the transport or clicking the active speaker stops playback.

## Why Sentence-by-Sentence Playback

The browser's synthesis API speaks one block of text and offers no transport beyond pause/resume — **no seek**, and the speaking rate is **frozen** the moment an utterance begins. It also truncates very long utterances in some engines.

To deliver position control, live speed changes, and reliable long-message playback, a message is **split into sentences** and spoken one segment at a time. This makes a sentence the natural unit for all three capabilities:

- **Position** — prev / next / jump-to map onto "re-speak from sentence N". Free scrubbing within a sentence is out of scope; the sentence is the seek granularity.
- **Live speed** — changing the rate re-speaks the *current* sentence at the new rate; the remaining queue inherits it. The slider feels live despite the frozen-rate limitation.
- **Reliable length** — short per-sentence utterances stay well under engine truncation limits.

### Sentence Segmentation

- Whitespace is collapsed first so the source's hard-wrapped newlines don't create false boundaries
- Segments break on sentence terminators (`.`, `!`, `?`, `…`), keeping any trailing closing quote or bracket with its sentence
- A trailing run with no terminator is still a segment
- A segment longer than a length ceiling is sub-split — first at clause boundaries (comma, semicolon, colon, dash), then by packing whole words — so no single utterance risks truncation and no word is ever split mid-token
- Text with no terminators at all is a single segment

The concrete terminator set, length ceiling, and sub-split rules are in the reference twin.

## The Speaker Button

- One per message card, in the same hover-revealed toolbar as copy and insert (see [chat.md § Message Action Buttons](chat.md#message-action-buttons))
- Shown only when synthesis is supported; hidden entirely otherwise
- Idle shows a "read" glyph; the message whose playback is active shows a "stop" glyph
- Clicking an idle speaker starts reading that message; clicking the active speaker stops playback
- Because synthesis is a single global queue, starting a read on any message interrupts whatever was playing
- Reflects shared playback state (see § State Model) rather than tracking playback itself, so the correct button lights regardless of where playback was started or stopped

### Text Resolution (What Gets Read)

When a read starts, the text is resolved in priority order:

1. **Selection within the card** — if the user has a non-empty text selection inside this message, only the selection is read
2. **Rendered prose** — otherwise the rendered, markdown-stripped text the user actually sees (excludes raw markdown syntax, edit-block code, and agent-card chrome)
3. **Raw content** — a fallback when no rendered DOM is available

Selection-scoped reading depends on shadow-DOM selection APIs that only some browsers expose; where unavailable, it degrades gracefully to reading the whole message. The button always works; selection-only reading is an enhancement.

## The Player (Sequencing Engine)

A single shared transport owns playback. It is module-scoped, not per-component, mirroring the single global synthesis queue — only one thing reads at a time across the whole app. It holds the segment list, the current index, the play/pause status, and the speaking rate, and exposes imperative controls: play, toggle (play/pause), pause, resume, next, prev, seek(index), setRate, stop.

### Transport Semantics

- **play(text)** — splits the text, starts from the first sentence, replacing any current playback
- **next / prev** — move one sentence; while playing, re-speak immediately at the new position; `next` past the last sentence stops playback; `prev` clamps at the first
- **seek(index)** — jump to an absolute sentence, clamped into range
- **setRate** — clamp into the allowed range; while playing, re-speak the current sentence at the new rate; while paused, apply on resume
- **pause / resume** — pause suspends the current utterance in place; resume continues it from the exact word *unless* the position or rate changed while paused, in which case the current sentence is re-spoken fresh
- **stop** — cancel synthesis and return to idle

### Natural Advancement and Stale Callbacks

When a sentence finishes naturally, the player advances to the next and speaks it; finishing the last sentence stops playback. Each utterance carries a monotonic token; a late end/error callback from an utterance that was interrupted (e.g. by next/seek/rate-change) is ignored when its token no longer matches the active one, so an interrupted sentence can never advance the queue. A synthesis error on the active sentence stops playback cleanly.

## State Model

The player emits a state-change event on every transition. The published state carries: whether playback is active, the status (idle / playing / paused), the current sentence index, the total sentence count, the current rate, a human-readable label, and an opaque **owner key** identifying who initiated playback.

Two consumers listen, neither holding a direct player reference:

- **The floating transport** reflects the state into its controls and visibility.
- **The chat panel** mirrors the owner key onto its per-message speaker toggle: when playback is active and the owner key matches a message index, that card's speaker shows the stop state; otherwise every speaker shows idle. The chat panel does not set this state directly when a read starts — it derives it from the event, which is what keeps the toggle correct when playback is stopped from the floating transport or ends on its own.

The owner key is the message index, supplied by the chat panel when it starts a read.

## Floating Transport (Controls Overlay)

A small floating panel, rendered at viewport scope as a sibling overlay (alongside the other progress overlays — see [shell.md](shell.md)), not inside the chat panel — so it floats above the whole app and survives tab switches. It holds no playback state of its own; it reflects the player's state event and drives the player through its controls.

### Visibility

- Renders nothing while playback is idle
- Appears when playback becomes active, disappears when it returns to idle (queue finished, stopped, or errored)

### Contents

- A header with a drag grip, a label describing the source (role and position, e.g. "Assistant · #4"), and a close button that stops playback
- Transport row: previous-sentence, play/pause (shows pause while playing, play while paused), next-sentence, and a current/total sentence counter
- A speed slider spanning the allowed rate range with a live multiplier readout; changing it sets the player's rate
- A clickable sentence-position bar: the fill tracks progress through the sentences, and clicking anywhere seeks to the corresponding sentence

Previous is disabled at the first sentence; next is disabled at the last.

### Dragging and Position Persistence

- The panel is dragged by its header using pointer events
- On first appearance with no remembered position it defaults to the lower-right, clear of the other overlays
- Drag end clamps the panel fully within the viewport so it can never be lost off-screen
- The position is persisted (localStorage) and restored across sessions
- Drags that begin on the close button are ignored so closing never starts a drag

## Browser Compatibility

- Requires both the synthesis queue and the utterance constructor; when either is absent, the speaker button is hidden and read requests are no-ops (a one-time warning toast may inform the user)
- Synthesis language follows the browser locale so the default voice fits the user's language
- No fallback when unsupported — messages remain fully readable on screen

## Lifecycle and Cleanup

- Stopping playback (close button, active-speaker click, or queue end) returns the player to idle, which hides the transport and clears every speaker toggle
- When the chat panel disconnects (tab close, navigation, teardown) it stops the player so synthesis doesn't continue reading into a torn-down UI, mirroring the dictation side's microphone release

---

## Invariants

### Dictation

- Recognition session is always stopped cleanly on component disconnect — no zombie microphone access
- LED state always reflects the actual recognition lifecycle (inactive / listening / speaking)
- Transcripts are always inserted at the cursor position, never appended unconditionally
- Space separators are added only when the adjacent text is non-whitespace — no duplicate spaces
- Existing textarea content is never overwritten by a transcript insertion
- The toggle button is hidden in browsers that do not support speech recognition
- Recognition errors always revert the LED to inactive state
- Auto-restart loop only continues while the user has the toggle on — stops immediately when toggled off

### Read Aloud

- Only one message reads at a time — starting any read interrupts any read in progress (single global synthesis queue)
- The per-message speaker toggle is always derived from the shared player state, never set independently — so it stays correct whether playback starts from a speaker button, stops from the floating transport, or ends naturally
- The floating transport is visible if and only if playback is active; it returns to hidden whenever the player returns to idle
- The transport holds no playback state of its own — it is a pure reflection of, and remote control for, the shared player
- A sentence is never split mid-word; over-long sentences are sub-split but always at word boundaries or coarser
- A stale end/error callback from an interrupted utterance never advances or alters the queue
- The speaker button and read requests are inert in browsers without synthesis support
- The floating panel can never be dragged fully off-screen — its position is clamped into the viewport
- The player is stopped when the hosting chat panel disconnects — no synthesis reading into a torn-down UI
