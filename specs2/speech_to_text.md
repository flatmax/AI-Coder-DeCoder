# Speech to Text

## Overview

Continuous voice dictation using the browser's Web Speech API. A single toggle button starts and stops auto-transcribing mode, where recognized utterances are appended to the chat input textarea.

## Component

`SpeechToText` — a Lit web component (`webapp/src/prompt/SpeechToText.js`) rendered inside the input area of the Files & Chat tab.

## Auto-Transcribe Mode

A single 🎤 microphone button toggles auto-transcribe on and off.

### ON State

1. Starts a `SpeechRecognition` session
2. When one utterance finishes (recognition ends), automatically restarts after a 100ms delay
3. Each recognized utterance dispatches a `transcript` CustomEvent with `detail.text`
4. This continues indefinitely until the user clicks the button again

### OFF State

Stops recognition. The mic goes idle.

## Recognition Configuration

| Property | Value | Rationale |
|----------|-------|-----------|
| `continuous` | `false` | Each session captures one utterance then ends |
| `interimResults` | `false` | Only final results dispatched, no partial text |
| `lang` | `navigator.language` | Matches browser locale |

The auto-restart loop in `_handleEnd()` is what makes dictation feel continuous despite `continuous = false`. Each utterance is a separate recognition session that fires a result, ends, then restarts.

## LED States

The button has three visual states via CSS classes:

| State | CSS Class | Appearance | Trigger |
|-------|-----------|------------|---------|
| Inactive | *(none)* | Default / idle | Not listening |
| Listening | `listening` | Orange pulsing | `recognition.onstart` |
| Speaking | `speaking` | Green | `recognition.onspeechstart` → reverts to `listening` on `recognition.onspeechend` |

## Event Flow

```
SpeechToText dispatches `transcript` event { text }
    │
    ▼
InputHandlerMixin.handleSpeechTranscript(e)
    │
    ├─ Append transcript to current textarea value (space-separated)
    ├─ Auto-resize textarea
    └─ Run URL detection on updated text
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Recognition error | Stop listening, dispatch `recognition-error` event, revert to inactive |
| Auto-restart failure | `recognition.start()` throws → fall back to idle state |
| Component disconnect | `recognition.stop()` called for cleanup |

## Browser Compatibility

The component uses the **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`). No Web Audio API usage — no `AudioContext`, `MediaStream`, or audio processing nodes. The browser handles all microphone access and audio processing internally.

The Web Speech API is supported in Chromium-based browsers. Firefox and Safari have limited or no support. The component should degrade gracefully — hide the button if `SpeechRecognition` is not available in `window`.

## Integration Points

| Consumer | How |
|----------|-----|
| Chat input area | Renders the `<speech-to-text>` component alongside the textarea |
| `InputHandlerMixin` | Listens for `transcript` events, appends text to input |
| URL detection | Runs on the updated input text after transcript insertion |

## Not Included

- No Web Audio API features (volume meter, visualizer)
- No audio recording or playback
- No server-side speech processing — entirely browser-native
- No language selection UI — uses browser locale automatically