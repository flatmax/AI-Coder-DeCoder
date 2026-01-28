# Plan: URL Scraping and Content Processing

## Overview

Add the ability to fetch, process, and summarize content from URLs - particularly GitHub repositories and documentation pages. Use Haiku (smaller model) as a post-processing layer to distill raw content into useful context for the main model.

## Goals

1. **GitHub repos**: Clone, extract symbol map, summarize README
2. **Documentation pages**: Scrape and extract clean content
3. **Post-processing**: Use Haiku to generate focused summaries
4. **Caching**: Avoid re-fetching unchanged content

## Design Decisions

1. **Config file**: New `ac/ac-dc.json` for application config (separate from `llm.json`)
2. **Cache location**: Default `/tmp/url_cache`, configurable via `ac-dc.json`
3. **URL detection UX**: Button appears when URL detected, user confirms before fetch
4. **Symbol map scope**: Let Haiku decide what's relevant based on user's question
5. **Integration**: URL content as separate context section (like symbol map)

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

### Config File (`ac/ac-dc.json`)
```json
{
  "url_cache": {
    "path": "/tmp/url_cache",
    "ttl_hours": 24
  }
}
```

### New Module `ac/url_handler/`
- `models.py` - URLContent, URLResult dataclasses
- `detector.py` - URL type detection and parsing
- `github_handler.py` - Clone, symbol map, README extraction
- `web_handler.py` - Trafilatura + Playwright fallback
- `summarizer.py` - Haiku post-processing
- `cache.py` - JSON file cache with TTL
- `fetcher.py` - Main orchestrator

### Context Integration
URL content appears as a separate section in the prompt:
```
[System Prompt]
[Symbol Map]
[URL Context]  <-- new section
[Files in context]
[User message]
```

## Phased Implementation

### Phase 1: Foundation ✅
- Config file loading (`ac/ac-dc.json`) ✅
- URL type detection (GitHub repo vs file vs issue, docs sites, generic) ✅
- Data models for URLContent and URLResult ✅
- Basic routing infrastructure ✅

**Files created:**
- `ac/url_handler/__init__.py` - Module exports
- `ac/url_handler/models.py` - URLType, SummaryType, GitHubInfo, URLContent, URLResult
- `ac/url_handler/detector.py` - URLDetector with find_urls(), detect_type(), extract_urls_with_types()
- `ac/url_handler/config.py` - URLCacheConfig, URLConfig with JSON loading
- `ac/ac-dc.json` - Optional config file (defaults work without it)
- `tests/test_url_detector.py` - 21 tests
- `tests/test_url_models.py` - 11 tests
- `tests/test_url_config.py` - 7 tests

### Phase 2: GitHub Handler ✅
- Shallow clone (`--depth 1`) to temp directory ✅
- README extraction (md, rst, txt variants) ✅
- Symbol map generation using existing `SymbolIndex` ✅
- Single file fetching via raw.githubusercontent.com ✅

**Files created:**
- `ac/url_handler/github_handler.py` - GitHubHandler class with fetch_repo(), fetch_file()
- `tests/test_github_handler.py` - 19 tests

### Phase 3: Web Page Handler ✅
- Trafilatura-based extraction (primary) ✅
- Fallback HTML parser when trafilatura fails ✅
- Metadata extraction (title, description) ✅
- Playwright deferred to future enhancement (optional)

**Files created:**
- `ac/url_handler/web_handler.py` - WebHandler class with fetch_page(), fetch_documentation()
- `tests/test_web_handler.py` - 16 tests

**Dependencies added:**
- `trafilatura` in pyproject.toml

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
- Location: `/tmp/url_cache/` (configurable via `ac-dc.json`)

### Phase 6: Integration
- New methods on LiteLLM: `fetch_url()`, `get_repo_symbol_map()`
- RPC exposure for webapp
- URL content section in `StreamingMixin._build_streaming_messages()`

### Phase 7: Webapp UI
- URL detection in input field
- Fetch confirmation button/chip (similar to file detection)
- Loading state during fetch
- Display fetched content summary

## Testing

- URL detection for various patterns
- GitHub URL parsing (repo vs file vs issue)
- Clone small public repo, verify symbol map
- Fetch documentation page, verify clean extraction
- End-to-end with Haiku summarization

## Open Questions

1. ~~**Cache location**~~: Resolved - `/tmp/url_cache`, configurable
2. **Default TTL**: Same for all content types? (Suggest: yes, 24 hours)
3. ~~**Symbol map scope**~~: Resolved - Haiku decides based on context
4. **Private repos**: GitHub token support? (Future enhancement)

## Future Enhancements

- GitHub API for lighter fetching without clone
- PyPI/npm specific metadata handlers
- Documentation site crawling
- Streaming summaries during processing
