import os

from .config import ConfigMixin
from .file_context import FileContextMixin
from .chat import ChatMixin
from .streaming import StreamingMixin
from .history_mixin import HistoryMixin
from ..indexer import Indexer
from ..context import ContextManager
from ..url_handler import URLFetcher, URLDetector, URLType, SummaryType


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
        
        # Context manager for history, files, and token tracking
        self._context_manager = None
        if repo:
            self._context_manager = ContextManager(
                model_name=self.model,
                repo_root=repo.get_repo_root(),
                token_tracker=self
            )
        else:
            # Create context manager without repo for basic history tracking
            self._context_manager = ContextManager(
                model_name=self.model,
                repo_root=None,
                token_tracker=self
            )
        
        # Lazy-loaded indexer
        self._indexer = None
        
        # Lazy-loaded URL fetcher
        self._url_fetcher = None
        
        # Auto-save symbol map on startup
        self._auto_save_symbol_map()
    
    def set_model(self, model):
        """Set the LLM model to use."""
        self.model = model
        if self._context_manager:
            self._context_manager.model_name = model
            self._context_manager.token_counter.model_name = model
            self._context_manager.token_counter._info = None  # Reset cached info
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
    
    @property
    def conversation_history(self) -> list[dict]:
        """Get conversation history from context manager."""
        if self._context_manager:
            return self._context_manager.get_history()
        return []
    
    @conversation_history.setter
    def conversation_history(self, value: list[dict]):
        """Set conversation history in context manager."""
        if self._context_manager:
            self._context_manager.set_history(value)
    
    def ping(self):
        """Simple ping to test connection."""
        print('ping returning pong')
        return "pong"
    
    def clear_history(self):
        """Clear the conversation history and start a new history session."""
        if self._context_manager:
            self._context_manager.clear_history()
        # Start a new history session
        if self._history_store:
            new_session = self._history_store.new_session()
            print(f"📜 New history session: {new_session}")
        return "Conversation history cleared"
    
    def track_token_usage(self, completion):
        """
        Extract and accumulate token usage from a litellm completion response.
        
        Args:
            completion: The litellm completion response object
        """
        if completion and hasattr(completion, "usage") and completion.usage is not None:
            prompt_tokens = completion.usage.prompt_tokens or 0
            completion_tokens = completion.usage.completion_tokens or 0
            # Check various cache token attribute names across providers
            cache_hit_tokens = getattr(completion.usage, "prompt_cache_hit_tokens", 0) or getattr(
                completion.usage, "cache_read_input_tokens", 0
            ) or 0
            # Bedrock via LiteLLM uses prompt_tokens_details.cached_tokens
            if not cache_hit_tokens:
                prompt_details = getattr(completion.usage, "prompt_tokens_details", None)
                if prompt_details:
                    if isinstance(prompt_details, dict):
                        cache_hit_tokens = prompt_details.get("cached_tokens", 0) or 0
                    else:
                        cache_hit_tokens = getattr(prompt_details, "cached_tokens", 0) or 0
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
        if not self._context_manager:
            return "Token report unavailable: no context manager"
        
        # Add files to context if provided
        if file_paths:
            self._context_manager.file_context.clear()
            for path in file_paths:
                try:
                    content = self.repo.get_file_content(path) if self.repo else None
                    if isinstance(content, dict) and 'error' in content:
                        continue  # Skip files that don't exist
                    self._context_manager.file_context.add_file(path, content)
                except FileNotFoundError:
                    pass  # Skip files that don't exist
        
        # Build system prompt for token counting
        from ..prompts import build_system_prompt
        system_prompt = build_system_prompt()
        
        # Get symbol map for token counting
        symbol_map = self.get_context_map(
            chat_files=file_paths,
            include_references=True
        ) if self.repo else ""
        
        return self._context_manager.get_token_report(
            system_prompt=system_prompt,
            symbol_map=symbol_map,
            read_only_files=read_only_files
        )
    
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
            
            # Filter to supported extensions (must match parser.py EXTENSION_MAP)
            supported_extensions = {
                '.py', '.js', '.mjs', '.jsx', '.ts', '.tsx',
                '.cpp', '.cc', '.cxx', '.c++', '.C',
                '.hpp', '.hh', '.hxx', '.h++', '.H', '.h'
            }
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
        
        # Filter to supported extensions (must match parser.py EXTENSION_MAP)
        supported_extensions = {
            '.py', '.js', '.mjs', '.jsx', '.ts', '.tsx',
            '.cpp', '.cc', '.cxx', '.c++', '.C',
            '.hpp', '.hh', '.hxx', '.h++', '.H', '.h'
        }
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
    
    def get_file_tree_for_context(self) -> str:
        """
        Get formatted file tree for LLM context.
        
        Returns:
            Formatted file tree string, or empty string if unavailable
        """
        if not self.repo:
            return ""
        
        try:
            tree_data = self.repo.get_file_tree()
            if not tree_data or 'error' in tree_data:
                return ""
            
            from ..symbol_index.compact_format import format_file_tree
            return format_file_tree(tree_data)
        except Exception as e:
            print(f"⚠️ Failed to get file tree: {e}")
            return ""
    
    def get_context_map_chunked(self, chat_files=None, include_references=True, min_chunk_tokens=1024, num_chunks=None, return_metadata=False):
        """
        Get repository context map as cacheable chunks.

        Returns the symbol map split into chunks. If num_chunks is specified,
        splits into exactly that many chunks. Otherwise uses min_chunk_tokens.
        This enables better LLM prompt caching - stable files at the start
        form stable chunks that remain cached even when later files change.

        Args:
            chat_files: List of files included in chat (to exclude from map)
            include_references: Whether to include cross-file references
            min_chunk_tokens: Minimum tokens per chunk (default 1024 for Anthropic)
            num_chunks: If specified, split into exactly this many chunks
            return_metadata: If True, return list of dicts with content, files, tokens, cached

        Returns:
            List of strings (or dicts if return_metadata=True), each a cacheable chunk
        """
        if not self.repo:
            return []
        
        try:
            # Get all trackable files
            all_files = self._get_all_trackable_files()
            
            if not all_files:
                return []
            
            # Exclude chat files (they're included verbatim)
            chat_files_set = set(chat_files or [])
            map_files = [f for f in all_files if f not in chat_files_set]
            
            if not map_files:
                return []
            
            indexer = self._get_indexer()
            
            # Build references if requested
            if include_references:
                indexer.build_references(map_files)
            
            # Get symbol index
            symbol_index = indexer._get_symbol_index()
            
            # Generate chunked compact format
            return symbol_index.to_compact_chunked(
                file_paths=map_files,
                include_references=include_references,
                min_chunk_tokens=min_chunk_tokens,
                num_chunks=num_chunks,
                return_metadata=return_metadata
            )
        except Exception as e:
            import traceback
            print(f"⚠️ Failed to get chunked context map: {e}")
            traceback.print_exc()
            return []
    
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
            
            # Skip keywords
            if identifier in ('import', 'from', 'export', 'const', 'let', 'var', 'function', 'class', 'def', 'return', 'if', 'else', 'for', 'while'):
                return None
            
            # Search for definition in all indexed files
            all_files = self._get_all_trackable_files()
            symbols_by_file = indexer.index_files(all_files)
            
            definition = find_symbol_definition(identifier, symbols_by_file, exclude_file=file_path)
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
        Parse a response for edit blocks without applying them.
        
        Args:
            response_text: LLM response containing edit blocks
            file_paths: Optional list of valid file paths
            
        Returns:
            Dict with shell_commands, has_edits, and edit_blocks
        """
        from ..edit_parser import EditParser
        
        edit_parser = EditParser()
        blocks = edit_parser.parse_response(response_text)
        
        return {
            "has_edits": len(blocks) > 0,
            "edit_blocks": blocks,
            "shell_commands": edit_parser.detect_shell_suggestions(response_text)
        }
    
    def apply_edits(self, edits, dry_run=False):
        """
        Apply previously parsed edit blocks to files.
        
        Args:
            edits: List of EditBlock objects
            dry_run: If True, don't write changes to disk
            
        Returns:
            Dict with results and files_modified
        """
        from ..edit_parser import EditParser, EditStatus
        
        if not edits:
            return {"results": [], "files_modified": []}
        
        edit_parser = EditParser()
        apply_result = edit_parser.apply_edits(edits, self.repo, dry_run=dry_run)
        
        return {
            "files_modified": apply_result.files_modified,
            "results": [
                {
                    "file_path": r.file_path,
                    "status": r.status.value,
                    "reason": r.reason,
                    "estimated_line": r.estimated_line,
                }
                for r in apply_result.results
            ]
        }
    
    # ========== URL Fetching Methods ==========
    
    def _get_url_fetcher(self):
        """Get or create the URLFetcher instance."""
        if self._url_fetcher is None:
            self._url_fetcher = URLFetcher(summarizer_model=self.smaller_model)
        return self._url_fetcher
    
    def fetch_url(self, url, use_cache=True, summarize=True, summary_type=None, context=None):
        """
        Fetch content from a URL.
        
        Args:
            url: URL to fetch
            use_cache: Whether to use cached content if available
            summarize: Whether to generate a summary
            summary_type: Type of summary ('brief', 'usage', 'api', 'arch', 'eval')
            context: User's question for contextual summarization
            
        Returns:
            Dict with url, type, content, summary, cached, error
        """
        try:
            fetcher = self._get_url_fetcher()
            
            # Convert summary_type string to enum if provided
            st = None
            if summary_type:
                try:
                    st = SummaryType(summary_type)
                except ValueError:
                    pass
            
            result = fetcher.fetch(
                url,
                use_cache=use_cache,
                summarize=summarize,
                summary_type=st,
                context=context,
            )
            
            if result.content.error:
                print(f"⚠️ URL fetch error for {url}: {result.content.error}")
            
            return {
                "url": result.content.url,
                "type": result.content.url_type.value,
                "title": result.content.title,
                "content": result.content.content,
                "readme": result.content.readme,
                "symbol_map": result.content.symbol_map,
                "summary": result.summary,
                "summary_type": result.summary_type.value if result.summary_type else None,
                "cached": result.cached,
                "error": result.content.error,
            }
        except Exception as e:
            print(f"⚠️ URL fetch failed for {url}: {e}")
            return {"url": url, "error": str(e)}
    
    def fetch_urls_from_text(self, text, use_cache=True, summarize=True):
        """
        Detect and fetch all URLs in text.
        
        Args:
            text: Text that may contain URLs
            use_cache: Whether to use cached content
            summarize: Whether to generate summaries
            
        Returns:
            List of fetch results
        """
        try:
            fetcher = self._get_url_fetcher()
            results = fetcher.detect_and_fetch(
                text,
                use_cache=use_cache,
                summarize=summarize,
            )
            
            return [
                {
                    "url": r.content.url,
                    "type": r.content.url_type.value,
                    "title": r.content.title,
                    "summary": r.summary,
                    "cached": r.cached,
                    "error": r.content.error,
                }
                for r in results
            ]
        except Exception as e:
            return {"error": str(e)}
    
    def detect_urls(self, text):
        """
        Detect URLs in text without fetching.
        
        Args:
            text: Text to scan for URLs
            
        Returns:
            List of dicts with url, type, and github_info
        """
        results = URLDetector.extract_urls_with_types(text)
        return [
            {
                "url": url,
                "type": url_type.value,
                "github_info": {
                    "owner": gi.owner,
                    "repo": gi.repo,
                    "branch": gi.branch,
                    "path": gi.path,
                } if gi else None,
            }
            for url, url_type, gi in results
        ]
    
    def invalidate_url_cache(self, url):
        """Invalidate cached content for a URL."""
        fetcher = self._get_url_fetcher()
        return {"invalidated": fetcher.invalidate_cache(url)}
    
    def clear_url_cache(self):
        """Clear all cached URL content."""
        fetcher = self._get_url_fetcher()
        count = fetcher.clear_cache()
        return {"cleared": count}
    
    # ========== Context Visualization Methods ==========
    
    def get_context_breakdown(self, file_paths=None, fetched_urls=None):
        """
        Get detailed breakdown of context token usage by cache tier.
        
        Returns a unified block structure organized by cache tier (L0-L3 + active),
        matching how streaming.py builds messages. This enables the UI to visualize
        exactly what goes into each cache block.
        
        Args:
            file_paths: List of files currently in context
            fetched_urls: List of URLs that have been fetched
            
        Returns:
            Dict with:
            - blocks: List of tier blocks with contents breakdown
            - total_tokens, cached_tokens, cache_hit_rate
            - promotions, demotions (from last update)
            - legacy 'breakdown' for backwards compatibility
        """
        from ..prompts import build_system_prompt
        from ..symbol_index.compact_format import (
            get_legend,
            format_symbol_blocks_by_tier,
            compute_file_block_hash,
            _compute_path_aliases,
        )
        
        if not self._context_manager:
            return {"error": "No context manager available"}
        
        tc = self._context_manager.token_counter
        max_input = tc.max_input_tokens
        max_output = tc.max_output_tokens
        stability = self._context_manager.cache_stability
        
        # Tier thresholds
        thresholds = {'L0': 12, 'L1': 9, 'L2': 6, 'L3': 3}
        tier_names = {'L0': 'Most Stable', 'L1': 'Very Stable', 'L2': 'Stable', 'L3': 'Moderately Stable', 'active': 'Active'}
        
        # Build blocks structure
        blocks = []
        total_tokens = 0
        cached_tokens = 0
        
        # Determine active context files (full content replaces symbol entries)
        active_context_files = set(file_paths) if file_paths else set()
        
        # Get file tiers from stability tracker
        file_tiers = {'L0': [], 'L1': [], 'L2': [], 'L3': [], 'active': []}
        if file_paths and stability:
            file_tiers = stability.get_items_by_tier(list(file_paths))
            for tier in ['L0', 'L1', 'L2', 'L3', 'active']:
                if tier not in file_tiers:
                    file_tiers[tier] = []
            # Untracked files go to active
            tracked = set()
            for tier_files in file_tiers.values():
                tracked.update(tier_files)
            for path in file_paths:
                if path not in tracked:
                    file_tiers['active'].append(path)
        elif file_paths:
            file_tiers['active'] = list(file_paths)
        
        # Get symbol map data
        symbol_map_content = {}
        symbol_files_by_tier = {}
        legend = ""
        legend_tokens = 0
        
        if self.repo:
            try:
                all_files = self._get_all_trackable_files()
                if all_files:
                    indexer = self._get_indexer()
                    symbols_by_file = indexer.index_files(all_files)
                    indexer.build_references(all_files)
                    symbol_index = indexer._get_symbol_index()
                    
                    # Get reference data
                    file_refs = {}
                    file_imports = {}
                    references = {}
                    if hasattr(symbol_index, '_reference_index') and symbol_index._reference_index:
                        ref_index = symbol_index._reference_index
                        for f in all_files:
                            file_refs[f] = ref_index.get_files_referencing(f)
                            file_imports[f] = ref_index.get_file_dependencies(f)
                            references[f] = ref_index.get_references_to_file(f)
                    
                    # Compute aliases and legend
                    aliases = _compute_path_aliases(references, file_refs)
                    legend = get_legend(aliases)
                    legend_tokens = tc.count(legend) if legend else 0
                    
                    # Get symbol tiers
                    symbol_items = [f"symbol:{f}" for f in symbols_by_file.keys()]
                    symbol_tiers = {'L0': [], 'L1': [], 'L2': [], 'L3': [], 'active': []}
                    
                    if stability:
                        symbol_tiers = stability.get_items_by_tier(symbol_items)
                        for tier in ['L0', 'L1', 'L2', 'L3', 'active']:
                            if tier not in symbol_tiers:
                                symbol_tiers[tier] = []
                        # Untracked symbols go to L3
                        tracked = set()
                        for tier_items in symbol_tiers.values():
                            tracked.update(tier_items)
                        for item in symbol_items:
                            if item not in tracked:
                                symbol_tiers['L3'].append(item)
                    else:
                        symbol_tiers['L3'] = symbol_items
                    
                    # Convert to file paths, excluding active context files
                    for tier, items in symbol_tiers.items():
                        symbol_files_by_tier[tier] = [
                            item.replace("symbol:", "") for item in items
                            if item.startswith("symbol:") and item.replace("symbol:", "") not in active_context_files
                        ]
                    
                    # Format symbol blocks
                    symbol_map_content = format_symbol_blocks_by_tier(
                        symbols_by_file=symbols_by_file,
                        file_tiers=symbol_files_by_tier,
                        references=references,
                        file_refs=file_refs,
                        file_imports=file_imports,
                        aliases=aliases,
                        exclude_files=active_context_files,
                    )
            except Exception:
                pass
        
        # Build system prompt
        system_prompt = build_system_prompt()
        system_tokens = tc.count(system_prompt)
        
        # Helper to get stability info for items
        def get_item_stability(item_key):
            """Get stability info for a file or symbol item."""
            if stability:
                return stability.get_item_info(item_key)
            return {
                'current_tier': 'active',
                'stable_count': 0,
                'next_tier': 'L3',
                'next_threshold': 3,
                'progress': 0.0,
            }
        
        # Build L0 block
        l0_contents = []
        l0_tokens = system_tokens
        l0_contents.append({"type": "system", "tokens": system_tokens})
        
        if legend:
            l0_contents.append({"type": "legend", "tokens": legend_tokens})
            l0_tokens += legend_tokens
        
        if symbol_map_content.get('L0'):
            sym_tokens = tc.count(symbol_map_content['L0'])
            symbol_items = []
            for f in symbol_files_by_tier.get('L0', []):
                item_info = get_item_stability(f"symbol:{f}")
                symbol_items.append({
                    "path": f,
                    "stable_count": item_info['stable_count'],
                    "next_tier": item_info['next_tier'],
                    "next_threshold": item_info['next_threshold'],
                    "progress": item_info['progress'],
                })
            l0_contents.append({
                "type": "symbols",
                "count": len(symbol_files_by_tier.get('L0', [])),
                "tokens": sym_tokens,
                "files": symbol_files_by_tier.get('L0', []),
                "items": symbol_items
            })
            l0_tokens += sym_tokens
        
        if file_tiers.get('L0'):
            file_tokens = 0
            file_items = []
            for path in file_tiers['L0']:
                try:
                    content = self.repo.get_file_content(path)
                    if content and not (isinstance(content, dict) and 'error' in content):
                        path_tokens = tc.count(f"{path}\n```\n{content}\n```\n")
                        file_tokens += path_tokens
                        item_info = get_item_stability(path)
                        file_items.append({
                            "path": path,
                            "tokens": path_tokens,
                            "stable_count": item_info['stable_count'],
                            "next_tier": item_info['next_tier'],
                            "next_threshold": item_info['next_threshold'],
                            "progress": item_info['progress'],
                        })
                except Exception:
                    pass
            if file_tokens:
                l0_contents.append({
                    "type": "files",
                    "count": len(file_tiers['L0']),
                    "tokens": file_tokens,
                    "files": file_tiers['L0'],
                    "items": file_items
                })
                l0_tokens += file_tokens
        
        blocks.append({
            "tier": "L0",
            "name": tier_names['L0'],
            "tokens": l0_tokens,
            "cached": True,
            "threshold": thresholds['L0'],
            "contents": l0_contents
        })
        total_tokens += l0_tokens
        cached_tokens += l0_tokens
        
        # Build L1-L3 blocks
        for tier in ['L1', 'L2', 'L3']:
            tier_contents = []
            tier_tokens = 0
            
            if symbol_map_content.get(tier):
                sym_tokens = tc.count(symbol_map_content[tier])
                symbol_items = []
                for f in symbol_files_by_tier.get(tier, []):
                    item_info = get_item_stability(f"symbol:{f}")
                    symbol_items.append({
                        "path": f,
                        "stable_count": item_info['stable_count'],
                        "next_tier": item_info['next_tier'],
                        "next_threshold": item_info['next_threshold'],
                        "progress": item_info['progress'],
                    })
                tier_contents.append({
                    "type": "symbols",
                    "count": len(symbol_files_by_tier.get(tier, [])),
                    "tokens": sym_tokens,
                    "files": symbol_files_by_tier.get(tier, []),
                    "items": symbol_items
                })
                tier_tokens += sym_tokens
            
            if file_tiers.get(tier):
                file_tokens = 0
                file_items = []
                for path in file_tiers[tier]:
                    try:
                        content = self.repo.get_file_content(path)
                        if content and not (isinstance(content, dict) and 'error' in content):
                            path_tokens = tc.count(f"{path}\n```\n{content}\n```\n")
                            file_tokens += path_tokens
                            item_info = get_item_stability(path)
                            file_items.append({
                                "path": path,
                                "tokens": path_tokens,
                                "stable_count": item_info['stable_count'],
                                "next_tier": item_info['next_tier'],
                                "next_threshold": item_info['next_threshold'],
                                "progress": item_info['progress'],
                            })
                    except Exception:
                        pass
                if file_tokens:
                    tier_contents.append({
                        "type": "files",
                        "count": len(file_tiers[tier]),
                        "tokens": file_tokens,
                        "files": file_tiers[tier],
                        "items": file_items
                    })
                    tier_tokens += file_tokens
            
            blocks.append({
                "tier": tier,
                "name": tier_names[tier],
                "tokens": tier_tokens,
                "cached": True,
                "threshold": thresholds[tier],
                "contents": tier_contents
            })
            total_tokens += tier_tokens
            cached_tokens += tier_tokens
        
        # Build active block
        active_contents = []
        active_tokens = 0
        
        # Active files
        if file_tiers.get('active'):
            file_tokens = 0
            file_items = []
            for path in file_tiers['active']:
                try:
                    content = self.repo.get_file_content(path)
                    if content and not (isinstance(content, dict) and 'error' in content):
                        path_tokens = tc.count(f"{path}\n```\n{content}\n```\n")
                        file_tokens += path_tokens
                        item_info = get_item_stability(path)
                        file_items.append({
                            "path": path,
                            "tokens": path_tokens,
                            "stable_count": item_info['stable_count'],
                            "next_tier": item_info['next_tier'],
                            "next_threshold": item_info['next_threshold'],
                            "progress": item_info['progress'],
                        })
                except Exception:
                    pass
            if file_tokens:
                active_contents.append({
                    "type": "files",
                    "count": len(file_tiers['active']),
                    "tokens": file_tokens,
                    "files": file_tiers['active'],
                    "items": file_items
                })
                active_tokens += file_tokens
        
        # URLs
        url_items = []
        url_tokens = 0
        if fetched_urls:
            fetcher = self._get_url_fetcher()
            for url in fetched_urls:
                try:
                    cached = fetcher.cache.get(url)
                    if cached:
                        url_part = cached.format_for_prompt()
                        tokens = tc.count(url_part)
                        url_items.append({
                            "url": url,
                            "tokens": tokens,
                            "title": cached.title or url,
                            "type": cached.url_type.value if cached.url_type else "unknown",
                            "fetched_at": cached.fetched_at.isoformat() if cached.fetched_at else None
                        })
                        url_tokens += tokens
                    else:
                        url_items.append({
                            "url": url,
                            "tokens": 0,
                            "title": url,
                            "type": "unknown",
                            "not_cached": True
                        })
                except Exception as e:
                    url_items.append({
                        "url": url,
                        "tokens": 0,
                        "title": url,
                        "type": "error",
                        "error": str(e)
                    })
            if url_items:
                # Add header overhead
                url_header = "# URL Context\n\nThe following content was fetched from URLs mentioned in the conversation:\n\n"
                url_tokens += tc.count(url_header)
                url_tokens += tc.count("Ok, I've reviewed the URL content.")
                active_contents.append({
                    "type": "urls",
                    "count": len(url_items),
                    "tokens": url_tokens,
                    "items": url_items
                })
                active_tokens += url_tokens
        
        # History
        history_tokens = self._context_manager.history_token_count()
        history_count = len(self._context_manager.get_history())
        if history_tokens > 0:
            active_contents.append({
                "type": "history",
                "count": history_count,
                "tokens": history_tokens,
                "max_tokens": self._context_manager.max_history_tokens,
                "needs_summary": self._context_manager.history_needs_summary()
            })
            active_tokens += history_tokens
        
        blocks.append({
            "tier": "active",
            "name": tier_names['active'],
            "tokens": active_tokens,
            "cached": False,
            "threshold": None,
            "contents": active_contents
        })
        total_tokens += active_tokens
        
        # Get promotion/demotion info from stability tracker
        promotions = []
        demotions = []
        if stability:
            promotions = [item for item, tier in stability.get_last_promotions()]
            demotions = [item for item, tier in stability.get_last_demotions()]
        
        # Calculate cache hit rate (use last request if available)
        cache_hit_rate = 0.0
        if hasattr(self, '_last_request_tokens') and self._last_request_tokens:
            cache_hit = self._last_request_tokens.get('cache_hit', 0)
            prompt = self._last_request_tokens.get('prompt', 0)
            if prompt > 0:
                cache_hit_rate = cache_hit / prompt
        
        # Build legacy breakdown for backwards compatibility
        legacy_breakdown = {
            "system": {"tokens": system_tokens, "label": "System Prompt"},
            "symbol_map": {
                "tokens": sum(tc.count(c) for c in symbol_map_content.values() if c) + legend_tokens,
                "label": "Symbol Map",
                "file_count": sum(len(files) for files in symbol_files_by_tier.values()),
            },
            "files": {
                "tokens": sum(
                    b["contents"][i]["tokens"]
                    for b in blocks
                    for i, c in enumerate(b["contents"])
                    if c.get("type") == "files"
                ),
                "label": f"Files ({len(file_paths) if file_paths else 0})",
                "items": [{"path": p, "tokens": 0} for p in (file_paths or [])]
            },
            "urls": {
                "tokens": url_tokens,
                "label": f"URLs ({len(url_items)})",
                "items": url_items
            },
            "history": {
                "tokens": history_tokens,
                "label": f"History ({history_count} messages)",
                "message_count": history_count,
                "max_tokens": self._context_manager.max_history_tokens,
                "needs_summary": self._context_manager.history_needs_summary()
            }
        }
        
        return {
            "model": self.model,
            "max_input_tokens": max_input,
            "max_output_tokens": max_output,
            "total_tokens": total_tokens,
            "cached_tokens": cached_tokens,
            "cache_hit_rate": cache_hit_rate,
            "used_tokens": total_tokens,  # Legacy field
            "remaining_tokens": max_input - total_tokens,
            "blocks": blocks,
            "promotions": promotions,
            "demotions": demotions,
            "empty_tiers_session_total": StreamingMixin._session_empty_tier_count,
            "breakdown": legacy_breakdown,  # Legacy format for backwards compatibility
            "session_totals": {
                "prompt_tokens": self._total_prompt_tokens,
                "completion_tokens": self._total_completion_tokens,
                "total_tokens": self._total_prompt_tokens + self._total_completion_tokens,
                "cache_hit_tokens": self._total_cache_hit_tokens,
                "cache_write_tokens": self._total_cache_write_tokens,
            }
        }
    
    def get_url_content(self, url):
        """
        Get cached content for a URL.
        
        Args:
            url: URL to retrieve content for
            
        Returns:
            Dict with url, content, metadata, tokens
        """
        if not self._context_manager:
            return {"error": "No context manager available"}
        
        try:
            fetcher = self._get_url_fetcher()
            cached = fetcher.cache.get(url)
            
            if not cached:
                return {"error": "URL not in cache", "url": url}
            
            tc = self._context_manager.token_counter
            content_tokens = tc.count(cached.content) if cached.content else 0
            readme_tokens = tc.count(cached.readme) if cached.readme else 0
            
            return {
                "url": cached.url,
                "title": cached.title,
                "type": cached.url_type.value if cached.url_type else "unknown",
                "content": cached.content,
                "readme": cached.readme,
                "symbol_map": cached.symbol_map,
                "description": cached.description,
                "content_tokens": content_tokens,
                "readme_tokens": readme_tokens,
                "fetched_at": cached.fetched_at.isoformat() if cached.fetched_at else None,
                "error": cached.error
            }
        except Exception as e:
            return {"error": str(e), "url": url}
