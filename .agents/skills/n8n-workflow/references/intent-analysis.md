### Solution Category

| Category   | What gets built                                                                                   | Asset Type|
|------------|---------------------------------------------------------------------------------------------------|-----------|
| **n8n Workflow**           | n8n workflow written as a `.n8n.json` file                                        |`n8n-workflow`|

### Decision Flow

- Is there a clearly defined workflow (steps and routing known upfront), all AI involvement can be handled by a static LLM node, or the user explicitly calls out n8n as the orchestrator? → **n8n Workflow is required**
- Is there a clearly defined workflow AND at least one step requires open-ended reasoning, context retention, or dynamic tool use that a static node cannot reliably handle? → **Both n8n Workflow and an AI Agent are required**

### Asset Creation Defaults
#### Agent asset
 - **ASK WHEN APPLICABLE** — when the solution requires a workflow to call an agent (via SAP Agent node), ask the user whether this is a new agent in the current solution or an existing agent from another solution **if the original prompt does not make this explicit**. If the prompt clearly references an existing agent or clearly implies a new one, infer accordingly and skip the question.
 - If the user confirms a new agent: plan an AI Agent asset in this solution.
 - If the user confirms an existing agent: do NOT plan a new agent asset. Record the reference in the Fit Gap Notes.

**Fast Track exception for agent asset:**
 - In Fast Track mode, if the user did not explicitly specify whether the agent is new or existing, do **NOT** create an in-solution agent asset and do **NOT** hallucinate/fabricate agent ordId or name values.
 - Instead, configure the `CUSTOM.sapAgent` node with empty agent parameters: `"agentName": ""` and `"agents": "[]"`.
 - Add a `n8n-nodes-base.stickyNote` node directly above the SAP Agent node with this content: "⚠️ Agent not configured — select the target agent in this node before deploying the workflow."
 - This allows the user to select the target agent manually in the n8n editor after deployment.

#### MCP server asset
 - **Default: create a new MCP server asset** — when the workflow or agent in the same solution reads business data from SAP or a LOB system, include a new MCP server asset in the solution unless the user explicitly confirms that an existing external agent or integration already provides the required data access.
 - If coverage is unclear, ask the user rather than assuming no MCP server is needed.

### Node Availability Check and Selection (MANDATORY)

Run `list-supported-nodes` immediately on activation, in parallel with landscape investigation. Treat the returned list as the exclusive set of available nodes on this instance.

A **connected capability** is a function directly related to the same business step. For example, Microsoft Teams is connected to approval notifications when the user says their team discusses approvals in Teams. Teams-based document storage, or a different third-party service, is not connected by that statement.

Selection order for each requested capability:

1. For AI/LLM capabilities, use SAP AI Core nodes only. Never use OpenAI or Gemini nodes, even when explicitly requested.
2. If the user explicitly directs the workflow to use a supported third-party service for a capability, honor that choice only for the named capability.
3. Otherwise, if a supported SAP Node covers the capability, use it by default.
4. Otherwise, if relevant context names a supported third-party service and demonstrates current access or use, use it for a connected capability not covered by an SAP Node, or as a supplementary integration. A contextual mention alone does not displace the SAP default.
5. Otherwise, if the supported-node list contains an unmentioned third-party node for the capability, ask the blocking opt-in question and await the answer even in fast-track mode.
6. If no supported node exists, the user declines, or approval cannot be obtained, leave the capability unresolved and record it as `Gap: Yes`.

Documentation requirements:

- Record the contextual basis for a third-party selection in the Fit Gap Analysis notes.
- Before the user answers the blocking opt-in question, do not select, recommend, or write the third-party node into `intent.md`.
- Validate any user-specified alternative against the supported-node list and forbidden-node rules before using it.

Use this question pattern:

> No SAP node is available for `<capability>`. `<third-party integration>` is supported and would `<purpose>`. Should I use it, use another integration you specify, or leave `<capability>` unresolved?

#### Gotchas

- Availability in the supported-node list proves technical feasibility, not user eligibility. The user must name the service in a relevant directive or contextual statement, or approve it through the blocking opt-in.
- Fast-track mode does not make a third-party service eligible by itself. This n8n-specific gate overrides general fast-track instructions to skip questions or proceed without waiting.
- A contextual mention is not blanket authorization. Do not extend it to unrelated capabilities or infer access to other third-party services.
- Neutral n8n core nodes used for workflow infrastructure or logic, such as Webhook, Switch, Set, Merge, and Code, are not third-party nodes.
- The supported-node list and forbidden-node rules remain authoritative after user approval.

