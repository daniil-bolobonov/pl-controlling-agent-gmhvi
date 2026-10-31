# SBPA StartEvent → n8n Trigger Reference

Comprehensive reference for how every SBPA `StartEvent` trigger type is converted to an n8n trigger node.

**SBPA class:** `com.sap.bpm.wfs.StartEvent`
**Source file:** `scripts/activities/startEvent.js`

---

## 1. Dispatch logic overview

The emitter consults two factors when it runs:

| Factor | Values |
|--------|--------|
| `ctx.processIsSubflow` | `true` when this process is called by at least one other process via `ReferencedSubflow` |
| `ctx.trigger.type` | `"trigger.api"`, `"trigger.event"`, `"trigger.scheduled"`, `"trigger.form"`, or `undefined` |

Decision tree:

```
processIsSubflow?
  ├─ YES → dual-trigger pattern (§7)
  └─ NO
       ctx.trigger defined?
         ├─ YES → standalone trigger node (§2–5)
         └─ NO  → manualTrigger fallback (§6)
```

---

## 2. trigger.api → Webhook Trigger

### When it fires
The SBPA process has a bound `trigger.api` artifact in the `.mtar` archive.

### n8n node
`n8n-nodes-base.webhook` typeVersion **2**

### Property mapping

| SBPA source | n8n field | Notes |
|-------------|-----------|-------|
| `trigger.identifier` | `parameters.path` | kebab-cased; e.g. `"newOrder"` → `"new-order"` |
| *(fixed)* | `parameters.httpMethod` | Always `"POST"` |
| *(fixed)* | `parameters.responseMode` | Always `"onReceived"` |
| `trigger.uid` | `webhookId` (top-level) | UUID; preserved for stable webhook URLs after re-import |

### kebab-case rules
`newOrder` → `new-order`, `my_trigger` → `my-trigger`, `MY TRIGGER` → `my-trigger`

### Sample — SBPA input
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "_uuid": "startEvent",
  "id": "StartEvent_1"
}
```
*Bound trigger artifact (`trigger.api` header):*
```json
{
  "triggerId": "api-trigger1",
  "uid": "e0f70492-6fe5-4144-a2be-294cea475665"
}
```

### Sample — n8n output
```json
{
  "id": "n8n-1",
  "name": "StartEvent",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "position": [240, 0],
  "parameters": {
    "httpMethod": "POST",
    "path": "api-trigger1",
    "responseMode": "onReceived"
  },
  "webhookId": "e0f70492-6fe5-4144-a2be-294cea475665"
}
```

### Post-import actions required
None — the webhook is ready to receive POST requests as soon as the workflow is activated.

---

## 3. trigger.event → SAP S/4HANA Event Trigger

### When it fires
The SBPA process has a bound `trigger.event` artifact (SAP Event Mesh / S/4HANA event subscription).

### n8n node
`CUSTOM.sapS4HanaEventTrigger` typeVersion **1**

> This is a custom community node, not a built-in n8n node. It must be installed in the target n8n instance.

### Property mapping

| SBPA source | n8n field | Notes |
|-------------|-----------|-------|
| `trigger.identifier` | `parameters.topic` | Pre-filled as the SBPA event identifier; customer replaces with the full broker topic post-import |
| *(fixed)* | `parameters.manualTopic` | Always `true` (topic entered manually) |
| *(fixed)* | `parameters.additionalFields` | Always `{}` |
| `trigger.uid` | `webhookId` (top-level) | UUID; normalised from `$.`-prefixed form in SBPA artifact |

### Why `manualTopic: true`?
SBPA's event identifier (e.g. `"salesOrderApprovalStatusChanged"`) is a logical name, not a structured SAP Event Mesh topic path. The full path (e.g. `sap/s4/beh/salesorder/v1/SalesOrder/Changed/v1`) is not in the SBPA export. Setting `manualTopic: true` lets the customer wire the correct broker address after import without needing to re-run the migration.

### `triggerIsWebhook`
`false` for event triggers — the event payload arrives at the top level of `$json`, not nested under `$json.body`. Downstream formula translation accounts for this.

### Sample — SBPA input
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "_uuid": "startEvent"
}
```
*Bound trigger artifact (`trigger.event` header):*
```json
{
  "identifier": "salesOrderApprovalStatusChanged",
  "uid": "$.6ce05e33-38cf-4936-a514-fcb1f3ea81e0"
}
```

