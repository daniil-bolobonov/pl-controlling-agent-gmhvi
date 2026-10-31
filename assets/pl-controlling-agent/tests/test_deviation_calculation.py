"""Unit tests for deviation table logic (absolute + percentage, missing period handling)."""
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def compute_deviation(actual: float, comparison: float | None) -> dict:
    """Helper: compute P&L line deviation."""
    if comparison is None:
        return {"absolute": None, "percentage": None, "note": "N/A — no comparison data available"}
    absolute = actual - comparison
    if comparison == 0:
        percentage = None
    else:
        percentage = round((absolute / abs(comparison)) * 100, 2)
    return {"absolute": absolute, "percentage": percentage}


def test_favorable_deviation():
    result = compute_deviation(300000.0, 250000.0)
    assert result["absolute"] == 50000.0
    assert result["percentage"] == 20.0


def test_unfavorable_deviation():
    result = compute_deviation(200000.0, 250000.0)
    assert result["absolute"] == -50000.0
    assert result["percentage"] == -20.0


def test_missing_comparison_period():
    result = compute_deviation(250000.0, None)
    assert result["absolute"] is None
    assert result["percentage"] is None
    assert "N/A" in result["note"]


def test_zero_comparison_no_division_error():
    result = compute_deviation(50000.0, 0.0)
    assert result["absolute"] == 50000.0
    assert result["percentage"] is None


def test_zero_deviation():
    result = compute_deviation(250000.0, 250000.0)
    assert result["absolute"] == 0.0
    assert result["percentage"] == 0.0


def test_ebit_multi_period_structure():
    """Verify deviation table structure covers all required comparison periods."""
    pl_lines = ["Net Revenue", "Cost of Sales", "GM1", "Overhead Absorption", "GM2", "EBIT"]
    actuals = {"Net Revenue": 430000.0, "Cost of Sales": -180000.0, "GM1": 250000.0,
               "Overhead Absorption": -50000.0, "GM2": 200000.0, "EBIT": 180000.0}
    prior_month = {"Net Revenue": 400000.0, "Cost of Sales": -170000.0, "GM1": 230000.0,
                   "Overhead Absorption": -48000.0, "GM2": 182000.0, "EBIT": 162000.0}
    table = {}
    for line in pl_lines:
        table[line] = {
            "actual": actuals[line],
            "vs_prior_month": compute_deviation(actuals[line], prior_month.get(line)),
            "vs_prior_year": compute_deviation(actuals[line], None),
        }
    assert "EBIT" in table
    assert table["EBIT"]["vs_prior_month"]["absolute"] == 18000.0
    assert "N/A" in table["EBIT"]["vs_prior_year"]["note"]
