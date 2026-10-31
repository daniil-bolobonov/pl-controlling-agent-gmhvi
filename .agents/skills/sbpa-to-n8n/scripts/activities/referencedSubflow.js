// activities/referencedSubflow.js — SBPA ReferencedSubflow → n8n executeWorkflow.
//
// The referenced sub-process is identified by `executionArtifactRef`, which
// points at a `ProcessDefinition` wrapper node in the same graph. That
// wrapper carries the `uid` of the target bpi.process artifact.
//
// The concrete n8n workflow id doesn't exist at migrate time (workflows only
// get ids when POSTed to n8n). We emit the target process's SBPA identifier
// as `workflowId.value`. The eval harness (or, in production, an LLM patch
// step / the customer) resolves the identifier to the real id after import.
//
// Node shape (n8n 1.x, typeVersion 1.2):
//
//   type:        n8n-nodes-base.executeWorkflow
//   typeVersion: 1.2                  (v1 expects a plain-string workflowId
//                                      — passing a resource-locator to a v1
//                                      node silently destructures .value as
//                                      undefined at runtime, producing
//                                      "Workflow does not exist.")
//   parameters:
//     source:      "database"
//     workflowId:  { __rl, value, mode:"id", cachedResultName }
//     mode:        "each"
//     workflowInputs:                  (v1.2 resourceMapper; carries the
//                                       translated input mapping so the
//                                       sub-process receives the exact keys
//                                       its StartEvent schema expects)
//       mappingMode: "defineBelow"
//       value:       { <targetKey>: <translated expression>, ... }
//       schema:      [ { id, displayName, type, ... } for each key ]
//       matchingColumns: []
//       attemptToConvertTypes: false
//       convertFieldsToString: false

const { translate } = require("../formula");
const { resolveSchema, n8nTypeOf } = require("../schema");
const {
  UNRESOLVED_SUBFLOW,
  SUBFLOW_ID_PLACEHOLDER,
  SUBFLOW_INPUT_TYPE_FALLBACK,
  FORMULA_PARSE_FAILURE,
} = require("../report-kinds");

function emitReferencedSubflow(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const targetProcessUid = resolveTargetUid(sbpaNode, ctx);
  const target = targetProcessUid ? ctx.archive.artifacts[targetProcessUid] : null;

  const report = [];
  if (!target) {
    report.push({
      kind: UNRESOLVED_SUBFLOW,
      sbpaId: sbpaNode.id,
      message: `ReferencedSubflow ${sbpaNode.id} points at unknown process ${targetProcessUid || "(no ref)"}; workflowId left empty`,
    });
  }

  const workflowRef = target ? target.identifier : targetProcessUid || "";
  const cachedResultName = target
    ? target.name || target.identifier
    : targetProcessUid || "Sub-workflow";

  if (target) {
    report.push({
      kind: SUBFLOW_ID_PLACEHOLDER,
      sbpaId: sbpaNode.id,
      nodeName: name,
      targetIdentifier: workflowRef,
      targetName: cachedResultName,
      message: `"Execute Workflow" node "${name}" references sub-workflow "${cachedResultName}" (SBPA identifier: "${workflowRef}"). After importing all workflows to n8n, update the workflowId value to the numeric ID that n8n assigns to workflow "${cachedResultName}".`,
    });
  }

  const resolver = buildResolver(ctx, sbpaNode._uuid);
  const inputMapping = translateMapping(sbpaNode.mappings?.in, resolver, report, sbpaNode.id);

  // The caller's `interfaces.in` describes what the sub-process expects — its
  // JSON Schema is the source of truth for the workflowInputs.schema types.
  const inputDefinition = resolveSchema(sbpaNode.interfaces?.in, ctx.graph);

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        source: "database",
        workflowId: {
          __rl: true,
          value: workflowRef,
          mode: "id",
          cachedResultName,
        },
        workflowInputs: buildWorkflowInputs(inputMapping, inputDefinition, report, sbpaNode.id),
        mode: "each",
        options: {},
      },
    },
    report,
  };
}

// n8n's v1.2 caller uses a resourceMapper for input. Shape:
//   { mappingMode: 'defineBelow',
//     value: { <key>: <expr string>, ... },
//     schema: [ { id, displayName, type, defaultMatch, display, required,
//                 canBeUsedToMatch }, ... ],
//     matchingColumns: [],
//     attemptToConvertTypes: false,
//     convertFieldsToString: false }
//
// When the input mapping is empty (sub-process has no declared inputs), emit
// an empty-schema resourceMapper — n8n accepts and treats it as pass-nothing.
function buildWorkflowInputs(inputMapping, inputDefinition, report, sbpaId) {
  const entries = Object.entries(inputMapping);
  const schemaProps = inputDefinition?.properties || null;
  return {
    mappingMode: "defineBelow",
    value: Object.fromEntries(entries),
    schema: entries.map(([key]) => {
      let type;
      if (schemaProps && Object.hasOwn(schemaProps, key)) {
        type = n8nTypeOf(schemaProps[key]);
      } else {
        type = "string";
        report.push({
          kind: SUBFLOW_INPUT_TYPE_FALLBACK,
          sbpaId,
          field: key,
          message: `no schema entry for "${key}" in ReferencedSubflow interfaces.in; emitted type: 'string'`,
        });
      }
      return {
        id: key,
        displayName: key,
        type,
        defaultMatch: false,
        display: true,
        required: false,
        canBeUsedToMatch: false,
      };
    }),
    matchingColumns: [],
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  };
}

function resolveTargetUid(sbpaNode, ctx) {
  const execRef = sbpaNode.executionArtifactRef;
  if (!execRef) return null;
  const wrapper = ctx.graph[execRef];
  if (!wrapper) return null;
  return wrapper.uid || null;
}

function translateMapping(mapping, resolver, report, sbpaId) {
  const out = {};
  if (!mapping) return out;
  for (const [rawKey, entry] of Object.entries(mapping)) {
    const key = stripKeyBrackets(rawKey);
    const value = entry?.value;
    if (value == null) continue;
    const result = translate(value, resolver);
    if (!result.ok) {
      report.push({
        kind: FORMULA_PARSE_FAILURE,
        sbpaId,
        field: key,
        source: value,
        error: result.error,
      });
      out[key] = value;
    } else {
      out[key] = result.expression;
    }
  }
  return out;
}

function stripKeyBrackets(k) {
  // Keys are stored as `['name']` — strip the brackets and quotes.
  const m = /^\['(.+)'\]$/.exec(k);
  return m ? m[1] : k;
}

function buildResolver(ctx, currentId) {
  return {
    predecessorId: ctx.predecessors(currentId),
    nodeName: ctx.nodeName,
    customInitName: ctx.customInitName,
    triggerIsWebhook: ctx.triggerIsWebhook,
    customDataReaderName: ctx.customDataReaderName ? ctx.customDataReaderName(currentId) : null,
  };
}

module.exports = emitReferencedSubflow;

if (require.main === module) {
  console.log(
    "referencedSubflow.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
