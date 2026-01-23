"""
Utility functions for message building.
"""


def filter_empty_messages(messages):
    """
    Filter out messages with empty content that some providers reject.
    
    Args:
        messages: List of message dicts
        
    Returns:
        Filtered list with no empty content fields
    """
    filtered = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            has_content = any(
                (part.get("type") == "text" and part.get("text", "").strip()) or
                part.get("type") == "image_url"
                for part in content
            )
            if has_content:
                filtered.append(msg)
        elif content and content.strip():
            filtered.append(msg)
    return filtered


def build_user_content(text, images=None):
    """
    Build user message content, optionally with images.
    
    Args:
        text: The text content
        images: Optional list of image dicts with 'data' and 'mime_type'
        
    Returns:
        String for text-only, or list for multimodal content
    """
    if not images:
        return text
    
    content = [{"type": "text", "text": text}]
    
    for img in images:
        if isinstance(img, dict):
            data = img.get('data', '')
            mime_type = img.get('mime_type', 'image/png')
        else:
            data = img
            mime_type = 'image/png'
        
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{data}"
            }
        })
    
    return content
