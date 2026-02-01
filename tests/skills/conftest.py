"""
Pytest configuration for skill tests.

Skill tests make real LLM API calls, so they:
- Are slower than unit tests
- Require API keys/credentials to be configured
- May incur costs

Run with: pytest tests/skills/ -v
Skip in CI with: pytest --ignore=tests/skills/
"""

import pytest
import os
import json
from pathlib import Path


def _has_llm_credentials() -> bool:
    """Check if any LLM credentials are available."""
    # Check for direct API keys
    if os.environ.get("OPENAI_API_KEY"):
        return True
    if os.environ.get("ANTHROPIC_API_KEY"):
        return True
    
    # Check for AWS credentials (for Bedrock)
    if os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE") or os.environ.get("AWS_DEFAULT_REGION"):
        return True
    
    # Check if ~/.aws/credentials or config exists (AWS SSO)
    aws_dir = Path.home() / ".aws"
    if (aws_dir / "credentials").exists() or (aws_dir / "config").exists():
        return True
    
    # Check for llm.json config file
    llm_json = Path("llm.json")
    if llm_json.exists():
        return True
    
    return False


def pytest_collection_modifyitems(config, items):
    """Skip skill tests if no LLM credentials are available."""
    if _has_llm_credentials():
        return  # Credentials found, run tests normally
    
    skip_marker = pytest.mark.skip(
        reason="No LLM credentials found. Set API keys, AWS credentials, or ensure llm.json exists."
    )
    for item in items:
        if "skills" in str(item.fspath):
            item.add_marker(skip_marker)
