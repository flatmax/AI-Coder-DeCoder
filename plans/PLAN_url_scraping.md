# Plan: URL Scraping and Content Processing

## Overview

Add the ability to fetch, process, and summarize content from URLs - particularly GitHub repositories and documentation pages. Use Haiku (smaller model) as a post-processing layer to distill raw content into useful context for the main model.

## Goals

1. **GitHub repos**: Clone, extract symbol map, summarize README
2. **Documentation pages**: Scrape and extract clean content
3. **Post-processing**: Use Haiku to generate focused summaries
4. **Caching**: Avoid re-fetching unchanged content

## Use Cases

| Scenario | What to Extract | Output Format |
|----------|-----------------|---------------|
| "How do I use this library?" | README, examples, API docs | Usage summary + key API |
| "Debug this dependency issue" | Source code, relevant modules | Symbol map + specific files |
| "Understand this dependency" | README intro, exports | Brief description + public API |
| "Evaluate this library" | README, package metadata, activity | Evaluation summary |

## Tool Selection

### For Git Repositories
**GitPython shallow clone** - Already a dependency, gives full source access for symbol map extraction

### For Web Pages  
**Trafilatura** - Lightweight Python library for content extraction, handles boilerplate removal

### For JS-Heavy Pages
**Playwright** - Already in dev deps, fallback when trafilatura fails

### For Summarization
**Haiku via litellm** - Already integrated as `smaller_model`, fast and cheap

## URL Input Methods

1. **User pastes URL in message** - System detects URLs, fetches content, includes in context sent to LLM
2. **Assistant requests URL** - Assistant can ask system to fetch a URL mentioned in conversation (e.g., "let me look at that repo")

Both flows use the same fetch pipeline - detection triggers automatically for user input, or explicitly when assistant requests it.

## Architecture

New module `ac/url_handler/` with:
- URL type detection and routing
- GitHub-specific handler (clone, symbol map, README)
- Web page handler (trafilatura, playwright fallback)
- Summarizer (Haiku post-processing)
- Cache layer (JSON files with TTL)

## Phased Implementation

### Phase 1: Foundation
- URL type detection (GitHub repo vs file vs issue, docs sites, generic)
- Data models for URLContent and URLResult
- Basic routing infrastructure

### Phase 2: GitHub Handler
- Shallow clone (`--depth 1`) to temp directory
- README extraction (md, rst, txt variants)
- Symbol map generation using existing `SymbolIndex`
- Single file fetching via raw.githubusercontent.com

### Phase 3: Web Page Handler
- Trafilatura-based extraction (primary)
- Playwright fallback for JS-heavy sites
- Metadata extraction (title, description)

### Phase 4: Summarization
Summary types with tailored Haiku prompts:
- **Brief**: 2-3 paragraph overview
- **Usage**: Installation, patterns, key imports
- **API**: Classes, functions, signatures
- **Architecture**: Modules, design patterns, data flow
- **Evaluation**: Maturity, dependencies, alternatives

### Phase 5: Caching
- URL hash as cache key
- JSON storage with TTL (default 24 hours)
- Location: `~/.aicoder/url_cache/`

### Phase 6: Integration
- New methods on LiteLLM: `fetch_url()`, `get_repo_symbol_map()`
- RPC exposure for webapp

## Testing

- URL detection for various patterns
- GitHub URL parsing (repo vs file vs issue)
- Clone small public repo, verify symbol map
- Fetch documentation page, verify clean extraction
- End-to-end with Haiku summarization

## Open Questions

1. **Cache location**: Global `~/.aicoder/` vs project-local?
2. **Default TTL**: Same for all content types?
3. **Symbol map scope**: How many files from external repos?
4. **Private repos**: GitHub token support?

## Future Enhancements

- GitHub API for lighter fetching without clone
- PyPI/npm specific metadata handlers
- Documentation site crawling
- Streaming summaries during processing
