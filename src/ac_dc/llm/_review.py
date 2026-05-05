"""Review-mode helpers extracted from :mod:`ac_dc.llm_service`.

Review mode presents a feature branch's changes as staged
modifications via git soft reset. The file picker, diff
viewer, and context engine all work unchanged — edits are
disabled (read-only contract), the system prompt swaps to
a review-focused variant, and a pre-change symbol map is
injected so the LLM can compare pre- and post-change
codebase topology.

Governing spec: :doc:`specs4/4-features/code-review`.

Every function takes the :class:`LLMService` as first
argument and reads/writes attributes on it. This keeps the
service module smaller without changing the shape of the
state graph — review state is still session-scoped and
main-conversation-only per spec.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService
    from ac_dc.llm._types import ConversationScope

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Readiness + graph queries
# ---------------------------------------------------------------------------


def check_review_ready(service: "LLMService") -> dict[str, Any]:
    """Return whether the working tree is clean enough for review."""
    if service._repo is None:
        return {
            "clean": False,
            "message": "No repository attached.",
        }
    if service._repo.is_clean():
        return {"clean": True}
    return {
        "clean": False,
        "message": (
            "Working tree has uncommitted changes. "
            "Commit, stash, or discard them before entering "
            "review mode."
        ),
    }


def get_commit_graph(
    service: "LLMService",
    limit: int = 100,
    offset: int = 0,
    include_remote: bool = False,
) -> dict[str, Any]:
    """Thin delegation to the repo."""
    if service._repo is None:
        return {"commits": [], "branches": [], "has_more": False}
    return service._repo.get_commit_graph(
        limit=limit,
        offset=offset,
        include_remote=include_remote,
    )


# ---------------------------------------------------------------------------
# Entry / exit
# ---------------------------------------------------------------------------


def start_review(
    service: "LLMService",
    branch: str,
    base_commit: str,
) -> dict[str, Any]:
    """Enter review mode for ``branch`` starting at ``base_commit``.

    Runs the full entry sequence — clean-tree check, parent
    checkout, pre-change symbol map, soft reset, metadata
    gather, symbol-index rebuild, prompt swap, selection
    clear, state update, system event.

    On any failure, attempts to roll back via
    :meth:`Repo.exit_review_mode` and returns an error dict.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._repo is None:
        return {"error": "No repository attached."}
    if service._review_active:
        return {
            "error": (
                "Review mode is already active. Exit the "
                "current review first."
            )
        }

    # Step 1 — clean tree.
    clean = check_review_ready(service)
    if not clean["clean"]:
        return {"error": clean.get("message", "Tree not clean")}

    # Step 2 — checkout review parent (merge-base).
    parent_result = service._repo.checkout_review_parent(
        branch, base_commit
    )
    if "error" in parent_result:
        return {"error": parent_result["error"]}

    branch_tip = parent_result["branch_tip"]
    parent_commit = parent_result["parent_commit"]
    original_branch = parent_result["original_branch"]

    # Step 3 — build pre-change symbol map. Disk is at the
    # merge-base, so indexing now captures the pre-change
    # state. Best-effort: if the symbol index isn't
    # attached (tests without it, or deferred init not
    # yet complete), skip this and proceed with an empty
    # pre-change map.
    pre_change_symbol_map = ""
    if service._symbol_index is not None:
        try:
            file_list = service._repo.get_flat_file_list().split("\n")
            file_list = [f for f in file_list if f]
            service._symbol_index.index_repo(file_list)
            pre_change_symbol_map = (
                service._symbol_index.get_symbol_map()
            )
        except Exception as exc:
            logger.warning(
                "Pre-change symbol map build failed: %s", exc
            )

    # Step 4 — setup soft reset. Disk moves to branch tip,
    # HEAD stays at merge-base, all changes appear staged.
    reset_result = service._repo.setup_review_soft_reset(
        branch_tip, parent_commit
    )
    if "error" in reset_result:
        service._repo.exit_review_mode(
            branch_tip, original_branch
        )
        return {"error": reset_result["error"]}

    # Step 5 — gather commits, changed files, stats.
    try:
        commits = service._repo.get_commit_log(
            base=parent_commit,
            head=branch_tip,
            limit=100,
        )
        changed_files = service._repo.get_review_changed_files()
        stats = _compute_review_stats(commits, changed_files)
    except Exception as exc:
        logger.exception(
            "Failed to gather review metadata: %s", exc
        )
        service._repo.exit_review_mode(
            branch_tip, original_branch
        )
        return {"error": f"Review setup failed: {exc}"}

    # Step 6 — rebuild symbol index against post-change
    # disk. Best-effort — same as step 3.
    if service._symbol_index is not None:
        try:
            file_list = service._repo.get_flat_file_list().split("\n")
            file_list = [f for f in file_list if f]
            service._symbol_index.index_repo(file_list)
        except Exception as exc:
            logger.warning(
                "Post-change symbol index rebuild failed: %s",
                exc,
            )

    # Step 7 — swap system prompt.
    review_prompt = service._config.get_review_prompt()
    service._context.save_and_replace_system_prompt(review_prompt)

    # Step 8 — clear file selection.
    service._selected_files = []
    service._file_context.clear()
    service._broadcast_event("filesChanged", [])

    # Store review state.
    service._review_state = {
        "active": True,
        "branch": branch,
        "branch_tip": branch_tip,
        "base_commit": base_commit,
        "parent_commit": parent_commit,
        "original_branch": original_branch,
        "commits": commits,
        "changed_files": changed_files,
        "stats": stats,
        "pre_change_symbol_map": pre_change_symbol_map,
    }
    service._review_active = True

    # Broadcast review state to all clients.
    service._broadcast_event(
        "reviewStarted", get_review_state(service)
    )

    # Step 9 — system event.
    event_text = (
        f"Entered review mode for `{branch}` "
        f"({len(commits)} commits, "
        f"{stats.get('files_changed', 0)} files changed)."
    )
    service._context.add_message(
        "user", event_text, system_event=True
    )
    if service._history_store is not None:
        service._history_store.append_message(
            session_id=service._session_id,
            role="user",
            content=event_text,
            system_event=True,
        )

    return {
        "status": "review_active",
        "branch": branch,
        "base_commit": base_commit,
        "commits": commits,
        "changed_files": changed_files,
        "stats": stats,
    }


