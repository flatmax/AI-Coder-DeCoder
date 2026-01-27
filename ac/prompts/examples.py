"""
Few-shot example messages for EDIT/REPL format.

These examples teach the model the correct edit format.
The format uses context lines that appear in both sections,
with the common prefix serving as the anchor.
"""

# Example 1: Basic edit - modify existing code
_EXAMPLE_1_USER = "Change get_greeting to return 'Hello, World!'"
_EXAMPLE_1_ASSISTANT = """I'll update the greeting message.

src/greeting.py
««« EDIT
def get_greeting(name):
    return f"Hi, {name}!"
═══════ REPL
def get_greeting(name):
    return "Hello, World!"
