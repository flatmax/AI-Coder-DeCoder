"""
Few-shot example messages for EDIT/REPL format (v3).

These examples teach the model the correct edit format.
The format uses context lines that appear in both sections,
with the common prefix serving as the anchor.
"""

# Example 1: Basic edit - modify existing code
_EXAMPLE_1_ASSISTANT = """I'll update the greeting message.

src/greeting.py
««« EDIT
def get_greeting(name):
    return f"Hi, {name}!"
═══════ REPL
def get_greeting(name):
    return "Hello, World!"
»»» EDIT END
"""

# Example 2: Create a new file (empty edit section)
_EXAMPLE_2_ASSISTANT = """I'll create the new file.

src/utils.py
««« EDIT
═══════ REPL
def format_name(first, last):
    \"\"\"Format a full name.\"\"\"
    return f"{first} {last}"
»»» EDIT END
"""

# Example 3: Delete code (context + old in edit, only context in repl)
_EXAMPLE_3_ASSISTANT = """I'll remove the deprecated function.

src/main.py
««« EDIT
def legacy_function():
    \"\"\"Deprecated: Do not use.\"\"\"
    pass

def active_function():
═══════ REPL
def active_function():
»»» EDIT END
"""

# Example 4: Multiple edits in one response (rename function)
_EXAMPLE_4_ASSISTANT = """I'll rename the function in both files.

src/handler.py
««« EDIT
def process(data):
    return data.strip()
═══════ REPL
def handle(data):
    return data.strip()
»»» EDIT END

src/main.py
««« EDIT
from handler import process

result = process(input_data)
═══════ REPL
from handler import handle

result = handle(input_data)
»»» EDIT END
"""

# Example 5: Insert code (same context, new lines added in repl)
_EXAMPLE_5_ASSISTANT = """I'll add the validation check.

src/validator.py
««« EDIT
def validate(data):
    return data.strip()
═══════ REPL
def validate(data):
    if not data:
        raise ValueError("Empty data")
    return data.strip()
»»» EDIT END
"""

EXAMPLE_MESSAGES = [
    # Example 1: Basic edit - modify existing code
    {
        "role": "user",
        "content": "Change get_greeting to return 'Hello, World!'"
    },
    {
        "role": "assistant",
        "content": _EXAMPLE_1_ASSISTANT
    },

    # Example 2: Create a new file
    {
        "role": "user",
        "content": "Create a new utils.py file with a helper function"
    },
    {
        "role": "assistant",
        "content": _EXAMPLE_2_ASSISTANT
    },

    # Example 3: Delete code
    {
        "role": "user",
        "content": "Remove the deprecated legacy_function"
    },
    {
        "role": "assistant",
        "content": _EXAMPLE_3_ASSISTANT
    },

    # Example 4: Multiple edits in one response
    {
        "role": "user",
        "content": "Rename 'process' to 'handle' in both files"
    },
    {
        "role": "assistant",
        "content": _EXAMPLE_4_ASSISTANT
    },

    # Example 5: Insert code
    {
        "role": "user",
        "content": "Add validation to check for empty data"
    },
    {
        "role": "assistant",
        "content": _EXAMPLE_5_ASSISTANT
    },
]
