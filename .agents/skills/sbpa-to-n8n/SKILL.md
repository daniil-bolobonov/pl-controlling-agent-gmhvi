---
name: sbpa-to-n8n
description: >
  Build an n8n solution from a SAP Build Process Automation (.mtar/.zip) archive. Triggers on
  "convert/port/move SAP Build Process Automation to n8n" requests, or when initiate-migration
  deposits legacy/export.mtar. Emits one workflow JSON per bpi.process, credential-stubs.json,
  and report.json. Not for SAP CAP or Joule Classic (v1).
compatibility: jl >= 1.0.0
license: MIT
metadata:
  version: "1.0.0"
  author: sap-joule-studio
---

# Build an n8n solution from an SBPA project

Treat the SBPA archive as the **source of requirements**: build a fresh n8n solution that solves
the same business problem. The converter produces a reference mapping; you author the authoritative
workflows from scratch.

## Framing rules (apply throughout)

- **Never frame the work as a "migration".** In the generated intent, PRD, specification, and
  solution, write "SAP Build Process Automation" in full (never "SBPA" abbreviation) and never
  the word "migration"; frame everything around the **business use case** the process solves.
  (Using "SBPA" / "migration" in code, file names, and this skill's internal references is fine.)
- **Use only looked-up nodes.** Every n8n node must come from `search_nodes` /
  `list-supported-nodes` — never invent a node from general n8n knowledge.
- **Run autonomously — never ask the user mid-flow.** The archive contains everything needed;
  resolve every open question by reading it and proceed end-to-end. Surface gaps in the final
  summary only.

## Sequence

Run in order; each stage feeds the next. Read the referenced file for each stage — this list is
not a substitute for the reference content.

1. **Pre-Step — Obtain the archive.** `references/preflight.md` (priority: existing file → `initiate-migration` MCP → ask user).
2. **Preflight — Validate the archive.** `references/preflight.md` (*Archive validity* onward).
3. **Inventory — Read the archive.** `references/intent-extraction.md` — build the process inventory and dependency graph.
4. **Convert — Run the converter.** `node scripts/migrate.js <archive> <out-dir>`
5. **Write lifecycle docs + generate workflows (MANDATORY — do not skip or defer).** Follow `references/run-steps.md` steps 1–5 in order — each is individually mandatory.
6. **Setup + report.** Follow `references/run-steps.md` steps 6–8.

**Done criteria:** `node scripts/validate.js` passes on every generated workflow JSON; `assets/intent.md`, `assets/product-requirements-document.md`, and `assets/specification.md` written with real content; every `report.json` item resolved or surfaced; no live URLs or bearer tokens in any workflow JSON.

## References

Read condition in the second column is binding. "Always, before …" entries are hard pre-write
gates — read them before authoring the relevant node, not "if needed".

| Reference | Read when |
|---|---|
| `references/intent-analysis.md` | **Always, at the start of every session** — decide whether to run the converter or answer informationally. |
| `references/preflight.md` | **Always, first** — Pre-Step (obtain archive) and Preflight checks. |
| `references/intent-extraction.md` | **Always, immediately after unpacking** — process inventory and dependency graph. |
| `references/run-steps.md` | **Always, before step 5** — detailed per-stage instructions and non-negotiables. |
| `references/activity-mapping.md` | **Always, before mapping any `classDefinition`** — authoritative node-type mapping. |
| `references/node-property-mapping.md` | **Always, before writing a node's parameters** — per-activity parameter detail, typeVersions, edge cases. |
| `references/formula-grammar.md` | **Always, before translating any expression** — JUEL vs mapping formula decision gate. |
| `references/start-event-trigger.md` | **Always, before picking a `StartEvent` trigger node.** |
| `references/custom-variables.md` | When the process has ≥1 `DataObject` node. |
| `references/SBPA_READING_GUIDE.md` | To locate an artifact type, understand node structure, or decode an SBPA concept. |
| `references/mtar-layout.md` | To understand the archive's file/folder structure. |
| `references/topology-diagram.md` | When rendering the workflow topology diagram. |
| `references/user-validation.md` | After the solution is built — post-build validation guide. |
| `n8n-workflow` skill's `references/setup-solution.md` | When setting up asset.yaml and solution.yaml. |
| `n8n-workflow` skill's `references/n8n-sap-task-center/n8n-sap-task-center.md` | When authoring UserTask → SAP Task Center (`CUSTOM.sapTaskCenter`) nodes. |
| `n8n-workflow` skill's `references/n8n-expressions/n8n-expressions.md` | When authoring timer/date nodes — Luxon date-math patterns. |
| `assets/intent.md` | Intent template for this skill's stage. |
| `assets/product-requirements-document.md` | PRD template for this skill's stage. |
| `assets/specification.md` | Specification template for per-process technical decisions. |
