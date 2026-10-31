---
name: pl-analysis
description: Autonomous monthly P&L analysis — period parsing, account fetch, multi-period comparison, materiality drill-down, GM1/GM2, management report
---

# Monthly P&L Analysis Skill

## Prerequisites
- Period (FiscalYear + FiscalPeriod, e.g. 2024/010 for Oct 2024)
- CompanyCode -- ask once if missing
- Materiality threshold -- ask once if missing (default 5% of revenue)

## GL Account Range -- STRICTLY ENFORCED

Use ONLY income-statement GL accounts in the range **40000000-79999999**.
Do NOT include any account outside this range.

NEVER include balance-sheet accounts (any account outside 40000000-79999999 -- cash, receivables, inventory, payables, equity).
If no postings are found in this range -- STOP and ask the user to confirm the GL account ranges. Do not substitute other accounts.

## No Fabrication -- ABSOLUTE RULE
NEVER display a figure that was not retrieved from a tool call.
- If a tool returns no data, an error, or empty results for any period or category: show 'N/A -- not retrieved' for that item. Never fill with placeholder, illustrative, estimated, or example numbers.
- Prior-period columns with no retrieved data must show 'N/A -- not retrieved', never a number.
- A sanity check may be marked OK only if it was actually executed on retrieved data. If a check was not performed, mark it 'NOT PERFORMED' -- never OK.
- Every figure in the report must trace to a specific retrieved journal-entry result.
- Round synthetic values (e.g. exactly 1,000,000 or identical percentages across all lines and profit centers) are a fabrication red flag. If the data looks synthetic, STOP and state that real data could not be retrieved.

## Citation Rule -- MANDATORY
Every figure displayed must come from an aggregate_pl_journal_entries result.
Cite every figure as: amount [GL xxxxxxxx, N postings] using posting_counts from the tool result.
After every fetch, state how many lines were returned. If fewer than expected, warn: 'Only N postings retrieved -- data may be incomplete.'
A figure not traceable to an aggregate_pl_journal_entries result must not be displayed.

## Execution Model
Fetch is atomic -- fetch_and_aggregate_pl retrieves and aggregates all periods in one coordinated set of calls.
Do not split fetch across multiple user turns. Deliver the complete report in one response.

## Steps (execute sequentially)

**1 -- Parse Period**
"October 2024" -> FiscalYear=2024, FiscalPeriod=010. Derive prior month (handle year rollover) and prior year.

**2 -- Confirm P&L Account Structure**
Call `list_a_glaccountinchartofaccounts` filtered by CompanyCode. Keep only accounts in range 40000000-79999999. Discard everything else. If no accounts are found in this range, ask the user: "No P&L accounts found in range 40000000-79999999 -- please confirm the GL account ranges for your chart of accounts."

**3 -- Fetch and Aggregate (single atomic step)**
Call `fetch_and_aggregate_pl` with CompanyCode, FiscalYear, FiscalPeriod, and a label.
Do this once for each period needed (current, prior month, prior year).
NEVER call the journal entry API directly -- fetch_and_aggregate_pl owns the full pipeline:
- It runs a $skip/$top=500 pagination loop until all pages are exhausted.
- It passes all pages to the deterministic aggregator and returns verified pl_lines.

From the result read:
- pl_lines: revenue, cogs, gm1, overhead, gm2, other_op, ebit (already sign-normalized)
- materiality_order: GL accounts sorted by |amount| descending -- use this order for all drill-downs
- posting_counts: include in report citations
- fetch_strategy: include in report so the controller knows how data was retrieved
- warnings: include verbatim as WARNING blocks if non-empty

DO NOT recompute, re-sum, or re-derive any pl_lines value -- use the tool output directly.

**4 -- Read P&L Lines from Tool Result**
Use pl_lines values from fetch_and_aggregate_pl directly:
- Revenue, COGS, GM1, Overhead, GM2, Other Op, EBIT are computed and sign-normalized.
- materiality_order drives all subsequent drill-down ordering (Step 9).
- Stop drilling when cumulative explained deviation >= 80% of total EBIT movement.

**6 -- Sanity Check (on FINAL DISPLAYED figures -- do NOT skip)**
Run all checks. Deliver the report. For every check that fails, add a visible WARNING block showing exactly which check failed and the conflicting figures. Never suppress warnings.

- **Revenue positive**: Displayed Revenue > 0 and non-zero. Warn if not.
- **Distinct P&L lines**: Revenue, GM1 and GM2 must each be distinct. EBIT may equal GM2 ONLY when Other Operating = 0 -- warn if Other Op != 0 and EBIT = GM2.
- **Revenue detail reconciles**: Detail lines sum to Total Revenue within 0.01% or 1 currency unit. Any gap must be explained by a named line item -- never dismissed as rounding. Warn if a detail account appears in the breakdown but not in the total -- inconsistent sign handling.
- **GM1 arithmetic**: GM1 = Revenue - COGS. Recalculate and confirm. Warn if it does not hold.
- **GM2 arithmetic**: GM2 = GM1 - Overhead. Recalculate and confirm. Warn if it does not hold.
- **EBIT arithmetic**: EBIT = GM2 + Other Operating Income - Other Operating Expense. Apply each account's sign by its credit/debit nature -- never guess the sign. Warn if it does not hold.
- **Breakdowns reconcile**: Every breakdown (profit center, functional area, GL account) must sum to the corresponding P&L total within 0.01%. Breakdown > total: warn -- suspect double-counting or sign error. Breakdown < total: warn -- suspect unassigned postings. Name the reconciling bucket.
- **Account scope**: No accounts outside 40000000-79999999 appear anywhere. Warn if found.
- **No postings found**: If no postings in 40000000-79999999, warn and ask user to confirm GL account ranges.

**7 -- Compute Deviations**
For each P&L line: Delta vs prior month and Delta vs prior year. Delta% = Delta / |prior| x 100.

**8 -- Apply Materiality Filter**
Flag lines where |Delta| > threshold amount OR |Delta%| > threshold%. Only flagged lines get drill-down.

**9 -- Drill Down (flagged lines only)**
Call `list_glaccountlineitem_for_cds_api_glaccountlineitem` for the GL range of the flagged line. Top 10 by |amount|. Load deviation-investigation skill for root-cause.

**10 -- GM1/GM2 Notes**
Note any activity allocation accounts (cost element category 43) and whether over/under-absorption is visible.

**11 -- Revenue Enrichment (material revenue moves only)**
Call BusinessPartner API for top customers. Call Product API for top materials. Group by top 5 customers / countries / product groups.

**12 -- Assemble Report (concise -- tables and bullets only)**
1. **P&L Table**: line | current | prior month | Delta | Delta% | prior year | Delta YoY
2. **Key Drivers**: top 5 EBIT drivers, 1-2 sentences each
3. **Org Breakdown**: Profit Center / Functional Area split (call APIs only if needed)
4. **Flagged Items**: wrong bookings and one-time effects with document numbers

## Flag Rules
| Rule | Condition |
|------|-----------|
| Dominant entry | Single posting > 80% of line deviation |
| Wrong side | Revenue account debited; cost account credited unexpectedly |
| Correction keyword | Text contains: correction, reversal, Storno, one-time, Korrekt |
| Large accrual | Doc type AA/AE, amount >> prior period |

## After Report
Stay in Q&A mode. Fetch live data for every follow-up -- never answer from memory.
