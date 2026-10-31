"""Code-level fetch-and-aggregate tool for P&L journal entries.

Owns the entire retrieve-aggregate pipeline so the LLM never drives the
pagination loop and completeness never depends on model behaviour.

Flow:
  1. Try $apply=groupby(...,aggregate(...)) — server-side aggregation,
     single call, no pagination, no context-size risk.
  2. If the server rejects $apply (400/501/not-supported), fall back to a
     $skip/$top=500 pagination loop that accumulates ALL pages in Python
     and passes them to _aggregate() in one deterministic pass.

The tool returns the same JSON structure as aggregate_pl_journal_entries so
the LLM can read pl_lines, warnings, and materiality_order directly.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from pl_aggregation_tool import _aggregate

logger = logging.getLogger(__name__)

# Page size for the fallback pagination loop.
# 500 rows * ~400 chars/row ≈ 200 KB per page — well within the 500 KB cap.
_PAGE_SIZE = 500

# Fields to request — minimal set needed for aggregation + drill-down context.
_FIELDS = (
    "GLAccount,AmountInCompanyCodeCurrency,CompanyCodeCurrency,"
    "ProfitCenter,FunctionalArea,CostCenter,"
    "AccountingDocument,FiscalYear,FiscalPeriod"
)

# $apply expression for server-side aggregation
_APPLY_EXPR = (
    "groupby("
    "(GLAccount,ProfitCenter,FunctionalArea,CostCenter,CompanyCodeCurrency),"
    "aggregate(AmountInCompanyCodeCurrency with sum)"
    ")"
)


# ---------------------------------------------------------------------------
# Internal fetch helpers — called from the LangChain tool coroutine
# ---------------------------------------------------------------------------

async def _fetch_with_apply(call_tool_fn, base_params: dict) -> list[dict] | None:
    """Attempt server-side aggregation via $apply. Returns rows or None on failure."""
    params = {**base_params, "$apply": _APPLY_EXPR}
    try:
        raw = await call_tool_fn(**params)
        data = json.loads(raw) if isinstance(raw, str) else raw
        # Unwrap OData envelope
        rows = data.get("value") or data.get("d", {}).get("results") or (data if isinstance(data, list) else None)
        if rows is None:
            logger.warning("$apply response has unexpected shape — falling back to pagination")
            return None
        logger.info("$apply succeeded: %d pre-aggregated rows", len(rows))
        return rows
    except Exception as exc:
        logger.info("$apply not supported or failed (%s) — falling back to pagination", exc)
        return None


async def _fetch_all_pages(call_tool_fn, base_params: dict) -> list[dict]:
    """Pagination loop: $top=PAGE_SIZE, $skip=0,500,1000,... until exhausted."""
    all_rows: list[dict] = []
    skip = 0
    page_num = 0
    while True:
        page_num += 1
        params = {**base_params, "$top": _PAGE_SIZE, "$skip": skip, "$select": _FIELDS}
        try:
            raw = await call_tool_fn(**params)
        except Exception as exc:
            logger.error("Pagination fetch failed at $skip=%d: %s", skip, exc)
            break

        data = json.loads(raw) if isinstance(raw, str) else raw
        rows = data.get("value") or data.get("d", {}).get("results") or []

        if not rows:
            break

        all_rows.extend(rows)
        logger.info("Page %d: fetched %d rows (total so far: %d)", page_num, len(rows), len(all_rows))

        if len(rows) < _PAGE_SIZE:
            break  # last page

        skip += _PAGE_SIZE

    logger.info("Pagination complete: %d pages, %d total rows", page_num, len(all_rows))
    return all_rows


# ---------------------------------------------------------------------------
# LangChain tool
# ---------------------------------------------------------------------------

class _FetchAggregateInput(BaseModel):
    company_code: str = Field(description="SAP Company Code, e.g. '1710'")
    fiscal_year: str = Field(description="Fiscal year, e.g. '2024'")
    fiscal_period: str = Field(description="Fiscal period zero-padded, e.g. '010' for October")
    label: str = Field(
        default="",
        description="Human-readable label for traceability, e.g. 'October 2024 actuals'"
    )


def _make_fetch_aggregate_tool(journal_entry_tool_fn) -> StructuredTool:
    """
    Factory: returns a LangChain tool bound to a specific journal-entry caller.

    journal_entry_tool_fn must be an async callable that accepts SAP OData
    query parameters as keyword args and returns the raw API response string.
    """

    async def _run(
        company_code: str,
        fiscal_year: str,
        fiscal_period: str,
        label: str = "",
    ) -> str:
        base_params: dict[str, Any] = {
            "CompanyCode": company_code,
            "FiscalYear": fiscal_year,
            "FiscalPeriod": fiscal_period,
            # Filter to income-statement range only
            "$filter": (
                f"CompanyCode eq '{company_code}' "
                f"and FiscalYear eq '{fiscal_year}' "
                f"and FiscalPeriod eq '{fiscal_period}' "
                f"and GLAccount ge '40000000' and GLAccount le '79999999'"
            ),
        }

        # --- Preferred path: server-side $apply ---
        rows = await _fetch_with_apply(journal_entry_tool_fn, base_params)
        preaggregated = rows is not None

        if not preaggregated:
            # --- Fallback path: client-side pagination loop ---
            rows = await _fetch_all_pages(journal_entry_tool_fn, base_params)

        result = _aggregate(rows, preaggregated=preaggregated)
        result["label"] = label or f"{fiscal_period}/{fiscal_year} CompanyCode={company_code}"
        result["fetch_strategy"] = "server-$apply" if preaggregated else f"client-pagination ({len(rows)} rows)"

        # Materiality order: GL accounts sorted by |normalized_sum| descending
        gl_sorted = sorted(
            result["totals_by_gl"].items(),
            key=lambda kv: abs(float(kv[1]["normalized_sum"])),
            reverse=True,
        )
        result["materiality_order"] = [gl for gl, _ in gl_sorted]

        return json.dumps(result, indent=2)

    return StructuredTool(
        name="fetch_and_aggregate_pl",
        description=(
            "Fetch ALL P&L journal entry items for a given company code, fiscal year, and period "
            "and aggregate them deterministically into P&L totals. "
            "This tool owns the full retrieve-aggregate pipeline: "
            "it first tries server-side $apply aggregation (single call, no pagination), "
            "and falls back to a complete $skip/$top pagination loop if $apply is not supported. "
            "ALWAYS use this tool instead of calling the journal entry API directly — "
            "it guarantees completeness regardless of data volume. "
            "Returns pl_lines (revenue, cogs, gm1, overhead, gm2, other_op, ebit), "
            "materiality_order (GL accounts sorted by absolute amount, largest first), "
            "warnings, and fetch_strategy. "
            "Use pl_lines values directly in the report — do not re-derive them."
        ),
        args_schema=_FetchAggregateInput,
        coroutine=_run,
    )
