"""File tree and flat listing — porcelain-driven tree build."""

from __future__ import annotations

from ac_dc.repo import Repo

from .conftest import _run_git


class TestFileTree:
    """get_flat_file_list and get_file_tree — porcelain-driven tree build."""

    def test_get_flat_file_list_empty_repo_returns_empty_string(
        self, repo: Repo
    ) -> None:
        """Fresh repo with no files returns the empty string.

        Prompt assembly just concatenates this into the file-tree
        section; an empty string is the cleanest representation of
        "there are no files yet".
        """
        assert repo.get_flat_file_list() == ""

    def test_get_flat_file_list_tracked_files_appear_sorted(
        self, repo: Repo
    ) -> None:
        """Tracked files come back one per line, sorted alphabetically."""
        (repo.root / "b.md").write_text("b", encoding="utf-8")
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        (repo.root / "c.md").write_text("c", encoding="utf-8")
        _run_git(repo.root, "add", "a.md", "b.md", "c.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.get_flat_file_list() == "a.md\nb.md\nc.md"

    def test_get_flat_file_list_includes_untracked(self, repo: Repo) -> None:
        """Untracked, non-ignored files are listed alongside tracked."""
        (repo.root / "tracked.md").write_text("t", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "new.md").write_text("n", encoding="utf-8")
        lines = repo.get_flat_file_list().splitlines()
        assert "tracked.md" in lines
        assert "new.md" in lines

    def test_get_flat_file_list_respects_gitignore(self, repo: Repo) -> None:
        """Ignored files never appear in the flat list."""
        (repo.root / ".gitignore").write_text("*.log\n", encoding="utf-8")
        _run_git(repo.root, "add", ".gitignore")
        _run_git(repo.root, "commit", "-q", "-m", "add gitignore")
        (repo.root / "debug.log").write_text("noise", encoding="utf-8")
        (repo.root / "keep.md").write_text("keep", encoding="utf-8")
        lines = repo.get_flat_file_list().splitlines()
        assert "debug.log" not in lines
        assert "keep.md" in lines
        assert ".gitignore" in lines

    def test_get_flat_file_list_dedups_tracked_and_untracked_sets(
        self, repo: Repo
    ) -> None:
        """Files that appear in both tracked and untracked sets are deduped.

        Edge case: ``ls-files --others`` can surface tracked files
        during some index states. The method unions the two sets
        rather than concatenating, so no duplicates slip through.
        """
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        lines = repo.get_flat_file_list().splitlines()
        assert lines.count("a.md") == 1

    def test_get_file_tree_returns_documented_shape(self, repo: Repo) -> None:
        """Result has the six documented keys with correct types."""
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.get_file_tree()
        assert set(result.keys()) == {
            "tree",
            "modified",
            "staged",
            "untracked",
            "deleted",
            "diff_stats",
        }
        assert isinstance(result["tree"], dict)
        assert isinstance(result["modified"], list)
        assert isinstance(result["staged"], list)
        assert isinstance(result["untracked"], list)
        assert isinstance(result["deleted"], list)
        assert isinstance(result["diff_stats"], dict)

    def test_get_file_tree_root_matches_repo_name(self, repo: Repo) -> None:
        """The tree root's name matches the repo directory basename.

        The file picker uses this as the display label at the top of
        the tree. Fixture creates the repo at ``tmp_path / "repo"``
        so the basename is ``"repo"``.
        """
        root = repo.get_file_tree()["tree"]
        assert root["name"] == repo.name
        assert root["path"] == ""
        assert root["type"] == "dir"

    def test_get_file_tree_empty_repo_has_no_children(self, repo: Repo) -> None:
        """Fresh repo's tree root has an empty children list.

        All four status arrays are empty too. Confirms the method
        handles the no-files-yet case without crashing on empty
        porcelain output.
        """
        result = repo.get_file_tree()
        assert result["tree"]["children"] == []
        assert result["modified"] == []
        assert result["staged"] == []
        assert result["untracked"] == []
        assert result["deleted"] == []
        assert result["diff_stats"] == {}

    def test_get_file_tree_single_file(self, repo: Repo) -> None:
        """A single tracked file appears as one child of the root."""
        (repo.root / "readme.md").write_text(
            "hello\nworld\n", encoding="utf-8"
        )
        _run_git(repo.root, "add", "readme.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        assert len(root["children"]) == 1
        child = root["children"][0]
        assert child["name"] == "readme.md"
        assert child["path"] == "readme.md"
        assert child["type"] == "file"
        # Two lines, both newline-terminated → 2 newlines counted.
        assert child["lines"] == 2
        # mtime is populated for files.
        assert "mtime" in child
        assert isinstance(child["mtime"], float)
        assert child["mtime"] > 0

    def test_get_file_tree_creates_directory_nodes(self, repo: Repo) -> None:
        """Files inside nested directories create intermediate dir nodes.

        Verifies ``src/utils/helpers.py`` produces:
          root → src/ → utils/ → helpers.py
        """
        (repo.root / "src" / "utils").mkdir(parents=True)
        (repo.root / "src" / "utils" / "helpers.py").write_text(
            "def foo():\n    pass\n", encoding="utf-8"
        )
        _run_git(repo.root, "add", "src/utils/helpers.py")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        # src/
        assert len(root["children"]) == 1
        src_node = root["children"][0]
        assert src_node["name"] == "src"
        assert src_node["path"] == "src"
        assert src_node["type"] == "dir"
        # Directory line counts are 0.
        assert src_node["lines"] == 0
        # utils/
        assert len(src_node["children"]) == 1
        utils_node = src_node["children"][0]
        assert utils_node["name"] == "utils"
        assert utils_node["path"] == "src/utils"
        assert utils_node["type"] == "dir"
        # helpers.py
        assert len(utils_node["children"]) == 1
        file_node = utils_node["children"][0]
        assert file_node["name"] == "helpers.py"
        assert file_node["path"] == "src/utils/helpers.py"
        assert file_node["type"] == "file"
        assert file_node["lines"] == 2

    def test_get_file_tree_sorts_dirs_before_files(self, repo: Repo) -> None:
        """Directories sort before files within each level, alphabetical within type.

        File-picker UI expectation — dirs bubble to the top so users
        can navigate down the tree without hunting past files first.
        Within each type (dir/file) the order is alphabetical.
        """
        # Name the file "aaa.md" and the dir "zzz" — alphabetically
        # the file would come first, but our sort must put the dir
        # first regardless.
        (repo.root / "aaa.md").write_text("file", encoding="utf-8")
        (repo.root / "zzz").mkdir()
        (repo.root / "zzz" / "inner.md").write_text("x", encoding="utf-8")
        _run_git(repo.root, "add", "aaa.md", "zzz/inner.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        children = root["children"]
        assert len(children) == 2
        # Dir comes first.
        assert children[0]["name"] == "zzz"
        assert children[0]["type"] == "dir"
        # File comes second.
        assert children[1]["name"] == "aaa.md"
        assert children[1]["type"] == "file"

    def test_get_file_tree_sorts_within_type_alphabetically(
        self, repo: Repo
    ) -> None:
        """Within dirs or within files, entries sort alphabetically."""
        (repo.root / "banana.md").write_text("b", encoding="utf-8")
        (repo.root / "apple.md").write_text("a", encoding="utf-8")
        (repo.root / "cherry.md").write_text("c", encoding="utf-8")
        _run_git(repo.root, "add", "apple.md", "banana.md", "cherry.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        names = [c["name"] for c in root["children"]]
        assert names == ["apple.md", "banana.md", "cherry.md"]

    def test_get_file_tree_binary_file_has_zero_lines(self, repo: Repo) -> None:
        """Binary files report lines: 0 — no useful count for the badge.

        File picker colour-codes line counts for text files; for
        binary content there's nothing meaningful to count, so the
        method returns 0 and the UI shows no badge.
        """
        # A few null bytes → detected as binary by the 8KB probe.
        (repo.root / "blob.bin").write_bytes(b"MZ\x00\x90" + b"\x00" * 50)
        _run_git(repo.root, "add", "blob.bin")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        assert len(root["children"]) == 1
        blob_node = root["children"][0]
        assert blob_node["type"] == "file"
        assert blob_node["lines"] == 0

    def test_get_file_tree_directory_nodes_have_no_mtime_field(
        self, repo: Repo
    ) -> None:
        """Directory nodes do not carry an mtime — files only.

        specs4/1-foundation/repository.md lists mtime as a file-only
        property. Directories aggregate timestamps of their children;
        a directory-level mtime wouldn't convey anything actionable
        for the file picker, so we omit it entirely.
        """
        (repo.root / "src").mkdir()
        (repo.root / "src" / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "src/a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        src_node = root["children"][0]
        assert src_node["type"] == "dir"
        assert "mtime" not in src_node
        file_node = src_node["children"][0]
        assert file_node["type"] == "file"
        assert "mtime" in file_node

    def test_get_file_tree_classifies_modified_file(self, repo: Repo) -> None:
        """Tracked file with unstaged modification appears in 'modified'."""
        (repo.root / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2", encoding="utf-8")
        result = repo.get_file_tree()
        assert result["modified"] == ["a.md"]
        assert result["staged"] == []
        assert result["untracked"] == []
        assert result["deleted"] == []

    def test_get_file_tree_classifies_staged_add(self, repo: Repo) -> None:
        """Newly-staged addition appears in 'staged'."""
        # Seed commit so HEAD resolves (some edge cases differ for
        # the initial-commit state).
        (repo.root / "seed.md").write_text("s", encoding="utf-8")
        _run_git(repo.root, "add", "seed.md")
        _run_git(repo.root, "commit", "-q", "-m", "seed")
        (repo.root / "new.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "new.md")
        result = repo.get_file_tree()
        assert "new.md" in result["staged"]
        # new.md is staged and not modified in the working tree, so
        # 'modified' stays empty.
        assert result["modified"] == []

    def test_get_file_tree_classifies_untracked(self, repo: Repo) -> None:
        """A file never added to the index appears in 'untracked'."""
        (repo.root / "seed.md").write_text("s", encoding="utf-8")
        _run_git(repo.root, "add", "seed.md")
        _run_git(repo.root, "commit", "-q", "-m", "seed")
        (repo.root / "scratch.md").write_text("draft", encoding="utf-8")
        result = repo.get_file_tree()
        assert "scratch.md" in result["untracked"]
        # And it also shows up in the tree under the root.
        names = {c["name"] for c in result["tree"]["children"]}
        assert "scratch.md" in names

    def test_get_file_tree_classifies_deleted(self, repo: Repo) -> None:
        """A removed tracked file appears in 'deleted' only.

        Porcelain reports deleted-but-unstaged tracked files with
        ``X=' '`` (index unchanged) and ``Y='D'`` (worktree deleted).
        The parser routes Y='D' into the ``deleted`` list
        exclusively — the file-picker UI shows a single 'deleted'
        badge on the tree node, not 'deleted+modified'. The
        modified list is for Y='M'/'T' only (content edits, type
        changes), which is a genuinely different visual state.
        """
        (repo.root / "doomed.md").write_text("bye", encoding="utf-8")
        _run_git(repo.root, "add", "doomed.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "doomed.md").unlink()
        result = repo.get_file_tree()
        assert result["deleted"] == ["doomed.md"]
        # Not in modified — the two lists are disjoint for delete entries.
        assert "doomed.md" not in result["modified"]

    def test_get_file_tree_includes_deleted_files_in_tree(
        self, repo: Repo
    ) -> None:
        """Deleted files still appear as nodes in the tree.

        Picker shows them with a 'deleted' badge so users can recover
        them via 'discard changes'. If we filtered them out of the
        tree, users would have no UI to click on.
        """
        (repo.root / "doomed.md").write_text("bye", encoding="utf-8")
        _run_git(repo.root, "add", "doomed.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "doomed.md").unlink()
        root = repo.get_file_tree()["tree"]
        names = {c["name"] for c in root["children"]}
        assert "doomed.md" in names

    def test_get_file_tree_rename_appears_in_staged_list(
        self, repo: Repo
    ) -> None:
        """``R  old -> new`` porcelain entries stage both paths.

        The porcelain parser expands rename entries so both the
        source and destination are recorded as staged. Matches the
        spec: "Each path is added to the staged array. Each path
        segment may be individually quoted."
        """
        (repo.root / "old.md").write_text("content", encoding="utf-8")
        _run_git(repo.root, "add", "old.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "mv", "old.md", "new.md")
        result = repo.get_file_tree()
        # Both old and new paths appear in staged.
        assert "old.md" in result["staged"]
        assert "new.md" in result["staged"]

    def test_get_file_tree_diff_stats_for_unstaged_modification(
        self, repo: Repo
    ) -> None:
        """Unstaged line changes are captured in diff_stats."""
        (repo.root / "a.md").write_text(
            "line1\nline2\nline3\n", encoding="utf-8"
        )
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Remove one line, add two → +2 -1 in numstat.
        (repo.root / "a.md").write_text(
            "line1\nnew2\nnew2b\nline3\n", encoding="utf-8"
        )
        result = repo.get_file_tree()
        assert "a.md" in result["diff_stats"]
        stats = result["diff_stats"]["a.md"]
        assert stats["additions"] == 2
        assert stats["deletions"] == 1

    def test_get_file_tree_diff_stats_merges_staged_and_unstaged(
        self, repo: Repo
    ) -> None:
        """Per-file diff_stats sum additions/deletions across both sides.

        File picker shows total churn per file. When a file has both
        staged and unstaged edits, numstat entries from both sources
        merge. This test exercises the merging branch in the parser.
        """
        (repo.root / "a.md").write_text("x\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Stage a change: +1 -0.
        (repo.root / "a.md").write_text("x\ny\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        # Further unstaged change on top: +1 -0.
        (repo.root / "a.md").write_text("x\ny\nz\n", encoding="utf-8")
        result = repo.get_file_tree()
        stats = result["diff_stats"]["a.md"]
        # Merged: 2 additions total, 0 deletions.
        assert stats["additions"] == 2
        assert stats["deletions"] == 0

    def test_get_file_tree_diff_stats_binary_file_zero_counts(
        self, repo: Repo
    ) -> None:
        """Binary diffs (numstat reports '-') produce 0/0 counts.

        numstat emits ``-`` for both counts on binary files. The
        parser maps those to 0 rather than raising — the file picker
        has no useful way to render "binary diff stats".
        """
        # Initial binary blob.
        blob_a = b"MZ\x00\x90" + b"\x00" * 100
        (repo.root / "blob.bin").write_bytes(blob_a)
        _run_git(repo.root, "add", "blob.bin")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Modify the binary content.
        blob_b = b"MZ\x00\x91" + b"\xff" * 100
        (repo.root / "blob.bin").write_bytes(blob_b)
        result = repo.get_file_tree()
        stats = result["diff_stats"].get("blob.bin")
        # Entry exists but both counts are 0.
        assert stats == {"additions": 0, "deletions": 0}

    def test_get_file_tree_diff_stats_empty_when_clean(self, repo: Repo) -> None:
        """Clean working tree has no entries in diff_stats."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.get_file_tree()["diff_stats"] == {}

    def test_get_file_tree_excludes_gitignored_files(self, repo: Repo) -> None:
        """Ignored files never appear in the tree or any status list.

        File tree is built from ``git ls-files`` (tracked) +
        ``git ls-files --others --exclude-standard`` (untracked,
        non-ignored). Gitignore matches are dropped from both.
        """
        (repo.root / ".gitignore").write_text("*.log\n", encoding="utf-8")
        _run_git(repo.root, "add", ".gitignore")
        _run_git(repo.root, "commit", "-q", "-m", "add gitignore")
        # Tracked, ignored file — shouldn't appear even though it
        # exists on disk.
        (repo.root / "debug.log").write_text("noise", encoding="utf-8")
        (repo.root / "keep.md").write_text("keep", encoding="utf-8")
        result = repo.get_file_tree()
        names = {c["name"] for c in result["tree"]["children"]}
        assert "debug.log" not in names
        assert "keep.md" in names
        assert ".gitignore" in names
        # Also not in any status list.
        assert "debug.log" not in result["untracked"]
        assert "debug.log" not in result["modified"]
        assert "debug.log" not in result["staged"]

    def test_get_file_tree_unquotes_paths_with_spaces(self, repo: Repo) -> None:
        """Paths with spaces are unquoted from porcelain output.

        Git wraps paths containing special characters (spaces,
        non-ASCII) in double quotes with backslash escapes. The
        parser reverses that before emitting the tree node and
        status-list entries, so the UI never sees literal quotes
        around filenames.
        """
        weird_name = "has space.md"
        (repo.root / weird_name).write_text("hi", encoding="utf-8")
        result = repo.get_file_tree()
        # Untracked list — quotes stripped.
        assert weird_name in result["untracked"]
        # Tree node — also unquoted.
        names = {c["name"] for c in result["tree"]["children"]}
        assert weird_name in names

    def test_get_file_tree_classifies_nested_modified_file(
        self, repo: Repo
    ) -> None:
        """Status classification works for files in subdirectories.

        The tree builder and porcelain parser agree on repo-relative
        path format (forward slash separators, no leading dot-slash).
        Status lists contain these paths verbatim, and the tree node
        corresponding to the file is findable by walking children.
        """
        (repo.root / "src").mkdir()
        (repo.root / "src" / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "src/a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "src" / "a.md").write_text("v2", encoding="utf-8")
        result = repo.get_file_tree()
        # Status list uses the nested path as-is.
        assert result["modified"] == ["src/a.md"]
        # And the tree has a src/ node containing a.md.
        root = result["tree"]
        src = next(c for c in root["children"] if c["name"] == "src")
        assert src["type"] == "dir"
        file_node = next(
            c for c in src["children"] if c["name"] == "a.md"
        )
        assert file_node["path"] == "src/a.md"

    def test_get_file_tree_nested_gitignore_excludes_subdirectory_files(
        self, repo: Repo
    ) -> None:
        """A .gitignore in a subdirectory excludes files under that subdir.

        Files like ``src/debug.log`` are caught by the subdirectory's
        own gitignore rule; they must not leak into the tree or any
        status list.
        """
        (repo.root / "src").mkdir()
        (repo.root / ".gitignore").write_text("*.log\n", encoding="utf-8")
        _run_git(repo.root, "add", ".gitignore")
        _run_git(repo.root, "commit", "-q", "-m", "add gitignore")
        # File in a subdirectory matching the parent-level rule.
        (repo.root / "src" / "debug.log").write_text("noise", encoding="utf-8")
        (repo.root / "src" / "keep.md").write_text("keep", encoding="utf-8")
        result = repo.get_file_tree()
        # The src/ dir node is present (because keep.md is).
        root = result["tree"]
        src = next((c for c in root["children"] if c["name"] == "src"), None)
        assert src is not None
        names_in_src = {c["name"] for c in src["children"]}
        assert "keep.md" in names_in_src
        assert "debug.log" not in names_in_src
        # Also absent from status lists.
        assert "src/debug.log" not in result["untracked"]