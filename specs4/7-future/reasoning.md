# Reasoning (Extended Thinking)

Reasoning is a mode where the LLM spends extra output tokens on
hidden internal deliberation before producing the visible
response. The tokens are billed inside `completion_tokens` and
surfaced separately as `reasoning_tokens` — the backend already
observes and reports them, but has no mechanism to *enable*
reasoning in the first place.

This document captures the design space for introducing that
mechanism. Implementation is deferred until a concrete need
appears (a specific class of problem where the current
non-reasoning pipeline produces wrong or low-quality output
that reasoning would fix).

## Context

LiteLLM normalises reasoning across providers:

- Anthropic Claude models accept a `thinking` parameter:
  `{"type": "enabled", "budget_tokens": N}`
- OpenAI o1/o3 accept `reasoning_effort`: `"low"`, `"medium"`,
  or `"high"`
- LiteLLM translates between the two shapes, so a single
  config surface can drive both

The backend's per-request usage extraction already handles
`completion_tokens_details.reasoning_tokens` (see
`LLMService._run_completion_sync`). The Token HUD and Context
tab both render a Reasoning row — that UI is load-bearing and
must continue to work after reasoning is actually enabled.

## When Reasoning Is Worth the Cost

Reasoning is not free. Budget tokens and effort levels both
translate to real billed tokens that never appear in the
visible response. Turning it on for trivial edits is pure
waste.

**Good fits:**

- Hard debugging — tracing a bug through multiple layers
- Architectural decisions with multiple constraints
- Algorithmic reasoning, proofs, math
- Refactoring hot paths where correctness matters more than
  latency
- Code review of subtle logic (off-by-one, ordering, cache
  invalidation)

**Poor fits:**

- Mechanical edits (rename, add docstring, fix typo)
- Lookups — the answer is either in context or it isn't
- Format conversions
- Boilerplate generation from a clear spec

## Design Axes

Three independent choices combine into any concrete
implementation:

### Axis 1 — Control surface

| Surface | Flexibility | Cost |
|---|---|---|
| Static config (global) | Low — one setting, every request | Trivial — reuses hot-reload pathway |
| Per-model default | Medium — bigger models reason, smaller ones don't | Low — one extra field per model entry |
| Per-mode (code/doc) | Medium — code reasons, doc doesn't (or vice versa) | Low — reads from existing Mode flag |
| Per-request UI toggle | High — user decides each turn | Highest — touches RPC signature, chat panel UI, streaming handler |

### Axis 2 — Budget specification

The two provider shapes don't map cleanly:

- Anthropic takes an explicit `budget_tokens` count
- OpenAI takes a coarse effort level

Three strategies:

1. **Dual config fields** — expose both `budget_tokens` and
   `effort`; LiteLLM picks whichever the target model
   understands
2. **Effort-only with translation** — store effort levels, map
   to budget tokens internally (low=2000, medium=8000,
   high=24000 or similar)
3. **Budget-only with translation** — store token budgets, map
   to effort levels for OpenAI models (below 4000=low,
   4000-16000=medium, above=high)

Option 1 is the simplest and most honest — users who
understand the distinction can set both, LiteLLM handles
the rest.

### Axis 3 — Aux call policy

The service makes three kinds of LLM call:

- Primary streaming chat (user-facing)
- Commit message generation (auxiliary, smaller model)
- Topic detection for history compaction (auxiliary, smaller
  model)

Aux calls should **never** reason. They're narrow tasks with
well-defined output formats (JSON schema, conventional commit
format) where deliberation produces no better result — just
higher cost and latency. The implementation must explicitly
opt aux calls out, not let them inherit the primary setting.

## Recommended Shape

A two-commit rollout:

**Commit A — static config pipeline.**

Add a `reasoning` section to `app.json`:

```json
{
  "reasoning": {
    "enabled": false,
    "effort": "medium",
    "budget_tokens": 10000
  }
}
```

Plumb through `ConfigManager.reasoning_config` (mirroring
`compaction_config`). Read in `_run_completion_sync`; build
the provider-appropriate kwargs; pass to `litellm.completion`.
Explicitly pass no-reasoning kwargs in `_build_topic_detector`
and `_generate_commit_message`.

