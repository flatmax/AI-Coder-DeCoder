"""Centralised git subprocess invocation.

Every git call in the repository layer goes through ``_run_git``.
Centralisation gives us one place to set the working directory,
the timeout, the encoding, and the FileNotFoundError → RepoError
translation for missing git binaries.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from .errors import GIT_TIMEOUT_SECONDS, RepoError


class SubprocessMixin:
    """git subprocess wrapper.

    Mixed into :class:`Repo`. Reads ``self._root``.
    """

    _root: Path

    def _run_git(
        self,
        args: list[str],
        *,
        text: bool = True,
        check: bool = False,
        timeout: float = GIT_TIMEOUT_SECONDS,
        input_data: str | bytes | None = None,
    ) -> subprocess.CompletedProcess:
        """Run a ``git`` subprocess rooted in this repository.

        Centralises subprocess invocation so every git call gets the
        same working directory, timeout, and encoding. Callers decide
        whether to treat a non-zero exit as an error (``check=True``
        raises :class:`RepoError` with the stderr contents) or to
        inspect the result themselves — most callers inspect, because
        git's exit codes carry information (``grep`` returns 1 for
        "no matches found", which isn't an error).

        Parameters
        ----------
        args:
            Arguments to pass to git (excluding the ``git`` binary
            itself).
        text:
            When True, stdout and stderr are decoded as UTF-8 strings.
            When False, raw bytes are returned — needed for
            ``git show`` on files that may contain arbitrary bytes.
        check:
            When True, non-zero exit raises :class:`RepoError`.
        timeout:
            Seconds before the subprocess is killed and
            :class:`RepoError` raised. Defaults to
            :data:`GIT_TIMEOUT_SECONDS`.
        input_data:
            Optional stdin payload. Must match ``text`` — pass ``str``
            for text mode, ``bytes`` for binary mode.

        Returns
        -------
        subprocess.CompletedProcess
            The result object. ``stdout`` and ``stderr`` are strings
            when ``text=True``, bytes otherwise.

        Raises
        ------
        RepoError
            If git isn't installed, the subprocess times out, or
            ``check=True`` and git exits non-zero.
        """
        cmd = ["git", *args]
        # When ``text=True``, capture as bytes and decode
        # ourselves with ``errors="replace"`` rather than
        # letting subprocess.run do strict UTF-8 decoding.
        # Git output can contain non-UTF-8 bytes in
        # legitimate cases — ``git diff --cached`` on a
        # repo that stages a binary file (PDF, image,
        # compiled artefact) emits the binary delta as
        # raw bytes inline with the textual diff headers.
        # Strict decoding crashes the whole call; lossy
        # decoding preserves the textual portions and
        # leaves replacement chars where the binary
        # bytes were, which is exactly what the commit-
        # message generator and diff viewer want.
        run_input: str | bytes | None = input_data
        if text and isinstance(input_data, str):
            run_input = input_data.encode("utf-8", errors="replace")
        try:
            result = subprocess.run(
                cmd,
                cwd=self._root,
                capture_output=True,
                text=False,
                timeout=timeout,
                input=run_input,
                check=False,
            )
        except FileNotFoundError as exc:
            # The ``git`` binary isn't on PATH. This is fatal for the
            # repo layer — we can't function without it. Bubble up so
            # the CLI can print a clear install message.
            raise RepoError(
                "git binary not found on PATH; install git to continue"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RepoError(
                f"git {' '.join(args)!r} timed out after {timeout}s"
            ) from exc

        # Decode to strings when the caller asked for text
        # mode. Lossy decode so binary bytes embedded in
        # otherwise-textual git output (notably ``git diff
        # --cached`` on staged binary files) survive as
        # replacement chars instead of raising.
        if text:
            stdout_decoded = result.stdout.decode(
                "utf-8", errors="replace",
            )
            stderr_decoded = result.stderr.decode(
                "utf-8", errors="replace",
            )
            result = subprocess.CompletedProcess(
                args=result.args,
                returncode=result.returncode,
                stdout=stdout_decoded,
                stderr=stderr_decoded,
            )

        if check and result.returncode != 0:
            stderr = result.stderr
            if isinstance(stderr, bytes):
                stderr = stderr.decode("utf-8", errors="replace")
            raise RepoError(
                f"git {' '.join(args)!r} failed "
                f"(exit {result.returncode}): {stderr.strip() or 'unknown error'}"
            )

        return result