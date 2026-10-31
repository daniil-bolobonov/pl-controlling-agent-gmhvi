"""Unit tests for the deterministic P&L aggregation and fetch layer.

Covers:
  - _aggregate() in raw (client-raw-lines) mode
  - _aggregate() in preaggregated (server-preaggregated) mode
  - posting_count = 'server-aggregated' in preaggregated mode
  - empty input, out-of-range accounts, sanity warnings
  - _parse_response() JSON parsing helper
  - _fetch_all_pages() pagination loop with a mocked fetcher
  - fetch_strategy always reports 'client-pagination'
  - MCP tool param seam: 'filter'/'top'/'skip'/'select' sent without '$' prefix
    (API_GLACCOUNTLINEITEM — confirmed field names from EDMX)

NOTE: these tests use Python-level mocks and do NOT verify whether the real
MCP journal-entry tool forwards filter/top/skip to OData, or whether the
SAP tenant field names match exactly. Those require a live smoke test.
"""

from __future__ import annotations

import json
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_raw_item(gl: str, amount: str, profit_center: str = "PC1") -> dict:
    return {
        "GLAccount": gl,
        "AmountInCompanyCodeCurrency": amount,
        "CompanyCodeCurrency": "USD",
        "ProfitCenter": profit_center,
        "FunctionalArea": "FA1",
        "CostCenter": "CC1",
    }


# ---------------------------------------------------------------------------
# _aggregate() — raw mode
# ---------------------------------------------------------------------------

class TestAggregateRawMode:

    def test_basic_pl_lines_computed_correctly(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-1000.00"),  # revenue credit -> +1000
            _make_raw_item("50301000",  "600.00"),   # cogs debit    -> 600
            _make_raw_item("63001000",  "200.00"),   # overhead      -> 200
            _make_raw_item("71100000",   "50.00"),   # other_op      -> 50
        ]
        r = _aggregate(items)
        pl = r["pl_lines"]
        assert pl["revenue"]  == "1000.00"
        assert pl["cogs"]     == "600.00"
        assert pl["gm1"]      == "400.00"
        assert pl["overhead"] == "200.00"
        assert pl["gm2"]      == "200.00"
        assert pl["other_op"] == "50.00"
        assert pl["ebit"]     == "250.00"

    def test_aggregation_mode_is_client_raw_lines(self):
        from pl_aggregation_tool import _aggregate
        r = _aggregate([_make_raw_item("41000000", "-500.00")])
        assert r["aggregation_mode"] == "client-raw-lines"

    def test_posting_counts_are_integers(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-100.00"),
            _make_raw_item("41000000", "-200.00"),
            _make_raw_item("50301000",  "80.00"),
        ]
        r = _aggregate(items)
        assert r["posting_counts"]["revenue"] == 2
        assert r["posting_counts"]["cogs"]    == 1

    def test_posting_count_per_gl_is_integer(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-100.00"),
            _make_raw_item("41000000", "-200.00"),
        ]
        r = _aggregate(items)
        assert r["totals_by_gl"]["41000000"]["posting_count"] == 2

    def test_multiple_gl_accounts_summed_per_account(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("50301000", "100.00"),
            _make_raw_item("50301000", "200.00"),
            _make_raw_item("50304000",  "50.00"),
        ]
        r = _aggregate(items)
        assert r["totals_by_gl"]["50301000"]["normalized_sum"] == "300.00"
        assert r["totals_by_gl"]["50304000"]["normalized_sum"] == "50.00"
        assert r["pl_lines"]["cogs"] == "350.00"

    def test_revenue_sign_flip(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "-750.00")]
        r = _aggregate(items)
        assert r["pl_lines"]["revenue"] == "750.00"
        assert r["totals_by_gl"]["41000000"]["raw_sum"]        == "-750.00"
        assert r["totals_by_gl"]["41000000"]["normalized_sum"] == "750.00"

    def test_line_count_received(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "-100.00")] * 7
        r = _aggregate(items)
        assert r["line_count_received"] == 7


