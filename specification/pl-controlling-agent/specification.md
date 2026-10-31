# Specification: pl-controlling-agent

> **Guidelines**: Read all applicable guidelines before executing ANY tasks below:
> - [guidelines.md](../guidelines.md) — Universal execution rules
> - [guidelines-agent.md](../guidelines-agent.md) — Universal agent patterns
> - [guidelines-agent-python.md](../guidelines-agent-python.md) — Python implementation details
> - [guidelines-agent-skills.md](../guidelines-agent-skills.md) — Runtime skills patterns
> - [guidelines-agent-mcp.md](../guidelines-agent-mcp.md) — MCP integration patterns

---

## Basic Setup

- [ ] Read the project input: `product-requirements-document.md` and `intent.md` at solution root
- [ ] Bootstrap agent code in `assets/pl-controlling-agent/` using instructions from the `sap-agent-bootstrap` skill (invoke from inside `assets/pl-controlling-agent/`, use copy commands — do NOT create files manually)
- [ ] Install dependencies, validate the agent starts and responds at `/.well-known/agent.json`

---

## Runtime Skills

This agent requires runtime skills — the P&L analysis workflow involves complex multi-step reasoning with domain-specific controlling rules, margin structure definitions, and reporting templates that would bloat the system prompt if included inline.

Create the following runtime skill files under `assets/pl-controlling-agent/app/skills/`:

- [ ] Create `assets/pl-controlling-agent/app/skills/pl-analysis/SKILL.md` with:
  - **name**: `pl-analysis`
  - **description**: Step-by-step instructions for autonomous monthly P&L analysis — period parsing, P&L hierarchy construction, multi-period comparison, materiality-gated drill-down, GM1/GM2/EBIT explanation, and management report formatting
  - **Body**: Cover these steps in order:
    1. Parse target period and company code from the user prompt
    2. Retrieve G/L account hierarchy and assemble the P&L structure (Sales → Cost of Sales → GM1 → Overhead Absorption → GM2 → further cost lines → EBIT); map each G/L account to its P&L line
    3. Retrieve GL account line items for the target period via `fetch_and_aggregate_pl` (Ledger='0L', FiscalYear, FiscalPeriod, GLAccount 40000000–79999999); aggregate by P&L line
    4. Retrieve GL account line items for comparison periods (prior month, prior year) via the same tool; compute absolute and percentage deviations per P&L line
    5. Apply materiality filter: select all lines where the absolute or percentage deviation exceeds the threshold; proceed with drill-down for those lines only
    6. For each material line: retrieve individual GL account line items with document attributes via `API_GLACCOUNTLINEITEM` (drill-down path); rank by contribution magnitude; identify dominant postings
    7. Explain GM1 (direct cost) drivers: separate variable cost postings from fixed cost postings by G/L account category
    8. Explain GM2 / overhead absorption: identify overhead allocation postings (cost element category 43 or overhead cost orders); compute over-/under-absorption as difference between absorbed overhead and actual overhead
    9. Enrich revenue and sales postings: retrieve customer name + country from Business Partner API and product description from Product Master API for all revenue/sales journal entry items
    10. Produce the management report (see report format in `references/report-format.md`)
    11. Flag suspected wrong bookings (large single postings dominating a line, postings to unexpected account types, items with "one-time" / "correction" / "reversal" in the text) — present as a separate flagged items list with reason and controller action required

- [ ] Create `assets/pl-controlling-agent/app/skills/pl-analysis/references/report-format.md` with the management report template:
  - **Section 1 — P&L Deviation Table**: columns: P&L Line | Actual (current) | Actual (prior month) | Δ abs. | Δ % | Actual (prior year) | Δ abs. | Δ % — organized Sales to EBIT, sorted by absolute EBIT impact within each section
  - **Section 2 — Key Driver Narrative**: written explanation of top 5–7 EBIT drivers by impact magnitude; each driver: line name, magnitude, direction (favorable/unfavorable), root cause found in journal entries, whether it is a structural change or a one-time effect
  - **Section 3 — Functional Area / Profit Center Breakdown**: deviation table grouped by Functional Area, then by Profit Center within each Functional Area
  - **Section 4 — Flagged Items**: table of suspected wrong bookings and one-time effects: Journal Entry | G/L Account | Amount | Posting Date | Reason for Flag | Recommended Controller Action
  - **Formatting rules**: all amounts in reporting currency; positive = favorable, negative = unfavorable; missing comparison period = show "N/A" with note; never show a zero unless actually retrieved as zero

