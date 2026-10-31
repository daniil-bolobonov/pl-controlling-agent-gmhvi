"""Deterministic P&L aggregation tool.

The LLM must never sum raw journal entry lines itself — floating-point
aggregation inside the LLM context is unreliable and the root cause of
fabricated totals.  This tool accepts a list of raw journal entry items
returned by the SAP API, applies sign normalization, filters to the
requested GL range, and returns verified totals with full audit metadata.

The LLM's only job is to pass the raw lines in and read back pre-computed,
deterministic results.
"""

from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# GL range definitions
# ---------------------------------------------------------------------------
_PL_RANGES = {
    "revenue":  (40_000_000, 49_999_999),
    "cogs":     (50_000_000, 54_999_999),
    "overhead": (60_000_000, 69_999_999),
    "other_op": (70_000_000, 79_999_999),
}

_ALL_PL_MIN = 40_000_000
_ALL_PL_MAX = 79_999_999


def _classify(gl: int) -> str | None:
    for name, (lo, hi) in _PL_RANGES.items():
        if lo <= gl <= hi:
            return name
    return None


# ---------------------------------------------------------------------------
# Core aggregation logic
# ---------------------------------------------------------------------------
def _aggregate(items: list[dict[str, Any]], preaggregated: bool = False) -> dict[str, Any]:
    """
    Aggregate raw SAP journal entry items into P&L totals.

    Sign normalization:
      - Revenue (40xxxxxxx-49xxxxxxx): SAP stores as CREDITS (negative).
        Multiply by -1 so revenue is POSITIVE in P&L presentation.
      - Costs (50xxxxxxx-79xxxxxxx): SAP stores as DEBITS (positive). Keep as-is.

    preaggregated=True: items come from $apply=groupby(...,aggregate(...)) —
      each row is already a sum. posting_count is marked 'server-aggregated'
      and the count increment is skipped (count=1 per row would be misleading).

    Returns a dict with:
      - totals_by_category: {revenue, cogs, overhead, other_op} — normalized sums
      - totals_by_gl: {gl_account: {raw_sum, normalized_sum, posting_count, category}}
      - pl_lines: {revenue, cogs, gm1, overhead, gm2, other_op, ebit} — computed
      - posting_counts: {revenue, cogs, overhead, other_op} — 'server-aggregated' or int
      - excluded_accounts: [gl accounts outside 40000000-79999999]
      - warnings: [list of warning strings]
      - line_count_received: total rows passed in
      - aggregation_mode: 'server-preaggregated' or 'client-raw-lines'
    """
    totals: dict[str, Decimal] = {k: Decimal("0") for k in _PL_RANGES}
    by_gl: dict[str, dict] = {}
    excluded: list[str] = []
    warnings: list[str] = []
    # In preaggregated mode counts track distinct GL/dimension rows, not raw postings
    counts: dict[str, int] = {k: 0 for k in _PL_RANGES}
    aggregation_mode = "server-preaggregated" if preaggregated else "client-raw-lines"

    for item in items:
        gl_raw = str(item.get("GLAccount") or item.get("gl_account") or "").strip()
        if not gl_raw:
            warnings.append(f"Item missing GLAccount field: {json.dumps(item)[:120]}")
            continue

        # Normalize GL to integer for range check
        try:
            gl_int = int(gl_raw)
        except ValueError:
            warnings.append(f"Non-numeric GLAccount '{gl_raw}' — skipped.")
            continue

        # Amount field — try multiple field name variants
        amt_raw = (
            item.get("AmountInCompanyCodeCurrency")
            or item.get("amount_in_company_code_currency")
            or item.get("Amount")
            or item.get("amount")
            or "0"
        )
        try:
            amt = Decimal(str(amt_raw))
        except Exception:
            warnings.append(f"Non-numeric amount '{amt_raw}' for GL {gl_raw} — skipped.")
            continue

        category = _classify(gl_int)
        if category is None:
            excluded.append(gl_raw)
            continue

        # Sign normalization
        if category == "revenue":
            normalized = amt * Decimal("-1")  # flip credit→positive
        else:
            normalized = amt  # costs already positive debits

        totals[category] += normalized
        counts[category] += 1  # rows processed (not raw postings in preaggregated mode)

        if gl_raw not in by_gl:
            by_gl[gl_raw] = {
                "gl_account": gl_raw,
                "category": category,
                "raw_sum": Decimal("0"),
                "normalized_sum": Decimal("0"),
                "posting_count": 0,
            }
        by_gl[gl_raw]["raw_sum"] += amt
        by_gl[gl_raw]["normalized_sum"] += normalized
        by_gl[gl_raw]["posting_count"] += 1

    # Compute P&L lines
    revenue  = totals["revenue"]
    cogs     = totals["cogs"]
    overhead = totals["overhead"]
    other_op = totals["other_op"]
    gm1      = revenue - cogs
    gm2      = gm1 - overhead
    ebit     = gm2 + other_op  # other_op may be positive income or negative expense

    # Sanity checks
    if revenue <= 0:
        warnings.append(
            f"SANITY WARNING: Revenue is {revenue} after sign normalization — "
            "expected positive. Check that revenue accounts are in 40000000-49999999 "
            "and that SAP is returning credit amounts (negative raw values)."
        )

    # Distinct lines check
    pl_values = {"revenue": revenue, "gm1": gm1, "gm2": gm2}
    seen: dict[str, str] = {}
    for name, val in pl_values.items():
        key = str(val)
        if key in seen:
            warnings.append(
                f"SANITY WARNING: {name} = {val} is identical to {seen[key]} — "
                "possible data or aggregation error."
            )
        seen[key] = name

    if other_op != 0 and ebit == gm2:
        warnings.append(
            f"SANITY WARNING: EBIT = GM2 = {ebit} but Other Operating = {other_op} != 0 — "
            "EBIT should differ from GM2 when Other Op is non-zero."
        )

    if excluded:
        warnings.append(
            f"SCOPE WARNING: {len(excluded)} posting(s) on accounts outside "
            f"40000000-79999999 were excluded: {', '.join(sorted(set(excluded))[:10])}"
        )

    if not any(counts.values()):
        warnings.append(
            "NO DATA WARNING: Zero postings found in range 40000000-79999999. "
            "Confirm the GL account ranges with the user."
        )

    def _fmt(d: Decimal) -> str:
        return str(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    def _gl_serializable(gl_dict: dict) -> dict:
        return {
            gl: {
                **v,
                "raw_sum": _fmt(v["raw_sum"]),
                "normalized_sum": _fmt(v["normalized_sum"]),
            }
            for gl, v in gl_dict.items()
        }

    posting_counts_out: dict[str, Any] = (
        {k: "server-aggregated" for k in counts}
        if preaggregated
        else dict(counts)
    )

    return {
        "line_count_received": len(items),
        "aggregation_mode": aggregation_mode,
        "posting_counts": posting_counts_out,
        "totals_by_category": {k: _fmt(v) for k, v in totals.items()},
        "pl_lines": {
            "revenue":  _fmt(revenue),
            "cogs":     _fmt(cogs),
            "gm1":      _fmt(gm1),
            "overhead": _fmt(overhead),
            "gm2":      _fmt(gm2),
            "other_op": _fmt(other_op),
            "ebit":     _fmt(ebit),
        },
        "totals_by_gl": _gl_serializable(by_gl),
        "excluded_accounts": sorted(set(excluded)),
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# LangChain tool wrapper
# ---------------------------------------------------------------------------
class _AggregateInput(BaseModel):
    journal_entry_items: list[dict[str, Any]] = Field(
        description=(
            "Raw journal entry items exactly as returned by the SAP "
            "list_a_journalentryitembasic API. Each item must contain at minimum "
            "'GLAccount' and 'AmountInCompanyCodeCurrency' fields. "
            "Pass ALL pages of results — do not summarize or pre-aggregate."
        )
    )
    label: str = Field(
        default="",
        description=(
            "Optional human-readable label for this aggregation batch, "
            "e.g. 'October 2024 Company Code 1710'. Included in the result "
            "for traceability."
        )
    )


def _run_aggregation(journal_entry_items: list[dict[str, Any]], label: str = "") -> str:
    result = _aggregate(journal_entry_items)
    result["label"] = label
    return json.dumps(result, indent=2)


def get_pl_aggregation_tool() -> StructuredTool:
    """Return a LangChain tool that deterministically aggregates P&L journal entries."""
    return StructuredTool(
        name="aggregate_pl_journal_entries",
        description=(
            "Deterministically aggregate raw SAP journal entry items into P&L totals. "
            "ALWAYS call this tool after fetching journal entry lines — NEVER sum amounts "
            "yourself in your reasoning. "
            "Pass ALL raw journal entry items exactly as returned by the SAP API. "
            "The tool applies sign normalization (revenue credits flipped to positive), "
            "filters to income-statement accounts (40000000-79999999), computes "
            "Revenue, COGS, GM1, Overhead, GM2, Other Op, and EBIT, runs sanity checks, "
            "and returns verified totals with posting counts and warnings. "
            "Use the returned pl_lines values directly in the report — do not re-derive them."
        ),
        args_schema=_AggregateInput,
        func=_run_aggregation,
    )
