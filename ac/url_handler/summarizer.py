"""Summarization of URL content using smaller/faster LLM."""

import time
import litellm as _litellm
from typing import Optional

from .models import URLContent, URLType, SummaryType


# Prompts tailored for each summary type
SUMMARY_PROMPTS = {
    SummaryType.BRIEF: """Provide a 2-3 paragraph overview of this content.
Focus on: what it is, what problem it solves, and who would use it.
Be concise but informative.""",

    SummaryType.USAGE: """Summarize how to use this library/tool.
Include:
- Installation instructions (if present)
- Basic usage patterns and examples
- Key imports or entry points
- Common configuration options
Format as a practical quick-start guide.""",

    SummaryType.API: """Extract the public API from this content.
List:
- Main classes and their key methods
- Important functions and their signatures
- Key constants or configuration options
Format as a reference, not prose.""",

    SummaryType.ARCHITECTURE: """Describe the architecture and design of this codebase.
Cover:
- Module organization and dependencies
- Key design patterns used
- Data flow between components
- Extension points or plugin systems
Focus on how the pieces fit together.""",

    SummaryType.EVALUATION: """Evaluate this library/project for potential use.
Assess:
- Maturity and maintenance status
- Documentation quality
- Dependency footprint
- Potential alternatives
- Red flags or concerns
Be balanced and objective.""",
}


SYSTEM_PROMPT = """You are a technical documentation expert. Your job is to analyze code repositories and documentation, then produce focused summaries.

Guidelines:
- Be concise and direct
- Use technical terminology appropriately
- Include specific details (function names, class names) when relevant
- Format output for easy scanning (use lists, headers as needed)
- If information is missing or unclear, say so briefly rather than guessing"""


class Summarizer:
    """Summarizes URL content using a smaller/faster LLM."""
    
    def __init__(self, model: str = "claude-3-5-haiku-latest"):
        """
        Initialize summarizer.
        
        Args:
            model: Model to use for summarization (should be fast/cheap)
        """
        self.model = model
    
    def summarize(
        self,
        content: URLContent,
        summary_type: SummaryType = SummaryType.BRIEF,
        context: Optional[str] = None,
    ) -> str:
        """
        Generate a summary of URL content.
        
        Args:
            content: The fetched URL content to summarize
            summary_type: Type of summary to generate
            context: Optional user context (e.g., their question about the URL)
            
        Returns:
            Generated summary string
            
        Raises:
            Exception: If summarization fails
        """
        # Build the content to summarize
        text_parts = []
        
        if content.title:
            text_parts.append(f"# {content.title}")
        
        if content.description:
            text_parts.append(f"Description: {content.description}")
        
        if content.readme:
            text_parts.append(f"## README\n{content.readme}")
        
        if content.symbol_map:
            text_parts.append(f"## Code Structure (Symbol Map)\n{content.symbol_map}")
        
        if content.content:
            # For web pages, the main content
            text_parts.append(f"## Content\n{content.content}")
        
        if not text_parts:
            return "No content available to summarize."
        
        full_content = "\n\n".join(text_parts)
        
        # Truncate if too long (leave room for prompt and response)
        max_content_length = 100000  # ~25k tokens rough estimate
        if len(full_content) > max_content_length:
            full_content = full_content[:max_content_length] + "\n\n[Content truncated...]"
        
        # Build the user prompt
        type_prompt = SUMMARY_PROMPTS.get(summary_type, SUMMARY_PROMPTS[SummaryType.BRIEF])
        
        user_prompt = f"{type_prompt}\n\n"
        
        if context:
            user_prompt += f"User's context/question: {context}\n\n"
        
        user_prompt += f"URL: {content.url}\n"
        user_prompt += f"Type: {content.url_type.value}\n\n"
        user_prompt += f"---\n\n{full_content}"
        
        # Call the LLM
        print(f"      🤖 Calling summarizer model: {self.model}")
        print(f"      Content length: {len(full_content):,} chars, prompt length: {len(user_prompt):,} chars")
        
        llm_start = time.time()
        response = _litellm.completion(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
        )
        llm_time = time.time() - llm_start
        
        # Log token usage if available
        if hasattr(response, 'usage') and response.usage:
            usage = response.usage
            print(f"      ✓ LLM call took: {llm_time:.2f}s")
            print(f"      Tokens: {usage.prompt_tokens} prompt, {usage.completion_tokens} completion")
        else:
            print(f"      ✓ LLM call took: {llm_time:.2f}s (no usage info)")
        
        return response.choices[0].message.content.strip()
    
    def summarize_for_context(
        self,
        content: URLContent,
        user_question: Optional[str] = None,
    ) -> str:
        """
        Generate a summary optimized for inclusion in LLM context.
        
        Automatically chooses summary type based on URL type and content.
        
        Args:
            content: The fetched URL content
            user_question: The user's question (helps tailor the summary)
            
        Returns:
            Summary string ready for inclusion in prompt context
        """
        # Choose summary type based on URL type and content
        if content.url_type == URLType.GITHUB_REPO:
            # For repos with symbol maps, focus on architecture
            if content.symbol_map:
                summary_type = SummaryType.ARCHITECTURE
            else:
                summary_type = SummaryType.BRIEF
        elif content.url_type == URLType.GITHUB_FILE:
            # Single files get brief treatment
            summary_type = SummaryType.BRIEF
        elif content.url_type == URLType.DOCUMENTATION:
            # Docs get usage focus
            summary_type = SummaryType.USAGE
        else:
            summary_type = SummaryType.BRIEF
        
        # If user question hints at what they want, adjust
        if user_question:
            question_lower = user_question.lower()
            if any(word in question_lower for word in ['how to', 'usage', 'example', 'install']):
                summary_type = SummaryType.USAGE
            elif any(word in question_lower for word in ['api', 'function', 'method', 'class']):
                summary_type = SummaryType.API
            elif any(word in question_lower for word in ['architecture', 'design', 'structure']):
                summary_type = SummaryType.ARCHITECTURE
            elif any(word in question_lower for word in ['evaluate', 'compare', 'should i use', 'alternative']):
                summary_type = SummaryType.EVALUATION
        
        return self.summarize(content, summary_type, context=user_question)
