# n8n SAP Task Center Node Generation

## Overview

Ensures **stable and correct** generation of SAP Task Center nodes for human-in-the-loop (HITL) approval workflows. It enforces strict validation rules and mandatory structural patterns to prevent common errors.

**Critical Mission:** SAP Task Center nodes MUST always be followed by a switch node because they have only ONE output that contains the decision result.

---

## CRITICAL RULES (DO NOT SKIP)

### 1. **ALWAYS use MCP to get node metadata**

**BEFORE generating a SAP Task Center node:**
```javascript
// Call MCP tool
search_nodes({ queries: ["task center"] })
```

**Use the returned values:**
- `search_nodes` result ID → use as `type` in workflow
- `search_nodes` result `Version` → use as `typeVersion` in workflow
- `get_node_types` (call with the ID) → TypeScript parameter interface (with JSDoc `@default`, `@displayOptions.show`, option names); use it to understand available parameters

**NEVER hardcode typeVersion** - always get it from `search_nodes`.

---

### 2. **ALWAYS Ask for the recipient first**

Before writing the Task Center node's parameters — before choosing subject, priority, or task definition — you must have an explicit, **user-chosen** recipient source for this Task Center node. The source is one of three: a static email (`userId`), a static group ID (`groupId`), or a **dynamic binding** to a known workflow input field (an expression, `userId` **or** `groupId`). What you must never do is invent the recipient yourself.

**The ask.** Stop and ask the user, offering all three as equal, first-class choices, for example:

> "Who should receive this approval task in SAP Task Center? Choose one:
> 1. **A fixed email address** — used exactly as you provide it (`userId`).
> 2. **A group ID** — the task goes to a recipient group (`groupId`).
> 3. **A value from the workflow's incoming input** — bind the recipient to a field on the request payload (e.g. the submitter's email arriving on the webhook), so each run routes to whoever the input specifies."

Do **not** frame the dynamic option as risky, unsupported, or a last resort — it is a fully valid choice.

**Bypass rule.** Only skip the ask if the *current* user prompt in this conversation already settles the source — an unambiguous email address or group ID intended for this Task Center node, **or** an explicit instruction to populate the recipient from a specific incoming input field. A recipient mentioned for a *previous* Task Center node in the same workflow does not carry over unless the user explicitly says so.

**Sufficient answer.** Any one of the three settles it — a static email (`userId`), a static group ID (`groupId`), **or** a confirmed dynamic binding (to `userId` or `groupId`).

**Binding without a round-trip.** When the user chooses dynamic and the recipient field is already identifiable — a named-node output or a webhook field documented in this conversation — bind directly to it; do **not** ask again to confirm the path. Ask for the exact field path **only** when the input shape is ambiguous (multiple plausible fields, or an undocumented payload).

**Expression style.** Prefer a named-node reference when the source node is known; use `$json` only when the current node input is the intended source and no clearer named-node reference is available. Webhook data lives under `.body.*`.

**Valid when the user chose dynamic routing:**

- ✅ `{ userId: "={{ $('Webhook').item.json.body.email }}" }`
- ✅ `{ groupId: "={{ $('Webhook').item.json.body.approverGroup }}" }` — groups are symmetric
- ✅ `{ userId: "={{ $json.body.email }}" }` — only when the current input already comes from that payload

**Forbidden — a recipient the user never authorized:**

- ❌ `{ userId: "user@example.com" }` — generated placeholder
- ❌ `{ userId: "manager@company.com" }` — copied from this skill's example
- ❌ `{ groupId: "finance-approvers" }` — guessed or example-copied group ID
- ❌ Any value — literal **or** expression — the user neither provided nor opted into. Never silently guess, and never bind to the payload unless the user chose the dynamic option.
- ✅ Ask the user first (the three-way question above), then set the recipient from their chosen source — a static `{ userId: "<exact email provided>" }` / `{ groupId: "<exact group ID provided>" }`, or a dynamic expression bound to the input field they chose.

