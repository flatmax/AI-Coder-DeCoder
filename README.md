# AC⚡DC — AI Coder - DeCoder

AI-assisted code editing with a browser UI, stability-based prompt caching, and document-mode support.

## Status

**Early development.** This repository is being reimplemented from scratch against a new specification suite ([specs4/](specs4/)). The previous implementation's behavior is captured in [specs3/](specs3/) as a detail reference.

See [specs4/README.md](specs4/README.md) for the architecture overview and reading order, and [specs4/0-overview/implementation-guide.md](specs4/0-overview/implementation-guide.md) for how the two spec suites relate.

## What It Is

A terminal application plus browser webapp that helps developers work with a single git repository:

- **Code mode** — compact symbol map over the whole repo feeds an LLM chat; edits are applied as structured edit blocks
- **Document mode** — outline-based navigation of documentation (markdown, SVG) with the same edit mechanism
- **Stability-based caching** — content that stays unchanged across requests graduates into provider cache tiers, reducing re-ingestion costs for large contexts
- **Review mode** — read-only branch review via git soft-reset, with pre- and post-change symbol maps
- **Collaboration** — optional multi-browser sessions with admission-gated non-localhost participants

## Running (Source Install)

```bash
# Install with dev extras
uv sync

# (Webapp build lands in Layer 6; for now the CLI is a scaffold.)
ac-dc --version
ac-dc --help
```

The CLI exposes its final flag set today but only `--version` and `--help` do useful work in the current development layer. Full startup orchestration arrives with the deployment layer — see [specs4/6-deployment/startup.md](specs4/6-deployment/startup.md).

## Development Notes

Implementation progress, layer checklists, and deviations from the spec are tracked in [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) while the reimplementation is in flight. That file is removed once the project reaches feature parity.

## License

MIT — see [LICENSE](LICENSE).