"""Unit tests for G/L Account hierarchy retrieval tool."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_gl_account_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_glaccountinchartofaccounts" in tool_names


def test_gl_account_get_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "get_a_glaccountinchartofaccounts" in tool_names


@pytest.mark.asyncio
async def test_gl_account_list_returns_hierarchy(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_glaccountinchartofaccounts")
    result = await tool.ainvoke({"$filter": "ChartOfAccounts eq 'INT'", "$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    first = data["results"][0]
    assert "ChartOfAccounts" in first
    assert "GLAccount" in first


@pytest.mark.asyncio
async def test_gl_account_get_returns_single(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "get_a_glaccountinchartofaccounts")
    result = await tool.ainvoke({"ChartOfAccounts": "INT", "GLAccount": "800000"})
    data = json.loads(result)
    assert data["GLAccount"] == "800000"
    assert data["ChartOfAccounts"] == "INT"
