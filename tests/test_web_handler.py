"""Tests for web page handler."""

import pytest
from unittest.mock import patch, MagicMock

from ac.url_handler import WebHandler, URLType


class TestWebHandlerInit:
    """Tests for WebHandler initialization."""
    
    def test_init(self):
        handler = WebHandler()
        assert handler is not None


class TestWebHandlerFetchHtml:
    """Tests for HTML fetching."""
    
    @patch('urllib.request.urlopen')
    def test_fetch_html_success(self, mock_urlopen):
        handler = WebHandler()
        
        mock_response = MagicMock()
        mock_response.read.return_value = b"<html><body>Test</body></html>"
        mock_response.headers.get_content_charset.return_value = 'utf-8'
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_response
        
        result = handler._fetch_html("https://example.com")
        assert result == "<html><body>Test</body></html>"
    
    @patch('urllib.request.urlopen')
    def test_fetch_html_http_error(self, mock_urlopen):
        import urllib.error
        handler = WebHandler()
        
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="", code=404, msg="Not Found", hdrs={}, fp=None
        )
        
        result = handler._fetch_html("https://example.com/notfound")
        assert result is None
    
    @patch('urllib.request.urlopen')
    def test_fetch_html_timeout(self, mock_urlopen):
        import urllib.error
        handler = WebHandler()
        
        mock_urlopen.side_effect = urllib.error.URLError("timeout")
        
        result = handler._fetch_html("https://example.com")
        assert result is None
    
    @patch('urllib.request.urlopen')
    def test_fetch_html_default_charset(self, mock_urlopen):
        """Should default to utf-8 if no charset in headers."""
        handler = WebHandler()
        
        mock_response = MagicMock()
        mock_response.read.return_value = b"<html>Test</html>"
        mock_response.headers.get_content_charset.return_value = None
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_response
        
        result = handler._fetch_html("https://example.com")
        assert result == "<html>Test</html>"


class TestWebHandlerFallbackExtract:
    """Tests for fallback HTML extraction."""
    
    def test_extract_title(self):
        handler = WebHandler()
        html = "<html><head><title>Test Page</title></head></html>"
        
        content, metadata = handler._fallback_extract(html)
        assert metadata.get('title') == "Test Page"
    
    def test_extract_description(self):
        handler = WebHandler()
        html = '''<html><head>
            <meta name="description" content="A test description">
        </head></html>'''
        
        content, metadata = handler._fallback_extract(html)
        assert metadata.get('description') == "A test description"
    
    def test_remove_scripts(self):
        handler = WebHandler()
        html = """<html><body>
            <script>alert('bad');</script>
            <p>Good content</p>
        </body></html>"""
        
        content, metadata = handler._fallback_extract(html)
        assert "alert" not in content
        assert "Good content" in content
    
    def test_remove_styles(self):
        handler = WebHandler()
        html = """<html><body>
            <style>.hidden { display: none; }</style>
            <p>Visible content</p>
        </body></html>"""
        
        content, metadata = handler._fallback_extract(html)
        assert "display" not in content
        assert "Visible content" in content
    
    def test_remove_tags(self):
        handler = WebHandler()
        html = "<html><body><p>Hello <strong>World</strong></p></body></html>"
        
        content, metadata = handler._fallback_extract(html)
        assert "<p>" not in content
        assert "<strong>" not in content
        assert "Hello" in content
        assert "World" in content


class TestWebHandlerExtractContent:
    """Tests for trafilatura-based content extraction."""
    
    @patch('trafilatura.extract')
    @patch('trafilatura.extract_metadata')
    def test_extract_with_trafilatura(self, mock_metadata, mock_extract):
        handler = WebHandler()
        
        mock_extract.return_value = "Extracted content here"
        mock_meta = MagicMock()
        mock_meta.title = "Page Title"
        mock_meta.description = "Page description"
        mock_meta.author = None
        mock_meta.date = None
        mock_metadata.return_value = mock_meta
        
        content, metadata = handler._extract_content(
            "<html><body>Test</body></html>",
            "https://example.com"
        )
        
        assert content == "Extracted content here"
        assert metadata['title'] == "Page Title"
        assert metadata['description'] == "Page description"
    
    @patch('trafilatura.extract')
    def test_extract_trafilatura_returns_none(self, mock_extract):
        """Should use fallback when trafilatura returns None."""
        handler = WebHandler()
        mock_extract.return_value = None
        
        # Mock extract_metadata to also return None
        with patch('trafilatura.extract_metadata', return_value=None):
            content, metadata = handler._extract_content(
                "<html><head><title>Fallback</title></head><body>Body</body></html>",
                "https://example.com"
            )
        
        # Returns None content when trafilatura fails
        assert content is None


class TestWebHandlerFetchPage:
    """Tests for full page fetching."""
    
    @patch.object(WebHandler, '_fetch_html')
    @patch.object(WebHandler, '_extract_content')
    def test_fetch_page_success(self, mock_extract, mock_fetch):
        handler = WebHandler()
        
        mock_fetch.return_value = "<html>Test</html>"
        mock_extract.return_value = ("Page content", {"title": "Test"})
        
        result = handler.fetch_page("https://example.com")
        
        assert result.error is None
        assert result.content == "Page content"
        assert result.title == "Test"
        assert result.url_type == URLType.GENERIC_WEB
    
    @patch.object(WebHandler, '_fetch_html')
    def test_fetch_page_html_failure(self, mock_fetch):
        handler = WebHandler()
        mock_fetch.return_value = None
        
        result = handler.fetch_page("https://example.com")
        
        assert result.error == "Failed to fetch page"
        assert result.content is None
    
    @patch.object(WebHandler, '_fetch_html')
    @patch.object(WebHandler, '_extract_content')
    def test_fetch_page_extract_failure(self, mock_extract, mock_fetch):
        handler = WebHandler()
        mock_fetch.return_value = "<html>Test</html>"
        mock_extract.return_value = (None, {})
        
        result = handler.fetch_page("https://example.com")
        
        assert result.error == "Failed to extract content from page"


class TestWebHandlerFetchDocumentation:
    """Tests for documentation fetching."""
    
    @patch.object(WebHandler, '_fetch_html')
    @patch.object(WebHandler, '_extract_content')
    def test_fetch_documentation_sets_type(self, mock_extract, mock_fetch):
        handler = WebHandler()
        
        mock_fetch.return_value = "<html>Docs</html>"
        mock_extract.return_value = ("Documentation content", {"title": "API Docs"})
        
        result = handler.fetch_documentation("https://docs.example.com/api")
        
        assert result.url_type == URLType.DOCUMENTATION
        assert result.content == "Documentation content"
