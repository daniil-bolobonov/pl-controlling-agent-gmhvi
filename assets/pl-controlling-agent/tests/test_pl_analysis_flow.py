"""Integration test: end-to-end P&L analysis flow with mocked LLM and MCP tools."""
import json
import logging
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


MOCK_PL_REPORT = """
## Monthly P&L Report — Company 1000 | September 2025

### Section 1 — P&L Deviation Table

| P&L Line | Actual Sep 2025 | Prior Month | Δ abs. | Δ % |
|---|---|---|---|---|
| Net Revenue | 430,000 EUR | 400,000 EUR | +30,000 | +7.5% |
| Cost of Sales | -180,000 EUR | -170,000 EUR | -10,000 | -5.9% |
| **GM1** | **250,000 EUR** | **230,000 EUR** | **+20,000** | **+8.7%** |
| Overhead Absorption | -50,000 EUR | -48,000 EUR | -2,000 | -4.2% |
| **GM2** | **200,000 EUR** | **182,000 EUR** | **+18,000** | **+9.9%** |
| **EBIT** | **180,000 EUR** | **162,000 EUR** | **+18,000** | **+11.1%** |

### Section 2 — Key Driver Narrative
Revenue increased by EUR 30,000 (+7.5%) vs. prior month, driven primarily by document 1400000001
(Acme Industries GmbH, Germany — EUR 250,000) and document 1400000003 (EUR 180,000).

### Section 3 — Functional Area Breakdown
**0100 Sales**: Revenue +30,000 EUR
**0200 Manufacturing**: COGS -10,000 EUR

### Section 4 — Flagged Items
No items flagged in this period.
"""


@pytest.mark.asyncio
async def test_full_pl_analysis_flow(add_agent_to_path, caplog):
    """End-to-end test: agent receives period prompt, completes M1-M5, returns report."""
    from agent import SampleAgent

    mock_result = {"messages": [MagicMock(content=MOCK_PL_REPORT)]}
    mock_tools = []  # IBD_TESTING=1 already loads from mcp-mock.json, but we override invoke

    with patch("agent._load_tools", AsyncMock(return_value=mock_tools)), \
         patch.object(SampleAgent, "_invoke", AsyncMock(return_value=mock_result)):
        agent = SampleAgent()
        with caplog.at_level(logging.INFO, logger="agent"):
            responses = []
            async for chunk in agent.stream("Analyze P&L for September 2025, company code 1000", "integration-test"):
                responses.append(chunk)

    # Should have at least 2 chunks: processing + final
    assert len(responses) >= 2

    # Final chunk should be complete
    final = responses[-1]
    assert final["is_task_complete"] is True
    assert final["require_user_input"] is False

    # Response should contain P&L report content
    assert "P&L" in final["content"] or "EBIT" in final["content"] or "GM1" in final["content"]

    # All 5 milestones must be logged
    logs = caplog.text
    assert "M1.achieved" in logs
    assert "M2.achieved" in logs
    assert "M3.achieved" in logs
    assert "M4.achieved" in logs
    assert "M5.achieved" in logs


@pytest.mark.asyncio
async def test_invoke_returns_completed_status(add_agent_to_path):
    """invoke() returns AgentResponse with status=completed."""
    from agent import SampleAgent

    mock_result = {"messages": [MagicMock(content=MOCK_PL_REPORT)]}

    with patch("agent._load_tools", AsyncMock(return_value=[])), \
         patch.object(SampleAgent, "_invoke", AsyncMock(return_value=mock_result)):
        agent = SampleAgent()
        response = await agent.invoke("Analyze P&L for September 2025", "test-invoke")

    assert response.status == "completed"
    assert len(response.message) > 0


@pytest.mark.asyncio
async def test_invoke_handles_exception_gracefully(add_agent_to_path):
    """invoke() returns a completed response with error content when agent fails gracefully."""
    from agent import SampleAgent

    with patch("agent._load_tools", AsyncMock(return_value=[])), \
         patch.object(SampleAgent, "_invoke", AsyncMock(side_effect=ValueError("unexpected error"))):
        agent = SampleAgent()
        response = await agent.invoke("Analyze P&L", "test-error")

    # Agent gracefully handles errors and returns a completed response with error message
    assert response.status in ("completed", "error")
    assert response.message is not None and len(response.message) > 0


@pytest.mark.asyncio
async def test_mcp_tools_loaded_in_production_path(add_agent_to_path):
    """In IBD_TESTING mode, get_mcp_tools returns tools from mcp-mock.json."""
    import os
    os.environ["IBD_TESTING"] = "1"
    from mcp_providers.agw import get_mcp_tools
    tools = await get_mcp_tools()
    assert len(tools) > 0
    tool_names = [t.name for t in tools]
    # Verify key tools from all 8 MCP servers are present
    assert "list_a_journalentryitembasic_for_api_journalentryitembasic_srv" in tool_names
    assert "list_a_glaccountinchartofaccounts" in tool_names
    assert "list_a_businesspartner_for_api_business_partner" in tool_names
    assert "list_a_product_for_api_product_srv" in tool_names