This proves the pipeline end-to-end. Users who want
reasoning globally can turn it on via Settings.

**Commit B — per-request UI toggle.**

Add a 🧠 button to the chat action bar. Reactive property
`_reasoningEnabled`; persisted to localStorage. Extend
`chat_streaming(request_id, message, files, images,
reasoning)` to accept an explicit per-request flag; when
`None`, fall back to the config default; when `True`/`False`,
override.

## Foundation Requirements

Anything the future implementation assumes about the rest of
the system:

| Requirement | Spec reference |
|---|---|
| `completion_tokens_details.reasoning_tokens` surfaces in usage extraction | `specs-reference/3-llm/streaming.md` § Token usage shape |
| The Reasoning row renders in the HUD and Context tab | `specs-reference/5-webapp/viewers-hud.md` § Reasoning row rendering |
| Aux LLM calls (commit message, topic detection) can be configured independently of the primary model | `specs4/3-llm/streaming.md` § Background Task Overview |
| `max_output_tokens` resolution chain accommodates reasoning-inflated ceilings | `specs-reference/3-llm/streaming.md` § Max-tokens resolution |

The last requirement is subtle — reasoning tokens count
against `completion_tokens`, so a model with a 64K output
ceiling and a 10K reasoning budget has only 54K left for
visible output. The existing `_resolve_max_output_tokens`
helper doesn't account for this. A correct implementation
either:

- Treats `max_tokens` as the visible-output budget and adds
  the reasoning budget on top (requires the model to support
  this split), or
- Treats `max_tokens` as the combined budget and accepts that
  visible output is reduced by the reasoning share

LiteLLM's current behaviour on this is provider-dependent and
should be verified at implementation time.

## Cost Observability

The Token HUD and Context tab already render reasoning tokens
as a subset of completion. Before enabling reasoning by
default, the implementer should run a session with reasoning
on and verify:

- Reasoning row shows non-zero on hard tasks
- Reasoning row shows zero (or near-zero) on trivial edits
- Session total reasoning tokens accumulate correctly
- Cost row (`cost_usd`) reflects the reasoning share when
  LiteLLM's pricing table accounts for it

If any of those surfaces are broken, fix them before shipping
the reasoning feature — the cost signal is how users decide
whether to keep it on.

## Invariants

- Aux LLM calls never reason, regardless of primary config
- Reasoning defaults off; users opt in
- Per-request override (when implemented) takes precedence
  over config default
- The HUD's Reasoning row always renders when
  `completion_tokens > 0`, showing zero for non-reasoning
  models so users can see the model didn't reason vs. "the
  backend forgot to report it"
- Session totals `reasoning_tokens` are a subset of
  `output_tokens`, never added on top

## Open Questions

- **Thinking model ≠ speaking model.** Some providers let the
  reasoning model differ from the response model (reason with
  o3, respond with gpt-4o). AC⚡DC's current model selection
  is single-model; supporting split reasoning/response is
  out of scope for the initial implementation but worth
  noting.
- **Streaming reasoning chunks.** Some providers stream the
  reasoning process as it happens (visible to the user as
  "thinking..."); others only stream the final response.
  The current streaming pipeline assumes a single content
  stream. Supporting visible reasoning streams would require
  a second chunk channel or a content-type discriminator.
- **Reasoning persistence.** Reasoning tokens are not
  currently persisted to the JSONL history. Re-rendering a
  past session's reasoning on session reload would require
  storing it; that's probably not worth it (reasoning is
  deliberative scratch work, not conversation).

## See Also

- [`specs-reference/3-llm/streaming.md`](../../specs-reference/3-llm/streaming.md) § Token usage shape — `reasoning_tokens` field semantics
- [`specs-reference/5-webapp/viewers-hud.md`](../../specs-reference/5-webapp/viewers-hud.md) § Reasoning row rendering — UI rules the feature must preserve
- [`../3-llm/streaming.md`](../3-llm/streaming.md) — streaming pipeline that the reasoning call threads through
- [`../5-webapp/viewers-hud.md`](../5-webapp/viewers-hud.md) — where reasoning token counts surface to the user

links: ../3-llm/streaming.md, ../5-webapp/viewers-hud.md, ../6-deployment/packaging.md