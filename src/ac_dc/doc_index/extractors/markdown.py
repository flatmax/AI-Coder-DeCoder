"""Markdown extractor — regex-based outline scanner.

Line-by-line scan, no external parsing library. Produces:

- Heading tree from ATX headings (``#`` through ``######``),
  correctly nested by level transitions
- Inline links and image references via regex (standard
  markdown link syntax plus reference-style definitions)
- Content-type markers (``table``, ``code``, ``formula``) detected
  from table separator rows, fenced code blocks, and math
  delimiters
- Per-section line counts computed from adjacent heading
  positions
- Document type via filename and heading heuristics

Deliberately narrow scope:

- No CommonMark compliance. We don't care about edge cases like
  setext headings (``===`` underlines), hard-wrapped lists,
  nested blockquotes. The goal is to produce a navigation-
  friendly outline, not to render markdown.
- Reference-style link definitions are parsed and links that
  use them are resolved; undefined references fall through
  silently.
- HTML blocks pass through unchanged — any `<tag>` is just
  text to us.
- Fenced code blocks suppress heading detection inside them.
  Otherwise `#` inside a Python snippet would produce phantom
  headings.
- Inline code spans (backtick-delimited) also suppress link
  detection inside them. Otherwise a snippet like
  `` `[x](y)` `` would produce a spurious DocLink.

Governing spec: ``specs4/2-indexing/document-index.md``.
"""

from __future__ import annotations

import re
from pathlib import Path

from ac_dc.doc_index.extractors.base import BaseDocExtractor
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
)


# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------


# ATX heading — up to 6 leading hashes, mandatory space, then
# heading text. Trailing ``#`` decoration stripped. The start
# anchor rules out hashes in the middle of a line (which aren't
# headings anyway).
_HEADING_RE = re.compile(
    r"^(?P<hashes>#{1,6})\s+(?P<text>.+?)\s*#*\s*$"
)

# Fenced code block opener or closer. Either ``` or ~~~ with 3+
# characters. The optional info string (language hint) is
# captured but we only use it to detect fence reopening.
_FENCE_RE = re.compile(r"^(?P<fence>`{3,}|~{3,})(?P<info>[^\s].*)?\s*$")

# Inline link — [text](target) where target has no spaces. We
# allow empty text (`[](x.md)` — rare but valid). Not greedy on
# text so two links on one line don't collapse.
_INLINE_LINK_RE = re.compile(
    r"!?\[(?P<text>[^\]]*)\]\((?P<target>[^)\s]+)\)"
)

# Reference-style link — [text][label]. The label maps to a
# target defined elsewhere via [label]: target.
_REF_LINK_RE = re.compile(
    r"(?<!!)\[(?P<text>[^\]]+)\]\[(?P<label>[^\]]*)\]"
)

# Reference-style definition — [label]: target
# The leading spaces and optional title after target are tolerated.
_REF_DEF_RE = re.compile(
    r"^\s{0,3}\[(?P<label>[^\]]+)\]:\s+"
    r"(?P<target>\S+)(?:\s+.*)?\s*$"
)

# Table separator row — e.g., `| --- | :---: |`. Pipes and
# dashes/colons only. At least two columns.
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")

# Math block — `$$ ... $$` on its own line, or the opener/
# closer of a multi-line block. We treat a bare `$$` line as
# switching math mode.
_MATH_BLOCK_RE = re.compile(r"^\s*\${2}\s*$")

# Inline math — `$...$` with something non-trivial inside. The
# non-greedy body plus negative lookbehind on escaped dollar
# signs keeps it from matching across entire paragraphs.
_INLINE_MATH_RE = re.compile(r"(?<!\\)\$[^\n$]+\$")

# Inline code spans — backtick-delimited. Used to strip spans
# BEFORE link scanning, otherwise a snippet like
# `` `[x](y)` `` becomes a phantom DocLink.
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


# ---------------------------------------------------------------------------
# Doc type detection
# ---------------------------------------------------------------------------


# Path-keyword dispatch table. First match wins; checked in the
# order listed.
#
# This is a CLASSIFICATION heuristic, not a discovery filter —
# the orchestrator already walks the whole repo (respecting
# .gitignore and the usual excluded dirs). This table just
# assigns a doc_type tag to each found markdown file based on
# common documentation-layout conventions.
#
# Patterns are substrings of the lowercased repo-relative path.
# Paths are normalised to forward-slash, no leading slash form
# before lookup — a file at "specs/foo.md" looks like
# "specs/foo.md", not "/specs/foo.md". Trailing slash in the
# pattern matches the directory name as a whole component
# rather than a coincidental prefix (e.g., "specs/" matches
# "specs/foo.md" and "sub/specs/foo.md" but not "specsnote.md").
#
# The patterns are deliberately generic — conventional
# documentation directory names that hold across arbitrary
# repositories. Per-repo customisation could land later via
# config if real-world usage shows gaps.
_PATH_TYPE_KEYWORDS: tuple[tuple[str, str], ...] = (
    # "README" handled separately — filename-based, not path.
    ("specs/", "spec"),
    ("spec/", "spec"),
    ("rfc/", "spec"),
    ("rfcs/", "spec"),
    ("design/", "spec"),
    ("designs/", "spec"),
    ("adr/", "decision"),
    ("adrs/", "decision"),
    ("decisions/", "decision"),
    ("guide/", "guide"),
    ("guides/", "guide"),
    ("tutorial/", "guide"),
    ("tutorials/", "guide"),
    ("howto/", "guide"),
    ("how-to/", "guide"),
    ("reference/", "reference"),
    ("references/", "reference"),
    ("api/", "reference"),
    ("notes/", "notes"),
    ("meeting/", "notes"),
    ("meetings/", "notes"),
    ("minutes/", "notes"),
    ("journal/", "notes"),
)


