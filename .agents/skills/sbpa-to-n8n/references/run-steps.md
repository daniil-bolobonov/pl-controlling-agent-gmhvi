# Conversion steps — detailed per-stage instructions

**Runtime:** Node 20+ and a shell tool are required. Without either, fall back to a prose-only
walkthrough using the reference tables.

```bash
node scripts/migrate.js <path-to-mtar-or-project-dir> <out-dir>
```

Writes to `<out-dir>/`:
- `<processIdentifier>.workflow.json` — one per `bpi.process`, importable via n8n Editor UI or `POST /api/v1/workflows`.
- `credential-stubs.json` — one stub per `environment-variable` destination; the customer fills in secrets before use.
- `report.json` — everything the converter could not fully resolve. Written as `[]` when empty.

After the script runs, complete **every numbered step** below in order. Do not skip any step.

---

## Step 1 — Read the reference conversion (do NOT validate or fix it)

Read `<out-dir>/report.json` and `<out-dir>/<processIdentifier>.workflow.json`. Understand which
SBPA nodes mapped to which n8n types and which expressions were translated. **Do not run
`validate.js` on converter output. Do not patch or adopt it as the final solution** — it is
reference material only.

**Surface constraints early:** list every `report.json` gap and every known under-development /
unsupported construct (RuleTask → `CUSTOM.sapAgent`, boundary timers, `P1Y`/`P1M` timer
approximations, non-string custom variables) and carry them into the intent Fit Gap Analysis
(step 2) — which the PRD then references under its Risks, Assumptions & Dependencies (step 3) —
so the user is warned before the solution is authored.

## Step 2 — Write `assets/intent.md` (MANDATORY)

Write this file to the solution directory now. Use the template from the skill's `assets/intent.md`
and replace every `<placeholder>` with archive-derived content. Use `references/intent-analysis.md`
for framing guidance.

Author the intent **purely as a business use-case document**: describe the *purpose* of the
process — built from the business context captured in `references/intent-extraction.md` §1
(project name, process name + description, end-to-end process, business trigger & outcome, actors)
plus the process data and the script-converted n8n workflow — and how n8n solves the **same** use
case. Keep it business-facing: **do not expose technical node-mapping** (which source construct
becomes which n8n node), node type names, or internal class names — that detail belongs in
`specification.md` (step 4). Required sections:

- Title and one-line description (business use case framing — never "migration")
- Business challenge
- Business Goals & Success Criteria (table; derive metrics from the process scope)
- Key Milestones
- Business Architecture (RBA) (End-to-End Process, Process Hierarchy, Summary)
- Fit Gap Analysis (standard 9-column table: requirement → how n8n meets it (capability, not node type) → ORD-ID columns (always `—` in this autonomous flow) → gap? → notes)
- Recommendations (solution title, Executive Summary, Problem Statement, Affected User Roles,
  Important factors, Potential risks, Recommended solution category, Intent fit %)

## Step 3 — Write `assets/product-requirements-document.md` (MANDATORY)

Write immediately after step 2. The PRD follows the **standard Joule Studio PRD template in
fast-track mode** (Solution Category: `n8n Workflow`) — fill it autonomously from the archive and
use `—` for anything unknown. Keep it **business / stakeholder-facing**: express risks and
dependencies as business impact plus the action the customer must take. **Do not expose converter
mechanics** — no report-kind codes, converter script or file names, n8n node type names, or
field-casting detail; all of that belongs in `specification.md`. Replace
every placeholder with archive-derived content:

- Product Purpose & Value Proposition (Elevator Pitch, Business Need, Expected Value, prioritized Product Objectives)
- Solution Scope (list every `bpi.process`: name, type, trigger described in business terms, sub-workflows called)
- Must-Have Requirements (one or more per in-scope process; business-level, mapped to objectives)
- Required Credentials (one row per destination the solution connects to)
- Risks, Assumptions & Dependencies (reference the Fit Gap Analysis in `intent.md`; do not duplicate the gap table)
- Acceptance Criteria (business outcomes and thresholds for this project)

