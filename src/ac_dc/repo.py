"""Repository operations: git, file I/O, tree, search."""

import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)


def _run_git(args: list[str], cwd: Path, **kwargs) -> subprocess.CompletedProcess:
    """Run a git command, returning CompletedProcess."""
    return subprocess.run(
        ["git"] + args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=30,
        **kwargs,
    )


class Repo:
    """Git repository operations exposed via RPC.

    All public methods become remotely callable as Repo.<method_name>.
    """

    def __init__(self, repo_root: Path):
        self.root = repo_root.resolve()
        if not (self.root / ".git").exists():
            raise ValueError(f"Not a git repository: {self.root}")

    # ------------------------------------------------------------------
    # Path safety
    # ------------------------------------------------------------------

    def _safe_path(self, rel_path: str) -> Path:
        """Resolve relative path and verify it's inside the repo."""
        resolved = (self.root / rel_path).resolve()
        if not str(resolved).startswith(str(self.root)):
            raise ValueError(f"Path escapes repository: {rel_path}")
        return resolved

    def _rel(self, abs_path: Path) -> str:
        """Return repo-relative path string."""
        return str(abs_path.relative_to(self.root))

    # ------------------------------------------------------------------
    # File operations
    # ------------------------------------------------------------------

    def get_file_content(self, path: str, version: Optional[str] = None) -> dict:
        """Read file content. Optional version (e.g. 'HEAD') for committed content."""
        try:
            if version:
                r = _run_git(["show", f"{version}:{path}"], self.root)
                if r.returncode != 0:
                    return {"error": f"Cannot read {path} at {version}: {r.stderr.strip()}"}
                return {"content": r.stdout, "path": path}
            safe = self._safe_path(path)
            if not safe.exists():
                return {"error": f"File not found: {path}"}
            return {"content": safe.read_text(encoding="utf-8", errors="replace"), "path": path}
        except Exception as e:
            return {"error": str(e)}

    def write_file(self, path: str, content: str) -> dict:
        try:
            safe = self._safe_path(path)
            safe.parent.mkdir(parents=True, exist_ok=True)
            safe.write_text(content, encoding="utf-8")
            return {"ok": True, "path": path}
        except Exception as e:
            return {"error": str(e)}

    def create_file(self, path: str, content: str = "") -> dict:
        safe = self._safe_path(path)
        if safe.exists():
            return {"error": f"File already exists: {path}"}
        return self.write_file(path, content)

    def file_exists(self, path: str) -> bool:
        try:
            return self._safe_path(path).exists()
        except ValueError:
            return False

    def is_binary_file(self, path: str) -> bool:
        try:
            safe = self._safe_path(path)
            with open(safe, "rb") as f:
                chunk = f.read(8192)
            return b"\x00" in chunk
        except Exception:
            return True

    # ------------------------------------------------------------------
    # Git staging
    # ------------------------------------------------------------------

    def stage_files(self, paths: list[str]) -> dict:
        if not paths:
            return {"ok": True}
        r = _run_git(["add", "--"] + paths, self.root)
        if r.returncode != 0:
            return {"error": r.stderr.strip()}
        return {"ok": True}

    def unstage_files(self, paths: list[str]) -> dict:
        r = _run_git(["reset", "HEAD", "--"] + paths, self.root)
        if r.returncode != 0:
            return {"error": r.stderr.strip()}
        return {"ok": True}

    def discard_changes(self, paths: list[str]) -> dict:
        """Restore tracked files from HEAD, delete untracked files."""
        errors = []
        tracked = []
        for p in paths:
            r = _run_git(["ls-files", p], self.root)
            if r.stdout.strip():
                tracked.append(p)
            else:
                # Untracked — delete
                try:
                    safe = self._safe_path(p)
                    if safe.exists():
                        safe.unlink()
                except Exception as e:
                    errors.append(str(e))
        if tracked:
            r = _run_git(["checkout", "HEAD", "--"] + tracked, self.root)
            if r.returncode != 0:
                errors.append(r.stderr.strip())
        if errors:
            return {"error": "; ".join(errors)}
        return {"ok": True}

    def delete_file(self, path: str) -> dict:
        try:
            safe = self._safe_path(path)
            if safe.exists():
                safe.unlink()
            # Also remove from git index if tracked
            _run_git(["rm", "--cached", "--ignore-unmatch", path], self.root)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def rename_file(self, old_path: str, new_path: str) -> dict:
        try:
            old_safe = self._safe_path(old_path)
            new_safe = self._safe_path(new_path)
            if not old_safe.exists():
                return {"error": f"Source not found: {old_path}"}
            if new_safe.exists():
                return {"error": f"Destination exists: {new_path}"}
            new_safe.parent.mkdir(parents=True, exist_ok=True)
            # Check if tracked
            r = _run_git(["ls-files", old_path], self.root)
            if r.stdout.strip():
                r2 = _run_git(["mv", old_path, new_path], self.root)
                if r2.returncode != 0:
                    return {"error": r2.stderr.strip()}
            else:
                old_safe.rename(new_safe)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def rename_directory(self, old_path: str, new_path: str) -> dict:
        return self.rename_file(old_path, new_path)

    # ------------------------------------------------------------------
    # File tree
    # ------------------------------------------------------------------

    def get_file_tree(self) -> dict:
        """Build file tree with git status and diff stats."""
        try:
            # Tracked files
            r = _run_git(["ls-files"], self.root)
            tracked = set(r.stdout.strip().splitlines()) if r.stdout.strip() else set()

            # Untracked non-ignored files
            r = _run_git(["ls-files", "--others", "--exclude-standard"], self.root)
            untracked_list = r.stdout.strip().splitlines() if r.stdout.strip() else []
            untracked_set = set(untracked_list)

            all_files = sorted(tracked | untracked_set)

            # Git status
            r = _run_git(["diff", "--name-only"], self.root)
            modified = r.stdout.strip().splitlines() if r.stdout.strip() else []

            r = _run_git(["diff", "--cached", "--name-only"], self.root)
            staged = r.stdout.strip().splitlines() if r.stdout.strip() else []

            # Diff stats
            diff_stats = {}
            for cmd in [["diff", "--numstat"], ["diff", "--cached", "--numstat"]]:
                r = _run_git(cmd, self.root)
                if r.stdout:
                    for line in r.stdout.strip().splitlines():
                        parts = line.split("\t")
                        if len(parts) == 3:
                            adds, dels, fpath = parts
                            if fpath not in diff_stats:
                                diff_stats[fpath] = {"additions": 0, "deletions": 0}
                            try:
                                diff_stats[fpath]["additions"] += int(adds)
                                diff_stats[fpath]["deletions"] += int(dels)
                            except ValueError:
                                pass  # Binary files show '-'

            # Build tree
            root_name = self.root.name
            tree = self._build_tree(root_name, all_files)

            return {
                "tree": tree,
                "modified": modified,
                "staged": staged,
                "untracked": untracked_list,
                "diff_stats": diff_stats,
            }
        except Exception as e:
            return {"error": str(e)}

    def _build_tree(self, root_name: str, file_paths: list[str]) -> dict:
        """Build nested tree from flat file list."""
        root = {"name": root_name, "path": "", "type": "dir", "lines": 0, "children": []}
        dirs: dict[str, dict] = {"": root}

        for fpath in file_paths:
            parts = fpath.split("/")
            # Ensure parent dirs exist
            for i in range(len(parts) - 1):
                dir_path = "/".join(parts[: i + 1])
                if dir_path not in dirs:
                    node = {
                        "name": parts[i],
                        "path": dir_path,
                        "type": "dir",
                        "lines": 0,
                        "children": [],
                    }
                    parent_path = "/".join(parts[:i]) if i > 0 else ""
                    dirs[parent_path]["children"].append(node)
                    dirs[dir_path] = node

            # Add file node
            lines = self._count_lines(fpath)
            file_node = {
                "name": parts[-1],
                "path": fpath,
                "type": "file",
                "lines": lines,
                "children": [],
            }
            parent_path = "/".join(parts[:-1]) if len(parts) > 1 else ""
            dirs[parent_path]["children"].append(file_node)

        # Sort children alphabetically, dirs first
        self._sort_tree(root)
        return root

    def _sort_tree(self, node: dict):
        if node.get("children"):
            node["children"].sort(key=lambda n: (0 if n["type"] == "dir" else 1, n["name"].lower()))
            for child in node["children"]:
                self._sort_tree(child)

    def _count_lines(self, rel_path: str) -> int:
        try:
            full = self.root / rel_path
            if self.is_binary_file(rel_path):
                return 0
            return len(full.read_text(encoding="utf-8", errors="replace").splitlines())
        except Exception:
            return 0

    def get_flat_file_list(self) -> str:
        """Return flat sorted file list for the LLM prompt."""
        r = _run_git(["ls-files"], self.root)
        tracked = r.stdout.strip().splitlines() if r.stdout.strip() else []
        r = _run_git(["ls-files", "--others", "--exclude-standard"], self.root)
        untracked = r.stdout.strip().splitlines() if r.stdout.strip() else []
        all_files = sorted(set(tracked + untracked))
        count = len(all_files)
        lines = [f"# File Tree ({count} files)", ""]
        lines.extend(all_files)
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Commit operations
    # ------------------------------------------------------------------

    def get_staged_diff(self) -> dict:
        r = _run_git(["diff", "--cached"], self.root)
        return {"diff": r.stdout}

    def get_unstaged_diff(self) -> dict:
        r = _run_git(["diff"], self.root)
        return {"diff": r.stdout}

    def stage_all(self) -> dict:
        r = _run_git(["add", "-A"], self.root)
        if r.returncode != 0:
            return {"error": r.stderr.strip()}
        return {"ok": True}

    def commit(self, message: str) -> dict:
        try:
            # Check if this is a new repo with no commits
            r = _run_git(["rev-parse", "HEAD"], self.root)
            if r.returncode != 0:
                # No commits yet — use --allow-empty for first commit
                r = _run_git(["commit", "--allow-empty-message", "-m", message], self.root)
            else:
                r = _run_git(["commit", "-m", message], self.root)
            if r.returncode != 0:
                return {"error": r.stderr.strip()}
            return {"ok": True, "output": r.stdout.strip()}
        except Exception as e:
            return {"error": str(e)}

    def reset_hard(self) -> dict:
        r = _run_git(["reset", "--hard", "HEAD"], self.root)
        if r.returncode != 0:
            return {"error": r.stderr.strip()}
        return {"ok": True}

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_files(
        self,
        query: str,
        whole_word: bool = False,
        use_regex: bool = False,
        ignore_case: bool = True,
        context_lines: int = 0,
    ) -> list[dict]:
        """Full-text search via git grep."""
        if not query:
            return []
        args = ["grep", "-n", "--no-color"]
        if ignore_case:
            args.append("-i")
        if whole_word:
            args.append("-w")
        if use_regex:
            args.append("-E")
        else:
            args.append("-F")
        if context_lines > 0:
            args.append(f"-C{context_lines}")
        args.append("--")
        args.append(query)

        r = _run_git(args, self.root)
        if r.returncode not in (0, 1):
            return []

        return self._parse_grep_output(r.stdout, context_lines)

    def _parse_grep_output(self, output: str, context_lines: int) -> list[dict]:
        """Parse git grep output into structured results."""
        if not output.strip():
            return []

        results: dict[str, dict] = {}
        current_match: Optional[dict] = None
        context_before: list[dict] = []

        for line in output.splitlines():
            if line == "--":
                # Group separator
                if current_match:
                    current_match = None
                context_before = []
                continue

            # Match line: file:linenum:content
            if ":" in line:
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    fpath, linenum_str, content = parts[0], parts[1], parts[2]
                    try:
                        linenum = int(linenum_str)
                    except ValueError:
                        # Context line with - separator
                        if "-" in line:
                            parts2 = line.split("-", 2)
                            if len(parts2) >= 3:
                                try:
                                    ctx_line = int(parts2[1])
                                    if current_match:
                                        current_match["context_after"].append(
                                            {"line_num": ctx_line, "line": parts2[2]}
                                        )
                                    else:
                                        context_before.append(
                                            {"line_num": ctx_line, "line": parts2[2]}
                                        )
                                except ValueError:
                                    pass
                        continue

                    if fpath not in results:
                        results[fpath] = {"file": fpath, "matches": []}

                    current_match = {
                        "line_num": linenum,
                        "line": content,
                        "context_before": list(context_before),
                        "context_after": [],
                    }
                    context_before = []
                    results[fpath]["matches"].append(current_match)

        return list(results.values())