def end_review(service: "LLMService") -> dict[str, Any]:
    """Exit review mode, restoring the pre-review git state."""
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if not service._review_active:
        return {"error": "Review mode is not active."}
    if service._repo is None:
        return {"error": "No repository attached."}

    branch_tip = service._review_state["branch_tip"]
    original_branch = service._review_state["original_branch"]

    # Step 1 — exit at the repo level.
    exit_result = service._repo.exit_review_mode(
        branch_tip, original_branch
    )
    exit_error = exit_result.get("error")

    # Step 2 — rebuild symbol index. Best-effort even on
    # partial failure.
    if service._symbol_index is not None:
        try:
            file_list = service._repo.get_flat_file_list().split("\n")
            file_list = [f for f in file_list if f]
            service._symbol_index.index_repo(file_list)
        except Exception as exc:
            logger.warning(
                "Symbol index rebuild after review failed: %s",
                exc,
            )

    # Step 3 — restore system prompt.
    service._context.restore_system_prompt()

    # Step 4 — clear review state regardless of repo-level
    # success.
    service._review_state = {
        "active": False,
        "branch": None,
        "branch_tip": None,
        "base_commit": None,
        "parent_commit": None,
        "original_branch": None,
        "commits": [],
        "changed_files": [],
        "stats": {},
        "pre_change_symbol_map": "",
    }
    service._review_active = False
    service._context.clear_review_context()

    service._broadcast_event(
        "reviewEnded", get_review_state(service)
    )

    # Step 5 — system event.
    if exit_error:
        event_text = (
            f"Exited review mode with issues: {exit_error}"
        )
    else:
        event_text = "Exited review mode."
    service._context.add_message(
        "user", event_text, system_event=True
    )
    if service._history_store is not None:
        service._history_store.append_message(
            session_id=service._session_id,
            role="user",
            content=event_text,
            system_event=True,
        )

    if exit_error:
        return {"error": exit_error, "status": "partial"}
    return {"status": "restored"}


# ---------------------------------------------------------------------------
# State snapshot + per-file diff
# ---------------------------------------------------------------------------


def get_review_state(service: "LLMService") -> dict[str, Any]:
    """Return a copy of the current review state.

    ``pre_change_symbol_map`` is excluded from the returned
    dict because it can be large and isn't needed by the
    frontend — it's consumed server-side when assembling the
    review context for LLM requests.
    """
    state = dict(service._review_state)
    state.pop("pre_change_symbol_map", None)
    state["commits"] = list(state.get("commits") or [])
    state["changed_files"] = list(state.get("changed_files") or [])
    state["stats"] = dict(state.get("stats") or {})
    return state


