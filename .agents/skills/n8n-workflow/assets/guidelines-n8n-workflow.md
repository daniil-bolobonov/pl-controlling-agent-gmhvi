# n8n Workflow Guidelines

Technical constraints and patterns for building n8n workflow automations. Follow these throughout specification execution.

## Key Constraints

- If the solution also requires a CAP application, create CAP FIRST before any n8n workflow
- **NEVER** answer with the n8n URL in the message
- **NEVER** add a `"credentials"` block to any node in the workflow JSON. Credential blocks embed IDs and names that are instance-specific and will cause import errors on any other n8n instance.

## Third-Party Nodes

Third-party nodes are nodes that are neither built-in n8n nodes (`n8n-nodes-base.*`) nor SAP custom nodes (`CUSTOM.*`).

Always call `search-nodes-catalog` before using or suggesting a third-party node. Then:
- If the user explicitly requests a third-party node and the catalog returns it, use it without asking for confirmation.
- If the user explicitly requests a third-party node and the catalog does not return it, search again for alternative nodes that can fulfill the same purpose. If alternatives are found, ask the user which one to use before proceeding.
- If the user does not specify a third-party node and the catalog returns exactly one match, use it without asking.
- If the user does not specify a third-party node and the catalog returns multiple matches, ask the user which one to use before proceeding.
- Do not suggest any third-party node that is not returned by the catalog, including as a workaround.

## Workflow Structure

- Each workflow gets its own folder under `assets/workflows/`: `assets/workflows/<workflow-name>/`
- `sourceRoot` in `asset.yaml` MUST be `.` (the schema default) — never `workflows` or any other path
- Each workflow is a single `*.n8n.json` file
- Validate JSON is well-formed after creation

## Specification Checklist

When executing a specification for an n8n workflow asset, complete the following tasks:

- [ ] Ensure that each workflow gets its own asset folder under `assets/workflows/<workflow-name>/`.
- [ ] Ensure the asset type is `n8nworkflow` declared inside `metadata.type`. Do not derive the type from naming conventions. **Unlike other asset types, n8n assets MUST NOT have a top-level `type:` field**
- [ ] Ensure `connections` in JSON reference nodes by `name`, not `id`
- [ ] **If the solution contains an agent that should invoke this workflow**: complete the MANDATORY-when-applicable section in `skills/n8n-workflow/references/execution.md` (Steps A–F) — create the mcp-server translation card, update `solution.yaml`, and add a `requires` entry plus system prompt instruction to every agent asset that should call this workflow. This task must be ticked regardless of which skill (agent or n8n) ran first.
- [ ] **For every SAP custom node** (`CUSTOM.sapMcpClient`, `CUSTOM.sapAgent`, `CUSTOM.sapTaskCenter`, `CUSTOM.sapOrchestration`): set the node's `onError` from the Error Handling decision in `intent.md`, and wire any `continueErrorOutput` error output to a caller-contract node (default: a Respond node returning the error). See `execution.md` Rule 17. Fast-track solutions have no such decision — leave nodes at the `stopWorkflow` default.
- [ ] Validate all workflow and asset.yaml files with the `validate-n8n-workflow` mcp tool. 
