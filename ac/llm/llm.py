import os

from .config import ConfigMixin
from .file_context import FileContextMixin
from .chat import ChatMixin
from .streaming import StreamingMixin
from .history_mixin import HistoryMixin
from ..indexer import Indexer


class LiteLLM(ConfigMixin, FileContextMixin, ChatMixin, StreamingMixin, HistoryMixin):
    """LiteLLM wrapper for AI completions with file context support."""
    
    def __init__(self, repo=None, config_path=None):
        """
        Initialize LiteLLM with optional repository.
        
        Args:
            repo: Repo instance for file access. If None, file operations won't be available.
            config_path: Path to llm.json config file. If None, looks in ac/ directory.
        """
        self.repo = repo
        self.conversation_history = []
        
        # Initialize history store
        self._init_history_store()
        
        # Token usage tracking
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0
        self._total_cache_hit_tokens = 0
        self._total_cache_write_tokens = 0
        
        # Last request tokens for HUD display
        self._last_request_tokens = None
        
        # Load configuration
        self.config = self._load_config(config_path)
        
        # Apply environment variables from config
        self._apply_env_vars()
        
        # Set model from config or use default
        self.model = self.config.get('model', 'gpt-4o-mini')
        self.smaller_model = self.config.get('smallerModel', 'gpt-4o-mini')
        
        # Lazy-loaded aider integration
        self._aider_chat = None
        
        # Lazy-loaded indexer
        self._indexer = None
        
        # Auto-save symbol map on startup
        self._auto_save_symbol_map()
    
    def set_model(self, model):
        """Set the LLM model to use."""
        self.model = model
        if self._aider_chat:
            self._aider_chat.model = model
        return f"Model set to: {model}"
    
    def get_model(self):
        """Get the current model name."""
        return self.model
    
    def get_smaller_model(self):
        """Get the smaller/faster model name."""
        return self.smaller_model
    
    def get_config(self):
        """Get the current configuration."""
        return {
            'model': self.model,
            'smallerModel': self.smaller_model,
            'env': {k: v for k, v in self.config.get('env', {}).items()}
        }
    
    def ping(self):
        """Simple ping to test connection."""
        print('ping returning pong')
        return "pong"
    
    def clear_history(self):
        """Clear the conversation history and start a new history session."""
        self.conversation_history = []
        if self._aider_chat:
            self._aider_chat.clear_history()
        # Start a new history session
        if self._history_store:
            new_session = self._history_store.new_session()
            print(f"📜 New history session: {new_session}")
        return "Conversation history cleared"
    
    def get_aider_chat(self):
        """Get or create the AiderChat instance for edit operations."""
        if self._aider_chat is None:
            from ac.aider_integration.chat_integration import AiderChat
            self._aider_chat = AiderChat(model=self.model, repo=self.repo, token_tracker=self)
        return self._aider_chat
    
    def track_token_usage(self, completion):
        """
        Extract and accumulate token usage from a litellm completion response.
        
        Args:
            completion: The litellm completion response object
        """
        if completion and hasattr(completion, "usage") and completion.usage is not None:
            prompt_tokens = completion.usage.prompt_tokens or 0
            completion_tokens = completion.usage.completion_tokens or 0
            cache_hit_tokens = getattr(completion.usage, "prompt_cache_hit_tokens", 0) or getattr(
                completion.usage, "cache_read_input_tokens", 0
            ) or 0
            cache_write_tokens = getattr(completion.usage, "cache_creation_input_tokens", 0) or 0
            
            self._total_prompt_tokens += prompt_tokens
            self._total_completion_tokens += completion_tokens
            self._total_cache_hit_tokens += cache_hit_tokens
            self._total_cache_write_tokens += cache_write_tokens
            
            # Store last request for HUD display
            self._last_request_tokens = {
                'prompt': prompt_tokens,
                'completion': completion_tokens,
                'cache_hit': cache_hit_tokens,
                'cache_write': cache_write_tokens
            }
    
    def get_token_usage(self):
        """
        Get accumulated token usage statistics.
        
        Returns:
            Dict with token usage breakdown
        """
        total_tokens = self._total_prompt_tokens + self._total_completion_tokens
        return {
            "prompt_tokens": self._total_prompt_tokens,
            "completion_tokens": self._total_completion_tokens,
            "total_tokens": total_tokens,
            "cache_hit_tokens": self._total_cache_hit_tokens,
            "cache_write_tokens": self._total_cache_write_tokens
        }
    
    def reset_token_usage(self):
        """Reset accumulated token usage statistics."""
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0
        self._total_cache_hit_tokens = 0
        self._total_cache_write_tokens = 0
        self._last_request_tokens = None
        return "Token usage statistics reset"
    
    def get_token_report(self, file_paths=None, read_only_files=None):
        """
        Get detailed token usage report (like aider's /tokens command).
        
        Args:
            file_paths: Optional list of file paths to include in context
            read_only_files: Optional list of read-only file paths
            
        Returns:
            Formatted string with token breakdown
        """
        aider = self.get_aider_chat()
        
        # Add files to context if provided
        if file_paths:
            aider.clear_files()
            for path in file_paths:
                try:
                    aider.add_file(path)
                except FileNotFoundError:
                    pass  # Skip files that don't exist
        
        return aider.get_token_report(read_only_files=read_only_files)
    
    def save_repo_map(self, output_path=None, exclude_files=None):
        """
        Save the repository map to a file.
        
        Args:
            output_path: Path to save the map. If None, saves to .aicoder/repo_map.txt
            exclude_files: Optional list of files to exclude (simulating chat context)
            
        Returns:
            Dict with path to saved file or error
        """
        aider = self.get_aider_chat()
        if not aider._context_manager:
            return {"error": "No repository configured"}
        
        try:
            # Convert exclude_files to absolute paths if provided
            abs_exclude = []
            if exclude_files and self.repo:
                repo_root = self.repo.get_repo_root()
                for fpath in exclude_files:
                    if os.path.isabs(fpath):
                        abs_exclude.append(fpath)
                    else:
                        abs_exclude.append(os.path.join(repo_root, fpath))
            
            saved_path = aider._context_manager.save_repo_map(
                output_path=output_path,
                chat_files=abs_exclude
            )
            return {"path": saved_path}
        except Exception as e:
            return {"error": str(e)}
    
    def _get_indexer(self):
        """Get or create the Indexer instance."""
        if self._indexer is None:
            repo_root = self.repo.get_repo_root() if self.repo else None
            self._indexer = Indexer(repo_root)
        return self._indexer
    
    def _auto_save_symbol_map(self):
        """Auto-save symbol map for all tracked files.
        
        Returns:
            dict with symbol map info for HUD display, or None on failure.
        """
        if not self.repo:
            return None
        
        try:
            # Get all trackable files from repo
            tree_result = self.repo.get_file_tree()
            if not tree_result or 'error' in tree_result:
                return None
            tree = tree_result.get('tree')
            if not tree:
                return None
            
            # Collect all file paths
            file_paths = self._collect_file_paths(tree)
            
            # Filter to supported extensions
            supported_extensions = {'.py', '.js', '.mjs', '.jsx', '.ts', '.tsx'}
            file_paths = [f for f in file_paths if any(f.endswith(ext) for ext in supported_extensions)]
            
            if not file_paths:
                return None
            
            indexer = self._get_indexer()
            py_files = [f for f in file_paths if f.endswith('.py')]
            symbols_by_file = indexer.index_files(file_paths)
            saved_path = indexer.save_symbol_map(file_paths=file_paths)
            
            return {
                'total_files': len(file_paths),
                'py_files': len(py_files),
                'files_with_symbols': len(symbols_by_file),
                'saved_path': saved_path
            }
        except Exception as e:
            import traceback
            print(f"⚠️ Failed to auto-save symbol map: {e}")
            traceback.print_exc()
            return None
    
    def _collect_file_paths(self, node, current_path=''):
        """Recursively collect file paths from tree structure."""
        paths = []
        # Files have 'path' but no 'children'
        if 'path' in node and 'children' not in node:
            paths.append(node.get('path'))
        for child in node.get('children', []):
            paths.extend(self._collect_file_paths(child, current_path))
        return paths
    
    def save_symbol_map(self, file_paths=None, output_path=None):
        """
        Generate and save the symbol map.
        
        Args:
            file_paths: List of files to index. If None, uses cached files.
            output_path: Custom output path. If None, uses default.
            
        Returns:
            Dict with path to saved file.
        """
        try:
            indexer = self._get_indexer()
            saved_path = indexer.save_symbol_map(file_paths=file_paths, output_path=output_path)
            return {"path": saved_path}
        except Exception as e:
            return {"error": str(e)}
    
    def get_symbol_map(self, file_paths=None):
        """
        Get symbol map content without saving.
        
        Args:
            file_paths: List of files to index.
            
        Returns:
            Symbol map as string.
        """
        try:
            indexer = self._get_indexer()
            return indexer.get_symbol_map(file_paths)
        except Exception as e:
            return {"error": str(e)}
    
    def get_document_symbols(self, file_path):
        """
        Get LSP-format document symbols for a file.
        
        Args:
            file_path: Path to the file.
            
        Returns:
            List of LSP DocumentSymbol dicts.
        """
        try:
            indexer = self._get_indexer()
            return indexer.get_document_symbols(file_path)
        except Exception as e:
            return {"error": str(e)}
    
    def get_lsp_symbols(self, file_path=None):
        """
        Get LSP-format data for Monaco editor.
        
        Args:
            file_path: Specific file, or None for all cached files.
            
        Returns:
            LSP-compatible dict structure.
        """
        try:
            indexer = self._get_indexer()
            return indexer.get_lsp_data(file_path)
        except Exception as e:
            return {"error": str(e)}
    
    def save_symbol_map_with_refs(self, file_paths=None, output_path=None):
        """
        Generate and save the symbol map with cross-file references.
        
        This is the hybrid format that can replace aider's repo map.
        
        Args:
            file_paths: List of files to index. If None, uses all tracked files.
            output_path: Custom output path. If None, uses default.
            
        Returns:
            Dict with path to saved file.
        """
        try:
            # If no file paths provided, get all trackable files
            if file_paths is None and self.repo:
                file_paths = self._get_all_trackable_files()
            
            indexer = self._get_indexer()
            saved_path = indexer.get_symbol_map_with_refs(
                file_paths=file_paths,
                output_path=output_path
            )
            return {"path": saved_path}
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"error": str(e)}
    
    def _get_all_trackable_files(self):
        """Get all trackable files from the repo."""
        if not self.repo:
            return []
        
        tree_result = self.repo.get_file_tree()
        if not tree_result or 'tree' not in tree_result:
            return []
        
        file_paths = self._collect_file_paths(tree_result['tree'])
        
        # Filter to supported extensions
        supported_extensions = {'.py', '.js', '.mjs', '.jsx', '.ts', '.tsx'}
        return [f for f in file_paths if any(f.endswith(ext) for ext in supported_extensions)]
    
    def get_context_map(self, chat_files=None, include_references=True):
        """
        Get repository context map for LLM.
        
        Uses tree-sitter symbol index as the primary context source.
        Chat files are excluded since they're included verbatim in the prompt.
        
        Args:
            chat_files: List of files included in chat (to exclude from map)
            include_references: Whether to include cross-file references
            
        Returns:
            String containing the symbol map
        """
        if not self.repo:
            return ""
        
        try:
            # Get all trackable files
            all_files = self._get_all_trackable_files()
            
            if not all_files:
                return ""
            
            # Exclude chat files (they're included verbatim)
            chat_files_set = set(chat_files or [])
            map_files = [f for f in all_files if f not in chat_files_set]
            
            if not map_files:
                return ""
            
            indexer = self._get_indexer()
            
            # Build references if requested
            if include_references:
                indexer.build_references(map_files)
            
            # Get symbol index
            symbol_index = indexer._get_symbol_index()
            
            # Generate compact format with or without references
            return symbol_index.to_compact(
                file_paths=map_files,
                include_references=include_references
            )
        except Exception as e:
            import traceback
            print(f"⚠️ Failed to get context map: {e}")
            traceback.print_exc()
            return ""
    
    def get_references_to_symbol(self, file_path, symbol_name):
        """
        Get all locations that reference a symbol.
        
        Args:
            file_path: File where symbol is defined
            symbol_name: Name of the symbol
            
        Returns:
            List of location dicts or error.
        """
        try:
            indexer = self._get_indexer()
            return indexer.get_references_to_symbol(file_path, symbol_name)
        except Exception as e:
            return {"error": str(e)}
    
    def get_files_referencing(self, file_path):
        """
        Get all files that reference symbols in this file.
        
        Args:
            file_path: File to check
            
        Returns:
            Sorted list of file paths or error.
        """
        try:
            indexer = self._get_indexer()
            return indexer.get_files_referencing(file_path)
        except Exception as e:
            return {"error": str(e)}
    
    # ========== LSP Position-Based Methods for Monaco ==========
    
    def lsp_get_hover(self, file_path, line, col):
        """
        Get hover information at a position.
        
        Args:
            file_path: Path to the file
            line: 1-based line number
            col: 1-based column number
            
        Returns:
            Dict with 'contents' for Monaco hover, or None
        """
        try:
            from .lsp_helpers import find_symbol_at_position, get_hover_info
            indexer = self._get_indexer()
            symbols = indexer.index_file(file_path)
            symbol = find_symbol_at_position(symbols, line, col)
            if symbol:
                return get_hover_info(symbol)
            return None
        except Exception as e:
            return {"error": str(e)}
    
    def lsp_get_definition(self, file_path, line, col):
        """
        Get definition location for symbol at position.
        
        Args:
            file_path: Path to the file
            line: 1-based line number
            col: 1-based column number
            
        Returns:
            Dict with file, range for go-to-definition, or None
        """
        try:
            from .lsp_helpers import find_identifier_at_position, find_symbol_definition
            indexer = self._get_indexer()
            
            # Get the identifier at cursor position
            identifier = find_identifier_at_position(file_path, line, col, self.repo)
            if not identifier:
                return None
            
            # Search for definition in all indexed files
            all_files = self._get_all_trackable_files()
            symbols_by_file = indexer.index_files(all_files)
            
            definition = find_symbol_definition(identifier, symbols_by_file)
            if definition:
                return {
                    'file': definition.file_path,
                    'range': definition.range.to_dict(),
                    'selectionRange': definition.selection_range.to_dict()
                }
            return None
        except Exception as e:
            return {"error": str(e)}
    
    def lsp_get_references(self, file_path, line, col):
        """
        Get all references to symbol at position.
        
        Args:
            file_path: Path to the file
            line: 1-based line number
            col: 1-based column number
            
        Returns:
            List of location dicts, or empty list
        """
        try:
            from .lsp_helpers import find_symbol_at_position
            indexer = self._get_indexer()
            symbols = indexer.index_file(file_path)
            symbol = find_symbol_at_position(symbols, line, col)
            
            if not symbol:
                return []
            
            # Build references if not already done
            all_files = self._get_all_trackable_files()
            indexer.build_references(all_files)
            
            return indexer.get_references_to_symbol(file_path, symbol.name)
        except Exception as e:
            return {"error": str(e)}
    
    def lsp_get_completions(self, file_path, line, col, prefix):
        """
        Get completion suggestions at position.
        
        Args:
            file_path: Path to the file
            line: 1-based line number
            col: 1-based column number
            prefix: Text prefix to filter completions
            
        Returns:
            List of completion items
        """
        try:
            from .lsp_helpers import get_completions
            indexer = self._get_indexer()
            
            # Get symbols from current file and all tracked files
            all_files = self._get_all_trackable_files()
            symbols_by_file = indexer.index_files(all_files)
            
            return get_completions(prefix, symbols_by_file, file_path)
        except Exception as e:
            return {"error": str(e)}
    
    def parse_edits(self, response_text, file_paths=None):
        """
        Parse a response for search/replace blocks without applying them.
        
        Args:
            response_text: LLM response containing edit blocks
            file_paths: Optional list of valid file paths
            
        Returns:
            Dict with file_edits and shell_commands
        """
        aider = self.get_aider_chat()
        
        if file_paths:
            aider.clear_files()
            for path in file_paths:
                aider.add_file(path)
        
        file_edits, shell_commands = aider.editor.parse_response(response_text)
        return {
            "file_edits": file_edits,
            "shell_commands": shell_commands
        }
    
    def apply_edits(self, edits, dry_run=False):
        """
        Apply previously parsed edits to files.
        
        Args:
            edits: List of (filename, original, updated) tuples
            dry_run: If True, don't write changes to disk
            
        Returns:
            Dict with passed, failed, and content
        """
        aider = self.get_aider_chat()
        return aider.editor.apply_edits(edits, dry_run=dry_run)
