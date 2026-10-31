# What I do

Provide correct, lean, idiomatic, testable guidance for CAP (Cloud Application Programming Model) Node.js
development — from project setup and CDS modeling through declarative annotations and custom
event handlers.

## Steps

### 1. MCP Server Exploration

**CRITICAL — You MUST complete this step before writing any code, models, or config.**

Always use the local cap-mcp server to:
- Search CAP documentation before guessing at APIs or annotations
- Read the effective CDS model of an existing project before adding or changing anything

Never use the local cap-mcp server as Fiori/SAPUI5 documentation. It contains useful information about
how CAP integrates with Fiori/SAPUI5 but is not a complete reference for those frameworks.

**Caveat on release notes and version tables:** MCP search results sourced from release notes or
version recommendation tables may be outdated because they reflect the state at the time of
publication. Always verify version-specific claims (for example, the recommended Node.js version)
against live sources such as `cds version`, `npm view`, or the current Getting Started page.

Always use the ui5-wcr Server to:
- Retrieve available UI components
- Search UI5 web component documentation before guessing at APIs

### 2. Project Initialization

When starting a new project, run `sh ./scripts/project-init.sh <name>` from the `assets/` directory. **Never** run it with bash as it will fail.

Rules:
- **Never** run `cds add sample` — it scaffolds a full demo app into the project.
- **Never** run `npm install` in the `app/react-ui` folder, only run it on root level as `app/react-ui` is a workspace.
- Use `cds add tiny-sample` only if the user explicitly wants a minimal starter model.
- Use `cds add <feature>` (e.g. `xsuaa`, `approuter`, `mta`) to add additional features incrementally and only when needed (e.g. when deployment is requested).

### 3. CDS Modeling

- **REQUIRED**: Before creating or modifying ANY `.cds` file, call `search_model`
- Reuse built-in aspects: `cuid`, `managed`, `temporal` from `@sap/cds/common`
- Use `Composition of many` for parent-child / document structures; `Association to` for references
- Use `localized String` for user-facing text that needs translation
- Naming: PascalCase for entities and types, camelCase for elements
- Define a `namespace` in `db/schema.cds` to avoid naming collisions between db and service layers
- Always expose db entities via projections in services — never expose db entities directly
- Expose only the elements clients actually need.
  Use a projection such as `{ *, calculatedField } excluding { internalField }` when trimming fields.
  Note: `excluding` only works when the wildcard selector `*` is present.
- Don't expose an entity just because it exists — shape the projection for the consumer: trim with `excluding`, add calculated fields or flattened associations (e.g. `author.name as author`), and restrict with `@restrict`; only reach for actions/functions when the shape can't be expressed declaratively
- Entities written to only internally don't belong in the public service; put them in an admin service if needed
- Avoid two projections in the same service pointing to the same underlying entity — CDS can't auto-redirect associations and will error; remove the redundant projection or use `@cds.redirection.target`
- Always use `sap.common.CodeList` entities for status, type, category, or any classifying field — **never** use plain `String enum` types
- Avoid naming custom CDS actions with names that overlap ApplicationService base class methods (resolve, reject, run, send, emit, read, etc.). These cause silent or confusing overrides at handler registration time. Prefer domain-prefixed names like closePIP, submitOrder, approveRequest.

### 4. Declarative First

Prefer annotations over custom handler code. Only write handlers when declarative options are insufficient.

| Validation / Concern | CAP feature |
|---|---|
| Input validation (format) | `@assert.format: '...'` |
| Input validation (range) | `@assert.range: [min, max]` |
| Input validation (enum) | `@assert.range enum { val1; val2; }` |
| Target entity existence check | `@assert.target` |
| Custom validation expression | `@assert: (case when ... then '...' end)` |
| Required field / parameter | `@mandatory` |
| Read-only entity | `@readonly` |
| Insert-only entity | `@insertonly` |
| Authorization | `@restrict` / `@requires` |
| Audit fields | `: managed` aspect |
| Computed values | Calculated elements: `total : Decimal = price * quantity;` |

> **Do not** use `@odata.draft.enabled` unless explicitly requested. Draft support is primarily
> intended for Fiori / SAPUI5 applications and often requires substantial custom handling in other
> UI frameworks, such as React.

### 5. File & Service Conventions

