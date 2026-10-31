# Intent Analysis — n8n solution derived from a SAP Build Process Automation project

Treat the SAP Build Process Automation project as the **source of requirements**, not something
being ported. The goal is a fresh n8n solution that solves the **same business problem** the
process solves. When the IBD flow runs, the generated intent, PRD, and specification must be
framed around that business use case — **never title the intent or describe the solution as a
"migration"**. In the generated intent, PRD, specification, and solution, always write "SAP
Build Process Automation" in full (never the "SBPA" abbreviation) and never the word
"migration". The n8n workflow should precisely solve the same use case and use only n8n nodes
returned by the node-discovery tools (`search_nodes` / `list-supported-nodes`).

## Solution category

| Category | What gets built | Asset type |
|---|---|---|
| **n8n solution from a SAP Build Process Automation process** | One importable n8n workflow JSON per business process (seeded from `bpi.process`); `credential-stubs.json` stub; `report.json` gap list | `sbpa-to-n8n` |

## Decision flow

- User hands over a `.mtar` / `.zip` archive, an unpacked SBPA project directory, or asks to rebuild / port / convert an SBPA / SAP Build Process Automation project as an n8n solution → **run the sbpa-to-n8n skill** to derive the reference conversion.
- User asks only how the process works (no archive provided) → answer at a **business / process level only**. Describe what the process does and how it would be solved in n8n; do not expose implementation details, internal class names, node-mapping tables, or converter mechanics. Do not run the converter.
- User hands over a CAP or Joule Classic (v1) project → this is a different skill; do not use sbpa-to-n8n.

## Key questions to resolve before starting

**Never ask the user any of these.** In the `.mtar`-driven flow the archive is always present, so
treat the list below as a self-check that you answer yourself by reading the archive — then
proceed autonomously. Only fall back to asking if the archive is genuinely absent (i.e. the skill
was invoked with no project at all):

1. **Scope** — Cover all processes in the archive, or a named subset? Default to all `bpi.process`
   artifacts unless the user's original prompt named a subset.
2. **Sub-workflows** — Are the referenced sub-processes included in the same archive? Missing
   targets are logged in `report.json` with an empty workflow id; note them in the final summary.
3. **Credentials** — The customer fills in the `credential-stubs.json` stubs themselves; emit the stubs
   with guiding placeholder comments.
4. **Expressions** — Are there custom formula functions beyond `references/formula-grammar.md`? If
   so, record them in the report; do not block on them.

## Scope signals in the user prompt

| Signal | Interpretation |
|---|---|
| "cover everything", "all processes" | All `bpi.process` artifacts |
| Names a specific process | Cover only that process and its transitive sub-workflows |
| "move to n8n" / "port" / "convert" | All `bpi.process` artifacts |
| "understand what I have" | Preflight / inventory only; skip converter |