### Sample — n8n output
```json
{
  "id": "n8n-1",
  "name": "StartEvent",
  "type": "CUSTOM.sapS4HanaEventTrigger",
  "typeVersion": 1,
  "position": [240, 0],
  "parameters": {
    "manualTopic": true,
    "topic": "salesOrderApprovalStatusChanged",
    "additionalFields": {}
  },
  "webhookId": "6ce05e33-38cf-4936-a514-fcb1f3ea81e0"
}
```

### Post-import actions required
- Replace `topic` with the full SAP Event Mesh topic path, or switch to `businessObject + operations` mode in the node settings.
- Configure the SAP Event Mesh / BTP Event Service credential in the node.

---

## 4. trigger.scheduled → Schedule Trigger

### When it fires
The SBPA process has a bound `trigger.scheduled` artifact.

### n8n node
`n8n-nodes-base.scheduleTrigger` typeVersion **1.2**

### Property mapping

| SBPA source | n8n field | Notes |
|-------------|-----------|-------|
| *(none)* | `parameters` | Always `{}` — SBPA export does not carry cron config |

### Why no schedule config?
The SBPA `.mtar` export does not include the configured schedule (cron rule, interval). The node is emitted with empty parameters as a placeholder. The customer sets the schedule in the n8n UI after import.

### Sample — SBPA input
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "_uuid": "startEvent"
}
```
*Bound trigger artifact (`trigger.scheduled` header):*
```json
{
  "uid": "$.abc12345-...",
  "type": "trigger.scheduled"
}
```

### Sample — n8n output
```json
{
  "id": "n8n-1",
  "name": "StartEvent",
  "type": "n8n-nodes-base.scheduleTrigger",
  "typeVersion": 1.2,
  "position": [240, 0],
  "parameters": {}
}
```

### Post-import actions required
Open the node and configure the desired cron rule or interval.

---

## 5. trigger.form → Form Trigger

### When it fires
The SBPA process has a `bpi.form` dependency whose `header.uri` contains `"formtrigger"` **and** the form is not referenced as a `UserTaskDefinition` inside the process graph.

> Detection is dependency-based, not artifact-based — there is no standalone `trigger.form` artifact in the SBPA export. The migrator infers it from the process dependencies.

### n8n node
`n8n-nodes-base.formTrigger` typeVersion **1**

### Property mapping

| SBPA source | n8n field | Notes |
|-------------|-----------|-------|
| *(none)* | `parameters` | Always `{}` — form fields are not exported in the SBPA artifact |
| form dependency `uid` | `webhookId` (top-level) | UUID derived from the form dependency header |

### Why no form fields?
Form field definitions exist in SBPA's form designer but are not included in the `.mtar` process export. The node is emitted as a shell; the customer adds the form fields in n8n post-import.

### Sample — SBPA input
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "_uuid": "startEvent"
}
```
*Inferred from dependency:*
```json
{
  "classDefinition": "com.sap.bpm.wfs.ProjectDependency",
  "header": { "uri": "/forms/formtrigger/my-form" },
  "uid": "8431256f-9456-467a-821b-b4bcdcfe68bd"
}
```

### Sample — n8n output
```json
{
  "id": "n8n-1",
  "name": "StartEvent",
  "type": "n8n-nodes-base.formTrigger",
  "typeVersion": 1,
  "position": [240, 0],
  "parameters": {},
  "webhookId": "8431256f-9456-467a-821b-b4bcdcfe68bd"
}
```

### Post-import actions required
Open the node and add all required form fields manually.

---

## 6. (none) → Manual Trigger (fallback)

### When it fires
No trigger artifact is bound to the process and the process is not a subflow.

