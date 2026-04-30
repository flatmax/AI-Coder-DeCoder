# MCP Integration

**Status:** future — not implemented. This document captures the design thinking from early planning conversations. Revisit when the parallel-agents layer (`parallel-agents.md`) is close to delivery, or when users start asking for integrations AC⚡DC can't provide natively.

Companion document to `parallel-agents.md`. Parallel agents are the orchestration primitive; MCP is one possible transport for the tools those agents use. The two features compose but can be delivered independently.

## Motivation

AC⚡DC already covers local workflows well: reading and editing files, navigating git, fetching URLs, searching the repo, assembling context from symbol maps and doc indexes. What it cannot do is reach **external authenticated systems** — issue trackers, messaging apps, enterprise doc stores, forges beyond URL fetching, databases.

The value MCP adds is not "more tools for the LLM." The value is **cross-organisation workflow glue**: letting the developer stay in AC⚡DC while the LLM reasons across tickets, Slack history, Confluence pages, and the code — the same information a senior engineer would gather before answering a question.

Typical queries that become answerable with MCP integration:

- "Find the GitLab issue about webhook retries in `org/backend-services`."
- "What did the team decide about rate limiting in #backend last week?"
- "Create a ticket for this race condition, assign it to me, link to !234."
- "Fetch the RFC for this subsystem from Confluence."

Without external tools, the LLM speculates. With them, it grounds its answers in the same organisational context the user has.

## What MCP is

Model Context Protocol — Anthropic's standard for exposing tools and resources to LLMs over a stdio or SSE transport. An MCP **server** is a standalone process (often distributed as `npx` package or `pip` package) that advertises tools. An MCP **client** (AC⚡DC, in this design) spawns or connects to servers, discovers their tools, and invokes them on the LLM's behalf.

Reference servers maintained by Anthropic cover common ground: filesystem, git, github, postgres, sqlite, brave-search, fetch, slack. Community servers exist for jira, linear, gitlab, confluence, notion, and more.

Critical for AC⚡DC: several of these duplicate capabilities AC⚡DC already has better native implementations for. **Do not adopt them.**

## What NOT to adopt via MCP

The following reference MCP servers would regress AC⚡DC capability and must be avoided:

- **filesystem server on the repo root.** `EditPipeline` is the canonical write path. Anchor-matching, staging, per-path write mutex (`Repo._get_write_lock`), binary detection, and path-traversal guards would all be bypassed. If agents need scratch space, point the MCP filesystem server at a throwaway directory (`/tmp/ac-dc-agent-work/{session}/`), never the repo.
- **git server on the repo.** `Repo.*` RPCs already cover status, diff, commit, branch, log, merge-base, review-mode soft-resets with concurrent-write safety. An MCP git server would not know about the working-tree mutex and could corrupt state.
- **fetch server for general web access.** `URLService` has caching, GitHub-specific fetchers (repo clone + README + symbol map, raw file content, issue classification), HTML-to-text extraction, and optional LLM summarisation. MCP fetch is a strict regression.
- **github server for read-only issue/file operations.** Partial overlap — `URLService` already classifies GitHub issue URLs, clones repos, fetches raw files. The github MCP server adds structured issue/PR content (which is valuable), but the read path should extend `URLService`, not replace it.

The principle: **AC⚡DC has four existing external-capability surfaces** — `URLService`, `Repo`, `EditPipeline`, the URL-content-in-context path. MCP is a **fifth** surface for *systems the existing four cannot reach*. It is not a replacement for any of them.

## What MCP is actually for in AC⚡DC

Four categories where AC⚡DC has no native equivalent and MCP adds genuine capability:

