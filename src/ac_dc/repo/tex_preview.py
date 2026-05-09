"""TeX preview mixin for the repository layer.

Hosts make4ht-based LaTeX → HTML compilation for the diff viewer's
live preview pane. Split out of ``repo.py`` so the preview-specific
helpers (asset inlining, MathJax artifact stripping, package
availability probes) live next to the compile entry point rather
than mixed in with the git operations.

The availability probes are class-level so the frontend can show or
hide the Preview button at session start without paying the cost of
a failed compile. ``compile_tex_preview`` itself is instance-level —
it depends on ``self._root`` for the ``.ac-dc/tex_preview/`` workspace
and on ``self._validate_rel_path`` for resolving ``file_path``.
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


class TexPreviewMixin:
    """make4ht-based TeX → HTML compilation for live preview.

    The availability probes are class-level so the frontend can
    show or hide the Preview button at session start without
    waiting for a compile attempt to fail. The compile method
    itself is instance-level — it needs ``self._root`` and
    ``self._validate_rel_path``.
    """

    _root: Path

    # Cached result of the tex4ht.sty package probe. ``None`` means
    # "not yet probed"; True / False mean the probe ran and the
    # package was / wasn't found. Cached at class level because
    # the answer doesn't change during a session — TeX package
    # installation is out-of-band of AC-DC.
    _tex4ht_package_cached: "bool | None" = None

    def _validate_rel_path(self, path: str | Path) -> Path: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # External tool availability
    # ------------------------------------------------------------------

    @staticmethod
    def is_make4ht_available() -> bool:
        """Return True when ``make4ht`` is on PATH.

        Layer 5's TeX preview feature needs make4ht for LaTeX →
        HTML compilation. We expose only the availability check at
        Layer 1 — the actual compile path lives with the preview
        UI, which is where the temp-directory management and
        asset-inlining logic belong. Having the probe here means
        the browser can show or hide the preview toggle immediately
        on file open without waiting for a compile attempt to fail.

        Uses :func:`shutil.which` which resolves the binary name
        against PATH using the platform's conventions (PATHEXT on
        Windows). Returns a bool, never raises — missing tools
        are an expected runtime condition, not an error.
        """
        return shutil.which("make4ht") is not None

    def is_tex_preview_available(self) -> dict[str, Any]:
        """Combined probe for the TeX preview feature.

        The frontend calls this once per session to decide whether
        to enable the Preview button on ``.tex`` files. It combines
        :meth:`is_make4ht_available` (binary on PATH) and
        :meth:`is_tex4ht_package_available` (``tex4ht.sty`` resolvable
        by ``kpsewhich``) because make4ht without the tex4ht package
        produces a confusing mid-compile error rather than a clean
        "not installed" signal.

        Returns
        -------
        dict
            ``{"available": True}`` when both pieces are present.
            ``{"available": False, "install_hint": "..."}`` when
            something's missing; the hint names the specific
            missing piece so the user knows what to install.
            The frontend renders ``install_hint`` verbatim.

        Notes
        -----
        This is a read-only probe — no localhost gate. Participants
        in a collaboration session see the same Preview button
        availability as the host, even though only the host can
        trigger a compile.
        """
        if not self.is_make4ht_available():
            return {
                "available": False,
                "install_hint": (
                    "make4ht is not on PATH. Install TeX Live "
                    "(texlive-full on Debian/Ubuntu, or the "
                    "texlive-plain-generic package for a smaller "
                    "footprint) or MiKTeX on Windows."
                ),
            }
        if not self.is_tex4ht_package_available():
            return {
                "available": False,
                "install_hint": (
                    "make4ht is installed but the tex4ht package "
                    "(tex4ht.sty) is missing. On Debian/Ubuntu: "
                    "sudo apt install texlive-plain-generic. "
                    "On other TeX Live installs, use tlmgr "
                    "install tex4ht."
                ),
            }
        return {"available": True}

    @classmethod
    def is_tex4ht_package_available(cls) -> bool:
        """Return True when the ``tex4ht.sty`` package is installed.

        ``make4ht`` is only the driver — it needs ``tex4ht.sty``
        from the TeX Live ``texlive-plain-generic`` package (on
        Debian / Ubuntu) to actually transform documents. Users
        with make4ht on PATH but no tex4ht package see an
        obscure LaTeX error mid-compile ("File `tex4ht.sty' not
        found"). This probe surfaces the missing package up-front
        so the preview UI can show a targeted install hint.

        Implementation uses ``kpsewhich tex4ht.sty`` — the
        standard TeX Live tool for locating installed packages.
        Exits non-zero when the file isn't on the TEXMF search
        path; we treat that as "missing" along with any
        subprocess failure (kpsewhich not installed, timeout,
        etc). Result is cached class-side so the subprocess
        cost is paid at most once per Python process.

        Never raises.
        """
        if cls._tex4ht_package_cached is not None:
            return cls._tex4ht_package_cached
        # kpsewhich ships with every TeX Live install; if it's
        # missing, tex4ht.sty can't be there either.
        if shutil.which("kpsewhich") is None:
            cls._tex4ht_package_cached = False
            return False
        try:
            result = subprocess.run(
                ["kpsewhich", "tex4ht.sty"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            # Exit 0 AND non-empty stdout means the file was
            # resolved. Exit 0 with empty output shouldn't happen
            # for kpsewhich but guard defensively.
            found = (
                result.returncode == 0
                and bool(result.stdout.strip())
            )
        except (subprocess.TimeoutExpired, OSError):
            # Subprocess blew up for reasons unrelated to
            # whether the package exists. Treat as missing —
            # the user will see the install hint, which is
            # the actionable path either way.
            found = False
        cls._tex4ht_package_cached = found
        return found

    # ------------------------------------------------------------------
    # TeX preview compilation
    # ------------------------------------------------------------------

    _TEX_PREVIEW_TIMEOUT = 30  # seconds

    def compile_tex_preview(
        self,
        content: str,
        file_path: str | None = None,
    ) -> dict[str, str]:
        """Compile TeX source to HTML via make4ht for live preview.

        Writes the source to a temp file, runs ``make4ht -f html5``
        with a mathjax config, extracts the ``<body>`` content plus
        ``<head>`` styles, inlines assets as data URIs, and strips
        make4ht alt-text artifacts.

        Parameters
        ----------
        content:
            The TeX source text. ``\\nonstopmode`` is prepended
            before ``\\documentclass`` so the TeX engine never
            pauses for user input on errors.
        file_path:
            Optional repo-relative path to the source file. When
            provided, ``TEXINPUTS`` is set to the file's parent
            directory so ``\\input``/``\\includegraphics`` resolve
            relative paths correctly.

        Returns
        -------
        dict
            ``{"html": "<compiled HTML>"}`` on success.
            ``{"error": "<message>", "log"?: "<make4ht log>",
            "install_hint"?: "<install instructions>"}`` on failure.
        """
        if not self.is_make4ht_available():
            return {
                "error": "make4ht is not installed",
                "install_hint": (
                    "Install TeX Live or MiKTeX with make4ht. "
                    "On Ubuntu: sudo apt install texlive-full"
                ),
            }

        import re
        import tempfile

        # Determine TEXINPUTS from the source file's directory
        # so \input and \includegraphics resolve correctly.
        texinputs = ""
        if file_path:
            try:
                abs_file = self._validate_rel_path(file_path)
                texinputs = str(abs_file.parent) + os.sep
            except Exception:
                pass

        # Create a temp directory under .ac-dc/tex_preview/.
        # Previous compilation's temp dir is cleaned up first.
        ac_dc_dir = self._root / ".ac-dc"
        tex_preview_dir = ac_dc_dir / "tex_preview"
        self._cleanup_tex_preview_dir(tex_preview_dir)
        tex_preview_dir.mkdir(parents=True, exist_ok=True)

        tmp_dir = Path(tempfile.mkdtemp(dir=str(tex_preview_dir)))

        try:
            # Prepend \nonstopmode before \documentclass so TeX
            # never pauses for user input on errors.
            modified_content = content
            dc_match = re.search(
                r"\\documentclass", modified_content
            )
            if dc_match:
                modified_content = (
                    modified_content[:dc_match.start()]
                    + "\\nonstopmode\n"
                    + modified_content[dc_match.start():]
                )
            else:
                modified_content = "\\nonstopmode\n" + modified_content

            # Write the TeX source to a temp file.
            tex_file = tmp_dir / "preview.tex"
            tex_file.write_text(modified_content, encoding="utf-8")

            # Write a custom .cfg file for mathjax output.
            cfg_file = tmp_dir / "preview.cfg"
            cfg_file.write_text(
                "\\Preamble{xhtml,mathjax}\n"
                "\\begin{document}\n"
                "\\EndPreamble\n",
                encoding="utf-8",
            )

            # Build the environment with TEXINPUTS.
            #
            # Critical: TEXINPUTS must end with an OS path
            # separator (``:`` on Unix, ``;`` on Windows) so
            # the TeX engine APPENDS its default search paths
            # rather than REPLACING them. Without the trailing
            # separator, setting TEXINPUTS to a single directory
            # means htlatex searches only that directory and
            # fails to find system packages like ``tex4ht.sty``,
            # producing a mid-compile "File `tex4ht.sty' not
            # found" error even when kpsewhich resolves the
            # file correctly from a shell.
            #
            # The trailing separator appears in both branches:
            # when ``existing`` is set, the value is
            # ``"${texinputs}:${existing}:"``; when empty, it's
            # just ``"${texinputs}:"``. Either way, the TeX
            # engine appends its defaults after our explicit
            # paths.
            env = dict(os.environ)
            if texinputs:
                existing = env.get("TEXINPUTS", "")
                if existing:
                    env["TEXINPUTS"] = (
                        texinputs + os.pathsep + existing
                        + os.pathsep
                    )
                else:
                    env["TEXINPUTS"] = texinputs + os.pathsep

            # Run make4ht. Working directory is the temp dir so
            # all intermediate files stay contained.
            result = subprocess.run(
                [
                    "make4ht",
                    "-f", "html5",
                    "-c", str(cfg_file),
                    "-d", str(tmp_dir),
                    str(tex_file),
                ],
                cwd=str(tmp_dir),
                capture_output=True,
                text=True,
                timeout=self._TEX_PREVIEW_TIMEOUT,
                env=env,
                stdin=subprocess.DEVNULL,
            )

            # Find the output HTML file.
            html_file = tmp_dir / "preview.html"
            if not html_file.exists():
                # Try any .html file in the temp dir.
                html_files = list(tmp_dir.glob("*.html"))
                if html_files:
                    html_file = html_files[0]

            if not html_file.exists():
                log_text = result.stdout + "\n" + result.stderr
                return {
                    "error": "make4ht produced no HTML output",
                    "log": log_text[-2000:],  # last 2KB
                }

            html_text = html_file.read_text(
                encoding="utf-8", errors="replace"
            )

            # Extract <body> content.
            body_match = re.search(
                r"<body[^>]*>(.*)</body>",
                html_text,
                re.DOTALL | re.IGNORECASE,
            )
            body = body_match.group(1) if body_match else html_text

            # Extract <head> styles.
            head_styles = ""
            for style_match in re.finditer(
                r"<style[^>]*>.*?</style>",
                html_text,
                re.DOTALL | re.IGNORECASE,
            ):
                head_styles += style_match.group(0) + "\n"

            # Inline assets (images, CSS) as data URIs.
            body = self._resolve_tex_assets(body, tmp_dir)
            head_styles = self._resolve_tex_assets(
                head_styles, tmp_dir
            )

            # Inline linked stylesheets.
            for link_match in re.finditer(
                r'<link\s+rel=["\']stylesheet["\']\s+'
                r'href=["\']([^"\']+)["\'][^>]*/?>',
                html_text,
                re.IGNORECASE,
            ):
                href = link_match.group(1)
                css_path = tmp_dir / href
                if css_path.exists():
                    try:
                        css_text = css_path.read_text(
                            encoding="utf-8", errors="replace"
                        )
                        css_text = self._resolve_tex_assets(
                            css_text, tmp_dir
                        )
                        head_styles += f"<style>{css_text}</style>\n"
                    except Exception:
                        pass

            # Strip make4ht alt-text artifacts.
            body = self._clean_mathjax_output(body)

            # Combine styles + body.
            final_html = head_styles + body

            return {"html": final_html}

        except subprocess.TimeoutExpired:
            return {
                "error": (
                    f"TeX compilation timed out after "
                    f"{self._TEX_PREVIEW_TIMEOUT}s"
                ),
            }
        except Exception as exc:
            return {"error": f"TeX compilation failed: {exc}"}

    @staticmethod
    def _cleanup_tex_preview_dir(tex_preview_dir: Path) -> None:
        """Remove previous compilation's temp directories.

        Called before each new compilation and on server startup.
        Keeps at most zero temp dirs alive (the new one is created
        after this call).
        """
        if not tex_preview_dir.exists():
            return
        for child in tex_preview_dir.iterdir():
            if child.is_dir():
                try:
                    shutil.rmtree(child, ignore_errors=True)
                except Exception:
                    pass

    @staticmethod
    def _resolve_tex_assets(html: str, base_dir: Path) -> str:
        """Replace relative src/url() references with data URIs.

        Handles:
        - ``src="..."`` on img tags
        - ``url(...)`` in CSS
        """
        import re

        from .paths import PathMixin

        def _inline_file(match: re.Match) -> str:
            """Replace a matched path with a data URI."""
            prefix = match.group(1)
            path_str = match.group(2)
            suffix = match.group(3)
            file_path = base_dir / path_str
            if not file_path.exists():
                return match.group(0)
            try:
                mime = PathMixin._detect_mime(file_path)
                data = base64.b64encode(
                    file_path.read_bytes()
                ).decode("ascii")
                return f'{prefix}data:{mime};base64,{data}{suffix}'
            except Exception:
                return match.group(0)

        # src="..." attributes
        html = re.sub(
            r'(src=["\'])([^"\']+)(["\'])',
            _inline_file,
            html,
        )

        # url(...) in CSS
        html = re.sub(
            r"(url\(['\"]?)([^)'\"\s]+)(['\"]?\))",
            _inline_file,
            html,
        )

        return html

    @staticmethod
    def _clean_mathjax_output(html: str) -> str:
        """Strip make4ht alt-text artifacts from HTML.

        make4ht emits plain-text fallback spans alongside
        delimited math. These show as duplicate text when
        KaTeX renders the math client-side.
        """
        import re

        # Remove <span class="MathJax_Preview"> elements.
        html = re.sub(
            r'<span\s+class=["\']MathJax_Preview["\'][^>]*>.*?</span>',
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )

        # Remove <script type="math/tex"> blocks.
        html = re.sub(
            r'<script\s+type=["\']math/tex["\'][^>]*>.*?</script>',
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )

        # Remove <td class="eq-no"> equation number cells.
        html = re.sub(
            r'<td\s+class=["\']eq-no["\'][^>]*>.*?</td>',
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )

        return html