# n8n SAP MCP Client Node Generation

## Overview

Ensures correct generation of **SAP MCP Client** nodes for calling SAP MCP (Model Context Protocol) server tools from n8n workflows. It covers server selection, tool invocation, argument passing, response handling, and integration patterns — including the injection of custom MCP servers that are part of the same solution as the workflow but not yet deployed.

**Critical Mission:** ALWAYS use the SAP MCP Client node — never use a generic HTTP Request node — whenever the workflow needs to contact SAP systems (including S/4HANA) or custom LOB systems exposed via an MCP server. This node uses the configured SAP Agent Gateway credential for authentication.

---

## CRITICAL RULES (Never Skip)

### 1. **ALWAYS use MCP to get node metadata**

**BEFORE generating an SAP MCP Client node:**
```javascript
// Call MCP tool
search_nodes({ queries: ["SAP MCP Client"] })
```

**Use the returned values:**
- `search_nodes` result ID → use as `type` in workflow
- `search_nodes` result `Version` → use as `typeVersion` in workflow
- `get_node_types` (call with the ID) → TypeScript parameter interface (with JSDoc `@default`, `@displayOptions.show`, option names); use it to understand available parameters

**NEVER hardcode typeVersion** — always get it from `search_nodes`.

---

### 2. **This Node is MANDATORY for All S/4HANA and LOB System Interactions**

**Whenever the workflow needs to:**
- ✅ Read or write data in S/4HANA (GL accounts, purchase orders, vendors, customers, materials, etc.)
- ✅ Invoke any SAP business function or API exposed via MCP
- ✅ Query SAP Finance, Procurement, HR, or any other SAP module
- ✅ Execute SAP transactions or operations programmatically

→ Use the SAP MCP Client node directly with the appropriate MCP server.

**For Custom LOB Systems:**
If the workflow needs to call a custom/internal API (inventory database, legacy system, internal service), follow this pattern:
1. Create an MCP server in the same solution that wraps the LOB API endpoints as MCP tools
2. Use SAP MCP Client node to invoke the MCP server tools
3. Never use HTTP Request node as a shortcut

**NEVER use these alternatives for SAP/S/4HANA/LOB calls:**
- ❌ `n8n-nodes-base.httpRequest` (generic HTTP Request node)
- ❌ Any OData/REST calls directly to SAP endpoints
- ❌ RFC/BAPI nodes that bypass MCP
- ❌ `n8n-nodes-base.set` (as a substitute for posting results to SAP)

---

### 3. **NEVER Use a Set Node as a Substitute for an SAP Action**

A `n8n-nodes-base.set` node stores data in n8n memory. It does **NOT** call SAP — nothing is posted, created, updated, or sent.

❌ **Anti-pattern — only stores data in n8n, SAP is never contacted:**
```
Set Node { "status": "approved", "poId": "PO-12345" }  →  Respond
```

✅ **Correct pattern — executes the action in SAP:**
```
SAP MCP Client ("post_approval_decision", { decision: "approved", poId: "PO-12345" })  →  Respond
```

**Rule:** Whenever the workflow must post, create, update, or notify via SAP, that step MUST be a `CUSTOM.sapMcpClient` node. Set nodes are only appropriate for shaping or staging data between SAP MCP Client calls.

---

### 4. **Mandatory Parameters**