- [ ] Create `assets/pl-controlling-agent/app/skills/pl-analysis/references/controlling-glossary.md` with definitions for: GM1, GM2, EBIT, over-absorption, under-absorption, cost element category, profit center, functional area, cost center, materiality threshold — these definitions guide the agent's narrative generation

- [ ] Create `assets/pl-controlling-agent/app/skills/deviation-investigation/SKILL.md` with:
  - **name**: `deviation-investigation`
  - **description**: Deep-dive investigation instructions for a single material deviation — how to drill from a P&L line to G/L accounts to journal entries to supporting documents and formulate the root-cause explanation
  - **Body**: step-by-step drill-down: (1) retrieve all journal entries contributing to the deviating P&L line for both periods, (2) rank entries by contribution magnitude, (3) for the top entries retrieve supporting document header attributes (document type, reference, assignment field, posting text), (4) identify posting patterns (recurring vs. one-time, normal vs. unusual account usage), (5) formulate a plain-language root-cause sentence citing document numbers and amounts

---

## Project-Specific Tasks

### System Prompt and Agent Personality

- [ ] Open `assets/pl-controlling-agent/app/agent.py` and set the system prompt (`get_system_prompt`) to include:
  - Role: autonomous monthly P&L analysis agent for financial controllers; expert in SAP S/4HANA financial accounting, controlling, and management reporting
  - Core instruction: load the `pl-analysis` skill when the user names a target period; proceed autonomously through all analysis steps without waiting for user prompts between steps
  - Data integrity rule: NEVER produce a figure that was not retrieved from a tool call in the current session; if data is unavailable, state so explicitly; never estimate or interpolate
  - Read-only constraint: the agent never writes, posts, creates, or modifies any SAP document; it is strictly read-only
  - Pagination rule: always use `fetch_and_aggregate_pl` for P&L line item retrieval — it handles the full top=500/skip pagination loop internally and returns deterministic aggregated totals; never call the GL account line item API directly or manually page through results
  - Comparison period rule: if a comparison period returns no data (e.g., system recently live), state "no data available for [period]" explicitly in the report — never show zero or omit the column silently
  - Materiality rule: ask the user for the materiality threshold if not provided before starting the drill-down phase; accept both absolute (e.g., "€50,000") and percentage (e.g., "5%") formats
  - Error handling: relay tool errors verbatim; do not suggest workarounds unless asked
  - Follow-up Q&A: after delivering the report, remain available to answer questions about any P&L line, G/L account, or journal entry; always retrieve live data for answers

### P&L Hierarchy Construction (REQ-02)

- [ ] Implement a tool or agent reasoning step that:
  - Calls the G/L Account API (`API_GLACCOUNTINCHARTOFACCOUNTS_SRV`) to retrieve G/L accounts for the chart of accounts and company code
  - Groups accounts by P&L section using the account range / hierarchy node information: Net Revenue (sales accounts), Cost of Sales (direct cost accounts), Overhead Costs, and Other Income/Expense down to EBIT
  - Builds a mapping: `gl_account → p_and_l_line_label` used in all downstream aggregations
  - Handles cases where the hierarchy is not fully populated — logs a warning and continues with available accounts

### GL Account Line Item Retrieval and Aggregation (REQ-01, REQ-02, REQ-03)