---

### 3. **Mandatory Switch Node After Task Center**

SAP Task Center has **only ONE output** containing the decision in `$json.result.response`.

**Required pattern:**
```
Webhook → [Processing] → SAP Task Center → Switch Node → [Branches]
```

**Switch node configuration:**
```json
{
  "type": "<Switch node from MCP>",
  "typeVersion": "<from MCP>",
  "name": "Route Approval Decision",
  "parameters": {
    "mode": "rules",
    "rules": {
      "values": [
        {
          "conditions": {
            "options": {
              "caseSensitive": true,
              "leftValue": "",
              "typeValidation": "strict"
            },
            "conditions": [
              {
                "leftValue": "={{ $json.result.response }}",
                "rightValue": "approved",
                "operator": {
                  "type": "string",
                  "operation": "equals"
                }
              }
            ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "approved"
        },
        {
          "conditions": {
            "options": {
              "caseSensitive": true,
              "leftValue": "",
              "typeValidation": "strict"
            },
            "conditions": [
              {
                "leftValue": "={{ $json.result.response }}",
                "rightValue": "rejected",
                "operator": {
                  "type": "string",
                  "operation": "equals"
                }
              }
            ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "rejected"
        }
      ]
    }
  }
}
```

---

### 4. **Iterating over a Collection with Approval**

When a prompt describes both collection processing and human approval, decide which approval pattern applies **before** placing Task Center nodes. Decide in this order:

1. **What is being approved?**
   - **Each item individually** → continue to the next question.
   - **The full collection as one result** → use **Bulk approval**. Stop here.

2. **How are items delivered to the workflow?**
   - **One item per invocation** → use **Per-item approval, submitted sequentially by the caller**.
   - **A full collection in one invocation** → if items are independent (no ordering dependency, approval coupling, or rate-limit constraint between items), use **Parallel per-item processing with individual approvals**.

| Pattern | Invocation shape | Approval scope | Iteration owner | Best fit |
|---|---|---|---|---|
| Per-item approval, submitted sequentially by the caller | One item per invocation | Per item | Caller | Event-driven item intake, caller-controlled sequencing |
| Bulk approval | Full collection in one invocation | Full collection | Workflow | One approval decision for the aggregated result |
| Parallel per-item processing with individual approvals | Full collection in one invocation | Per item | Workflow | Batch trigger with independent items |

> **What "parallel"/"concurrent" means here:** independent **branches or per-item iteration within this one workflow** — not a separately-executing sub-workflow (this instance does not support sub-workflows). Convergence of any resulting branches follows the single Branch convergence decision in `execution.md` Rule 9. See the "Runtime capabilities" gate at the top of `execution.md`.

**Per-item approval, submitted sequentially by the caller:** the human reviews each item separately, and the caller controls when to submit each item.
- The iteration belongs to the caller. The workflow handles a single item: it receives one item, processes it through analysis and human approval, and returns the result.
- Choose this pattern when the prompt implies items arrive one at a time (for example, "when an invoice is submitted" or "for each incoming request") or when the caller must control sequencing because of ordering dependencies, rate limits, or partial processing.
- **If the prompt implies a batch trigger** (for example, "process all blocked invoices," "run for the backlog," or "handle the collection"), **do not use this pattern; use the parallel pattern instead.**
- Reason: sequential submission avoids embedding human wait time inside a long-running workflow. Each invocation handles one item, and the caller decides when to submit the next item.

**Bulk approval:** the human reviews and decides on the full collection in one step.
- The automated processing runs over the collection, results are consolidated, and a single human approval step covers the whole batch.
- Reason: because the wait occurs once regardless of collection size, the workflow correctly owns both the iteration and the single approval gate.

