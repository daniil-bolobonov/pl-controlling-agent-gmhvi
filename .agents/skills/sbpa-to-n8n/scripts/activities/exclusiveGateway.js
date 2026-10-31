// activities/exclusiveGateway.js — SBPA ExclusiveGateway → n8n switch OR merge.
//
// Two shapes to distinguish:
//
// 1. Branch gateway: ≥2 outgoing SequenceFlows, each with a `condition` string
//    (except the one pointed to by `.default`). Emit `n8n-nodes-base.switch`
//    in "rules" mode.
//
// 2. Merge gateway: multiple inbound, one outbound, no conditions anywhere.
//    Emit `n8n-nodes-base.merge` in combineAll mode.
//
// n8n's switch (typeVersion 3.2) expects each rule as
//   { conditions: { options, conditions[], combinator }, renameOutput?, outputKey? }
// but v1 emits a simpler shape that the LLM stage can refine: one rule per
// non-default outgoing flow, with a boolean-typed condition holding the
// translated expression on the left side and the constant `true` on the right.

const { translateJuelWrapped } = require("../juel");
const { GATEWAY_CONDITION_TRANSLATE_FAILURE } = require("../report-kinds");

function emitGateway(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const outbound = ctx.outboundFlows(sbpaNode._uuid);
  const inbound = ctx.inboundFlows(sbpaNode._uuid);

  const isBranch = outbound.length >= 2;
  const isMerge = inbound.length >= 2 && outbound.length === 1;

  if (isMerge && !isBranch) {
    return emitMerge(sbpaNode, ctx, name);
  }
  return emitBranch(sbpaNode, ctx, name);
}

function emitBranch(sbpaNode, ctx, name) {
  const outbound = ctx.outboundFlows(sbpaNode._uuid);
  const defaultFlowUid = sbpaNode.default;
  const report = [];
  const resolver = {
    predecessorId: ctx.predecessors(sbpaNode._uuid),
    nodeName: ctx.nodeName,
    customInitName: ctx.customInitName,
    triggerIsWebhook: ctx.triggerIsWebhook,
  };

  // n8n switch v3.2 with fallbackOutput='extra': the fallback port is at
  // connection index 0, and rule-match ports start at index 1.
  // So: flowOrder[0] = default flow, flowOrder[1..] = conditional flows.
  const rules = [];
  const flowOrder = [];
  if (defaultFlowUid) flowOrder.push(defaultFlowUid); // index 0 → Fallback port

  for (const flow of outbound) {
    if (flow.id === defaultFlowUid) continue;
    let expression = "true";
    if (flow.condition) {
      const t = translateJuelWrapped(flow.condition, resolver);
      if (!t.ok) {
        report.push({
          kind: GATEWAY_CONDITION_TRANSLATE_FAILURE,
          sbpaId: sbpaNode.id,
          flowId: flow.id,
          source: flow.condition,
          error: t.error,
        });
        expression = flow.condition;
      } else {
        expression = t.expression;
      }
    }
    rules.push({
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [
          {
            id: `${sbpaNode.id}-${flow.id}`,
            leftValue: expression,
            rightValue: true,
            operator: { type: "boolean", operation: "true" },
          },
        ],
        combinator: "and",
      },
      renameOutput: false,
    });
    flowOrder.push(flow.id); // index 1, 2, ... → rule match ports
  }

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.switch",
      typeVersion: 3.2,
      position: [0, 0],
      parameters: {
        mode: "rules",
        rules: { values: rules },
        options: {
          fallbackOutput: defaultFlowUid ? "extra" : "none",
        },
      },
      // Non-standard field consumed by graph.js: which output index maps to
      // which SBPA sequence-flow uid. n8n itself ignores unknown top-level
      // keys, so this is safe to leave on the emitted JSON, but graph.js
      // strips it before writing.
      _flowOrder: flowOrder,
    },
    report,
  };
}

function emitMerge(sbpaNode, ctx, name) {
  const inbound = ctx.inboundFlows(sbpaNode._uuid);
  const parameters = { mode: "append" };
  // n8n's merge node defaults to 2 input ports; only set numberInputs when
  // more slots are needed. Kept out of the emitted JSON for the common case
  // so the golden matches what the n8n Editor produces from scratch.
  if (inbound.length > 2) parameters.numberInputs = inbound.length;
  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.merge",
      typeVersion: 3.2,
      position: [0, 0],
      parameters,
    },
  };
}

module.exports = emitGateway;

if (require.main === module) {
  console.log(
    "exclusiveGateway.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
