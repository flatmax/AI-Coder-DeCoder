"""
Context builder mixin for tier-based content organization.

Consolidates the logic for building cache-tiered context that's shared
between streaming chat and context breakdown visualization.
"""

from typing import Callable, Optional

from ..context.stability_tracker import (
    TIER_THRESHOLDS, TIER_NAMES, TIER_ORDER, CACHE_TIERS,
)


class ContextBuilderMixin:
    """Mixin for building cache-tiered context structures."""
    
    @staticmethod
    def _is_error_response(result) -> bool:
        """Check if a result is an error dict from the repo layer."""
        return isinstance(result, dict) and 'error' in result
    
    def _get_file_content_safe(self, path: str, version='working') -> str | None:
        """Get file content from repo, returning None on error.
        
        Handles the repo layer's error-dict pattern in one place.
        
        Args:
            path: File path relative to repo root
            version: 'working', 'HEAD', or commit hash
            
        Returns:
            File content string, or None if unavailable
        """
        if not self.repo:
            return None
        try:
            content = self.repo.get_file_content(path, version=version)
            if self._is_error_response(content) or not content:
                return None
            return content
        except Exception:
            return None
    
    def _safe_count_tokens(self, content: str) -> int:
        """Count tokens with error handling.
        
        Args:
            content: Text to count tokens for
            
        Returns:
            Token count, or 0 on error
        """
        if not content or not self._context_manager:
            return 0
        try:
            return self._context_manager.count_tokens(content)
        except Exception:
            return 0
    
    def _get_stability_tracker(self):
        """Get the stability tracker if available."""
        if self._context_manager:
            return self._context_manager.cache_stability
        return None
    
    def _get_file_tiers(self, file_paths: list[str]) -> dict[str, list[str]]:
        """Organize file paths into stability tiers.
        
        Args:
            file_paths: List of file paths to organize
            
        Returns:
            Dict mapping tier names to lists of file paths
        """
        file_tiers = {tier: [] for tier in TIER_ORDER}
        
        if not file_paths:
            return file_tiers
        
        stability = self._get_stability_tracker()
        if stability:
            tracked_tiers = stability.get_items_by_tier(list(file_paths))
            for tier in TIER_ORDER:
                file_tiers[tier] = tracked_tiers.get(tier, [])
            # Untracked files go to active
            tracked = set()
            for tier_files in file_tiers.values():
                tracked.update(tier_files)
            for path in file_paths:
                if path not in tracked:
                    file_tiers['active'].append(path)
        else:
            file_tiers['active'] = list(file_paths)
        
        return file_tiers
    
    def _get_symbol_tiers(
        self,
        symbols_by_file: dict,
        exclude_files: set[str]
    ) -> dict[str, list[str]]:
        """Organize symbol entries into stability tiers.
        
        Args:
            symbols_by_file: Dict mapping file paths to symbol lists
            exclude_files: Files to exclude (e.g., files in active context)
            
        Returns:
            Dict mapping tier names to lists of file paths (for their symbols)
        """
        symbol_tiers = {tier: [] for tier in TIER_ORDER}
        
        if not symbols_by_file:
            return symbol_tiers
        
        # Symbol entries use "symbol:" prefix
        symbol_items = [f"symbol:{f}" for f in symbols_by_file.keys()]
        
        stability = self._get_stability_tracker()
        if stability:
            tracked_tiers = stability.get_items_by_tier(symbol_items)
            for tier in TIER_ORDER:
                tracked_tiers.setdefault(tier, [])
            
            # Untracked symbols go to L3
            tracked = set()
            for tier_items in tracked_tiers.values():
                tracked.update(tier_items)
            for item in symbol_items:
                if item not in tracked:
                    tracked_tiers['L3'].append(item)
            
            # Convert back to file paths, excluding active context files
            for tier, items in tracked_tiers.items():
                symbol_tiers[tier] = [
                    item.replace("symbol:", "") for item in items
                    if item.startswith("symbol:") 
                    and item.replace("symbol:", "") not in exclude_files
                ]
        else:
            # No stability tracker - all symbols go to L3
            symbol_tiers['L3'] = [
                f for f in symbols_by_file.keys() 
                if f not in exclude_files
            ]
        
        return symbol_tiers
    
    def _get_symbol_map_data(
        self,
        active_context_files: set[str],
        file_paths: list[str] = None,
    ) -> tuple[dict, dict, str, int]:
        """Get symbol map content organized by tier.
        
        Args:
            active_context_files: Files in active context (to exclude from map)
            file_paths: All files to consider
            
        Returns:
            Tuple of (symbol_map_content, symbol_files_by_tier, legend, legend_tokens)
            - symbol_map_content: Dict mapping tier to formatted symbol content
            - symbol_files_by_tier: Dict mapping tier to file path lists
            - legend: Legend string for symbol map
            - legend_tokens: Token count for legend
        """
        from ..symbol_index.compact_format import (
            get_legend,
            format_symbol_blocks_by_tier,
            _compute_path_aliases,
        )
        
        symbol_map_content = {}
        symbol_files_by_tier = {tier: [] for tier in TIER_ORDER}
        legend = ""
        legend_tokens = 0
        
        if not self.repo:
            return symbol_map_content, symbol_files_by_tier, legend, legend_tokens
        
        try:
            all_files = self._get_all_trackable_files()
            if not all_files:
                return symbol_map_content, symbol_files_by_tier, legend, legend_tokens
            
            si = self._get_symbol_index()
            symbols_by_file = si.index_files(all_files)
            
            # Build references for cross-file information
            si.build_references(all_files)
            
            # Get reference data
            file_refs = {}
            file_imports = {}
            references = {}
            if hasattr(si, '_reference_index') and si._reference_index:
                ref_index = si._reference_index
                for f in all_files:
                    file_refs[f] = ref_index.get_files_referencing(f)
                    file_imports[f] = ref_index.get_file_dependencies(f)
                    references[f] = ref_index.get_references_to_file(f)
            
            # Initialize stability tracker from refs if fresh start
            stability = self._get_stability_tracker()
            if stability and not stability.is_initialized():
                self._initialize_stability_from_refs(
                    stability, all_files, symbols_by_file, file_refs,
                    active_context_files, file_paths
                )
            
            # Compute path aliases for the legend
            aliases = _compute_path_aliases(references, file_refs)
            legend = get_legend(aliases)
            legend_tokens = self._safe_count_tokens(legend)
            
            # Get symbol tiers
            symbol_files_by_tier = self._get_symbol_tiers(
                symbols_by_file, active_context_files
            )
            
            # Format symbol blocks by tier
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
        
        return symbol_map_content, symbol_files_by_tier, legend, legend_tokens
    
    def _initialize_stability_from_refs(
        self,
        stability,
        all_files: list[str],
        symbols_by_file: dict,
        file_refs: dict,
        active_context_files: set[str],
        file_paths: list[str] = None,
    ) -> None:
        """Initialize stability tracker from reference counts.
        
        Args:
            stability: StabilityTracker instance
            all_files: All trackable files
            symbols_by_file: Dict of file -> symbols
            file_refs: Dict of file -> referencing files
            active_context_files: Files to exclude from initialization
            file_paths: Current context file paths
        """
        tc = self._context_manager.token_counter if self._context_manager else None
        if not tc:
            return
        
        files_with_refs = []
        for f in all_files:
            ref_count = len(file_refs.get(f, set()))
            content = self._get_file_content_safe(f)
            tokens = tc.count(f"{f}\n```\n{content}\n```\n") if content else 0
            files_with_refs.append((f, ref_count, tokens))
        
        # Also include symbol entries
        for f in symbols_by_file.keys():
            ref_count = len(file_refs.get(f, set()))
            # Estimate tokens for symbol block
            tokens = self._safe_count_tokens(str(symbols_by_file[f]))
            files_with_refs.append((f"symbol:{f}", ref_count, tokens))
        
        tier_assignments = stability.initialize_from_refs(
            files_with_refs,
            exclude_active=active_context_files,
            target_tokens=stability.get_cache_target_tokens(),
        )
        if tier_assignments:
            print(f"📊 Initialized {len(tier_assignments)} items from ref counts")
    
    def _build_file_items(
        self,
        file_paths: list[str],
    ) -> tuple[list[dict], int]:
        """Build file items with token counts and stability info.
        
        Args:
            file_paths: List of file paths
            
        Returns:
            Tuple of (file_items, total_tokens)
        """
        file_items = []
        total_tokens = 0
        stability = self._get_stability_tracker()
        
        for path in file_paths:
            content = self._get_file_content_safe(path)
            if content:
                path_tokens = self._safe_count_tokens(
                    f"{path}\n```\n{content}\n```\n"
                )
                total_tokens += path_tokens
                
                info = {'stable_count': 0, 'next_tier': 'L3', 
                        'next_threshold': 3, 'progress': 0.0}
                if stability:
                    info = stability.get_item_info(path)
                
                file_items.append({
                    "path": path,
                    "tokens": path_tokens,
                    "stable_count": info['stable_count'],
                    "next_tier": info['next_tier'],
                    "next_threshold": info['next_threshold'],
                    "progress": info['progress'],
                })
        
        return file_items, total_tokens
    
    def _build_symbol_items(
        self,
        file_paths: list[str],
    ) -> list[dict]:
        """Build symbol items with stability info.
        
        Args:
            file_paths: List of file paths (for their symbol entries)
            
        Returns:
            List of symbol item dicts
        """
        items = []
        stability = self._get_stability_tracker()
        
        for f in file_paths:
            info = {'stable_count': 0, 'next_tier': 'L3',
                    'next_threshold': 3, 'progress': 0.0}
            if stability:
                info = stability.get_item_info(f"symbol:{f}")
            
            items.append({
                "path": f,
                "stable_count": info['stable_count'],
                "next_tier": info['next_tier'],
                "next_threshold": info['next_threshold'],
                "progress": info['progress'],
            })
        
        return items
    
    def _build_url_items(
        self,
        fetched_urls: list[str],
    ) -> tuple[list[dict], int]:
        """Build URL items with token counts.
        
        Args:
            fetched_urls: List of fetched URLs
            
        Returns:
            Tuple of (url_items, total_tokens)
        """
        url_items = []
        url_tokens = 0
        
        if not fetched_urls:
            return url_items, url_tokens
        
        fetcher = self._get_url_fetcher()
        
        for url in fetched_urls:
            try:
                cached = fetcher.cache.get(url)
                if cached:
                    tokens = self._safe_count_tokens(cached.format_for_prompt())
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
                        "url": url, "tokens": 0, "title": url,
                        "type": "unknown", "not_cached": True
                    })
            except Exception as e:
                url_items.append({
                    "url": url, "tokens": 0, "title": url,
                    "type": "error", "error": str(e)
                })
        
        if url_items:
            # Add header overhead
            url_tokens += self._safe_count_tokens(
                "# URL Context\n\nThe following content was fetched from URLs "
                "mentioned in the conversation:\n\n"
            )
            url_tokens += self._safe_count_tokens(
                "Ok, I've reviewed the URL content."
            )
        
        return url_items, url_tokens
    
    def _make_tier_info(self) -> dict:
        """Create empty tier info structure.
        
        Returns:
            Dict with per-tier tracking structures
        """
        return {
            'L0': {'tokens': 0, 'symbols': 0, 'files': 0, 
                   'has_system': False, 'has_legend': False, 'has_tree': False},
            'L1': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False},
            'L2': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False},
            'L3': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False},
            'active': {'tokens': 0, 'symbols': 0, 'files': 0, 
                       'has_tree': False, 'has_urls': False, 'has_history': False},
            'empty_tiers': 0,
        }
