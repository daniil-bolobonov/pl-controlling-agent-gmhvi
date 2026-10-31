"""Unit tests for Functional Area retrieval tool."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_functional_area_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_functionalarea_for_api_functionalarea_srv" in tool_names


@pytest.mark.asyncio
async def test_functional_area_list_returns_data(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_functionalarea_for_api_functionalarea_srv")
    result = await tool.ainvoke({"$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    assert "FunctionalArea" in data["results"][0]
    assert "FunctionalAreaName" in data["results"][0]


@pytest.mark.asyncio
async def test_functional_area_get_returns_single(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "get_a_functionalarea_for_api_functionalarea_srv")
    result = await tool.ainvoke({"FunctionalArea": "0100"})
    data = json.loads(result)
    assert data["FunctionalArea"] == "0100"
