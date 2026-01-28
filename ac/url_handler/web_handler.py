"""Web page content extraction."""

import urllib.request
import urllib.error
from typing import Optional
from datetime import datetime

from .models import URLContent, URLType


class WebHandler:
    """Handle generic web page content extraction."""
    
    # User agent for requests
    USER_AGENT = (
        "Mozilla/5.0 (compatible; ACBot/1.0; "
        "+https://github.com/anthropics/ac-dc)"
    )
    
    # Timeout for requests in seconds
    REQUEST_TIMEOUT = 30
    
    def __init__(self):
        """Initialize web handler."""
        pass
    
    def fetch_page(self, url: str) -> URLContent:
        """
        Fetch and extract content from a web page.
        
        Uses trafilatura for content extraction, with fallback
        to raw HTML parsing if trafilatura fails.
        
        Args:
            url: URL to fetch
            
        Returns:
            URLContent with extracted content
        """
        try:
            # Fetch raw HTML
            html = self._fetch_html(url)
            if html is None:
                return URLContent(
                    url=url,
                    url_type=URLType.GENERIC_WEB,
                    fetched_at=datetime.now(),
                    error="Failed to fetch page",
                )
            
            # Extract content using trafilatura
            content, metadata = self._extract_content(html, url)
            
            if content is None:
                return URLContent(
                    url=url,
                    url_type=URLType.GENERIC_WEB,
                    fetched_at=datetime.now(),
                    error="Failed to extract content from page",
                )
            
            return URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                title=metadata.get('title'),
                description=metadata.get('description'),
                content=content,
                fetched_at=datetime.now(),
            )
            
        except Exception as e:
            return URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
                error=str(e),
            )
    
    def fetch_documentation(self, url: str) -> URLContent:
        """
        Fetch content from a documentation site.
        
        Same as fetch_page but marks type as DOCUMENTATION.
        
        Args:
            url: Documentation URL to fetch
            
        Returns:
            URLContent with extracted content
        """
        result = self.fetch_page(url)
        result.url_type = URLType.DOCUMENTATION
        return result
    
    def _fetch_html(self, url: str) -> Optional[str]:
        """
        Fetch raw HTML from URL.
        
        Args:
            url: URL to fetch
            
        Returns:
            HTML content or None on failure
        """
        try:
            request = urllib.request.Request(
                url,
                headers={'User-Agent': self.USER_AGENT}
            )
            
            with urllib.request.urlopen(
                request, 
                timeout=self.REQUEST_TIMEOUT
            ) as response:
                # Try to detect encoding from headers
                charset = response.headers.get_content_charset()
                if charset is None:
                    charset = 'utf-8'
                
                return response.read().decode(charset, errors='replace')
                
        except urllib.error.HTTPError as e:
            print(f"HTTP error fetching {url}: {e.code} {e.reason}")
            return None
        except urllib.error.URLError as e:
            print(f"URL error fetching {url}: {e.reason}")
            return None
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return None
    
    def _extract_content(
        self, 
        html: str, 
        url: str
    ) -> tuple[Optional[str], dict]:
        """
        Extract main content and metadata from HTML.
        
        Uses trafilatura for intelligent content extraction.
        
        Args:
            html: Raw HTML content
            url: Original URL (for context)
            
        Returns:
            Tuple of (content, metadata dict)
        """
        try:
            import trafilatura
            from trafilatura.settings import use_config
            
            # Configure trafilatura for better extraction
            config = use_config()
            config.set("DEFAULT", "EXTRACTION_TIMEOUT", "30")
            
            # Extract main content
            content = trafilatura.extract(
                html,
                url=url,
                include_comments=False,
                include_tables=True,
                include_links=False,
                include_images=False,
                output_format='txt',
                config=config,
            )
            
            # Extract metadata
            metadata = {}
            meta = trafilatura.extract_metadata(html, url=url)
            if meta:
                metadata['title'] = meta.title
                metadata['description'] = meta.description
                metadata['author'] = meta.author
                metadata['date'] = meta.date
            
            return content, metadata
            
        except ImportError:
            print("Warning: trafilatura not installed, using fallback")
            return self._fallback_extract(html)
        except Exception as e:
            print(f"Trafilatura extraction failed: {e}, using fallback")
            return self._fallback_extract(html)
    
    def _fallback_extract(self, html: str) -> tuple[Optional[str], dict]:
        """
        Fallback content extraction using basic HTML parsing.
        
        Args:
            html: Raw HTML content
            
        Returns:
            Tuple of (content, metadata dict)
        """
        import re
        
        metadata = {}
        
        # Extract title
        title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
        if title_match:
            metadata['title'] = title_match.group(1).strip()
        
        # Extract meta description
        desc_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            re.IGNORECASE
        )
        if desc_match:
            metadata['description'] = desc_match.group(1).strip()
        
        # Basic content extraction: remove scripts, styles, tags
        content = html
        
        # Remove script and style blocks
        content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
        content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)
        
        # Remove HTML tags
        content = re.sub(r'<[^>]+>', ' ', content)
        
        # Clean up whitespace
        content = re.sub(r'\s+', ' ', content).strip()
        
        # Decode HTML entities
        try:
            import html as html_module
            content = html_module.unescape(content)
        except Exception:
            pass
        
        if not content:
            return None, metadata
        
        return content, metadata