**Parallel per-item processing with individual approvals:** the workflow receives the full collection in a single invocation, processes items concurrently, and sends each item for approval independently.
- The iteration stays inside the workflow. Automated analysis runs in parallel across all items, and each approval request is issued independently.
- Choose this pattern when the prompt implies a batch trigger (for example, "process all blocked invoices," "run nightly for the backlog," or "handle the collection on schedule"), items are independent, and no ordering dependency, approval coupling, or rate-limit constraint is mentioned.
- If external systems impose strict concurrency limits, use the **Per-item approval, submitted sequentially by the caller** pattern instead.
- Reason: concurrent processing and approval dispatch make total elapsed time depend on the slowest approval response rather than the sum of all approval times.

Whichever pattern applies, each Task Center node still follows the single-item rules above — one recipient decision routed through a Switch node on `$json.result.response`.

---

### 5. **Contextual Node Name (canvas `name`)**

The Task Center node's `name` field MUST describe the approval's purpose in the context of the surrounding solution — never the generic `"SAP Task Center"` or `"Task Center"`.

Choose a name that makes the step's intent obvious to anyone reading the workflow.

- ✅ Good: `"Approve Travel Expense"`, `"Review Budget Increase Request"`, `"Approve Leave Request"`, `"Approve Purchase Requisition"`.
- ❌ Bad: `"SAP Task Center"`, `"Approval"`, `"Task"`, `"Review Step"`.

---

### 6. **Mandatory Parameters**

**Always required:**
- `subject` (string) - Task title shown to user
- `priority` (enum) - One of: `"VERY_HIGH"`, `"HIGH"`, `"MEDIUM"`, `"LOW"`.
  - **Default to `"MEDIUM"` unless the user explicitly specified a different priority.**
- Configure at least one non-empty recipient target:
  - `recipients.recipientValues: [{ "userId": "email@example.com" }]` or `[{ "userId": "={{ $('Webhook').item.json.body.email }}" }]`
  - `recipientGroups.recipientGroupValues: [{ "groupId": "group-id" }]` or `[{ "groupId": "={{ $('Webhook').item.json.body.approverGroup }}" }]`
- You may configure both at the same time.
- Do not emit empty arrays for either field.

**Optional:**
- `taskDefinition.definitionName` (string) - Name displayed in SAP Task Center. If the user hasn't specified an explicit definition name, set this to the same value as the node's canvas `name` (see **Contextual Node Name**).
- `customAttributeDefinitions.attributes[]` - Decision-context fields shown to the approver. Each row requires `value`, `code`, `name`, and `type`. Max 30. Add only when relevant to the approval and helpful to the recipient's decision — see **Custom Attributes (Optional Decision Context)**.

**Example:**
```json
{
  "name": "Approve Travel Expense",
  "parameters": {
    "subject": "Travel Expense Approval Request",
    "priority": "MEDIUM",
    "recipients": {
      "recipientValues": [
        { "userId": "manager@company.com" }
      ]
    },
    "recipientGroups": {
      "recipientGroupValues": [
        { "groupId": "finance-approvers" }
      ]
    },
    "taskDefinition": {
      "definitionName": "Approve Travel Expense"
    }
  }
}
```

---

### 7. **Recipient Email — Must Be Explicitly Provided by the User**

**NEVER generate or guess recipient emails.**

The recipient email must come from an explicit user instruction in the conversation.
If the user has already provided the recipient email, use that exact value.
If the user chose to populate it dynamically, bind it to the known input field.
If the user has not provided it yet, stop and ask before emitting the Task Center node.

```
❌ WRONG: { userId: "user@example.com" }                          // generated placeholder
✅ RIGHT: { userId: "={{ $('Webhook').item.json.body.email }}" }  // user chose dynamic; bound to a known field
✅ RIGHT: { userId: "<the exact email they provided>" }           // user chose a static recipient
```

---

### 8. **Custom Attributes (Optional Decision Context)**

