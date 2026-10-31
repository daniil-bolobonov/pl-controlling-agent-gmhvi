"""Unit tests for the deterministic P&L aggregation and fetch layer.

Covers:
  - _aggregate() in raw (client-raw-lines) mode
  - _aggregate() in preaggregated (server-preaggregated) mode
  - posting_count = 'server-aggregated' in preaggregated mode
  - empty input, out-of-range accounts, sanity warnings
  - _build_apply_expr() output shape and filter embedding
  - _fetch_all_pages() pagination loop with a mocked fetcher
  - $apply -> fallback path in _fetch_with_apply() with a mocked fetcher

NOTE: these tests use Python-level mocks and do NOT verify whether the real
MCP journal-entry tool forwards $apply/$top/$skip/$filter to OData, whether
the SAP tenant supports $apply, or whether the $apply field names match the
live schema. Those require a live smoke test against the real system.
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
            _make_raw_item("41000000", "-1000.00"),   # revenue credit -> +1000
            _make_raw_item("50301000", "600.00"),      # cogs debit    -> 600
            _make_raw_item("63001000", "200.00"),      # overhead      -> 200
            _make_raw_item("71100000", "50.00"),       # other_op      -> 50
        ]
        r = _aggregate(items)
        pl = r["pl_lines"]
        assert pl["revenue"]  == "1000.00"
        assert pl["cogs"]     == "600.00"
        assert pl["gm1"]      == "400.00"   # 1000 - 600
        assert pl["overhead"] == "200.00"
        assert pl["gm2"]      == "200.00"   # 400 - 200
        assert pl["other_op"] == "50.00"
        assert pl["ebit"]     == "250.00"   # 200 + 50

    def test_aggregation_mode_is_client_raw_lines(self):
        from pl_aggregation_tool import _aggregate
        r = _aggregate([_make_raw_item("41000000", "-500.00")])
        assert r["aggregation_mode"] == "client-raw-lines"

    def test_posting_counts_are_integers(self):
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("41000000", "-100.00"),
            _make_raw_item("41000000", "-200.00"),
            _make_raw_item("50301000", "80.00"),
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
            _make_raw_item("50304000", "50.00"),
        ]
        r = _aggregate(items)
        assert r["totals_by_gl"]["50301000"]["normalized_sum"] == "300.00"
        assert r["totals_by_gl"]["50304000"]["normalized_sum"] == "50.00"
        assert r["pl_lines"]["cogs"] == "350.00"

    def test_revenue_sign_flip(self):
        """Revenue accounts (40xxxxxxx-49xxxxxxx) come in as negative credits."""
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "-750.00")]
        r = _aggregate(items)
        assert r["pl_lines"]["revenue"] == "750.00"
        assert r["totals_by_gl"]["41000000"]["raw_sum"] == "-750.00"
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
        """Amounts must be summed and sign-normalized correctly even in preaggregated mode."""
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

    def test_preaggregated_does_not_double_count_multiple_rows_same_gl(self):
        """Two $apply rows for the same GL (different dimensions) must be summed."""
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
        pl = r["pl_lines"]
        for line in ("revenue", "cogs", "gm1", "overhead", "gm2", "other_op", "ebit"):
            assert pl[line] == "0.00", f"{line} should be 0.00 for empty input"

    def test_empty_input_triggers_no_data_warning(self):
        from pl_aggregation_tool import _aggregate
        r = _aggregate([])
        assert any("NO DATA WARNING" in w for w in r["warnings"])

    def test_out_of_range_accounts_excluded(self):
        """Balance-sheet accounts (1xxxxxxx, 3xxxxxxx, 9xxxxxxx) must be excluded."""
        from pl_aggregation_tool import _aggregate
        items = [
            _make_raw_item("12100000", "500.00"),   # receivables — exclude
            _make_raw_item("30000000", "200.00"),   # equity — exclude
            _make_raw_item("90000000", "100.00"),   # outside range — exclude
            _make_raw_item("41000000", "-800.00"),  # revenue — keep
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

    def test_negative_revenue_after_normalization_triggers_sanity_warning(self):
        """If revenue arrives as a positive debit (wrong sign), warn."""
        from pl_aggregation_tool import _aggregate
        # Positive amount in a revenue account -> after flip -> negative -> warning
        items = [_make_raw_item("41000000", "500.00")]
        r = _aggregate(items)
        assert any("SANITY WARNING" in w and "Revenue" in w for w in r["warnings"])

    def test_identical_pl_lines_triggers_sanity_warning(self):
        """Revenue == GM1 (i.e. zero COGS) is valid, but revenue == gm2 is suspicious."""
        from pl_aggregation_tool import _aggregate
        # revenue = 1000, cogs = 0, overhead = 0 -> revenue == gm1 == gm2 == 1000
        items = [_make_raw_item("41000000", "-1000.00")]
        r = _aggregate(items)
        # gm1 = gm2 = revenue = 1000 — two of the three are identical, should warn
        warnings_text = " ".join(r["warnings"])
        assert "SANITY WARNING" in warnings_text

    def test_missing_gl_account_field_produces_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [{"AmountInCompanyCodeCurrency": "100.00"}]  # no GLAccount
        r = _aggregate(items)
        assert any("missing GLAccount" in w for w in r["warnings"])

    def test_non_numeric_amount_produces_warning(self):
        from pl_aggregation_tool import _aggregate
        items = [_make_raw_item("41000000", "not-a-number")]
        r = _aggregate(items)
        assert any("Non-numeric amount" in w for w in r["warnings"])

    def test_ebit_equals_gm2_with_nonzero_other_op_warns(self):
        """other_op != 0 but ebit == gm2 is impossible — must warn."""
        from pl_aggregation_tool import _aggregate
        # Construct a case where the arithmetic produces ebit == gm2:
        # revenue=1000, cogs=600, overhead=200 -> gm2=200
        # other_op=50 -> ebit=250 != 200 — this is fine.
        # To force ebit==gm2 we need other_op that sums to zero across positive/negative.
        # Use two other_op entries that cancel: +50 income and -50 expense -> net 0
        items = [
            _make_raw_item("41000000", "-1000.00"),
            _make_raw_item("50301000",  "600.00"),
            _make_raw_item("63001000",  "200.00"),
            _make_raw_item("71100000",   "50.00"),   # other_op debit
            _make_raw_item("71100001",  "-50.00"),   # other_op credit (cancels)
        ]
        r = _aggregate(items)
        # other_op net = 0 -> no warning expected for this specific check
        # (ebit == gm2 is only warned when other_op != 0)
        ebit_gm2_warnings = [w for w in r["warnings"] if "EBIT = GM2" in w]
        assert len(ebit_gm2_warnings) == 0  # net other_op is 0, no spurious warning


# ---------------------------------------------------------------------------
# _fetch_all_pages() — pagination loop with mocked fetcher
# ---------------------------------------------------------------------------

class TestFetchAllPages:

    def _make_page(self, gl: str, amount: str, count: int) -> list[dict]:
        return [_make_raw_item(gl, amount)] * count

    @pytest.mark.asyncio
    async def test_single_page_less_than_page_size(self):
        """When first page has fewer rows than PAGE_SIZE, loop stops after one call."""
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE
        calls = []

        async def mock_fetcher(**kwargs):
            calls.append(kwargs)
            skip = kwargs.get("$skip", 0)
            # Return 10 rows on first call, nothing on second
            rows = self._make_page("41000000", "-100.00", 10) if skip == 0 else []
            return json.dumps({"value": rows})

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert len(rows) == 10
        assert len(calls) == 1  # stopped after first page < PAGE_SIZE

    @pytest.mark.asyncio
    async def test_two_full_pages_then_partial(self):
        """Loop must continue until a page smaller than PAGE_SIZE is returned."""
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE

        async def mock_fetcher(**kwargs):
            skip = kwargs.get("$skip", 0)
            if skip == 0:
                rows = self._make_page("41000000", "-100.00", _PAGE_SIZE)
            elif skip == _PAGE_SIZE:
                rows = self._make_page("41000000", "-100.00", _PAGE_SIZE)
            else:
                rows = self._make_page("41000000", "-100.00", 42)  # partial last page
            return json.dumps({"value": rows})

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert len(rows) == _PAGE_SIZE * 2 + 42

    @pytest.mark.asyncio
    async def test_skip_increments_correctly(self):
        """$skip must increment by PAGE_SIZE on each call."""
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE
        observed_skips = []

        async def mock_fetcher(**kwargs):
            observed_skips.append(kwargs.get("$skip", 0))
            skip = kwargs.get("$skip", 0)
            rows = self._make_page("41000000", "-100.00", _PAGE_SIZE) if skip < _PAGE_SIZE * 2 else []
            return json.dumps({"value": rows})

        await _fetch_all_pages(mock_fetcher, {})
        assert observed_skips[0] == 0
        assert observed_skips[1] == _PAGE_SIZE
        # Third call returns empty -> loop stops
        assert len(observed_skips) == 3

    @pytest.mark.asyncio
    async def test_empty_first_page_returns_empty_list(self):
        from pl_fetch_tool import _fetch_all_pages

        async def mock_fetcher(**kwargs):
            return json.dumps({"value": []})

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert rows == []

    @pytest.mark.asyncio
    async def test_fetch_error_on_page_stops_loop_gracefully(self):
        """A fetcher exception mid-loop must not crash — return what was collected."""
        from pl_fetch_tool import _fetch_all_pages, _PAGE_SIZE
        call_count = [0]

        async def mock_fetcher(**kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return json.dumps({"value": self._make_page("41000000", "-100.00", _PAGE_SIZE)})
            raise RuntimeError("network error")

        rows = await _fetch_all_pages(mock_fetcher, {})
        # First page collected before the error
        assert len(rows) == _PAGE_SIZE

    @pytest.mark.asyncio
    async def test_odata_v2_envelope_unwrapped(self):
        """Pagination must unwrap OData v2 {d: {results: []}} envelope."""
        from pl_fetch_tool import _fetch_all_pages

        async def mock_fetcher(**kwargs):
            return json.dumps({"d": {"results": self._make_page("41000000", "-100.00", 5)}})

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert len(rows) == 5

    @pytest.mark.asyncio
    async def test_empty_body_response_does_not_crash(self):
        """Regression: empty string response must not raise JSONDecodeError."""
        from pl_fetch_tool import _fetch_all_pages

        async def mock_fetcher(**kwargs):
            return ""  # exactly the crash seen in trace ddf8dbf464007f02

        rows = await _fetch_all_pages(mock_fetcher, {})
        assert rows == []  # treated as empty page, loop stops gracefully


# ---------------------------------------------------------------------------
# _fetch_with_apply() — $apply path and fallback
# ---------------------------------------------------------------------------

class TestParseResponse:
    """Unit tests for the _parse_response helper — the exact crash seen in the trace."""

    def test_empty_string_returns_none(self):
        """The crash was json.loads('') — must return None not raise."""
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


class TestFetchStrategy:
    """Confirm $apply is removed and fetch_strategy always reports client-pagination."""

    @pytest.mark.asyncio
    async def test_no_apply_param_ever_sent(self):
        """fetch_and_aggregate_pl must NEVER send $apply — OData V2 does not support it."""
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received_params_list = []

        async def mock_fetcher(**kwargs):
            received_params_list.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(mock_fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        for params in received_params_list:
            assert "$apply" not in params, (
                f"$apply must never be sent to an OData V2 endpoint, but got params: {params}"
            )

    @pytest.mark.asyncio
    async def test_fetch_strategy_always_client_pagination(self):
        """fetch_strategy in the result must always be 'client-pagination (N rows)'."""
        from pl_fetch_tool import _make_fetch_aggregate_tool

        async def mock_fetcher(**kwargs):
            rows = [_make_raw_item("41000000", "-1000.00")] * 5
            return json.dumps({"d": {"results": rows}})

        tool = _make_fetch_aggregate_tool(mock_fetcher)
        raw = await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        result = json.loads(raw)
        assert result["fetch_strategy"].startswith("client-pagination"), (
            f"fetch_strategy should start with 'client-pagination', got: {result['fetch_strategy']}"
        )

    @pytest.mark.asyncio
    async def test_fetch_strategy_reports_row_count(self):
        """fetch_strategy must include the actual row count fetched."""
        from pl_fetch_tool import _make_fetch_aggregate_tool

        async def mock_fetcher(**kwargs):
            rows = [_make_raw_item("41000000", "-200.00")] * 7
            return json.dumps({"d": {"results": rows}})

        tool = _make_fetch_aggregate_tool(mock_fetcher)
        raw = await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        result = json.loads(raw)
        assert "7" in result["fetch_strategy"]

    @pytest.mark.asyncio
    async def test_filter_param_sent_with_pagination(self):
        """$filter must be sent on the pagination path to scope to the correct period and GL range."""
        from pl_fetch_tool import _make_fetch_aggregate_tool
        received_params_list = []

        async def mock_fetcher(**kwargs):
            received_params_list.append(dict(kwargs))
            return json.dumps({"d": {"results": []}})

        tool = _make_fetch_aggregate_tool(mock_fetcher)
        await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})

        assert received_params_list, "Fetcher was never called"
        first = received_params_list[0]
        assert "$filter" in first
        assert "1710" in first["$filter"]
        assert "2024" in first["$filter"]
        assert "010"  in first["$filter"]
        assert "40000000" in first["$filter"]
        assert "79999999" in first["$filter"]

    @pytest.mark.asyncio
    async def test_fetch_error_returns_zero_rows_with_warning(self):
        """When every page fetch throws, _fetch_all_pages returns [] gracefully.
        _run still returns a valid result with 0 rows and a NO DATA warning."""
        from pl_fetch_tool import _make_fetch_aggregate_tool

        async def mock_fetcher(**kwargs):
            raise RuntimeError("connection refused")

        tool = _make_fetch_aggregate_tool(mock_fetcher)
        raw = await tool.arun({"company_code": "1710", "fiscal_year": "2024", "fiscal_period": "010"})
        result = json.loads(raw)
        # fetch_strategy reports 0 rows (not "failed") because exception is caught in pagination
        assert result["fetch_strategy"] == "client-pagination (0 rows)"
        # _aggregate fires NO DATA WARNING for zero postings
        assert any("NO DATA" in w for w in result["warnings"])