- Match `.cds` and `.js` file names exactly (e.g. `order-service.cds` + `order-service.js`) — CAP auto-discovers implementations by convention; no `@impl` annotation needed
- One service per `.cds` file — splitting services keeps convention-based matching clean
- Use `@restrict` with `where` conditions (e.g. `userID = $user`) for row-level access control; don't rely on application-level filtering
- **Use ES modules.** The scaffolded project sets `"type": "module"` in `package.json`; write handlers with `import`/`export`, not `require`. **Never** delete `"type": "module"` or "convert to CommonJS" to work around a `require` mistake — fix the import instead. CDS 10 test tooling is ESM-native (Chai 6 is ESM-only, and `cds test` wraps Node's built-in `node --test` runner); Jest still marks its ESM support as experimental and requires `--experimental-vm-modules`, so it's not the smoothest fit.

### 6. Custom Handlers

Only when declarative annotations are not sufficient, write an event handler. Use the appropriate phase:

- **before** — validate or normalize input before persistence.
- **on** — implement custom actions, functions, or fully custom request handling.
- **after** — enrich results or trigger follow-up side effects after processing.

Constraints and handlers can be combined. Even when writing a custom handler, keep declarative checks for anything CAP can enforce automatically instead of duplicating that logic in code.

When handlers are necessary:

- Call `search_docs` on cds-mcp for the API you're about to use
- Register with `srv.on`, `srv.before`, `srv.after` — use the correct phase
- Reject with `req.reject(code, message)` — never throw raw errors
- Use `req.error(code, message)` to collect multiple errors without aborting immediately; processing continues, and CAP returns all collected errors together at the end.
- Use explicit column lists in SELECT — never `SELECT *`
- Rely on CAP's intrinsic transaction handling — no manual transactions
- Minimize DB round-trips: combine checks into the query itself rather than SELECT + check + UPDATE
- Before writing any validation logic, check if it can be expressed declaratively

  ```js
  // ❌ two DB calls
  const row = await SELECT.one.from(Entity).where({ ID })
  if (row.status === 'locked') return req.reject(400, '...')
  await UPDATE(Entity, ID).with({ status: 'locked' })

  // ✅ one DB call
  const n = await UPDATE(Entity, ID)
    .where({ status: { '!=': 'locked' } })
    .with({ status: 'locked' })
  if (!n) return req.reject(409, 'Not found or already locked')
  ```

### 7. Sample Data

Generate data files with the CLI, never create them manually or invent UUIDs. Let the CLI own the keys and foreign keys (so associations and compositions line up reliably), then use AI to fill in meaningful domain content.

1. Generate CSVs with keys and foreign keys only: `cds add data --records <Amount> --keys-only`
   This fills only key columns (including the foreign keys backing associations and compositions), leaving all other columns empty. The CLI generates consistent UUIDs and FK references, so relationships resolve correctly and you never risk breaking them by hand.
2. Fill in the empty non-key columns with realistic, meaningful domain content. Keep the generated header row (column names) and the generated IDs and foreign-key references exactly as-is — never rename headers, and never edit or invent keys/FKs.
- **Gotcha**: `--keys-only` requires `--records`; without `--records` you get header-only CSVs regardless.
- **Gotcha**: if `--keys-only` is not recognized, the globally installed `@sap/cds-dk` is outdated — update it with `npm i -g @sap/cds-dk` and retry.

### 8. Write Tests

*CRITICAL — NEVER skip this step*. Immediately after adding any custom logic in event handlers. **Never** write tests for generic functionality the service provider already handles. Use the **Node.js native test runner** (`node --test`).
Follow these [testing guidelines](./references/write-tests.md)

### 9. Frontend

The react source code lives in `app/react-ui/` (an npm workspace), already scaffolded via `cds add react --into react-ui`. Vite builds it into `app/react-ui/dist/`. Static-serve folders are configured in `package.json`:

- During development, **do not** set `cds.[development].folders.app`. CAP serves the default `app/` folder, and `cds watch` automatically starts the Vite dev server for `app/react-ui/`. Joule Studio's preview appends `/react-ui/` to the URL — overriding `folders.app` for the development profile breaks that path.
- `cds.[production].folders.app = app/react-ui/dist` — CAP serves the built output in production.

`cds watch` activates the `development` profile by default; `cds-serve` (the default `npm start`) honors `NODE_ENV=production` to activate the `production` profile.

Follow specific react instructions under [react-frontend.md](./references/react-frontend.md).

**Rules (all frontends):**

- Implement **all** features from the PRD — never build a reduced UI
- Frontend API calls must use correct URLs matching the backend service paths

### 10. Validate and Start Application in Background

*CRITICAL — NEVER skip this step*.

1. `npm install` (wait for it to finish).
2. Run `npm run build` and make sure there are no errors.
3. Run `npm test`.
   - Confirm that `test_report.json` exists at the project root.
   - If the file is missing, the reporter pipeline did not complete. Fix the `test` script or the test code, then rerun `npm test` until the file is produced.
   - **Never** run `node --test` directly as a workaround.
4. Start `cds watch`:
   - **If the `start_background_task` tool is available**: invoke it with `task_id: "cds-watch"` and `command: "cds watch < /dev/null 2>&1 | tee /tmp/cds-watch.log"` (run from the project directory). The `< /dev/null` keeps `cds watch` alive in a non-interactive shell; `tee` mirrors output to a log file. Use `check_background_task` and `stop_background_task` with the same `task_id` to read its output or kill it.
   - **Otherwise**: run `(cds watch < /dev/null > /tmp/cds-watch.log 2>&1 &)` (this backgrounds the server so it keeps running).
5. Verify that the ui is correctly served as the main entry point and that all service endpoints used in the UI are reachable on the CAP service.
6. When pointing the user to the running app:
   - **If the `start_background_task` tool is available** (Joule Studio runtime): tell the user to open the app via Joule Studio's **Preview** function — do **not** mention `http://localhost:4004` (it isn't reachable from the user's browser).
   - **Otherwise** (local development): share the `http://localhost:4004` URL printed by `cds watch`.

## Don't

- Write handlers for things the generic service provider already handles
- Hardcode tenant IDs, system IDs, or credentials anywhere
- Put user-facing strings inline — use `_i18n/` bundles
- Run `cds add sample`
- Use `await` inside a synchronous `cds.on('served', ...)` callback
- Remove `"type": "module"` from `package.json` or rewrite ESM handlers as CommonJS to sidestep a `require`/`import` error — fix the import instead