def _detect_doc_type(
    path: str,
    headings: list[DocHeading],
) -> str:
    """Heuristic doc-type detection — see specs4 for the rules.

    Runs path heuristics first (higher confidence), falls back
    to heading-shape heuristics (ADR format, numbered specs),
    then ``"unknown"``.
    """
    lower_path = path.lower()
    # Filename: README always wins.
    name = lower_path.rsplit("/", 1)[-1]
    if name.startswith("readme"):
        return "readme"

    # Path keyword scan.
    for keyword, doc_type in _PATH_TYPE_KEYWORDS:
        if keyword in lower_path:
            return doc_type

    # Heading heuristics — ADR has distinctive heading texts.
    heading_texts = {
        h.text.lower() for h in headings
    }
    if "status" in heading_texts and "decision" in heading_texts:
        return "decision"

    # Numbered specs — headings like "1. Introduction" or "1.1 ...".
    for h in headings:
        if re.match(r"^\d+(\.\d+)*[.)]?\s+", h.text):
            return "spec"

    return "unknown"


# ---------------------------------------------------------------------------
# Extractor
# ---------------------------------------------------------------------------


class MarkdownExtractor(BaseDocExtractor):
    """Parse a markdown file into a :class:`DocOutline`.

    Single entry point — :meth:`extract`. Called once per file
    by the orchestrator; the extractor itself is stateless
    across calls (all parsing state is local to the method).

    The scan is a single pass with a small state machine:

    - **in_code_fence**: suppresses heading + link detection
      inside fenced code blocks
    - **in_math_block**: suppresses everything inside ``$$ ... $$``
    - **current_heading**: tracks the heading under which
      subsequent links attribute their ``source_heading``
    - **ref_defs**: collects reference-style definitions for
      later resolution

    Content-type detection happens per-section and is folded
    into the heading's :attr:`DocHeading.content_types` list.
    Each type appears at most once per section; re-detection on
    subsequent rows is a no-op.
    """

    extension = ".md"
    supports_enrichment = True

    def extract(self, path: Path, content: str) -> DocOutline:
        """See :class:`BaseDocExtractor` for the contract."""
        rel_path = str(path).replace("\\", "/").lstrip("/")
        outline = DocOutline(file_path=rel_path)

        lines = content.split("\n")
        all_headings: list[DocHeading] = []

        # State machine fields.
        in_code_fence = False
        fence_char = ""  # '`' or '~' — must match to close
        in_math_block = False
        current_heading: DocHeading | None = None

        # Stack of headings by level. heading_stack[i] is the
        # most-recent heading at level i+1 (or None). Children
        # attach to the innermost enclosing heading.
        heading_stack: list[DocHeading | None] = [None] * 6

        # Reference definitions — resolved at the end of the scan.
        # We collect pending ref-style links during the scan and
        # resolve in a second pass.
        ref_defs: dict[str, str] = {}
        pending_ref_links: list[tuple[DocLink, str]] = []

        for idx, raw_line in enumerate(lines):
            line_no = idx + 1  # 1-indexed to match spec convention

            # Fence tracking runs first so heading detection
            # inside a fence is suppressed.
            if not in_math_block:
                fence_match = _FENCE_RE.match(raw_line)
                if fence_match:
                    token = fence_match.group("fence")
                    if not in_code_fence:
                        in_code_fence = True
                        fence_char = token[0]
                        # First fenced block under the current
                        # heading → mark `code`.
                        if current_heading is not None:
                            _add_content_type(
                                current_heading, "code"
                            )
                    elif token[0] == fence_char:
                        # Matching closer.
                        in_code_fence = False
                        fence_char = ""
                    continue

            # Math-block toggle.
            if not in_code_fence:
                if _MATH_BLOCK_RE.match(raw_line):
                    in_math_block = not in_math_block
                    if current_heading is not None:
                        _add_content_type(
                            current_heading, "formula"
                        )
                    continue

            # Inside a fenced block or math block — skip heading
            # and link detection. But reference defs still work;
            # this matches common-practice markdown processing
            # (though pedantically CommonMark says otherwise).
            if in_code_fence or in_math_block:
                continue

            # Reference-style definitions don't produce links
            # themselves, but populate the label map for later
            # resolution of [text][label] patterns.
            ref_def_match = _REF_DEF_RE.match(raw_line)
            if ref_def_match:
                label = ref_def_match.group("label").lower()
                target = ref_def_match.group("target")
                ref_defs[label] = target
                continue

            # Headings.
            heading_match = _HEADING_RE.match(raw_line)
            if heading_match:
                hashes = heading_match.group("hashes")
                text = heading_match.group("text").strip()
                level = len(hashes)
                heading = DocHeading(
                    text=text,
                    level=level,
                    start_line=line_no,
                )
                all_headings.append(heading)

                # Nest under parent. A heading at level N attaches
                # to the most recent heading at level < N.
                parent = None
                for i in range(level - 2, -1, -1):
                    if heading_stack[i] is not None:
                        parent = heading_stack[i]
                        break
                if parent is None:
                    outline.headings.append(heading)
                else:
                    parent.children.append(heading)

                # Update the stack: this heading takes its slot,
                # and all deeper slots reset.
                heading_stack[level - 1] = heading
                for i in range(level, 6):
                    heading_stack[i] = None

                current_heading = heading
                continue

            # Inline math in this line → formula marker.
            # Only mark when we have a current heading; math
            # above the first heading is unusual but not an error.
            if current_heading is not None and _INLINE_MATH_RE.search(
                raw_line
            ):
                _add_content_type(current_heading, "formula")

            # Table separator detection — a row like `| --- | --- |`
            # indicates a table above/below. Mark the current
            # section.
            if (
                current_heading is not None
                and _TABLE_SEP_RE.match(raw_line)
            ):
                _add_content_type(current_heading, "table")

            # Link extraction. Strip inline code spans first so
            # a span like `` `[x](y)` `` doesn't produce a link.
            stripped = _INLINE_CODE_RE.sub(
                lambda m: " " * len(m.group(0)),
                raw_line,
            )

            source_heading_text = (
                current_heading.text if current_heading is not None
                else ""
            )

            # Inline links — [text](target) or ![alt](target).
            for link_match in _INLINE_LINK_RE.finditer(stripped):
                is_image = stripped[link_match.start()] == "!"
                target = link_match.group("target")
                link = DocLink(
                    target=target,
                    line=line_no,
                    source_heading=source_heading_text,
                    is_image=is_image,
                )
                outline.links.append(link)

            # Reference-style links — [text][label]. Resolution
            # happens in the second pass.
            for ref_match in _REF_LINK_RE.finditer(stripped):
                label = ref_match.group("label").lower()
                # Empty label means collapsed reference:
                # [text][] uses text as the label. Not supported
                # here — harmless, just won't resolve.
                if not label:
                    continue
                placeholder = DocLink(
                    target="",  # filled in during resolution
                    line=line_no,
                    source_heading=source_heading_text,
                    is_image=False,
                )
                outline.links.append(placeholder)
                pending_ref_links.append((placeholder, label))

        # Resolve reference-style links. Any link whose label
        # isn't defined is dropped from the links list — rather
        # than keep a half-populated placeholder around.
        if pending_ref_links:
            resolved: list[DocLink] = []
            unresolved_ids = set()
            for link, label in pending_ref_links:
                target = ref_defs.get(label)
                if target is None:
                    unresolved_ids.add(id(link))
                    continue
                link.target = target
                resolved.append(link)

            if unresolved_ids:
                outline.links = [
                    ln for ln in outline.links
                    if id(ln) not in unresolved_ids
                ]

        # Compute section_lines for each heading. A section runs
        # from the heading's start_line to the next heading's
        # start_line (or end of file). Uses the flat heading list
        # we built during the scan.
        #
        # Trailing newline quirk: a file ending with "\n" splits
        # into [..., "last_line", ""] — the empty tail isn't a
        # real line, so we trim it before computing the EOF
        # boundary. Without this, the last heading's section
        # size is inflated by one.
        effective_lines = len(lines)
        if lines and lines[-1] == "":
            effective_lines -= 1
        for i, heading in enumerate(all_headings):
            if i + 1 < len(all_headings):
                next_start = all_headings[i + 1].start_line
            else:
                # EOF boundary is (last real line) + 1, so
                # section_lines counts from start through the
                # final content line inclusive.
                next_start = effective_lines + 1
            heading.section_lines = max(0, next_start - heading.start_line)

        # Doc type detection — run after headings so the
        # heading-text heuristics have data to work with.
        outline.doc_type = _detect_doc_type(rel_path, all_headings)

        return outline


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _add_content_type(heading: DocHeading, kind: str) -> None:
    """Add a content-type marker if not already present.

    Order-preserving — markers appear in the order they were
    first detected. Prevents a heading from accumulating
    duplicate `"table"` / `"code"` / `"formula"` entries when
    multiple instances appear in the same section.
    """
    if kind not in heading.content_types:
        heading.content_types.append(kind)