# ---------------------------------------------------------------------------
# _aggregate() — preaggregated mode
# ---------------------------------------------------------------------------

class TestAggregatePreaggregatedMode:

    def test_aggregation_mode_is_server_preaggregated(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "-1000.00")]
        r = _aggregate(items, preaggregated=True)
        assert r["aggregation_mode"] == "server-preaggregated"

    def test_posting_counts_are_server_aggregated_string(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-1000.00"),
            _make_raw_item("50301000",  "600.00"),
            _make_raw_item("63001000",  "200.00"),
        ]
        r = _aggregate(items, preaggregated=True)
        for category in ("revenue", "cogs", "overhead", "other_op"):
            assert r["posting_counts"][category] == "server-aggregated", (
                f"posting_counts[{category!r}] should be 'server-aggregated' "
                f"but got {r['posting_counts'][category]!r}"
            )

    def test_per_gl_posting_count_is_server_aggregated_string(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "-500.00")]
        r = _aggregate(items, preaggregated=True)
        assert r["totals_by_gl"]["41000000"]["posting_count"] == "server-aggregated"

    def test_pl_lines_still_correct_in_preaggregated_mode(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-2000.00"),
            _make_raw_item("50301000",  "1200.00"),
            _make_raw_item("63001000",   "300.00"),
        ]
        r = _aggregate(items, preaggregated=True)
        pl = r["pl_lines"]
        assert pl["revenue"]  == "2000.00"
        assert pl["cogs"]     == "1200.00"
        assert pl["gm1"]      == "800.00"
        assert pl["overhead"] == "300.00"
        assert pl["gm2"]      == "500.00"

    def test_preaggregated_does_not_double_count_same_gl(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-600.00", profit_center="PC1"),
            _make_raw_item("41000000", "-400.00", profit_center="PC2"),
        ]
        r = _aggregate(items, preaggregated=True)
        assert r["pl_lines"]["revenue"] == "1000.00"


# ---------------------------------------------------------------------------
# _aggregate() — empty / out-of-range / sanity warning cases
# ---------------------------------------------------------------------------

class TestAggregateEdgeCases:

    def test_empty_input_returns_zero_pl_lines(self):
        from pl_aggregation_tool import _aggregate
        r = _aggregate([])
        for line in ("revenue", "cogs", "gm1", "overhead", "gm2", "other_op", "ebit"):
            assert r["pl_lines"][line] == "0.00"

    def test_empty_input_triggers_no_data_warning(self):
        from pl_aggregation_tool import _aggregate
        r = _aggregate([])
        assert any("NO DATA WARNING" in w for w in r["warnings"])

    def test_out_of_range_accounts_excluded(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("12100000", "500.00"),
            _make_raw_item("30000000", "200.00"),
            _make_raw_item("90000000", "100.00"),
            _make_raw_item("41000000", "-800.00"),
        ]
        r = _aggregate(items)
        assert "12100000" not in r["totals_by_gl"]
        assert "30000000" not in r["totals_by_gl"]
        assert "90000000" not in r["totals_by_gl"]
        assert "41000000" in r["totals_by_gl"]
        assert len(r["excluded_accounts"]) == 3

    def test_out_of_range_triggers_scope_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("12100000", "500.00")]
        r = _aggregate(items)
        assert any("SCOPE WARNING" in w for w in r["warnings"])

    def test_positive_revenue_debit_triggers_sanity_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "500.00")]
        r = _aggregate(items)
        assert any("SANITY WARNING" in w and "Revenue" in w for w in r["warnings"])

    def test_identical_pl_lines_triggers_sanity_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "-1000.00")]
        r = _aggregate(items)
        assert "SANITY WARNING" in " ".join(r["warnings"])

    def test_missing_gl_account_field_produces_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [{"AmountInCompanyCodeCurrency": "100.00"}]
        r = _aggregate(items)
        assert any("missing GLAccount" in w for w in r["warnings"])

    def test_non_numeric_amount_produces_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "not-a-number")]
        r = _aggregate(items)
        assert any("Non-numeric amount" in w for w in r["warnings"])

    def test_ebit_equals_gm2_no_spurious_warning_when_other_op_nets_zero(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-1000.00"),
            _make_raw_item("50301000",  "600.00"),
            _make_raw_item("63001000",  "200.00"),
            _make_raw_item("71100000",   "50.00"),
            _make_raw_item("71100001",  "-50.00"),
        ]
        r = _aggregate(items)
        assert len([w for w in r["warnings"] if "EBIT = GM2" in w]) == 0


