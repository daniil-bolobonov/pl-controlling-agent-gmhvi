# Product Requirements Document (PRD)

**Title:** P&L Controlling Agent — Monthly P&L Analysis from Sales to EBIT
**Date:** 2026-10-30
**Owner:** Controlling / Finance
**Solution Category:** AI Agent (Python, A2A protocol)

---

## Product Purpose & Value Proposition

**Elevator Pitch:**
Controlling teams spend multiple days each month manually analyzing the P&L after close — navigating SAP transactions, exporting data to spreadsheets, and assembling deviation tables by hand. The P&L Controlling Agent eliminates this bottleneck: one prompt from the controller triggers a fully autonomous multi-layer analysis and delivers a management-ready deviation report — with narrative — in minutes.

**Business Need:**
After each monthly close, the Controlling team must explain the P&L from Sales to EBIT to management: what drove revenue, gross margin, and EBIT versus prior month, prior year, forecast, and business plan. Today this work is manual and time-consuming. Material drivers are often missed at the aggregated level because the drill-down to journal entries and supporting documents is laborious. The result is a reporting bottleneck that delays management decision-making and exposes the company to errors and omissions.

There is no standard SAP product that automates this autonomous multi-layer narrative. A custom AI agent is required.

**Expected Value:**
- Reduction of monthly P&L analysis cycle from multiple days to minutes (baseline and target to be confirmed in design workshop)
- 100% of material deviations above the agreed materiality threshold identified and explained down to journal-entry level
- All figures fully traceable to retrieved SAP data — no fabricated numbers, no manual reconciliation
- Controlling team adopts the agent as the standard first-pass analysis tool for every monthly close

**Product Objectives (Prioritized):**
1. Deliver a fully autonomous, single-prompt monthly P&L analysis from Sales to EBIT — no step-by-step orchestration by the controller
2. Identify and explain all material deviations (GM1, GM2, EBIT) down to journal entry and supporting document level
3. Produce a management-ready report: deviation table organized by EBIT impact and by Functional Area / Profit Center, plus narrative, plus flagged items
4. Ensure 100% data traceability — every figure in the report must come from retrieved SAP data
5. Support follow-up questions about any P&L line, account, or journal entry within the same session

---

## Business Metrics

| Metric | Baseline | Target | Timeline | Process / Capability | Source |
|--------|----------|--------|----------|----------------------|--------|
| Time to complete monthly P&L driver analysis | ~[X days] — to be confirmed in design workshop | ~[Y minutes/hours] per monthly close | First monthly close post go-live | Monthly P&L Analysis (Finance Close) | user |
| Autonomy: controller inputs one prompt, agent completes full multi-step analysis without step-by-step orchestration | Manual, multi-step, human-orchestrated today | 100% autonomous top-down drill (P&L → G/L → journal entry) | — | P&L Drill-Down & Root Cause Analysis | user |
| Completeness: all material Sales-to-EBIT deviations identified and explained | Aggregated-level analysis, offsetting effects missed today | All deviations above materiality threshold (€/% — to be defined in design workshop) | — | Deviation Analysis & Reporting | user |
| Accuracy / traceability: all figures traceable to retrieved SAP data, no fabricated numbers | No automated check today | 100% — agent states clearly when data is unavailable | — | Data Integrity & Compliance | user |
| Adoption: used by Controlling as standard first-pass analysis every monthly close | Ad hoc / no standard tool | Regular monthly close standard (adoption % to be defined) | — | Controller Adoption | user |

**Notes:** Concrete baseline durations, materiality threshold values, and adoption percentages are open items deferred to the design workshop.

---

## User Profiles & Personas

### Primary Persona: The Financial Controller

Maria is a 38-year-old Senior Controller at a mid-size manufacturing company. Each month, within days of period-end close, she must explain the P&L to the CFO and business unit heads — what drove revenue, gross margin, and EBIT versus plan, prior month, and prior year. Today this takes her 2–3 days: she opens multiple SAP transactions, exports data to Excel, manually builds deviation tables, and then writes the narrative from memory and judgment. She is highly skilled in S/4HANA Finance but frustrated by how much time she wastes on data gathering versus actual analysis. She is skeptical of AI tools that generate numbers she cannot verify — trustworthiness and traceability are non-negotiable. She needs a tool that does the data retrieval and structuring work for her so she can focus on interpretation and management communication.

