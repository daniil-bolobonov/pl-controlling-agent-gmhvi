"""Unit tests for G/L Account Line Items drill-down tool."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_gl_line_items_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_glaccountlineitem_for_cds_api_glaccountlineitem" in tool_names


@pytest.mark.asyncio
async def test_gl_line_items_returns_drill_down_data(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_glaccountlineitem_for_cds_api_glaccountlineitem")
    result = await tool.ainvoke({"$filter": "GLAccount eq '800000'", "$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    first = data["results"][0]
    assert "AccountingDocument" in first
    assert "AmountInCompanyCodeCurrency" in first
    assert "PostingDate" in first


@pytest.mark.asyncio
async def test_gl_line_items_aggregate_tool(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "aggregate_glaccountlineitem_for_cds_api_glaccountlineitem")
    result = await tool.ainvoke({"$apply": "groupby((GLAccount),aggregate(AmountInCompanyCodeCurrency with sum as Total))"})
    data = json.loads(result)
    assert "results" in data
