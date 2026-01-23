"""
Minimal IO stub for aider's RepoMap.
"""


class MinimalIO:
    """Minimal IO stub for RepoMap"""
    
    def __init__(self, encoding="utf-8"):
        self.encoding = encoding

    def read_text(self, filename, silent=False):
        try:
            with open(str(filename), "r", encoding=self.encoding) as f:
                return f.read()
        except (FileNotFoundError, IsADirectoryError, OSError, UnicodeError):
            return None

    def tool_output(self, msg): pass
    def tool_error(self, msg): pass
    def tool_warning(self, msg): pass
