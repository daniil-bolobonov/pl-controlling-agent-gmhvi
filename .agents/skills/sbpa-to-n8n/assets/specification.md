# Specification — [Solution name] n8n solution

Technical specification of the **delivered n8n solution**. It documents how the built workflows
work — their triggers, steps, credentials, and data flow — so an engineer can run, maintain, and
extend them. Describe the **solution Joule Studio delivered**, not how any source process was
converted: the end user and the engineer who inherits this solution care about the n8n workflows
and their behaviour, not the translation history.

This is the technical companion to the business-facing `intent.md` and `product-requirements-document.md`.
Use only n8n nodes returned by the node-discovery tools (`search_nodes` / `list-supported-nodes`).
Write "SAP Build Process Automation" in full (never "SBPA") and avoid the word "migration". Fill
autonomously from the archive and the authored workflows — never ask the user; use `—` for
anything unknown.

---

## Per-workflow specification

One section per delivered workflow, named with the standard n8n asset convention
`assets/workflows/<workflow-name>` (kebab-case). Emit sub-workflows before the workflows that call
them.

### `assets/workflows/<workflow-name>` — [Display name]

**Purpose:** [One line: what this workflow does and the business outcome it delivers.]

**Trigger:** [How the workflow starts, in solution terms — e.g. "Inbound API call (webhook); request payload available at `$json.body.*`".]

**Workflow steps:**

| # | Step | n8n node | What it does |
|---|---|---|---|
| 1 | [Receive request] | `Webhook` | [Accepts the inbound order payload] |
| 2 | [Validate input] | `Code` | [Checks required fields are present] |
| 3 | [Post to S/4HANA] | `HTTP Request` — credential `S4HANA_SYSTEM` | [Creates the sales order] |
| 4 | [Route by order value] | `Switch` | [Two branches: standard vs. high-value approval] |

**Credentials used:**
- [`S4HANA_SYSTEM` — connects the workflow to the S/4HANA system]

**Data flow & key expressions:**
- [How data passes between steps and how any process variables are carried — e.g. "`orderLines` is passed explicitly between nodes; `orderTotal` is read as a number where the branch condition evaluates `> 1000`".]
- [Notable expression decisions that affect behaviour.]

**Post-import steps for the customer:**
- [Manual actions required after import — e.g. "Open the workflow and point each 'Execute Workflow' node at the imported sub-workflow"; "set the event topic / task due dates / email sender".]

**Notes for maintainers:**
- [Only what a maintainer must know about solution completeness — e.g. "The high-value approval branch requires manual review before go-live"; "custom script logic was reviewed and rewritten". State in solution terms, not converter/report-kind codes.]

[Repeat for each delivered workflow.]

---

## Cross-cutting solution decisions

| Decision area | Approach |
|---|---|
| Credential naming | n8n credential names match the SAP Build Process Automation destination names exactly (e.g. `S4HANA_SYSTEM`) so the mapping is unambiguous |
| Sub-workflow linking | Each "Execute Workflow" node is pointed at the imported sub-workflow in n8n after import (n8n assigns the real workflow ID on import) |
| Carrying process state | String values are kept within n8n's `$execution.customData` 255-char limit; non-string values (arrays/objects) are passed explicitly between nodes instead |
| Node layout | Nodes laid out left-to-right at 240 px horizontal, 180 px vertical step for readability |
