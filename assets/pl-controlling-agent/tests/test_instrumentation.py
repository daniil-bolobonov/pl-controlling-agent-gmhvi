"""Unit tests verifying that all 5 milestone log statements are emitted."""
import logging
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


@pytest.mark.asyncio
async def test_m1_achieved_logged_for_pl_query(add_agent_to_path, caplog):
    """M1 achieved log is emitted when a P&L period query is received."""
    from agent import SampleAgent

    mock_tools = []
    mock_result = {"messages": [MagicMock(content="P&L analysis complete")]}

    with patch("agent._load_tools", AsyncMock(return_value=mock_tools)), \
         patch.object(SampleAgent, "_invoke", AsyncMock(return_value=mock_result)):
        agent = SampleAgent()
        with caplog.at_level(logging.INFO, logger="agent"):
            async for _ in agent.stream("Analyze P&L for September 2025", "test-session"):
                pass
        log_messages = caplog.text
        assert "M1.achieved" in log_messages


@pytest.mark.asyncio
async def test_m1_missed_logged_for_non_pl_query(add_agent_to_path, caplog):
    """M1 missed log is emitted when query doesn't match P&L keywords."""
    from agent import SampleAgent

    mock_tools = []
    mock_result = {"messages": [MagicMock(content="Hello!")]}

    with patch("agent._load_tools", AsyncMock(return_value=mock_tools)), \
         patch.object(SampleAgent, "_invoke", AsyncMock(return_value=mock_result)):
        agent = SampleAgent()
        with caplog.at_level(logging.INFO, logger="agent"):
            async for _ in agent.stream("Hello, what can you do?", "test-session"):
                pass
        assert "M1.missed" in caplog.text


@pytest.mark.asyncio
async def test_m2_through_m5_logged(add_agent_to_path, caplog):
    """M2 through M5 log statements are emitted during analysis."""
    from agent import SampleAgent

    mock_tools = []
    mock_result = {"messages": [MagicMock(content="Report delivered")]}

    with patch("agent._load_tools", AsyncMock(return_value=mock_tools)), \
         patch.object(SampleAgent, "_invoke", AsyncMock(return_value=mock_result)):
        agent = SampleAgent()
        with caplog.at_level(logging.INFO, logger="agent"):
            async for _ in agent.stream("Analyze P&L for October 2025", "sess-123"):
                pass
        logs = caplog.text
        assert "M2.achieved" in logs
        assert "M3.achieved" in logs
        assert "M4.achieved" in logs
        assert "M5.achieved" in logs


@pytest.mark.asyncio
async def test_m5_missed_logged_on_exception(add_agent_to_path, caplog):
    """M5 missed log is emitted when agent raises an exception."""
    from agent import SampleAgent

    mock_tools = []

    with patch("agent._load_tools", AsyncMock(return_value=mock_tools)), \
         patch.object(SampleAgent, "_invoke", AsyncMock(side_effect=RuntimeError("API error"))):
        agent = SampleAgent()
        with caplog.at_level(logging.ERROR, logger="agent"):
            async for _ in agent.stream("Analyze P&L for November 2025", "sess-456"):
                pass
        assert "M5.missed" in caplog.text