- [ ] Implement retrieval of GL account line items for the target period using `API_GLACCOUNTLINEITEM` via `fetch_and_aggregate_pl`:
  - Filter: `Ledger eq '0L' and CompanyCode eq '{cc}' and GLAccount ge '40000000' and GLAccount le '79999999' and FiscalYear eq '{fy}' and FiscalPeriod eq '{fp}'`
  - Select fields: `GLAccount`, `AmountInCompanyCodeCurrency`, `CompanyCodeCurrency`, `ProfitCenter`, `FunctionalArea`, `CostCenter`, `AccountingDocument`, `FiscalYear`, `FiscalPeriod`, `Ledger`
  - Use `fetch_and_aggregate_pl` tool (deterministic Python aggregation — never LLM arithmetic) to retrieve all pages via top=500/skip loop and aggregate into P&L totals
  - Apply the same retrieval for prior month and prior year comparison periods
  - Compute absolute and percentage deviations per P&L line per comparison period
  - Note: `API_JOURNALENTRYITEMBASIC_SRV` is no longer used for P&L line retrieval — it lacks a standalone `FiscalYear` filter field (only `FiscalYearPeriod` YYYYPPP exists), which caused 0-row results; `API_GLACCOUNTLINEITEM` has proper `FiscalYear` and `FiscalPeriod` fields

### Deviation Table Generation (REQ-03)

- [ ] Build the deviation table structure as described in the report format skill:
  - Columns: P&L Line | Actual (period) | Prior Month | Δ abs. | Δ % | Prior Year | Δ abs. | Δ %
  - Mark missing comparison periods explicitly as "N/A — [reason]"
  - Sort lines Sales to EBIT; within each section sort by absolute EBIT impact descending

### Materiality-Gated Drill-Down (REQ-04)

- [ ] Implement the materiality filter:
  - Accept threshold as absolute amount (currency), percentage of revenue, or both
  - Select all P&L lines where deviation vs. prior month OR deviation vs. prior year exceeds threshold
  - For each selected line: retrieve G/L account line items using `API_GLACCOUNTLINEITEM` filtered by G/L account range and fiscal period
  - For the top contributing journal entries: retrieve document attributes (document type, reference, assignment, posting text)
  - Rank entries by absolute contribution magnitude within each P&L line

### GM1 and GM2 / Overhead Absorption Analysis (REQ-05)

- [ ] Implement GM1 calculation:
  - GM1 = Net Revenue − Cost of Sales (direct material, direct labor, variable production costs)
  - Identify direct cost postings by G/L account range (accounts in Cost of Sales section of hierarchy)
  - State clearly if the exact account categorization (direct vs. overhead) cannot be determined from the hierarchy alone

- [ ] Implement GM2 / overhead absorption analysis:
  - GM2 = GM1 − Overhead Absorption
  - Identify overhead absorption postings: cost element category postings and internal order settlements that appear as credits in production cost accounts
  - Compute over-/under-absorption = actual overhead absorbed (credit postings) vs. actual overhead incurred (debit postings on overhead cost centers)
  - If CO-PA structure is active (Margin Analysis), note in the report that a CO-PA-based margin analysis is available as an extension

### Revenue and Sales Enrichment (REQ-06)

- [ ] For all journal entry items on revenue / sales G/L accounts:
  - Retrieve customer (Business Partner) using `API_BUSINESS_PARTNER`: fields `BusinessPartner`, `BusinessPartnerFullName`, `Country`
  - Retrieve product description using `API_PRODUCT_SRV`: fields `Product`, `ProductDescription`, `ProductGroup`
  - Enrich the drill-down entries with these dimensions; use them in the Functional Area / Profit Center breakdown

### Management Report Assembly (REQ-07)

- [ ] Assemble the four-section report following the format defined in `skills/pl-analysis/references/report-format.md`:
  - Section 1: P&L Deviation Table (full Sales-to-EBIT)
  - Section 2: Key Driver Narrative (top 5–7 EBIT drivers, plain language)
  - Section 3: Functional Area / Profit Center Breakdown (segment deviation table)
  - Section 4: Flagged Items (suspected wrong bookings and one-time effects)

- [ ] Implement flagging logic:
  - Flag: single journal entry that accounts for > 80% of a P&L line's total deviation
  - Flag: postings to a G/L account whose account type is inconsistent with the posting side (e.g., revenue account with debit posting in an unexpected period)
  - Flag: posting text containing keywords: "correction", "reversal", "one-time", "Korrekt", "Umbuchung", "Einmaleffekt" (multilingual)
  - Flag: period-end accrual postings (document type AA, AE, or equivalent) that are unusually large vs. prior periods
  - Present each flag with: reason for flag, journal entry reference, amount, and suggested controller action (review, confirm, or reverse)

### Follow-Up Q&A (REQ-08)