**Goals:**
- Complete the monthly P&L driver analysis in under one hour after period-end close
- Identify every material deviation from budget, plan, and prior periods before presenting to management
- Present a deviation report that management can trust because every number is sourced from SAP

**Key Tasks:**
- Invoke the agent with the target period (e.g., "Analyze September 2026")
- Review the deviation table and narrative, validate flagged items
- Ask follow-up questions to investigate specific line items or bookings
- Bring the report output directly to the monthly management review

### Secondary Persona: The Finance Manager / CFO

Thomas is the Finance Director who receives the monthly P&L narrative. He does not operate SAP directly. He needs a clear, well-structured explanation of what happened in the P&L — organized by EBIT impact — and he needs to know which items are one-time effects or suspected errors so he can form an accurate view of the underlying business performance. He relies on Maria's analysis; anything that makes her faster and more thorough directly improves the quality of information he acts on.

### Other User Types

- **IT / SAP Basis Administrator:** Manages connectivity between the agent and SAP S/4HANA (Agent Gateway, API authorization). Not a regular user of the agent.

---

## User Goals & Tasks

### For the Financial Controller (Maria):

**Goals:**
- Trigger a complete, management-ready P&L analysis with a single prompt
- Understand root causes of every material deviation without manual SAP navigation
- Receive a flagged list of suspected wrong bookings and one-time effects before presenting to management

**Key Tasks:**
- Send a prompt naming the target period (e.g., "Analyze P&L for September 2026")
- Review the returned deviation table (actuals vs. prior month, prior year)
- Read the narrative explanation of GM1, GM2, and EBIT drivers
- Review flagged items (wrong bookings, one-time effects) and decide on actions
- Ask follow-up questions about specific lines, accounts, or journal entries

### For the Finance Manager / CFO (Thomas):

**Goals:**
- Receive a clear, structured P&L deviation narrative organized by EBIT impact
- Quickly identify one-time effects and suspected errors to form an accurate view of underlying performance

