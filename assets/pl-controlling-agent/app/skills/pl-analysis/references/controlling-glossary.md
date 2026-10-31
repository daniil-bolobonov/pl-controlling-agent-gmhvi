# Controlling Glossary

Definitions used by the P&L analysis agent when generating narratives and explanations.

## GM1 — Gross Margin 1

**Definition:** Net Revenue minus Cost of Sales (direct costs only).

GM1 = Net Revenue − Cost of Sales

Direct costs include: direct material consumption, direct labor, and variable production costs that are directly traceable to products/services without allocation.

**Interpretation:** GM1 represents the contribution of each unit of revenue after covering only the costs directly incurred to produce it. A deteriorating GM1 % signals pricing pressure, input cost increases, or an unfavorable product/customer mix shift.

## GM2 — Gross Margin 2

**Definition:** GM1 minus Overhead Absorption.

GM2 = GM1 − Overhead Absorption

Overhead Absorption represents the fixed overhead costs allocated/absorbed into products via standard costing (typically via cost center assessments and activity allocations). It differs from actual overhead incurred, giving rise to absorption variances.

**Interpretation:** GM2 reflects the full cost of production including allocated fixed overheads. A divergence between GM1 and GM2 trends signals changes in overhead recovery rates, production volume, or standard cost updates.

## EBIT — Earnings Before Interest and Taxes

**Definition:** The operational profit after all operating costs, before financial income/expense and taxes.

EBIT = GM2 ± Other Operating Income/Expense

**Interpretation:** EBIT is the primary KPI for operational performance. It is the "bottom line" of the operational P&L and the main target of the monthly P&L analysis.

## Over-Absorption

**Definition:** Actual overhead absorbed into products exceeds actual overhead costs incurred.

Over-absorption = Absorbed Overhead > Actual Overhead Incurred → favorable to EBIT

**When it occurs:** Production volume is higher than planned, so more overhead is absorbed at the standard rate than the fixed overhead actually incurred. The excess absorbed amount improves the P&L.

**Example:** Standard overhead rate = €10/unit. 12,000 units produced → €120,000 absorbed. Actual overhead = €100,000. Over-absorption = +€20,000 (favorable).

## Under-Absorption

**Definition:** Actual overhead absorbed into products is less than actual overhead costs incurred.

Under-absorption = Absorbed Overhead < Actual Overhead Incurred → unfavorable to EBIT

**When it occurs:** Production volume is lower than planned (e.g., machine downtime, low demand). The unabsorbed fixed overhead remains as a period cost, reducing EBIT.

**Example:** Standard overhead rate = €10/unit. 8,000 units produced → €80,000 absorbed. Actual overhead = €100,000. Under-absorption = −€20,000 (unfavorable).

## Cost Element Category

**Definition:** A classification in SAP Controlling that determines how a cost element (G/L account) is treated in cost accounting flows.

Key categories relevant to P&L analysis:
- **Category 1**: Primary cost/revenue elements — direct postings from FI (external transactions)
- **Category 11**: Revenues — revenue accounts
- **Category 21**: Internal settlement — settlement of production/project orders to cost objects
- **Category 42**: Assessment — overhead cost allocation via cycles
- **Category 43**: Internal activity allocation — allocation of cost center activities to receivers

Categories 21, 42, 43 are typical sources of overhead absorption postings.

## Profit Center

**Definition:** An SAP organizational unit representing an independent area of responsibility within a company for which revenues and costs are tracked for profitability analysis.

**In the P&L:** Journal entry items are assigned to Profit Centers, enabling P&L analysis by business unit, product line, or geographic area.

## Functional Area

**Definition:** An SAP organizational unit used to classify costs and revenues by business function for cost-of-sales accounting and financial statement presentation.

**Common Functional Areas:**
- Manufacturing / Cost of Sales
- Sales and Distribution
- Research and Development
- Administration

**In the P&L:** Functional Areas enable the P&L to be organized by business function (e.g., how much did Sales cost vs. Administration?), as required by IFRS cost-of-sales accounting.

## Cost Center

**Definition:** An SAP organizational unit that represents a location where costs are incurred. Cost centers are the primary unit for collecting and controlling overhead costs.

**In the P&L:** Overhead costs are initially posted to Cost Centers, then allocated/assessed to cost objects (Production Orders, Profit Centers, profitability segments) via periodic allocation cycles, feeding GM2.

## Materiality Threshold

**Definition:** The minimum deviation — expressed as an absolute amount (e.g., €50,000) and/or a percentage of revenue (e.g., 5%) — above which a P&L line deviation is considered material and subject to drill-down analysis.

**Purpose:** Focuses the controller's attention on deviations that actually matter for management decision-making. Lines below the threshold are shown in the deviation table but not drilled further.

**Setting the threshold:** Agreed between the controller and management, typically before the monthly close cycle. May vary by company size and P&L line type.
