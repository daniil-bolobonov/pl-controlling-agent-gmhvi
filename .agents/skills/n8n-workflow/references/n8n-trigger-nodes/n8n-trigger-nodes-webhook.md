# Webhook Trigger and Respond to Webhook

Entry and exit of webhook-shaped API workflows. Param shapes are version-dependent; `get_node_types` is canonical. This file covers what's *not* in the type def: runtime behavior, gotchas, and patterns.

---

## Webhook Trigger

### `responseMode`: behavioral differences

| Mode | `responseMode` value | n8n UI Label | Behavior |
|---|---|---|---|
| Immediate | `'onReceived'` (default) | Immediately | Returns 200 immediately. Workflow continues asynchronously. Caller doesn't see workflow output. |
| Last node | `'lastNode'` | When Last Node Finishes | Returns the last node's output. Synchronous. |
| Respond node | `'responseNode'` | Using 'Respond to Webhook' Node | Use `Respond to Webhook` nodes to control the response. Most flexible. **Required (or `streaming`) whenever a Respond to Webhook node is connected downstream.** |
| Streaming | `'streaming'` | Streaming | Stream data in real time from streaming-enabled nodes. |

For request/response API workflows, use `responseNode` paired with explicit Respond to Webhook nodes.

> **⛔ MANDATORY pairing:** If a workflow has a `n8n-nodes-base.respondToWebhook` node connected downstream of the trigger, the Webhook trigger MUST set `responseMode: "responseNode"` (or `"streaming"` for streaming responses). Leaving it at the default `onReceived` (or `lastNode`) makes the Respond node unreachable-by-mode, and n8n rejects the workflow at activation with *"Unused Respond to Webhook node found in the workflow"*. This is the single most common cause of a rejected webhook workflow — always verify the pairing before writing.


### Output structure (runtime)

The webhook trigger emits `{ headers, params, query, body, webhookUrl, executionMode }`, plus `binary` if `options.rawBody` is set, plus `jwtPayload` if JWT auth was used. `executionMode` is `'test'` or `'production'`.

Access POST body fields via `$json.body.*` paths.

---

## Respond to Webhook

### `responseBody` for `respondWith: 'json'`: pass the object, not a string

The type def accepts both `IDataObject` and `string`. If you pass `JSON.stringify(obj)`, n8n then JSON-serializes the *string*, producing an escaped, double-encoded body. Pass the object directly.

### `responseCode` defaults to 200, including on error paths

The most common Respond-to-Webhook bug: forgetting to change the response code on an error branch. Returning 200 with an error body is worst-of-both-worlds: the caller's HTTP client sees success while the body says failure.

Set the response code explicitly on every Respond branch.

### Multiple Respond nodes per workflow

A workflow can have multiple Respond nodes, one per response shape. n8n returns whichever fires first.

```
[Webhook] ─→ [Validate] ─→ [Process] ─→ [Respond 200 success]
            ├─→ [Respond 400 validation_error]
            ├─→ [Respond 401 unauthorized]
            └─→ (error outputs from process) ─→ [Respond 5xx]
```

---

## Body Validation Pattern

**When a webhook workflow requires specific fields in the POST body, always add a validation step immediately after the Webhook node.** Do not rely on downstream nodes to fail gracefully on missing or malformed input — validate explicitly and return a 400 response early.

> **⛔ Derive this flow from `workflow-schema.openapi.json`, don't invent fields.** `REQUIRED_FIELDS` is the refined `requestBody` `required[]` for this webhook's path, exactly. Type/`enum`/`format` checks mirror each property (`type: integer` → number check, `enum` → membership check). The refine gate in `../execution.md` injects or reconciles this Code node against the schema. No `required` params → the flow is optional; don't invent requirements.

### Mandatory structure

A single Code node throws on invalid input; its **error output** goes straight to a 400 Respond
node. No IF node — the Code node's two outputs are the branch.

```
Webhook → Validate Body (Code) ─ (success, output 0) → ... → Respond 200
                               └ (error,   output 1) → Respond 400
```

Set `onError: "continueErrorOutput"` on the Code node so a thrown error routes to output 1 instead
of failing the execution. Wire output 0 to the main flow and output 1 to the 400 Respond node.

### Code node template

