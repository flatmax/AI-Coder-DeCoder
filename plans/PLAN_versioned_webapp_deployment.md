# Plan: Versioned Webapp Deployment

## Overview

Deploy the webapp to GitHub Pages with git commit SHA-based versioning, allowing the Python backend to fetch the exact webapp version that matches its codebase.

## Current State

- GitHub Pages deploys webapp to root (`/`)
- `--dev` mode runs Vite dev server locally from `webapp/` directory
- Non-dev mode serves from GitHub Pages (single version)
- No version compatibility checking between Python and webapp

## Goals

1. Deploy each commit to `/{sha}/` subdirectory on GitHub Pages
2. Maintain `/latest/` pointing to most recent build
3. Python backend fetches webapp from `/{sha}/` matching its own commit
4. Skip version checking in `--dev` mode
5. Graceful fallback when exact SHA not available

## Design

### Build-Time Version Embedding

**Vite build configuration** (`webapp/vite.config.js`):
- Inject `VITE_GIT_SHA` environment variable during build
- Webapp can display/expose this for debugging

**GitHub Actions workflow**:
- Capture `${{ github.sha }}` (short form)
- Pass to Vite build as env var
- Deploy built files to `/{sha}/` subdirectory

### GitHub Pages Structure

```
/
├── index.html          # Version picker or redirect to /latest/
├── versions.json       # List of available versions with metadata
├── latest/             # Copy of most recent build
│   └── ...
├── a1b2c3d/            # Build for commit a1b2c3d
│   ├── index.html
│   ├── assets/
│   └── ...
├── b2c3d4e/            # Build for commit b2c3d4e
│   └── ...
└── ...
```

### versions.json Format

```json
{
  "latest": "a1b2c3d",
  "versions": [
    {"sha": "a1b2c3d", "date": "2024-01-15T10:30:00Z", "branch": "master"},
    {"sha": "b2c3d4e", "date": "2024-01-14T15:20:00Z", "branch": "master"}
  ]
}
```

### Python-Side Changes

**Version detection** (`ac/version.py` - new file):
```python
def get_git_sha() -> str | None:
    """Get current git commit SHA, or None if not in a git repo."""
    # Try git command first
    # Fall back to checking .git/HEAD
    # Return None if not available
```

**Webapp URL construction** (`ac/dc.py` or new module):
```python
def get_webapp_url(dev_mode: bool, preview_mode: bool) -> str:
    if dev_mode:
        return f"http://localhost:{webapp_port}/"
    
    sha = get_git_sha()
    base = "https://{user}.github.io/{repo}"
    
    if sha:
        # Try SHA-specific version first
        return f"{base}/{sha[:7]}/"
    else:
        # Fallback to latest
        return f"{base}/latest/"
```

**Fallback logic**:
1. Try `/{sha}/` - exact match
2. If 404, try `/latest/` with warning
3. If still 404, error with helpful message

### CLI Behavior

| Mode | Webapp Source | Version Check |
|------|---------------|---------------|
| `--dev` | Local Vite dev server | Skipped |
| `--preview` | GitHub Pages `/{sha}/` | Enabled |
| (default) | GitHub Pages `/{sha}/` | Enabled |

### Workflow Changes

**Modified `.github/workflows/deploy-pages.yml`**:

1. **Build step**:
   - Set `VITE_GIT_SHA=${{ github.sha }}`
   - Run `npm run build`

2. **Deploy step**:
   - Checkout existing `gh-pages` branch
   - Copy build to `/{short-sha}/` directory
   - Update `/latest/` with copy of new build
   - Update `/versions.json` with new entry
   - Update root `/index.html`
   - Commit and push to `gh-pages`

### Root index.html

Simple page that either:
- Redirects to `/latest/` automatically, or
- Shows a version picker UI listing available versions

Recommendation: Auto-redirect with a small delay showing "Redirecting to latest version..."

## Implementation Steps

### Phase 1: Workflow Updates
1. [ ] Modify `deploy-pages.yml` to deploy to `/{sha}/`
2. [ ] Add `versions.json` generation
3. [ ] Add `/latest/` copy
4. [ ] Add root `index.html` with redirect

### Phase 2: Vite Build Changes
1. [ ] Update `vite.config.js` to accept `VITE_GIT_SHA`
2. [ ] Optionally display SHA in webapp UI (footer/about)

### Phase 3: Python Backend Changes
1. [ ] Create `ac/version.py` with `get_git_sha()`
2. [ ] Update `ac/dc.py` to construct versioned URLs
3. [ ] Add fallback logic with warnings
4. [ ] Skip version checking in `--dev` mode

### Phase 4: Testing
1. [ ] Test `--dev` mode still works (local Vite)
2. [ ] Test non-dev mode fetches correct SHA version
3. [ ] Test fallback to `/latest/` when SHA missing
4. [ ] Verify old versions remain accessible

## Edge Cases

1. **Uncommitted changes**: `get_git_sha()` returns HEAD, but local code differs
   - Accept this; version checking is best-effort

2. **Detached HEAD**: Works fine, SHA still available

3. **Not a git repo**: `get_git_sha()` returns None, use `/latest/`

4. **SHA not deployed yet**: New commits before workflow runs
   - Fallback to `/latest/` with warning

5. **Feature branches**: Only `master` deploys, branches use `/latest/`
   - Could extend to deploy branches too if needed

## Future Considerations

1. **Cleanup job**: Remove old versions after N builds or N days
2. **Branch-specific deploys**: Deploy feature branches to `/branch/{name}/`
3. **Bundled fallback**: Include pre-built webapp in Python package for offline use
4. **Version compatibility ranges**: Allow webapp to work with range of Python commits

## Files to Modify

- `.github/workflows/deploy-pages.yml` - SHA-based deployment
- `webapp/vite.config.js` - Accept git SHA env var
- `ac/dc.py` - URL construction and version checking
- `ac/version.py` (new) - Git SHA detection

## Files to Create

- `webapp/public/index.html` - Root redirect page (or generated)
- `ac/version.py` - Version utilities
