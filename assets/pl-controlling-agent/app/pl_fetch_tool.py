"""Code-level fetch-and-aggregate tool for P&L journal entries.

Owns the entire retrieve-aggregate pipeline so the LLM never drives the
pagination loop and completeness never depends on model behaviour.

Two MCP tools are used:
  1. aggregate_a_journalentryitembasic  (PREFERRED)
     Server-side aggregation via the 'apply' parameter (no $ prefix).
     Returns one pre-summed row per GL/dimension — single API call, no pagination.
     Bound via agg_tool_fn in _make_fetch_aggregate_tool.

  2. list_a_journalentryitembasic_*  (FALLBACK)
     Standard pagination: top=500 / skip=0,500,1000,...
     Used when the aggregate tool is unavailable or returns unexpected results.
     Bound via list_tool_fn in _make_fetch_aggregate_tool.

IMPORTANT -- parameter names match each MCP tool schema exactly (NO leading '$'):
  aggregate tool: 'apply', 'filter', 'select'
  list tool:      'filter', 'top', 'skip', 'select'
The '$'-prefixed variants are silently dropped by the MCP layer.

All results are passed to _aggregate() in one deterministic pass.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from pl_aggregation_tool import _aggregate

logger = logging.getLogger(__name__)

# Page size for the pagination loop.
# 500 rows * ~400 chars/row ~200 KB per page -- well within the 500 KB cap.
_PAGE_SIZE = 500

# Fields to request -- minimal set needed for aggregation + drill-down context.
_FIELDS = (
    "GLAccount,AmountInCompanyCodeCurrency,CompanyCodeCurrency,"
    "ProfitCenter,FunctionalArea,CostCenter,"
    "AccountingDocument,FiscalYear,FiscalPeriod"
)


# ---------------------------------------------------------------------------
# Response parsing helper
# ---------------------------------------------------------------------------

def _parse_response(raw: Any) -> list[dict] | None:
    """Parse a raw MCP tool response into a list of row dicts.

    Returns None if the response is empty, unparseable, or has an unexpected
    shape.  Never raises -- all errors are logged and result in None.
    """
    if not raw:
        logger.warning("Empty response from MCP tool")
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "Failed to parse MCP tool response as JSON (%s) -- raw[:200]: %s",
            exc, str(raw)[:200],
        )
        return None
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        logger.warning("Unexpected response type %s -- falling back", type(data))
        return None
    rows = data.get("value") or data.get("d", {}).get("results")
    if rows is None:
        logger.warning(
            "Response has no 'value' or 'd.results' key -- shape: %s",
            list(data.keys())[:10],
        )
    return rows  # may be None -- caller decides what to do


# ---------------------------------------------------------------------------
# Pagination loop
# ---------------------------------------------------------------------------

async def _fetch_all_pages(call_tool_fn, base_params: dict) -> list[dict]:
    """Pagination loop: top=PAGE_SIZE, skip=0,500,1000,... until exhausted.

    Parameter names do NOT have a leading '$' -- this matches the MCP tool
    schema for list_a_journalentryitembasic_* which expects 'filter', 'top',
    'skip', 'select' without the OData '$' prefix.
    """
    all_rows: list[dict] = []
    skip = 0
    page_num = 0
    while True:
        page_num += 1
        params = {**base_params, "top": _PAGE_SIZE, "skip": skip, "select": _FIELDS}
        try:
            raw = await call_tool_fn(**params)
            rows = _parse_response(raw) or []
        except Exception as exc:
            logger.error("Pagination fetch failed at skip=%d: %s", skip, exc)
            break

        if not rows:
            break

        all_rows.extend(rows)
        logger.info(
            "Page %d: fetched %d rows (total so far: %d)",
            page_num, len(rows), len(all_rows),
        )

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
        description="Human-readable label for traceability, e.g. 'October 2024 actuals'",
    )


def _make_fetch_aggregate_tool(
    list_tool_fn,
    agg_tool_fn=None,
) -> StructuredTool:
    """Factory: returns a LangChain tool bound to the real journal-entry MCP callers.

    list_tool_fn:  async callable for list_a_journalentryitembasic_* (pagination).
                   Accepts: filter, top, skip, select (no $ prefix).
    agg_tool_fn:   async callable for aggregate_a_journalentryitembasic (preferred).
                   Accepts: apply, filter, select (no $ prefix).
                   Pass None to skip the $apply path and go straight to pagination.
    """
    # FiscalYear is NOT a property on A_JournalEntryItemBasic (confirmed from EDMX).
    # The correct combined field is FiscalYearPeriod (MaxLength=8, format YYYYPPP,
    # e.g. '2026010' for October 2026).  FiscalPeriod alone is also a valid field
    # but without FiscalYear it would match across all years -- always use FiscalYearPeriod.
    _scope_filter = (
        "CompanyCode eq '{cc}' "
        "and FiscalYearPeriod eq '{fyp}' "
        "and GLAccount ge '40000000' and GLAccount le '79999999'"
    )

    async def _try_aggregate_tool(company_code: str, fiscal_year: str, fiscal_period: str):
        """Attempt server-side aggregation via aggregate_a_journalentryitembasic.

        Builds an OData $apply expression with the scope filter embedded inside
        the pipeline: filter(...)/groupby((...),aggregate(...))
        Uses 'apply' param (no $ prefix) as required by the MCP tool schema.
        Returns list of pre-summed rows, or None if unavailable/failed.
        """
        if agg_tool_fn is None:
            return None
        fiscal_year_period = f"{fiscal_year}{fiscal_period}"
        scope = _scope_filter.format(cc=company_code, fyp=fiscal_year_period)
        apply_expr = (
            f"filter({scope})"
            "/groupby("
            "(GLAccount,ProfitCenter,FunctionalArea,CostCenter,CompanyCodeCurrency),"
            "aggregate(AmountInCompanyCodeCurrency with sum as AmountInCompanyCodeCurrency)"
            ")"
        )
        try:
            raw = await agg_tool_fn(apply=apply_expr)
            rows = _parse_response(raw)
            if rows is None:
                logger.info("aggregate tool returned unexpected shape — falling back to pagination")
                return None
            logger.info("aggregate tool succeeded: %d pre-summed rows", len(rows))
            return rows
        except Exception as exc:
            logger.info("aggregate tool failed (%s) — falling back to pagination", exc)
            return None

    async def _run(
        company_code: str,
        fiscal_year: str,
        fiscal_period: str,
        label: str = "",
    ) -> str:
        # FiscalYearPeriod = YYYYPPP, e.g. fiscal_year='2026', fiscal_period='010' -> '2026010'
        fiscal_year_period = f"{fiscal_year}{fiscal_period}"
        scope_filter = _scope_filter.format(
            cc=company_code, fyp=fiscal_year_period
        )
        base_params: dict[str, Any] = {"filter": scope_filter}
        preaggregated = False

        try:
            # Preferred path: server-side aggregation (single call, no pagination)
            rows = await _try_aggregate_tool(company_code, fiscal_year, fiscal_period)

            if rows is not None:
                preaggregated = True
                fetch_strategy = f"server-aggregate ({len(rows)} gl-groups)"
            else:
                # Fallback: client-side pagination loop
                rows = await _fetch_all_pages(list_tool_fn, base_params)
                fetch_strategy = f"client-pagination ({len(rows)} rows)"

            result = _aggregate(rows, preaggregated=preaggregated)
            result["label"] = label or f"{fiscal_period}/{fiscal_year} CompanyCode={company_code}"
            result["fetch_strategy"] = fetch_strategy

            # Materiality order: GL accounts sorted by |normalized_sum| descending
            gl_sorted = sorted(
                result["totals_by_gl"].items(),
                key=lambda kv: abs(float(kv[1]["normalized_sum"])),
                reverse=True,
            )
            result["materiality_order"] = [gl for gl, _ in gl_sorted]

            return json.dumps(result, indent=2)

        except Exception as exc:
            logger.exception(
                "fetch_and_aggregate_pl failed for %s/%s/%s",
                company_code, fiscal_year, fiscal_period,
            )
            return json.dumps({
                "error": str(exc),
                "fetch_strategy": "failed",
                "label": label or f"{fiscal_period}/{fiscal_year} CompanyCode={company_code}",
                "pl_lines": None,
                "warnings": [
                    f"FETCH ERROR: {exc} -- could not retrieve P&L data. "
                    "Check SAP connectivity and retry."
                ],
            }, indent=2)

    return StructuredTool(
        name="fetch_and_aggregate_pl",
        description=(
            "Fetch ALL P&L journal entry items for a given company code, fiscal year, and period "
            "and aggregate them deterministically into P&L totals. "
            "Tries server-side aggregation first (aggregate_a_journalentryitembasic with apply param), "
            "falls back to a complete top=500/skip pagination loop if unavailable. "
            "ALWAYS use this tool instead of calling the journal entry API directly. "
            "Returns pl_lines (revenue, cogs, gm1, overhead, gm2, other_op, ebit), "
            "materiality_order (GL accounts sorted by absolute amount, largest first), "
            "fetch_strategy (server-aggregate or client-pagination), and warnings. "
            "Use pl_lines values directly in the report -- do not re-derive them."
        ),
        args_schema=_FetchAggregateInput,
        coroutine=_run,
    )
