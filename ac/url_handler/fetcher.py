"""Main URL fetcher orchestrating handlers and cache."""

import time
from typing import Optional, List

from .cache import URLCache
from .config import URLConfig
from .detector import URLDetector
from .github_handler import GitHubHandler
from .web_handler import WebHandler
from .summarizer import Summarizer
from .models import URLType, URLContent, URLResult, SummaryType


class URLFetcher:
    """
    Main orchestrator for URL fetching, caching, and summarization.
    
    Routes URLs to appropriate handlers, manages caching, and
    optionally summarizes content.
    """
    
    def __init__(self, config: Optional[URLConfig] = None, summarizer_model: Optional[str] = None):
        """
        Initialize URL fetcher.
        
        Args:
            config: URL configuration. If None, loads default config.
            summarizer_model: Model to use for summarization. If None, uses default.
        """
        self.config = config or URLConfig.load()
        self.cache = URLCache(self.config)
        self.github_handler = GitHubHandler()
        self.web_handler = WebHandler()
        self.summarizer = Summarizer(model=summarizer_model) if summarizer_model else Summarizer()
    
    def fetch(
        self,
        url: str,
        use_cache: bool = True,
        summarize: bool = False,
        summary_type: Optional[SummaryType] = None,
        context: Optional[str] = None,
    ) -> URLResult:
        """
        Fetch content from a URL.
        
        Args:
            url: URL to fetch
            use_cache: Whether to use cached content if available
            summarize: Whether to generate a summary
            summary_type: Type of summary to generate
            context: User's question/context for contextual summarization
            
        Returns:
            URLResult with content and optional summary
        """
        fetch_start = time.time()
        
        # Check cache first
        if use_cache:
            cache_check_start = time.time()
            cached = self.cache.get(url)
            cache_check_time = time.time() - cache_check_start
            
            if cached:
                print(f"🔵 URL cache HIT: {url[:60]}{'...' if len(url) > 60 else ''}")
                print(f"   Fetched at: {cached.fetched_at}")
                print(f"   Type: {cached.url_type.value if cached.url_type else 'unknown'}")
                print(f"   Cache check took: {cache_check_time*1000:.1f}ms")
                
                # Check if we have a cached summary
                if cached.summary:
                    print(f"   📝 Using cached summary (type={cached.summary_type})")
                    result = URLResult(
                        content=cached,
                        cached=True,
                        summary=cached.summary,
                        summary_type=SummaryType(cached.summary_type) if cached.summary_type else None,
                    )
                elif summarize and not cached.error:
                    # Generate summary and update cache
                    print(f"   📝 Summarization requested (summarize={summarize}, type={summary_type})")
                    summary_start = time.time()
                    result = URLResult(content=cached, cached=True)
                    result = self._add_summary(result, summary_type, context)
                    summary_time = time.time() - summary_start
                    print(f"   ✓ Summarization took: {summary_time:.2f}s")
                    
                    # Update cache with summary
                    if result.summary:
                        cached.summary = result.summary
                        cached.summary_type = result.summary_type.value if result.summary_type else None
                        self.cache.set(url, cached)
                        print(f"   💾 Summary cached for future requests")
                else:
                    print(f"   📝 No summarization (summarize={summarize}, error={cached.error})")
                    result = URLResult(content=cached, cached=True)
                
                total_time = time.time() - fetch_start
                print(f"   ⏱️  Total fetch time: {total_time:.2f}s")
                return result
            else:
                print(f"🟡 URL cache MISS: {url[:60]}{'...' if len(url) > 60 else ''}")
                print(f"   Cache check took: {cache_check_time*1000:.1f}ms")
        else:
            print(f"🟠 URL cache BYPASS (use_cache=False): {url[:60]}{'...' if len(url) > 60 else ''}")
        
        # Detect URL type and fetch
        detect_start = time.time()
        url_type, github_info = URLDetector.detect_type(url)
        detect_time = time.time() - detect_start
        print(f"   URL type detection took: {detect_time*1000:.1f}ms -> {url_type.value}")
        
        fetch_content_start = time.time()
        content = self._fetch_by_type(url, url_type, github_info)
        fetch_content_time = time.time() - fetch_content_start
        print(f"   Content fetch took: {fetch_content_time:.2f}s")
        
        # Cache successful fetches
        if not content.error and use_cache:
            cache_set_start = time.time()
            self.cache.set(url, content)
            cache_set_time = time.time() - cache_set_start
            print(f"🟢 URL cached: {url[:60]}{'...' if len(url) > 60 else ''}")
            print(f"   Type: {content.url_type.value if content.url_type else 'unknown'}")
            print(f"   Title: {content.title or '(none)'}")
            print(f"   Cache write took: {cache_set_time*1000:.1f}ms")
        
        result = URLResult(content=content, cached=False)
        
        # Summarize if requested
        if summarize and not content.error:
            print(f"   📝 Summarization requested (summarize={summarize}, type={summary_type})")
            summary_start = time.time()
            result = self._add_summary(result, summary_type, context)
            summary_time = time.time() - summary_start
            print(f"   ✓ Summarization took: {summary_time:.2f}s")
            
            # Store summary in content for caching
            if result.summary and use_cache:
                content.summary = result.summary
                content.summary_type = result.summary_type.value if result.summary_type else None
                self.cache.set(url, content)
                print(f"   💾 Summary cached with content")
        else:
            print(f"   📝 No summarization (summarize={summarize}, error={content.error})")
        
        total_time = time.time() - fetch_start
        print(f"   ⏱️  Total fetch time: {total_time:.2f}s")
        return result
    
    def fetch_multiple(
        self,
        urls: List[str],
        use_cache: bool = True,
        summarize: bool = False,
        summary_type: Optional[SummaryType] = None,
    ) -> List[URLResult]:
        """
        Fetch content from multiple URLs.
        
        Args:
            urls: List of URLs to fetch
            use_cache: Whether to use cached content
            summarize: Whether to generate summaries
            summary_type: Type of summary for all URLs
            
        Returns:
            List of URLResult objects
        """
        return [
            self.fetch(url, use_cache=use_cache, summarize=summarize, summary_type=summary_type)
            for url in urls
        ]
    
    def detect_and_fetch(
        self,
        text: str,
        use_cache: bool = True,
        summarize: bool = False,
        summary_type: Optional[SummaryType] = None,
    ) -> List[URLResult]:
        """
        Detect URLs in text and fetch them all.
        
        Args:
            text: Text that may contain URLs
            use_cache: Whether to use cached content
            summarize: Whether to generate summaries
            summary_type: Type of summary for all URLs
            
        Returns:
            List of URLResult objects for detected URLs
        """
        urls = URLDetector.find_urls(text)
        if not urls:
            return []
        
        return self.fetch_multiple(
            urls,
            use_cache=use_cache,
            summarize=summarize,
            summary_type=summary_type,
        )
    
    def _fetch_by_type(self, url: str, url_type: URLType, github_info) -> URLContent:
        """Route fetch to appropriate handler based on URL type."""
        if url_type == URLType.GITHUB_REPO:
            return self.github_handler.fetch_repo(github_info)
        
        elif url_type == URLType.GITHUB_FILE:
            return self.github_handler.fetch_file(github_info)
        
        elif url_type in (URLType.GITHUB_ISSUE, URLType.GITHUB_PR):
            # For now, treat issues/PRs as web pages
            # TODO: Use GitHub API for richer data
            return self.web_handler.fetch_page(url)
        
        elif url_type == URLType.DOCUMENTATION:
            return self.web_handler.fetch_documentation(url)
        
        elif url_type == URLType.GENERIC_WEB:
            return self.web_handler.fetch_page(url)
        
        else:
            return URLContent(
                url=url,
                url_type=url_type,
                error=f"Unsupported URL type: {url_type.value}",
            )
    
    def _add_summary(
        self,
        result: URLResult,
        summary_type: Optional[SummaryType],
        context: Optional[str],
    ) -> URLResult:
        """Add summary to result."""
        content = result.content
        
        # Check if there's content to summarize
        if not content.readme and not content.content and not content.symbol_map:
            return result
        
        # Generate summary - pass the full URLContent object
        if context:
            # Contextual summary based on user's question
            summary = self.summarizer.summarize_for_context(content, context)
            result.summary = summary
            result.summary_type = SummaryType.BRIEF  # Contextual is a variant of brief
        elif summary_type:
            summary = self.summarizer.summarize(content, summary_type)
            result.summary = summary
            result.summary_type = summary_type
        else:
            # Default to brief summary
            summary = self.summarizer.summarize(content, SummaryType.BRIEF)
            result.summary = summary
            result.summary_type = SummaryType.BRIEF
        
        return result
    
    def invalidate_cache(self, url: str) -> bool:
        """Invalidate cached content for a URL."""
        return self.cache.invalidate(url)
    
    def clear_cache(self) -> int:
        """Clear all cached URL content."""
        return self.cache.clear()
    
    def cleanup_cache(self) -> int:
        """Remove expired entries from cache."""
        return self.cache.cleanup_expired()
