# Reference: Speech

**Supplements:** `specs4/5-webapp/speech.md`

Concrete constants for the read-aloud (text-to-speech) feature. Dictation (speech-to-text) needs no supplementary detail — its specs4 spec is self-sufficient.

## Byte-level formats

### Sentence segmentation

Read-aloud splits a message into speakable segments before queueing.

1. Normalise whitespace: replace every run of whitespace (`/\s+/`) with a single space, then trim. Empty result → no segments.
2. Primary split — match each sentence with the pattern:

   ```
   /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g
   ```

   i.e. a run of non-terminator characters followed by either one or more terminators (`.`, `!`, `?`, `…`) plus any trailing closing quote/bracket (`"`, `'`, `”`, `’`, `)`, `]`), or end-of-string. Trim each match; drop empties.
3. Any segment longer than the length ceiling is sub-split (see below).
4. If the split yields nothing, the whole normalised string is a single segment.

### Over-long sentence sub-split

A segment exceeding `MAX_SEGMENT_CHARS` is broken down:

1. **Clause pass** — split on clause delimiters keeping the delimiter, via `/[^,;:—–]+[,;:—–]?\s*/g` (comma, semicolon, colon, em-dash `—`, en-dash `–`). Greedily pack clauses into a buffer; flush the buffer to a chunk whenever adding the next clause would exceed the ceiling.
2. **Word pass** — if a single clause is itself over the ceiling, split it on whitespace and pack whole words up to the ceiling. Words are never split mid-token.
3. If sub-splitting somehow yields nothing, fall back to the original segment.

### Transport label

The floating transport's header label, supplied as the player's `label` by the chat panel:

```
{Role} · #{index + 1}
```

Role mapping from the message:

| Message | Role label |
|---|---|
| `system_event: true` | `System` |
| `role: "assistant"` | `Assistant` |
| `role: "user"` | `You` |
| anything else | `Message` |

`index` is the message's zero-based position; the label shows it 1-based (e.g. `Assistant · #4`).

## Numeric constants

| Constant | Value | Purpose |
|---|---|---|
| `MIN_RATE` | `0.5` | Lower bound of the speed slider / rate clamp |
| `MAX_RATE` | `1.5` | Upper bound of the speed slider / rate clamp |
| Rate slider step | `0.1` | Granularity of the speed control |
| Default rate | `1` | Browser-default speaking rate; also the clamp target for non-finite input |
| `MAX_SEGMENT_CHARS` | `240` | Soft ceiling above which a sentence is sub-split |
| Panel width | `248px` | Fixed width of the floating transport |
| `_EDGE_MARGIN` | `8px` | Minimum gap kept between the panel and every viewport edge when clamping |
| Overlay `z-index` | `600` | Above the cache-warmup overlay (`500`); below modals |
| Default position X | `innerWidth − 248 − 16` (min `_EDGE_MARGIN`) | First-appearance horizontal offset (lower-right) |
| Default position Y | `innerHeight − 180` (min `_EDGE_MARGIN`) | First-appearance vertical offset |
| Progress-fill ratio | `(index + 1) / total` | Width percentage of the position bar |
| Seek index from click | `floor(clamp(clickX/width, 0, 0.9999) × total)` | Sentence chosen when the position bar is clicked |

Rate clamping: non-numeric / non-finite input resolves to `1`, then clamps into `[MIN_RATE, MAX_RATE]`.

## Schemas

### Window event: player state

The synthesis player broadcasts on every transition.

- **Event name:** `speech-player-state` (exported as `SPEECH_STATE_EVENT`)
- **Detail shape:**

  ```
  {
    active:   boolean,   // status !== 'idle'
    status:   string,    // 'idle' | 'playing' | 'paused'
    index:    number,    // current sentence, zero-based
    total:    number,    // sentence count
    rate:     number,    // current speaking rate
    label:    string,    // transport header text (see Transport label)
    ownerKey: number|null // message index that started playback, or null
  }
  ```

- **Consumers:** the `ac-speech-controls` overlay (reflects into its UI/visibility) and the chat panel (mirrors `ownerKey` onto `_speakingMsgIndex`: when `active && typeof ownerKey === 'number'`, set the index to `ownerKey`, else `-1`).

### localStorage keys

| Key | Type | Purpose |
|---|---|---|
| `ac-dc-speech-controls-pos` | JSON `{x: number, y: number}` | Last dragged position of the floating transport, in pixels from the viewport top-left. Written on drag-end (after viewport clamping); read at construction. Corrupt or non-numeric entries are ignored and the default position is used |

### Synthesis helper surface

The low-level synthesis module exposes (all no-ops when synthesis is unsupported, all wrapped so native throws are swallowed):

| Function | Purpose |
|---|---|
| `isSpeechSynthesisSupported()` | True only when both `window.speechSynthesis` and `window.SpeechSynthesisUtterance` exist |
| `speakText(text, {onend, onerror, rate, pitch})` | Cancels any in-flight utterance, then speaks `text`; sets `lang` from `navigator.language` |
| `cancelSpeech()` | Cancel the queue |
| `pauseSpeech()` | Suspend the current utterance (resumable) |
| `resumeSpeech()` | Resume a suspended utterance |

The player layers segment sequencing on top of these; it never speaks more than one segment-utterance at a time.

## Dependency quirks

### No seek, frozen rate, long-utterance truncation

The Web Speech synthesis API has three load-bearing limitations that justify the sentence-sequencing design:

- **No seek** within an utterance — position control is only possible at the granularity of separate utterances, hence one-utterance-per-sentence.
- **Rate is frozen at speak time** — assigning `utterance.rate` after `speak()` has no effect. A live speed change therefore cancels and re-speaks the current sentence at the new rate.
- **Long utterances truncate** — some engines (notably Chromium) cut off utterances beyond ~15 seconds. Per-sentence segments (capped at `MAX_SEGMENT_CHARS`) stay well under this.

### Stale-callback token

`speechSynthesis.cancel()` may fire the previous utterance's `onend`/`onerror` asynchronously *after* a replacement utterance has started. The player stamps each utterance with a monotonically increasing token and records the active token; an end/error callback is honoured only when its token equals the active one. Without this, an interrupted sentence's late `onend` would advance the queue past the sentence the user actually jumped to.

### Mid-utterance resume vs. fresh re-speak

`pause()` sets a "paused mid-utterance" flag so `resume()` calls native `resume()` and continues from the exact word. Any operation that changes position (`next`/`prev`/`seek`) or rate (`setRate`) while paused clears that flag, so `resume()` re-speaks the current sentence fresh instead — the native API cannot resume a *different* utterance or a different rate.

### PointerEvent absence under jsdom

The transport's drag handlers are bound to pointer events but only read `clientX` / `clientY` / `target`. jsdom has no `PointerEvent` constructor, so tests synthesise drags with `MouseEvent('pointerdown' | 'pointermove' | 'pointerup', …)`, which carry the same fields.

## Cross-references

- Behavioral specification (read-aloud flow, sentence rationale, transport, state model, invariants): `specs4/5-webapp/speech.md`
- Speaker button placement in the message toolbar: `specs4/5-webapp/chat.md` § Message Action Buttons
- Overlay registration at viewport scope: `specs4/5-webapp/shell.md`
