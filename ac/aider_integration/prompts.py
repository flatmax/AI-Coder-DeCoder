"""
Custom prompts for aider-style editing.

Provides additional prompt templates that can be used alongside
or instead of aider's built-in prompts.
"""


SEARCH_REPLACE_INSTRUCTIONS = """
To make changes to files, use SEARCH/REPLACE blocks.

Every SEARCH/REPLACE block must use this exact format:

path/to/file.ext
<<<<<<< SEARCH
exact lines to find
=======
replacement lines
>>>>>>> REPLACE

Rules:
1. The SEARCH section must EXACTLY match the existing file content, including whitespace and indentation
2. Include enough context lines to uniquely identify the location
3. You can have multiple SEARCH/REPLACE blocks for the same file
4. To delete code, leave the REPLACE section empty
5. To create a new file, use an empty SEARCH section
6. Always show the complete file path

Example - Adding a docstring:

myfile.py
<<<<<<< SEARCH
def hello(name):
    print(f"Hello {name}")
=======
def hello(name):
    \"\"\"Greet someone by name.\"\"\"
    print(f"Hello {name}")
>>>>>>> REPLACE
"""


CONCISE_EDIT_PROMPT = """
Make the requested changes using SEARCH/REPLACE blocks.
Be precise - the SEARCH must exactly match existing code.
Only show the blocks needed for the changes, not the entire file.
"""


def build_edit_system_prompt(include_instructions=True):
    """Build a system prompt for edit mode."""
    prompt = "You are an expert software developer. Make changes to code using SEARCH/REPLACE blocks."
    if include_instructions:
        prompt += "\n\n" + SEARCH_REPLACE_INSTRUCTIONS
    return prompt
