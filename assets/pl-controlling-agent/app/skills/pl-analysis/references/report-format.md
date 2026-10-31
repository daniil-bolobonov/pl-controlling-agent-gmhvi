# Management P&L Report Format

## Formatting Rules

- All amounts in company code currency (as retrieved from SAP)
- Favorable variance = positive impact on EBIT (show as positive number)
- Unfavorable variance = negative impact on EBIT (show as negative number)
- Missing comparison period: show "N/A" with a note explaining why (e.g., "N/A — no prior-year data available")
- Never show a zero unless the retrieved value is actually zero
- Sort lines top-down: Sales → Cost of Sales → GM1 → Overhead → GM2 → Other → EBIT
- Within each section, sort by absolute EBIT impact descending (largest impact first)

---

## Section 1 — P&L Deviation Table

**Title:** Monthly P&L — [Company Code] | [Period] vs. Prior Month and Prior Year

| P&L Line | Actual [Period] | Prior Month | Δ abs. | Δ % | Prior Year | Δ abs. | Δ % |
|---|---|---|---|---|---|---|---|
| Net Revenue | xxx | xxx | ±xxx | ±x.x% | xxx | ±xxx | ±x.x% |
| Cost of Sales | xxx | xxx | ±xxx | ±x.x% | xxx | ±xxx | ±x.x% |
| **Gross Margin 1 (GM1)** | **xxx** | **xxx** | **±xxx** | **±x.x%** | **xxx** | **±xxx** | **±x.x%** |
| Overhead Absorption | xxx | xxx | ±xxx | ±x.x% | xxx | ±xxx | ±x.x% |
| **Gross Margin 2 (GM2)** | **xxx** | **xxx** | **±xxx** | **±x.x%** | **xxx** | **±xxx** | **±x.x%** |
| Other Operating Income | xxx | xxx | ±xxx | ±x.x% | xxx | ±xxx | ±x.x% |
| Other Operating Expense | xxx | xxx | ±xxx | ±x.x% | xxx | ±xxx | ±x.x% |
| **EBIT** | **xxx** | **xxx** | **±xxx** | **±x.x%** | **xxx** | **±xxx** | **±x.x%** |

*Amounts in [Currency]. Positive Δ = favorable (increases EBIT). Negative Δ = unfavorable.*

---

## Section 2 — Key Driver Narrative

**Title:** Top EBIT Drivers — [Period]

For each of the top 5–7 EBIT drivers (ranked by absolute EBIT impact), write one paragraph:

**Driver [N]: [P&L Line Name] — [+/−Amount] ([direction: favorable/unfavorable])**

[Plain-language explanation]:
- Root cause: [what journal entries or postings drove the change, citing document numbers and accounts]
- Nature: [Structural change / Volume effect / Price/mix effect / One-time effect / Reclassification]
- Comparison context: [How this compares to prior month and prior year]
- Controller note: [Any caution, flag, or action point — or "No action required"]

---

## Section 3 — Functional Area / Profit Center Breakdown

**Title:** P&L by Functional Area and Profit Center — [Period]

For each Functional Area present in the journal entries:

### [Functional Area Name]

| P&L Line | Actual [Period] | Prior Month | Δ abs. | Δ % |
|---|---|---|---|---|
| [line] | xxx | xxx | ±xxx | ±x.x% |

For each Profit Center within the Functional Area (if data available):

#### [Profit Center Name / ID]

| P&L Line | Actual [Period] | Prior Month | Δ abs. | Δ % |
|---|---|---|---|---|
| [line] | xxx | xxx | ±xxx | ±x.x% |

---

## Section 4 — Flagged Items

**Title:** Items Requiring Controller Review — [Period]

| Journal Entry | G/L Account | Amount | Posting Date | Reason for Flag | Recommended Action |
|---|---|---|---|---|---|
| [doc number] | [account] | [amount] | [date] | [reason] | [action] |

*Note: Flagged items are identified based on posting patterns and keywords. They are advisory only — the controller must review and decide on any corrective action. The agent does not assert that any item is definitively wrong.*

**If no items are flagged:** State "No items flagged in this period — all postings reviewed appear consistent with normal patterns."
