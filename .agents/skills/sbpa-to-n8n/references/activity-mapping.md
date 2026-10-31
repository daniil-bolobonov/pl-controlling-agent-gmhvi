# SBPA activity → n8n node mapping (v1)

This table lists every SBPA construct the migrator handles in v1 and what it emits. When you (the LLM stage) find a `classDefinition` in the source that isn't listed here, add an entry to `report.json` and ask the user; don't guess.

## Primary class definitions

| SBPA `classDefinition` | Emits | Key parameters | Notes |
|---|---|---|---|
| `com.sap.bpm.wfs.StartEvent` | Depends on trigger type and whether the process is called as a subflow — see "StartEvent trigger dispatch" below | | |
| `com.sap.bpm.wfs.EndEvent` | Elided if no `mappings.in`; otherwise `n8n-nodes-base.set` (typeVersion 3.4) shaping the final output | `assignments.assignments[]` from the inbound mapping; each assignment's `type` is derived from `interfaces.in`'s JSON Schema per-key (see `scripts/schema.js`) | Sub-workflows almost always have an EndEvent mapping — it defines the return payload. Per-field type falls back to `'string'` (with a `end-event-mapping-type-fallback` report entry) if the schema doesn't cover the key |
| `com.sap.bpm.wfs.ExclusiveGateway` | Branch: `n8n-nodes-base.switch` (typeVersion 3.2). Merge: `n8n-nodes-base.merge` (typeVersion 3.2). | Branch: `mode: 'rules'`, `rules.values[]` (one per non-default outflow), `options.fallbackOutput: 'extra'` if a `default` is set. Merge: `mode: 'append'` (plus `numberInputs: N` when inbound count > 2). Each inbound edge wires to a distinct input slot: first inbound → `index: 0`, second → `index: 1`, etc. | Merge detected by inbound ≥ 2, outbound = 1, no conditions on any flow. `append` mode concatenates items across inputs — correct for XOR (only one branch has items; the other is empty; passthrough) |
| `com.sap.bpm.wfs.ParallelGateway` | Split: **elided** — no n8n node; the predecessor's `main[0]` fans out to every downstream branch, which n8n's `executionOrder: 'v1'` runs off the same output port. Join: `n8n-nodes-base.merge` (typeVersion 3.2) as a pure sync point — semantically an AND-join, so it must fire downstream exactly ONCE after all branches complete. | Split has no parameters (no node). Join: `mode: 'chooseBranch'`, `chooseBranchMode: 'waitForAll'`, `output: 'empty'` (plus `numberInputs: N` when inbound count > 2). Each inbound edge wires to a distinct input slot (`index: 0`, `1`, …). | Distinguish by shape: split = ≤1 in / ≥2 out / no conditions; join = ≥2 in / 1 out / no conditions. **Do NOT use `mode: 'append'` for the join** — append concatenates items across inputs and fires downstream once per branch; that's the wrong semantics for an AND-join (BPMN AND-joins produce one token). `chooseBranch/waitForAll/output:empty` blocks until all branches arrive, then emits a single empty item — downstream nodes access branch data via `$('<BranchNode>').item.json.<X>`. Malformed shapes (e.g. ≥2 in AND ≥2 out) go to `report.json` under `parallel-gateway-shape` and are dropped. |
| `com.sap.bpm.wfs.ScriptTask` | `n8n-nodes-base.code` (typeVersion 2) | `mode: 'runOnceForEachItem', language: 'javaScript', jsCode` | See "ScriptTask body rewrites" below |
| `com.sap.bpm.wfs.ReferencedSubflow` | `n8n-nodes-base.executeWorkflow` (typeVersion 1.2) | `source: 'database', workflowId: {__rl, value: <identifier>, mode: 'id'}, mode: 'each', fields.values[]` from the mapping; `workflowInputs.schema[i].type` per-key from the caller's `interfaces.in` (see `scripts/schema.js`) | The `value` is the target process's `identifier` (not its n8n workflow id, which doesn't exist yet) — the LLM stage or the customer patches it after import. Per-field type falls back to `'string'` with a `subflow-input-type-fallback` report entry if the schema doesn't cover the key |
| `com.sap.bpm.wfs.ActionTask` | **Default** (`mcp-mapping.json` absent): `n8n-nodes-base.httpRequest` (typeVersion 4.2). **MCP path** (`mcp-mapping.json` present, action matched): `CUSTOM.sapMcpClient` (typeVersion 1). **MCP placeholder** (mapping file present, action not matched): `CUSTOM.sapMcpClient` with empty server descriptor + `mcp-no-match` report entry. | Default: `method, url, sendBody, contentType, specifyBody: 'keypair', bodyParameters.parameters[]`, `credentials.httpHeaderAuth.name`. MCP: `mcpServerName` (JSON-stringified server descriptor), `toolName`, `toolInputs.parameters[]` from translated mappings. | See "ActionTask resolution" and "MCP pre-mapping" below |
| `com.sap.bpm.wfs.MailTask` | `n8n-nodes-base.emailSend` (typeVersion 2.1) | `toEmail, subject, html, emailFormat: 'html', credentials.smtp.name` | Body fields go through `translateInterpolated` — `${context.X}` becomes an n8n expression |
| `com.sap.bpm.wfs.IntermediateCatchEvent` (with attached `TimerEventDefinition`) | `n8n-nodes-base.wait` (typeVersion 1.1) | **Relative wait:** `amount`, `unit` from ISO 8601 duration parse; `resume: 'timeInterval'`. **Absolute wait:** `dateTime` from the translated `timestamp` formula; `resume: 'specificTime'` | Only intermediate timers in v1. Boundary timers on tasks are deferred. A `timeDuration` property emits the relative form; a `timestamp` property emits the absolute (`specificTime`) form. **Supported `timeInterval` units: seconds, minutes, hours, days.** Years (`P1Y`) and months (`P1M`) have no equivalent n8n unit; the migrator converts them to days (1 year = 365 days, 1 month = 30 days) and emits a `timer-duration-approximate` report entry — prefer switching the node to `resume: 'specificTime'` with a Luxon-computed `dateTime` during authoring. See `references/node-property-mapping.md` §3 for both forms. |
| `com.sap.bpm.wfs.IntermediateCatchEvent` (with attached `MessageEventDefinition`) | `n8n-nodes-base.wait` (typeVersion 1.1) | `resume: 'webhook'`, `httpMethod: 'POST'`, `options: {}`, deterministic `webhookId` derived from the message identifier | Mid-flow webhook wait. Waits for an incoming HTTP POST with the message payload. Message schema captured in report for reference. |
| `com.sap.bpm.wfs.UserTask` (no `decisionOptions`) | `CUSTOM.sapTaskCenter` (typeVersion 1) | `action: 'sendApprovalTask'`, `subject` (JUEL-interpolated), `priority`, `description`, `taskDefinition.definitionName`, `recipients` / `recipientGroups` | Sends the task to SAP Task Center and waits for the assignee's response via webhook callback. `subject`, `recipientUsers`, and `recipientGroups` may contain `${context.*}` expressions that are JUEL-interpolated. Recipients come from the SBPA source, so the authoring pass must not prompt the user. Full node contract: `n8n-workflow` skill's `references/n8n-sap-task-center/n8n-sap-task-center.md`. |
| `com.sap.bpm.wfs.UserTask` (with `decisionOptions`) | `CUSTOM.sapTaskCenter` (typeVersion 1) **+ inline** `n8n-nodes-base.switch` (typeVersion 3.2) named `"<Task> Decision"` | Switch `mode: 'rules'`; each rule compares `$('<Task>').item.json.result.response` against `'approved'`/`'rejected'` (string-equals, case-insensitive). `_flowOrder` routes each outbound `SequenceFlow` to the matching output port. | The SAP Task Center node outputs `{ result: { response: 'approved'\|'rejected' } }` (decision option `id: 'approve'` → `'approved'`; `id: 'reject'` → `'rejected'`; other ids emit a `usertask-unknown-decision` report entry and use the raw value). Conditions on outbound `SequenceFlow`s follow the pattern `${usertasks.<taskId>.last.decision == "approve"}` — matched and translated directly; any other condition shape falls back to standard JUEL boolean-left rule. |
| `com.sap.bpm.wfs.RuleTask` | **Elided** — no substitute node emitted; a `rule-task-unsupported` report entry is added instead | | A RuleTask calls a Business Rules decision service. Its correct n8n target is the SAP AI Agent custom node (`CUSTOM.sapAgent`), which the converter does not yet support. The generic langchain agent is **not** an acceptable stand-in, so the task is left out of the graph (incoming edges collapse through to the successor) and reported for the LLM stage / customer to rebuild with `CUSTOM.sapAgent` after import |
| (Boundary timers) | *(not supported in v1)* | | Add a report entry and ask the user |

> **⚠️ ParallelGateway join — do NOT use `mode: 'append'`.** This is the most common wrong choice when authoring a join gateway by hand. A BPMN AND-join must produce exactly **one** downstream token after all branches complete. `mode: 'append'` concatenates items across inputs and fires downstream **once per branch** — wrong semantics. Always emit the join as `mode: 'chooseBranch'`, `chooseBranchMode: 'waitForAll'`, `output: 'empty'` (add `numberInputs: N` when inbound count > 2). Downstream nodes read branch data via `$('<BranchNode>').item.json.<X>`. (`mode: 'append'` *is* correct for the ExclusiveGateway merge, where only one branch carries items.)

## StartEvent trigger dispatch

The emitted n8n nodes for a `StartEvent` depend on two factors: the bound trigger type and whether
the process is referenced as a sub-workflow by another process.

### Standalone process (not called by any other process)

| Bound trigger | Emits | n8n node type |
|---|---|---|
| `trigger.api` | webhook (POST, path from trigger identifier) | `n8n-nodes-base.webhook` typeVersion 2 |
| `trigger.event` | SAP S/4HANA Event Trigger (manualTopic mode; customer sets broker topic post-import) | `CUSTOM.sapS4HanaEventTrigger` typeVersion 1 |
| `trigger.scheduled` | scheduleTrigger (no schedule config — customer sets cron post-import) | `n8n-nodes-base.scheduleTrigger` typeVersion 1.2 |
| Form trigger (`bpi.form` dep) | formTrigger (no form fields — customer configures post-import) | `n8n-nodes-base.formTrigger` typeVersion 1 |
| *(none)* | manualTrigger + `no-trigger-binding` report entry | `n8n-nodes-base.manualTrigger` typeVersion 1 |

### Subflow process (called as a sub-workflow by at least one other process)

Always emits **three nodes** (regardless of whether a standalone trigger also exists):

1. **`Execute Workflow Trigger`** (`n8n-nodes-base.executeWorkflowTrigger` typeVersion 1, `inputSource: 'passthrough'`) — required by n8n when the workflow is invoked via `executeWorkflow`. This is the primary registered trigger; outbound flows from the `StartEvent` connect through this path.
2. **`<StartEventName> (Standalone)`** — the same standalone trigger as above (webhook / scheduleTrigger / formTrigger / manualTrigger), named with the `(Standalone)` suffix. Allows independent execution without a caller. Connected to the normalize node below. Not connected to the rest of the flow directly.
3. **`<StartEventName>`** (Set node, `n8n-nodes-base.set` typeVersion 3.4) — a *normalize* node named exactly as the StartEvent's display name (so expressions like `$('StartEvent').item.json.field` still resolve). Parameters: `{ mode: 'raw', jsonOutput: '={{ Object.assign({}, $json.body ?? {}, $json) }}' }`. Merges `$json.body` (webhook path) with `$json` (sub-workflow / non-webhook path) into a single flat item — downstream nodes work identically regardless of which trigger fired.

Both trigger nodes connect → normalize node → first downstream node. `triggerIsWebhook` is always `false` for subflow processes (the normalize node handles the flatten step).

## Ancillary artifacts

| SBPA element | Emits | Notes |
|---|---|---|
| `com.sap.bpm.wfs.DataObject` (e.g. `custom`) or any `['custom'][...]` mapping key | Three injected `n8n-nodes-base.code` (typeVersion 2, `runOnceForAllItems`) nodes per custom-var-using process: **(1) "Initialize Custom Data"** — wired between trigger and first real node; seeds `$execution.customData` with StartEvent-declared defaults (only if key not already set), returns `[{ custom: $execution.customData.getAll() }]`. **(2) "Update Custom Data: \<NodeName\>"** — injected after each node whose `mappings.out` has `['custom']['<field>']` keys; translates the formula value via `formula.js` and calls `$execution.customData.set(field, value)`, returns `[]`. **(3) "Read Custom Data: \<NodeName\>"** — injected before each node that reads `context.custom.*` in its inputs/body/subject; returns `[{ custom: $execution.customData.getAll() }]` so downstream formulas resolve to `$('Read Custom Data: X').item.json.custom.<field>`. |
| `trigger.api` | Merged into the bound process's StartEvent as a webhook trigger | Not a separate node |
| `trigger.event` | Merged into the bound process's StartEvent as a **SAP S/4HANA Event Trigger** (`CUSTOM.sapS4HanaEventTrigger` typeVersion 1) | SBPA's event identifier (e.g. `salesOrderApprovalStatusChanged`) is not a structured broker topic path, so the node is emitted in `manualTopic: true` mode with the identifier pre-filled as `topic`. The customer replaces it with the full SAP Event Mesh topic (e.g. `sap/s4/beh/salesorder/v1/SalesOrder/Changed/v1`) or switches to `businessObject + operations` mode post-import. The event does not wrap its payload in `.body`, so `triggerIsWebhook` is `false` for this trigger type. UID stored with `$.` prefix in `triggerableArtifactUids` — normalised before lookup |
| `trigger.scheduled` | Merged into the bound process's StartEvent as a scheduleTrigger | No schedule config in the SBPA export — customer configures the cron rule after import. UID stored with `$.` prefix |
| Form trigger (via `bpi.form` dependency) | Merged into the bound process's StartEvent as a formTrigger | No dedicated trigger artifact. Detected when the process has a `bpi.form` dependency whose `header.uri` contains `"formtrigger"` AND the form is not referenced as a `UserTaskDefinition` inside the process graph. Form fields are not in the SBPA artifact — customer configures after import |
| `environment-variable` (destination) | Emitted as a stub in `credential-stubs.json` with type `httpHeaderAuth` | Never inline secrets. Referenced by name from the httpRequest node |

## Structural graph nodes (skipped)

`Model`, `SequenceFlow`, `Schemas`, `ProjectDefinition`, `ProcessDefinition`, `ActionGroupDefinition`, `EnvironmentVariableDefinition`, `MailDefinition`, `TimerEventDefinition`, `MessageEventDefinition`, `UserTaskDefinition` — these are internal wrappers or references. `graph.js` walks them but doesn't emit n8n nodes directly for them. `MessageEventDefinition` is resolved and handled by the `IntermediateCatchEvent` emitter. `UserTaskDefinition` is the form/schema descriptor referenced by `UserTask.executionArtifactRef`; it is resolved for type information but not emitted.

## ScriptTask body rewrites

SBPA ScriptTask bodies access process state via `$.context.<scope>.<field>`. The v1 rewrite (regex-based, syntactic) does three substitutions:

| SBPA pattern | n8n rewrite | When |
|---|---|---|
| `$.context.startEvent.<path>` | `$json.<path>` | Assumes the trigger's data is on the immediate predecessor's item — true when the ScriptTask sits right after the webhook |
| `$.context.custom.<path>` | `custom.<path>` | Local variable — the emitted body opens with `const custom = JSON.parse(JSON.stringify($json.custom || {}));` and closes with `return { ...$json, custom };` |
| `$.context.<otherNodeInnerId>.<path>` | `$('<otherNodeDisplayName>').item.json.<path>` | Cross-node reference |

Anything unmatched stays literal and produces a `script-task-rewrite` report entry.

## ActionTask resolution

Steps to build an httpRequest from an ActionTask:

1. Read `sbpaNode.actionIdentifier` (e.g. `"post_orders"`).
2. Find the actions module that contains it (walk `archive.actions[*].actions.operations` for a key starting with the identifier).
3. From that module's `metadata.json`, resolve `artifacts.action.<id>.skill.binding.rest.$ref` and walk the pointer to the `bindings.<id>.rest.transport` block → `{ operation, path, mimeType }`.
4. Read `sbpaNode.destination` and match it against `archive.destinations[<name>]`. If found: emit the `credentials.httpHeaderAuth.name` reference; the URL becomes `={{ $vars.<destName>_baseUrl }}<path>`.
5. Translate `sbpaNode.mappings.in` — each entry becomes one `bodyParameters.parameters[]` item with the translated formula as its value.

If any step fails, emit a placeholder and add the specific failure kind to the report:
`action-binding-missing`, `destination-missing`, or `formula-parse-failure`.