Custom attributes are labeled key/value fields attached to the task and shown to the approver **inside** SAP Task Center. Use them to put the information the recipient needs to decide right in front of them — so they don't have to leave the task to find context.

**When to use.** Add a custom attribute when a piece of information from the workflow is **relevant to this specific approval and would help the recipient decide**. Examples: the Purchase Order Number on a PO approval, the amount and currency, the requesting employee, an invoice ID.

- ✅ **Do** add attributes that aid the decision — e.g. `Purchase Order Number`, `Requested Amount`, `Vendor`.
- ❌ **Do not** add noise: attributes that are irrelevant to the decision, that merely restate the `subject`/`description` verbatim, or that add nothing the approver would act on.
- **Default to none.** If nothing adds decision value, emit no custom attributes.

**The four fields (per attribute row).** Each row lives under the node parameter `customAttributeDefinitions.attributes[]` and has exactly these fields — **all four are required**:

| Field | Param | Meaning |
|---|---|---|
| Value | `value` | The attribute's value — a static literal, or an expression referencing workflow input. |
| Attribute Code | `code` | Stable, human-readable ID in camelCase, e.g. `purchaseOrderNumber`. Max 64 characters. |
| Display Label | `name` | Human-facing label shown to the approver, e.g. `Purchase Order Number`. |
| Type | `type` | Data type of the value. One of `BOOLEAN`, `DATE`, `DATETIME`, `FLOAT`, `INTEGER`, `STRING`, `TIME`. |

**Order matters.** Attributes appear to the approver in the order you list them. List the **primary business-object key first** (e.g. Purchase Order Number, Invoice ID), then secondary details. Never bury the key at the end.

**Static vs. referenced values.** The `value` field is populated one of two ways:

- **Static** — when the agent knows the value directly, set it as a literal:

  ```json
  { "value": "Procurement" }
  ```

- **Referenced** — when the agent knows the input shape (a prior step or the trigger delivers a known field), reference it as an expression. Three rules, and the shape of the path **depends on where the field comes from**:

  1. **Always wrap in `={{ ... }}`.** A bare path like `json.amount` is not an expression — it is emitted as the literal string `json.amount`, not the value.
  2. **Match the path to the source node.** This is the error we see most often:
     - **Field from the webhook trigger → the path MUST include `.body.`.** The webhook trigger emits `{ headers, params, query, body, ... }`, so request fields live under `body`. A top-level `json.amount` resolves to `undefined`; the field is at `json.body.amount`.

       ```json
       { "value": "={{ $('Purchase Request').item.json.body.amount }}" }
       ```
     - **Field from an intermediate node** (a Set/Code/aggregation step that output the field at the top level) → use that node's output shape, which has **no** `.body.`. Do not force `.body.` onto non-webhook data.

       ```json
       { "value": "={{ $('Aggregate Amount').item.json.amount }}" }
       ```
  3. **Prefer a named-node reference over `$json`.** `$json.<path>` is valid only when the Task Center node's direct input is exactly the node producing that field — then it is `$json.body.<field>` for webhook data, `$json.<field>` for intermediate data.

  **Quick contrast:**

  ```
  # Field comes from the WEBHOOK trigger:
  ❌ "value": "json.amount"                                         // literal string — no wrapper, no root, no .body
  ❌ "value": "={{ $json.amount }}"                                 // webhook field, but .body. dropped → undefined
  ✅ "value": "={{ $('Purchase Request').item.json.body.amount }}"  // wrapper + .body + named trigger ref
  ✅ "value": "={{ $json.body.amount }}"                            // OK only when this node's direct input IS the webhook payload

  # Field comes from an INTERMEDIATE node (e.g. a Set node "Aggregate Amount"):
  ✅ "value": "={{ $('Aggregate Amount').item.json.amount }}"       // NO .body. — that is the node's actual output shape
  ✅ "value": "={{ $json.amount }}"                                 // OK when input IS that node's output; still no .body.
  ```