## Step 4 — Write `assets/specification.md` (MANDATORY)

Write immediately after step 3. The specification is the **technical specification of the
delivered n8n solution** — document how the built workflows work (per workflow asset, named
`assets/workflows/<workflow-name>`), not how any source process was converted. The reader is an
engineer who will run, maintain, and extend the solution, so centre it on the n8n workflows and
their behaviour — not the translation history or converter/report-kind mechanics. Replace every
placeholder:

- For each delivered workflow: purpose, trigger (in solution terms), a workflow-steps table
  (step → n8n node → what it does), credentials used, data flow & key expressions, post-import
  steps for the customer, and a brief notes-for-maintainers list (solution-completeness items only)
- Cross-cutting solution decisions table

**Do not proceed to step 5 until this file has been written.**

## Step 5 — Generate each n8n workflow JSON from scratch (authoritative solution)

Using the intent, PRD, and specification (steps 2–4) as requirements and the SBPA archive as the
source of truth for process logic, generate a new `<processIdentifier>.workflow.json` for each
`bpi.process`. **Do not copy, patch, or re-emit the converter output.** Select every node via
`search_nodes` / `list-supported-nodes`. Translate all mappings and conditions using
`references/formula-grammar.md`. Then run:

```bash
node scripts/validate.js <solution-dir>/<processIdentifier>.workflow.json
```

If validation fails, fix **your generated JSON** (not the converter output) so it satisfies n8n's
structural invariants (top-level `name`/`nodes`/`connections`/`settings`; each node has a unique
`name`, a `package.node` `type`, numeric `typeVersion`, `[x,y]` `position`, and object
`parameters`; connections reference existing node names) and re-run until validation passes.

## Step 6 — Solution setup

Follow the `n8n-workflow` skill's `references/setup-solution.md` to place the validated workflow
files and create `asset.yaml` and `solution.yaml`.

## Step 7 — User summary

Tell the user which workflow files were produced, what's in `credential-stubs.json` they need to
fill in, and summarise every report item — noting which were resolved and which the customer must
still act on. For any `subflow-id-placeholder` items, tell the customer that after importing all
workflows into n8n they must complete the following steps for each parent workflow:

1. Open the parent workflow in the n8n Editor.
2. Find every **Execute Workflow** step (the converter seeds the sub-process name as a placeholder;
   n8n assigns the real workflow ID only after import).
3. Select the imported sub-workflow with the matching workflow name from the dropdown.
4. Save the parent workflow.
5. Run a test execution to confirm the sub-workflow link resolves correctly.

## Step 8 — Topology diagram

Render an ASCII topology diagram for every emitted workflow following
`references/topology-diagram.md`, under a single `## n8n workflow topology` heading at the end of
your response.

---

## Non-negotiables

- **Never invent SBPA constructs.** If you see a `classDefinition` not covered by
  `references/activity-mapping.md`, add it to the report; do not guess a node type.
- **Never inline secrets.** Destinations and API keys become n8n credentials referenced by name;
  the workflow JSON must never contain a live URL or bearer token.
- **Preserve node names.** SBPA's `translations.units` block gives human-readable labels — use
  them for n8n's `name` field so the imported workflow is recognisable.
- **Two-pass sub-workflows.** `ReferencedSubflow` targets must be emitted first (they get their own
  workflow JSON), then the caller's `executeWorkflow` node references them. If the target
  `bpi.process` is missing, log it in the report and set the workflow id to `""` — do not fabricate.
- **Two expression grammars, not one.** Mappings (`mappings.in`/`mappings.out`) use the SBPA
  formula language. Everything in `${…}` (SequenceFlow conditions, mail fields) is Java JUEL. See
  `references/formula-grammar.md`; never route `${…}` through the formula parser or vice versa.
