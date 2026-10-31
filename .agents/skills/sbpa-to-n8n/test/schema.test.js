// schema.test.js — unit tests for the JSON Schema → n8n FieldType helpers.
//
// Run from repo root: `node tests/schema.test.js`. Exits 0 on green.

const { resolveSchema, n8nTypeOf, walkSchemaProperties } = require("../scripts/schema");

// Minimal fake process graph with one Schemas node.
const fakeGraph = {
  "schema-node-uuid": {
    classDefinition: "com.sap.bpm.wfs.Schemas",
    schemas: {
      "schema-1": {
        content: {
          definitions: {
            in: {
              type: "object",
              properties: {
                orderid: { type: "string" },
                quantity: { type: "number" },
                confirmed: { type: "boolean" },
                tags: { type: "array", items: { type: "string" } },
                address: { type: "object", properties: { city: { type: "string" } } },
                startsAt: { type: "string", format: "date-time" }, // collapses to string
                exotic: { type: "geometry" }, // unknown → string
              },
            },
          },
        },
      },
    },
  },
  "other-node": {
    classDefinition: "com.sap.bpm.wfs.StartEvent",
    id: "startEvent",
  },
};

let failed = 0;
let total = 0;
const check = (name, ok, details) => {
  total++;
  if (ok) {
    console.log(`ok: ${name}`);
    return;
  }
  failed++;
  console.error(`FAIL: ${name}${details ? `\n  ${details}` : ""}`);
};

// ---- resolveSchema ----

const def = resolveSchema({ schema: "schema-1", definition: "#/definitions/in" }, fakeGraph);
check("resolveSchema finds the definition", !!def, `got ${JSON.stringify(def?.type)}`);
check("resolved definition.type is object", def && def.type === "object");
check("resolved definition has properties", def && !!def.properties);

check(
  "resolveSchema returns null for unknown schema id",
  resolveSchema({ schema: "nope", definition: "#/definitions/in" }, fakeGraph) === null,
);
check(
  "resolveSchema returns null for unknown definition name",
  resolveSchema({ schema: "schema-1", definition: "#/definitions/nope" }, fakeGraph) === null,
);
check("resolveSchema returns null for null ref", resolveSchema(null, fakeGraph) === null);
check(
  "resolveSchema returns null for empty graph",
  resolveSchema({ schema: "schema-1", definition: "#/definitions/in" }, {}) === null,
);

// ---- n8nTypeOf ----

check("n8nTypeOf string", n8nTypeOf({ type: "string" }) === "string");
check("n8nTypeOf number", n8nTypeOf({ type: "number" }) === "number");
check("n8nTypeOf boolean", n8nTypeOf({ type: "boolean" }) === "boolean");
check("n8nTypeOf array", n8nTypeOf({ type: "array" }) === "array");
check("n8nTypeOf object", n8nTypeOf({ type: "object" }) === "object");
// date-time and time formats collapse to string
check(
  "n8nTypeOf string+date-time → string",
  n8nTypeOf({ type: "string", format: "date-time" }) === "string",
);
check("n8nTypeOf string+time → string", n8nTypeOf({ type: "string", format: "time" }) === "string");
// unknown / missing → string
check("n8nTypeOf unknown type → string", n8nTypeOf({ type: "geometry" }) === "string");
check("n8nTypeOf null → string", n8nTypeOf(null) === "string");
check("n8nTypeOf undefined → string", n8nTypeOf(undefined) === "string");
check("n8nTypeOf {} (no type field) → string", n8nTypeOf({}) === "string");

// ---- walkSchemaProperties ----

const seen = {};
walkSchemaProperties(def, (key, spec) => {
  seen[key] = spec.type;
});
check("walkSchemaProperties yields top-level orderid=string", seen.orderid === "string");
check("walkSchemaProperties yields top-level quantity=number", seen.quantity === "number");
check("walkSchemaProperties yields top-level address=object", seen.address === "object");
check("walkSchemaProperties visits every top-level property", Object.keys(seen).length === 7);

// Missing / empty definitions don't throw.
let sawCallback = false;
walkSchemaProperties(null, () => {
  sawCallback = true;
});
walkSchemaProperties({}, () => {
  sawCallback = true;
});
walkSchemaProperties({ type: "object" }, () => {
  sawCallback = true;
});
check("walkSchemaProperties handles null/empty gracefully", !sawCallback);

console.log(
  `\n${failed === 0 ? "all" : `${failed} of ${total}`} check(s) ${failed === 0 ? "passed" : "failed"}`,
);
process.exit(failed === 0 ? 0 : 1);
