"""Unit tests for Product Master retrieval tool (product enrichment)."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_product_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_product_for_api_product_srv" in tool_names


def test_product_description_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_productdescription_for_api_product_srv" in tool_names


@pytest.mark.asyncio
async def test_product_list_returns_data(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_product_for_api_product_srv")
    result = await tool.ainvoke({"$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    first = data["results"][0]
    assert "Product" in first
    assert "ProductGroup" in first


@pytest.mark.asyncio
async def test_product_description_returns_enrichment_data(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_productdescription_for_api_product_srv")
    result = await tool.ainvoke({"$filter": "Language eq 'EN'", "$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    assert "ProductDescription" in data["results"][0]