1. **Issue / ticket systems.** Jira, Linear, GitHub Issues (structured content + writes), GitLab Issues, Azure DevOps. The write side especially — creating, updating, commenting, transitioning.
2. **Messaging / comms search.** Slack, Discord, Teams, Mattermost. "What did the team decide about X" questions.
3. **Forge writes.** PR creation, PR comments, approvals, workflow triggers, label management. Cross-repo code search via forge APIs.
4. **Enterprise document stores.** Notion, Confluence, SharePoint, Google Drive, Obsidian vaults. Both read (fetching canonical RFCs and runbooks) and write (updating docs after code changes) are valuable.

Databases (Postgres, SQLite) are a fifth category — niche but valuable when present, for debugging "why is this query slow" with real EXPLAIN output.

## Two integration models

The same MCP server can be consumed in two architectural shapes. Both are valid; they serve different needs.

### Model A — MCP as tools attached to the LLM

The LLM receives tool definitions at `completion()` time, emits tool calls in its response, AC⚡DC dispatches via the MCP client, results flow back as tool-result messages, the LLM continues until it stops calling tools.

```
┌──────────┐   1. prompt + tools       ┌──────────────┐
│          │ ────────────────────────► │              │
│  User    │                           │   Main LLM   │
│          │ ◄──────────────────────── │              │
└──────────┘   6. final response       └──────┬───────┘
                                              │ 2. tool_calls
                                              ▼
                                       ┌──────────────┐
                                       │  LLMService  │
                                       │  dispatches  │
                                       └──────┬───────┘
                                              │ 3. invoke
                                              ▼
                                       ┌──────────────┐
                                       │  MCP Client  │
                                       └──────┬───────┘
                                              │ 4. stdio/sse
                                              ▼
                                       ┌──────────────┐
                                       │  MCP Server  │──► GitLab API
                                       │  (subprocess)│──► Slack API
                                       └──────┬───────┘    etc.
                                              │ 5. result
                                              ▼
                                       (fed back as tool-result
                                        message into loop)
```

Good for: interactive single-turn usage ("fetch the status of JIRA-1234"), mutating operations where the LLM legitimately needs to *do something*, agent loops that require mid-stream tool access.

### Model B — MCP as content sources feeding the context

User mentions an external entity the same way they mention a file today. AC⚡DC's backend resolves the mention via the appropriate adapter, fetches structured content, renders it as a context block, includes it in the request. The LLM never sees MCP — it just sees more context.

```
┌──────────┐  1. "@jira:PROJ-1234     ┌──────────────┐
│          │      what's the status?" │              │
│  User    │ ────────────────────────►│  LLMService  │
│          │                          │              │
└──────────┘                          └──────┬───────┘
                                             │ 2. resolve mention
                                             ▼
                                      ┌──────────────┐
                                      │  MCP Client  │
                                      └──────┬───────┘
                                             │ 3. stdio/sse
                                             ▼
                                      ┌──────────────┐
                                      │  MCP Server  │──► Jira API
                                      └──────┬───────┘
                                             │ 4. ticket data
                                             ▼
                                      ┌──────────────┐
                                      │ ContextManager│
                                      │ adds content  │
                                      │ block         │
                                      └──────┬───────┘
                                             │ 5. assembled prompt
                                             │    with ticket +
                                             │    code context
                                             ▼
                                      ┌──────────────┐
                                      │   Main LLM   │────► 6. response
                                      │              │
                                      └──────────────┘
```

Good for: read-only content injection, participating in token budgeting and cache tiering alongside URLs and files, the `@mention` affordance users already know.

Model B fits AC⚡DC's existing patterns more cleanly because `URLService` is essentially Model B for web pages. **Prefer Model B for reads; reach for Model A for writes and for agent-internal tool loops.**

## The planner–agent–MCP flow

The most powerful pattern composes parallel agents with MCP tools. The planner decomposes the query into scoped agent tasks, each agent carries a narrow MCP tool set, agents run in parallel, the planner synthesises.

