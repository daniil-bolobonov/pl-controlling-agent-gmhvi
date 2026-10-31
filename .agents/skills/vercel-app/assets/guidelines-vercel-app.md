# Vercel/v0 Frontend App Guidelines

Technical constraints and patterns for building a frontend web app with the external Vercel v0 partner. Follow these throughout specification execution.

## Tech Stack

- Vercel v0 (external generation partner) — hosts the preview and provides the files
- Frontend web app (Next.js / React, stack chosen by v0 from the specification)
- Local execution only (no cloud deployment in this stage)

## Project Structure

- The v0 app lives in `assets/<asset-name>/`
- The `vercel-app` skill drives the partner gateway tools (`create_app`, `send_app_message`)
- v0-synced files land at the asset root (`assets/<asset-name>/app/...`, `assets/<asset-name>/package.json`, …)

## Key Constraints

- You MUST follow the `vercel-app` skill's execution instructions for generation and iteration
- Read the skill before writing any tasks to ensure correct patterns
- Always pin `partner="v0"` on every gateway call — this is a v0-only flow
- The app is spec-driven: `create_app`'s `prompt` is a short directive; the specification attached via `prd_files` is the source of truth (v0 caps the prompt at 1000 characters)
- v0 owns the source of truth — **NEVER** hand-edit v0-generated files with `write_file` / `update_file` / `execute_command`. Round-trip every change through `send_app_message` so the partner stays in sync (the only exception is a small post-processing patch v0 cannot do that the user explicitly asked for)
- One concrete change per `send_app_message` call, each message under 1000 characters — split larger changes into incremental sends
- Do not invent authentication, payments, or database integrations — v0 is UI-first; flag these as out-of-scope and suggest a follow-up integration step
- Never paste secrets, API keys, or PII into a v0 prompt — prompts are sent to an external provider
- No Git operations, no documentation/READMEs

## asset.yaml

Create `assets/<asset-name>/asset.yaml` via the `setup-solution` skill, conforming to the canonical `vercel-app` schema. It MUST look like this (replace placeholders):

```yaml
apiVersion: asset.sap/v1
kind: Asset
metadata:
  name: {{application-name}}
  version: 1.0.0
type: vercel-app
container:
  buildPath: .
  port: 5000
```

Pinned values for v0:

- `type: vercel-app` — required for the Joule Studio runtime deployer to route the asset
- `container.buildPath: .` — v0-synced files are placed at the asset directory root
- `container.port: 5000` — the port the v0 Next.js app listens on inside the container
- `metadata.name` — kebab-case, matches the directory name under `assets/`

If `setup-solution` produces a different shape (e.g. `buildPath: src`), correct it to match the pinned values above before proceeding.

## External Partner & File Sync

- v0 is an external partner that hosts the preview and provides the files. File sync runs in the background after each `create_app` / `send_app_message` call (best-effort)
- The natural key for every gateway call is `(solution_id, asset_path)` — the same shape every other artifact uses
- An asset with existing v0-synced files or a previously accepted generation request already has a v0 app — use `send_app_message` for it, never a second `create_app`. Missing files while generation is pending do not mean the app is absent.

## Validation

- After `create_app` or `send_app_message` accepts a request, report background generation and end the turn.
- Confirm the current generation's files are saved under `assets/<asset-name>/` before continuing changes when the user resumes. Preview availability is a separate state.
- Follow the execution reference for compatible-host completion notices.
- Verify functional changes by requesting them through `send_app_message` and confirming the synced result — not by editing files directly
- Implement all UI functionality described in the specification through the partner

## Integration with Other Assets

- If the app needs backend wiring (auth, DB, API, automation), flag it as a separate workstream — route backend logic to `cap` / `agent` / `n8n-workflow` assets and have the v0 app call them
- Keep the v0 app independently previewable and deployable as a `vercel-app` asset
