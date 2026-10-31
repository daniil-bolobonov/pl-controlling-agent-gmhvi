# Custom Variables — Skill Quick-Reference

**Audience:** Skill contributors and code reviewers.

> **Injection trigger (read first).** The three custom-data nodes described below are injected into a process **only when that process contains at least one `com.sap.bpm.wfs.DataObject` node** (`graph.js`: `customVarsDetected = dataObjects.length > 0`). No `DataObject` → no injection. Detection is DataObject presence only; mapping keys do not trigger it.

---

## `$execution.customData` API

| Operation | API |
|---|---|
| Read all | `$execution.customData.getAll()` → `{ key: "string" }` |
| Read one | `$execution.customData.get("key")` → `"string"` |
| Write | `$execution.customData.set("key", "string")` |

**Hard limits**: strings only · key ≤ 50 chars · value ≤ 255 chars · max 10 keys · paid feature.

Only SBPA fields with JSON Schema type `string` are migrated. All others emit `custom-var-unsupported-type`.

---

## Four Injected Node Patterns

```
Trigger → [Initialize Custom Data] → [Node A] → [Update Custom Data: A]
       → [Read Custom Data: B] → [Node B] → [ScriptTask C (inline)]
```

### Initialize Custom Data (after trigger)
```js
const cd = $execution.customData.getAll();
if (!("field" in cd)) $execution.customData.set("field", "default");
return [{  custom: $execution.customData.getAll()  }];
```

### Update Custom Data: `<Node>` (after writer nodes, not ScriptTask)
```js
const output = $input.first().json;
$execution.customData.set("field", String(output.fieldValue));
return [{ custom: $execution.customData.getAll() }];
```

### Read Custom Data: `<Node>` (before reader nodes, not ScriptTask)
```js
const custom = $execution.customData.getAll();
return [{ custom: custom }];
// Downstream: ={{ $('Read Custom Data: NodeName').item.json.custom.field }}
```

### ScriptTask inline (no surrounding nodes)
```js
const custom = Object.assign({}, $execution.customData.getAll());
// rewritten script body — $.context.custom.x → custom.x
for (const [_k, _v] of Object.entries(custom)) {
  $execution.customData.set(_k, String(_v));
}
return { ...$json, custom: $execution.customData.getAll() };
```

---

## nodeReadsCustomVar Detection

| Node class | Inject reader? |
|---|---|
| `com.sap.bpm.wfs.ScriptTask` | **No** — reads inline |
| `GenericSkillTask` with `extensionType === 'ScriptTask'` | **No** — reads inline |
| `GenericSkillTask` with other `extensionType` | **No** — node is elided |
| Any other node | Yes, if `context.custom` found in `mappings.in` / JUEL fields |

---

## buildCustomVarFieldTypes Helper

```js
function buildCustomVarFieldTypes(dataObjects, graph) {
  const types = new Map();
  for (const d of dataObjects) {
    const def = resolveSchema(d.type, graph);
    if (!def || !def.properties) continue;
    for (const [fieldName, spec] of Object.entries(def.properties)) {
      if (spec && spec.type) types.set(fieldName, spec.type);
    }
  }
  return types;
}
```

Passed to: `buildCustomDataInitCodeNode`, `buildCustomDataWriterNode`, `ctx.customVarFieldTypes` (ScriptTask rewrite).

---

## Known Gaps

| Gap | Mitigation |
|---|---|
| Non-string types not migrated | `custom-var-unsupported-type` report entry *(the only `custom-var-*` kind currently emitted — see `report-kinds.js`)* |
| Key > 50 chars | *Planned — not yet enforced in code (no `custom-var-key-too-long` kind emitted). Review key length manually.* |
| Value > 255 chars | *Planned — not yet enforced in code (no `custom-var-value-too-long` kind emitted). Review value length manually.* |
| > 10 fields | *Planned — not yet enforced in code (no `custom-var-too-many-fields` kind emitted). Review field count manually.* |
| ScriptTask bracket notation (`custom[var]`) | Left as-is; `script-task-rewrite` warning |
| Sub-workflow data isolation | Pass values explicitly as subflow inputs |
| Parallel branch write conflict | Last branch wins — document in process notes |