# ---------------------------------------------------------------------------
# _parse_response() — JSON parsing helper
# ---------------------------------------------------------------------------

class TestParseResponse:
    """Regression: empty string caused JSONDecodeError in trace ddf8dbf464007f02."""

    def test_empty_string_returns_none(self):
        from pl_fetch_tool import _parse_response
        assert _parse_response("") is None

    def test_none_returns_none(self):
        from pl_fetch_tool import _parse_response
        assert _parse_response(None) is None

    def test_invalid_json_returns_none(self):
        from pl_fetch_tool import _parse_response
        assert _parse_response("not json {{{") is None

    def test_odata_v4_value_envelope(self):
        from pl_fetch_tool import _parse_response
        rows = _parse_response(json.dumps({"value": [{"GLAccount": "41000000"}]}))
        assert rows == [{"GLAccount": "41000000"}]

    def test_odata_v2_d_results_envelope(self):
        from pl_fetch_tool import _parse_response
        rows = _parse_response(json.dumps({"d": {"results": [{"GLAccount": "41000000"}]}}))
        assert rows == [{"GLAccount": "41000000"}]

    def test_bare_list(self):
        from pl_fetch_tool import _parse_response
        rows = _parse_response(json.dumps([{"GLAccount": "41000000"}]))
        assert rows == [{"GLAccount": "41000000"}]

    def test_unexpected_shape_returns_none(self):
        from pl_fetch_tool import _parse_response
        assert _parse_response(json.dumps({"something_else": True})) is None

    def test_already_parsed_list_passthrough(self):
        from pl_fetch_tool import _parse_response
        data = [{"GLAccount": "41000000"}]
        assert _parse_response(data) == data


# ---------------------------------------------------------------------------
# _fetch_all_pages() — pagination loop
# ---------------------------------------------------------------------------