**Key Tasks:**
- Review the management report produced by the agent (delivered by the controller)
- Request clarifications from the controller (who can use the agent's follow-up Q&A to answer)

---

## Product Principles

1. **Data before narrative:** Every number in the report must come from retrieved SAP data. The agent never estimates, interpolates, or fabricates figures. When data is unavailable, it says so explicitly.
2. **Autonomy by default:** The agent proceeds through all analysis layers without waiting for the controller to prompt the next step. The controller reviews results, not the process.
3. **Materiality-first drill-down:** The agent prioritizes explanations by EBIT impact. It does not enumerate every line — it focuses the controller's attention on what matters most.
4. **Read-only, always:** The agent never posts, modifies, or reverses any SAP document. Trust is non-negotiable.
5. **Transparency over completeness:** If a comparison period is missing (e.g., system recently live, no prior-year data), the agent states this clearly rather than silently omitting the column.

---

## Business Context

**Current State:**
After each monthly close, Controllers manually navigate multiple S/4HANA transactions to collect P&L data, export it to Excel, build deviation tables, and write explanations. The drill-down from an aggregated P&L line to the root-cause journal entry can require many manual steps. Material offsetting effects that would only be visible at the journal-entry level are frequently missed. The entire cycle takes multiple days and must be completed under time pressure before the management review.

**Strategic Alignment:**
The agent directly supports the Finance function's goal to accelerate the financial close-and-report cycle, improve data quality in management reporting, and free Controllers from mechanical data-gathering work so they can focus on analysis and business partnering.

---

## Goals and Non-Goals

### Goals (In Scope)

- Autonomous monthly P&L analysis from Sales to EBIT for a named period, for a single company code
- Multi-period actuals comparison: current period vs. prior month and prior year
- Top-down drill-down: aggregated P&L → G/L account → journal entry item → supporting document
- GM1 and GM2 explanation, including overhead absorption variances and product margin contributions
- Revenue and sales line enrichment with customer, country, and product dimensions
- Management-ready report: deviation table organized by EBIT impact and by Functional Area / Profit Center, plus written narrative
- Flagging of suspected wrong bookings and one-time effects for controller review
- Follow-up Q&A within the same session on any P&L line, account, or journal entry

### Non-Goals (Out of Scope)

- Actuals vs. plan / forecast comparison (deferred until plan data source is confirmed)
- Writing, reversing, or posting any document in SAP — the agent is strictly read-only
- Multi-company-code consolidation or group-level P&L
- Standalone UI or front-end application
- Automated distribution of the report (email, Teams, etc.) — controller shares manually
- Replacing the controller's judgment — the agent flags, the controller decides and acts

---

## Requirements

### Must-Have Requirements

**REQ-01: Period Invocation and Autonomous Execution**

- **Problem to Solve:** Controllers today must manually orchestrate each step of the P&L analysis. A single prompt should be enough to trigger the entire process.
- **User Story:** As a Financial Controller, I need to name a target period in a single prompt so that the agent autonomously performs the complete multi-step P&L analysis without me orchestrating each step.
- **Acceptance Criteria:**
  - Given a prompt naming a fiscal period and company code, when the agent receives it, then it proceeds through all analysis layers (P&L structure → comparison → drill-down → report) without requiring further input from the user.
  - Given the agent cannot determine the company code from context, when it needs it, then it asks the user once before proceeding.
- **Maps to Objective:** 1 — Autonomous single-prompt analysis
- **Priority Rank:** 1

**REQ-02: P&L Structure Construction from G/L Account Hierarchy**

- **Problem to Solve:** The P&L is built by fetching all GL account line items in the P&L account-number range (40000000–79999999) filtered by `Ledger='0L'` and the target period, then grouping accounts into P&L lines (Revenue, COGS, Overhead, Other Op) by account range.
- **User Story:** As a Financial Controller, I need the agent to retrieve all GL line items in the P&L account range and aggregate them into a Sales → GM1 → GM2 → EBIT structure so that I receive a complete P&L without manually mapping accounts.
- **Acceptance Criteria:**
  - Given a target period and company code, when the agent builds the P&L, then it fetches all `API_GLACCOUNTLINEITEM` rows for `Ledger='0L'`, `FiscalYear`, `FiscalPeriod`, and GLAccount range 40000000–79999999 via `fetch_and_aggregate_pl`, and groups them into P&L lines by account-number range.
  - The assembled P&L covers all lines from Net Sales to EBIT.
- **Maps to Objective:** 1, 4
- **Priority Rank:** 2

**REQ-03: Multi-Period Actuals Comparison**

- **Problem to Solve:** Management needs to understand not just what happened but how it compares to prior periods. Producing this manually is the primary time sink for Controllers.
- **User Story:** As a Financial Controller, I need a deviation table comparing actuals for the target period against prior month and prior year for every P&L line so that I can immediately see where performance diverged.
- **Acceptance Criteria:**
  - Given actuals for the target period, prior month, and prior year are available in S/4HANA, when the agent completes the comparison, then it produces a table with absolute and percentage deviations for each P&L line for both comparison periods.
  - Given a comparison period is not available (e.g., system recently live), when the agent builds the table, then it marks the missing column explicitly rather than showing zeros.
- **Maps to Objective:** 1, 2, 4
- **Priority Rank:** 3

**REQ-04: Materiality-Gated Drill-Down to Journal Entry Level**

- **Problem to Solve:** Not every P&L line warrants deep investigation. The agent must focus the controller's attention on lines where the deviation is material and drill all the way to journal entries and supporting documents to explain root causes.
- **User Story:** As a Financial Controller, I need the agent to automatically drill into every P&L line where the deviation exceeds the materiality threshold — from the G/L account to individual journal entry items and their supporting documents — so that I understand the root cause of each material variance without manual navigation.
- **Acceptance Criteria:**
  - Given a configurable materiality threshold (amount and/or percentage), when the agent identifies a deviation above the threshold, then it drills from the P&L line into the contributing G/L accounts, then into individual journal entry items, and retrieves key supporting document attributes.
  - The drill-down result shows: G/L account, journal entry number, posting date, amount, cost object (Profit Center / Cost Center / Functional Area), business partner (where applicable), and document reference.
- **Maps to Objective:** 2
- **Priority Rank:** 4

**REQ-05: GM1, GM2, and EBIT Driver Explanation**

- **Problem to Solve:** Controllers must explain margin structure — not just P&L lines. This requires understanding direct costs (GM1), overhead absorption (GM2), and the path to EBIT.
- **User Story:** As a Financial Controller, I need the agent to explain GM1 (net revenue less direct costs), GM2 (GM1 less overhead absorption), and EBIT contributions — including over-/under-absorption effects — so that management understands the margin structure and its drivers.
- **Acceptance Criteria:**
  - Given journal entry items with cost element categories indicating direct costs and overhead allocations, when the agent builds the GM1/GM2 analysis, then it correctly separates direct cost postings from overhead absorption postings and quantifies the over-/under-absorption effect for the period.
  - The agent handles both G/L-based and CO-PA-based P&L structures (the exact structure is to be confirmed in the design workshop).
- **Maps to Objective:** 2, 3
- **Priority Rank:** 5

**REQ-06: Sales and Revenue Enrichment with Customer, Country, and Product Dimensions**

- **Problem to Solve:** Revenue and sales deviations cannot be fully explained without knowing which customers, countries, and products drove the change.
- **User Story:** As a Financial Controller, I need revenue and sales journal entry items enriched with customer name, customer country, and product description so that I can explain revenue and gross margin deviations by customer segment, geography, and product mix.
- **Acceptance Criteria:**
  - Given journal entry items on revenue or sales G/L accounts, when the agent enriches them, then it retrieves customer name and country from the Business Partner API and product description from the Product Master API and includes these dimensions in the deviation analysis and report.
- **Maps to Objective:** 2, 3
- **Priority Rank:** 6

**REQ-07: Management-Ready Report — Deviation Table and Narrative**

- **Problem to Solve:** The controller needs a report that can be taken directly to the management review — not raw data.
- **User Story:** As a Financial Controller, I need a formatted management report delivered in the chat — containing a deviation table organized by EBIT impact and by Functional Area / Profit Center, a written narrative explaining the key drivers, and a flagged list of suspected wrong bookings and one-time effects — so that I can present findings to management without further preparation.
- **Acceptance Criteria:**
  - The report contains: (a) a deviation table with all P&L lines from Sales to EBIT, prior-period comparisons, and absolute/percentage deviations; (b) a written narrative of the top drivers by EBIT impact; (c) a Functional Area / Profit Center breakdown; (d) a flagged items list with the controller's action required.
  - The report is organized by magnitude of EBIT impact (largest impact first).
  - Flagged items include: postings that appear inconsistent with the account type or normal pattern, single large postings that dominate a line, and items explicitly marked as one-time in the document text.
- **Maps to Objective:** 3
- **Priority Rank:** 7

**REQ-08: Follow-Up Q&A on Any P&L Element**

- **Problem to Solve:** A static report cannot answer every question management asks. The controller needs to be able to interrogate the data interactively without leaving the session.
- **User Story:** As a Financial Controller, I need to ask follow-up questions about any P&L line, G/L account, or journal entry within the same session so that I can answer management questions on the spot without re-running the analysis.
- **Acceptance Criteria:**
  - Given the agent has completed the initial analysis, when the controller asks a follow-up question (e.g., "Show me all postings to cost center 1234 in October"), then the agent retrieves the relevant data from S/4HANA and answers with cited figures.
  - The agent does not fabricate figures in follow-up answers — it retrieves from the API or states that the data is unavailable.
- **Maps to Objective:** 5
- **Priority Rank:** 8

**REQ-09: Data Traceability and Unavailability Transparency**

- **Problem to Solve:** Controller trust in the report depends entirely on knowing every figure came from SAP. Any fabricated or interpolated number would destroy credibility.
- **User Story:** As a Financial Controller, I need every figure in the report and in follow-up answers to be sourced from retrieved SAP data, and I need the agent to explicitly state when data is unavailable, so that I can present findings with full confidence.
- **Acceptance Criteria:**
  - The agent never produces a numerical figure that was not retrieved from a SAP API call in the current session.
  - When a comparison period is unavailable (e.g., no prior-year data), the agent says so explicitly in the report and in follow-up answers.
  - When an API returns no data for a requested filter, the agent states "no data found for [filter]" rather than returning zero.
- **Maps to Objective:** 4
- **Priority Rank:** 9

### High-Want Requirements

**REQ-10: Configurable Materiality Threshold**

- **Problem to Solve:** Different companies and different periods require different thresholds for what counts as "material." A hardcoded value reduces reusability.
- **User Story:** As a Financial Controller, I need to specify or adjust the materiality threshold (absolute amount and/or percentage) per invocation so that the agent's drill-down focus matches the significance level relevant for that period and company.
- **Priority Rank:** 1

**REQ-11: Extensibility for Plan / Forecast Comparison**

- **Problem to Solve:** Actuals vs. plan and forecast comparison is a core controlling requirement but the data source is not yet confirmed. The agent architecture must accommodate this extension without redesign.
- **User Story:** As a Financial Controller, I need the agent to support actuals vs. plan and actuals vs. forecast comparisons once the data source is connected, so that I can analyze budget variances with the same autonomous workflow.
- **Priority Rank:** 2

**REQ-12: Profit Center and Functional Area Segmented Report**

- **Problem to Solve:** Management reviews P&L both at total company level and at Functional Area / Profit Center level. Segmented breakdowns help identify which part of the business drove aggregate deviations.
- **User Story:** As a Financial Controller, I need the deviation analysis broken down by Profit Center and Functional Area so that management can pinpoint which business unit or function drove the deviation.
- **Priority Rank:** 3

---

## Non-Functional Requirements

### Performance

- **Latency:** The agent should deliver the completed report for a standard monthly close within a reasonable wall-clock time; exact target to be set after data volume is confirmed in the design workshop.
- **Throughput:** The agent is invoked once per month per controller per company code; concurrent usage is low.

### Reliability

- **Availability:** The agent relies on S/4HANA API availability; it must handle API timeouts and partial results gracefully.
- **Fallback:** If an API call fails, the agent retries once, then states which data could not be retrieved and continues with the available data.

### Explainability

- **Traceability:** Every figure in the report includes its source: G/L account number, journal entry document number, and posting date.
- **Decision Logging:** Each reasoning step (which accounts were retrieved, which thresholds were applied, which lines were flagged) is logged as structured telemetry (OpenTelemetry spans mapped to milestones).
- **Uncertainty Communication:** When the agent cannot determine whether a posting is a wrong booking or a legitimate one-time effect, it flags it as "suspected" and notes the reason, rather than asserting it is definitely wrong.

---

## Solution Architecture

**Architecture Overview:**
A Python-based AI agent (A2A protocol) deployed on SAP Business Technology Platform. The agent accesses SAP S/4HANA Cloud Public Edition via standard OData APIs through the Agent Gateway. The agent is conversational — it receives a prompt, executes the autonomous analysis loop, and delivers the report as a structured chat response.

**Key Components:**

- **P&L Controlling Agent (Python / A2A):** Core reasoning and analysis engine; orchestrates all tool calls, applies materiality logic, assembles the report, and handles follow-up Q&A
- **Agent Gateway:** Authenticated gateway for all OData API calls to S/4HANA Cloud Public Edition
- **SAP S/4HANA Cloud Public Edition OData APIs (7 APIs):** Source of all financial and master data

**Integration Points:**

- **Journal Entry Item API** (`API_JOURNALENTRYITEMBASIC_SRV:v1`): retrieves all journal entry items for the target period and comparison periods with CO dimensions (Profit Center, Functional Area, Cost Center, G/L Account) — read-only, high-volume
- **G/L Account Master Data API** (`API_GLACCOUNTINCHARTOFACCOUNTS_SRV:v1`): retrieves G/L account master data and hierarchy used to construct the P&L structure — read-only
- **GL Account Line Items API** (`API_GLACCOUNTLINEITEM:v1`): retrieves document-level line items for drill-down to supporting document attributes — read-only
- **Profit Center API** (`CE_PROFITCENTER_0001:v1`): retrieves Profit Center master data and hierarchy for segmented reporting — read-only
- **Functional Area API** (`API_FUNCTIONALAREA_SRV:v1`): retrieves Functional Area master data for P&L segmentation — read-only
- **Cost Center API** (`CE_COSTCENTER_0001:v1`): retrieves Cost Center master data and hierarchy for overhead absorption analysis — read-only
- **Business Partner API** (`API_BUSINESS_PARTNER:v1`): retrieves customer name and country for revenue/sales enrichment — read-only
- **Product Master API** (`API_PRODUCT_SRV:v1`): retrieves product description for product margin enrichment — read-only

**Deployment Environments:**

- Dev: development and unit testing with mocked API responses
- QA: integration testing against a QA S/4HANA tenant
- Prod: connected to the production S/4HANA tenant; read-only credentials

---

### Agent Extensibility & Instrumentation

**Agent Extensibility:**
The agent must be designed with the following extension points to accommodate future capabilities without redesign:

- **Plan / Forecast Comparison Extension:** The actuals retrieval and comparison layer must be designed so that a plan/forecast data source (S/4HANA plan versions or SAP Analytics Cloud) can be added as an additional comparison column without changing the core analysis loop.
- **CO-PA Path Extension:** The agent must support both G/L-based and CO-PA-based P&L structures. When CO-PA (Margin Analysis) is active, the agent should use profitability segment data where richer than G/L account postings. The exact path will be confirmed in the design workshop.
- **Additional Dimension Enrichment:** The enrichment layer (currently: customer, country, product) must be extensible to add further dimensions (e.g., sales organization, distribution channel, material group) without restructuring the drill-down logic.
- **Multi-Company-Code Extension:** The architecture must not prevent future extension to multi-company-code scenarios, even though this is out of scope for v1.

**Business Step Instrumentation:**
All five key business milestones (see Milestones section) must be instrumented with OpenTelemetry spans. Each span must emit a structured log on achievement and on miss/skip. This enables production monitoring, debugging, and SLA measurement of the autonomous analysis loop.

---

### Automation & Agent Behaviour

**Automation Level:** Autonomous agent — the agent reasons about which steps to take, which lines to drill into, and what to flag, based on the data it retrieves.

**Actions the system performs without human approval:**
- Retrieving all GL account line items (primary postings) via `fetch_and_aggregate_pl`, plus master data (G/L accounts, Profit Centers, Cost Centers, Business Partners, Products) from S/4HANA
- Calculating deviations and applying the materiality threshold to select lines for drill-down
- Assembling and formatting the deviation table and narrative
- Flagging items as suspected wrong bookings or one-time effects based on posting patterns

**Actions that require human review or approval:**
- Acting on flagged wrong bookings (reversal, correction) — the agent flags, the controller decides and acts in SAP
- Changing the materiality threshold mid-session
- Sharing or distributing the report

**Model or engine used:** SAP Generative AI Hub (large language model for reasoning and narrative generation); OData API calls for all data retrieval

**Knowledge & data sources accessed:**

- SAP S/4HANA Cloud Public Edition — Journal Entry Items (all P&L postings for the target and comparison periods; data steward: Accounting / Finance)
- SAP S/4HANA Cloud Public Edition — G/L Account Hierarchy (P&L structure definition; data steward: Chart of Accounts owner)
- SAP S/4HANA Cloud Public Edition — Profit Center, Functional Area, Cost Center master data (organizational structure; data steward: Controlling)
- SAP S/4HANA Cloud Public Edition — Business Partner (customer master; data steward: Sales / Finance)
- SAP S/4HANA Cloud Public Edition — Product Master (material master; data steward: Materials Management / Product Management)

**Tools or connectors invoked:**

- `get_journal_entry_items`: retrieves journal entry items for a given company code, fiscal period, and G/L account range — read-only
- `get_gl_account_hierarchy`: retrieves the G/L account hierarchy for a given chart of accounts — read-only
- `get_gl_line_items`: retrieves G/L line items at document level for drill-down — read-only
- `get_profit_centers`: retrieves Profit Center master data and hierarchy — read-only
- `get_functional_areas`: retrieves Functional Area master data — read-only
- `get_cost_centers`: retrieves Cost Center master data and hierarchy — read-only
- `get_business_partner`: retrieves customer name and country by business partner ID — read-only
- `get_product_master`: retrieves product description by material number — read-only

**Guardrails & fail-safes:**

- The agent is strictly read-only. It must never call any SAP API with a write, create, update, or delete method.
- The agent must never produce a numerical figure that was not retrieved from a SAP API call in the current session. If data is unavailable, it states so explicitly.
- If a materiality threshold is not provided, the agent must ask the controller before proceeding with the drill-down phase.
- If an API call returns an error or empty result, the agent logs the failure, states which data is missing, and continues with available data rather than halting.
- The agent must not assert definitively that a posting is a wrong booking — it flags items as "suspected" and notes the reason, leaving the determination to the controller.

---

## Governance, Risk & Compliance

**Data Handling:**
- All data is read from S/4HANA Cloud Public Edition via authenticated OData APIs. No data is persisted by the agent beyond the active session.
- Financial journal entry data is sensitive. The agent must operate under the same data access controls as the controller's SAP user (authorization via Agent Gateway).
- No PII beyond what is already present in SAP customer master data is accessed or stored.

**Compliance Frameworks:**
- The agent does not post or change financial data; it does not introduce new accounting or audit risk.
- Flagged items for controller review must be treated as advisory, not as assertions of error.

**Approval Flows:**
- Acting on any flagged wrong booking requires the controller to take action manually in SAP via the standard reversal and reposting process. The agent provides no shortcut to this.

---

## Release Criteria

- **Functional:** All must-have requirements (REQ-01 through REQ-09) are implemented and verified against a QA S/4HANA tenant
- **Data integrity:** Zero instances of fabricated or interpolated figures in the report output verified by testing
- **Traceability:** Every figure in the test report is traceable to an API response in the session log
- **Guardrails:** Agent successfully blocks all write-method API calls (automated test)
- **Monitoring:** All 5 milestones emit OpenTelemetry spans; spans are visible in the monitoring dashboard
- **Documentation:** Agent system prompt, tool descriptions, and controller usage guide are complete

---

## Milestones

### M1: Period Invocation

- **Description:** The controller sends a prompt naming the target fiscal period; the agent parses the period, identifies the company code, and begins the autonomous analysis.
- **Achieved when:** The agent has successfully interpreted the target period and company code from the prompt and is ready to begin data retrieval.
- **Log on achievement:** `M1.achieved: period invocation successful — period=[PERIOD], company_code=[CC], session_id=[ID]`
- **Log on miss:** `M1.missed: could not interpret target period or company code from prompt — input=[INPUT]`

### M2: P&L Structure Retrieved

- **Description:** The agent has retrieved all GL line items in the P&L account range (40000000–79999999) for the target period and aggregated them into the P&L view from Sales to EBIT.
- **Achieved when:** All GL line items in the P&L account range are retrieved and aggregated into P&L lines (Revenue, COGS, GM1, Overhead, GM2, Other Op, EBIT) for the target period via `fetch_and_aggregate_pl`.
- **Log on achievement:** `M2.achieved: P&L structure built — lines=[COUNT], total_revenue=[AMOUNT], ebit=[AMOUNT], period=[PERIOD]`
- **Log on miss:** `M2.missed: P&L structure could not be built — reason=[REASON], period=[PERIOD]`

### M3: Multi-Period Comparison Completed

- **Description:** The agent has retrieved actuals for all comparison periods (prior month, prior year) and computed absolute and percentage deviations for all P&L lines.
- **Achieved when:** The deviation table is complete for all available comparison periods; any missing periods are explicitly noted.
- **Log on achievement:** `M3.achieved: multi-period comparison complete — lines=[COUNT], comparisons=[PERIODS], missing=[MISSING_PERIODS]`
- **Log on miss:** `M3.missed: multi-period comparison failed — reason=[REASON]`

### M4: Deviation Root Cause Identified

- **Description:** The agent has drilled into all P&L lines with deviations above the materiality threshold, retrieved journal entry items and supporting document attributes, and identified the root cause of each material deviation.
- **Achieved when:** All lines above the materiality threshold have been drilled to journal entry level; GM1, GM2, and EBIT driver explanations including overhead absorption are complete; revenue/sales lines are enriched with customer, country, and product dimensions.
- **Log on achievement:** `M4.achieved: drill-down complete — material_lines=[COUNT], journal_entries_retrieved=[COUNT], flagged_items=[COUNT]`
- **Log on miss:** `M4.missed: drill-down incomplete — lines_not_resolved=[COUNT], reason=[REASON]`

### M5: Management Report Delivered

- **Description:** The agent has produced the complete management-ready report: deviation table organized by EBIT impact and by Functional Area / Profit Center, written narrative, and flagged items list.
- **Achieved when:** The report is presented in the chat with all required sections; the controller can use it directly for the management review.
- **Log on achievement:** `M5.achieved: management report delivered — period=[PERIOD], flagged_items=[COUNT], session_id=[ID]`
- **Log on miss:** `M5.missed: report could not be completed — reason=[REASON], session_id=[ID]`

---

## Risks, Assumptions, and Dependencies

### Risks

- **CO-PA vs. G/L structure ambiguity:** If the organization uses CO-PA (Margin Analysis) for P&L line items, the agent may need to query different API endpoints or apply different aggregation logic. Risk: incorrect GM1/GM2 calculation if the wrong path is used. Mitigation: confirm structure in design workshop before implementation.
- **Data volume at journal entry level:** High transaction volumes per monthly close may lead to large API response payloads and slow retrieval. Mitigation: agent applies materiality-gated top-down filtering; pagination is handled per API call.
- **No plan/forecast connectivity:** Variance-to-plan analysis cannot be delivered in v1. Risk: limited value for budget-vs-actual management reporting. Mitigation: architecture is extensible; plan data source to be confirmed in design workshop.
- **API authorization scope:** The Agent Gateway must have sufficient authorization to read all required entities (GL line items, cost objects, business partners, products). Risk: missing authorizations block certain data paths. Mitigation: validate API authorization scope during QA setup.

### Assumptions (Validate These)

- SAP S/4HANA Cloud Public Edition is the system of record for all financial postings relevant to the P&L.
- The controller's SAP user (propagated via Agent Gateway) has read access to all required entities: GL account line items, G/L accounts, Profit Centers, Functional Areas, Cost Centers, Business Partners, and Product Master.
- The P&L account-number ranges used by `fetch_and_aggregate_pl` (Revenue: 40000000–49999999, COGS: 50000000–59999999, Overhead: 60000000–69999999, Other Op: 70000000–79999999) match this company’s chart of accounts structure. If ranges differ, they must be reconfigured before go-live.
- A configurable materiality threshold (amount and/or percentage) will be agreed and provided before or at first agent invocation.
- The agent runs in a single-company-code context in v1.

### Dependencies

- SAP S/4HANA Cloud Public Edition — all 7 OData APIs must be enabled and authorized in the production tenant before go-live (GL Account Line Items, G/L Account Master, Profit Center, Functional Area, Cost Center, Business Partner, Product Master).
- Agent Gateway — must be configured and available for the agent's OData API calls to S/4HANA.
- Design workshop outcome — CO-PA structure confirmation, materiality threshold, and plan/forecast data source decision are required before full implementation.

---

## Open Questions

- Do the fixed P&L account-number ranges (Revenue 40000000–49999999, COGS 50000000–59999999, Overhead 60000000–69999999, Other Op 70000000–79999999) match this company’s chart of accounts? If not, what are the correct ranges?
- Is CO-PA (Margin Analysis) active and used for P&L line items, or is the P&L purely G/L-based?
- What is the agreed materiality threshold (absolute amount and/or percentage) for the drill-down?
- Where will plan and forecast data be sourced from — S/4HANA plan versions, SAP Analytics Cloud, or another system?
- What is the baseline duration of the current manual P&L analysis cycle? (Required to confirm the time-saving target)
- Are there specific G/L accounts or cost elements that should always be treated as one-time effects (e.g., restructuring charges)?

---

## Appendix

### Glossary

- **GM1 (Gross Margin 1):** Net revenue minus direct cost of goods sold (variable/direct costs only)
- **GM2 (Gross Margin 2):** GM1 minus overhead absorption (allocated fixed overhead costs)
- **EBIT:** Earnings Before Interest and Taxes — the bottom line of the operational P&L
- **Over-/Under-Absorption:** The difference between actual overhead costs incurred and the standard overhead absorbed into product costs; a key driver of GM2 vs. GM1 differences
- **Materiality Threshold:** The minimum deviation (absolute and/or percentage) above which the agent drills into a P&L line for root-cause analysis
- **CO-PA (Controlling Profitability Analysis):** SAP module for profitability segment reporting; may provide richer margin analysis than G/L-only posting data
- **Functional Area:** SAP organizational dimension used to classify costs and revenues by business function (e.g., Sales, Manufacturing, Administration)
- **Profit Center:** SAP organizational dimension representing a unit of profitability within the company
- **A2A (Agent-to-Agent protocol):** SAP's standard protocol for deploying and invoking AI agents on BTP

### References

- SAP Journal Entry Item API: `sap.s4:apiResource:API_JOURNALENTRYITEMBASIC_SRV:v1`
- SAP G/L Account API: `sap.s4:apiResource:API_GLACCOUNTINCHARTOFACCOUNTS_SRV:v1`
- SAP GL Line Items API: `sap.s4:apiResource:API_GLACCOUNTLINEITEM:v1`
- SAP Profit Center API: `sap.s4:apiResource:CE_PROFITCENTER_0001:v1`
- SAP Functional Area API: `sap.s4:apiResource:API_FUNCTIONALAREA_SRV:v1`
- SAP Cost Center API: `sap.s4:apiResource:CE_COSTCENTER_0001:v1`
- SAP Business Partner API: `sap.s4:apiResource:API_BUSINESS_PARTNER:v1`
- SAP Product Master API: `sap.s4:apiResource:API_PRODUCT_SRV:v1`
- SAP S/4HANA Cloud Public Edition — Financial Analytics capability (SC1763)
- SAP S/4HANA Cloud Public Edition — Margin Analysis capability (SC39)
- SAP S/4HANA Cloud Public Edition — Overhead Cost Accounting capability (SC14)
- SAP S/4HANA Cloud Public Edition — Financial Structure Management capability (SC35)