```
User: "Find the GitLab issue about webhook retries, check Slack for related
       discussion, and tell me what the team decided."
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Main LLM (Planner)                             │
│                                                                     │
│  Decomposes into scoped subtasks, emits agent spawn blocks:         │
│                                                                     │
│    🟪 AGENT purpose=search-gitlab  tools=gitlab                     │
│    🟪 AGENT purpose=search-slack   tools=slack                      │
└────────────────────────┬───────────────────────┬────────────────────┘
                         │                       │
                         │ spawn (parallel)      │ spawn (parallel)
                         ▼                       ▼
              ┌──────────────────┐      ┌──────────────────┐
              │    Agent A       │      │    Agent B       │
              │  (fresh LLM,     │      │  (fresh LLM,     │
              │   own context)   │      │   own context)   │
              │                  │      │                  │
              │  tools: gitlab   │      │  tools: slack    │
              └────────┬─────────┘      └────────┬─────────┘
                       │                         │
                       │ tool calls              │ tool calls
                       ▼                         ▼
              ┌──────────────────┐      ┌──────────────────┐
              │  MCP: gitlab     │      │  MCP: slack      │
              │  search, fetch   │      │  search history  │
              └────────┬─────────┘      └────────┬─────────┘
                       │                         │
                       │ results                 │ results
                       ▼                         ▼
              ┌──────────────────┐      ┌──────────────────┐
              │ Agent summary:   │      │ Agent summary:   │
              │ "!234, !267 are  │      │ "Decision in     │
              │  candidates.     │      │  #backend 11-03: │
              │  !234 matches."  │      │  token bucket."  │
              └────────┬─────────┘      └────────┬─────────┘
                       │                         │
                       └──────────┬──────────────┘
                                  ▼
                    ┌─────────────────────────────┐
                    │   Main LLM (Synthesiser)    │
                    │                             │
                    │   Composes grounded answer  │
                    │   with citations to         │
                    │   both sources.             │
                    └──────────────┬──────────────┘
                                   ▼
                                  User
```

Three properties to notice:

- **Planner has no MCP tools directly (or only cheap read tools).** Its job is decomposition, not execution. Each agent is the atomic unit of "read broadly, write narrowly."
- **Agents are tool-users, not sub-spawners.** Agents emit edit blocks and tool calls, not further agent blocks. The planner owns the tree shape.
- **Agent summaries, not raw tool output, flow back to the planner.** The agent earns its token cost by converting wide reads into a narrow, structured report.

## Two flow variants

**Aggregate-then-synthesise.** Agents fetch, planner synthesises a polished answer for the user. Good for "tell me what the team decided" — user wants an answer, not raw data.

**Pass-through.** Agents fetch, planner passes findings to the user with minimal commentary. Good for exploratory queries — user wants to see candidates and choose. Lower-latency because no synthesis turn.

The planner decides per-query which mode to use, cued by the user's prompt style ("just find it" vs "tell me what they decided"). Both are cheap once the primitive exists.

## Agent block extension for MCP

Extending the agent spawn block from `parallel-agents.md` with a `tools:` field:

```
🟪🟪🟪 AGENT
purpose: Research rate-limiting patterns in the org's backend services
files:
tools: gitlab, slack
prompt: Search GitLab project org/backend-services for issues mentioning
  rate limiting. Cross-reference against Slack history in #backend. Return
  a summary of the current approach and any open discussion.
🟪🟪🟪 END
```

- `files:` empty — agent doesn't need repo context
- `tools:` names MCP server keys from config; the orchestrator looks these up and builds the per-agent tool set
- Omitting `tools:` runs the agent with only AC⚡DC-native capabilities (edit blocks), same as the base parallel-agents design

## Config shape

A new top-level key in `app.json`:

```json
{
  "mcp_servers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": {
        "GITLAB_TOKEN": "${env:GITLAB_TOKEN}",
        "GITLAB_URL": "https://gitlab.example.com"
      },
      "scope": "read-write"
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {"SLACK_TOKEN": "${env:SLACK_TOKEN}"},
      "scope": "read-only"
    },
    "filesystem-scratch": {
      "command": "npx",
      "args": [
        "-y", "@modelcontextprotocol/server-filesystem",
        "/tmp/ac-dc-agent-work"
      ],
      "scope": "read-write"
    }
  }
}
```

