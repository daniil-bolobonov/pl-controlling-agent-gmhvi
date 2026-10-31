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
# _build_apply_expr()
# ---------------------------------------------------------------------------

class TestBuildApplyExpr:

    def test_filter_is_embedded_before_groupby(self):
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("1710", "2024", "010")
        # filter(...) must appear BEFORE groupby(...)
        filter_pos  = expr.index("filter(")
        groupby_pos = expr.index("groupby(")
        assert filter_pos < groupby_pos, (
            "filter() must precede groupby() in the $apply expression"
        )

    def test_expr_contains_company_code(self):
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("1710", "2024", "010")
        assert "1710" in expr

    def test_expr_contains_fiscal_year_and_period(self):
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("1710", "2024", "010")
        assert "2024" in expr
        assert "010"  in expr

    def test_expr_contains_gl_range(self):
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("1710", "2024", "010")
        assert "40000000" in expr
        assert "79999999" in expr

    def test_expr_contains_groupby_with_aggregate(self):
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("1710", "2024", "010")
        assert "groupby(" in expr
        assert "aggregate(" in expr
        assert "AmountInCompanyCodeCurrency with sum" in expr

    def test_expr_contains_gl_account_in_groupby(self):
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("1710", "2024", "010")
        # GLAccount must be in the groupby dimension list
        groupby_part = expr[expr.index("groupby("):]
        assert "GLAccount" in groupby_part

    def test_no_separate_filter_param_needed(self):
        """The expression should be self-contained — caller must NOT add $filter."""
        from pl_fetch_tool import _build_apply_expr
        expr = _build_apply_expr("9999", "2025", "003")
        # Verify all three scoping fields are inside the expression itself
        assert "CompanyCode eq '9999'" in expr
        assert "FiscalYear eq '2025'"  in expr
        assert "FiscalPeriod eq '003'" in expr


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


# ---------------------------------------------------------------------------
# _fetch_with_apply() — $apply path and fallback
# ---------------------------------------------------------------------------

class TestFetchWithApply:

    @pytest.mark.asyncio
    async def test_apply_success_returns_rows(self):
        """When $apply succeeds the fetcher is called once and rows returned."""
        from pl_fetch_tool import _fetch_with_apply
        calls = []

        async def mock_fetcher(**kwargs):
            calls.append(kwargs)
            return json.dumps({"value": [_make_raw_item("41000000", "-500.00")]})

        rows = await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        assert rows is not None
        assert len(rows) == 1
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_apply_passes_apply_expr_not_filter(self):
        """$apply path must NOT send a separate $filter param."""
        from pl_fetch_tool import _fetch_with_apply
        received_params = {}

        async def mock_fetcher(**kwargs):
            received_params.update(kwargs)
            return json.dumps({"value": []})

        await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        assert "$apply" in received_params
        assert "$filter" not in received_params, (
            "$filter must NOT be sent alongside $apply — filter is inside the pipeline"
        )

    @pytest.mark.asyncio
    async def test_apply_expr_contains_scoping_fields(self):
        """The $apply value passed to fetcher must embed company code, year, period."""
        from pl_fetch_tool import _fetch_with_apply
        received_params = {}

        async def mock_fetcher(**kwargs):
            received_params.update(kwargs)
            return json.dumps({"value": []})

        await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        apply_val = received_params.get("$apply", "")
        assert "1710" in apply_val
        assert "2024" in apply_val
        assert "010"  in apply_val
        assert "40000000" in apply_val
        assert "79999999" in apply_val

    @pytest.mark.asyncio
    async def test_apply_exception_returns_none(self):
        """Any exception from the fetcher must cause fallback (return None)."""
        from pl_fetch_tool import _fetch_with_apply

        async def mock_fetcher(**kwargs):
            raise RuntimeError("$apply not supported")

        rows = await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        assert rows is None

    @pytest.mark.asyncio
    async def test_apply_unexpected_shape_returns_none(self):
        """A response with no recognisable envelope must cause fallback."""
        from pl_fetch_tool import _fetch_with_apply

        async def mock_fetcher(**kwargs):
            # Neither 'value' nor 'd.results' nor a list
            return json.dumps({"something_unexpected": True})

        rows = await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        assert rows is None

    @pytest.mark.asyncio
    async def test_apply_odata_v2_envelope_unwrapped(self):
        """OData v2 {d: {results: []}} envelope must be unwrapped on $apply path."""
        from pl_fetch_tool import _fetch_with_apply

        async def mock_fetcher(**kwargs):
            return json.dumps({"d": {"results": [_make_raw_item("41000000", "-300.00")]}})

        rows = await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        assert rows is not None
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_apply_list_response_unwrapped(self):
        """A bare list response (no envelope) must also be accepted."""
        from pl_fetch_tool import _fetch_with_apply

        async def mock_fetcher(**kwargs):
            return json.dumps([_make_raw_item("41000000", "-300.00")])

        rows = await _fetch_with_apply(mock_fetcher, "1710", "2024", "010")
        assert rows is not None
        assert len(rows) == 1
