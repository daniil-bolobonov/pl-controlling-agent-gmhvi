"""Unit tests for materiality threshold application."""
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def apply_materiality_filter(deviations: list[dict], threshold_amount: float | None, threshold_pct: float | None) -> list[dict]:
    """Filter P&L lines to those exceeding the materiality threshold."""
    material = []
    for line in deviations:
        abs_dev_pm = abs(line.get("abs_vs_prior_month") or 0)
        pct_dev_pm = abs(line.get("pct_vs_prior_month") or 0)
        abs_dev_py = abs(line.get("abs_vs_prior_year") or 0)
        pct_dev_py = abs(line.get("pct_vs_prior_year") or 0)
        exceeds_amount = (threshold_amount is not None and
                          (abs_dev_pm > threshold_amount or abs_dev_py > threshold_amount))
        exceeds_pct = (threshold_pct is not None and
                       (pct_dev_pm > threshold_pct or pct_dev_py > threshold_pct))
        if exceeds_amount or exceeds_pct:
            material.append(line)
    return material


def test_absolute_threshold_filters_correctly():
    lines = [
        {"name": "Revenue", "abs_vs_prior_month": 60000, "pct_vs_prior_month": 15},
        {"name": "COGS", "abs_vs_prior_month": 30000, "pct_vs_prior_month": 8},
        {"name": "Admin", "abs_vs_prior_month": 10000, "pct_vs_prior_month": 2},
    ]
    material = apply_materiality_filter(lines, threshold_amount=50000, threshold_pct=None)
    assert len(material) == 1
    assert material[0]["name"] == "Revenue"


def test_percentage_threshold_filters_correctly():
    lines = [
        {"name": "Revenue", "abs_vs_prior_month": 60000, "pct_vs_prior_month": 15},
        {"name": "COGS", "abs_vs_prior_month": 30000, "pct_vs_prior_month": 8},
        {"name": "Admin", "abs_vs_prior_month": 10000, "pct_vs_prior_month": 2},
    ]
    material = apply_materiality_filter(lines, threshold_amount=None, threshold_pct=10)
    assert len(material) == 1
    assert material[0]["name"] == "Revenue"


def test_both_thresholds_union():
    lines = [
        {"name": "Revenue", "abs_vs_prior_month": 60000, "pct_vs_prior_month": 15},
        {"name": "COGS", "abs_vs_prior_month": 55000, "pct_vs_prior_month": 4},
        {"name": "Admin", "abs_vs_prior_month": 10000, "pct_vs_prior_month": 2},
    ]
    material = apply_materiality_filter(lines, threshold_amount=50000, threshold_pct=10)
    names = [m["name"] for m in material]
    assert "Revenue" in names
    assert "COGS" in names
    assert "Admin" not in names


def test_prior_year_deviation_also_triggers():
    lines = [
        {"name": "Overhead", "abs_vs_prior_month": 5000, "pct_vs_prior_month": 2,
         "abs_vs_prior_year": 80000, "pct_vs_prior_year": 25},
    ]
    material = apply_materiality_filter(lines, threshold_amount=50000, threshold_pct=None)
    assert len(material) == 1


def test_no_lines_below_threshold():
    lines = [
        {"name": "Travel", "abs_vs_prior_month": 1000, "pct_vs_prior_month": 1},
    ]
    material = apply_materiality_filter(lines, threshold_amount=50000, threshold_pct=10)
    assert len(material) == 0
