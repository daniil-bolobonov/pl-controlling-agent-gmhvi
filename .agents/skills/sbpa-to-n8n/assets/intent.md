# <Title of n8n solution>

<One-line title describing the business capability this solution delivers — not "SBPA migration">

## Business challenge

<User's or archive-derived business challenge statement. Describe the manual effort, integration
gap, or operational inefficiency this n8n solution will eliminate. Frame around the business
outcome, not the source system.>

## Business Goals & Success Criteria

<Measurable business goals derived from the SAP Build Process Automation process scope and the
user's prompt. Render as a markdown table. Do **not** invent baseline, target, or timeline numbers
that are not in the archive or the user's prompt — use `—` for anything unknown and set `Source`
to `agent-derived` when the goal is inferred rather than stated.>

| Metric | Baseline | Target | Timeline | Process / Capability | Source |
|--------|----------|--------|----------|----------------------|--------|
| <metric name> | <baseline or —> | <target value> | <timeline or —> | <governed process / capability> | <user \| agent-derived> |

## Key Milestones

<3–5 checkpoints that mark meaningful progress in the automated flow. Each milestone name maps to
a meaningful execution point in the n8n workflow (e.g. order validated, S/4HANA updated,
customer notified). These drive downstream observability spans.>

| Milestone | Reached when |
|-----------|-------------|
| <name> | <business condition, e.g. "Order received and validated"> |
| <name> | <condition> |

## Business Architecture (RBA)

### End-to-End Process

<Name of the end-to-end business process this automation is part of, e.g. "Order to Cash",
"Source to Pay". Derived from the SAP Build Process Automation process context.>

### Process Hierarchy

```
<End-to-End Process>
└── <Phase, e.g. Order Management>
    └── <Sub-Process, e.g. Order Validation>
        └── <Business Activity, e.g. Validate order completeness>
        └── <Business Activity, e.g. Post confirmed order to S/4HANA>
        └── <Business Activity, e.g. Notify customer>
```

### Summary

<1–2 sentences on how the SAP Build Process Automation process maps to this business process
hierarchy and what the n8n solution automates within it.>

## Fit Gap Analysis

<For each business requirement identified from the SAP Build Process Automation process, state
whether n8n can meet it and any gap. Keep this business-facing: in **How n8n meets it** describe
the *capability* (e.g. "inbound API trigger", "approval task", "email notification") — do **not**
name n8n node types or expose how a source construct maps to a node (that detail belongs in
`specification.md`). Gaps come from `report.json` and from requirements that need manual
redesign after import.>

> **Note:** In this autonomous archive-driven flow, all ORD-ID fields must be `—`.
> Do not ask the user for discovery data or call discovery tools.

| Requirement (business) | How n8n meets it | API ORD ID | MCP Server ORD ID | MCP Server Version | Webhook API ORD ID | Data Product ORD ID | Gap? | Notes / assumptions |
|------------------------|------------------|------------|-------------------|--------------------|--------------------|---------------------|------|---------------------|
| <requirement> | <capability> | — | — | — | — | — | Yes / No / Partial | <gap description or —> |

### Key findings

<3–6 bullets covering: which business requirements are met cleanly, which require manual
redesign, critical assumptions made, and any items the customer must act on after import.
Keep these business-facing — no node types or internal construct names.>

- <finding>
- <finding>

## Recommendations

### <Title of recommended n8n solution, e.g. "Automated Order Fulfilment Workflow">

#### Executive Summary

<60–80 character summary of the recommended approach.>

#### Recommended Solution

<Describe the recommended n8n solution at the business / process level: what triggers it, the
sequence of business steps it performs end-to-end, who is involved, and the outcome it delivers.
Explain *what* the automation does and the value it provides — not which n8n nodes are used or
how they are wired. Reserve node-level technical detail for `specification.md`.>

#### Problem Statement

<Core problem being solved, restated from the business challenge in concrete terms.>

#### Affected User Roles

<Brief list of user roles that trigger, monitor, or act on outputs from this n8n workflow.>

#### Important factors

##### <Factor title, e.g. "Eliminates manual order entry">

<Description of why this factor matters for the solution.>

#### Potential risks

##### <Risk title, e.g. "Custom script logic requires manual review">

<Description of the risk and suggested mitigation.>

#### Recommended solution category

n8n automated workflow

#### Intent fit

<Percentage only, e.g. "90%". Reflects how completely the n8n solution covers the original
SAP Build Process Automation process scope.>
