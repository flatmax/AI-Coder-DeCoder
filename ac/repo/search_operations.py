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
            args = ['grep', '-n']
            if ignore_case:
                args.append('-i')
            if word:
                args.append('-w')
            if regex:
                args.append('-E')
            args.append(query)
            
            result = self._repo.git.execute(args)
            matches = []
            current_file = None
            current_matches = []
            
            for line in result.split('\n'):
                if not line:
                    continue
                parts = line.split(':', 2)
                if len(parts) >= 3:
                    file_path, line_num, content = parts[0], parts[1], parts[2]
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
            return []  # No matches found
        except Exception as e:
            return self._create_error_response(str(e))