**Limits.** Maximum **30** attributes. `code` must be ≤ 64 characters. Every row must have all four of `value`, `code`, `name`, `type` — rows missing any of these are rejected or dropped.

**Example** — the `customAttributeDefinitions` parameter nested inside a `CUSTOM.sapTaskCenter` node's `parameters` (same nesting style as `recipients` / `taskDefinition`):

```json
"customAttributeDefinitions": {
  "attributes": [
    {
      "value": "={{ $('Purchase Request').item.json.body.purchaseOrderId }}",
      "code": "purchaseOrderNumber",
      "name": "Purchase Order Number",
      "type": "STRING"
    },
    {
      "value": "={{ $('Purchase Request').item.json.body.amount }}",
      "code": "requestedAmount",
      "name": "Requested Amount (EUR)",
      "type": "FLOAT"
    }
  ]
}
```

---

### 9. **NEVER Pin Data on the Task Center Node**

**Applies ONLY to the `CUSTOM.sapTaskCenter` node** — other nodes may be pinned for testing.

Never add a `pinData` entry for the Task Center node. Pinned output replaces its execution, so **no task is created** and the approval is silently skipped. To test, pin the **trigger** instead and let the Task Center node run; to exercise post-decision branches, simulate the response **downstream** (a Set/Code node feeding the Switch), never on the node itself.

---

### 11. **Error Handling (node failure vs. approval decision)**

Keep two concepts separate:
- **Approval decision** (approved / rejected) is a **normal** result on the Task Center node's single output, routed by the mandatory Switch on `$json.result.response`. A rejection is **not** an error.
- **Node failure** (the task could not be created, the recipient was invalid, the service was unreachable) is governed by the node's `onError` property, set from the error-handling decision in `intent.md` (see `execution.md` Rule 17).

Set `onError` per the developer's decision:

| `onError` | Behaviour |
|---|---|
| `"stopWorkflow"` | Default — the run fails if the task cannot be created. |
| `"continueRegularOutput"` | On failure the input passes through on the normal output (rarely appropriate for an approval gate). |
| `"continueErrorOutput"` | Adds a second `main` output — index `0` = the decision result (into the Switch), index `1` = the error. |

When `continueErrorOutput` is chosen, the **success output (index 0)** still goes to the mandatory Switch; the **error output (index 1)** must reach a caller-contract node — by default a `respondToWebhook` returning the error, or a customer-specific action the developer named.

**The success and error outputs are two separate subgraphs — never route both into the Switch, and never re-check the error downstream.** A rejection is detected by the Switch on `$json.result.response`; a node failure is already isolated on the error output. The error output carries `$json.error`, not `$json.result.response`, so sending it into the Switch produces an item that matches no case and silently drops the caller contract. Put the chosen error action (send email, create a ticket, respond with the error) **directly on the error output** — do not add an IF/Switch after the node to decide whether it failed.

```text
❌ WRONG — both outputs into the Switch; the Switch "checks the output and handles the error":
   Task Center (continueErrorOutput) ─┬─ output 0 ─┐
                                      └─ output 1 ─┴─> Switch ─> [approved | rejected | ???]

✅ RIGHT — success → Switch (approved/rejected); error → the chosen action, each reaching a response:
   Task Center (continueErrorOutput) ─┬─ output 0 ──> Switch ─> [approved → SAP MCP Client → Respond]
                                      │                        [rejected → SAP MCP Client → Respond]
                                      └─ output 1 ──> Send email / Create ticket → Respond
```

---

## Common Errors to Avoid

❌ **ERROR 1:** Missing switch node after Task Center
```
Task Center → Respond to Webhook  // WRONG - no branching
```
✅ **FIX:** Add switch
```
Task Center → Switch → [approved/rejected branches]
```

---