**Always required:**
- `mcpServerName` (string, JSON) — selected MCP server as `{"ordId":"...","name":"..."}` (2-field shape only; tool definitions come from `mcpServers`; **field order matters — `ordId` must come before `name`**)
- `toolMode` (enum) — `"list"` (select by name) or `"id"` (direct tool ID)
- When `toolMode = "list"`: `toolFromList` (string, JSON) — `{"name":"<tool name>"}` (name field only)
- When `toolMode = "id"`: `toolId` (string) — exact tool name (case-sensitive)
- `inputMode` (enum) — `"json"` (recommended) or `"manual"`
- When `inputMode = "json"`: `toolArguments` (string) — JSON-serialised argument object or n8n expression
- When `inputMode = "manual"`: `argumentsList` (object with `argument` array of `{ name, value }` pairs)
- `additionalOptions` (object) — wraps `includeMetadata` and `timeout`
- `mcpServers` (string) — JSON-serialised array of all custom MCP server definitions in the solution (see [Custom MCP Server Injection](#custom-mcp-server-injection-joule-studio-pattern))
- **`mcpServerName` and `mcpServers[]` must be consistent** — the `ordId` and `name` in `mcpServerName` must exactly match the `ordId` and `name` of the corresponding entry in `mcpServers`.
- The `name` field in both `mcpServerName` and `mcpServers` entries must exactly match the `provides.apis[].name` field from the MCP server's `asset.yaml`.

**Example — JSON mode (Joule Studio scaffold pattern):**
```json
{
  "type": "<from MCP>",
  "typeVersion": "<from MCP>",
  "name": "Get GL Account Balance",
  "parameters": {
    "mcpServerName": "{\"ordId\":\"sap.s4hana:mcpServer:Finance:v1\",\"name\":\"S/4HANA Finance (Injected)\"}",
    "toolMode": "list",
    "toolFromList": "{\"name\":\"get_gl_account_balance\"}",
    "inputMode": "json",
    "toolArguments": "{\"account_id\": \"400000\", \"company_code\": \"1000\", \"fiscal_year\": \"2026\"}",
    "additionalOptions": { "includeMetadata": false, "timeout": 30000 },
    "mcpServers": "[{\"ordId\":\"sap.s4hana:mcpServer:Finance:v1\",\"name\":\"S/4HANA Finance (Injected)\",\"description\":\"SAP S/4HANA Finance — GL, AP, AR and cost centre tools.\",\"tools\":[{\"name\":\"get_gl_account_balance\",\"description\":\"Get the balance of a GL account for a given company code and fiscal year.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"account_id\":{\"type\":\"string\",\"description\":\"GL account number\"},\"company_code\":{\"type\":\"string\",\"description\":\"Company code\"},\"fiscal_year\":{\"type\":\"string\",\"description\":\"Fiscal year (YYYY)\"}},\"required\":[\"account_id\",\"company_code\",\"fiscal_year\"]}}]}]"
  }
}
```

---

### 5. **Tool Selection Modes**

| Mode | Parameter | Value shape | When to Use |
|------|-----------|-------------|-------------|
| `"list"` | `toolFromList` | `{"name":"<tool name>"}` | Default — tool name matched against `tools[]` in `mcpServers` |
| `"id"` | `toolId` | exact tool name string | When tool name is known and confirmed |

**Always use `"list"` mode** with `toolFromList` containing only `{"name":"..."}` — no other fields.

---

### 6. **Input Modes**

| Mode | Parameter | When to Use |
|------|-----------|-------------|
| `"json"` | `toolArguments` (JSON-serialised string or n8n expression that resolves to one) | Default — supports nested structures |
| `"manual"` | `argumentsList.argument[]` (array of `{ name, value }`) | Simple single-value arguments; avoids JSON syntax |

**Always prefer `"json"` mode.** `toolArguments` must resolve to a JSON-serialised string. You can provide it in either of these ways:

For static values:
```json
{
  "inputMode": "json",
  "toolArguments": "{\"vendor\": \"V001\", \"company_code\": \"1000\"}"
}
```

For runtime values (resolved from upstream nodes) — as an n8n expression:
```json
{
  "inputMode": "json",
  "toolArguments": "={{ JSON.stringify({ SupplierInvoice: $('Webhook').item.json.body.invoiceId }) }}"
}
```

> **Do not** write `={"key": "{{ ... }}"}` — `={` is not a valid n8n expression prefix.
> **Do not** write `{"key": "{{ ... }}"}` — `{{ }}` inside a string value is not evaluated as an n8n expression.
> When any value is dynamic, build the full object inside a proper n8n expression and wrap it with `JSON.stringify(...)`:
> `={{ JSON.stringify({ key: $('Webhook').item.json.body.value }) }}`

**Manual mode** — use when you prefer key-value pairs over a JSON string. The parameter is `argumentsList` with an `argument` array. Each entry's `value` field supports n8n expressions:

```json
{
  "inputMode": "manual",
  "argumentsList": {
    "argument": [
      { "name": "employeeId", "value": "EMP-001" },
      { "name": "invoiceId", "value": "={{ $('Webhook').item.json.body.invoiceId }}" }
    ]
  }
}
```

---

### 7. **Additional Options**

These are optional but should be applied when relevant:

| Option | Type | Default | When to Set |
|--------|------|---------|-------------|
| `requestId` | string | auto UUID | Set for traceability in production: `"{{ $workflow.id }}-{{ $itemIndex }}"` |
| `timeout` | number (ms) | 30000 | Increase for batch/complex operations; decrease for quick lookups |
| `includeMetadata` | boolean | false | Enable during development/debugging |

**Error handling is a node-level property, not an additional option.** Do **not** add `continueOnFail` here — it is the outdated property name and must not be generated. Set the node's `onError` property per the error-handling decision recorded in `intent.md` (see `execution.md` Rule 17):

| `onError` | Behaviour |
|---|---|
| `"stopWorkflow"` | Default — the run fails at this node. |
| `"continueRegularOutput"` | On failure the node passes its input through on the normal output. |
| `"continueErrorOutput"` | Adds a second `main` output — index `0` = success, index `1` = error. |

When using `continueErrorOutput`, wire the error output (second `main` entry) to a node that fulfils the caller contract — by default a `respondToWebhook` that returns the error, or a customer-specific action (Task Center ticket, notification, human fix) that still reaches a terminal response. Connect the error output **directly** to that action — do not merge it back with the success output or add a downstream IF/Switch to re-detect the failure (see `execution.md` Rule 17 anti-pattern).

### 8. **Custom MCP Server Injection (Joule Studio Pattern)**

When Joule Studio scaffolds a workflow that is part of a solution containing **custom MCP servers**, those servers might not yet be deployed at design time. To make them selectable in the SAP MCP Client node, Joule Studio embeds their definitions in the hidden `mcpServers` parameter.

---

### 9. **Adding or Removing a Custom MCP Server in an Existing Solution**

When a custom MCP server is added to or removed from a solution, update `mcpServers` on **every** SAP MCP Client node in **every** workflow in the solution.

**When adding a new custom MCP server:**
- Add the new server's full definition (`ordId`, `name`, `description`, `tools[]`) to `mcpServers` on every SAP MCP Client node across all workflows in the solution
- Verify no existing node has a `mcpServers` list that is missing the new server

**When removing a custom MCP server:**
- Remove the server's entry from `mcpServers` on every SAP MCP Client node across all workflows in the solution
- Check that no node has `mcpServerName` or `toolFromList` still referencing the removed server — if so, those parameters must be updated to a valid remaining server and tool

---

When Joule Studio scaffolds a workflow that is part of a solution containing **custom MCP servers** (servers the customer is building in the same solution), those servers are not yet deployed at design time. The SAP MCP Client node must still present them in the editor so users can select and configure them before any deployment occurs.

Joule Studio embeds the custom MCP server definitions into the workflow JSON as the `mcpServers` node parameter. This is a **hidden parameter** — not rendered in the n8n editor panel — that the node reads to populate the MCP server dropdown and tool lists without requiring deployment.

**`mcpServers` requirements:**
- Must be a **JSON-serialised string** (not a raw JSON array) — n8n stores hidden node parameters as strings regardless of what type is written
- Must include **all** custom MCP servers in the solution on every SAP MCP Client node — even nodes that use only one of them
- Each entry must include `ordId`, `name`, and `tools[]`; `description` is optional
  - `ordId` — stable identifier; must exactly match the ordId used when the server is deployed
  - `name` — display name shown in the n8n editor dropdown
  - `description` — optional; shown as subtitle in the server dropdown
  - `tools[]` — complete tool definitions known at design time; each tool must have `name`; `description` and `inputSchema` are strongly recommended (shown with defaults if absent, with a warning logged)
- Must **not** include `globalTenantId`, `baseUrl`, `serverId`, or other infrastructure fields — `mcpServers` carries tool definitions only

**`mcpServers` value (unescaped for readability):**
```json
[
  {
    "ordId": "sap.joule:mcpServer:Finance:v1",
    "name": "Joule Finance MCP",
    "description": "Finance tools provided by Joule Studio",
    "tools": [
      {
        "name": "get_budget",
        "description": "Get budget allocation for cost centre",
        "inputSchema": {
          "type": "object",
          "properties": {
            "cost_centre": { "type": "string", "description": "Cost centre ID" }
          },
          "required": ["cost_centre"]
        }
      }
    ]
  }
]
```

**As it must appear in the workflow JSON (JSON-serialised string):**
```json
"mcpServers": "[{\"ordId\":\"sap.joule:mcpServer:Finance:v1\",\"name\":\"Joule Finance MCP\",\"description\":\"Finance tools provided by Joule Studio\",\"tools\":[{\"name\":\"get_budget\",\"description\":\"Get budget allocation for cost centre\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"cost_centre\":{\"type\":\"string\",\"description\":\"Cost centre ID\"}},\"required\":[\"cost_centre\"]}}]}]"
```

### Pre-selecting server and tool at scaffold time

```json
"mcpServerName": "{\"ordId\":\"sap.joule:mcpServer:Finance:v1\",\"name\":\"Joule Finance MCP\"}"
```

```json
"toolFromList": "{\"name\":\"get_budget\"}"
```

```json
"toolArguments": "{\"cost_centre\": \"CC-1000\"}"
```

The unescaped values these represent:

| Parameter | Value |
|-----------|-------|
| `mcpServerName` | `{"ordId":"sap.joule:mcpServer:Finance:v1","name":"Joule Finance MCP"}` |
| `toolFromList` | `{"name":"get_budget"}` |
| `toolArguments` | `{"cost_centre": "CC-1000"}` |

### Key points when generating workflows with injected MCP servers

- The sample workflow pattern is for **illustration only** — it demonstrates the injection mechanism and parameter contracts, not a production-ready topology
- `mcpServerName` is the 2-field shape `{"ordId":"...","name":"..."}` — no other fields; **`ordId` must always come before `name`** (wrong key order is silently ignored by the mcp client node)
- `toolFromList` contains only `{"name":"..."}` — matching exactly what the node produces from the `tools[]` entry
- `toolArguments` must resolve to a valid JSON string — use a literal escaped JSON string for static values, or `={{ JSON.stringify({...}) }}` for runtime values
- **Merge node required for branch fan-out:** when multiple SAP MCP Client nodes run in different branches (fan-out) and all must complete before responding, a Merge node (`mode: waitForAll`) is required before `Respond to Webhook` — without it, n8n executes each branch independently and the webhook fires once per branch, causing errors on the 2nd and 3rd responses

**Must NOT do:**
- Include `globalTenantId` anywhere in the workflow JSON — this value does not exist until the custom MCP server is deployed
- Include infrastructure fields such as `baseUrl` or `serverId` in the `mcpServers` entries — these are not needed and would break dropdown matching
- Include `tools[]` in the `mcpServerName` stored value — only `ordId` and `name` belong there

---

## Common Use Cases

**Scenario:** Retrieve GL account balance

```json
{
  "parameters": {
    "mcpServerName": "{\"ordId\":\"sap.s4hana:mcpServer:Finance:v1\",\"name\":\"S/4HANA Finance\"}",
    "toolMode": "list",
    "toolFromList": "{\"name\":\"get_gl_account_balance\"}",
    "inputMode": "json",
    "toolArguments": "{\"accountNumber\": \"100000\", \"companyCode\": \"1000\", \"fiscalYear\": \"2026\"}"
  }
}
```

### Use Case 2: Create SAP Document from Workflow Data

**Scenario:** Create a purchase order

```json
{
  "parameters": {
    "mcpServerName": "{\"ordId\":\"sap.ariba:mcpServer:Procurement:v1\",\"name\":\"SAP Ariba Procurement\"}",
    "toolMode": "id",
    "toolId": "create_purchase_order",
    "inputMode": "json",
    "toolArguments": "{\"vendor\": \"V001\", \"company_code\": \"1000\", \"purchasing_group\": \"001\"}"
  }
}
```

### Use Case 3: Batch Processing SAP Records

**Scenario:** Process a list of SAP records using Split in Batches + SAP MCP Client

```
Trigger → Get List → Split in Batches → SAP MCP Client → Merge → Respond
```

### Use Case 4: Conditional SAP Operation

**Scenario:** Only create a PO if inventory is below threshold

```
Trigger → Check Inventory (SAP MCP Client) → IF (low stock) → Create PO (SAP MCP Client)
                                                               → ELSE → Continue
```

---

## Response Handling

The node outputs the tool's response under `$json.result`. If metadata is enabled, `$json.metadata` is also available.

```json
{
  "result": {
    // Tool-specific SAP response data
  },
  "metadata": {  // Only if includeMetadata = true
    "serverId": "sap-finance-server",
    "toolId": "get_gl_account_balance",
    "requestId": "uuid-here",
    "executionTime": 1234
  }
}
```

**Accessing response data in subsequent nodes:**
```
{{ $json.result }}                    → full tool response
{{ $json.result.balance }}            → specific field
{{ $json.metadata.executionTime }}    → execution time (if metadata enabled)
```

---

## Common Errors to Avoid

❌ **ERROR 1:** Using HTTP Request instead of SAP MCP Client for S/4HANA
```json
{
  "type": "n8n-nodes-base.httpRequest",
  "parameters": { "url": "https://s4hana.example.com/..." }
}
```
✅ **FIX:** Always use SAP MCP Client node for S/4HANA and SAP MCP server calls

---

❌ **ERROR 2:** Hardcoded `typeVersion`
```json
{ "typeVersion": 1 }  // WRONG — may be outdated
```
✅ **FIX:** Always call `search_nodes({ queries: ["SAP MCP Client"] })` and use the returned `Version` as `typeVersion`

---

❌ **ERROR 3:** Missing or invalid credentials
```json
{ "credentials": {} }  // WRONG
```
✅ **FIX:** Remove the `credentials` block entirely — credentials are resolved automatically during deployment

---

❌ **ERROR 4:** Wrong `mcpServerName` shape — including extra fields
```json
{ "mcpServerName": "{\"ordId\":\"...\",\"name\":\"...\",\"tools\":[...]}" }  // WRONG — tools[] must not be here
```
✅ **FIX:** `mcpServerName` must be `{"ordId":"...","name":"..."}` only — two fields, nothing else

---

❌ **ERROR 4b:** Wrong field order in `mcpServerName` — `name` before `ordId`
```json
{ "mcpServerName": "{\"name\":\"S/4HANA Finance\",\"ordId\":\"sap.s4hana:mcpServer:Finance:v1\"}" }  // WRONG — mcp client node does not pick this up
```
✅ **FIX:** `ordId` must always appear before `name` — the agent node parses the serialised JSON positionally and silently ignores the value if the order is incorrect:
```json
{ "mcpServerName": "{\"ordId\":\"sap.s4hana:mcpServer:Finance:v1\",\"name\":\"S/4HANA Finance\"}" }
```

---

❌ **ERROR 5:** Including `globalTenantId` or infrastructure fields in `mcpServers`
```json
{ "mcpServers": "[{\"ordId\":\"...\",\"globalTenantId\":\"abc-123\", ...}]" }  // WRONG
```
✅ **FIX:** `mcpServers` carries tool definitions only — never `globalTenantId`, `baseUrl`, or `serverId`

---

❌ **ERROR 6:** Omitting a custom MCP server from `mcpServers` on a node
```
// Node uses Server A but mcpServers only lists Server B — Server A won't appear in the dropdown
```
✅ **FIX:** All custom MCP servers in the solution must be listed in `mcpServers` on every SAP MCP Client node

---

❌ **ERROR 7:** Independent SAP MCP Client branches converging on one responder without a Merge node
```
Webhook → SAP MCP Client (branch 1) → Respond to Webhook
        → SAP MCP Client (branch 2) → Respond to Webhook  // WRONG — webhook fires per branch
```
✅ **FIX:** Add a Merge node (`mode: waitForAll`) before `Respond to Webhook` when all branches must complete first (`execution.md` Rule 9, independent-branches case)

---

❌ **ERROR 8:** Not handling SAP tool errors
```
SAP MCP Client → Process Data → Done  // No error handling
```
✅ **FIX:** Set `onError: "continueErrorOutput"` and wire the error output (the second `main` output) to downstream error handling; see `execution.md` Rule 17
```
SAP MCP Client (onError: continueErrorOutput)
    ├─ output 0 (success) → Continue
    └─ output 1 (error)   → [Respond with error | Task Center ticket | Notify]
```

---

❌ **ERROR 9:** Using a Set node to record an outcome instead of posting it to SAP
```
// WRONG — this only stores data in n8n memory, SAP is never contacted
Set Node { "status": "approved", "invoiceId": "INV-001" }  →  Respond
```
✅ **FIX:** Replace the terminal Set node with an SAP MCP Client node that executes the action in SAP:
```
SAP MCP Client (post_approval_decision, { decision: "approved", invoiceId: "INV-001" })  →  Respond
```

---

❌ **ERROR 10:** `mcpServerName` and `mcpServers[]` have mismatched `ordId` or `name`
```json
// mcpServerName selects the real server...
"mcpServerName": "{\"ordId\":\"sap.s4:apiResource:CE_PURCHASEREQUISITION_0001:v1\",\"name\":\"SAP S/4HANA Cloud - Purchase Requisition\"}"

// ...but the mcpServers[] entry uses a different ordId / name (stale copy, typo, or other suffix)
"mcpServers": "[{\"ordId\":\"sap.s4:apiResource:CE_PURCHASEREQUISITION_0001_RANDOM:v1\",\"name\":\"SAP S/4HANA Cloud - Purchase Requisition_RANDOM\",...}]"
```
The node cannot match the selection to any definition — the server dropdown shows nothing, no error is thrown, and the tool call silently fails at runtime.

✅ **FIX:** The `ordId` and `name` in `mcpServerName` must exactly match the corresponding `mcpServers[]` entry. Always derive `mcpServerName` from the `mcpServers[]` entry — never write the two independently:
```json
"mcpServerName": "{\"ordId\":\"sap.s4:apiResource:CE_PURCHASEREQUISITION_0001:v1\",\"name\":\"SAP S/4HANA Cloud - Purchase Requisition\"}",
"mcpServers": "[{\"ordId\":\"sap.s4:apiResource:CE_PURCHASEREQUISITION_0001:v1\",\"name\":\"SAP S/4HANA Cloud - Purchase Requisition\",\"description\":\"...\",\"tools\":[...]}]"
```

---

## Integration Patterns

### Pattern 1: Sequential SAP Operations
```
Trigger → Get Customer (SAP MCP Client) → Get Orders (SAP MCP Client) → Create Invoice (SAP MCP Client) → Notify
```

### Pattern 2: SAP MCP Client + Agent Orchestration
```
Webhook → SAP Agent → SAP MCP Client (execute SAP action) → Respond
```
See: `../n8n-sap-agent/n8n-sap-agent.md`

### Pattern 3: SAP MCP Client + Human Approval
```
Trigger → SAP MCP Client (fetch data) → Task Center (approve) → SAP MCP Client (execute) → Notify
```
See: `../n8n-sap-task-center/n8n-sap-task-center.md`

### Pattern 4: Error Recovery with Retry

Retry and error-output handling are **complementary, not alternatives** — use both. n8n retries the node automatically first; only after retries are exhausted does `onError` take effect.

1. **Automatic retry (node-level)** absorbs transient failures (timeouts, brief outages) without touching the error path:

   | Property | Purpose |
   |---|---|
   | `retryOnFail: true` | Enable automatic retry on failure |
   | `maxTries` | Number of attempts (2–5) |
   | `waitBetweenTries` | Delay in ms between attempts |

2. **Error output (`onError: continueErrorOutput`)** catches only the failure that survives every retry, routing it to the error action recorded in `intent.md`:

```
Trigger → SAP MCP Client (retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: continueErrorOutput)
              ├─ output 0 (success) → Continue
              └─ output 1 (error, after retries exhausted) → <error action per intent.md>
```

Prefer built-in `retryOnFail` over a manual `Wait → loop back` on the error branch: it is simpler and retries the exact failed call. Reserve a manual retry loop for custom backoff logic the built-in option cannot express.

---

## Testing Checklist

Before considering a workflow with SAP MCP Client complete:

- [ ] Used MCP `search_nodes({ queries: ["SAP MCP Client"] })` to get `type` and `typeVersion`
- [ ] SAP MCP Client node used for ALL S/4HANA / SAP system calls (no HTTP Request substitutes)
- [ ] `mcpServerName` uses 2-field shape `{"ordId":"...","name":"..."}` only, with `ordId` before `name`
- [ ] `toolFromList` uses name-only shape `{"name":"..."}` only
- [ ] `toolArguments` resolves to a valid JSON-serialised string: use an escaped JSON literal for static values, or `={{ JSON.stringify({...}) }}` for runtime values
- [ ] `mcpServers` lists all custom MCP servers in the solution on every SAP MCP Client node
- [ ] `mcpServerName` `ordId` and `name` exactly match the corresponding `mcpServers[]` entry
- [ ] `mcpServers` contains no `globalTenantId`, `baseUrl`, or `serverId`
- [ ] No `credentials` block included in the workflow JSON — credentials are resolved automatically during deployment
- [ ] Error handling set via node-level `onError` per `intent.md` (never the outdated `continueOnFail`); any `continueErrorOutput` error output reaches a caller-contract node
- [ ] No terminal Set nodes used as SAP action substitutes — every SAP outcome is executed via SAP MCP Client
- [ ] Workflow validates with `validate-n8n-workflow` MCP
