"""Unit tests for Cost Center retrieval tool."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_cost_center_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_costcenter_2_for_sap_self" in tool_names


@pytest.mark.asyncio
async def test_cost_center_list_returns_data(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_costcenter_2_for_sap_self")
    result = await tool.ainvoke({"$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    assert "CostCenter" in data["results"][0]
    assert "CostCenterName" in data["results"][0]


@pytest.mark.asyncio
async def test_cost_center_get_returns_single(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "get_a_costcenter_2_for_sap_self")
    result = await tool.ainvoke({"CostCenter": "CC1000", "ControllingArea": "A000"})
    data = json.loads(result)
    assert data["CostCenter"] == "CC1000"
    assert "FunctionalArea" in data
