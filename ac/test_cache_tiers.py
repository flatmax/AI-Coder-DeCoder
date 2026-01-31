"""
Test file for cache tier experiments.

This file is used to test the stability tracker's behavior
when files are edited vs. when they remain unchanged.
"""


def calculate_sum(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


def calculate_product(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b


class Counter:
    """A simple counter class."""
    
    def __init__(self, start: int = 0):
        self.value = start
    
    def increment(self) -> int:
        """Increment and return new value."""
        self.value += 1
        return self.value
    
    def decrement(self) -> int:
        """Decrement and return new value."""
        self.value -= 1
        return self.value
    
    def reset(self) -> None:
        """Reset to zero."""
        self.value = 0
    
    def double(self) -> int:
        """Double the current value and return it."""
        self.value *= 2
        return self.value