Use `runOnceForEachItem` mode. Define `REQUIRED_FIELDS` as a named constant at the top. It is derived from the schema, not user-provided configuration, so it gets **no** "hardcoded configuration" sticky note (that is Rule 10, which does not apply here). On any missing or invalid field, **throw** — the error surfaces on output 1. On success, return the body so downstream nodes can read it.

Given this refined `requestBody` schema:

```json
{
  "type": "object",
  "required": ["employeeId", "days"],
  "properties": {
    "employeeId": { "type": "string" },
    "days":       { "type": "integer" },
    "status":     { "type": "string", "enum": ["draft", "submitted"] }
  }
}
```

the Code node below follows from it: `REQUIRED_FIELDS` is the `required[]`, the `days` number check comes from `type: integer`, the `status` check from its `enum`.

```javascript
// Derived from workflow-schema.openapi.json requestBody for this webhook's path.
// REQUIRED_FIELDS mirrors the schema's `required[]` — do not add or omit fields.
const REQUIRED_FIELDS = ['employeeId', 'days'];

const body = $input.item.json.body;
const errors = [];

for (const field of REQUIRED_FIELDS) {
  if (body[field] === undefined || body[field] === null || body[field] === '') {
    errors.push(`${field} is missing`);
  }
}

// Type / enum / format checks, each mirroring the schema property definition:
// `days` is schema type integer:
if (body.days !== undefined && typeof body.days !== 'number') {
  errors.push('days must be a number');
}
// `status` has a schema enum:
if (body.status !== undefined && !['draft', 'submitted'].includes(body.status)) {
  errors.push('status must be one of: draft, submitted');
}

if (errors.length > 0) {
  throw new Error('Validation failed: ' + errors.join(', '));
}

return { json: { ...body } };
```

### 400 response on validation failure

Wired to the Code node's **error output** (output 1). On that branch the thrown error is a **string** at `$json.error` (not an object) — reference it directly:

```json
{
  "respondWith": "json",
  "responseBody": "={{ JSON.stringify({ error: 'Validation failed', details: $json.error }) }}",
  "options": { "responseCode": 400 }
}
```

---

## Common Errors to avoid.

### ERROR: "Unused Respond to Webhook node found in the workflow"

```
Webhook (onReceived / default)  → ... → [Respond to Webhook]   // trigger mode never routes to the respond node
```

n8n raises this error at activation when a `Respond to Webhook` node is connected downstream of the trigger but the Webhook trigger's `responseMode` is left at the default `'onReceived'` (or set to `'lastNode'`). In those modes the response is never routed through the Respond node, so n8n considers it unused and rejects the workflow.

**Fix:** Set `responseMode: "responseNode"` on the Webhook trigger. Any workflow that has a `Respond to Webhook` node connected downstream MUST use `responseNode` (or `streaming`) — see the MANDATORY pairing rule above.

---

### ERROR: Using `'lastNode'` when the workflow contains SAP Task Center

```
Webhook (lastNode) → ... → SAP Task Center → Switch → Respond
```

SAP Task Center is a human approval step that can block for minutes or hours. The HTTP request times out with a **502 Bad Gateway** long before the workflow completes. The caller receives an error even if the workflow eventually succeeds.

**Fix:** Use `'onReceived'` to acknowledge receipt instantly and let the workflow continue asynchronously — or use `'responseNode'` and place a `Respond to Webhook` node immediately after the webhook to confirm receipt before the long-running step begins.

---

### ERROR: Using `'responseNode'` without a `Respond to Webhook` node on every branch

```
Webhook (responseNode) → IF → [true branch: Respond to Webhook]
                             → [false branch: Set node]   // no respond node — caller hangs
```

If a branch never reaches a `Respond to Webhook` node, the caller waits until the request times out or fails on that path.

**Fix:** Ensure every execution branch that can be reached connects to a `Respond to Webhook` node. Apply the multiple-Respond-nodes pattern above: one per response shape.

---

### ERROR: Using `'lastNode'` expecting a specific response shape

```
Webhook (lastNode) → ... → Set { status: "ok" }
```

`'lastNode'` returns the raw output of the last node. If the workflow has multiple end nodes or the output shape changes, the response becomes unpredictable.

**Fix:** Use `'responseNode'` with a `Respond to Webhook` node to explicitly control the response payload.
