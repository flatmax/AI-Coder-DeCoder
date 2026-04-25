"""Edit pipeline — validate and apply parsed edit blocks.

Takes a sequence of :class:`~ac_dc.edit_protocol.EditBlock`
instances and turns them into :class:`EditResult` records by:

1. Validating anchors against current file content
2. Applying successful edits to disk via the :class:`Repo` layer
3. Marking not-in-context edits without attempting application
4. Staging modified files in git

Governing specs:

- ``specs4/3-llm/edit-protocol.md`` — status codes, error types,
  not-in-context handling, concurrent invocation contract
- ``specs3/3-llm-engine/edit_protocol.md`` — concrete anchor
  matching semantics, whitespace diagnostics, sequential
  application rules

## Design Decisions Pinned Here

- **Pure validation + coordination.** The pipeline owns the logic
  for "does this anchor match exactly once, what does the new
  file content look like, was it already applied?" It delegates
  actual disk I/O and git staging to :class:`Repo`, whose
  per-path mutex (D10) makes the apply step safe to invoke
  concurrently across different file batches.

- **Not-in-context is a workflow signal, not a failure.** The LLM
  writing an edit for an unselected file means it guessed the
  old-text from the symbol map alone — unreliable. We mark the
  edit ``NOT_IN_CONTEXT``, don't attempt application, and return
  the file path so the streaming handler can auto-add it to
  selection. Create blocks (empty old-text) bypass this check —
  there's no anchor to guess at.

- **Already-applied detection.** Before reporting an anchor
  failure, check whether the new text is already present. Lets
  users re-run a prompt without flooding the UI with spurious
  errors when the edits already landed. Uses substring search on
  the full new_text — conservative but correct.

- **Sequential application within a batch.** Edits are applied in
  list order. Each edit sees the file state produced by earlier
  edits in the same batch. This matches specs3's sequential
  contract and is what the LLM expects — the system prompt
  tells it to merge adjacent edits rather than emit overlapping
  ones, so sequential application is the right model.

- **Re-entrant across batches.** The pipeline is safe to call
  concurrently for different batches of edits. Per-file
  serialization happens in Repo's write mutex; the pipeline
  itself holds no mutable state between invocations. In
  single-agent operation this is never exercised; the contract
  exists so a future parallel-agent mode (specs4/7-future)
  doesn't need to refactor.

- **Result shape mirrors frontend expectations.** The
  :class:`EditResult` dataclass has exactly the fields the
  streaming handler puts into the ``edit_results`` array of
  ``streamComplete``. Keeps the serialization boundary thin —
  the streaming handler dumps dataclass fields verbatim.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ac_dc.edit_protocol import (
    EditBlock,
    EditErrorType,
    EditResult,
    EditStatus,
)

if TYPE_CHECKING:
    from ac_dc.repo import Repo

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Preview length for failed-edit diagnostics shown in the UI. Long
# enough to identify the content being edited, short enough that a
# huge file doesn't dominate the result payload.
_PREVIEW_CHARS = 200


# ---------------------------------------------------------------------------
# ApplyReport — aggregate outcome of a pipeline invocation
# ---------------------------------------------------------------------------


@dataclass
class ApplyReport:
    """Aggregated outcome of one ``apply_edits`` invocation.

    Mirrors the shape the streaming handler puts into the
    ``streamComplete`` event. Per-block details are in
    ``results``; the count fields are convenience aggregates.

    The ``files_modified`` and ``files_auto_added`` lists are
    order-preserving (first-seen) with duplicates removed —
    matches what the frontend expects for the "files changed"
    and "files auto-added" message banners.
    """

    results: list[EditResult] = field(default_factory=list)
    files_modified: list[str] = field(default_factory=list)
    files_auto_added: list[str] = field(default_factory=list)

    # Aggregate counts. Named fields rather than a dict so the
    # streaming handler can access them as attributes (and so a
    # typo in a key at dispatch time is a test failure, not a
    # silent None).
    passed: int = 0
    already_applied: int = 0
    failed: int = 0
    skipped: int = 0
    not_in_context: int = 0


# ---------------------------------------------------------------------------
# Anchor validation
# ---------------------------------------------------------------------------


@dataclass
class _AnchorMatch:
    """Internal result of anchor matching.

    Three outcomes:

    - ``position`` is an int → unique match at that character
      offset. Apply proceeds.
    - ``position`` is None and ``error_type`` is set → failure.
      ``message`` carries the human-readable diagnostic.
    - Multiple matches → ``error_type`` is ``ambiguous_anchor``,
      ``count`` has the match count.
    """

    position: int | None = None
    error_type: str = ""
    message: str = ""
    count: int = 0


def _find_anchor(content: str, anchor: str) -> _AnchorMatch:
    """Locate a unique occurrence of ``anchor`` in ``content``.

    Returns an :class:`_AnchorMatch`. Zero matches produce
    ``anchor_not_found``; multiple matches produce
    ``ambiguous_anchor`` with the count so the UI can suggest
    "include more context lines".

    When zero matches occur, the diagnostic message suggests the
    most likely cause (whitespace mismatch, partial match) based
    on cheap heuristics — specs3 calls these out explicitly.
    """
    # Empty anchor = file creation, handled separately by the
    # caller. If it reaches here it's a logic bug; return a
    # positional match at zero rather than scanning for the
    # empty string (which matches everywhere).
    if not anchor:
        return _AnchorMatch(position=0, count=1)

    # Count occurrences. For short files this is O(n*m) per
    # str.count / str.find — acceptable; edit files are not
    # gigabyte-scale.
    count = content.count(anchor)

    if count == 1:
        return _AnchorMatch(
            position=content.find(anchor), count=1
        )

    if count > 1:
        return _AnchorMatch(
            position=None,
            error_type=EditErrorType.AMBIGUOUS_ANCHOR.value,
            message=(
                f"Ambiguous anchor: matches {count} locations. "
                "Include more surrounding context lines for a "
                "unique match."
            ),
            count=count,
        )

    # Zero matches — build a diagnostic. Try to identify the
    # most likely cause.
    return _AnchorMatch(
        position=None,
        error_type=EditErrorType.ANCHOR_NOT_FOUND.value,
        message=_diagnose_missing_anchor(content, anchor),
        count=0,
    )


def _diagnose_missing_anchor(content: str, anchor: str) -> str:
    """Produce a specific message for a missing-anchor failure.

    Heuristics:

    - Whitespace mismatch — anchor found when whitespace is
      normalised but not when compared exactly. Tabs-vs-spaces
      or trailing-whitespace are the common causes.
    - Partial match — the anchor's first line appears but later
      lines don't line up.
    - Generic — old text not found.

    The heuristics are cheap and may fire false-positively; the
    diagnostic is advisory and the user / LLM should still verify
    by re-reading the file.
    """
    # Whitespace normalisation check. If the anchor matches after
    # collapsing all runs of whitespace in both strings, the cause
    # is almost certainly tabs-vs-spaces or trailing whitespace.
    normalized_content = _normalize_whitespace(content)
    normalized_anchor = _normalize_whitespace(anchor)
    if normalized_anchor and normalized_anchor in normalized_content:
        return (
            "Old text not found — whitespace mismatch likely. "
            "Check for tabs vs spaces or trailing whitespace."
        )

    # Partial match — first line of anchor appears in file but
    # subsequent lines don't match at the same position.
    first_line = anchor.split("\n", 1)[0]
    if first_line and content.count(first_line) > 0:
        return (
            "Old text not found — first line matches but "
            "subsequent lines differ. Re-read the file and "
            "copy the exact current content. Don't rely on chat history."
        )

    return (
        "Old text not found in file. Re-read the file content "
        "from context and copy the exact text. Don't rely on chat history."
    )


def _normalize_whitespace(text: str) -> str:
    """Collapse all whitespace runs to single spaces.

    Used by the whitespace-mismatch diagnostic. A cheap
    equivalence check — doesn't attempt to be perfect, just
    good enough to catch the common tabs-vs-spaces case.
    """
    # str.split() with no argument splits on any whitespace and
    # drops empty strings — equivalent to collapsing runs.
    return " ".join(text.split())


# ---------------------------------------------------------------------------
# EditPipeline
# ---------------------------------------------------------------------------


class EditPipeline:
    """Validate and apply edit blocks against a repository.

    Stateless across invocations — construct with a Repo
    reference, call :meth:`apply_edits` with a list of blocks
    and a set of in-context files. Returns an
    :class:`ApplyReport`.

    Thread-safety — the pipeline holds no mutable state between
    calls, and Repo's per-path mutex handles concurrent file
    writes. Safe to invoke from multiple threads for different
    edit-block batches.
    """

    def __init__(self, repo: "Repo") -> None:
        """Construct with a Repo reference.

        Parameters
        ----------
        repo:
            The repository to apply edits against. Must be
            fully-constructed; the pipeline calls its async
            methods (``write_file``, ``create_file``,
            ``get_file_content``, ``stage_files``).
        """
        self._repo = repo

    async def apply_edits(
        self,
        blocks: list[EditBlock],
        in_context_files: set[str],
        *,
        dry_run: bool = False,
    ) -> ApplyReport:
        """Apply a batch of edit blocks.

        Parameters
        ----------
        blocks:
            Parsed edit blocks, in the order the LLM emitted
            them. Applied sequentially; later edits see the
            file state produced by earlier edits.
        in_context_files:
            Set of repo-relative paths currently in active
            context (selected files). Edits targeting files
            outside this set are marked ``NOT_IN_CONTEXT``
            without application attempt. Create blocks bypass
            the check — there's no existing content to guess at.
        dry_run:
            When True, validate every block and produce a
            report but don't write to disk. Results use
            ``VALIDATED`` status instead of ``APPLIED``. Used
            by a future "preview edits" RPC surface.

        Returns
        -------
        ApplyReport
            Per-block results and aggregate counts.
        """
        report = ApplyReport()

        # Track which files we've auto-added and which we've
        # modified. Order-preserving, deduped.
        modified_seen: set[str] = set()
        auto_added_seen: set[str] = set()

        for block in blocks:
            result = await self._apply_one(
                block,
                in_context_files,
                dry_run=dry_run,
            )
            report.results.append(result)

            # Update aggregate counts.
            if result.status == EditStatus.APPLIED:
                report.passed += 1
                if result.file_path not in modified_seen:
                    modified_seen.add(result.file_path)
                    report.files_modified.append(result.file_path)
            elif result.status == EditStatus.ALREADY_APPLIED:
                report.already_applied += 1
            elif result.status == EditStatus.VALIDATED:
                # Dry-run success doesn't count toward
                # passed/failed — it's its own thing.
                pass
            elif result.status == EditStatus.FAILED:
                report.failed += 1
            elif result.status == EditStatus.SKIPPED:
                report.skipped += 1
            elif result.status == EditStatus.NOT_IN_CONTEXT:
                report.not_in_context += 1
                if result.file_path not in auto_added_seen:
                    auto_added_seen.add(result.file_path)
                    report.files_auto_added.append(result.file_path)

        # Stage modified files in one batch if anything was
        # written. Doing this after the per-block loop batches
        # git operations; per-file staging would multiply
        # subprocess overhead.
        if report.files_modified and not dry_run:
            try:
                self._repo.stage_files(report.files_modified)
            except Exception as exc:
                # Staging failure doesn't invalidate the applied
                # edits — files are on disk. Log and continue;
                # the user can stage manually if needed.
                logger.warning(
                    "Failed to stage modified files: %s", exc
                )

        return report

    # ------------------------------------------------------------------
    # Per-block application
    # ------------------------------------------------------------------

    async def _apply_one(
        self,
        block: EditBlock,
        in_context_files: set[str],
        *,
        dry_run: bool,
    ) -> EditResult:
        """Apply a single edit block and return its result.

        Dispatch logic:

        1. Create block (empty old-text) → ``_apply_create``
        2. Not-in-context file → ``NOT_IN_CONTEXT`` marker
        3. In-context file → ``_apply_modify``
        """
        if block.is_create:
            return await self._apply_create(block, dry_run=dry_run)

        if block.file_path not in in_context_files:
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.NOT_IN_CONTEXT,
                message=(
                    "File is not in active context. Added to "
                    "selection for retry on next request."
                ),
                old_preview=_preview(block.old_text),
                new_preview=_preview(block.new_text),
            )

        return await self._apply_modify(block, dry_run=dry_run)

    async def _apply_create(
        self,
        block: EditBlock,
        *,
        dry_run: bool,
    ) -> EditResult:
        """Apply a create block — empty old-text, new file."""
        # Pre-flight: does the file already exist?
        if self._repo.file_exists(block.file_path):
            # Check whether it already has the target content.
            # If so, already_applied; else this is a conflict
            # the LLM should have caught (it generated a create
            # block for an existing file).
            try:
                existing = self._repo.get_file_content(
                    block.file_path
                )
            except Exception as exc:
                # Binary file or other read error — treat as
                # a validation failure rather than trying to
                # overwrite.
                return EditResult(
                    file_path=block.file_path,
                    status=EditStatus.SKIPPED,
                    message=str(exc),
                    error_type=(
                        EditErrorType.VALIDATION_ERROR.value
                    ),
                    new_preview=_preview(block.new_text),
                )
            if existing.rstrip("\n") == block.new_text.rstrip("\n"):
                return EditResult(
                    file_path=block.file_path,
                    status=EditStatus.ALREADY_APPLIED,
                    message="File already has the target content.",
                    new_preview=_preview(block.new_text),
                )
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.FAILED,
                message=(
                    "Cannot create: file already exists with "
                    "different content."
                ),
                error_type=EditErrorType.VALIDATION_ERROR.value,
                old_preview=_preview(existing),
                new_preview=_preview(block.new_text),
            )

        if dry_run:
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.VALIDATED,
                message="Would create file.",
                new_preview=_preview(block.new_text),
            )

        # Create the file.
        try:
            await self._repo.create_file(
                block.file_path, block.new_text
            )
        except Exception as exc:
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.FAILED,
                message=f"Failed to create file: {exc}",
                error_type=EditErrorType.WRITE_ERROR.value,
                new_preview=_preview(block.new_text),
            )

        return EditResult(
            file_path=block.file_path,
            status=EditStatus.APPLIED,
            message="File created.",
            new_preview=_preview(block.new_text),
        )

    async def _apply_modify(
        self,
        block: EditBlock,
        *,
        dry_run: bool,
    ) -> EditResult:
        """Apply a modify block — non-empty old-text, existing file."""
        # Pre-flight: read the current file content.
        try:
            content = self._repo.get_file_content(block.file_path)
        except Exception as exc:
            # Binary file, missing file, path traversal — all
            # surface here. Classify as file_not_found for
            # missing; validation_error for binary/traversal
            # (the RepoError message distinguishes them).
            msg = str(exc).lower()
            if "not found" in msg or "missing" in msg:
                error_type = EditErrorType.FILE_NOT_FOUND.value
                status = EditStatus.FAILED
            else:
                # Binary or traversal — skipped, not failed.
                error_type = EditErrorType.VALIDATION_ERROR.value
                status = EditStatus.SKIPPED
            return EditResult(
                file_path=block.file_path,
                status=status,
                message=str(exc),
                error_type=error_type,
                old_preview=_preview(block.old_text),
                new_preview=_preview(block.new_text),
            )

        # Validate the anchor.
        match = _find_anchor(content, block.old_text)
        if match.position is None:
            # Before reporting failure, check whether the new
            # text is already present — lets re-runs be idempotent.
            if _is_already_applied(content, block):
                return EditResult(
                    file_path=block.file_path,
                    status=EditStatus.ALREADY_APPLIED,
                    message=(
                        "New content already present in file."
                    ),
                    old_preview=_preview(block.old_text),
                    new_preview=_preview(block.new_text),
                )
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.FAILED,
                message=match.message,
                error_type=match.error_type,
                old_preview=_preview(block.old_text),
                new_preview=_preview(block.new_text),
            )

        # Build the new content. Single-replacement via slicing —
        # str.replace(old, new, 1) would also work but slicing
        # makes the intent explicit and handles edge cases (old
        # text containing regex-special chars) without special
        # handling.
        start = match.position
        end = start + len(block.old_text)
        new_content = content[:start] + block.new_text + content[end:]

        if dry_run:
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.VALIDATED,
                message="Edit would apply cleanly.",
                old_preview=_preview(block.old_text),
                new_preview=_preview(block.new_text),
            )

        # Write the new content.
        try:
            await self._repo.write_file(
                block.file_path, new_content
            )
        except Exception as exc:
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.FAILED,
                message=f"Failed to write file: {exc}",
                error_type=EditErrorType.WRITE_ERROR.value,
                old_preview=_preview(block.old_text),
                new_preview=_preview(block.new_text),
            )

        return EditResult(
            file_path=block.file_path,
            status=EditStatus.APPLIED,
            message="Edit applied.",
            old_preview=_preview(block.old_text),
            new_preview=_preview(block.new_text),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_already_applied(content: str, block: EditBlock) -> bool:
    """Check whether ``block``'s new text is already in ``content``.

    Conservative — uses substring search on the full new_text.
    False positives are possible if new_text happens to be a
    substring of unrelated code, but that's rare in practice
    (edit blocks contain enough context to be distinctive).

    A create block with empty old-text never reaches this helper
    — the create path has its own already-applied check.
    """
    if not block.new_text:
        return False
    return block.new_text in content


def _preview(text: str, limit: int = _PREVIEW_CHARS) -> str:
    """Truncate ``text`` for inclusion in an EditResult.

    Keeps result payloads small so the ``streamComplete`` event
    doesn't balloon with large file contents when many edits
    fail. Trailing ellipsis indicates truncation.
    """
    if len(text) <= limit:
        return text
    return text[:limit] + "..."