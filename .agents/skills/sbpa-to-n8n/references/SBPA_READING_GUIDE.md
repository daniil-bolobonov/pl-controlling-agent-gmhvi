# SBPA Project Reading Guide

Quick reference for understanding a SAP Build Process Automation project before deriving an n8n solution from it.

## Archive structure

An `.mtar` file is a ZIP archive. The relevant content lives inside it:

```
<name>.mtar
└── META-INF/
│   └── mtad.yaml          — module/resource manifest
└── <uid>/
    └── artifact.json      — one per bpi.process (and other types)
```

The `artifact.json` has a sibling `companion` object (in `unpack.js` parlance) whose
`artifact.model.contents` field holds the BPMN-like process graph.

## Key artifact types

| `_class` value | What it is |
|---|---|
| `bpi.process` | A runnable workflow process — the primary migration target |
| `bpi.environment` | Destination references (URL + credentials) |
| `bpi.action` | Reusable action definitions (consumed by ActionTask) |

Only `bpi.process` artifacts are converted to n8n workflows.

## Process graph concepts

The `model.contents` object is a flat map from UUID → node/flow descriptor.

| SBPA element | Description |
|---|---|
| `StartEvent` | Trigger (api, event, scheduled, form-trigger, or subflow entry) |
| `EndEvent` | Terminal; may carry output `mappings.out` |
| `SequenceFlow` | Directional edge; `condition` (JUEL `${ }`) for conditional routing |
| `ScriptTask` | Inline JS script; accesses process state via `$.context.*` |
| `ActionTask` | Calls a `bpi.action` (REST / OData call); `mappings.in/out` use formula language |
| `MailTask` | Sends email; `to`, `subject`, `html` fields use JUEL `${ }` interpolation |
| `ExclusiveGateway` | XOR split — exactly one outbound flow fires |
| `ParallelGateway` | AND-split / AND-join — all outbound flows fire / waits for all inbound |
| `ReferencedSubflow` | Calls another `bpi.process`; emits as `executeWorkflow` node |
| `UserTask` | Human approval via SAP Task Center |
| `IntermediateCatchEvent` | Wait state: `TimerEventDefinition` (pause) or `MessageEventDefinition` (event wait) |
| `DataObject` | Custom variable schema (declared type, default value) |

## Context path convention

SBPA scripts and formula expressions reference process data through a `$.context.<scope>` prefix:

| SBPA path | n8n equivalent |
|---|---|
| `$.context.startEvent.<field>` | `$('StartEvent').item.json.<field>` (webhook: `.body.<field>`) |
| `$.context.custom.<field>` | `$('Initialize Custom Data').item.json.custom.<field>` |
| `$.context.<nodeId>.<field>` | `$('<DisplayName>').item.json.<field>` |
| `output` (formula only) | `$json` |

## Trigger types

See `references/start-event-trigger.md` for the full trigger → n8n node mapping.

| Trigger style | How to spot it |
|---|---|
| API (webhook) | `trigger.api` present in StartEvent |
| Event (S/4HANA event) | `trigger.event` present |
| Scheduled | `trigger.scheduled` present |
| Form | `classDefinition` contains `FormDefinition` or form trigger marker |
| Subflow entry | No trigger; `isReferencedAsSubflow` is true |

## Destinations and credentials

`bpi.environment` entries map a logical name (e.g. `"S4HANA_SYSTEM"`) to a URL and
auth type. The converter emits a `credential-stubs.json` stub for each destination — the
customer fills in the real URL and credentials before activating the workflow.

**Never inline a destination URL or secret in the workflow JSON.**

## Expression languages — two grammars

SBPA uses two distinct expression grammars; never mix them:

| Where it appears | Grammar | Reference |
|---|---|---|
| `mappings.in[*].value` / `mappings.out[*].value` | SBPA formula | `references/formula-grammar.md` |
| `SequenceFlow.condition`, `MailTask.to/subject/html` | Java JUEL (`${ }`) | `references/formula-grammar.md` |