- `command` and `args` — how to launch the server as a subprocess
- `env` — per-server environment overrides; supports `${env:NAME}` interpolation against the parent process env (mirrors the `apply_llm_env` pattern in `ConfigManager`)
- `scope` — `"read-only"` (agents may use; no confirmation needed) or `"read-write"` (writes require user confirmation; see below)

No MCP servers configured → no tool sets advertised → planner never spawns tool-using agents. The feature is opt-in and adds zero overhead for users who don't configure it.

## Confirmation flows for writes

Read operations (search, fetch, get) run freely. Write operations (create ticket, post message, update doc) require user confirmation. The pattern mirrors how edits are proposals that users review before they land.

```
Agent emits:  Create GitLab issue in org/backend-services
                title:  "Race condition in webhook retry loop"
                body:   <drafted content>
                labels: [backend, bug]
                assignee: @alice
  │
  ▼
Frontend renders confirmation card in chat stream:
┌────────────────────────────────────────────────────┐
│  🟦 Pending action: gitlab.create_issue            │
│                                                    │
│  Project:  org/backend-services                    │
│  Title:    Race condition in webhook retry loop    │
│  Labels:   backend, bug                            │
│  Assignee: @alice                                  │
│                                                    │
│  [ Show full body ▼ ]                              │
│                                                    │
│         [ Cancel ]          [ Confirm ]            │
└────────────────────────────────────────────────────┘
  │
  ▼ (user clicks Confirm)
MCP invocation runs, result flows back to agent as tool-result
```

Config can relax per-tool: `"auto_confirm": ["slack.post_message"]` trusts a specific action without prompting. Defaults remain strict.

## Security boundaries

Four concerns, each with a concrete mitigation:

**API keys.** MCP server env vars scoped via config's `env` field, never inherited wholesale. The `apply_llm_env` pattern in `ConfigManager` is the template to extend. Keys live in user-scoped config (`~/.ac-dc/app.json`), never in the repo.

**Localhost enforcement.** The existing `_check_localhost_only` guards in `Repo` and `LLMService` extend naturally. MCP write operations gate on localhost; reads optionally open to participants per config. Default: all MCP operations localhost-only unless opt-in.

**Filesystem scope.** MCP filesystem server MUST be scoped to a throwaway directory, never the repo or `/`. The reference server enforces allowlisting at startup; config schema should refuse unscoped filesystem server configs.

**Network egress.** `fetch`, `brave-search`, and any forge/messaging MCP server enables arbitrary network requests on the host's behalf. Fine for single-user dev tool; if AC⚡DC ever grows multi-tenant, MCP invocations need per-participant rate limiting and domain allowlists.

## Direct adapters vs MCP transport

MCP's payoff scales with breadth of integration. For AC⚡DC's likely near-term needs (GitHub Issues + one doc store + one messaging app), **three purpose-built Python adapters hitting native APIs directly are simpler than an MCP client layer plus three MCP server subprocesses plus tool-definition translation.**

Recommendation: **build the adapter interface first, with direct Python adapters as the default backend. Add MCP as an alternative adapter backend later, when either:**

1. The list of integrations grows past what's pleasant to maintain directly (~5+ tools), or
2. Users ask for an integration AC⚡DC doesn't ship, and an MCP server for that tool already exists in the ecosystem.

The adapter interface — `search(query, scope) → list[Hit]`, `get(id) → Record`, `create(payload) → Record` — is the architectural commitment. Whether the adapter speaks native API or MCP underneath is an implementation detail that can flip per-adapter over time.

