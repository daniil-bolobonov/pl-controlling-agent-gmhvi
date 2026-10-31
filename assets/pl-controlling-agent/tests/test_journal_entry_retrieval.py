"""Unit tests for GL account line item MCP tool (API_GLACCOUNTLINEITEM).

Replaces the former test_journal_entry_retrieval.py which tested
API_JOURNALENTRYITEMBASIC_SRV — that API is no longer used for P&L
line retrieval (it lacks a standalone FiscalYear filter field).
"""
import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def test_gl_line_item_list_tool_in_mock(add_agent_to_path):
    """Verify list_glaccountlineitem tool exists in mock config."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool_names = [t.name for t in tools]
    assert any("list_glaccountlineitem" in n for n in tool_names), (
        f"No list_glaccountlineitem tool found. Available: {tool_names}"
    )


@pytest.mark.asyncio
async def test_gl_line_item_list_returns_results(add_agent_to_path):
    """Verify list_glaccountlineitem tool returns mock results with required fields."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if "list_glaccountlineitem" in t.name)
    result = await tool.ainvoke({
        "filter": "Ledger eq '0L' and CompanyCode eq '1710' "
                  "and GLAccount ge '40000000' and GLAccount le '79999999' "
                  "and FiscalYear eq '2026' and FiscalPeriod eq '010'",
        "top": 10,
        "skip": 0,
    })
    data = json.loads(result)
    # Accept both OData v2 (d.results) and v4 (value) envelopes
    rows = data.get("value") or data.get("d", {}).get("results") or []
    assert len(rows) > 0, f"Expected results, got: {data}"
    first = rows[0]
    assert "GLAccount" in first
    assert "AmountInCompanyCodeCurrency" in first
    assert "CompanyCode" in first


@pytest.mark.asyncio
async def test_gl_line_item_filter_uses_no_dollar_prefix(add_agent_to_path):
    """Verify tool accepts 'filter' (no $) — $ prefix is silently dropped by MCP layer."""
    from mcp_providers.agw import _build_mock_tools
    tools = _build_mock_tools()
    tool = next(t for t in tools if "list_glaccountlineitem" in t.name)
    # Must not raise even when called with no-$ params
    result = await tool.ainvoke({
        "filter": "Ledger eq '0L' and CompanyCode eq '1710' "
                  "and FiscalYear eq '2026' and FiscalPeriod eq '010'",
        "top": 5,
        "skip": 0,
    })
    assert result is not None
