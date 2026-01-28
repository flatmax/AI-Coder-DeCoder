"""Tests for URL handler configuration."""

import pytest
import json
import tempfile
from pathlib import Path

from ac.url_handler import URLConfig
from ac.url_handler.config import URLCacheConfig


class TestURLCacheConfig:
    """Tests for URLCacheConfig defaults."""
    
    def test_defaults(self):
        config = URLCacheConfig()
        assert config.path == "/tmp/ac_url_cache"
        assert config.ttl_hours == 24


class TestURLConfigLoad:
    """Tests for URLConfig loading."""
    
    def test_load_defaults_when_missing(self):
        config = URLConfig.load("/nonexistent/path/ac-dc.json")
        assert config.cache.path == "/tmp/ac_url_cache"
        assert config.cache.ttl_hours == 24
    
    def test_load_from_file(self, tmp_path):
        config_file = tmp_path / "ac-dc.json"
        config_file.write_text(json.dumps({
            "url_cache": {
                "path": "/custom/cache",
                "ttl_hours": 48
            }
        }))
        
        config = URLConfig.load(str(config_file))
        assert config.cache.path == "/custom/cache"
        assert config.cache.ttl_hours == 48
    
    def test_load_partial_config(self, tmp_path):
        config_file = tmp_path / "ac-dc.json"
        config_file.write_text(json.dumps({
            "url_cache": {
                "ttl_hours": 12
            }
        }))
        
        config = URLConfig.load(str(config_file))
        assert config.cache.path == "/tmp/ac_url_cache"  # default
        assert config.cache.ttl_hours == 12
    
    def test_load_invalid_json(self, tmp_path, capsys):
        config_file = tmp_path / "ac-dc.json"
        config_file.write_text("not valid json")
        
        config = URLConfig.load(str(config_file))
        # Should use defaults
        assert config.cache.ttl_hours == 24
        
        captured = capsys.readouterr()
        assert "Warning" in captured.out


class TestURLConfigMethods:
    """Tests for URLConfig methods."""
    
    def test_to_dict(self):
        config = URLConfig(cache=URLCacheConfig(
            path="/test/path",
            ttl_hours=12
        ))
        d = config.to_dict()
        assert d == {
            "url_cache": {
                "path": "/test/path",
                "ttl_hours": 12
            }
        }
    
    def test_ensure_cache_dir(self, tmp_path):
        cache_path = tmp_path / "test_cache"
        config = URLConfig(cache=URLCacheConfig(
            path=str(cache_path),
            ttl_hours=24
        ))
        
        assert not cache_path.exists()
        result = config.ensure_cache_dir()
        assert cache_path.exists()
        assert result == cache_path
