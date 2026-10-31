// activities/actionTask.js — SBPA ActionTask → n8n httpRequest node.
//
// Resolution chain:
//   sbpaNode.actionIdentifier   → e.g. "post_orders"
//   sbpaNode.destination        → e.g. "erp" (name of environment-variable artifact)
//   sbpaNode.executionArtifactRef → wrapper node in the graph pointing at an
//                                   ActionGroupDefinition, which has .uid of
//                                   the actions module's action-group artifact
//   The actions module's metadata.json has:
//     .action.<actionId>.skill.binding.rest → { $ref: "#/bindings/<id>/rest" }
//     .bindings.<id>.rest.transport         → { operation, path, mimeType, ... }
//     .bindings.types.<actionId>_input_schema  (the input body shape)
//
// Emitted node: n8n-nodes-base.httpRequest, typeVersion 4.2
// method / URL from metadata, body built from mappings

const { translate } = require("../formula");
const {
  ACTION_BINDING_MISSING,
  DYNAMIC_DESTINATION,
  DESTINATION_MISSING,
  FORMULA_PARSE_FAILURE,
} = require("../report-kinds");

function emitActionTask(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const report = [];

  const actionModule = pickActionModule(sbpaNode, ctx);
  const binding = actionModule ? extractRestBinding(actionModule, sbpaNode.actionIdentifier) : null;

  if (!binding) {
    report.push({
      kind: ACTION_BINDING_MISSING,
      sbpaId: sbpaNode.id,
      message: `Could not resolve REST binding for actionIdentifier "${sbpaNode.actionIdentifier}"; emitted a placeholder httpRequest`,
    });
  }

  const method = (binding?.operation ? binding.operation : "post").toUpperCase();
  const bodyPath = binding?.path ? binding.path : `/${sbpaNode.actionIdentifier}`;
  const mimeType = binding?.mimeType ? binding.mimeType : "application/json";

  // ---- httpRequest path ---------------------------------------------------
  const destName = sbpaNode.destination;
  const isDynamicDest = destName && /^\$\{/.test(destName);
  const destArtifact = !isDynamicDest && destName ? ctx.archive.destinations[destName] : null;

  if (isDynamicDest) {
    // Dynamic destination — the target is resolved at runtime from context.
    // n8n has no native dynamic credential binding, so we emit a call to a
    // scenario-specific dispatch endpoint that receives the destination
    // identifier in a request header and routes to the real target.
    const safeId = varSafe(destName.replace(/^\$\{|\}$/g, ""));
    const dispatchCredName = `Dispatch: ${destName}`;
    report.push({
      kind: DYNAMIC_DESTINATION,
      sbpaId: sbpaNode.id,
      destination: destName,
      dispatchCredential: dispatchCredName,
      message:
        `ActionTask "${sbpaNode.id}" uses a dynamic destination expression "${destName}". ` +
        `Emitted an httpRequest pointing at a scenario-specific dispatch endpoint ` +
        `($vars.${safeId}_baseUrl/dispatch). The runtime destination is passed via the ` +
        `X-Destination header. A dispatch endpoint must be deployed that reads this ` +
        `header and routes to the real target. Fill in the dispatch endpoint URL variable ` +
        `and credential before running this workflow.`,
    });

    const resolver = buildResolver(ctx, sbpaNode._uuid);
    const bodyFields = translateMapping(sbpaNode.mappings?.in, resolver, report, sbpaNode.id);
    const translatedDest = destName.replace(/^\$\{/, "={{").replace(/\}$/, "}}");

    return {
      node: {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [0, 0],
        parameters: {
          method,
          url: `={{ $vars.${safeId}_baseUrl }}/dispatch${bodyPath}`,
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: "X-Destination", value: translatedDest }],
          },
          sendBody: true,
          contentType: mimeType.includes("json") ? "json" : "raw",
          specifyBody: "keypair",
          bodyParameters: {
            parameters: Object.entries(bodyFields).map(([k, v]) => ({ name: k, value: v })),
          },
          options: {},
        },
        credentials: { httpHeaderAuth: { id: "", name: dispatchCredName } },
      },
      report,
    };
  }

  if (destName && !destArtifact) {
    report.push({
      kind: DESTINATION_MISSING,
      sbpaId: sbpaNode.id,
      destination: destName,
      message: `ActionTask references destination "${destName}" but no matching environment-variable artifact was found`,
    });
  }

  // URL uses a `$vars.<dest>_baseUrl` placeholder that the LLM stage — or
  // the customer via n8n Variables — resolves. Zero-touch after credential
  // wiring.
  const url = destName ? `={{ $vars.${varSafe(destName)}_baseUrl }}${bodyPath}` : bodyPath;

  const resolver = buildResolver(ctx, sbpaNode._uuid);
  const bodyFields = translateMapping(sbpaNode.mappings?.in, resolver, report, sbpaNode.id);

  const parameters = {
    method,
    url,
    sendBody: true,
    contentType: mimeType.includes("json") ? "json" : "raw",
    specifyBody: "keypair",
    bodyParameters: {
      parameters: Object.entries(bodyFields).map(([k, v]) => ({
        name: k,
        value: v,
      })),
    },
    options: {},
  };

  const node = {
    id: ctx.nextIdCounter(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [0, 0],
    parameters,
  };

  if (destArtifact) {
    node.credentials = {
      httpHeaderAuth: {
        id: "",
        name: `SBPA destination: ${destName}`,
      },
    };
  }

  return { node, report };
}

function pickActionModule(sbpaNode, ctx) {
  const execRef = sbpaNode.executionArtifactRef;
  const wrapper = execRef ? ctx.graph[execRef] : null;
  const _groupUid = wrapper?.uid;

  const modules = Object.values(ctx.archive.actions);
  if (modules.length === 0) return null;
  const withMatch = modules.find((m) => {
    const ops = m.actions?.operations;
    return ops && Object.keys(ops).some((k) => k.startsWith(sbpaNode.actionIdentifier));
  });
  return withMatch || modules[0];
}

function extractRestBinding(actionModule, actionId) {
  const md = actionModule?.metadata;
  if (!md) return null;
  // The action entry lives at md.artifacts.action.<id> in observed SBPA
  // exports. The alternative shape md.action.<id> is not observed and would
  // need a separate test case.
  const entry = md.artifacts?.action?.[actionId];
  if (!entry) return null;

  const refPath = entry.skill?.binding?.rest?.$ref;
  if (!refPath) return null;

  const parts = refPath.replace(/^#\//, "").split("/");
  let ref = md;
  for (const seg of parts) ref = ref?.[seg];
  if (!ref?.transport) return null;

  const t = ref.transport;
  return {
    operation: t.operation,
    path: t.path,
    mimeType: t.mimeType,
  };
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
    aiAgentInnerIds: ctx.aiAgentInnerIds,
  };
}

function varSafe(s) {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

module.exports = emitActionTask;

if (require.main === module) {
  console.log(
    "actionTask.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
