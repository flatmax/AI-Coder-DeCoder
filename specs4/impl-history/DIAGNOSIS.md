# AC-DC empty-response diagnosis

> **Status:** Diagnostic note only — not an implementation target.
> The "Suggested fixes" section below records options that were
> considered; do not treat them as a work plan.

## Problem
Running `ac-dc --dev` from `/tmp/test` (or any non-AC-DC4 directory) produces empty assistant responses in the browser chat. From the AC-DC4 repo root, the same command works.

## Root cause
The `cache_control: {"type": "ephemeral"}` marker that AC-DC attaches to the system message (and tier boundaries) in `src/ac_dc/context_manager.py:_with_cache_control` (line 943). Bedrock returns HTTP 200 with `finish_reason=stop` and **zero content chunks** for this prompt shape when called from `/tmp/test`. The cache HUD still shows 100% hit rate because the cache *transport* succeeds — only the content generation comes back empty.

Why it depends on cwd: the system block contents differ per repo (system prompt + symbol map + repo structure). In AC-DC4 the prefix is large enough that Bedrock's caching path serves a generation; in `/tmp/test` the prefix shape triggers the empty-stream failure mode.

## Tests run

1. **Browser-side check via Playwright (`drive.py`)** — drove the chat input on both servers; captured WebSocket frames.
   - Working server (cwd=AC-DC4, port 18080): server emits `streamChunk` frames `"h"`, `"hello world"`, then `streamComplete` with `prompt_tokens=275974, completion_tokens=7`.
   - Broken server (cwd=/tmp/test, port 18082): server jumps from `chat_streaming → started` straight to `streamComplete` with `response: ""`, `prompt_tokens=0, completion_tokens=0`. **Zero `streamChunk` frames.**
   - Conclusion: the UI is fine — there's literally nothing to render.

2. **Direct Bedrock call (`raw_call.py`)** — `litellm.completion(model="bedrock/global.anthropic.claude-opus-4-7", messages=[{user:"say hello world..."}])` from `/tmp/test`.
   - Result: `'hello world'`, `completion_tokens=7`. Bedrock + model + creds are healthy.

3. **History-corruption hypothesis** — moved `/tmp/test/.ac-dc4/history.jsonl` aside and re-ran with a fresh history.
   - Still broken. Not a history issue.

4. **Prompt dump (`AC_DC_DUMP_PROMPT=full`)** — captured the exact `messages` list the server sends to litellm into `/tmp/test/full_prompt.json`.

5. **Prompt replay (`replay.py`)** — fed that JSON back into `litellm.completion(...)` directly, outside ac-dc.
   - Result: `chunks=0, finish_reason=stop, content=''`. The bug is in the prompt itself.

6. **Bisect by message (`bisect_prompt.py`)** — sliced and replayed subsets:
   - `[user[5]]` only → 2 chunks, "hello world"
   - `[system, user[5]]` → 0 chunks, empty
   - Conclusion: the system message is the trigger.

7. **Bisect within the system message (`bisect_sys.py`, `bisect_sys2.py`)** — truncated the 16,792-char system text at various lengths.
   - `system[:16000]` plain string → works. Full plain string → works. Full as multimodal list **without cache_control** → works. Full as multimodal list **with cache_control** → empty.

8. **Cache-control isolation (`bisect_cache.py`)** — replayed the exact full prompt twice:
   - As-is (with `cache_control` on `messages[0].content[0]`) → `chunks=0 content=''`
   - Same prompt with all `cache_control` keys stripped → `chunks=2 content='hello world' prompt_tokens=162537`. Definitive.

9. **Git bisect (partial)** — checked out HEAD~50, HEAD~200, HEAD~350. All broken. Pre-cache_control commit (`b914f4f^`) doesn't run because it predates the streaming pipeline. The behavior has been present since `cache_control` was first added in `b914f4f`. We didn't continue to a clean fix-confirmation point — the replay tests already pinpoint the trigger.

## Suggested fixes

Ranked from most-targeted to most-defensive.

1. **Token-floor guard in `_with_cache_control`** *(recommended)*
   `src/ac_dc/context_manager.py:943`. Before stamping the marker, count tokens of the prefix being cached. If under Bedrock's documented 1024-token minimum, return the message unchanged. Cleanest fix; mirrors the provider's actual rule. Caller already has a token counter (`service._counter`), so threading it in is small.

2. **Empty-stream retry in `_streaming.py`**
   `src/ac_dc/llm/_streaming.py` around line 925 — when the for-loop exits with `full_content == ""` and `finish_reason == "stop"` and no error was raised, retry once with `cache_control` keys stripped from `messages`. Recovers the response and tells you (via a log warning) that caching short-prefixed for this prompt shape. Useful as a belt regardless of whether you also add the floor guard.

3. **Drop cache_control on the system message specifically**
   In `assemble_tiered_messages` (context_manager.py:~1098) the system message gets `_with_cache_control` only when there's no L0 history; that's the path that fires here. Skipping the marker on `role=system` and only caching at L1+ boundaries avoids the failure mode without affecting the tier breakpoints that actually drive cache reuse.

4. **Config kill-switch**
   Add `prompt_caching: { enabled: true }` to `app.json`; `_with_cache_control` becomes a no-op when disabled. Useful escape hatch but doesn't solve the real bug.

Recommendation: **(1) + (2)** — the floor guard prevents the case in normal operation, the retry catches anything that slips through future provider quirks.