❌ **ERROR 2:** Recipient the user never authorized
```json
"recipientValues": [{ "userId": "user@example.com" }]                     // WRONG — generated placeholder
"recipientGroupValues": [{ "groupId": "finance-approvers" }]              // WRONG — guessed or copied value
"recipientValues": [{ "userId": "={{ $json.body.email }}" }]              // WRONG — only if the user did NOT choose dynamic routing
```
✅ **FIX:** If no source is settled, stop and ask (see **ALWAYS Ask for the recipient first**). If the user chose dynamic, bind to the known field, preferring a named node: `"recipientValues": [{ "userId": "={{ $('Webhook').item.json.body.email }}" }]`.

---

❌ **ERROR 3:** Generic Task Center node name
```json
"name": "SAP Task Center"  // WRONG — unclear to workflow readers and maintainers
```
✅ **FIX:** Rename to reflect the approval purpose, e.g. `"Approve Travel Expense"`.

---

❌ **ERROR 4:** Ending approval/rejection branches with Set nodes instead of SAP MCP Client calls
```
Switch (approved) → Set Manager Approved { status: "approved" } → Respond
```
Nothing was posted to SAP. The approval exists only inside n8n.

✅ **FIX:** Use SAP MCP Client after the Switch to execute the SAP action, then respond:
```
Switch (approved) → SAP MCP Client (post_expense_decision, { decision: "approved" }) → Respond
```

---

❌ **ERROR 5:** Routing a `continueErrorOutput` node's error output into the Switch (or into the same node as the success output)
```
Task Center (continueErrorOutput) ─┬─ output 0 ─┐
                                   └─ output 1 ─┴─> Switch   // WRONG — error item has no $json.result.response; it matches no case
```
The error output carries `$json.error`, so the Switch's `approved`/`rejected` cases never match and the failed item is silently dropped. The chosen error action is also never executed.

✅ **FIX:** Keep the two outputs as separate subgraphs — success into the Switch, error straight into the chosen action:
```
Task Center (continueErrorOutput) ─┬─ output 0 → Switch → [approved / rejected] → SAP MCP Client → Respond
                                   └─ output 1 → Send email / Create ticket → Respond
```

---

❌ **ERROR 6:** Custom attribute `value` missing the `={{ }}` wrapper, or dropping `.body.` for webhook data
```json
"value": "json.body.amount"                    // WRONG — no expression wrapper; emitted as a literal string
"value": "={{ $json.amount }}"                 // WRONG — WEBHOOK field with .body. dropped → undefined
```
✅ **FIX:** Wrap in `={{ }}`, and match the path to the source. `.body.` is required **only** for webhook-trigger fields — not for fields produced by an intermediate node:
```json
"value": "={{ $('Webhook').item.json.body.amount }}"   // webhook field: .body. + named ref
"value": "={{ $('Aggregate').item.json.amount }}"      // intermediate-node field: NO .body. is correct
```

---

## Example: Travel Expense Approval with SAP Task Center

