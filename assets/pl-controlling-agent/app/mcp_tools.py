"""MCP tools indirection layer.

This module re-exports get_mcp_tools() from the mcp_providers.agw module,
providing a stable import target that tests can patch without touching
production code.

Usage in agent code:
    from mcp_tools import get_mcp_tools

Usage in tests (conftest.py patches this target):
    monkeypatch.setattr("mcp_tools.get_mcp_tools", mock_get_tools)
"""

from mcp_providers.agw import get_mcp_tools

__all__ = ["get_mcp_tools"]
