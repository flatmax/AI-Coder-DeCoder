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
        self._collab = None  # Set by main.py when --collab is passed
        if not (self._root / ".git").exists():
            raise ValueError(f"Not a git repository: {self._root}")
        # Clean up any leftover TeX preview temp directories from previous runs
        self._cleanup_tex_preview_dir()

    @property
    def root(self):
        return self._root

    def _check_localhost_only(self):
        """Return error dict if caller is a non-localhost remote, else None."""
        if self._collab and not self._collab._is_caller_localhost():
            return {"error": "restricted", "reason": "Participants cannot perform this action"}
        return None

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
                    result = subprocess.run(
                        ["git", "-C", str(self._root), "show", f"{version}:{path}"],
                        capture_output=True, text=True, check=False, timeout=30,
                    )
                    if result.returncode != 0:
                        return {"content": "", "error": f"File not in {version}"}
                    return {"content": result.stdout}
                except subprocess.TimeoutExpired:
                    return {"content": "", "error": "Git command timed out"}
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
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        try:
            resolved = self._resolve_path(path)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content)
            return {"success": True}
        except ValueError as e:
            return {"error": str(e)}

    def create_file(self, path, content):
        """Create new file. Errors if file exists."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
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

    def get_file_base64(self, path):
        """Read a file and return its content as a base64 data URI.

        Used by the SVG viewer to resolve relative image references
        (e.g. <image xlink:href="slide_img1.jpg"/>) that cannot be
        loaded directly by the browser since the webapp origin differs
        from the repo filesystem.

        Returns dict with 'data_uri' or 'error'.
        """
        import base64
        import mimetypes
        try:
            resolved = self._resolve_path(path)
            if not resolved.exists():
                return {"error": "File not found"}
            # Read binary content
            data = resolved.read_bytes()
            # Determine MIME type
            mime, _ = mimetypes.guess_type(str(resolved))
            if not mime:
                # Fallback based on common image extensions
                ext = resolved.suffix.lower()
                mime_map = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.svg': 'image/svg+xml',
                    '.bmp': 'image/bmp',
                    '.ico': 'image/x-icon',
                    '.tiff': 'image/tiff',
                    '.tif': 'image/tiff',
                }
                mime = mime_map.get(ext, 'application/octet-stream')
            b64 = base64.b64encode(data).decode('ascii')
            return {"data_uri": f"data:{mime};base64,{b64}"}
        except ValueError as e:
            return {"error": str(e)}
        except OSError as e:
            return {"error": str(e)}

    # === TeX Preview ===

    @staticmethod
    def is_make4ht_available():
        """Check if make4ht (TeX4ht) is installed for TeX preview."""
        import shutil
        return shutil.which("make4ht") is not None

    def compile_tex_preview(self, content, file_path=None):
        """Compile TeX content to HTML using make4ht.

        Writes content to a temp .tex file, runs make4ht, reads the
        resulting .html file, and returns it.

        Args:
            content: TeX source text
            file_path: optional repo-relative path (used for resolving
                       \\input/\\include and images relative to the file)

        Returns:
            {html: str} or {error: str, log: str?}
        """
        import shutil
        import tempfile

        if not shutil.which("make4ht"):
            return {
                "error": "make4ht is not installed",
                "install_hint": (
                    "Install with:\n"
                    "  Ubuntu/Debian: sudo apt install texlive-extra-utils\n"
                    "  macOS: brew install --cask mactex\n"
                    "  Windows: install TeX Live from https://tug.org/texlive/"
                ),
            }

        if not content or not content.strip():
            return {"html": ""}

        # Determine working directory — use the file's directory so that
        # \input, \include, \includegraphics resolve relative paths.
        work_dir = None
        if file_path:
            try:
                resolved = self._resolve_path(file_path)
                work_dir = str(resolved.parent)
            except (ValueError, OSError):
                pass
        if not work_dir:
            work_dir = str(self._root)

        # Create temp directory for make4ht output inside .ac-dc/
        # (repo-scoped, already gitignored, no cross-repo collision)
        ac_dc_dir = os.path.join(str(self._root), ".ac-dc", "tex_preview")
        os.makedirs(ac_dc_dir, exist_ok=True)
        tmp_dir = tempfile.mkdtemp(prefix="tex_", dir=ac_dc_dir)
        tex_path = os.path.join(tmp_dir, "preview.tex")
        html_path = os.path.join(tmp_dir, "preview.html")

        # Write a make4ht config file that forces mathjax-compatible
        # output for math environments.  The "mathjax" option tells
        # TeX4ht to emit raw LaTeX math delimiters (\(...\) and
        # \[...\]) instead of converting equations to SVG/PNG images.
        # The frontend renders these with KaTeX (already loaded).
        cfg_path = os.path.join(tmp_dir, "preview.cfg")
        try:
            with open(cfg_path, "w", encoding="utf-8") as f:
                f.write(
                    "\\Preamble{xhtml,mathjax}\n"
                    "\\begin{document}\n"
                    "\\EndPreamble\n"
                )
        except OSError:
            pass  # proceed without config — will use default (image) math

        try:
            # Write TeX source — prepend \nonstopmode so the TeX engine
            # never pauses for user input on errors (which would hang
            # the subprocess until the timeout expires).
            with open(tex_path, "w", encoding="utf-8") as f:
                if '\\documentclass' in content:
                    content = content.replace(
                        '\\documentclass',
                        '\\nonstopmode\n\\documentclass',
                        1,
                    )
                else:
                    content = '\\nonstopmode\n' + content
                f.write(content)

            # Run make4ht with HTML5 output + mathjax math rendering
            # -f html5: HTML5 output format
            # -d tmp_dir: output directory (final HTML)
            # -a debug: reduced logging
            # -c preview.cfg: use our config for mathjax math output
            #
            # CRITICAL: cwd must be tmp_dir so ALL intermediate files
            # (.aux, .dvi, .4ct, .4tc, .idv, .lg, .tmp, .xref, .log, .css)
            # go into the temp directory — not the user's repo.
            # The -d flag only controls the final HTML output location,
            # not where make4ht/TeX writes intermediates.
            #
            # For \input/\includegraphics resolution we set TEXINPUTS
            # to include the file's original directory.
            env = os.environ.copy()
            # TEXINPUTS: search order is file_dir, then system defaults
            # The trailing colon/semicolon means "append system defaults"
            texinputs_sep = ";" if os.name == "nt" else ":"
            env["TEXINPUTS"] = work_dir + texinputs_sep
            try:
                result = subprocess.run(
                    [
                        "make4ht",
                        "-f", "html5",
                        "-d", tmp_dir,
                        "-a", "debug",
                        "-c", cfg_path,
                        tex_path,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=tmp_dir,
                    env=env,
                    stdin=subprocess.DEVNULL,
                )
            except subprocess.TimeoutExpired:
                return {"error": "TeX compilation timed out (30s limit)"}
            except FileNotFoundError:
                return {
                    "error": "make4ht not found",
                    "install_hint": "sudo apt install texlive-extra-utils",
                }

            # Read HTML output
            if os.path.exists(html_path):
                with open(html_path, "r", encoding="utf-8") as f:
                    html_content = f.read()

                # Extract just the <body> content — make4ht produces a
                # full HTML document; we only need the body for the
                # preview pane.
                html_content = self._extract_body(html_content)

                # Resolve relative image/CSS paths in the HTML to point
                # to the temp directory (for any generated images)
                html_content = self._resolve_tex_assets(
                    html_content, tmp_dir
                )

                # Clean up make4ht math output artifacts.
                # With the mathjax option, make4ht may emit both
                # delimited math AND a plain-text alt fallback.
                # Remove known alt-text patterns.
                html_content = self._clean_mathjax_output(
                    html_content
                )

                return {"html": html_content}
            else:
                # Compilation failed — return log
                log = result.stderr or result.stdout or "Unknown error"
                # Try to find .log file
                log_path = os.path.join(tmp_dir, "preview.log")
                if os.path.exists(log_path):
                    try:
                        with open(log_path, "r", encoding="utf-8",
                                  errors="replace") as f:
                            log = f.read()
                    except OSError:
                        pass
                return {
                    "error": "TeX compilation failed",
                    "log": log[-3000:],  # last 3000 chars of log
                }

        except Exception as e:
            return {"error": f"TeX preview failed: {e}"}

        finally:
            # Clean up temp directory — but keep it briefly so images
            # can be served.  We use a background cleanup approach:
            # store the path and clean it up on the next compilation.
            self._cleanup_old_tex_preview()
            self._last_tex_preview_dir = tmp_dir

    def _cleanup_old_tex_preview(self):
        """Clean up the previous TeX preview temp directory."""
        import shutil as _shutil
        old_dir = getattr(self, "_last_tex_preview_dir", None)
        if old_dir and os.path.isdir(old_dir):
            try:
                _shutil.rmtree(old_dir, ignore_errors=True)
            except OSError:
                pass

    def _cleanup_tex_preview_dir(self):
        """Remove the entire .ac-dc/tex_preview/ directory.

        Called on startup to clean up leftover temp dirs from previous
        server runs that may not have been cleaned up (e.g. crash).
        """
        import shutil as _shutil
        tex_dir = os.path.join(str(self._root), ".ac-dc", "tex_preview")
        if os.path.isdir(tex_dir):
            try:
                _shutil.rmtree(tex_dir, ignore_errors=True)
                logger.debug(f"Cleaned up TeX preview directory: {tex_dir}")
            except OSError:
                pass

    @staticmethod
    def _extract_body(html_text):
        """Extract body content and inline <head> styles from make4ht output.

        make4ht generates a full HTML document. We need the <body> content
        plus any <style> or <link rel="stylesheet"> from <head> so that
        math and layout CSS is preserved.
        """
        parts = []

        # Extract <style> blocks from <head>
        head_end = html_text.find("</head>")
        if head_end == -1:
            head_end = html_text.find("<body")
        head_section = html_text[:head_end] if head_end != -1 else ""

        # Collect inline <style> blocks
        import re as _re
        for style_match in _re.finditer(
            r'<style[^>]*>(.*?)</style>', head_section, _re.DOTALL
        ):
            parts.append(f"<style>{style_match.group(1)}</style>")

        # Collect <link rel="stylesheet"> (will be resolved by _resolve_tex_assets)
        for link_match in _re.finditer(
            r'<link[^>]+rel="stylesheet"[^>]*/?>',
            head_section, _re.DOTALL
        ):
            parts.append(link_match.group(0))

        # Extract <body> content
        body_start = html_text.find("<body")
        if body_start == -1:
            parts.append(html_text)
        else:
            tag_end = html_text.find(">", body_start)
            if tag_end == -1:
                parts.append(html_text)
            else:
                body_end = html_text.find("</body>", tag_end)
                if body_end == -1:
                    parts.append(html_text[tag_end + 1:])
                else:
                    parts.append(html_text[tag_end + 1:body_end])

        return "\n".join(parts)

    @staticmethod
    def _clean_mathjax_output(html_content):
        """Clean up make4ht mathjax-mode output.

        make4ht with the mathjax option emits BOTH the math-delimited
        version (\\(...\\), \\[...\\]) AND a plain-text alt-text fallback
        for each equation.  The alt-text appears as:

        - <span class="MathJax_Preview">plain text</span>
        - <script type="math/tex">...</script>
        - Bare text nodes adjacent to the math delimiters containing the
          flattened equation (e.g. "hm+1 = filter(am, bm, hm)")
        - <td class="eq-no"> with equation numbers

        We strip all alt-text artifacts so only the delimited math remains
        for the browser-side KaTeX renderer.
        """
        # Remove MathJax preview spans (make4ht inserts these as fallbacks)
        html_content = re.sub(
            r'<span\s+class="MathJax_Preview"[^>]*>.*?</span>',
            '', html_content, flags=re.DOTALL,
        )

        # Remove <script type="math/tex"> blocks (another mathjax fallback)
        html_content = re.sub(
            r'<script\s+type="math/tex[^"]*"[^>]*>.*?</script>',
            '', html_content, flags=re.DOTALL,
        )

        # Remove alt-text that make4ht puts inside <table> equation wrappers
        # alongside the real math delimiters.  Pattern: a <td> containing
        # only raw TeX-like text (no math delimiters) next to a <td> with
        # the real equation.
        html_content = re.sub(
            r'<td\s+class="eq-no"[^>]*>\s*\(\d+\)\s*</td>',
            '', html_content,
        )

        # Remove inline alt-text: make4ht emits a plain-text version of
        # each inline math expression immediately after the \(...\)
        # delimiters.  The pattern is:
        #   \(tex\)PLAIN_TEXT
        # where PLAIN_TEXT is the flattened rendering (no TeX commands).
        # We detect this by looking for text between \) and the next HTML
        # tag that contains math-like characters (digits, operators,
        # parentheses, subscripts rendered as plain letters).
        html_content = re.sub(
            r'(\\\))\s*([A-Za-z0-9,()+=\-−. ]{2,}?)(?=\s*(?:<|\\[(\[$]))',
            r'\1',
            html_content,
        )

        # Remove display alt-text: make4ht emits a plain-text version
        # after display math \[...\] and \begin{equation}...\end{equation}.
        # Pattern: bare text after \] or \end{...} before the next tag.
        html_content = re.sub(
            r'(\\\])\s*([^<\\]{2,}?)(?=\s*<)',
            r'\1',
            html_content,
        )
        html_content = re.sub(
            r'(\\end\{[^}]+\})\s*([^<\\]{2,}?)(?=\s*<)',
            r'\1',
            html_content,
        )

        return html_content

    @staticmethod
    def _resolve_tex_assets(html_content, tmp_dir):
        """Convert relative asset paths in make4ht output to data URIs.

        make4ht may generate SVG/PNG images for complex math or TikZ
        figures.  We convert them to inline data URIs so they display
        in the preview pane without needing a file server.

        Also handles:
        - src="..." attributes (img tags)
        - url(...) in inline CSS (background images)
        - href="..." for CSS stylesheets generated by make4ht
        """
        import base64
        import mimetypes

        def _asset_to_data_uri(filename):
            """Convert a filename in tmp_dir to a data URI, or None."""
            # Try exact path first
            asset_path = os.path.join(tmp_dir, filename)
            if not os.path.exists(asset_path):
                # Try just the basename (make4ht sometimes uses flat names)
                asset_path = os.path.join(tmp_dir, os.path.basename(filename))
            if not os.path.exists(asset_path):
                return None
            try:
                data = open(asset_path, "rb").read()
                mime, _ = mimetypes.guess_type(asset_path)
                if not mime:
                    ext = os.path.splitext(filename)[1].lower()
                    mime_map = {
                        ".svg": "image/svg+xml",
                        ".png": "image/png",
                        ".jpg": "image/jpeg",
                        ".jpeg": "image/jpeg",
                        ".gif": "image/gif",
                        ".css": "text/css",
                    }
                    mime = mime_map.get(ext, "application/octet-stream")
                b64 = base64.b64encode(data).decode("ascii")
                return f"data:{mime};base64,{b64}"
            except OSError:
                return None

        def _replace_src(match):
            src = match.group(1)
            if src.startswith(("http://", "https://", "data:", "//")):
                return match.group(0)
            data_uri = _asset_to_data_uri(src)
            if data_uri:
                return f'src="{data_uri}"'
            return match.group(0)

        def _replace_css_url(match):
            url = match.group(1)
            if url.startswith(("http://", "https://", "data:", "//")):
                return match.group(0)
            data_uri = _asset_to_data_uri(url)
            if data_uri:
                return f'url({data_uri})'
            return match.group(0)

        # Replace src="..." attributes
        html_content = re.sub(
            r'src="([^"]*)"', _replace_src, html_content
        )

        # Replace url(...) in inline styles
        html_content = re.sub(
            r'url\(([^)]+)\)', _replace_css_url, html_content
        )

        # Inline <link rel="stylesheet"> references to make4ht CSS
        def _inline_css_link(match):
            href = match.group(1)
            if href.startswith(("http://", "https://", "data:")):
                return match.group(0)
            css_path = os.path.join(tmp_dir, href)
            if not os.path.exists(css_path):
                css_path = os.path.join(tmp_dir, os.path.basename(href))
            if os.path.exists(css_path):
                try:
                    css_text = open(css_path, "r", encoding="utf-8").read()
                    return f"<style>{css_text}</style>"
                except OSError:
                    pass
            return match.group(0)

        html_content = re.sub(
            r'<link[^>]+href="([^"]*\.css)"[^>]*/?>',
            _inline_css_link, html_content
        )

        return html_content

    def delete_file(self, path):
        """Remove file from filesystem."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
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
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        try:
            self._run_git("add", "--", *paths)
            return {"success": True}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def unstage_files(self, paths):
        """Remove from staging area."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        try:
            self._run_git("reset", "HEAD", "--", *paths)
            return {"success": True}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def discard_changes(self, paths):
        """Tracked: restore from HEAD. Untracked: delete."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
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
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        self._run_git("add", "-A")
        return {"success": True}

    # === Rename/Move ===

    def rename_file(self, old_path, new_path):
        """Rename file. git mv for tracked, filesystem for untracked."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
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

    def get_diff_to_branch(self, branch):
        """Get diff between working tree and another branch.

        Uses two-dot diff (`git diff <branch>`) which compares the branch
        tip directly against the current working tree.  This includes both
        committed changes on the current branch *and* any uncommitted edits
        on disk — i.e. everything the user would see if they were to create
        a PR/MR right now including unsaved work.

        Args:
            branch: branch name (local or remote, e.g. 'main', 'origin/main')

        Returns:
            {diff: str} or {error: str}
        """
        if not branch or not branch.strip():
            return {"error": "No branch specified"}
        try:
            # Verify the ref exists
            self._run_git("rev-parse", "--verify", branch)
            # Two-dot diff: branch tip vs working tree (includes uncommitted changes)
            diff = self._run_git("diff", branch)
            return {"diff": diff}
        except subprocess.CalledProcessError as e:
            return {"error": f"Cannot diff against {branch}: {e.stderr if hasattr(e, 'stderr') else str(e)}"}

    def list_all_branches(self):
        """List all branches (local and remote) for branch selection UI.

        Returns list of {name, sha, is_current, is_remote} dicts,
        sorted with local branches first, then remotes.
        """
        try:
            output = self._run_git(
                "branch", "-a", "--sort=-committerdate",
                "--format=%(refname:short)|%(objectname:short)|%(HEAD)|%(refname)"
            )
            branches = []
            seen_names = set()
            for line in output.strip().splitlines():
                if not line:
                    continue
                parts = line.split("|", 3)
                if len(parts) < 3:
                    continue
                name = parts[0].strip()
                sha = parts[1].strip()
                is_current = parts[2].strip() == "*"
                refname = parts[3].strip() if len(parts) > 3 else ""

                # Skip HEAD pointers and symbolic refs
                if name in ("HEAD", "origin/HEAD"):
                    continue
                if " -> " in name or " -> " in refname:
                    continue

                # Deduplicate (remote may duplicate local)
                if name in seen_names:
                    continue
                seen_names.add(name)

                is_remote = "/" in name and name.split("/")[0] not in (".", "..")

                branches.append({
                    "name": name,
                    "sha": sha,
                    "is_current": is_current,
                    "is_remote": is_remote,
                })

            # Sort: current first, then local, then remote
            branches.sort(key=lambda b: (
                not b["is_current"],
                b["is_remote"],
                b["name"].lower(),
            ))
            return branches
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def commit(self, message):
        """Create commit."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        try:
            self._run_git("commit", "-m", message)
            sha = self._run_git("rev-parse", "HEAD").strip()
            return {"success": True, "sha": sha}
        except subprocess.CalledProcessError as e:
            return {"error": str(e)}

    def reset_hard(self):
        """Reset to HEAD."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
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
            deleted = []
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
                # Renames: porcelain format is "old -> new"; track the new path
                # Paths with special chars may be individually quoted
                if index_status == "R" and " -> " in filepath:
                    rename_parts = filepath.split(" -> ", 1)
                    old_part = rename_parts[0].strip()
                    new_part = rename_parts[1].strip()
                    if old_part.startswith('"') and old_part.endswith('"'):
                        old_part = old_part[1:-1]
                    if new_part.startswith('"') and new_part.endswith('"'):
                        new_part = new_part[1:-1]
                    staged.append(new_part)
                    staged.append(old_part)
                elif index_status in ("M", "A", "D", "R"):
                    staged.append(filepath)
                if work_status == "M":
                    modified.append(filepath)
                elif work_status == "D":
                    deleted.append(filepath)

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
                "deleted": deleted,
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
        """Get merge base SHA.

        Tries ref2 first, then falls back to 'main', then 'master'.
        """
        candidates = []
        if ref2 is not None:
            candidates.append(ref2)
        candidates.extend(["main", "master"])

        last_error = None
        for candidate in candidates:
            try:
                output = self._run_git("merge-base", ref1, candidate)
                return {"sha": output.strip()}
            except subprocess.CalledProcessError as e:
                last_error = e
                continue

        return {"error": str(last_error)}

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
        """Check out the merge-base of the review range for diff setup.

        Computes the merge-base between the original branch (typically
        master/main) and the branch tip.  This matches GitLab/GitHub MR
        diff semantics: the diff shows only changes the feature branch
        introduced, excluding changes that arrived via merge commits
        from the target branch.

        Steps: record original branch, resolve branch tip, compute
        merge-base, checkout branch, checkout merge-base.
        """
        try:
            current = self.get_current_branch()
            original_branch = current.get("branch") or current.get("sha", "")

            branch_tip = self.resolve_ref(branch)
            if not branch_tip:
                return {"error": f"Cannot resolve ref: {branch}"}

            # Compute merge-base between the original branch and the
            # branch tip.  This is the point where the feature branch
            # diverged, matching GitLab MR diff behaviour.
            merge_base_result = self.get_merge_base(branch_tip, original_branch)
            if "error" in merge_base_result:
                # Fallback: use parent of base_commit (old behaviour)
                logger.warning(
                    f"merge-base failed ({merge_base_result['error']}), "
                    f"falling back to parent of {base_commit}"
                )
                parent_result = self.get_commit_parent(base_commit)
                if "error" in parent_result:
                    return {"error": f"Cannot get parent of {base_commit}: {parent_result['error']}"}
                parent_commit = parent_result["sha"]
            else:
                parent_commit = merge_base_result["sha"]

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
                return {"error": f"Cannot checkout merge-base {parent_commit[:7]}: {e.stderr}"}

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

