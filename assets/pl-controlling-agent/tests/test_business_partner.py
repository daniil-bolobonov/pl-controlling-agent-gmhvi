"""Unit tests for Business Partner retrieval tool (customer enrichment)."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_business_partner_list_tool_exists(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_businesspartner_for_api_business_partner" in tool_names


@pytest.mark.asyncio
async def test_business_partner_list_returns_customers(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_businesspartner_for_api_business_partner")
    result = await tool.ainvoke({"$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    first = data["results"][0]
    assert "BusinessPartner" in first
    assert "BusinessPartnerFullName" in first
    assert "Country" in first


@pytest.mark.asyncio
async def test_business_partner_get_returns_single(add_agent_to_path):
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "get_a_businesspartner_for_api_business_partner")
    result = await tool.ainvoke({"BusinessPartner": "BP100001"})
    data = json.loads(result)
    assert data["BusinessPartner"] == "BP100001"
    assert data["Country"] == "DE"
