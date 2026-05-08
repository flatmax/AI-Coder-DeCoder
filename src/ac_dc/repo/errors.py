"""Repository layer errors and shared constants.

Pulled out of the monolithic ``repo.py`` so every mixin can import
the same constants without circular-dependency gymnastics. Nothing
here depends on the rest of the package.
"""

from __future__ import annotations


class RepoError(Exception):
    """Base class for repository-layer errors.

    Raised only for programmer errors (bad path, not a git repo) or
    truly unrecoverable I/O failures. Expected domain failures — file
    not found, binary file passed to a text-only operation — return
    structured error dicts rather than raising, matching the RPC
    contract in ``specs4/1-foundation/rpc-inventory.md``.
    """


# Size of the prefix we scan for null bytes when detecting binary
# files. 8KB is the established heuristic (git itself uses the same
# threshold for core.autocrlf handling). Text files with null bytes
# in the first 8KB are vanishingly rare; binary files without null
# bytes in the first 8KB (some compressed formats, some crafted
# inputs) are the false-negative case — acceptable because the
# edit-apply pipeline refuses binary content regardless.
BINARY_PROBE_BYTES = 8192

# Fallback MIME types for common image extensions when the system
# mimetypes database doesn't know them. Windows installs often have
# a sparse mimetypes database. SVG is deliberately NOT here — it's
# text and goes through the SVG viewer's own path.
BINARY_IMAGE_MIME_FALLBACK = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}

# Default timeout for git subprocess calls. Long enough for big
# operations on large repos (porcelain status on a multi-GB tree
# can take a few seconds), short enough that a hung subprocess
# doesn't wedge the event loop forever.
GIT_TIMEOUT_SECONDS = 30

# Directories we never walk when building the file tree. Mirrors the
# exclusions used by the symbol index and doc index walkers — kept
# here rather than imported because Layer 2 isn't built yet and the
# dependency would be awkward to reverse later.
TREE_EXCLUDED_DIRS = frozenset({
    ".git",
    ".ac-dc4",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".egg-info",
})

# Default commit graph page size. Large enough that the initial load
# fills a typical viewport; small enough that the first RPC round-trip
# isn't slow on a 100k-commit repo.
COMMIT_GRAPH_DEFAULT_LIMIT = 100

# Default commit-log range limit. Applied when a caller doesn't
# specify. Matches the graph default — the two operations are
# conceptually siblings.
COMMIT_LOG_DEFAULT_LIMIT = 100