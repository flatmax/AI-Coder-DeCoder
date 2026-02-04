# Plan: Versioned Releases

## Status: IMPLEMENTED

## Overview

Two-part release system:
1. **Webapp**: Deployed to GitHub Pages with git commit SHA-based versioning
2. **Executables**: Built as standalone binaries and published as GitHub Releases

## Part 1: Webapp Deployment (GitHub Pages)

### Version Detection

**Python side** (`ac/version.py`):
- `get_git_sha(short=True)` returns 8-char SHA from local git repo
- Primary: runs `git rev-parse HEAD`
- Fallback: reads `.git/HEAD` directly
- Returns `None` if not in a git repo

**Webapp side**:
- Version extracted from URL path at runtime: `/a1b2c3d4/` → `a1b2c3d4`
- No build-time injection needed

### GitHub Pages Structure

```
/
├── index.html          # Fetches versions.json, redirects to latest SHA
├── versions.json       # Tracks available versions for root redirect & cleanup
├── a1b2c3d4/           # Build for commit a1b2c3d4 (base=/{sha}/)
│   ├── index.html
│   └── assets/
├── b2c3d4e5/           # Build for commit b2c3d4e5
│   └── ...
└── ...
```

No `/latest/` directory - root redirect uses `versions.json` to find most recent SHA.

### versions.json Format

```json
{
  "latest": "a1b2c3d4",
  "versions": [
    {"sha": "a1b2c3d4", "full_sha": "a1b2c3d4...", "date": "2024-01-15T10:30:00Z", "branch": "master"},
    {"sha": "b2c3d4e5", "full_sha": "b2c3d4e5...", "date": "2024-01-14T15:20:00Z", "branch": "master"}
  ]
}
```

Used only for:
1. Root `index.html` redirect to latest version
2. Cleanup logic (keep last 20 versions)

### URL Construction (`ac/dc.py`)

```python
def get_browser_url(server_port, webapp_port=None, dev_mode=False):
    if dev_mode:
        return f"http://localhost:{webapp_port}/?port={server_port}"
    
    base_url = get_webapp_base_url()  # https://flatmax.github.io/AI-Coder-DeCoder
    sha = get_git_sha(short=True)
    
    if sha:
        return f"{base_url}/{sha}/?port={server_port}"
    else:
        # Fallback to root (redirects to latest via JS)
        return f"{base_url}/?port={server_port}"
```

### CLI Behavior

| Mode | Webapp Source | Version Matching |
|------|---------------|------------------|
| `--dev` | Local Vite dev server | N/A |
| `--preview` | Local preview server | N/A |
| (default) | GitHub Pages `/{sha}/` | Exact SHA match |

### Workflow (`.github/workflows/deploy-pages.yml`)

1. Checkout source repo and existing gh-pages branch
2. Build with `--base=/{sha}/`
3. Copy build to `gh-pages/{sha}/`
4. Update `versions.json` (prepend new version, set latest)
5. Cleanup old versions (keep last 20)
6. Update root `index.html` (JS redirect)
7. Commit and push to gh-pages
8. Deploy via GitHub Pages action

### Edge Cases

1. **Uncommitted changes**: SHA matches HEAD, not working tree - acceptable
2. **Detached HEAD**: Works fine, SHA still available
3. **Not a git repo**: Falls back to root URL (redirects to latest)
4. **SHA not deployed yet**: 404 - user must wait for CI or use `--dev`
5. **Feature branches**: Only master deploys; branches use `--dev` mode

## Part 2: Executable Releases (GitHub Releases)

### Build Matrix

| Platform | Runner | Output |
|----------|--------|--------|
| Linux | `ubuntu-latest` | `ac-dc-linux` |
| macOS | `macos-latest` | `ac-dc-macos` |
| Windows | `windows-latest` | `ac-dc-windows.exe` |

### PyInstaller Configuration

All builds use `--onefile` with:
- **Data files**: `ac/VERSION` (baked SHA), `config/` directory
- **Collected packages**: litellm, tiktoken, tree_sitter (all languages), trafilatura
- **Hidden imports**: boto3, botocore (for AWS Bedrock support)

### Version Baking

The git SHA is baked into the executable at build time:
```bash
echo "${{ github.sha }}" > ac/VERSION
```

This allows the executable to know its exact version even when not running from a git repo.

### Release Naming

Releases use date-based tags: `YYYY.MM.DD-{short_sha}`

Example: `2024.01.15-a1b2c3d4`

### Release Trigger

- **Automatic**: Every push to `master` branch
- **Manual**: Via `workflow_dispatch` with optional version override

### Release Artifacts

Each release includes:
- `ac-dc-linux` - Linux x64 executable
- `ac-dc-macos` - macOS executable  
- `ac-dc-windows.exe` - Windows executable
- Auto-generated release notes with download instructions

## Files Modified

- `.github/workflows/deploy-pages.yml` - SHA-based webapp deployment
- `.github/workflows/release.yml` - Executable builds and GitHub releases
- `webapp/vite.config.js` - Simplified, base path via CLI arg
- `ac/dc.py` - Versioned URL construction
- `ac/version.py` - Git SHA detection utilities