- [ ] Ensure the agent remains in Q&A mode after delivering the report:
  - Responds to questions about any P&L line, G/L account, or journal entry using live API calls
  - Supports queries like: "Show all postings to cost center X in [period]", "What drove the COGS increase?", "List the top 10 journal entries on account Y"
  - All figures in follow-up answers must come from fresh or cached (within-session) API retrieval — never from LLM memory

### Data Traceability and Unavailability Transparency (REQ-09)

- [ ] Add a data traceability layer:
  - Every figure in the report is annotated with its source: G/L account number + journal entry document number + posting date (shown in a footnote or expandable reference)
  - When a tool returns no results: emit "No data found for [filter criteria]" — never return zero or omit
  - When a comparison period is missing: emit "Prior year data unavailable for [period] — system may be recently live or data not yet loaded"

---

## API Integrations

All API interactions go through MCP tools generated from the specs below. **Never call SAP APIs directly.**

### API Spec Files Downloaded

| API Name | ORD ID | Spec File |
|---|---|---|
| GL Account Line Items - Read *(P&L aggregation + drill-down)* | `sap.s4:apiResource:API_GLACCOUNTLINEITEM:v1` | `api-specs/API_GLACCOUNTLINEITEM.edmx` |
| GL Account - Read | `sap.s4:apiResource:API_GLACCOUNTINCHARTOFACCOUNTS_SRV:v1` | `api-specs/API_GLACCOUNTINCHARTOFACCOUNTS_SRV.edmx` |
| Profit Center | `sap.s4:apiResource:CE_PROFITCENTER_0001:v1` | `api-specs/CE_PROFITCENTER_0001.edmx` |
| Functional Area - Read | `sap.s4:apiResource:API_FUNCTIONALAREA_SRV:v1` | `api-specs/API_FUNCTIONALAREA_SRV.edmx` |
| Cost Center | `sap.s4:apiResource:CE_COSTCENTER_0001:v1` | `api-specs/CE_COSTCENTER_0001.edmx` |
| Business Partner (A2X) | `sap.s4:apiResource:API_BUSINESS_PARTNER:v1` | `api-specs/API_BUSINESS_PARTNER.edmx` |
| Product Master (A2X) | `sap.s4:apiResource:API_PRODUCT_SRV:v1` | `api-specs/API_PRODUCT_SRV.edmx` |

### MCP Tool Scope

```
MCP API: sap.s4:apiResource:API_GLACCOUNTLINEITEM:v1
MCP tool scope: read-only
Resources in scope: GLAccountLineItem
Filter fields (confirmed from EDMX): Ledger, CompanyCode, FiscalYear, FiscalPeriod, GLAccount
Usage: (1) P&L aggregation via fetch_and_aggregate_pl (Ledger='0L', full pagination);
       (2) document-level drill-down for root-cause analysis
```

```
MCP API: sap.s4:apiResource:API_GLACCOUNTINCHARTOFACCOUNTS_SRV:v1
MCP tool scope: read-only
Resources in scope: A_GLAccountInChartOfAccounts, A_GLAccountText
```

```
MCP API: sap.s4:apiResource:CE_PROFITCENTER_0001:v1
MCP tool scope: read-only
Resources in scope: ProfitCenter, ProfitCenterText
```

```
MCP API: sap.s4:apiResource:API_FUNCTIONALAREA_SRV:v1
MCP tool scope: read-only
Resources in scope: A_FunctionalArea, A_FunctionalAreaText
```

```
MCP API: sap.s4:apiResource:CE_COSTCENTER_0001:v1
MCP tool scope: read-only
Resources in scope: CostCenter, CostCenterText
```

```
MCP API: sap.s4:apiResource:API_BUSINESS_PARTNER:v1
MCP tool scope: read-only
Resources in scope: A_BusinessPartner, A_BusinessPartnerAddress
```

```
MCP API: sap.s4:apiResource:API_PRODUCT_SRV:v1
MCP tool scope: read-only
Resources in scope: A_Product, A_ProductDescription
```

---

## MCP Tool Integration

