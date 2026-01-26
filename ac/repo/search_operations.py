from git.exc import GitCommandError


class SearchOperationsMixin:
    """Mixin for search operations."""
    
    def search_files(self, query, word=False, regex=False, ignore_case=True):
        """
        Search for text in repository files.
        
        Args:
            query: Search string
            word: Match whole words only
            regex: Treat query as regex
            ignore_case: Case insensitive search
        
        Returns:
            List of dicts with file paths and matching lines
        """
        try:
            grep_args = ['-n']
            if ignore_case:
                grep_args.append('-i')
            if word:
                grep_args.append('-w')
            if regex:
                grep_args.append('-E')
            grep_args.extend(['--', query])
            
            result = self._repo.git.grep(*grep_args)
            
            matches = []
            current_file = None
            current_matches = []
            
            for line in result.split('\n'):
                if not line:
                    continue
                parts = line.split(':', 2)
                if len(parts) >= 3:
                    file_path, line_num, content = parts
                    if current_file != file_path:
                        if current_file:
                            matches.append({'file': current_file, 'matches': current_matches})
                        current_file = file_path
                        current_matches = []
                    current_matches.append({'line_num': int(line_num), 'line': content})
            
            if current_file:
                matches.append({'file': current_file, 'matches': current_matches})
            
            return matches
        except GitCommandError:
            return []
        except Exception as e:
            return self._create_error_response(str(e))
