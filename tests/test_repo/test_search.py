"""Search — git grep wrapper with regex/word/case/context flags."""

from __future__ import annotations

from ac_dc.repo import Repo

from .conftest import _run_git


class TestSearch:
    """search_files — git grep wrapper with regex/word/case/context flags."""

    @staticmethod
    def _seed_corpus(repo: Repo) -> None:
        """Commit a small grep-able corpus.

        Three files with deliberately varied content — different
        casing, shared substrings, and lines that are suitable
        context neighbours for the context-lines tests.
        """
        (repo.root / "README.md").write_text(
            "Welcome to the project.\n"
            "This is AC-DC.\n"
            "Enjoy.\n",
            encoding="utf-8",
        )
        (repo.root / "src.py").write_text(
            "def hello():\n"
            "    return 'hello world'\n"
            "\n"
            "def farewell():\n"
            "    return 'goodbye'\n",
            encoding="utf-8",
        )
        (repo.root / "notes.txt").write_text(
            "hello again\n"
            "HELLO in caps\n"
            "nothing to see\n",
            encoding="utf-8",
        )
        _run_git(repo.root, "add", "README.md", "src.py", "notes.txt")
        _run_git(repo.root, "commit", "-q", "-m", "seed corpus")

    def test_empty_query_returns_empty(self, repo: Repo) -> None:
        """Empty or whitespace-only query returns [] without invoking git."""
        self._seed_corpus(repo)
        assert repo.search_files("") == []
        assert repo.search_files("   ") == []

    def test_simple_match_fixed_string_default(self, repo: Repo) -> None:
        """Plain substring match — default mode is fixed-string.

        Regex metacharacters in the query are NOT interpreted when
        ``use_regex=False`` (the default). The query 'hello' hits
        every file that literally contains that substring.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        files = {r["file"] for r in results}
        # 'hello' appears in src.py and notes.txt, plus HELLO
        # (case-insensitive default). README says neither.
        assert "src.py" in files
        assert "notes.txt" in files
        assert "README.md" not in files

    def test_no_match_returns_empty(self, repo: Repo) -> None:
        """Query with no hits returns an empty list, not an error."""
        self._seed_corpus(repo)
        assert repo.search_files("xyzzy-never-appears") == []

    def test_case_sensitive_mode(self, repo: Repo) -> None:
        """``ignore_case=False`` excludes mismatched-case hits.

        The corpus has ``hello`` (lowercase) in src.py and notes.txt,
        and ``HELLO`` (uppercase) in notes.txt. Case-sensitive
        search for 'hello' should still match both source files
        (both contain the lowercase form) but NOT match the HELLO
        line specifically.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello", ignore_case=False)
        # Collect all matched line texts across files.
        all_match_texts = [
            m["line"]
            for r in results
            for m in r["matches"]
        ]
        # "HELLO in caps" should NOT be among the matches.
        assert not any("HELLO in caps" == t for t in all_match_texts)
        # Lowercase forms should still match.
        assert any("hello" in t and "HELLO" not in t for t in all_match_texts)

    def test_case_insensitive_default_matches_both_cases(self, repo: Repo) -> None:
        """The default (``ignore_case=True``) hits both cases.

        Counter-test to ``test_case_sensitive_mode``: confirms that
        without the flag, HELLO and hello both match.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        all_texts = [m["line"] for r in results for m in r["matches"]]
        assert any("HELLO in caps" == t for t in all_texts)
        assert any("hello again" == t for t in all_texts)

    def test_whole_word_rejects_substring_match(self, repo: Repo) -> None:
        """``whole_word=True`` requires word boundaries on both sides.

        'hell' is a substring of 'hello' but not a whole word.
        Without the flag, 'hell' would hit 'hello'; with it, the
        hit is rejected. The corpus has no standalone 'hell' token,
        so results should be empty.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hell", whole_word=True)
        assert results == []
        # Sanity check — without whole_word, 'hell' does hit.
        substr_results = repo.search_files("hell", whole_word=False)
        assert len(substr_results) > 0

    def test_whole_word_accepts_standalone_token(self, repo: Repo) -> None:
        """Whole-word mode still matches when the token IS a whole word.

        'hello' appears as a standalone token in 'hello again' and
        'hello world'. Whole-word mode should still find those.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello", whole_word=True)
        files = {r["file"] for r in results}
        assert "src.py" in files
        assert "notes.txt" in files

    def test_regex_mode_interprets_metacharacters(self, repo: Repo) -> None:
        """``use_regex=True`` treats the query as an extended regex.

        ``hel+o`` means 'he', one or more 'l', 'o'. Matches 'hello'
        and 'hellllo' if it existed. Without regex mode this would
        be a literal string that appears nowhere.
        """
        self._seed_corpus(repo)
        regex_results = repo.search_files("hel+o", use_regex=True)
        # Should find 'hello' in src.py (and HELLO case-insensitively
        # in notes.txt).
        files = {r["file"] for r in regex_results}
        assert "src.py" in files
        # Without regex — the literal string 'hel+o' doesn't exist.
        literal_results = repo.search_files("hel+o", use_regex=False)
        assert literal_results == []

    def test_regex_metacharacters_literal_by_default(self, repo: Repo) -> None:
        """Default fixed-string mode escapes regex metacharacters.

        A query like '[.]' would be a char-class containing a dot
        in regex, but as a literal string it's four characters.
        Neither matches the corpus, but the test proves the search
        doesn't crash and returns empty cleanly — verifying
        --fixed-strings is in effect (a regex parse error would
        surface differently).
        """
        self._seed_corpus(repo)
        # Query that's regex-invalid in some engines but a fine
        # literal string: unbalanced bracket.
        results = repo.search_files("[unclosed")
        assert results == []

    def test_query_starting_with_dash_is_not_treated_as_flag(
        self, repo: Repo
    ) -> None:
        """A query like ``--foo`` is treated as content, not a git option.

        The ``-e`` flag in the invocation explicitly marks the
        query as a pattern, preventing git from mistaking a
        leading-dash query for an option (which would error or —
        worse — silently do something unexpected).
        """
        (repo.root / "flags.md").write_text(
            "running with --foo enabled\nother content\n",
            encoding="utf-8",
        )
        _run_git(repo.root, "add", "flags.md")
        _run_git(repo.root, "commit", "-q", "-m", "add flags")
        results = repo.search_files("--foo")
        files = {r["file"] for r in results}
        assert "flags.md" in files

    def test_result_shape_per_file_entry(self, repo: Repo) -> None:
        """Each per-file entry has ``file`` and ``matches`` keys."""
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        assert len(results) > 0
        entry = results[0]
        assert set(entry.keys()) == {"file", "matches"}
        assert isinstance(entry["file"], str)
        assert isinstance(entry["matches"], list)

    def test_result_shape_per_match_entry(self, repo: Repo) -> None:
        """Each match has line_num, line, context_before, context_after."""
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        # Pick any non-empty match list.
        match = next(m for r in results for m in r["matches"])
        assert set(match.keys()) == {
            "line_num",
            "line",
            "context_before",
            "context_after",
        }
        assert isinstance(match["line_num"], int)
        assert match["line_num"] >= 1
        assert isinstance(match["line"], str)
        assert isinstance(match["context_before"], list)
        assert isinstance(match["context_after"], list)

    def test_context_before_contains_preceding_line(self, repo: Repo) -> None:
        """With ``context_lines=1``, the match for 'hello world' (line 2
        of src.py) has 'def hello():' (line 1) as a match of its own.

        Actually — 'def hello():' ALSO contains 'hello', so it's a
        match too, not a context line. We need a test corpus where
        the context lines don't themselves match. Use the README,
        which has 'AC-DC' on line 2 surrounded by non-matching lines.
        """
        self._seed_corpus(repo)
        results = repo.search_files("AC-DC", context_lines=1)
        # Should find one file (README.md) with one match.
        assert len(results) == 1
        assert results[0]["file"] == "README.md"
        matches = results[0]["matches"]
        assert len(matches) == 1
        match = matches[0]
        # The match is on line 2.
        assert match["line_num"] == 2
        assert "AC-DC" in match["line"]
        # context_before: one entry (line 1, "Welcome to the project.").
        assert len(match["context_before"]) == 1
        before = match["context_before"][0]
        assert before["line_num"] == 1
        assert "Welcome" in before["line"]
        # context_after: one entry (line 3, "Enjoy.").
        assert len(match["context_after"]) == 1
        after = match["context_after"][0]
        assert after["line_num"] == 3
        assert "Enjoy" in after["line"]

    def test_context_lines_zero_produces_no_context(self, repo: Repo) -> None:
        """``context_lines=0`` → empty context_before and context_after."""
        self._seed_corpus(repo)
        results = repo.search_files("AC-DC", context_lines=0)
        match = results[0]["matches"][0]
        assert match["context_before"] == []
        assert match["context_after"] == []

    def test_negative_context_clamped_to_zero(self, repo: Repo) -> None:
        """Negative context_lines is silently clamped to zero.

        Defensive behaviour — caller bugs or UI sliders that
        momentarily produce ``-1`` shouldn't crash the search. The
        method clamps with ``max(0, context_lines)``.
        """
        self._seed_corpus(repo)
        results = repo.search_files("AC-DC", context_lines=-5)
        match = results[0]["matches"][0]
        assert match["context_before"] == []
        assert match["context_after"] == []

    def test_context_does_not_cross_match_boundary(self, repo: Repo) -> None:
        """Context lines stop at the next match — matches don't share context.

        When two matches are adjacent (say line 1 and line 2 both
        match), the line between them isn't double-counted. Each
        match's ``context_before`` stops at the previous match; each
        ``context_after`` stops at the next match.

        In notes.txt, lines 1–2 both match 'hello' (case-insensitive).
        So match on line 1 should have no context_before (beginning
        of file) and no context_after (line 2 is also a match).
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello", context_lines=3)
        notes_entry = next(r for r in results if r["file"] == "notes.txt")
        line1_match = next(
            m for m in notes_entry["matches"] if m["line_num"] == 1
        )
        # No context_before — we're at the top of the file.
        assert line1_match["context_before"] == []
        # No context_after — line 2 is itself a match, not a
        # context line.
        assert line1_match["context_after"] == []

    def test_finds_matches_in_hyphenated_paths(self, repo: Repo) -> None:
        """Paths containing hyphens don't confuse the output parser.

        Regression test for a bug where ``_parse_grep_output`` would
        split on the first ``:`` or ``-`` in the line, mistaking a
        hyphen inside the filename (``chat-panel.js``,
        ``file-picker.js``) for the path/linenum separator. Every
        match in such a file was silently dropped.

        The fix disambiguates by requiring the separator to be
        followed by ``<digits><same-sep>`` — the pattern git grep
        uses for ``path<sep>linenum<sep>text``. A hyphen inside a
        path fails that check because the next character is a
        letter, not a digit.
        """
        # File with a hyphenated basename and a hyphen inside its
        # parent directory — exercises both positions where the
        # broken parser would have split prematurely.
        (repo.root / "webapp" / "src").mkdir(parents=True)
        (repo.root / "webapp" / "src" / "chat-panel.js").write_text(
            'title="Quick-insert snippets"\n'
            "other content\n",
            encoding="utf-8",
        )
        (repo.root / "webapp" / "src" / "file-picker.js").write_text(
            "the quick brown fox\n",
            encoding="utf-8",
        )
        _run_git(
            repo.root,
            "add",
            "webapp/src/chat-panel.js",
            "webapp/src/file-picker.js",
        )
        _run_git(repo.root, "commit", "-q", "-m", "add hyphenated files")

        # Case-sensitive fixed-string search for the exact phrase.
        results = repo.search_files(
            "Quick-insert",
            ignore_case=False,
        )
        files = {r["file"] for r in results}
        assert "webapp/src/chat-panel.js" in files

        # And a case-insensitive search hits both files — exercises
        # the parser on multiple hits across multiple hyphenated
        # paths.
        results_ci = repo.search_files("quick", ignore_case=True)
        files_ci = {r["file"] for r in results_ci}
        assert "webapp/src/chat-panel.js" in files_ci
        assert "webapp/src/file-picker.js" in files_ci

    def test_context_lines_work_for_hyphenated_paths(
        self, repo: Repo
    ) -> None:
        """Context lines are correctly attributed in hyphenated paths.

        Extends the regression test to cover the parse path for
        context lines (separator ``-`` instead of ``:``). With
        context=1 and a match in the middle of a 3-line file,
        both neighbours should appear as context.
        """
        (repo.root / "my-file.md").write_text(
            "first line\n"
            "target line\n"
            "third line\n",
            encoding="utf-8",
        )
        _run_git(repo.root, "add", "my-file.md")
        _run_git(repo.root, "commit", "-q", "-m", "add hyphenated md")

        results = repo.search_files("target", context_lines=1)
        assert len(results) == 1
        entry = results[0]
        assert entry["file"] == "my-file.md"
        assert len(entry["matches"]) == 1
        match = entry["matches"][0]
        assert match["line_num"] == 2
        assert len(match["context_before"]) == 1
        assert match["context_before"][0]["line_num"] == 1
        assert "first" in match["context_before"][0]["line"]
        assert len(match["context_after"]) == 1
        assert match["context_after"][0]["line_num"] == 3
        assert "third" in match["context_after"][0]["line"]