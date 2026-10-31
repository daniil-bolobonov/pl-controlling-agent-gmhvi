# SBPA archive layout

SAP Build Process Automation ships projects as `.mtar` files — Multi-Target Application archives, which are plain ZIPs with a specific top-level structure. When you receive one, unzip it and expect this tree:

```
<project-name>.mtar / .zip                (outer archive; a ZIP)
├── META-INF/
│   ├── MANIFEST.MF                       Jar-style manifest listing modules
│   └── mtad.yaml                         Module inventory + project type
├── lobby/
│   └── lobby_project.json                Project metadata (name, dependencies, state)
└── <module-id>/                          One directory per module in mtad.yaml
    └── content.zip                       Inner ZIP with the actual artifacts
```

## What's a "module"?

Two module types appear in v1's scope:

- **`com.sap.project.spa`** — the process module. Contains `bpi.process`, `trigger.api`, `environment-variable` artifacts.
- **`com.sap.project.actions`** — the actions module. Contains `open_api_spec.json`, `actions.json`, `metadata.json`. Referenced by the process module through `packageDependencies`.

`mtad.yaml` lists them in order:

```yaml
modules:
- path: "<module-id>/content.zip"
  name: "<module-id>"
  parameters:
    projectType: "com.sap.project.spa"     # or com.sap.project.actions
```

Note: the on-disk directory sometimes carries a version suffix (`..._1.0.0/`) while `mtad.yaml`'s `path:` uses the un-suffixed name. `unpack.js` prefix-matches to reconcile.

**Declared-but-not-bundled modules.** `mtad.yaml` can list modules that aren't shipped inside the archive — typically external action packs from the SBPA `ap_store`, referenced from a process module's `deployed-after` clause. Their content resolves at deploy time on the SBPA tenant, so no `content.zip` is present. `unpack.js` doesn't fail; it records each such entry in `missingModules[]` and marks the module in `modules[]` with `missing: true` / `root: null`. `migrate.js` turns each into a `module-missing` entry in `report.json` so the LLM review stage can flag any `ActionTask` that references an action from the missing pack.

## Inside a process module's content.zip

```
content.zip
├── project.json                          Project descriptor
├── checksum.json                         Signature
└── <artifactUid>/                        One directory per artifact
    ├── artifact.json                     Manifest (type, header, dependencies)
    └── <companionUid>                    Extension-less; parsed as JSON.
                                          Present when artifact.json.contents[] is non-empty.
                                          For bpi.process this is the process graph.
```

The `type` in `artifact.json` tells you what you're looking at:

| `type` | Meaning |
|---|---|
| `bpi.process` | Process graph — has a companion file |
| `trigger.api` | Bound to a process via `header.triggerableArtifactUids[]` |
| `environment-variable` | Destination pointer (name only, no secrets) |
| `datatype` | JSON Schema reused across processes |
| `bpi.decision`, `bpi.automation`, `bpi.form`, `notificationtemplate` | Deferred beyond v1 |

## The process graph companion file

For a `bpi.process` artifact, the companion is a single JSON document rooted at:

```jsonc
{
  "artifact": {
    "model": {
      "contents": {
        // outerUid → node blob (see below)
        "6bd77551-...": { "classDefinition": "com.sap.bpm.wfs.Model", ... },
        "fadeaba1-...": { "classDefinition": "com.sap.bpm.wfs.StartEvent", ... },
        // ...
      }
    }
  },
  "metaData": { ... },
  "packageInfo": { ... }
}
```

**Two id systems live inside `contents`:**

- The **outer key** (a UUID like `f5e25a7f-5ee7-46c2-93be-408bc80921ac`) is what `sourceRef`/`targetRef` in SequenceFlows point at, and what `ExclusiveGateway.default` names.
- The **inner `id` field** on every node is a short human-readable id (`condition_1`, `startEvent`, `mail_1`, `pbpkSp9kMefDyfxz8Gstd4H` for auto-generated ones). SBPA's `translations.units` block references this. Formula strings use it too: `context.process_resolveCustomer_1.customer` means "the process_resolveCustomer_1 node's output field customer".

`graph.js` uniformly indexes on the outer UUID and exposes a `nodeName()` helper that accepts either.

**Per-step JSON Schemas live in a `com.sap.bpm.wfs.Schemas` node inside `contents`.** Every SBPA step that carries mapping data (`EndEvent`, `ActionTask`, `ReferencedSubflow`, `StartEvent`, `DataObject`) references its input/output schema via an `interfaces.in` / `interfaces.out` block (or `type` for DataObjects), which resolves to a JSON Schema definition. `scripts/schema.js` walks the Schemas node to resolve these refs and drives per-field type declarations on emitted `Set` and `executeWorkflow.workflowInputs` nodes — never hardcode field types.

## Inside an actions module's content.zip

The four files at the module root are prefixed with the module id:

```
<moduleId>metadata.json          Action definitions + REST bindings (authoritative)
<moduleId>actions.json           List of operations + globalSettings
<moduleId>open_api_spec.json     OpenAPI 3 spec — often EMPTY in exports
<moduleId>checksum.txt
```

**Do not trust `open_api_spec.json` alone.** In observed exports it can be just `{"openapi":"3.0.0","info":{...},"paths":{}}`. The real HTTP contract is in `metadata.json`:

```jsonc
metadata.json
├── artifacts.action.<actionId>.skill.binding.rest.$ref  → "#/bindings/<id>/rest"
└── bindings.<actionId>.rest.transport                    → { operation, path, mimeType, ... }
```

So to resolve `ActionTask.actionIdentifier = "post_orders"`:

1. Look up `metadata.artifacts.action.post_orders`
2. Follow `.skill.binding.rest.$ref` → `"#/bindings/post_orders/rest"`
3. Walk to `metadata.bindings.post_orders.rest.transport` → `{ operation: "post", path: "/orders", mimeType: "application/json" }`

## Where destinations come from

An `environment-variable` artifact with `header.typeValue: "destination"` names a destination but never carries the URL or credentials. Those are resolved at deploy time on the SBPA tenant. When migrating to n8n:

- Emit an n8n credential stub named `SBPA destination: <identifier>` (see `credential-stubs.json` in the migrator output).
- The `httpRequest` node references the credential by name.
- The URL uses `={{ $vars.<identifier>_baseUrl }}<path>` — the customer sets that variable in n8n's Variables UI (or the LLM stage writes it into the workflow if it can be inferred).
