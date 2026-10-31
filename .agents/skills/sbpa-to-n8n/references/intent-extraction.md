# Intent Extraction — Reading the SAP Build Process Automation Archive

Run these extractions before or immediately after unpacking the archive. They feed the preflight
check, the intent, the PRD, and the authoring pass.

## 1. Business context (purpose of the solution)

Before the technical inventory, capture *why* the process exists — this is the material the intent
and PRD are built from. Read it from the archive; do not guess:

- **Project name** — from the archive manifest (`mtad.yaml` / `META-INF/MANIFEST.MF`). Names the
  overall business capability.
- **Process name + description** — each `bpi.process` artifact's `displayName` and its
  `description` / documentation field. The description is the single best source of the business
  purpose — capture its intent, don't paraphrase it into node mechanics.
- **End-to-end business process** — infer the governed process the automation belongs to (e.g.
  "Order to Cash", "Source to Pay") from the names, destinations, and process data.
- **Business trigger & outcome** — in plain terms, what starts the process (a customer order
  arrives, an invoice is created, a nightly schedule) and what it delivers when it completes
  (order posted, approval recorded, customer notified).
- **Actors / roles** — who initiates, approves, or receives output (from UserTask assignees,
  approvers, mail recipients).

Record this as a short business summary. It feeds the intent's Business challenge, Business Goals,
Business Architecture (End-to-End Process / Process Hierarchy / Summary) and the PRD scope — never
as node-mapping detail.

## 2. Process inventory

List every `bpi.process` artifact from `artifact.json` files in the archive:

```
<uid>  <processIdentifier>  <displayName>
```

Mark each as:
- **Root process** — has a `trigger.*` entry in its StartEvent
- **Sub-workflow** — no trigger; referenced via `ReferencedSubflow` from another process

Call the converter to generate the inventory automatically:
```bash
node scripts/migrate.js <mtar-path> <out-dir>
```
The emitted `report.json` contains a per-process summary.

## 3. Dependency graph

For each process, list which other processes it calls via `ReferencedSubflow`. Build a simple
caller → callee tree. Sub-workflows must be emitted first (two-pass rule).

If a referenced process is missing from the archive, note it — the converter will set
`workflowId: ""` and log it in `report.json`.

## 4. Variable catalog (DataObject fields)

From each `bpi.process` that has `DataObject` nodes, extract:

| Field name | Declared type | Has default? |
|---|---|---|
| `customerId` | `string` | Yes |
| `orderTotal` | `number` | No |

Fields of type `object` or `array` **cannot** be stored in `$execution.customData` (string-only,
max 255 chars). Flag these as a gap; the converter skips the field and the data flow must be
redesigned by the author. Do **not** prescribe a specific workaround — proposing pseudo-solutions
here leads to fruitless cycles.

## 5. Destination catalog

From `bpi.environment` artifacts, list:

| Logical name | Auth type | Used by (process) |
|---|---|---|
| `S4HANA_SYSTEM` | `OAuth2` | `OrderProcess` |

Each destination becomes a credentials stub in `credential-stubs.json`. The customer must supply
the real URL and credentials before activating the workflow in n8n.

## 6. Trigger summary

For each root process, record the trigger type (see `references/start-event-trigger.md`):

| Process | Trigger | Notes |
|---|---|---|
| `OrderProcess` | `trigger.api` (webhook) | Payload at `$json.body.*` |
| `NightlyReport` | `trigger.scheduled` | Cron expression |
| `InvoiceApproval` | `trigger.event` | S/4HANA event topic |

## 7. Expression complexity markers

Scan mappings for:
- Custom formula functions not in `references/formula-grammar.md` → flag for manual review
- JUEL expressions with complex Java EL patterns → flag for `juel.js` coverage check
- `$.context.<nodeId>` paths to nodes other than `startEvent` or `custom` → cross-node refs, ensure target node is emitted
