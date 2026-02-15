# Speech to Text

## Overview

Continuous voice dictation using the browser's Web Speech API. A single toggle button starts and stops auto-transcribing mode.

## Component

`SpeechToText` — a Lit component rendered inside the chat input area.

## Auto-Transcribe Mode

### ON
1. Start `SpeechRecognition` session
2. On utterance end: auto-restart after 100ms delay
3. Each utterance dispatches `transcript` CustomEvent
4. Continues until user clicks button again

### OFF
Stops recognition.

### Configuration

| Property | Value |
|----------|-------|
| `continuous` | false (auto-restart loop makes it feel continuous) |
| `interimResults` | false |
| `lang` | `navigator.language` |

## LED States

| State | Class | Appearance |
|-------|-------|------------|
| Inactive | *(none)* | Default |
| Listening | `listening` | Orange pulsing |
| Speaking | `speaking` | Green |

## Event Flow

```
SpeechToText → transcript event { text }
    → Append to textarea (space-separated)
    → Auto-resize
    → Run URL detection
```

## Error Handling

Recognition error → stop, dispatch error event, revert to inactive. Component disconnect → `recognition.stop()`.

## Browser Compatibility

Web Speech API: Chromium-based browsers. Hide button if `SpeechRecognition` not available.