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
        Get detailed breakdown of context token usage.
        
        Args:
            file_paths: List of files currently in context
            fetched_urls: List of URLs that have been fetched
            
        Returns:
            Dict with token breakdown by category
        """
        from ..prompts import build_system_prompt
        
        if not self._context_manager:
            return {"error": "No context manager available"}
        
        tc = self._context_manager.token_counter
        max_input = tc.max_input_tokens
        max_output = tc.max_output_tokens
        
        breakdown = {}
        total_tokens = 0
        
        # System prompt
        system_prompt = build_system_prompt()
        system_tokens = tc.count(system_prompt)
        breakdown["system"] = {
            "tokens": system_tokens,
            "label": "System Prompt"
        }
        total_tokens += system_tokens
        
        # Symbol map
        symbol_map = ""
        symbol_map_tokens = 0
        if self.repo:
            try:
                symbol_map = self.get_context_map(
                    chat_files=file_paths,
                    include_references=True
                )
                if symbol_map:
                    symbol_map_tokens = tc.count(symbol_map)
            except Exception:
                pass
        breakdown["symbol_map"] = {
            "tokens": symbol_map_tokens,
            "label": "Symbol Map"
        }
        total_tokens += symbol_map_tokens
        
        # Files
        file_items = []
        file_total = 0
        if file_paths and self.repo:
            for path in file_paths:
                try:
                    content = self.repo.get_file_content(path)
                    if isinstance(content, dict) and 'error' in content:
                        continue
                    if content:
                        # Match the format used in streaming
                        wrapped = f"{path}\n```\n{content}\n```\n"
                        tokens = tc.count(wrapped)
                        file_items.append({"path": path, "tokens": tokens})
                        file_total += tokens
                except Exception:
                    pass
        breakdown["files"] = {
            "tokens": file_total,
            "label": f"Files ({len(file_items)})",
            "items": file_items
        }
        total_tokens += file_total
        
        # URLs - estimate tokens as they would appear in the prompt
        url_items = []
        url_total = 0
        if fetched_urls:
            fetcher = self._get_url_fetcher()
            for url in fetched_urls:
                try:
                    cached = fetcher.cache.get(url)
                    if cached:
                        # Build the URL content as it would appear in the prompt
                        # (mirrors _build_streaming_messages URL handling)
                        url_part = f"## {cached.url}\n"
                        if cached.title:
                            url_part += f"**{cached.title}**\n\n"
                        
                        # Use readme or content (truncated as in streaming)
                        if cached.readme:
                            readme = cached.readme
                            if len(readme) > 4000:
                                readme = readme[:4000] + "\n\n[truncated...]"
                            url_part += f"{readme}\n"
                        elif cached.content:
                            content = cached.content
                            if len(content) > 4000:
                                content = content[:4000] + "\n\n[truncated...]"
                            url_part += f"{content}\n"
                        
                        if cached.symbol_map:
                            url_part += f"\n### Symbol Map\n```\n{cached.symbol_map}\n```\n"
                        
                        tokens = tc.count(url_part)
                        url_items.append({
                            "url": url,
                            "tokens": tokens,
                            "title": cached.title or url,
                            "type": cached.url_type.value if cached.url_type else "unknown",
                            "fetched_at": cached.fetched_at.isoformat() if cached.fetched_at else None
                        })
                        url_total += tokens
                    else:
                        # URL was passed but not in cache - still show it
                        url_items.append({
                            "url": url,
                            "tokens": 0,
                            "title": url,
                            "type": "unknown",
                            "fetched_at": None,
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
        # Add header overhead if there are URLs (mirrors streaming.py URL_CONTEXT_HEADER)
        if url_items:
            url_header = "# URL Context\n\nThe following content was fetched from URLs mentioned in the conversation:\n\n"
            url_total += tc.count(url_header)
            # Also count the assistant response "Ok, I've reviewed the URL content."
            url_total += tc.count("Ok, I've reviewed the URL content.")
        
        breakdown["urls"] = {
            "tokens": url_total,
            "label": f"URLs ({len(url_items)})",
            "items": url_items
        }
        total_tokens += url_total
        
        # History
        history_tokens = self._context_manager.history_token_count()
        history_count = len(self._context_manager.get_history())
        breakdown["history"] = {
            "tokens": history_tokens,
            "label": f"History ({history_count} messages)",
            "message_count": history_count,
            "max_tokens": self._context_manager.max_history_tokens,
            "needs_summary": self._context_manager.history_needs_summary()
        }
        total_tokens += history_tokens
        
        return {
            "model": self.model,
            "max_input_tokens": max_input,
            "max_output_tokens": max_output,
            "used_tokens": total_tokens,
            "remaining_tokens": max_input - total_tokens,
            "breakdown": breakdown
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
