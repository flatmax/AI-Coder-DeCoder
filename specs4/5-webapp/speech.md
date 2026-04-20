# Speech to Text

**Status:** stub

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

- Web Speech API is available only in Chromium-based browsers
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

## Invariants

- Recognition session is always stopped cleanly on component disconnect — no zombie microphone access
- LED state always reflects the actual recognition lifecycle (inactive / listening / speaking)
- Transcripts are always inserted at the cursor position, never appended unconditionally
- Space separators are added only when the adjacent text is non-whitespace — no duplicate spaces
- Existing textarea content is never overwritten by a transcript insertion
- The toggle button is hidden in browsers that do not support the Web Speech API
- Recognition errors always revert the LED to inactive state
- Auto-restart loop only continues while the user has the toggle on — stops immediately when toggled off