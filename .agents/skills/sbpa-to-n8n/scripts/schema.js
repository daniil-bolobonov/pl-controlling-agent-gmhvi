// schema.js — SBPA JSON-Schema helpers used by every emitter that types
// mapping fields.
//
// Every SBPA graph node that carries mapping data has an `interfaces` block:
//
//   "interfaces": {
//     "in":  { "schema": "<schemaId>", "definition": "#/definitions/<name>" },
//     "out": { ... }
//   }
//
// The `schema` id points at an entry in the process graph's
// `com.sap.bpm.wfs.Schemas` node, whose `content.definitions.<name>`
// holds the JSON Schema. This module resolves those refs and translates
// per-field JSON Schema entries into n8n's `FieldType` enum, which is
// what `Set` node assignments and `executeWorkflow.workflowInputs.schema`
// declarations expect.
//
// SBPA's own type vocabulary is narrower than JSON Schema in general — no
// `integer`, no `null`, and while it produces `format: date` / `time` /
// `date-time` decorations on strings, we collapse those to `string` for
// n8n compatibility (n8n's `dateTime` type has coercion behavior we haven't
// validated against a real fixture yet — revisit when one surfaces).
//
// Public API:
//   resolveSchema(interfaceRef, graph) → definition object | null
//   n8nTypeOf(fieldSpec)               → n8n FieldType string
//   walkSchemaProperties(definition, cb) → iterate top-level properties
//
// Zero external deps.

// JSON Schema type → n8n FieldType. SBPA only produces:
//   string, number, boolean, array, object
// (plus format: date / time / date-time on strings, ignored per user direction).
// Anything unknown falls back to string — callers can attach a report entry.
const TYPE_MAP = {
  string: "string",
  number: "number",
  boolean: "boolean",
  array: "array",
  object: "object",
};

/**
 * Resolve `{ schema, definition }` against the graph's Schemas nodes.
 *
 * @param {{ schema: string, definition: string }|null|undefined} ref
 * @param {Record<string, any>} graph  the enclosing bpi.process's contents map
 * @returns {object|null}  the definition (with .type, .properties, etc.) or null
 */
function resolveSchema(ref, graph) {
  if (!ref?.schema || !ref.definition || !graph) return null;

  // definition is "#/definitions/<name>" — extract the last segment.
  const m = /^#\/definitions\/(.+)$/.exec(ref.definition);
  if (!m) return null;
  const defName = m[1];

  // Walk every Schemas node; each carries a `schemas` map keyed by schema id.
  for (const node of Object.values(graph)) {
    if (node?.classDefinition !== "com.sap.bpm.wfs.Schemas") continue;
    const schemas = node.schemas || {};
    const s = schemas[ref.schema];
    if (!s?.content) continue;
    const defs = s.content.definitions;
    if (defs && Object.hasOwn(defs, defName)) {
      return defs[defName];
    }
  }
  return null;
}

/**
 * Map a JSON Schema field spec to an n8n FieldType.
 *
 * @param {object|null|undefined} fieldSpec  e.g. { type: 'string', format: 'date-time' }
 * @returns {'string'|'number'|'boolean'|'array'|'object'}
 */
function n8nTypeOf(fieldSpec) {
  const t = fieldSpec?.type;
  if (typeof t === "string" && TYPE_MAP[t]) return TYPE_MAP[t];
  return "string";
}

/**
 * Iterate the top-level properties of a definition. Non-recursive by design;
 * every current emitter consumes flat mapping keys.
 *
 * @param {object|null} definition
 * @param {(key: string, fieldSpec: object) => void} cb
 */
function walkSchemaProperties(definition, cb) {
  const props = definition?.properties;
  if (!props) return;
  for (const [key, fieldSpec] of Object.entries(props)) {
    cb(key, fieldSpec);
  }
}

module.exports = { resolveSchema, n8nTypeOf, walkSchemaProperties };

if (require.main === module) {
  console.log(
    "schema.js — SBPA JSON Schema helpers.\nThis is a library module. Import it with require('./schema'). Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
