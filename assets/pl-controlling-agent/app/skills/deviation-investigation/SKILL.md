---
name: deviation-investigation
description: Deep-dive investigation for a single material P&L deviation — drill from P&L line to journal entries, identify posting patterns, formulate root cause
---

# Deviation Investigation Skill

## Use When
Investigating a specific material deviation on one P&L line (called from pl-analysis Step 7 or follow-up questions).

## Steps

**1 — Retrieve entries:** Call `list_glaccountlineitem_for_cds_api_glaccountlineitem` for target and comparison period. Filter: CompanyCode, FiscalYear, FiscalPeriod, GLAccount range.

**2 — Rank:** Sort entries by |amount contribution| descending. Identify top 5 explaining >80% of deviation.

**3 — Classify each top entry:**
| Pattern | Indicator |
|---------|-----------|
| Recurring-normal | Same account/type as prior period, similar amount |
| Recurring-changed | Same pattern, significantly different amount |
| One-time | No equivalent in comparison period |
| Reversal | Opposite DebitCreditCode or text contains Storno/reversal |
| Accrual | Doc type AA/AE, PostingDate = period end |
| Unusual | Revenue debited or cost credited unexpectedly |

**4 — Root cause (max 3 sentences):**
> "The [fav/unfav] deviation of [amount] on [line] vs [period] is driven by [top entry]: doc [number], account [acct], posted [date], [amount] — [pattern + business reason]. [Entry 2 if needed]. [Flag if applicable]."

## Rules
- Always cite document numbers from retrieved data
- If cause unclear: "Controller review of document [number] recommended"
- Never guess amounts not in API response
