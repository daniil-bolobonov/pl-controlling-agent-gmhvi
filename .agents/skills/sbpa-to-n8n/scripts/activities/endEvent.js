// activities/endEvent.js — SBPA EndEvent.
//
// If the EndEvent has no inbound mapping, elide it — n8n workflows just end.
// If it has an inbound mapping (typical for sub-workflows that return a value
// to their caller), emit a `set` node that shapes the final output.
//
// Field types on each Set assignment come from the SBPA JSON Schema
// referenced by `interfaces.in`. See schema.js. When a specific key is not
// present in the schema (or no schema is declared at all), fall back to
// `string` and record a report entry so the LLM review stage can patch.

const { translate } = require("../formula");
const { resolveSchema, n8nTypeOf } = require("../schema");
const {
  TERMINATE_END_EVENT_UNSUPPORTED,
  END_EVENT_MAPPING_PARSE_FAILURE,
  END_EVENT_MAPPING_TYPE_FALLBACK,
} = require("../report-kinds");

function emitEndEvent(sbpaNode, ctx) {
  // Terminate End Event: an EndEvent carrying a TerminateEventDefinition child.
  // In SBPA this immediately ends the whole process instance, killing every
  // active/parallel branch. n8n has no "terminate all branches" primitive, so
  // we deliberately emit NO node and record a gap for manual redesign. Note:
  // any inbound return mapping is intentionally dropped — a terminate does not
  // return a value.
  if (hasTerminateDefinition(sbpaNode, ctx)) {
    return {
      node: null,
      report: [
        {
          kind: TERMINATE_END_EVENT_UNSUPPORTED,
          sbpaId: sbpaNode.id,
          message:
            "Terminate End Event has no n8n equivalent; node elided. " +
            "Sibling/parallel branches will NOT be terminated. Manual redesign required.",
        },
      ],
    };
  }

  const inMap = sbpaNode.mappings?.in;
  if (!inMap || Object.keys(inMap).length === 0) {
    return { node: null };
  }

  const name = ctx.nodeName(sbpaNode._uuid) || "End";
  const report = [];
  const resolver = {
    predecessorId: ctx.predecessors(sbpaNode._uuid),
    nodeName: ctx.nodeName,
    customInitName: ctx.customInitName,
    triggerIsWebhook: ctx.triggerIsWebhook,
    webhookNodes: ctx.webhookNodes,
    customDataReaderName: ctx.customDataReaderName
      ? ctx.customDataReaderName(sbpaNode._uuid)
      : null,
  };

  const definition = resolveSchema(sbpaNode.interfaces?.in, ctx.graph);
  const schemaProps = definition?.properties || null;

  const assignments = [];
  for (const [rawKey, entry] of Object.entries(inMap)) {
    const key = stripKeyBrackets(rawKey);
    const value = entry?.value;
    if (value == null) continue;
    const t = translate(value, resolver);
    if (!t.ok) {
      report.push({
        kind: END_EVENT_MAPPING_PARSE_FAILURE,
        sbpaId: sbpaNode.id,
        field: key,
        source: value,
        error: t.error,
      });
    }
    let fieldType;
    if (schemaProps && Object.hasOwn(schemaProps, key)) {
      fieldType = n8nTypeOf(schemaProps[key]);
    } else {
      fieldType = "string";
      report.push({
        kind: END_EVENT_MAPPING_TYPE_FALLBACK,
        sbpaId: sbpaNode.id,
        field: key,
        message: `no schema entry for "${key}" in EndEvent interfaces.in; emitted type: 'string'`,
      });
    }
    assignments.push({
      id: `end-${key}`,
      name: key,
      type: fieldType,
      value: t.ok ? t.expression : value,
    });
  }

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [0, 0],
      parameters: {
        mode: "manual",
        duplicateItem: false,
        assignments: { assignments },
        options: {},
      },
    },
    report,
  };
}

function stripKeyBrackets(k) {
  const m = /^\['(.+)'\]$/.exec(k);
  return m ? m[1] : k;
}

// True when the EndEvent carries a TerminateEventDefinition under its
// `eventDefinitions` map (i.e. it is a Terminate End Event, not a plain end).
function hasTerminateDefinition(sbpaNode, ctx) {
  const defs = sbpaNode.eventDefinitions;
  if (!defs || typeof defs !== "object") return false;
  const graph = ctx?.graph;
  if (!graph) return false;
  return Object.keys(defs).some((id) => {
    const def = graph[id];
    return def && def.classDefinition === "com.sap.bpm.wfs.TerminateEventDefinition";
  });
}

module.exports = emitEndEvent;

if (require.main === module) {
  console.log(
    "endEvent.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