For each capability relevant to the user's request, check whether a supported node exists and record any gaps in `intent.md` using the Fit Gap Analysis table.

| Capability | What to look for | Sensible default if absent | Confirm with user? |
|---|---|---|---|
| Scheduled / time-based trigger | `scheduleTrigger`, `cron` | Use a webhook and note that an external scheduler must be configured | No |
| Email delivery | `microsoftOutlook` when returned by the supported-node list; use only when referenced or approved | No default; record as a gap | Only for an unmentioned supported option |
| Chat / messaging delivery | `microsoftTeams` when returned by the supported-node list; use only when referenced or approved | No default; record as a gap | Only for an unmentioned supported option |
| AI / LLM inference | SAP AI Core nodes only: `sapOrchestration` or `sapOrchestrationChatModel`; never OpenAI or Gemini nodes | No fallback; record as a gap | Yes |
| Webhook / manual trigger | `n8n-nodes-base.webhook` | Expected to be available on managed n8n | No |
| Human-in-the-loop / approval | `sapTaskCenter`; otherwise a supported HITL node the user referenced or approved | If `sapTaskCenter` is unavailable, no default; record as a gap | Only for an unmentioned supported option |

Never use a third-party node as a silent workaround. For other workarounds, default silently only when the user's stated business outcome is fully preserved.
If the workaround changes what the user gets, ask explicitly before proceeding.

For each affected capability, add a row to the Fit Gap Analysis table in `intent.md`:
- Use a business-readable requirement label (e.g. "Automated evening scheduling")
- Set Gap to Yes
- In the Notes column, state the workaround in one plain sentence, or state that the capability is unavailable and a decision is needed
- Do NOT add a separate technical section — the Fit Gap table is sufficient

### Clarifying Questions

1. Scan for all unresolved items from the prompt (vague thresholds e.g. "needs attention", missing scheduling details e.g. "every evening", missing context, unknown dependencies, data structure e.g. "structured response", approval owners).
2. **If required information is missing or unclear:** 
    - Ask follow-up questions when the missing detail would materially change the workflow structure or make the output incorrect. 
    - If the missing detail is structured, bounded, and a reasonable default exists, choose the default, state the assumption clearly, and continue. 
    - Do not fabricate routing logic or business rules.

Decision rule:
- If a workaround preserves the user's requested business outcome and does not introduce a third-party node, apply it by default and document it in the Fit Gap Analysis table.
- If a workaround changes the business outcome, user experience, delivery channel, or operational responsibility, stop and ask the user before proceeding.

### Common Solution Patterns for SAP System Interactions

| Business Need | Likely Solution | Category |
|---|---|---|
| Event-driven trigger → condition-based routing → automated actions with no open-ended reasoning | Webhook → IF/Switch node → SAP Task Center Node → Respond to Webhook | n8n Workflow |
| Event-driven trigger → read data from SAP system → agent analyses and returns structured response | Webhook → SAP MCP Client Node → SAP Agent Node → Respond to Webhook | n8n Workflow, MCP Server, AI Agent |
| Same as above + human approval required before write-back to SAP | Webhook → SAP MCP Client Node → SAP Agent Node → SAP Human-in-the-Loop Node → SAP MCP Client Node (write) | n8n Workflow, MCP Server, AI Agent |
| Event-driven trigger → agent reads business data via MCP, analyses and returns structured response → human approval via Task Center → respond to webhook | Webhook → SAP Agent Node (uses MCP server to get business data, analyses and returns structured response) → SAP Task Center Node (approval) → Respond to Webhook | n8n Workflow, MCP Server, AI Agent |

### Eliciting routing rules and configuration data

When to ask:
- Ask when the prompt describes routing that maps a known set of values to different actions or recipients — for example when terms such as "rules", "matrix", "policy", "routing", "lookup", "conditions", "thresholds", "assignments", "tiers", or "mappings" appear, or when the prompt describes a lookup table (e.g. company code → reviewer, amount → approval tier).

Ask once, concisely:

> "It looks like your workflow uses a routing policy or lookup table. To generate this correctly, I need: the field being evaluated, the possible values or ranges, and the action for each. You can paste a table, a list, or a short description."

Proceed only if:
- The user provides the data, or
- The user explicitly confirms they want placeholder values generated and will replace them after generation.

Fast-track exception:
- If the user's request contains "fast track" or "fast-track" (case-insensitive), skip the question.
- Translate any data already present in the prompt into a complete named constant block as far as possible.
- Use clearly marked placeholders (e.g. `"YOUR_VALUE_HERE": "YOUR_ACTION_HERE"`) only for values genuinely absent from the prompt.
- The "Structure user-provided configuration as a named constant block" rule (with its sticky-note requirement) defined in `execution.md` still applies.

