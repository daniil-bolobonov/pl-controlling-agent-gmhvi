---
name: initiate-migration
description: >
  Use this skill when the user wants to migrate a Joule Studio Classic (V1) or SAP Build
  Process Automation project to Joule Studio 2.0. Activates for: "migrate my V1 project",
  "migrate from SBPA", "migrate Joule Classic", "I want to migrate my agent", "migrate my
  process automation", "export my V1 project", "initiate a migration", "start migration",
  "migrate a build project". Orchestrates V1 project discovery, version selection, MTAR
  download, and hands off to joule-classic-to-intent (AI agents) or sbpa-to-n8n (process
  automation). Does NOT analyze business intent from scratch — use intent-analysis for that.
  Does NOT convert the MTAR — downstream skills do that.
metadata:
  version: "1.0.0"
  author: sap-joule-studio
---

# Initiating a Project Migration

This skill is the entry point for migrating Joule Studio Classic (V1) and SAP Build Process
Automation projects to Joule Studio 2.0. It discovers available projects from the
connected SBPA tenant, guides the user to select a project and version, downloads the
project archive (MTAR), and hands off to the appropriate downstream migration skill.

## When to Use This Skill

- User wants to migrate a Joule Classic agent to Joule Studio 2.0
- User wants to migrate an SBPA process automation project
- User says "migrate", "export V1 project", "initiate migration", "start migration"
- `migration-source/export.mtar` already exists in the solution root — call `build_list_supported_project_types`, determine `migrationContext.projectType` from the MTAR filename or ask the user if the type cannot be inferred, then proceed directly to Step 5 (Route to Downstream Skill)

## Prerequisites

- A solution root must exist (directory containing `solution.yaml`), or the `migration-source/` directory must be writable

## Inputs

- None required. The skill discovers available projects interactively.
- Optional: user may state project type upfront (Joule Classic or SBPA), or provide a project name to skip discovery.

## Output

- `migration-source/export.mtar` written to the solution root (or current working directory if no solution root found)
- Downstream migration skill invoked with the MTAR path

## Workflow

### Step 1: Capture Migration Intent

Call `build_list_supported_project_types` (no arguments) first to determine which project types are available for migration in this tenant. Record the result as `supportedTypes`.

Ask the user what they want to migrate using the `question` tool:

> "What type of project do you want to migrate?"

Options — include only types where `available: true` in `supportedTypes`, plus "Not sure":
- `joule-classic` — Joule Classic edition agent (produces intent.md via joule-classic-to-intent) — show only if `com.sap.project.ai` is available
- `sbpa` — SAP Build Process Automation project (produces n8n workflow via sbpa-to-n8n) — show only if `com.sap.project.spa` is available
- `unknown` — Not sure — show me my available projects

Record the answer as `migrationContext.projectType`. `migrationContext` is an in-session working object — it is not written to disk, only held in the agent's context for the duration of this skill run. Proceed to Step 2.

### Step 2: List Projects, Verify Connectivity, and Select Version

If `migrationContext.projectType` is set to `joule-classic` or `sbpa` (not `unknown`), call `build_list_projects` with the corresponding `projectType` filter (`com.sap.project.ai` or `com.sap.project.spa`). If `unknown`, call without a filter to show all projects.

**On failure:** Inform the user:

> "Could not connect to your SBPA tenant. The SAP Build Process Automation formation may not be set up correctly for your BTP subaccount. Contact your BTP administrator to verify the formation is active."

Then **STOP** — do not proceed.

**On success:** The response includes each project's `versions` array. Display projects as a numbered list (continue numbering across pages):

```
#  | Name                    | Versions
---|-------------------------|---------------------
1  | Risk Management Agent   | 2.1.0, Editable
2  | Invoice Approval Flow   | 1.3.0
```

If `migrationContext.projectType` was `unknown`, include a `Type` column using the display name (e.g. `Joule Classic`, `Process Automation`) — not the internal type string (`com.sap.project.ai`).

**If the first page is empty** (no projects returned at all): Inform the user:

> "No applicable projects found in your SBPA tenant. You may not have access to any projects, or none exist yet."

Then **STOP** — do not proceed.

**Pagination:** If the response contains `"hasMore": true`, include a "Load more projects" option in the `question` tool alongside the numbered project choices. If the user selects it, call `build_list_projects` again with `skip: resSkip + resTop` (i.e., the `skip` and `top` values returned in the previous response) and append the new projects to the list, continuing the numbering. Repeat until `hasMore` is false or the user selects a project.

Use the `question` tool to ask the user to select a project by number. Record `migrationContext.projectId` and `migrationContext.projectType` using the selected project's internal `type` field (e.g., `com.sap.project.ai` for Joule Classic — not the display name).

If `migrationContext.projectType` was `unknown` in Step 1, update it now based on the selected project's type field:
- `com.sap.project.ai` → `joule-classic`
- `com.sap.project.spa` → `sbpa`
- Any other type → `unsupported` (see Gotchas)

### Step 3: Confirm Version Selection

The `versions` array for the selected project is already in the Step 2 response — no additional MCP call needed.

Display the versions and recommend the latest non-`Editable` version if one exists; otherwise recommend `Editable` (that entry is present only when the project is editable). Note the recommendation inline.

Use the `question` tool to ask the user to confirm the version. Record `migrationContext.version` as the exact string from the versions array.

### Step 4: Download MTAR

