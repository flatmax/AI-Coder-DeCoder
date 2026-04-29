"""Sync prompt files from src/ac_dc/config/ into specs-reference/3-llm/prompts/.

Rationale: specs-reference/3-llm/prompts.md points at sibling files under
specs-reference/3-llm/prompts/ rather than embedding their content. This
script refreshes those copies after prompt text in src/ac_dc/config/ changes.

Why a script rather than cp? Two of the source files (system.md, system_doc.md)
contain the edit-protocol marker byte sequences inside fenced example blocks.
Writing them via the edit-block protocol would be self-referential — the inner
markers would terminate the outer block prematurely. The script reads bytes
straight off disk and writes them, never constructing marker lines in its own
source code.

Usage:
    python scripts/sync_prompts.py

Run this before committing a change to src/ac_dc/config/*.md or *.json if
you want specs-reference to reflect the new prompt text.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Files to mirror. All live directly under src/ac_dc/config/ in the source,
# and are copied verbatim into specs-reference/3-llm/prompts/.
PROMPT_FILES = (
    "system.md",
    "system_doc.md",
    "review.md",
    "commit.md",
    "compaction.md",
    "system_reminder.md",
    "snippets.json",
    "llm.json",
    "app.json",
)


def find_repo_root(start: Path) -> Path:
    """Walk up from `start` looking for the repo root (contains pyproject.toml)."""
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").is_file():
            return candidate
    raise SystemExit(
        f"Could not find repo root (no pyproject.toml) starting from {start}"
    )


def main() -> int:
    repo_root = find_repo_root(Path(__file__).parent)
    source_dir = repo_root / "src" / "ac_dc" / "config"
    target_dir = repo_root / "specs-reference" / "3-llm" / "prompts"

    if not source_dir.is_dir():
        print(f"error: source directory not found: {source_dir}", file=sys.stderr)
        return 1

    target_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    unchanged = 0
    missing: list[str] = []

    for name in PROMPT_FILES:
        src = source_dir / name
        dst = target_dir / name

        if not src.is_file():
            missing.append(name)
            continue

        src_bytes = src.read_bytes()

        if dst.is_file() and dst.read_bytes() == src_bytes:
            unchanged += 1
            continue

        dst.write_bytes(src_bytes)
        copied += 1
        print(f"  updated  {dst.relative_to(repo_root)}")

    print()
    print(f"Done: {copied} updated, {unchanged} unchanged", end="")
    if missing:
        print(f", {len(missing)} missing")
        for name in missing:
            print(f"  MISSING  {name}", file=sys.stderr)
        return 2
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())