### Eliciting error-handling behaviour for SAP custom nodes

The developer decides how each SAP custom node behaves when it fails. Elicit this intent here — before workflow generation — so the decision is captured in `intent.md` and the workflow is built with the correct error wiring from the start.

Applies to these SAP custom nodes, whenever any are part of the planned solution:
- SAP MCP Client (`CUSTOM.sapMcpClient`)
- SAP Agent (`CUSTOM.sapAgent`)
- SAP Task Center / Human-in-the-loop (`CUSTOM.sapTaskCenter`)
- SAP AI Core (`CUSTOM.sapOrchestration`)

When to ask:
- Ask **once per SAP custom node** the solution will contain. Keep each question short and tied to that node's business step (e.g. "If reading the GL account balance fails, what should happen?").
- If the prompt already states a failure behaviour for a node, record it and do not re-ask.

What to ask (per node) — three behaviours, mapped to the node's n8n `onError` property:

| Developer choice | n8n `onError` | Effect |
|---|---|---|
| Stop the workflow (default) | `stopWorkflow` | The run fails at this node. Use when a failure must halt everything. |
| Continue with the last data | `continueRegularOutput` | On failure the node passes its input through and the flow continues on the normal output. Use when the step is optional. |
| Continue on a separate error path | `continueErrorOutput` | The node gains a second output. Success items leave the first output; failed items leave the second (error) output for custom handling. |

Follow-up — only when the developer picks "Continue on a separate error path":
- Ask what the error path should do, and **present concrete suggestions as the options** rather than an open-ended question — most developers pick from a short list. Offer these, phrased for the node's business step:
  - **Send an email** — notify a person or team (e.g. "email the AP team")
  - **Send a message / chat notification** — e.g. Teams or Slack
  - **Create a ticket or task** for someone to fix the problem (SAP Task Center, or an SAP MCP Client write)
  - **Involve a human to fix the problem and resume** (SAP Task Center / human-in-the-loop)
  - **Just report the failure back to the caller** (respond with the error)
- Keep the suggestions grounded in what the instance can actually do: only offer a delivery channel (email, Teams, Slack) if the matching node passed the **Node Availability Check** above. If the user wants a channel that is a gap, record it as a gap in the Fit Gap table rather than promising it.
- Let the user name something not listed (open-ended is still allowed) — the list is a prompt, not a limit.
- If the developer does not name an action, record "respond with the error" — the generation phase wires the error output to a Respond node by default (see `execution.md` Rule 17).

Example question (one node):

> "If **creating the purchase order** fails, you chose to handle it on a separate error path. What should happen on that path? For example:
> • Send an email to the procurement team • Post a Teams/Slack message • Create a Task Center ticket for someone to fix it • Route it to a person to resolve and resume • Just return the error to the caller
> — or describe your own."

Record the decisions in `intent.md` under a dedicated subsection, so the PRD and specification phases carry them forward unchanged:

```markdown
### Error Handling (per SAP custom node)

| Node (business step) | On error | Error-path action |
|---|---|---|
| Read GL account balance (SAP MCP Client) | Continue on error path | Create a Task Center ticket for Finance |
| Classify invoice (SAP AI Core) | Stop the workflow | — |
```

Fast-track exception:
- If the user's request contains "fast track" or "fast-track" (case-insensitive), skip these questions entirely.
- Default every SAP custom node to `stopWorkflow` (the n8n default) and omit the Error Handling subsection — unless the prompt already states a failure behaviour, in which case record exactly what it states.
### Post-Decision Action

When the prompt describes a workflow that produces a decision result (e.g. an approval, a routing outcome, a condition branch), classify the prompt's intent **before** planning any post-decision nodes:

| Scenario | Signal in the prompt | Output node to use |
|---|---|---|
| SAP action required | Prompt says to record a decision, create/update a document, post a status, approve/reject in SAP, or trigger a downstream SAP process | `CUSTOM.sapMcpClient` — executes the actual SAP call |
| Shape/relay the outcome only | Prompt says to relay a decision back to the caller, format a response, or no SAP write is mentioned or implied | `n8n-nodes-base.set` to shape the response payload, then `respondToWebhook` |
| Ambiguous — SAP write is plausible but not stated | Prompt mentions an approval/decision but does not state what should happen in SAP afterward | Stop and ask: "Should this decision be recorded in SAP (e.g. update a status, post a result), or should the workflow just return the decision to the caller?" |