A `no-trigger-binding` entry is added to `report.json`.

### n8n node
`n8n-nodes-base.manualTrigger` typeVersion **1**

### Property mapping

No parameters emitted (`parameters: {}`). No `webhookId`.

### Sample — n8n output
```json
{
  "id": "n8n-1",
  "name": "StartEvent",
  "type": "n8n-nodes-base.manualTrigger",
  "typeVersion": 1,
  "position": [240, 0],
  "parameters": {}
}
```

### Post-import actions required
Bind the appropriate trigger in n8n or replace the manualTrigger with the intended trigger type.

---

## 7. Subflow process — dual-trigger pattern

### When it fires
`ctx.processIsSubflow = true` — the process is called by at least one other process via a `ReferencedSubflow` node.

### Why three nodes?
n8n requires an `executeWorkflowTrigger` as the entry point when a workflow is invoked programmatically via `executeWorkflow`. However, the subflow may also need to run independently (for testing or standalone use). Three nodes are emitted to serve both paths:

| # | Name | Type | Purpose |
|---|------|------|---------|
| 1 | `Execute Workflow Trigger` | `n8n-nodes-base.executeWorkflowTrigger` v1 | Primary trigger for programmatic calls from a parent workflow |
| 2 | `<StartEventName> (Standalone)` | Same type as the standalone trigger (§2–6) | Allows independent execution without a caller |
| 3 | `<StartEventName>` | `n8n-nodes-base.set` v3.4 | **Normalize node** — merges `$json.body` (webhook path) with `$json` (sub-workflow path) so downstream expressions work identically regardless of which trigger fired |

Both trigger nodes (1 and 2) connect into the normalize node (3). The rest of the flow continues from node 3.

### Node 1 — Execute Workflow Trigger

| SBPA source | n8n field | Notes |
|-------------|-----------|-------|
| *(fixed)* | `parameters.inputSource` | Always `"passthrough"` |

### Node 2 — Standalone trigger

Same property mapping as the standalone trigger type (§2–6). Name is suffixed with `" (Standalone)"`.
If no trigger is bound, a `manualTrigger` is emitted instead.

### Node 3 — Normalize Set node

| n8n field | Value | Notes |
|-----------|-------|-------|
| `name` | `<StartEventName>` | Matches the StartEvent's display name so `$('StartEvent').item.json.field` resolves |
| `parameters.mode` | `"raw"` | Raw JSON output mode |
| `parameters.jsonOutput` | `={{ Object.assign({}, $json.body ?? {}, $json) }}` | Merges body (webhook) with top-level (sub-workflow); later keys win |

The `Object.assign` expression ensures:
- **Webhook path**: `$json.body.field` is promoted to `$json.field`
- **Sub-workflow path**: `$json.field` is already flat; `$json.body` is `undefined`, so `?? {}` prevents errors

### triggerIsWebhook for subflows
Always `false` for subflow processes. The normalize node handles flattening, so downstream formula translation does not need to account for the `.body` wrapper.

