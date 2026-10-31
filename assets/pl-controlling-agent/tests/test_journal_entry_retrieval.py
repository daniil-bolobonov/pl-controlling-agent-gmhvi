"""Unit tests for journal entry item retrieval MCP tool."""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_journal_entry_list_tool_in_mock(add_agent_to_path):
    """Verify list_a_journalentryitembasic tool exists in mock config."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "list_a_journalentryitembasic_for_api_journalentryitembasic_srv" in tool_names


def test_journal_entry_get_tool_in_mock(add_agent_to_path):
    """Verify get_a_journalentryitembasic tool exists in mock config."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert "get_a_journalentryitembasic_for_api_journalentryitembasic_srv" in tool_names


@pytest.mark.asyncio
async def test_journal_entry_list_returns_results(add_agent_to_path):
    """Verify list journal entries tool returns mock results array."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "list_a_journalentryitembasic_for_api_journalentryitembasic_srv")
    result = await tool.ainvoke({"$filter": "CompanyCode eq '1000'", "$top": "100"})
    data = json.loads(result)
    assert "results" in data
    assert len(data["results"]) > 0
    first = data["results"][0]
    assert "CompanyCode" in first
    assert "GLAccount" in first
    assert "AmountInCompanyCodeCurrency" in first


@pytest.mark.asyncio
async def test_journal_entry_get_returns_single(add_agent_to_path):
    """Verify get journal entry tool returns a single item."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if t.name == "get_a_journalentryitembasic_for_api_journalentryitembasic_srv")
    result = await tool.ainvoke({
        "CompanyCode": "1000", "FiscalYear": "2025",
        "AccountingDocument": "1400000001", "AccountingDocumentItem": "001"
    })
    data = json.loads(result)
    assert data["CompanyCode"] == "1000"
    assert data["AccountingDocument"] == "1400000001"