- [ ] Invoke `mcp-translation-file` skill for each of the 8 API spec files in `specification/pl-controlling-agent/api-specs/` to generate MCP translation cards — outputs to `specification/pl-controlling-agent/mcps/<api-spec-stem>/`
- [ ] Invoke `setup-solution` skill to create `solution.yaml`, the agent `asset.yaml`, and MCP server assets for all generated translation cards
- [ ] Wire MCP tool loading in `agent.py` using `get_mcp_tools()` from the `mcp_tools` module (bootstrap-generated indirection layer) — see `guidelines-agent-python.md` for canonical pattern
- [ ] Add all 8 MCP server dependencies to `asset.yaml` under `requires` using exact ORD IDs from the generated MCP server assets — read ORD IDs from `grep '^ordId:' assets/<mcp-server-asset-name>/asset.yaml`; **never invent or guess ORD IDs**
- [ ] Generate `mcp-mock.json` using the `mcp-mock-config` skill after all MCP translation cards and assets are complete — required before tests can run

---

## Business Instrumentation

- [ ] Instrument all 5 milestones from the PRD with structured logging and OpenTelemetry spans — extract business logic from `stream()` into a plain async helper `_run_analysis()` to avoid `GeneratorExit` context errors:

  | Milestone | Log on achievement | Log on miss |
  |---|---|---|
  | M1: Period Invocation | `M1.achieved: period invocation successful — period={period}, company_code={cc}, session_id={sid}` | `M1.missed: could not interpret target period or company code from prompt — input={input}` |
  | M2: P&L Structure Retrieved | `M2.achieved: P&L structure built — lines={count}, total_revenue={amount}, ebit={amount}, period={period}` | `M2.missed: P&L structure could not be built — reason={reason}, period={period}` |
  | M3: Multi-Period Comparison Completed | `M3.achieved: multi-period comparison complete — lines={count}, comparisons={periods}, missing={missing}` | `M3.missed: multi-period comparison failed — reason={reason}` |
  | M4: Deviation Root Cause Identified | `M4.achieved: drill-down complete — material_lines={count}, journal_entries_retrieved={count}, flagged_items={count}` | `M4.missed: drill-down incomplete — lines_not_resolved={count}, reason={reason}` |
  | M5: Management Report Delivered | `M5.achieved: management report delivered — period={period}, flagged_items={count}, session_id={sid}` | `M5.missed: report could not be completed — reason={reason}, session_id={sid}` |

- [ ] Verify `bootstrap(app)` is called after `app = server.build()` in `main.py`

---

## Testing

- [ ] `conftest.py` only sets `IBD_TESTING=true`
- [ ] Write unit tests in `assets/pl-controlling-agent/tests/` — one test per MCP tool / agent reasoning path; run each immediately after writing:
  - `test_journal_entry_retrieval.py` — tests journal entry item tool call with period and company code filters
  - `test_gl_account_hierarchy.py` — tests G/L account retrieval and P&L mapping construction
  - `test_gl_line_items.py` — tests GL line items drill-down for a given account and period
  - `test_profit_center.py` — tests Profit Center retrieval
  - `test_functional_area.py` — tests Functional Area retrieval
  - `test_cost_center.py` — tests Cost Center retrieval
  - `test_business_partner.py` — tests Business Partner retrieval for customer enrichment
  - `test_product_master.py` — tests Product Master retrieval for product enrichment
  - `test_deviation_calculation.py` — tests deviation table logic (absolute + percentage, missing period handling)
  - `test_materiality_filter.py` — tests materiality threshold application (both absolute and percentage)
  - `test_flagging_logic.py` — tests wrong booking and one-time effect flagging rules
  - `test_instrumentation.py` — tests that all 5 milestone log statements are emitted at the correct stages
- [ ] Write one integration test `test_pl_analysis_flow.py` — end-to-end test invoking the agent's `invoke` function with a mocked LLM and mocked MCP tool responses covering a full period analysis cycle (P&L build → comparison → drill-down → report delivery); assert M1–M5 milestone logs are all emitted; tests must run offline
- [ ] Run `pytest` from `assets/pl-controlling-agent/` (no args) — if coverage < 70%, add tests until threshold met
- [ ] Run `pytest` again (no args) to generate final `test_report.json`
- [ ] Verify `test_report.json` exists in `assets/pl-controlling-agent/`