Determine `outputRoot` as follows:
1. Search for `solution.yaml` in the current directory and then parent directories, up to 3 levels up.
2. If found, set `outputRoot` to that directory.
3. Otherwise, set `outputRoot` to the current working directory.

Call `build_download_project_version` with:
- `projectId`: `migrationContext.projectId`
- `version`: `migrationContext.version` (pass the string exactly as it appears in the versions array, e.g. `"Editable"` for the live working copy — the server matches it case-insensitively)

The tool returns the MTAR as **base64 text in the tool result** — it does not write a file. Use a CLI command to decode and write it to `${outputRoot}/migration-source/export.mtar`:

```bash
mkdir -p "${outputRoot}/migration-source"
printf '%s' "<base64-from-build_download_project_version-result>" | base64 -d > "${outputRoot}/migration-source/export.mtar"
```

For large archives, do not pass the base64 as a huge inline argument. Write the base64 to a temp file first, then decode:

```bash
mkdir -p "${outputRoot}/migration-source"
# write the tool-result base64 to "${outputRoot}/migration-source/export.mtar.b64" (one write step)
base64 -d "${outputRoot}/migration-source/export.mtar.b64" > "${outputRoot}/migration-source/export.mtar"
rm -f "${outputRoot}/migration-source/export.mtar.b64"
```

**On success:** Confirm to the user in one line:
> "Project version downloaded to `migration-source/export.mtar`."

**On failure:** Report the error message and **STOP**. Do not attempt to retry automatically.

### Step 5: Route to Downstream Skill

Use the `supportedTypes` result already fetched in Step 1. Use `migrationContext.projectType` to find the matching entry, then:

- If `available: true` — invoke the skill named in `migrationSkill`. The MTAR is at `migration-source/export.mtar`.
  - `joule-classic-to-intent`: > "Handing off to joule-classic-to-intent to extract agent intent from the MTAR."
  - `sbpa-to-n8n`: > "Handing off to sbpa-to-n8n to convert the process automation project."

- If `available: false`, or the type is not in the returned list:
  - Inform the user and **STOP**:
    > "Project type `<type>` is not yet supported for automated migration. The MTAR has been downloaded to `migration-source/export.mtar`. You can proceed manually."

## Tools

- `build_list_projects` (from `ibd-mcp-server`): lists projects with their versions array; `projectType` filter optional; `skip` and `top` control pagination; response includes `hasMore`, `top`, and `skip` fields
- `build_download_project_version` (from `ibd-mcp-server`): exports and polls until ready, then returns the project archive as base64 text in the tool result
- `build_list_supported_project_types` (from `ibd-mcp-server`): returns project types present in the tenant with `migrationSkill` and `available` annotations; call at Step 1 and reuse result at Step 5
- `question` tool: present choices and confirmations to the user at each gate

## Guardrails

### Communication Guidelines
- Use the `question` tool for all user choices and confirmation gates — do not ask via prose.
- Inform the user before and after each MCP tool call (one line each).
- Never reproduce the full project list in prose after the user selects — confirm in one line.
- Keep communication professional and text-based (no emoji).

### Safety Guardrails
- Do not create directories outside the solution root or current working directory.
- Do not retry `build_download_project_version` automatically on failure — report and stop.
- Do not proceed past Step 2 if `build_list_projects` fails.

### Scope Guardrails
- This skill only orchestrates discovery and download. Do not attempt MTAR conversion inline.
- Do not invoke `intent-analysis` — migration has a different entry point.
- Do not skip the version confirmation gate (Step 3) even in fast-track mode.

## Gotchas

- `build_download_project_version` handles export + polling internally. Do NOT call separate export, poll, or download tools — they don't exist in the `ibd-mcp-server` surface.
- The tool returns base64 text **in the tool result**, not a file. Use a CLI command to decode it (`base64 -d > migration-source/export.mtar`). Do not pass a `targetPath` argument (it does not exist). For large archives, write the base64 to a temp file first, then decode, to avoid a huge inline shell argument.
- For the "Editable" version (live working copy), pass the string `"Editable"` exactly as it appears in the project's versions array. The server matches it case-insensitively.
- `build_list_projects` already returns the `versions` array per project. Do NOT call a separate get-versions tool.
- `build_list_projects` pagination: to load the next page use `skip: resSkip + resTop` where `resSkip` and `resTop` are the `skip` and `top` values from the previous response. Do not reuse the default `skip=0` for subsequent pages.
- `build_list_projects` failure = SBPA connectivity failure. There is no separate connectivity check tool. The error message from the tool is sufficient to report; do not speculate about the cause beyond what the tool returns.
- `build_list_supported_project_types` is called once in Step 1 and its result reused in Step 5 — do not call it again.
- `build_list_supported_project_types` derives available types from the actual tenant — only types with projects in the tenant are returned. It does NOT return types that have no projects yet, even if they are theoretically supported.
- Never reproduce, paraphrase, or summarise a file you just wrote — confirm in one line and move on.
- If `migration-source/export.mtar` already exists in the solution root, call `build_list_supported_project_types`, set `migrationContext.projectType` (ask the user if it cannot be inferred), then invoke the downstream skill directly.

## Related Skills

- `joule-classic-to-intent`: invoked after this skill for Joule Classic AI agent projects
- `sbpa-to-n8n`: invoked after this skill for SBPA process automation projects
- `intent-analysis`: the separate entry point for greenfield intent capture (not for migration)

## Next Steps

After handing off to the downstream skill, the migration continues with:
`joule-classic-to-intent` → `product-requirements-document` → `specification` → implementation