```json
{
  "name": "Travel Expense Approval",
  "description": "Handles travel expense approval requests. Automatically approves expenses below 1000 EUR; routes higher amounts to the submitter's manager (from the request's managerEmail field) via SAP Task Center for manual approval or rejection, surfacing the expense details as custom attributes. Responds to the requester with the final decision.",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "travel-expense-approval-6f4ef/travel-expense-approval-workflow/travel-expense-submitted",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "9d23af04-085f-434e-adbb-69bd43f7d6de",
      "name": "Travel Expense Submitted",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [
        -640,
        0
      ],
      "webhookId": "5e95cbdf-ec70-4005-b09d-b1c695f7cb25"
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 3
          },
          "conditions": [
            {
              "id": "amount-check",
              "leftValue": "={{ $json.body.amount }}",
              "rightValue": 1000,
              "operator": {
                "type": "number",
                "operation": "lt"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "a2164113-6355-4c0a-adb4-b94be856b1a9",
      "name": "Amount Below 1000 EUR?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [
        -384,
        0
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "field-id",
              "name": "id",
              "value": "={{ $('Travel Expense Submitted').item.json.body.id }}",
              "type": "string"
            },
            {
              "id": "field-status",
              "name": "status",
              "value": "approved",
              "type": "string"
            },
            {
              "id": "field-message",
              "name": "message",
              "value": "=Expense of {{ $('Travel Expense Submitted').item.json.body.amount }} EUR auto-approved (below 1000 EUR threshold).",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "id": "4708b7bd-fd0e-460a-a1ad-f7330f13790b",
      "name": "Set Auto-Approved",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.5,
      "position": [
        176,
        -272
      ]
    },
    {
      "parameters": {
        "subject": "=Travel Expense Approval Required: {{ $('Travel Expense Submitted').item.json.body.employee }}",
        "priority": "MEDIUM",
        "description": "=An expense of {{ $('Travel Expense Submitted').item.json.body.amount }} EUR has been submitted by {{ $('Travel Expense Submitted').item.json.body.employee }}.\n\nReason: {{ $('Travel Expense Submitted').item.json.body.reason }}\n\nPlease review and approve or reject.",
        "recipients": {
          "recipientValues": [
            {
              "userId": "={{ $('Travel Expense Submitted').item.json.body.managerEmail }}"
            }
          ]
        },
        "taskDefinition": {
          "definitionName": "Approve Travel Expense"
        },
        "customAttributeDefinitions": {
          "attributes": [
            {
              "value": "={{ $('Travel Expense Submitted').item.json.body.id }}",
              "code": "expenseId",
              "name": "Expense ID"
            },
            {
              "value": "={{ $('Travel Expense Submitted').item.json.body.amount }}",
              "code": "amount",
              "name": "Amount (EUR)",
              "type": "FLOAT"
            },
            {
              "value": "={{ $('Travel Expense Submitted').item.json.body.employee }}",
              "code": "employee",
              "name": "Employee"
            },
            {
              "value": "={{ $('Travel Expense Submitted').item.json.body.reason }}",
              "code": "reason",
              "name": "Reason"
            }
          ]
        }
      },
      "id": "a62307a8-6bd8-4542-8af1-e9722302f50b",
      "name": "Approve Travel Expense",
      "type": "CUSTOM.sapTaskCenter",
      "typeVersion": 1,
      "position": [
        -96,
        160
      ],
      "webhookId": "30ddbc5a-e0ee-44d3-8566-93568cc650b0"
    },
    {
      "parameters": {
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 3
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.result.response }}",
                    "rightValue": "approved",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    },
                    "id": "9e34f335-2d83-45e8-9815-9ab0b7db3a46"
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "approved"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 3
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.result.response }}",
                    "rightValue": "rejected",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    },
                    "id": "84b11985-7557-4432-8af0-8b34e6eab3be"
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "rejected"
            }
          ]
        },
        "options": {}
      },
      "id": "003a33ce-3730-4099-9bf6-8852bc1b1da5",
      "name": "Route Approval Decision",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3.4,
      "position": [
        208,
        160
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "field-id",
              "name": "id",
              "value": "={{ $('Travel Expense Submitted').item.json.body.id }}",
              "type": "string"
            },
            {
              "id": "field-status",
              "name": "status",
              "value": "approved",
              "type": "string"
            },
            {
              "id": "field-message",
              "name": "message",
              "value": "=Expense of {{ $('Travel Expense Submitted').item.json.body.amount }} EUR approved by manager.",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "id": "68c1e609-7bfd-4b92-bfaa-4cfc6a3337f7",
      "name": "Set Manager Approved",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.5,
      "position": [
        464,
        64
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "field-id",
              "name": "id",
              "value": "={{ $('Travel Expense Submitted').item.json.body.id }}",
              "type": "string"
            },
            {
              "id": "field-status",
              "name": "status",
              "value": "rejected",
              "type": "string"
            },
            {
              "id": "field-message",
              "name": "message",
              "value": "=Expense of {{ $('Travel Expense Submitted').item.json.body.amount }} EUR rejected by manager.",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "id": "158846ee-bd31-4aa1-9853-99f9e619f6b6",
      "name": "Set Manager Rejected",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.5,
      "position": [
        464,
        288
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ id: $json.id, status: $json.status, message: $json.message }) }}",
        "options": {
          "responseCode": 200
        }
      },
      "id": "6d296c1c-00da-428f-bd9d-f56dd45b6c99",
      "name": "Respond with Decision",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.5,
      "position": [
        720,
        80
      ]
    },
    {
      "parameters": {
        "content": "## Travel Expense Approval\nThis workflow auto-approves expenses below **1000 EUR**.\nExpenses at or above 1000 EUR are sent to the manager\n(from `managerEmail` in the request) via SAP Task Center.\n\n**Required fields:** `id`, `amount`, `employee`, `reason`, `managerEmail`",
        "width": 360
      },
      "id": "dcc7b123-1111-4aaa-bbbb-cc1234567890",
      "name": "Workflow Overview",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [
        -640,
        -240
      ]
    }
  ],
  "connections": {
    "Travel Expense Submitted": {
      "main": [
        [
          {
            "node": "Amount Below 1000 EUR?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Amount Below 1000 EUR?": {
      "main": [
        [
          {
            "node": "Set Auto-Approved",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Approve Travel Expense",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Auto-Approved": {
      "main": [
        [
          {
            "node": "Respond with Decision",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Approve Travel Expense": {
      "main": [
        [
          {
            "node": "Route Approval Decision",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Route Approval Decision": {
      "main": [
        [
          {
            "node": "Set Manager Approved",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Set Manager Rejected",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Manager Approved": {
      "main": [
        [
          {
            "node": "Respond with Decision",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Manager Rejected": {
      "main": [
        [
          {
            "node": "Respond with Decision",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "f06cc6a64832473ffc3818bd85cf56fa2f1e952e612ef871863c323d9661f404"
  }
}
```

