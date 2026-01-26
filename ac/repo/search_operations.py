from git.exc import GitCommandError


class SearchOperationsMixin:
    """Mixin for search operations."""
    
    def search_files(self, query, word=False, regex=False, ignore_case=True, context_lines=1):
        """
        Search for text in repository files.
        
        Args:
            query: Search string
            word: Match whole words only
            regex: Treat query as regex
            ignore_case: Case insensitive search
            context_lines: Number of context lines before/after match (0-3)
        
        Returns:
            List of dicts with file paths and matching lines
        """
        try:
            # Clamp context_lines to reasonable range
            context_lines = max(0, min(4, context_lines))
            
            grep_args = ['-n']
            if ignore_case:
                grep_args.append('-i')
            if word:
                grep_args.append('-w')
            if regex:
                grep_args.append('-E')
            if context_lines > 0:
                grep_args.append(f'-C{context_lines}')
            grep_args.extend(['--', query])
            
            result = self._repo.git.grep(*grep_args)
            
            if context_lines == 0:
                return self._parse_simple_grep(result)
            else:
                return self._parse_grep_with_context(result, context_lines)
                
        except GitCommandError:
            return []
        except Exception as e:
            return self._create_error_response(str(e))
    
    def _parse_simple_grep(self, result):
        """Parse grep output without context lines."""
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
    
    def _parse_grep_with_context(self, result, context_lines):
        """Parse grep output with context lines (-C flag)."""
        matches = []
        current_file = None
        current_matches = []
        current_match = None
        pending_context = []  # Buffer for context lines before we see the match
        
        for line in result.split('\n'):
            if not line:
                continue
            
            # Group separator (--) between match blocks
            if line == '--':
                if current_match:
                    current_matches.append(current_match)
                    current_match = None
                pending_context = []  # Clear pending context at group boundary
                continue
            
            # Parse line - format is either:
            # file:linenum:content (matching line, colon separator)
            # file-linenum-content (context line, dash separator)
            
            # Find the file path (everything before first : or - followed by a number)
            match_sep_idx = -1
            context_sep_idx = -1
            
            # Look for matching line pattern (file:num:)
            first_colon = line.find(':')
            if first_colon > 0:
                rest = line[first_colon + 1:]
                second_colon = rest.find(':')
                if second_colon > 0:
                    num_part = rest[:second_colon]
                    if num_part.isdigit():
                        match_sep_idx = first_colon
            
            # Look for context line pattern (file-num-)
            # Need to find dash followed by digits followed by dash
            if match_sep_idx == -1:
                idx = 0
                while idx < len(line):
                    dash_idx = line.find('-', idx)
                    if dash_idx == -1:
                        break
                    rest = line[dash_idx + 1:]
                    next_dash = rest.find('-')
                    if next_dash > 0:
                        num_part = rest[:next_dash]
                        if num_part.isdigit():
                            context_sep_idx = dash_idx
                            break
                    idx = dash_idx + 1
            
            if match_sep_idx > 0:
                # This is a matching line
                file_path = line[:match_sep_idx]
                rest = line[match_sep_idx + 1:]
                colon_idx = rest.find(':')
                line_num = int(rest[:colon_idx])
                content = rest[colon_idx + 1:]
                is_match = True
            elif context_sep_idx > 0:
                # This is a context line
                file_path = line[:context_sep_idx]
                rest = line[context_sep_idx + 1:]
                dash_idx = rest.find('-')
                line_num = int(rest[:dash_idx])
                content = rest[dash_idx + 1:]
                is_match = False
            else:
                continue
            
            # Handle file changes
            if current_file != file_path:
                if current_match:
                    current_matches.append(current_match)
                    current_match = None
                if current_file:
                    matches.append({'file': current_file, 'matches': current_matches})
                current_file = file_path
                current_matches = []
                pending_context = []
            
            if is_match:
                # Start a new match block
                if current_match:
                    current_matches.append(current_match)
                current_match = {
                    'line_num': line_num,
                    'line': content,
                    'context_before': pending_context,  # Use buffered context
                    'context_after': []
                }
                pending_context = []  # Clear the buffer
            else:
                # Context line
                if current_match:
                    # We have a match - this is context_after
                    current_match['context_after'].append({
                        'line_num': line_num,
                        'line': content
                    })
                else:
                    # No match yet - buffer as potential context_before
                    pending_context.append({
                        'line_num': line_num,
                        'line': content
                    })
        
        # Don't forget the last match and file
        if current_match:
            current_matches.append(current_match)
        if current_file:
            matches.append({'file': current_file, 'matches': current_matches})
        
        return matches
