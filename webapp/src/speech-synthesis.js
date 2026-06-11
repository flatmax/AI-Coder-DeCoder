// SpeechSynthesis — read message text aloud.
//
// The synthesis-side counterpart to speech-to-text.js.
// Where that module wraps the browser's recognition API
// (mic → text), this one wraps the synthesis API
// (text → audio) behind a few small functions.
//
// It is a plain helper module rather than a LitElement
// because synthesis has no standing UI of its own — the
// only control is the 🔊 button in each message's
// toolbar (rendering.js), and the "which message is
// speaking" state lives on the chat panel (only one
// message speaks at a time, since `speechSynthesis` is a
// single window-level queue).
//
// Design notes:
//
//   - speakText() cancels any in-flight utterance before
//     starting a new one. The native queue would
//     otherwise stack utterances and read them
//     back-to-back, which is never what the user wants
//     from a per-message "read this" button.
//   - lang follows navigator.language so non-English
//     locales get a sensible default voice, mirroring
//     speech-to-text.js.
//   - onend / onerror callbacks let the host flip its
//     button back to the idle state when playback
//     finishes or fails.
//   - Unsupported browsers (no window.speechSynthesis or
//     no SpeechSynthesisUtterance constructor) make
//     isSpeechSynthesisSupported() return false; the
//     toolbar hides the button entirely in that case,
//     same as the mic button hides when recognition is
//     unavailable.

/**
 * Resolve the browser's speechSynthesis instance, or null
 * when unavailable (non-browser environments like jsdom,
 * or browsers without the API).
 */
function _getSynth() {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

/**
 * Whether text-to-speech is usable in this environment.
 * Requires both the synthesis queue and the utterance
 * constructor — some environments stub one without the
 * other.
 */
export function isSpeechSynthesisSupported() {
  return (
    _getSynth() !== null &&
    typeof window !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/**
 * Cancel any in-flight or queued speech. Safe to call
 * when nothing is speaking. Wrapped in try/catch because
 * cancel() can throw in some browsers if the queue is in
 * an odd state.
 */
export function cancelSpeech() {
  const synth = _getSynth();
  if (!synth) return;
  try {
    synth.cancel();
  } catch (_) {
    // Harmless — nothing was speaking, or the queue was
    // already torn down.
  }
}

/**
 * Speak the given text. Cancels any current utterance
 * first (single global queue). Returns the created
 * SpeechSynthesisUtterance, or null when unsupported or
 * when the text is empty.
 *
 * Options:
 *   - onend:   called when playback finishes naturally
 *   - onerror: called with the error event when playback
 *              fails (or when speak() throws synchronously)
 *   - rate:    speaking rate (0.1–10, default browser 1)
 *   - pitch:   voice pitch (0–2, default browser 1)
 */
export function speakText(text, { onend, onerror, rate, pitch } = {}) {
  if (!isSpeechSynthesisSupported()) return null;
  const synth = _getSynth();
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return null;
  // Single global queue — clear it so a new "read this"
  // click interrupts the previous one rather than queueing
  // behind it.
  cancelSpeech();
  const utterance = new window.SpeechSynthesisUtterance(trimmed);
  if (typeof rate === 'number') utterance.rate = rate;
  if (typeof pitch === 'number') utterance.pitch = pitch;
  // Match the recognition side: follow the browser locale
  // so the default voice fits the user's language.
  if (typeof navigator !== 'undefined' && navigator.language) {
    utterance.lang = navigator.language;
  }
  utterance.onend = () => {
    if (typeof onend === 'function') onend();
  };
  utterance.onerror = (event) => {
    if (typeof onerror === 'function') onerror(event);
  };
  try {
    synth.speak(utterance);
  } catch (err) {
    // Some browsers throw synchronously when the queue is
    // unavailable (e.g. autoplay restrictions). Surface it
    // through the same callback as async errors.
    if (typeof onerror === 'function') onerror(err);
    return null;
  }
  return utterance;
}
