"""
Few-shot example messages for SEARCH/REPLACE format.

These examples teach the model the correct edit format.
Uses {fence} placeholder for code fence characters.
"""

# Build examples with fence placeholder
# Using string concatenation to avoid issues with nested markers

_EXAMPLE_1_ASSISTANT = (
    "I'll update the greeting message.\n\n"
    "src/greeting.py\n"
    "{fence}python\n"
    "<<<<<<< SEARCH\n"
    "def get_greeting(name):\n"
    '    return f"Hi, {{name}}!"\n'
    "=======\n"
    "def get_greeting(name):\n"
    '    return "Hello, World!"\n'
    ">>>>>>> REPLACE\n"
    "{fence}"
)

_EXAMPLE_2_ASSISTANT = (
    "I'll create the new file.\n\n"
    "src/utils.py\n"
    "{fence}python\n"
    "<<<<<<< SEARCH\n"
    "=======\n"
    "def format_name(first, last):\n"
    '    """Format a full name."""\n'
    '    return f"{{first}} {{last}}"\n'
    ">>>>>>> REPLACE\n"
    "{fence}"
)

_EXAMPLE_3_ASSISTANT = (
    "I'll remove the deprecated function.\n\n"
    "src/main.py\n"
    "{fence}python\n"
    "<<<<<<< SEARCH\n"
    "def legacy_function():\n"
    '    """Deprecated: Do not use."""\n'
    "    pass\n"
    "\n"
    "=======\n"
    ">>>>>>> REPLACE\n"
    "{fence}"
)

_EXAMPLE_4_ASSISTANT = (
    "I'll rename the function in both files.\n\n"
    "src/handler.py\n"
    "{fence}python\n"
    "<<<<<<< SEARCH\n"
    "def process(data):\n"
    "    return data.strip()\n"
    "=======\n"
    "def handle(data):\n"
    "    return data.strip()\n"
    ">>>>>>> REPLACE\n"
    "{fence}\n\n"
    "src/main.py\n"
    "{fence}python\n"
    "<<<<<<< SEARCH\n"
    "from handler import process\n"
    "\n"
    "result = process(input_data)\n"
    "=======\n"
    "from handler import handle\n"
    "\n"
    "result = handle(input_data)\n"
    ">>>>>>> REPLACE\n"
    "{fence}"
)

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
]