class TestFetchAllPages:

    def _make_page(self, gl: str, amount: str, count: int) -> list[dict]:
        return [_make_raw_item(gl, amount)] * count

    @pytest.mark.asyncio
    async def test_single_page_less_than_page_size(self):
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE
        calls = []

        async def mock_fetcher(**kwargs):
            calls.append(kwargs)
            rows = self._make_page("41000000", "-100.00", 10) if kwargs.get("skip", 0) == 0 else []
            return json.dumps({"value": rows})

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert len(rows) == 10
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_two_full_pages_then_partial(self):
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE

        async def mock_fetcher(**kwargs):
            skip = kwargs.get("skip", 0)
            if skip < _PAGE_SIZE * 2:
                rows = self._make_page("41000000", "-100.00", _PAGE_SIZE)
            else:
                rows = self._make_page("41000000", "-100.00", 42)
            return json.dumps({"value": rows})

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert len(rows) == _PAGE_SIZE * 2 + 42

    @pytest.mark.asyncio
    async def test_skip_increments_correctly(self):
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE
        observed_skips = []

        async def mock_fetcher(**kwargs):
            observed_skips.append(kwargs.get("skip", 0))
            skip = kwargs.get("skip", 0)
            rows = self._make_page("41000000", "-100.00", _PAGE_SIZE) if skip < _PAGE_SIZE * 2 else []
            return json.dumps({"value": rows})

        await _fetch_all_pages(mock_fetcher, {})
        assert observed_skips[0] == 0
        assert observed_skips[1] == _PAGE_SIZE
        assert len(observed_skips) == 3

    @pytest.mark.asyncio
    async def test_empty_first_page_returns_empty_list(self):
        from pl_fetch_tool import _fetch_all_pages

        async def mock_fetcher(**kwargs):
            return json.dumps({"value": []})

        assert await _fetch_all_pages(mock_fetcher, {}) == []

    @pytest.mark.asyncio
    async def test_fetch_error_stops_loop_gracefully(self):
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE
        call_count = [0]

        async def mock_fetcher(**kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return json.dumps({"value": self._make_page("41000000", "-100.00", _PAGE_SIZE)})
            raise RuntimeError("network error")

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert len(rows) == _PAGE_SIZE

    @pytest.mark.asyncio
    async def test_odata_v2_envelope_unwrapped(self):
        from pl_fetch_tool import _fetch_all_pages

        async def mock_fetcher(**kwargs):
            return json.dumps({"d": {"results": self._make_page("41000000", "-100.00", 5)}})

        assert len(await _fetch_all_pages(mock_fetcher, {})) == 5

    @pytest.mark.asyncio
    async def test_empty_body_does_not_crash(self):
        """Regression: empty string must not raise JSONDecodeError (trace ddf8dbf464007f02)."""
        from pl_fetch_tool import _fetch_all_pages

        async def mock_fetcher(**kwargs):
            return ""

        assert await _fetch_all_pages(mock_fetcher, {}) == []


# ---------------------------------------------------------------------------
# fetch_strategy — pagination is the sole path ($apply removed)
# ---------------------------------------------------------------------------

class TestFetchStrategy:

    @pytest.mark.asyncio
    async def test_list_tool_never_receives_apply_param(self):
        """list_tool_fn must never receive 'apply' or '$apply'.

        $apply was removed: the connected OData V2 service has no ApplySupported
        annotation — $apply is silently ignored and would return a partial page
        mistaken for complete server totals.
        """
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received = []

        async def mock_list_fetcher(**kwargs):
            received.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=mock_list_fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        for params in received:
            assert "$apply" not in params
            assert "apply"  not in params

    @pytest.mark.asyncio
    async def test_fetch_strategy_always_client_pagination(self):
        from pl_fetch_tool import _make_fetch_aggregate_tool

        async def mock_list_fetcher(**kwargs):
            return json.dumps({"d": {"results": [_make_raw_item("41000000", "-1000.00")] * 5}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=mock_list_fetcher)
        raw = await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        result = json.loads(raw)
        assert result["fetch_strategy"].startswith("client-pagination"), result["fetch_strategy"]

    @pytest.mark.asyncio
    async def test_fetch_strategy_includes_row_count(self):
        from pl_fetch_tool import _make_fetch_aggregate_tool

        async def mock_list_fetcher(**kwargs):
            return json.dumps({"d": {"results": [_make_raw_item("41000000", "-200.00")] * 7}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=mock_list_fetcher)
        raw = await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        assert "7" in json.loads(raw)["fetch_strategy"]

    @pytest.mark.asyncio
    async def test_fetch_error_returns_zero_rows_with_warning(self):
        from pl_fetch_tool import _make_fetch_aggregate_tool

        async def mock_list_fetcher(**kwargs):
            raise RuntimeError("connection refused")

        tool = _make_fetch_aggregate_tool(list_tool_fn=mock_list_fetcher)
        raw = await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        result = json.loads(raw)
        assert result["fetch_strategy"] == "client-pagination (0 rows)"
        assert any("NO DATA" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# MCP tool param seam — strict rejection of $-prefixed keys
# ---------------------------------------------------------------------------

class TestMcpToolParamSeam:
    """Locks in the exact parameter names sent to list_glaccountlineitem_* MCP tool.

    The MCP tool schema uses 'filter', 'top', 'skip', 'select' WITHOUT a leading '$'.
    Any '$'-prefixed key is silently dropped by the MCP layer, causing
    unfiltered/unpaginated requests and empty results.

    These tests use a strict fetcher that FAILS if any '$'-prefixed or unexpected
    key is received — catches the original bug that caused 0 postings when 795 existed.
    """

    ALLOWED_KEYS = {"filter", "top", "skip", "select"}

    async def _strict_fetcher(self, received_list: list, **kwargs) -> str:
        received_list.append(dict(kwargs))
        dollar_keys = [k for k in kwargs if k.startswith("$")]
        assert not dollar_keys, (
            f"SEAM BUG: '$'-prefixed params sent to MCP tool — will be silently dropped. "
            f"Got: {dollar_keys}. Use {self.ALLOWED_KEYS} instead."
        )
        unknown_keys = [k for k in kwargs if k not in self.ALLOWED_KEYS]
        assert not unknown_keys, (
            f"SEAM BUG: unexpected params sent to MCP tool: {unknown_keys}. "
            f"Allowed: {self.ALLOWED_KEYS}"
        )
        return json.dumps({"d": {"results": []}})

    @pytest.mark.asyncio
    async def test_no_dollar_prefixed_keys_sent(self):
        """Core regression: no $filter/$top/$skip/$select ever sent."""
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received = []

        async def fetcher(**kwargs):
            return await self._strict_fetcher(received, **kwargs)

        tool = _make_fetch_aggregate_tool(list_tool_fn=fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        assert received, "Fetcher was never called"

    @pytest.mark.asyncio
    async def test_filter_contains_all_scoping_values(self):
        """filter must contain Ledger, CompanyCode, FiscalYear, FiscalPeriod, GL range.

        API_GLACCOUNTLINEITEM has standalone FiscalYear and FiscalPeriod fields
        (confirmed from EDMX). Ledger eq '0L' scopes to the leading ledger only.
        FiscalYearPeriod must NOT appear — it belongs to the old API.
        """
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received = []

        async def fetcher(**kwargs):
            received.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        assert received
        f = received[0].get("filter", "")
        assert "Ledger eq '0L'"   in f, f"Ledger scoping missing: {f}"
        assert "1710"             in f, f"CompanyCode missing: {f}"
        assert "FiscalYear eq"    in f, f"FiscalYear missing: {f}"
        assert "'2024'"           in f, f"FiscalYear value missing: {f}"
        assert "FiscalPeriod eq"  in f, f"FiscalPeriod missing: {f}"
        assert "'010'"            in f, f"FiscalPeriod value missing: {f}"
        assert "40000000"         in f, f"GL lower bound missing: {f}"
        assert "79999999"         in f, f"GL upper bound missing: {f}"
        assert "FiscalYearPeriod" not in f, f"FiscalYearPeriod must NOT appear: {f}"

    @pytest.mark.asyncio
    async def test_top_and_skip_present_and_no_dollar_prefix(self):
        """top and skip sent without dollar sign."""
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received = []

        async def fetcher(**kwargs):
            received.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        assert received
        first = received[0]
        assert "top"   in first
        assert "skip"  in first
        assert "$top"  not in first
        assert "$skip" not in first

    @pytest.mark.asyncio
    async def test_select_contains_fiscalyear_and_ledger(self):
        """API_GLACCOUNTLINEITEM: FiscalYear and Ledger must be in select; FiscalYearPeriod must not."""
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received = []

        async def fetcher(**kwargs):
            received.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        assert received
        select = received[0].get("select", "")
        assert "FiscalYear"       in select, f"FiscalYear must be in select: {select}"
        assert "Ledger"           in select, f"Ledger must be in select: {select}"
        assert "FiscalYearPeriod" not in select, f"FiscalYearPeriod must NOT be in select: {select}"

    @pytest.mark.asyncio
    async def test_no_entity_level_params_sent_outside_filter(self):
        """CompanyCode/FiscalYear/FiscalPeriod/Ledger must NOT be top-level kwargs."""
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received = []

        async def fetcher(**kwargs):
            received.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(list_tool_fn=fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        assert received
        first = received[0]
        assert "CompanyCode"  not in first
        assert "FiscalYear"   not in first
        assert "FiscalPeriod" not in first
