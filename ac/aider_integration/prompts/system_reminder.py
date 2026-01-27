"""
System reminder with EDIT/REPL format rules (v3).

This contains the mechanical instructions for the edit format.
Uses {fence} placeholder for code fence characters.
"""

SYSTEM_REMINDER = '''
# EDIT/REPL Edit Format

To make changes to files, use EDIT/REPL blocks.

Every *EDIT block* must use this format:
1. The file path alone on a line, verbatim. No bold asterisks, no quotes, no escaping.
2. The start marker: ««« EDIT
3. Exact contiguous lines to find in the existing file
4. The divider: ═══════ REPL
5. The replacement lines
6. The end marker: »»» EDIT END

Rules:
- The EDIT section must EXACTLY match existing file content, including whitespace and indentation.
- Include enough context lines to uniquely identify the location.
- NEVER skip lines with "..." or similar. Include every line between the start and end.
- To create a new file, use an empty EDIT section.
- To delete code, use an empty REPL section.
- Multiple EDIT blocks can appear in one response.

{go_ahead_tip}'''
