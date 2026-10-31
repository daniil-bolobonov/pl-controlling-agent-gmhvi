# Product Requirements Document (PRD)

**Title:** [Business capability this n8n solution delivers — not "SBPA migration"]
**Date:** {{CURRENT_DATE}}
**Owner:** [Product Owner / Author]
**Solution Category:** n8n Workflow

This PRD follows the standard Joule Studio PRD template in **fast-track mode** — the heavy
enterprise sections (Personas, Product Principles, NFRs, Governance, Release Criteria, Milestones,
etc.) are intentionally skipped for an n8n Workflow solution. Fill it **autonomously from the SAP
Build Process Automation archive** — never pause to ask the user. Use `—` for anything not
derivable from the archive or the user's prompt. Keep every statement **business / stakeholder
facing**: do not expose converter mechanics (report-kind codes, converter script or file names,
n8n node type names, field-casting detail) — all of that lives in `specification.md`. Write "SAP
Build Process Automation" in full (never "SBPA") and never the word "migration".

## Product Purpose & Value Proposition

**Elevator Pitch:**
[In 30 seconds: the business problem this automated workflow solves and why it matters. Derived
from the process name + description in the archive.]

**Business Need:**
[The unmet business need — the manual effort, integration gap, or operational inefficiency this
n8n solution eliminates. Frame around the business outcome, not the source system.]

**Expected Value:**
[Measurable business value. Reference the Business Goals in `intent.md`. Use `—` for any target
not stated in the archive or prompt — do not invent numbers.]

**Product Objectives (Prioritized):**
1. [Primary objective — e.g., "Automate end-to-end order posting so no step is handled manually"]
2. [Secondary objective]
3. [Tertiary objective]

## Solution Scope

Every in-scope business process from the archive, described in business terms. One root process
and its sub-workflows per the dependency graph.

| Business process | Type | Trigger (business terms) | Sub-workflows called | Priority |
|---|---|---|---|---|
| [Order Fulfilment] | Root | [Inbound API call] | [Validate Order, Notify Customer] | High |
| [Validate Order] | Sub-workflow | — | — | High |
| [Notify Customer] | Sub-workflow | — | — | Medium |

**Total processes:** [N] &nbsp;&nbsp; **Root processes:** [M] &nbsp;&nbsp; **Sub-workflows:** [N − M]

## Requirements

[State requirements at the business / use-case level — WHAT each capability delivers and the
desired outcome, not HOW it is wired in n8n. Map each in-scope process (above) to one or more
requirements.]

### Must-Have Requirements

[The solution should NOT ship without these. Rank-order ruthlessly.]

**REQ-1**: [Requirement Name]

- **Problem to Solve**: [State the user/business problem. Do NOT describe the solution.]
- **User Story**: As a [persona], I need [capability] so that [business outcome]
- **Acceptance Criteria**:
  - Given [precondition], when [action], then [expected result]
- **Maps to Objective**: [Which product objective above does this support?]
- **Priority Rank**: 1

[Repeat for each must-have requirement. Keep business-facing — no node types.]

## Required Credentials

[One row per destination the solution connects to — what the customer must provide before the
workflows can be activated. This is a business dependency, not converter detail.]

| Destination name | Auth type | Used by | Action for customer |
|---|---|---|---|
| [S4HANA_SYSTEM] | [OAuth2] | [Order Fulfilment] | [Provide URL + client ID + secret] |
| [MAIL_SERVER] | [SMTP] | [Notify Customer] | [Provide SMTP host + credentials] |

## Risks, Assumptions & Dependencies

State these in **business terms**: the business impact and the action the customer must take.
Reference the Fit Gap Analysis in `intent.md` rather than duplicating its table; do not include
report-kind codes, converter/file names, or node type names.

### Risks

- [Business risk, e.g. "The variance-approval decision must be rebuilt by the author before go-live; until then that approval branch is unavailable."]
- Any gap in the Fit Gap Analysis left unaddressed is a delivery risk.

### Assumptions

- All processes the solution references are present in the archive; any missing ones are listed in the final summary and must be supplied before go-live.
- Post-import configuration (connection details, event topic, task due dates, email sender) is completed by the customer before the workflows are activated.

### Dependencies

- The customer provides the connection and credential values for each destination before activating any workflow (see Required Credentials above).
- Destination base URLs are configured in n8n before the first run.

## Acceptance Criteria

### Business Acceptance

- [ ] Each in-scope business process can be triggered through its intended business event
- [ ] Each process completes the expected business outcome for a representative test case
- [ ] Every identified gap is resolved, mitigated, or explicitly accepted as out-of-scope
- [ ] The customer has supplied all required credentials and configuration inputs

### Delivery Quality Checks

- [ ] Every delivered workflow imports into n8n without error
- [ ] No live URLs, tokens, or secrets appear in any delivered workflow

**Customer-side verification (not an agent gate):** after import, confirm each workflow loads
without error via the n8n Editor UI. The authoring agent cannot drive the Editor, so this is a
manual check for the customer, not an acceptance criterion the agent verifies.
