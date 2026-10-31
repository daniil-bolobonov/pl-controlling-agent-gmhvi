# Pre-Step & Preflight

Covers obtaining the project archive (Pre-Step) and validating it (Preflight) before the converter runs.

---

## Pre-Step: Obtain the archive

Follow this priority order. **Move to the next step only if the current one fails.**

### 1. Check the solution for an existing archive

Before doing anything else, scan the solution directory for an existing archive:

- Look for `legacy/export.mtar` (deposited by the `initiate-migration` orchestrator).
- Look for any `.mtar` or `.zip` file under `legacy/`, the solution root, or any subdirectory.
- Look for an unpacked SBPA project directory (one containing `META-INF/mtad.yaml`).

If any of these exist → **use it and skip straight to *Archive validity*.**
Do not ask the user for a file. Do not call MCP. Just use what is already there.

### 2. Call MCP to list and download (Joule Studio only)

Only if step 1 found nothing: run the `initiate-migration` skill to detect the tenant type,
list available SAP Build Process Automation projects, pick the right version, and download the
MTAR. It deposits `legacy/export.mtar`, then routes back here.

> The full list → version → download flow lives in the `initiate-migration` skill
> (`references/orchestration.md`) — it is not duplicated here.

### 3. Ask the user to upload (last resort)

Only if step 2 is unavailable (standalone context — e.g. Claude Code, no `build_*` / MCP tools)
**or** the MCP call fails: ask the user to provide the SAP Build Process Automation project
export (`.mtar` or `.zip`) directly, then continue from *Archive validity*.

> **Never ask the user to upload if the archive already exists in the solution or can be
> obtained via MCP.**

---

## Archive validity

Verify these points **before** running the converter. Failing a check does not block migration
but determines how much manual work the LLM review stage will need.

- [ ] File ends in `.mtar` or `.zip`
- [ ] Archive contains `META-INF/mtad.yaml`
- [ ] At least one `artifact.json` with `"_class": "bpi.process"` exists

If `mtad.yaml` is missing the archive is not a valid SBPA export — stop and ask the user to
re-export from SAP Build Process Automation (Project → Export).

## Process graph completeness

- [ ] Every `ReferencedSubflow` target (`processRef` or `processIdentifier`) exists in the same archive.
  → If missing: the converter sets `workflowId: ""` and logs an `unresolved-subflow` entry in `report.json`. Inform the user.

- [ ] Root processes (those with a `trigger.*` entry) are correctly identified.
  → Processes without a trigger AND without any inbound `ReferencedSubflow` reference are orphans — confirm intent.

## DataObject fields

- [ ] All DataObject fields are of type `string`, `number`, or `boolean`.
  → Fields of type `object` or `array` cannot be stored in `$execution.customData`. Flag them as a gap; the data flow must be redesigned by the author.

## Trigger coverage

Check each root process trigger against `references/start-event-trigger.md`:

| Trigger type | Supported? | Notes |
|---|---|---|
| `trigger.api` | ✅ | → `n8n-nodes-base.webhook` |
| `trigger.event` | ✅ | → `CUSTOM.sapS4HanaEventTrigger` |
| `trigger.scheduled` | ✅ | → `n8n-nodes-base.scheduleTrigger` |
| form trigger | ✅ | → `n8n-nodes-base.formTrigger` |
| No trigger (sub-workflow) | ✅ | → `n8n-nodes-base.executeWorkflowTrigger` |

Any trigger type not in this table → add to report, ask user.

## Node type coverage

Check each `classDefinition` in the process graph against `references/activity-mapping.md`.

Supported: `StartEvent`, `EndEvent`, `ScriptTask`, `ActionTask`, `MailTask`, `ExclusiveGateway`, `ParallelGateway`, `ReferencedSubflow`, `UserTask`, `IntermediateCatchEvent` (Timer + Message).

Unknown `classDefinition` → add to report, **do not guess** an n8n node type, ask user.

## Expression coverage

- [ ] All formula values in `mappings.in` / `mappings.out` use constructs in `references/formula-grammar.md`
  → Unknown function names (anything not listed there) → log in report, set value to a `/* TODO */` comment.

- [ ] JUEL `${ }` conditions use only operators covered by `references/formula-grammar.md`
  → Unsupported JUEL patterns → log in report, preserve the original expression as a comment.

## Credentials

- [ ] All `bpi.environment` destination names are collected.
  → The converter emits `credential-stubs.json` with one stub per destination. Confirm the customer will fill these in before activating workflows.

## ScriptTask body complexity

Scan script bodies for:
- HTTP calls (`fetch`, `XMLHttpRequest`, `require('https')`) → blocked by the n8n Code node runtime; must be replaced with HTTP Request nodes.
- `require()` / `import` of third-party modules → not available in n8n Code nodes; must be replaced with built-in methods or dedicated n8n nodes.
