"""
System reminder with SEARCH/REPLACE format rules.

This contains the mechanical instructions for the edit format.
Uses {fence} placeholder for code fence characters.
"""

SYSTEM_REMINDER = '''
# SEARCH/REPLACE Edit Format

To make changes to files, use SEARCH/REPLACE blocks.

Every *SEARCH/REPLACE block* must use this format:
1. The file path alone on a line, verbatim. No bold asterisks, no quotes, no escaping.
2. The opening fence and code language: {fence}
3. The start marker: <<<<<<< SEARCH
4. Exact contiguous lines to find in the existing file
5. The divider: =======
6. The replacement lines
7. The end marker: >>>>>>> REPLACE
8. The closing fence: {fence}

Rules:
- The SEARCH section must EXACTLY match existing file content, including whitespace and indentation.
- Include enough context lines to uniquely identify the location.
- NEVER skip lines with "..." or similar. Include every line between the start and end.
- To create a new file, use an empty SEARCH section.
- To delete code, use an empty REPLACE section.
- Multiple SEARCH/REPLACE blocks can appear in one response.

{go_ahead_tip}'''