def get_review_file_diff(
    service: "LLMService", path: str
) -> dict[str, Any]:
    """Return the reverse diff for a single file during review."""
    if not service._review_active:
        return {"error": "Review mode is not active."}
    if service._repo is None:
        return {"error": "No repository attached."}
    try:
        return service._repo.get_review_file_diff(path)
    except Exception as exc:
        return {"error": str(exc)}


def _compute_review_stats(
    commits: list[dict[str, Any]],
    changed_files: list[dict[str, Any]],
) -> dict[str, int]:
    """Compute aggregate stats for the review state."""
    additions = sum(
        int(f.get("additions", 0) or 0) for f in changed_files
    )
    deletions = sum(
        int(f.get("deletions", 0) or 0) for f in changed_files
    )
    return {
        "commit_count": len(commits),
        "files_changed": len(changed_files),
        "additions": additions,
        "deletions": deletions,
    }


# ---------------------------------------------------------------------------
# Per-request review context assembly
# ---------------------------------------------------------------------------


def build_and_set_review_context(
    service: "LLMService",
    scope: "ConversationScope | None" = None,
) -> None:
    """Build the review context block and attach to context manager.

    Called from ``_stream_chat`` on every request during
    review mode. Rebuilds from scratch so the reverse-diff
    set reflects the CURRENT file selection.

    Review mode is main-conversation-only per
    :doc:`specs4/4-features/code-review` § "Limitations —
    No Concurrent Editing". The scope argument is threaded
    for consistency with the surrounding refactor; in practice
    :attr:`service._review_active` is always True when this
    is called.
    """
    if scope is None:
        scope = service._default_scope()
    state = service._review_state
    if not state.get("active") or service._repo is None:
        return

    parts: list[str] = []

    # 1. Summary block.
    branch = state.get("branch") or "(unknown)"
    parent = (state.get("parent_commit") or "")[:7]
    tip = (state.get("branch_tip") or "")[:7]
    stats = state.get("stats") or {}
    commit_count = stats.get("commit_count", 0)
    files_changed = stats.get("files_changed", 0)
    additions = stats.get("additions", 0)
    deletions = stats.get("deletions", 0)
    summary_line = (
        f"## Review: {branch} (merge-base {parent} → {tip})\n"
        f"{commit_count} commits, "
        f"{files_changed} files changed, "
        f"+{additions} -{deletions}"
    )
    parts.append(summary_line)

    # 2. Commits list.
    commits = state.get("commits") or []
    if commits:
        commit_lines = ["## Commits"]
        for i, commit in enumerate(commits, start=1):
            short = commit.get("short_sha") or (
                (commit.get("sha") or "")[:7]
            )
            msg = (
                (commit.get("message") or "")
                .split("\n", 1)[0]
            )
            author = commit.get("author") or "?"
            date = (
                commit.get("relative_date")
                or commit.get("date")
                or ""
            )
            commit_lines.append(
                f"{i}. {short} {msg} ({author}, {date})"
            )
        parts.append("\n".join(commit_lines))

    # 3. Pre-change symbol map.
    pre_map = state.get("pre_change_symbol_map") or ""
    if pre_map:
        parts.append(
            "## Pre-Change Symbol Map\n"
            "Symbol map from the parent commit (before the "
            "reviewed changes). Compare against the current "
            "symbol map in the repository structure above.\n\n"
            + pre_map
        )

    # 4. Reverse diffs for every selected file that's also
    # in the review's changed-files set.
    changed_files_entries = state.get("changed_files") or []
    changed_paths = {
        f.get("path"): f for f in changed_files_entries
        if f.get("path")
    }
    diff_blocks: list[str] = []
    for path in scope.selected_files:
        if path not in changed_paths:
            continue
        try:
            diff_result = service._repo.get_review_file_diff(path)
        except Exception as exc:
            logger.debug(
                "Review diff fetch failed for %s: %s",
                path, exc,
            )
            continue
        diff_text = diff_result.get("diff") or ""
        if not diff_text:
            continue
        entry = changed_paths[path]
        add_ct = entry.get("additions", 0)
        del_ct = entry.get("deletions", 0)
        diff_blocks.append(
            f"### {path} (+{add_ct} -{del_ct})\n"
            "```diff\n"
            f"{diff_text}"
            "\n```"
        )
    if diff_blocks:
        parts.append(
            "## Reverse Diffs (selected files)\n"
            "These diffs show what would revert each file "
            "to the pre-review state. The full current "
            "content is in the working files above.\n\n"
            + "\n\n".join(diff_blocks)
        )

    review_text = "\n\n".join(parts)
    scope.context.set_review_context(review_text)