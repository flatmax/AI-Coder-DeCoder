"""Repository operations layer.

Wraps git operations and file I/O. All paths are relative to repo root.
Exposed to browser via RPC and used internally by LLM context engine.
"""

import logging
import os
import re
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


class Repo:
    """RPC service for repository operations.

    Public methods are exposed as Repo.method_name RPC endpoints.
    """

    def __init__(self, repo_root):
        self._root = Path(repo_root).resolve()
        if not (self._root / ".git").exists():
            raise ValueError(f"Not a git repository: {self._root}")

    @property
    def root(self):
        return self._root

    def _resolve_path(self, path):
        """Resolve and validate a path relative to repo root."""
        if ".." in str(path):
            raise ValueError("Path traversal not allowed")
        resolved = (self._root / path).resolve()
        if not str(resolved).startswith(str(self._root)):
            raise ValueError("Path outside repository")
        return resolved

    def _run_git(self, *args, check=True, capture=True):
        """Run a git command in the repo root."""
        cmd = ["git", "-C", str(self._root)] + list(args)
        try:
            result = subprocess.run(
                cmd,
                capture_output=capture,
                text=True,
                check=check,
                timeout=30,
            )
            return result.stdout if capture else ""
        except subprocess.CalledProcessError as e:
            logger.error(f"Git command failed: {' '.join(args)}: {e.stderr}")
            raise
        except subprocess.TimeoutExpired:
            logger.error(f"Git command timed out: {' '.join(args)}")
            raise

    # === File Operations ===

    def get_file_content(self, path, version=None):
        """Read file content. Optional version for committed content."""
        try:
            if version:
                try:
                    content = self._run_git("show", f"{version}:{path}")
                    return {"content": content}
                except subprocess.CalledProcessError:
                    return {"content": "", "error": f"File not in {version}"}
            resolved = self._resolve_path(path)
            if not resolved.exists():
                return {"error": "File not found"}
            return {"content": resolved.read_text()}
        except ValueError as e:
            return {"error": str(e)}
        except UnicodeDecodeError:
            return {"error": "Binary file"}

    def write_file(self, path, content):
        """Write content to file. Creates parent directories."""
        try:
            resolved = self._resolve_path(path)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content)
            return {"success": True}
        except ValueError as e:
            return {"error": str(e)}

    def create_file(self, path, content):
        """Create new file. Errors if file exists."""
        try:
            resolved = self._resolve_path(path)
            if resolved.exists():
                return {"error": "File already exists"}
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content)
            return {"success": True}
        except ValueError as e:
            return {"error": str(e)}

    def file_exists(self, path):
        """Check if file exists."""
        try:
            resolved = self._resolve_path(path)
            return resolved.exists()
        except ValueError:
            return False

    def is_binary_file(self, path):
        """Check if file is binary (null bytes in first 8KB)."""
        try:
            resolved = self._resolve_path(path)
            with open(resolved, "rb") as f:
                chunk = f.read(8192)
                return b"\x00" in chunk
        except (ValueError, OSError):
            return False

    def delete_file(self, path):
        """Remove file from filesystem."""
        try:
            resolved = self._resolve_path(path)
            if resolved.exists():
                resolved.unlink()
                return {"success": True}
            return {"error": "File not found"}
        except ValueError as e:
            return {"error": str(e)}

    # === Git Staging ===

    def stage_files(self, paths):
        """Stage files for commit."""
        try:
            self._run_git("add", "--", *paths)
            return {"success": True}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def unstage_files(self, paths):
        """Remove from staging area."""
        try:
            self._run_git("reset", "HEAD", "--", *paths)
            return {"success": True}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def discard_changes(self, paths):
        """Tracked: restore from HEAD. Untracked: delete."""
        results = []
        for path in paths:
            try:
                resolved = self._resolve_path(path)
                # Check if tracked
                try:
                    self._run_git("ls-files", "--error-unmatch", path)
                    # Tracked — restore
                    self._run_git("checkout", "HEAD", "--", path)
                except subprocess.CalledProcessError:
                    # Untracked — delete
                    if resolved.exists():
                        resolved.unlink()
                results.append({"path": path, "success": True})
            except Exception as e:
                results.append({"path": path, "error": str(e)})
        return results

    def stage_all(self):
        """Stage all changes."""
        self._run_git("add", "-A")
        return {"success": True}

    # === Rename/Move ===

    def rename_file(self, old_path, new_path):
        """Rename file. git mv for tracked, filesystem for untracked."""
        try:
            old_resolved = self._resolve_path(old_path)
            self._resolve_path(new_path)  # validate new path
            try:
                self._run_git("ls-files", "--error-unmatch", old_path)
                self._run_git("mv", old_path, new_path)
            except subprocess.CalledProcessError:
                new_resolved = self._resolve_path(new_path)
                new_resolved.parent.mkdir(parents=True, exist_ok=True)
                old_resolved.rename(new_resolved)
            return {"success": True}
        except (ValueError, OSError) as e:
            return {"error": str(e)}

    def rename_directory(self, old_path, new_path):
        """Rename directory."""
        return self.rename_file(old_path, new_path)

    # === Commit Operations ===

    def get_staged_diff(self):
        """Get staged diff text."""
        try:
            return {"diff": self._run_git("diff", "--cached")}
        except subprocess.CalledProcessError:
            return {"diff": ""}

    def get_unstaged_diff(self):
        """Get unstaged diff text."""
        try:
            return {"diff": self._run_git("diff")}
        except subprocess.CalledProcessError:
            return {"diff": ""}

    def commit(self, message):
        """Create commit."""
        try:
            self._run_git("commit", "-m", message)
            sha = self._run_git("rev-parse", "HEAD").strip()
            return {"success": True, "sha": sha}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def reset_hard(self):
        """Reset to HEAD."""
        try:
            self._run_git("reset", "--hard", "HEAD")
            return {"success": True}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    # === File Tree ===

    def get_file_tree(self):
        """Return nested tree combining tracked and untracked files."""
        try:
            # Get tracked files
            tracked = self._run_git("ls-files").strip().splitlines()
            # Get untracked (non-ignored)
            untracked_out = self._run_git(
                "ls-files", "--others", "--exclude-standard"
            ).strip()
            untracked = untracked_out.splitlines() if untracked_out else []

            all_files = sorted(set(tracked + untracked))

            # Get status arrays
            modified = []
            staged = []
            status_output = self._run_git("status", "--porcelain").strip()
            for line in status_output.splitlines():
                if not line or len(line) < 3:
                    continue
                index_status = line[0]
                work_status = line[1]
                filepath = line[3:].strip()
                # Remove quotes from paths with special characters
                if filepath.startswith('"') and filepath.endswith('"'):
                    filepath = filepath[1:-1]
                if index_status in ("M", "A", "D", "R"):
                    staged.append(filepath)
                if work_status == "M":
                    modified.append(filepath)

            # Get diff stats
            diff_stats = {}
            try:
                numstat = self._run_git("diff", "--numstat").strip()
                for line in numstat.splitlines():
                    parts = line.split("\t")
                    if len(parts) >= 3:
                        adds = int(parts[0]) if parts[0] != "-" else 0
                        dels = int(parts[1]) if parts[1] != "-" else 0
                        diff_stats[parts[2]] = {"additions": adds, "deletions": dels}
                # Also staged numstat
                staged_numstat = self._run_git("diff", "--cached", "--numstat").strip()
                for line in staged_numstat.splitlines():
                    parts = line.split("\t")
                    if len(parts) >= 3:
                        adds = int(parts[0]) if parts[0] != "-" else 0
                        dels = int(parts[1]) if parts[1] != "-" else 0
                        path = parts[2]
                        if path in diff_stats:
                            diff_stats[path]["additions"] += adds
                            diff_stats[path]["deletions"] += dels
                        else:
                            diff_stats[path] = {"additions": adds, "deletions": dels}
            except subprocess.CalledProcessError:
                pass

            # Build tree
            root_name = self._root.name
            tree = self._build_tree(root_name, all_files)

            return {
                "tree": tree,
                "modified": modified,
                "staged": staged,
                "untracked": untracked,
                "diff_stats": diff_stats,
            }
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def _build_tree(self, root_name, file_paths):
        """Build a nested tree structure from flat file paths."""
        root = {
            "name": root_name,
            "path": "",
            "type": "dir",
            "lines": 0,
            "children": [],
        }

        dirs = {}  # path -> node

        for filepath in file_paths:
            parts = filepath.split("/")
            current = root

            for i, part in enumerate(parts[:-1]):
                dir_path = "/".join(parts[:i + 1])
                if dir_path not in dirs:
                    node = {
                        "name": part,
                        "path": dir_path,
                        "type": "dir",
                        "lines": 0,
                        "children": [],
                    }
                    current["children"].append(node)
                    dirs[dir_path] = node
                current = dirs[dir_path]

            # Add file node
            resolved = self._root / filepath
            lines = 0
            mtime = 0
            if resolved.exists():
                try:
                    if not self.is_binary_file(filepath):
                        lines = resolved.read_text().count("\n")
                except (OSError, UnicodeDecodeError):
                    pass
                try:
                    mtime = resolved.stat().st_mtime
                except OSError:
                    pass

            current["children"].append({
                "name": parts[-1],
                "path": filepath,
                "type": "file",
                "lines": lines,
                "mtime": mtime,
                "children": [],
            })

        return root

    def get_flat_file_list(self):
        """Return sorted flat list of all tracked and untracked files."""
        try:
            tracked = self._run_git("ls-files").strip().splitlines()
            untracked_out = self._run_git(
                "ls-files", "--others", "--exclude-standard"
            ).strip()
            untracked = untracked_out.splitlines() if untracked_out else []
            return sorted(set(tracked + untracked))
        except subprocess.CalledProcessError:
            return []

    # === Search ===

    def search_files(self, query, whole_word=False, use_regex=False,
                     ignore_case=True, context_lines=2):
        """Search repo files using git grep."""
        if not query:
            return []

        args = ["grep", "-n"]
        if ignore_case:
            args.append("-i")
        if whole_word:
            args.append("-w")
        if use_regex:
            args.append("-E")
        else:
            args.append("-F")
        if context_lines:
            args.append(f"-C{context_lines}")
        args.append("--")
        args.append(query)

        try:
            output = self._run_git(*args, check=False)
            return self._parse_grep_output(output, context_lines)
        except subprocess.CalledProcessError:
            return []

    def _parse_grep_output(self, output, context_lines):
        """Parse git grep output into structured results."""
        if not output.strip():
            return []

        results = {}
        current_file = None
        current_match = None

        for line in output.split("\n"):
            if not line:
                continue
            if line == "--":
                # Context separator
                if current_match and current_file:
                    if current_file not in results:
                        results[current_file] = []
                    results[current_file].append(current_match)
                    current_match = None
                continue

            # Parse "file:linenum:content" or "file-linenum-content"
            match_sep = re.match(r'^(.+?)[:\-](\d+)[:\-](.*)$', line)
            if match_sep:
                filepath = match_sep.group(1)
                line_num = int(match_sep.group(2))
                content = match_sep.group(3)
                is_match = ":" in line[len(filepath):len(filepath) + 1]

                if is_match:
                    if current_match and current_file:
                        if current_file not in results:
                            results[current_file] = []
                        results[current_file].append(current_match)

                    current_file = filepath
                    current_match = {
                        "line_num": line_num,
                        "line": content,
                        "context_before": [],
                        "context_after": [],
                    }
                elif current_match:
                    if line_num < current_match["line_num"]:
                        current_match["context_before"].append({
                            "line_num": line_num,
                            "line": content,
                        })
                    else:
                        current_match["context_after"].append({
                            "line_num": line_num,
                            "line": content,
                        })

        # Flush last match
        if current_match and current_file:
            if current_file not in results:
                results[current_file] = []
            results[current_file].append(current_match)

        return [{"file": f, "matches": m} for f, m in results.items()]

    # === Review mode support ===

    def get_current_branch(self):
        """Get current branch name and SHA."""
        try:
            try:
                branch = self._run_git("symbolic-ref", "--short", "HEAD").strip()
                sha = self._run_git("rev-parse", "HEAD").strip()
                return {"branch": branch, "sha": sha, "detached": False}
            except subprocess.CalledProcessError:
                sha = self._run_git("rev-parse", "HEAD").strip()
                return {"branch": None, "sha": sha, "detached": True}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def resolve_ref(self, ref):
        """Resolve a git ref to a full SHA. Returns None if not found."""
        try:
            return self._run_git("rev-parse", "--verify", ref).strip()
        except subprocess.CalledProcessError:
            return None

    def get_commit_parent(self, commit):
        """Get parent of a commit."""
        try:
            sha = self._run_git("rev-parse", f"{commit}^").strip()
            short = sha[:7]
            return {"sha": sha, "short_sha": short}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def list_branches(self):
        """List local branches."""
        try:
            output = self._run_git("branch", "--format=%(refname:short)|%(objectname:short)|%(subject)|%(HEAD)")
            branches = []
            for line in output.strip().splitlines():
                parts = line.split("|", 3)
                if len(parts) >= 3:
                    branches.append({
                        "name": parts[0],
                        "sha": parts[1],
                        "message": parts[2],
                        "current": parts[3].strip() == "*" if len(parts) > 3 else False,
                    })
            return branches
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def is_clean(self):
        """Check if working tree is clean (ignores untracked files)."""
        try:
            output = self._run_git("status", "--porcelain", "-uno").strip()
            return len(output) == 0
        except subprocess.CalledProcessError:
            return False

    def search_commits(self, query, branch=None, limit=50):
        """Search commits by message, SHA, or author."""
        args = ["log", "--oneline", f"-{limit}"]
        if branch:
            args.append(branch)
        args.extend(["--grep", query, "--regexp-ignore-case"])
        try:
            output = self._run_git(*args)
            commits = []
            for line in output.strip().splitlines():
                if line:
                    parts = line.split(" ", 1)
                    commits.append({
                        "sha": parts[0],
                        "message": parts[1] if len(parts) > 1 else "",
                    })
            return commits
        except subprocess.CalledProcessError:
            return []

    def get_commit_log(self, base, head=None, limit=500):
        """Get commit range log."""
        range_spec = f"{base}..{head}" if head else base
        try:
            output = self._run_git(
                "log", "--format=%H|%h|%s|%an|%ai", range_spec
            )
            commits = []
            for line in output.strip().splitlines():
                parts = line.split("|", 4)
                if len(parts) >= 4:
                    commits.append({
                        "sha": parts[0],
                        "short_sha": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "date": parts[4] if len(parts) > 4 else "",
                    })
            return commits
        except subprocess.CalledProcessError:
            return []

    def get_merge_base(self, ref1, ref2=None):
        """Get merge base SHA."""
        if ref2 is None:
            ref2 = "main"
        try:
            output = self._run_git("merge-base", ref1, ref2)
            return {"sha": output.strip()}
        except subprocess.CalledProcessError:
            try:
                output = self._run_git("merge-base", ref1, "master")
                return {"sha": output.strip()}
            except subprocess.CalledProcessError as e:
                return {"error": str(e)}

    def get_commit_graph(self, limit=100, offset=0, include_remote=False):
        """Get commit graph data for the review selector.

        Returns commits with parent relationships and branch info.
        """
        try:
            # Get commits with parents
            # Use %P for parent SHAs in format string (--parents flag doesn't
            # inject into --format output)
            fmt = "%H|%P|%h|%s|%an|%ai|%ar"
            args = ["log", "--all", "--topo-order",
                    f"--format={fmt}",
                    f"--skip={offset}", f"--max-count={limit + 1}"]
            output = self._run_git(*args)

            commits = []
            for line in output.strip().splitlines():
                if not line:
                    continue
                parts = line.split("|", 6)
                if len(parts) < 6:
                    continue
                sha = parts[0]
                parents = parts[1].split() if parts[1].strip() else []
                commits.append({
                    "sha": sha,
                    "short_sha": parts[2],
                    "message": parts[3],
                    "author": parts[4],
                    "date": parts[5],
                    "relative_date": parts[6] if len(parts) > 6 else "",
                    "parents": parents,
                })

            has_more = len(commits) > limit
            commits = commits[:limit]

            # Get branches
            branch_args = ["branch", "--sort=-committerdate",
                           "--format=%(refname:short)|%(objectname)|%(HEAD)|%(symref)"]
            if include_remote:
                branch_args.insert(1, "-a")
            branch_output = self._run_git(*branch_args)

            branches = []
            for bline in branch_output.strip().splitlines():
                if not bline:
                    continue
                bparts = bline.split("|", 3)
                if len(bparts) < 3:
                    continue
                name = bparts[0].strip()
                bsha = bparts[1].strip()
                is_current = bparts[2].strip() == "*"
                symref = bparts[3].strip() if len(bparts) > 3 else ""

                # Filter symbolic refs
                if name in ("HEAD", "origin/HEAD"):
                    continue
                if " -> " in name or " -> " in symref:
                    continue
                if symref:
                    continue

                is_remote = "/" in name and name.split("/")[0] not in (".", "..")

                # Filter bare remote aliases
                if is_remote:
                    prefix = name + "/"
                    is_bare = any(
                        ol.split("|", 1)[0].strip() != name
                        and ol.split("|", 1)[0].strip().startswith(prefix)
                        for ol in branch_output.strip().splitlines()
                    )
                    if is_bare:
                        continue

                branches.append({
                    "name": name,
                    "sha": bsha,
                    "is_current": is_current,
                    "is_remote": is_remote,
                })

            return {
                "commits": commits,
                "branches": branches,
                "has_more": has_more,
            }
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def checkout_review_parent(self, branch, base_commit):
        """Check out the parent of the base commit for review setup.

        Steps: record original branch, checkout branch, checkout parent.
        """
        try:
            current = self.get_current_branch()
            original_branch = current.get("branch") or current.get("sha", "")

            branch_tip = self.resolve_ref(branch)
            if not branch_tip:
                return {"error": f"Cannot resolve ref: {branch}"}

            parent_result = self.get_commit_parent(base_commit)
            if "error" in parent_result:
                return {"error": f"Cannot get parent of {base_commit}: {parent_result['error']}"}
            parent_commit = parent_result["sha"]

            try:
                self._run_git("checkout", branch)
            except subprocess.CalledProcessError as e:
                return {"error": f"Cannot checkout {branch}: {e.stderr}"}

            try:
                self._run_git("checkout", parent_commit)
            except subprocess.CalledProcessError as e:
                try:
                    self._run_git("checkout", original_branch)
                except subprocess.CalledProcessError:
                    pass
                return {"error": f"Cannot checkout parent {parent_commit}: {e.stderr}"}

            return {
                "branch": branch,
                "branch_tip": branch_tip,
                "base_commit": base_commit,
                "parent_commit": parent_commit,
                "original_branch": original_branch,
                "phase": "at_parent",
            }
        except Exception as e:
            return {"error": str(e)}

    def setup_review_soft_reset(self, branch_tip, parent_commit):
        """Complete review setup: checkout branch tip by SHA, then soft reset to parent."""
        try:
            self._run_git("checkout", branch_tip)
            self._run_git("reset", "--soft", parent_commit)
            return {"status": "review_ready"}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def exit_review_mode(self, branch_tip, original_branch):
        """Restore repository after review."""
        try:
            self._run_git("reset", "--soft", branch_tip)
            try:
                self._run_git("checkout", original_branch)
            except subprocess.CalledProcessError as e:
                return {
                    "status": "partial_restore",
                    "warning": f"HEAD detached at {branch_tip[:7]}. "
                               f"Failed to checkout {original_branch}: {e.stderr}. "
                               f"Run: git checkout {original_branch}",
                }
            return {"status": "restored"}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def get_review_file_diff(self, path):
        """Get reverse diff for a file (staged changes, reversed)."""
        try:
            diff = self._run_git("diff", "--cached", "-R", "--", path)
            return {"path": path, "diff": diff}
        except subprocess.CalledProcessError:
            return {"path": path, "diff": ""}

    def get_review_changed_files(self):
        """Get list of files changed in the review (staged changes)."""
        try:
            status_output = self._run_git("diff", "--cached", "--name-status").strip()
            files = []
            for line in status_output.splitlines():
                if not line:
                    continue
                parts = line.split("\t", 1)
                if len(parts) < 2:
                    continue
                status_code = parts[0].strip()
                filepath = parts[1].strip()
                status_map = {"A": "added", "M": "modified", "D": "deleted",
                              "R": "renamed", "C": "copied"}
                status = status_map.get(status_code[0], "modified")
                files.append({"path": filepath, "status": status})

            numstat = self._run_git("diff", "--cached", "--numstat").strip()
            stat_map = {}
            for line in numstat.splitlines():
                nparts = line.split("\t")
                if len(nparts) >= 3:
                    adds = int(nparts[0]) if nparts[0] != "-" else 0
                    dels = int(nparts[1]) if nparts[1] != "-" else 0
                    stat_map[nparts[2]] = {"additions": adds, "deletions": dels}

            for f in files:
                stats = stat_map.get(f["path"], {})
                f["additions"] = stats.get("additions", 0)
                f["deletions"] = stats.get("deletions", 0)

            return files
        except subprocess.CalledProcessError:
            return []

