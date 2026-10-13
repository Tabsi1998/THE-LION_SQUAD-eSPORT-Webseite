"""The one error type both result engines raise.

Two engines used to mean two error types, and a caller that wanted to handle
"the result was rejected" had to know which one it was talking to. Since the
write paths are being merged, the failure vocabulary is merged with them.
"""
from __future__ import annotations


class MatchResultError(ValueError):
    """A result was refused. ``status_code`` is what the caller should answer: 422 for a result that breaks the
    contract (services/match_v2_results), 409 for a conflict with the current state - on every entry path the same."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code
