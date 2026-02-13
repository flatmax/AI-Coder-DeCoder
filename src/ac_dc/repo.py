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

    # ------------------------------------------------------------------
    # Review mode (code review)
    # ------------------------------------------------------------------

    def list_branches(self) -> dict:
        """List local branches with current branch info."""
        r = _run_git(["branch", "--format=%(refname:short)\t%(objectname:short)\t%(subject)"], self.root)
        if r.returncode != 0:
            return {"error": r.stderr.strip()}
        branches = []
        for line in r.stdout.strip().splitlines():
            parts = line.split("\t", 2)
            if len(parts) >= 2:
                branches.append({
                    "name": parts[0],
                    "sha": parts[1],
                    "message": parts[2] if len(parts) > 2 else "",
                })
        # Current branch
        r2 = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], self.root)
        current = r2.stdout.strip() if r2.returncode == 0 else ""
        for b in branches:
            b["is_current"] = b["name"] == current
        return {"branches": branches, "current": current}

    def get_current_branch(self) -> dict:
        """Get current branch name and SHA."""
        r = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], self.root)
        branch = r.stdout.strip() if r.returncode == 0 else ""
        detached = branch == "HEAD"
        r2 = _run_git(["rev-parse", "HEAD"], self.root)
        sha = r2.stdout.strip() if r2.returncode == 0 else ""
        return {"branch": branch, "sha": sha, "detached": detached}

    def is_clean(self) -> bool:
        """Check if working tree is clean (no staged or unstaged changes to tracked files).

        Untracked files are ignored — they won't conflict with checkout/reset
        operations and are common in any repo (.ac-dc/, editor configs, etc.).
        """
        r = _run_git(["status", "--porcelain", "-uno"], self.root)
        return r.returncode == 0 and not r.stdout.strip()

    def resolve_ref(self, ref: str) -> Optional[str]:
        """Resolve a git ref (branch name, tag, SHA prefix) to a full SHA."""
        r = _run_git(["rev-parse", ref], self.root)
        if r.returncode != 0:
            return None
        return r.stdout.strip()

    def get_commit_graph(self, limit: int = 100, offset: int = 0,
                         include_remote: bool = False) -> dict:
        """Get commit graph data for the git graph UI.

        Returns commits with parent relationships and branch info,
        ordered topologically for graph rendering.
        """
        # Get branch data, sorted by most recent commit
        branch_args = ["branch", "--sort=-committerdate",
                       "--format=%(refname:short)\t%(objectname)\t%(if)%(HEAD)%(then)1%(else)0%(end)"]
        if include_remote:
            branch_args.insert(1, "-a")
        r = _run_git(branch_args, self.root)
        branches_raw = []
        if r.returncode == 0 and r.stdout.strip():
            for line in r.stdout.strip().splitlines():
                parts = line.split("\t", 2)
                if len(parts) >= 3:
                    name = parts[0].strip()
                    sha = parts[1].strip()
                    is_current = parts[2].strip() == "1"
                    is_remote = "/" in name
                    # Skip symbolic refs and pointer entries:
                    #  - "HEAD" (detached HEAD)
                    #  - anything ending in "/HEAD" (e.g. origin/HEAD)
                    #  - lines containing " -> " (symbolic ref pointers)
                    if name == "HEAD" or name.endswith("/HEAD") or " -> " in line:
                        continue
                    branches_raw.append({
                        "name": name,
                        "sha": sha,
                        "is_current": is_current,
                        "is_remote": is_remote,
                    })

        # Post-filter: remove bare remote aliases (e.g. "origin") that git
        # includes when listing branches with -a. A bare name that is a prefix
        # of other branch names (e.g. "origin" when "origin/master" exists)
        # is a remote alias, not a real branch.
        all_names = {b["name"] for b in branches_raw}
        branches = []
        for b in branches_raw:
            if "/" not in b["name"] and not b["is_current"]:
                if any(n.startswith(b["name"] + "/") for n in all_names):
                    continue
            branches.append(b)

        # Get commits with parents in topological order
        log_args = ["log", "--all", "--topo-order",
                    "--format=%H\t%h\t%s\t%an\t%aI\t%ar\t%P",
                    f"--max-count={limit}"]
        if offset > 0:
            log_args.append(f"--skip={offset}")
        r = _run_git(log_args, self.root)
        commits = []
        if r.returncode == 0 and r.stdout.strip():
            for line in r.stdout.strip().splitlines():
                parts = line.split("\t", 6)
                if len(parts) >= 7:
                    parent_str = parts[6].strip()
                    parents = parent_str.split() if parent_str else []
                    commits.append({
                        "sha": parts[0],
                        "short_sha": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "date": parts[4],
                        "relative_date": parts[5],
                        "parents": parents,
                    })

        # Check if there are more commits beyond this batch
        has_more = False
        if len(commits) == limit:
            check_args = ["log", "--all", "--topo-order", "--format=%H",
                          "--max-count=1", f"--skip={offset + limit}"]
            r2 = _run_git(check_args, self.root)
            has_more = r2.returncode == 0 and bool(r2.stdout.strip())

        return {
            "commits": commits,
            "branches": branches,
            "has_more": has_more,
        }

    def search_commits(self, query: str = "", branch: str = "",
                       limit: int = 50) -> list[dict]:
        """Search commits by message, SHA prefix, or author."""
        args = ["log", f"--max-count={limit}",
                "--format=%H\t%h\t%s\t%an\t%aI"]
        if branch:
            args.append(branch)
        if query:
            args.extend(["--grep=" + query, "--regexp-ignore-case"])
        r = _run_git(args, self.root)
        if r.returncode != 0:
            # Try SHA prefix match
            if query:
                r2 = _run_git(["log", f"--max-count={limit}",
                               "--format=%H\t%h\t%s\t%an\t%aI",
                               branch or "HEAD"], self.root)
                if r2.returncode == 0:
                    results = []
                    for line in r2.stdout.strip().splitlines():
                        parts = line.split("\t", 4)
                        if len(parts) >= 5 and (
                            parts[0].startswith(query) or parts[1].startswith(query)
                        ):
                            results.append({
                                "sha": parts[0], "short_sha": parts[1],
                                "message": parts[2], "author": parts[3],
                                "date": parts[4],
                            })
                    return results
            return []
        results = []
        for line in r.stdout.strip().splitlines():
            parts = line.split("\t", 4)
            if len(parts) >= 5:
                results.append({
                    "sha": parts[0], "short_sha": parts[1],
                    "message": parts[2], "author": parts[3],
                    "date": parts[4],
                })
        return results

    def get_commit_log(self, base: str, head: str = "HEAD",
                       limit: int = 200) -> list[dict]:
        """Get commits from base (exclusive) to head (inclusive)."""
        r = _run_git(["log", f"--max-count={limit}",
                       "--format=%H\t%h\t%s\t%an\t%aI",
                       f"{base}..{head}"], self.root)
        if r.returncode != 0:
            return []
        results = []
        for line in r.stdout.strip().splitlines():
            parts = line.split("\t", 4)
            if len(parts) >= 5:
                results.append({
                    "sha": parts[0], "short_sha": parts[1],
                    "message": parts[2], "author": parts[3],
                    "date": parts[4],
                })
        return results

    def get_commit_parent(self, commit: str) -> dict:
        """Get parent of a commit."""
        r = _run_git(["rev-parse", f"{commit}^"], self.root)
        if r.returncode != 0:
            return {"error": f"Cannot find parent of {commit}: {r.stderr.strip()}"}
        sha = r.stdout.strip()
        r2 = _run_git(["rev-parse", "--short", sha], self.root)
        short = r2.stdout.strip() if r2.returncode == 0 else sha[:8]
        return {"sha": sha, "short_sha": short}

    def get_merge_base(self, ref1: str, ref2: str = "HEAD") -> dict:
        """Find merge base between two refs."""
        r = _run_git(["merge-base", ref1, ref2], self.root)
        if r.returncode != 0:
            return {"error": f"Cannot find merge base: {r.stderr.strip()}"}
        sha = r.stdout.strip()
        r2 = _run_git(["rev-parse", "--short", sha], self.root)
        short = r2.stdout.strip() if r2.returncode == 0 else sha[:8]
        return {"sha": sha, "short_sha": short}

    def enter_review_mode(self, branch: str, base_commit: str) -> dict:
        """Enter code review mode: checkout parent, prepare for symbol map capture.

        Steps 1-3 of the entry sequence. Returns phase="at_parent" when
        the repo is at the parent commit (pre-review state) and symbol map
        should be built from disk files.

        The branch may be a local branch (e.g. 'feature-auth') or a remote
        tracking ref (e.g. 'origin/feature-auth'). Both work — remote refs
        already have commits locally from fetch.
        """
        # Step 1: Verify clean working tree
        if not self.is_clean():
            return {"error": "Cannot enter review mode: working tree has uncommitted changes. "
                    "Please commit, stash, or discard changes first "
                    "(git stash, git commit, or git checkout -- <file>)."}

        # Get branch tip SHA for later restoration
        r = _run_git(["rev-parse", branch], self.root)
        if r.returncode != 0:
            return {"error": f"Cannot resolve branch '{branch}': {r.stderr.strip()}"}
        branch_tip = r.stdout.strip()

        # Get parent of base commit
        parent_result = self.get_commit_parent(base_commit)
        if "error" in parent_result:
            return parent_result
        parent_sha = parent_result["sha"]

        # Step 2: Checkout branch (ensure we have the right files on disk)
        # This may result in detached HEAD if branch is a remote ref — that's fine
        r = _run_git(["checkout", branch], self.root)
        if r.returncode != 0:
            return {"error": f"Cannot checkout branch '{branch}': {r.stderr.strip()}"}

        # Step 3: Checkout parent (detached HEAD at pre-review state)
        r = _run_git(["checkout", parent_sha], self.root)
        if r.returncode != 0:
            _run_git(["checkout", branch], self.root)
            return {"error": f"Cannot checkout parent commit: {r.stderr.strip()}"}

        return {
            "branch": branch,
            "branch_tip": branch_tip,
            "base_commit": base_commit,
            "parent_commit": parent_sha,
            "phase": "at_parent",
        }

    def complete_review_setup(self, branch: str, branch_tip: str,
                              parent_commit: str) -> dict:
        """Complete review mode setup after symbol map is captured.

        Steps 5-6: checkout branch tip (by SHA to handle remote refs),
        then soft reset to parent.
        """
        # Step 5: Checkout branch tip by SHA (works for both local and remote refs)
        # Using the SHA avoids issues with remote refs like 'origin/foo'
        # which would leave HEAD detached at the ref rather than at the tip
        r = _run_git(["checkout", branch_tip], self.root)
        if r.returncode != 0:
            return {"error": f"Cannot checkout branch tip: {r.stderr.strip()}"}

        # Step 6: Soft reset to parent (all review changes become staged)
        r = _run_git(["reset", "--soft", parent_commit], self.root)
        if r.returncode != 0:
            return {"error": f"Soft reset failed: {r.stderr.strip()}"}

        return {"status": "review_ready"}

    def exit_review_mode(self, branch_tip: str) -> dict:
        """Exit review mode: soft reset to branch tip to unstage everything.

        Leaves HEAD detached at the branch tip. The user can checkout
        whichever branch they want after the review.
        """
        r = _run_git(["reset", "--soft", branch_tip], self.root)
        if r.returncode != 0:
            return {"error": f"Reset to branch tip failed: {r.stderr.strip()}"}
        return {"status": "restored"}

    def get_review_diff(self, path: str) -> dict:
        """Get staged diff for a single file (review mode)."""
        r = _run_git(["diff", "--cached", "--", path], self.root)
        return {"diff": r.stdout, "path": path}

    def get_review_changed_files(self) -> list[dict]:
        """Get list of changed files in review mode (staged changes)."""
        r = _run_git(["diff", "--cached", "--numstat"], self.root)
        if r.returncode != 0:
            return []
        files = []
        for line in r.stdout.strip().splitlines():
            parts = line.split("\t")
            if len(parts) == 3:
                adds, dels, fpath = parts
                try:
                    additions = int(adds)
                except ValueError:
                    additions = 0
                try:
                    deletions = int(dels)
                except ValueError:
                    deletions = 0
                # Determine status
                r2 = _run_git(["diff", "--cached", "--diff-filter=A", "--name-only", "--", fpath], self.root)
                if fpath in (r2.stdout or ""):
                    status = "added"
                else:
                    r3 = _run_git(["diff", "--cached", "--diff-filter=D", "--name-only", "--", fpath], self.root)
                    if fpath in (r3.stdout or ""):
                        status = "deleted"
                    else:
                        status = "modified"
                files.append({
                    "path": fpath,
                    "status": status,
                    "additions": additions,
                    "deletions": deletions,
                })
        return files

    def get_review_file_diff(self, path: str) -> str:
        """Get the unified diff for a single file in review mode."""
        r = _run_git(["diff", "--cached", "--", path], self.root)
        return r.stdout if r.returncode == 0 else ""

    def get_reverse_review_file_diff(self, path: str) -> str:
        """Get the reverse diff for a file in review mode (current → parent)."""
        r = _run_git(["diff", "--cached", "-R", "--", path], self.root)
        return r.stdout if r.returncode == 0 else ""

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