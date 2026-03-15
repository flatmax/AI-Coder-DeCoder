"""Repository operations — git wrapper and file I/O."""

import base64
import logging
import mimetypes
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Directories excluded from file tree and indexing
EXCLUDED_DIRS = {
    "node_modules", "__pycache__", "venv", ".venv",
    "dist", "build", ".git", ".ac-dc",
}


class Repo:
    """Repository layer — file I/O and git operations.

    All paths are relative to repo root. Path traversal is rejected.
    All public methods are exposed via jrpc-oo as Repo.* RPC endpoints.
    """

    def __init__(self, repo_root: str | Path):
        self._root = Path(repo_root).resolve()
        if not (self._root / ".git").exists():
            raise ValueError(f"Not a git repository: {self._root}")

    @property
    def root(self) -> Path:
        return self._root

    # ── Path Validation ───────────────────────────────────────────

    def _resolve_path(self, rel_path: str) -> Path:
        """Resolve a relative path safely under repo root.

        Rejects paths containing '..' and verifies the resolved
        absolute path is under the repo root.
        """
        if ".." in rel_path:
            raise ValueError(f"Path traversal rejected: {rel_path}")
        # Normalize separators
        rel_path = rel_path.replace("\\", "/").strip("/")
        resolved = (self._root / rel_path).resolve()
        # Verify it's under repo root
        try:
            resolved.relative_to(self._root)
        except ValueError:
            raise ValueError(f"Path escapes repository root: {rel_path}")
        return resolved

    # ── Git Helpers ────────────────────────────────────────────────

    def _git(self, *args: str, check: bool = True, **kwargs) -> subprocess.CompletedProcess:
        """Run a git command in the repo root."""
        cmd = ["git", "-C", str(self._root)] + list(args)
        return subprocess.run(
            cmd, capture_output=True, text=True, check=check, **kwargs
        )

    def _git_output(self, *args: str) -> str:
        """Run git and return stripped stdout."""
        result = self._git(*args, check=False)
        if result.returncode != 0:
            return ""
        return result.stdout.strip()

    # ── File I/O ──────────────────────────────────────────────────

    def get_file_content(self, path: str, version: Optional[str] = None) -> str | dict:
        """Read file content. Optional version (e.g., 'HEAD') for committed content."""
        try:
            if version:
                result = self._git("show", f"{version}:{path}", check=False)
                if result.returncode != 0:
                    return {"error": f"Cannot read {path} at {version}"}
                return result.stdout
            resolved = self._resolve_path(path)
            if not resolved.exists():
                return {"error": f"File not found: {path}"}
            return resolved.read_text(encoding="utf-8", errors="replace")
        except ValueError as e:
            return {"error": str(e)}

    def write_file(self, path: str, content: str) -> dict:
        """Write content to file. Creates parent directories."""
        try:
            resolved = self._resolve_path(path)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content, encoding="utf-8")
            return {"status": "written"}
        except ValueError as e:
            return {"error": str(e)}

    def create_file(self, path: str, content: str) -> dict:
        """Create new file. Errors if file already exists."""
        try:
            resolved = self._resolve_path(path)
            if resolved.exists():
                return {"error": f"File already exists: {path}"}
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content, encoding="utf-8")
            return {"status": "created"}
        except ValueError as e:
            return {"error": str(e)}

    def file_exists(self, path: str) -> bool:
        """Check if file exists."""
        try:
            resolved = self._resolve_path(path)
            return resolved.exists()
        except ValueError:
            return False

    def is_binary_file(self, path: str) -> bool:
        """Binary detection: check first 8KB for null bytes."""
        try:
            resolved = self._resolve_path(path)
            if not resolved.exists():
                return False
            with open(resolved, "rb") as f:
                chunk = f.read(8192)
            return b"\x00" in chunk
        except (ValueError, OSError):
            return False

    def get_file_base64(self, path: str) -> dict:
        """Read file as base64 data URI."""
        try:
            resolved = self._resolve_path(path)
            if not resolved.exists():
                return {"error": f"File not found: {path}"}
            data = resolved.read_bytes()
            mime, _ = mimetypes.guess_type(str(resolved))
            if not mime:
                mime = "application/octet-stream"
            b64 = base64.b64encode(data).decode("ascii")
            return {"data_uri": f"data:{mime};base64,{b64}"}
        except ValueError as e:
            return {"error": str(e)}

    def delete_file(self, path: str) -> dict:
        """Remove file from filesystem."""
        try:
            resolved = self._resolve_path(path)
            if resolved.exists():
                resolved.unlink()
            return {"status": "deleted"}
        except ValueError as e:
            return {"error": str(e)}

    # ── Git Staging ───────────────────────────────────────────────

    def stage_files(self, paths: list[str]) -> dict:
        """Stage files for commit (git add)."""
        if not paths:
            return {"status": "ok"}
        self._git("add", "--", *paths, check=False)
        return {"status": "staged"}

    def unstage_files(self, paths: list[str]) -> dict:
        """Remove files from staging area."""
        if not paths:
            return {"status": "ok"}
        self._git("reset", "HEAD", "--", *paths, check=False)
        return {"status": "unstaged"}

    def discard_changes(self, paths: list[str]) -> dict:
        """Tracked: restore from HEAD. Untracked: delete."""
        if not paths:
            return {"status": "ok"}
        for p in paths:
            # Check if tracked
            result = self._git("ls-files", "--error-unmatch", p, check=False)
            if result.returncode == 0:
                # Tracked — restore
                self._git("checkout", "HEAD", "--", p, check=False)
            else:
                # Untracked — delete
                try:
                    resolved = self._resolve_path(p)
                    if resolved.exists():
                        resolved.unlink()
                except ValueError:
                    pass
        return {"status": "discarded"}

    # ── Rename ────────────────────────────────────────────────────

    def rename_file(self, old_path: str, new_path: str) -> dict:
        """Git mv for tracked, filesystem rename for untracked."""
        try:
            old_resolved = self._resolve_path(old_path)
            new_resolved = self._resolve_path(new_path)
            if not old_resolved.exists():
                return {"error": f"Source not found: {old_path}"}
            new_resolved.parent.mkdir(parents=True, exist_ok=True)

            # Try git mv first
            result = self._git("mv", old_path, new_path, check=False)
            if result.returncode != 0:
                # Fallback to filesystem rename
                old_resolved.rename(new_resolved)
            return {"status": "renamed"}
        except ValueError as e:
            return {"error": str(e)}

    def rename_directory(self, old_path: str, new_path: str) -> dict:
        """Directory rename — same strategy as file rename."""
        return self.rename_file(old_path, new_path)

    # ── File Tree ─────────────────────────────────────────────────

    def get_file_tree(self) -> dict:
        """Full nested tree with git status, diff stats."""
        # Get tracked files
        tracked_output = self._git_output("ls-files")
        tracked = set(tracked_output.splitlines()) if tracked_output else set()

        # Get untracked (non-ignored)
        untracked_output = self._git_output(
            "ls-files", "--others", "--exclude-standard"
        )
        untracked_files = set(untracked_output.splitlines()) if untracked_output else set()

        all_files = tracked | untracked_files

        # Parse git status
        modified, staged, untracked_list, deleted = self._parse_git_status()

        # Diff stats
        diff_stats = self._get_diff_stats()

        # Build tree
        repo_name = self._root.name
        root_node = {
            "name": repo_name,
            "path": repo_name,
            "type": "dir",
            "lines": 0,
            "mtime": 0,
            "children": [],
        }

        for rel_path in sorted(all_files):
            # Skip excluded directories
            parts = rel_path.split("/")
            if any(p in EXCLUDED_DIRS or p.startswith(".") for p in parts[:-1]):
                # Allow dotfiles at root level, exclude hidden directories
                skip = False
                for part in parts[:-1]:
                    if part in EXCLUDED_DIRS:
                        skip = True
                        break
                    if part.startswith(".") and part != ".github":
                        skip = True
                        break
                if skip:
                    continue

            self._insert_into_tree(root_node, rel_path, repo_name)

        return {
            "tree": root_node,
            "modified": modified,
            "staged": staged,
            "untracked": list(untracked_list),
            "deleted": deleted,
            "diff_stats": diff_stats,
        }

    def _insert_into_tree(self, root: dict, rel_path: str, repo_name: str):
        """Insert a file path into the nested tree structure."""
        parts = rel_path.split("/")
        current = root

        for i, part in enumerate(parts):
            is_file = (i == len(parts) - 1)
            full_path = repo_name + "/" + "/".join(parts[: i + 1])

            if is_file:
                # Get file info
                resolved = self._root / rel_path
                lines = 0
                mtime = 0.0
                if resolved.exists():
                    mtime = resolved.stat().st_mtime
                    if not self.is_binary_file(rel_path):
                        try:
                            content = resolved.read_text(
                                encoding="utf-8", errors="replace"
                            )
                            lines = content.count("\n")
                        except OSError:
                            pass

                current["children"].append({
                    "name": part,
                    "path": full_path,
                    "type": "file",
                    "lines": lines,
                    "mtime": mtime,
                    "children": [],
                })
            else:
                # Find or create directory
                existing = None
                for child in current["children"]:
                    if child["type"] == "dir" and child["name"] == part:
                        existing = child
                        break
                if existing is None:
                    existing = {
                        "name": part,
                        "path": full_path,
                        "type": "dir",
                        "lines": 0,
                        "mtime": 0,
                        "children": [],
                    }
                    current["children"].append(existing)
                current = existing

    def _parse_git_status(self) -> tuple[list, list, set, list]:
        """Parse git porcelain status output.

        Returns: (modified, staged, untracked, deleted)
        """
        result = self._git("status", "--porcelain", check=False)
        if result.returncode != 0:
            return [], [], set(), []

        modified = []
        staged = []
        untracked = set()
        deleted = []

        for line in result.stdout.splitlines():
            if len(line) < 3:
                continue
            x = line[0]  # Index (staging) status
            y = line[1]  # Working tree status
            path_str = line[3:]

            # Handle quoted paths
            path_str = self._unquote_path(path_str)

            # Handle renames: "R  old -> new"
            if x == "R" or y == "R":
                if " -> " in path_str:
                    old, new = path_str.split(" -> ", 1)
                    old = self._unquote_path(old.strip())
                    new = self._unquote_path(new.strip())
                    staged.append(old)
                    staged.append(new)
                    continue

            if x == "?" and y == "?":
                untracked.add(path_str)
            elif x == "D" or y == "D":
                deleted.append(path_str)
                if x != " ":
                    staged.append(path_str)
            else:
                if x != " " and x != "?":
                    staged.append(path_str)
                if y == "M":
                    modified.append(path_str)

        return modified, staged, untracked, deleted

    def _unquote_path(self, path: str) -> str:
        """Strip surrounding quotes from git paths."""
        if path.startswith('"') and path.endswith('"'):
            path = path[1:-1]
            # Handle escaped characters
            path = path.replace('\\"', '"').replace("\\\\", "\\")
        return path

    def _get_diff_stats(self) -> dict:
        """Per-file addition/deletion counts from git diff --numstat."""
        stats = {}
        # Staged
        result = self._git("diff", "--cached", "--numstat", check=False)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split("\t")
                if len(parts) >= 3:
                    adds, dels, path = parts[0], parts[1], parts[2]
                    try:
                        stats[path] = {
                            "additions": int(adds) if adds != "-" else 0,
                            "deletions": int(dels) if dels != "-" else 0,
                        }
                    except ValueError:
                        pass

        # Unstaged
        result = self._git("diff", "--numstat", check=False)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split("\t")
                if len(parts) >= 3:
                    adds, dels, path = parts[0], parts[1], parts[2]
                    try:
                        existing = stats.get(path, {"additions": 0, "deletions": 0})
                        existing["additions"] += int(adds) if adds != "-" else 0
                        existing["deletions"] += int(dels) if dels != "-" else 0
                        stats[path] = existing
                    except ValueError:
                        pass

        return stats

    # ── Flat File List ────────────────────────────────────────────

    def get_flat_file_list(self) -> str:
        """Sorted one-per-line list of all tracked and untracked files."""
        tracked = self._git_output("ls-files")
        untracked = self._git_output(
            "ls-files", "--others", "--exclude-standard"
        )
        files = set()
        if tracked:
            files.update(tracked.splitlines())
        if untracked:
            files.update(untracked.splitlines())
        return "\n".join(sorted(files))

    # ── Diff ──────────────────────────────────────────────────────

    def get_staged_diff(self) -> str:
        """git diff --cached as text."""
        return self._git_output("diff", "--cached")

    def get_unstaged_diff(self) -> str:
        """git diff as text."""
        return self._git_output("diff")

    # ── Commit ────────────────────────────────────────────────────

    def stage_all(self) -> dict:
        """git add -A."""
        self._git("add", "-A", check=False)
        return {"status": "staged"}

    def commit(self, message: str) -> dict:
        """Create commit. Handles repos without HEAD."""
        result = self._git("commit", "-m", message, check=False)
        if result.returncode != 0:
            return {"error": result.stderr.strip() or "Commit failed"}

        # Get the commit SHA
        sha = self._git_output("rev-parse", "HEAD")
        return {"sha": sha, "message": message}

    def reset_hard(self) -> dict:
        """git reset --hard HEAD."""
        result = self._git("reset", "--hard", "HEAD", check=False)
        if result.returncode != 0:
            return {"error": result.stderr.strip() or "Reset failed"}
        return {"status": "reset"}

    # ── Search ────────────────────────────────────────────────────

    def search_files(
        self,
        query: str,
        whole_word: bool = False,
        use_regex: bool = False,
        ignore_case: bool = True,
        context_lines: int = 2,
    ) -> list[dict]:
        """Search repository via git grep."""
        if not query:
            return []

        args = ["grep", "-n", f"--context={context_lines}"]
        if ignore_case:
            args.append("-i")
        if whole_word:
            args.append("-w")
        if use_regex:
            args.append("-E")
        else:
            args.append("-F")
        args.append("--")
        args.append(query)

        result = self._git(*args, check=False)
        if result.returncode != 0:
            return []

        return self._parse_grep_output(result.stdout, context_lines)

    def _parse_grep_output(self, output: str, context_lines: int) -> list[dict]:
        """Parse git grep output into structured results."""
        results_by_file: dict[str, list] = {}
        current_file = None
        current_match = None
        collecting_after = 0

        for line in output.splitlines():
            # Separator between groups
            if line == "--":
                if current_match and current_file:
                    if current_file not in results_by_file:
                        results_by_file[current_file] = []
                    results_by_file[current_file].append(current_match)
                current_match = None
                collecting_after = 0
                continue

            # Match line: file:line_num:content or context line: file-line_num-content
            match = re.match(r'^(.+?)([:])(\d+)\2(.*)$', line)
            context_match = re.match(r'^(.+?)([-])(\d+)\2(.*)$', line)

            if match:
                file_path = match.group(1)
                line_num = int(match.group(3))
                content = match.group(4)

                if current_match and current_file:
                    if current_file not in results_by_file:
                        results_by_file[current_file] = []
                    results_by_file[current_file].append(current_match)

                current_file = file_path
                current_match = {
                    "line_num": line_num,
                    "line": content,
                    "context_before": [],
                    "context_after": [],
                }
                collecting_after = 0

            elif context_match and current_match:
                ctx_file = context_match.group(1)
                ctx_line = int(context_match.group(3))
                ctx_content = context_match.group(4)

                if ctx_file == current_file:
                    ctx_entry = {"line_num": ctx_line, "line": ctx_content}
                    if ctx_line < current_match["line_num"]:
                        current_match["context_before"].append(ctx_entry)
                    else:
                        current_match["context_after"].append(ctx_entry)

        # Flush last match
        if current_match and current_file:
            if current_file not in results_by_file:
                results_by_file[current_file] = []
            results_by_file[current_file].append(current_match)

        return [
            {"file": f, "matches": m} for f, m in results_by_file.items()
        ]

    def search_commits(
        self,
        query: str,
        branch: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Search commit history."""
        args = ["log", f"--max-count={limit}",
                "--format=%H|%s|%an|%aI",
                f"--grep={query}"]
        if branch:
            args.append(branch)
        result = self._git(*args, check=False)
        if result.returncode != 0:
            return []

        commits = []
        for line in result.stdout.splitlines():
            parts = line.split("|", 3)
            if len(parts) >= 4:
                commits.append({
                    "sha": parts[0],
                    "message": parts[1],
                    "author": parts[2],
                    "date": parts[3],
                })
        return commits

    # ── Branch ────────────────────────────────────────────────────

    def get_current_branch(self) -> dict:
        """Current HEAD info."""
        # Check if detached
        result = self._git("symbolic-ref", "--short", "HEAD", check=False)
        if result.returncode == 0:
            branch = result.stdout.strip()
            sha = self._git_output("rev-parse", "HEAD")
            return {"branch": branch, "sha": sha, "detached": False}
        else:
            sha = self._git_output("rev-parse", "HEAD")
            return {"branch": sha[:7] if sha else "", "sha": sha, "detached": True}

    def list_branches(self) -> dict:
        """All branches."""
        result = self._git(
            "branch", "--format=%(refname:short)|%(objectname:short)|%(subject)",
            check=False,
        )
        branches = []
        current = self.get_current_branch().get("branch", "")

        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split("|", 2)
                if parts:
                    name = parts[0].strip()
                    branches.append({
                        "name": name,
                        "sha": parts[1] if len(parts) > 1 else "",
                        "message": parts[2] if len(parts) > 2 else "",
                        "is_current": name == current,
                    })

        return {"branches": branches, "current": current}

    def is_clean(self) -> bool:
        """Working tree clean check (ignores untracked files)."""
        result = self._git("status", "--porcelain", "-uno", check=False)
        return result.returncode == 0 and not result.stdout.strip()

    def resolve_ref(self, ref: str) -> str | None:
        """Resolve ref to SHA."""
        result = self._git("rev-parse", ref, check=False)
        if result.returncode == 0:
            return result.stdout.strip()
        return None

    # ── Commit Graph ──────────────────────────────────────────────

    def get_commit_graph(
        self,
        limit: int = 100,
        offset: int = 0,
        include_remote: bool = False,
    ) -> dict:
        """Commit graph for review selector."""
        fmt = "%H|%h|%s|%an|%aI|%ar|%P"
        args = [
            "log", "--all", "--topo-order",
            f"--format={fmt}",
            f"--skip={offset}",
            f"--max-count={limit + 1}",
        ]
        result = self._git(*args, check=False)
        commits = []
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split("|", 6)
                if len(parts) >= 6:
                    parents = parts[6].split() if len(parts) > 6 and parts[6] else []
                    commits.append({
                        "sha": parts[0],
                        "short_sha": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "date": parts[4],
                        "relative_date": parts[5],
                        "parents": parents,
                    })

        has_more = len(commits) > limit
        if has_more:
            commits = commits[:limit]

        # Branches
        branch_args = ["branch", "--sort=-committerdate",
                       "--format=%(refname:short)|%(objectname)|%(if)%(HEAD)%(then)1%(else)0%(end)"]
        if include_remote:
            branch_args.insert(1, "-a")
        branch_result = self._git(*branch_args, check=False)
        branches = []
        if branch_result.returncode == 0:
            for line in branch_result.stdout.splitlines():
                parts = line.split("|", 2)
                if len(parts) >= 3:
                    name = parts[0].strip()
                    # Filter symbolic refs
                    if name in ("HEAD", "origin/HEAD") or " -> " in name:
                        continue
                    # Filter bare remote aliases
                    if any(
                        other.split("|")[0].strip().startswith(name + "/")
                        for other in branch_result.stdout.splitlines()
                        if other.split("|")[0].strip() != name
                    ):
                        if not parts[2].strip() == "1":  # unless it's current
                            continue
                    branches.append({
                        "name": name,
                        "sha": parts[1].strip(),
                        "is_current": parts[2].strip() == "1",
                        "is_remote": name.startswith("remotes/") or "/" in name,
                    })

        return {"commits": commits, "branches": branches, "has_more": has_more}

    def get_commit_log(
        self,
        base: str,
        head: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict]:
        """Commit log range."""
        fmt = "%H|%h|%s|%an|%aI"
        if head:
            range_spec = f"{base}..{head}"
        else:
            range_spec = base
        args = ["log", f"--format={fmt}", f"--max-count={limit}", range_spec]
        result = self._git(*args, check=False)
        commits = []
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split("|", 4)
                if len(parts) >= 5:
                    commits.append({
                        "sha": parts[0],
                        "short_sha": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "date": parts[4],
                    })
        return commits

    def get_commit_parent(self, commit_ref: str) -> dict:
        """Parent commit."""
        result = self._git("rev-parse", f"{commit_ref}^", check=False)
        if result.returncode != 0:
            return {"error": f"Cannot find parent of {commit_ref}"}
        sha = result.stdout.strip()
        short = sha[:7]
        return {"sha": sha, "short_sha": short}

    def get_merge_base(self, ref1: str, ref2: Optional[str] = None) -> dict:
        """Common ancestor. Defaults to 'main', falls back to 'master'."""
        if ref2 is None:
            ref2 = "main"
        result = self._git("merge-base", ref1, ref2, check=False)
        if result.returncode != 0 and ref2 == "main":
            result = self._git("merge-base", ref1, "master", check=False)
        if result.returncode != 0:
            return {"error": f"No merge base for {ref1} and {ref2}"}
        sha = result.stdout.strip()
        return {"sha": sha, "short_sha": sha[:7]}

    # ── Review Helpers ────────────────────────────────────────────

    def checkout_review_parent(self, branch: str, base_commit: str) -> dict:
        """Review entry: checkout parent of base commit."""
        # Record original branch
        orig = self.get_current_branch()
        original_branch = orig.get("branch", "")

        # Get branch tip SHA
        tip = self.resolve_ref(branch)
        if not tip:
            return {"error": f"Cannot resolve branch: {branch}"}

        # Get parent of base commit
        parent = self.get_commit_parent(base_commit)
        if "error" in parent:
            return parent

        # Checkout the branch first (for local branches)
        result = self._git("checkout", branch, check=False)
        if result.returncode != 0:
            # Try as detached
            result = self._git("checkout", tip, check=False)
            if result.returncode != 0:
                return {"error": f"Cannot checkout {branch}: {result.stderr.strip()}"}

        # Checkout parent (detached HEAD)
        result = self._git("checkout", parent["sha"], check=False)
        if result.returncode != 0:
            # Attempt recovery
            self._git("checkout", original_branch, check=False)
            return {"error": f"Cannot checkout parent: {result.stderr.strip()}"}

        return {
            "branch": branch,
            "branch_tip": tip,
            "base_commit": base_commit,
            "parent_commit": parent["sha"],
            "original_branch": original_branch,
            "phase": "at_parent",
        }

    def setup_review_soft_reset(self, branch_tip: str, parent_commit: str) -> dict:
        """Review setup: checkout tip by SHA, soft reset to parent."""
        # Checkout branch tip by SHA
        result = self._git("checkout", branch_tip, check=False)
        if result.returncode != 0:
            return {"error": f"Cannot checkout tip: {result.stderr.strip()}"}

        # Soft reset to parent
        result = self._git("reset", "--soft", parent_commit, check=False)
        if result.returncode != 0:
            return {"error": f"Cannot soft reset: {result.stderr.strip()}"}

        return {"status": "review_ready"}

    def exit_review_mode(self, branch_tip: str, original_branch: str) -> dict:
        """Review exit: reset to tip, checkout original branch."""
        # Reset to branch tip
        result = self._git("reset", "--soft", branch_tip, check=False)
        if result.returncode != 0:
            return {"error": f"Cannot reset to tip: {result.stderr.strip()}"}

        # Checkout original branch
        result = self._git("checkout", original_branch, check=False)
        if result.returncode != 0:
            return {
                "error": f"Cannot checkout {original_branch}: {result.stderr.strip()}. "
                         f"HEAD remains detached at {branch_tip[:7]}."
            }

        return {"status": "restored"}

    def get_review_file_diff(self, path: str) -> dict:
        """Single file review diff (git diff --cached)."""
        result = self._git("diff", "--cached", "--", path, check=False)
        return {"path": path, "diff": result.stdout if result.returncode == 0 else ""}

    def get_review_changed_files(self) -> list[dict]:
        """Changed files in review (from staged changes)."""
        result = self._git("diff", "--cached", "--numstat", check=False)
        files = []
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split("\t")
                if len(parts) >= 3:
                    adds = int(parts[0]) if parts[0] != "-" else 0
                    dels = int(parts[1]) if parts[1] != "-" else 0
                    path = parts[2]
                    # Determine status
                    status = "modified"
                    # Check if new file
                    check = self._git("ls-tree", "HEAD", path, check=False)
                    if check.returncode != 0 or not check.stdout.strip():
                        status = "added"
                    files.append({
                        "path": path,
                        "status": status,
                        "additions": adds,
                        "deletions": dels,
                    })
        return files