```
        ┌───────────────────────────────────┐
        │         LLMService                │
        │  (agents, context assembly,       │
        │   confirmation flows)             │
        └───────────────┬───────────────────┘
                        │
                        │ normalised interface:
                        │   search(), get(), create()
                        │
                        ▼
        ┌───────────────────────────────────┐
        │       ExternalToolService         │
        │  (registry, dispatch, caching)    │
        └──────┬───────────────┬────────────┘
               │               │
      ┌────────┴─────┐   ┌─────┴──────┐
      │  Adapter:    │   │  Adapter:  │
      │  GitHub      │   │  Jira      │
      │  (direct API)│   │  (MCP)     │
      └──────┬───────┘   └─────┬──────┘
             │                 │
             ▼                 ▼
      GitHub REST API    MCP server subprocess
                              │
                              ▼
                         Jira Cloud API
```

## Priority ordering if this ever lands

Ordered by user value per unit of implementation effort:

1. **GitHub Issues + PRs read.** Extends existing `URLService` GitHub classification. Fetches structured issue/PR content. No new UI patterns needed. Single PAT for auth.
2. **GitHub Issues + PRs write.** Create, comment, transition. First introduction of the confirmation flow.
3. **One enterprise doc store read.** Notion or Confluence depending on org preference. `@notion:page-slug` mention resolves to a context block.
4. **GitLab mirror of (1) and (2).** Largely a configuration change once the GitHub adapter works — same structured issue/PR shape, different API backend.
5. **Slack search read.** Lower priority because the feedback loop is weaker — devs don't often pause editing to search Slack. But the multi-agent aggregation story makes it valuable.
6. **Slack post write.** Complete the messaging loop. Confirmation flow reused from step 2.
7. **Database read-only queries.** Postgres/SQLite via MCP. Niche, high-value when present.

Each step is a self-contained adapter, delivered with tests, landing on the established interface. No step requires the MCP transport layer — direct adapters can carry all seven. MCP becomes relevant when a user asks for a tool not on this list.

## Interaction with other future specs

- **`parallel-agents.md`.** MCP integration is Layer 7 work that composes with parallel agents but can be delivered independently. Agents gain real value from MCP (aggregation across org systems); MCP gains real value from agents (per-agent tool scoping). Either feature alone is still useful.
- **`reasoning.md`.** Reasoning-capable models emit visible thinking before answering. MCP tool-use composes naturally — the reasoning trace would include "I should look up JIRA-1234" before the actual tool call. No protocol changes needed; reasoning is a per-provider feature that works inside any `completion()` loop.
- **System prompt.** Both parallel agents and MCP require additions to `system.md` (or a new `system_agents.md` for agent-mode contexts). Planner needs to know: the agent block format, the catalog of available `tools:` values, when to spawn vs answer directly, when to use Model A (tool call) vs Model B (mention).

## What is NOT planned

- Exposing AC⚡DC as an MCP server for external clients (Claude Desktop, Cursor) to drive. Different goal; orthogonal to this document.
- Replacing `URLService`, `Repo`, or `EditPipeline` with MCP equivalents. See "What NOT to adopt via MCP" above.
- Running arbitrary user-supplied MCP servers without config allowlisting. Security boundary non-negotiable.
- Allowing agents to spawn sub-agents. Tree depth is 1: planner → leaf agents. Simpler to reason about, bounds tool-call fan-out.

## Open questions to resolve when work begins

- Does the planner have any MCP tools directly, or only through agents? Hybrid ("cheap reads on planner, everything else via agents") is probably right but needs validation against real usage patterns.
- Per-turn agent cap — 3? 5? 10? Default should bound cost blast-radius; users can raise in config.
- Tool-call streaming vs batched invocation within an agent. Most MCP servers return synchronously; matters less than for LLM completions.
- Archival shape for MCP invocations in agent history — the tool-call args and results should land in the agent's JSONL archive alongside its conversation turns, for audit and replay.
- UI affordance for `@mention`-style external content. Extends the file-mention picker but needs per-source autocomplete (fetch candidate tickets as user types).

None of these block a first spike. All of them want answers before full rollout.