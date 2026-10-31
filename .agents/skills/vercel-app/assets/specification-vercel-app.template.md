# Specification: {{asset-name}}

> **Guidelines**: Read [guidelines-vercel-app.md](../guidelines-vercel-app.md) before executing ANY tasks below. Follow all constraints described there throughout execution.

## Basic Setup

- [ ] Read the project input (`product-requirements-document.md`)
- [ ] Invoke the `vercel-app` skill from `assets/{{asset-name}}/` to scaffold the app with Vercel v0
- [ ] Confirm `assets/{{asset-name}}/asset.yaml` exists with `type: vercel-app` (created by `setup-solution`) before calling the partner
- [ ] Call `create_app` exactly once with `partner="v0"`, `asset_path="assets/{{asset-name}}"`, and `prd_files` set to the supported context files that exist:
  - `specification/{{asset-name}}/specification.md` — required, primary source of truth
  - API spec files under `specification/{{asset-name}}/api-specs/` (`.edmx`, `.xml`, `.json`, `.yaml`)
  - Example: `prd_files=["specification/{{asset-name}}/specification.md", "specification/{{asset-name}}/api-specs/supplier-invoices.json"]`

{{project-specific-tasks}}

- [ ] Confirm the current generation's files are saved under `assets/{{asset-name}}/` before continuing follow-up changes
- [ ] Round-trip every follow-up change through `send_app_message` (one concrete change per message, under 1000 characters) — never hand-edit the v0-generated files