### Sample — SBPA input (subflow process with no bound trigger)
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "_uuid": "StartEvent_1",
  "id": "StartEvent_1",
  "name": "StartEvent"
}
```

### Sample — n8n output (subflow, no bound trigger)
```json
[
  {
    "id": "n8n-1",
    "name": "Execute Workflow Trigger",
    "type": "n8n-nodes-base.executeWorkflowTrigger",
    "typeVersion": 1,
    "position": [240, 0],
    "parameters": { "inputSource": "passthrough" }
  },
  {
    "id": "n8n-2",
    "name": "StartEvent (Standalone)",
    "type": "n8n-nodes-base.manualTrigger",
    "typeVersion": 1,
    "position": [720, 0],
    "parameters": {}
  },
  {
    "id": "n8n-3",
    "name": "StartEvent",
    "type": "n8n-nodes-base.set",
    "typeVersion": 3.4,
    "position": [720, 180],
    "parameters": {
      "mode": "raw",
      "jsonOutput": "={{ Object.assign({}, $json.body ?? {}, $json) }}"
    }
  }
]
```
*Connections:*
```json
{
  "Execute Workflow Trigger": {
    "main": [[{ "node": "StartEvent", "type": "main", "index": 0 }]]
  },
  "StartEvent (Standalone)": {
    "main": [[{ "node": "StartEvent", "type": "main", "index": 0 }]]
  },
  "StartEvent": {
    "main": [[{ "node": "<first downstream node>", "type": "main", "index": 0 }]]
  }
}
```

---

## 8. Execution & URL reference

### Webhook URL format (trigger.api and trigger.form)

After the workflow is **activated** in n8n, the webhook node registers a URL at:

```
https://<n8n-host>/webhook/<webhookId>
```

or, using the path-based URL:

```
https://<n8n-host>/webhook/<path>
```

Both URL forms are valid. The `webhookId` form is stable across renames; the `path` form is human-readable.

| Field | Source | Example |
|-------|--------|---------|
| `webhookId` | Preserved from SBPA `trigger.uid` | `e0f70492-6fe5-4144-a2be-294cea475665` |
| `path` | kebab-cased `trigger.identifier` | `api-trigger1` |

**Test URL** (workflow not yet activated):
```
https://<n8n-host>/webhook-test/<path>
```

### Triggering from an external system

All trigger types that produce a webhook (`trigger.api`, `trigger.form`, `trigger.event`) expect **HTTP POST** requests:

```http
POST https://<n8n-host>/webhook/<path>
Content-Type: application/json

{ "field1": "value1", "field2": "value2" }
```

Downstream nodes access the body via:
- `$json.body.field1` — when `triggerIsWebhook: true` (standalone `trigger.api` / `trigger.form`)
- `$json.field1` — when `triggerIsWebhook: false` (event trigger, subflow normalize node)

### Subflow execution URL

When the workflow is a subflow, the parent process calls it via the n8n `executeWorkflow` node — no HTTP call is needed. The `Execute Workflow Trigger` node has no HTTP endpoint.

For **standalone testing** of a subflow, use the `(Standalone)` trigger node. If a webhook-type standalone trigger is present, call:

```http
POST https://<n8n-host>/webhook-test/<path>
Content-Type: application/json

{ ... }
```

### Schedule trigger — no URL

`scheduleTrigger` nodes have no inbound HTTP URL. They fire on the configured cron schedule. Activate the workflow in n8n and configure the schedule in the node settings.

### Response mode

All `trigger.api` webhook nodes are emitted with `responseMode: "onReceived"` — n8n returns `200 OK` immediately when the webhook request arrives, before the workflow finishes executing. To wait for the workflow result and return it in the HTTP response, change the node's `responseMode` to `"lastNode"` after import.

---

## Quick reference table

| SBPA trigger | n8n node type | typeVersion | webhookId | parameters populated |
|---|---|---|---|---|
| `trigger.api` | `n8n-nodes-base.webhook` | 2 | ✅ from `trigger.uid` | `httpMethod`, `path`, `responseMode` |
| `trigger.event` | `CUSTOM.sapS4HanaEventTrigger` | 1 | ✅ from `trigger.uid` | `manualTopic: true`, `topic`, `additionalFields: {}` |
| `trigger.scheduled` | `n8n-nodes-base.scheduleTrigger` | 1.2 | ❌ | `{}` (empty — set post-import) |
| `trigger.form` | `n8n-nodes-base.formTrigger` | 1 | ✅ from form dep uid | `{}` (empty — set post-import) |
| *(none)* | `n8n-nodes-base.manualTrigger` | 1 | ❌ | `{}` |
| Subflow (primary) | `n8n-nodes-base.executeWorkflowTrigger` | 1 | ❌ | `inputSource: "passthrough"` |
| Subflow (standalone) | Same as above trigger type | — | per type | per type |
| Subflow (normalize) | `n8n-nodes-base.set` | 3.4 | ❌ | `mode: "raw"`, `jsonOutput` merge expression |