---

## Testing Checklist

Before considering a Task Center workflow complete:

- [ ] Used MCP `search_nodes` to get typeVersion
- [ ] Task Center node has a contextual canvas `name` describing the approval purpose (not generic `"SAP Task Center"`)
- [ ] `taskDefinition.definitionName` is set — defaults to the node's canvas `name` unless the user specified a different label
- [ ] Task Center node has all mandatory parameters (`subject`, `priority`, at least one recipient or recipient group)
- [ ] Custom attributes are included only when they help the approver make a decision
- [ ] Each custom attribute row includes `value`, `code`, display label (`name`), and `type`
- [ ] Custom attribute `value` expressions use the `={{ }}` wrapper; webhook-sourced fields include `.body.`, intermediate-node fields do not; named-node refs preferred over `$json`
- [ ] No more than 30 custom attributes are defined
- [ ] Switch node placed immediately after Task Center
- [ ] Switch branches on `$json.result.response`
- [ ] Recipient source is user-authorized: static `userId`, static `groupId`, or approved dynamic binding
- [ ] Dynamic recipient bindings target a known input field
- [ ] Named-node expressions preferred over `$json` when the source node is known
- [ ] No guessed, placeholder, example-copied, or unapproved payload-derived recipient values
- [ ] No `credentials` block included in the workflow JSON — credentials are resolved automatically during deployment
- [ ] Each post-approval/rejection branch uses SAP MCP Client to execute the SAP action
- [ ] Set nodes, if present, are used only for shaping response payloads — not as substitutes for SAP calls
- [ ] Node `onError` set per `intent.md`; if `continueErrorOutput`, the success output (index 0) feeds the Switch and the error output (index 1) reaches a caller-contract node (not the Switch)
- [ ] Workflow validates with `validate-n8n-workflow` MCP
