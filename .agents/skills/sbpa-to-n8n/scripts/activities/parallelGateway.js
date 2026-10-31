// activities/parallelGateway.js — SBPA ParallelGateway → n8n emission.
const { PARALLEL_GATEWAY_SHAPE } = require("../report-kinds");
//
// AND-split / AND-join. Distinguish by shape, same as the ExclusiveGateway
// emitter does for its two shapes:
//
// 1. Split gateway: 1 (or 0) inbound, ≥2 outbound, no conditions. We elide
//    the split entirely — return `{ node: null }`. graph.js's buildConnections
//    walks through elided splits and fans the predecessor's `main[0]` out to
//    every downstream branch. n8n's `executionOrder: 'v1'` runs both branches
//    off the same output port.
//
// 2. Join gateway: ≥2 inbound, 1 outbound, no conditions. Semantically an
//    AND-join — a control-flow synchronization point: wait for all incoming
//    branches, then run downstream exactly ONCE. This is emphatically NOT
//    `mode: 'append'` — that would concatenate items across inputs and fire
//    downstream N times (one per branch). It's also NOT `mode: 'combine'` —
//    combineAll is a cross product, and combineByFields/Position require a
//    join key. The right shape is `mode: 'chooseBranch'` with
//    `chooseBranchMode: 'waitForAll'` and `output: 'empty'` — sync on all
//    inputs, emit a single empty item downstream. Downstream nodes read
//    branch data via `$('<BranchNode>').item.json.<X>` (same as any
//    cross-node reference in the emitted formulas). The ExclusiveGateway
//    merge shape, by contrast, uses `mode: 'append'` because XOR only ever
//    populates one input, so append == passthrough.
//
// Malformed shapes (e.g. ≥2 in AND ≥2 out) go to report.json and are dropped.

function emitParallelGateway(sbpaNode, ctx) {
  const outbound = ctx.outboundFlows(sbpaNode._uuid);
  const inbound = ctx.inboundFlows(sbpaNode._uuid);

  const isSplit = outbound.length >= 2 && inbound.length <= 1;
  const isJoin = inbound.length >= 2 && outbound.length === 1;

  if (isSplit) {
    // Elided — no n8n node. graph.js handles the fan-out.
    return { node: null };
  }

  if (isJoin) {
    const parameters = {
      mode: "chooseBranch",
      chooseBranchMode: "waitForAll",
      output: "empty",
    };
    // numberInputs stays absent for the default 2-input case; set explicitly
    // only when 3+ branches synchronize on this join.
    if (inbound.length > 2) parameters.numberInputs = inbound.length;
    return {
      node: {
        id: ctx.nextIdCounter(),
        name: ctx.nodeName(sbpaNode._uuid),
        type: "n8n-nodes-base.merge",
        typeVersion: 3.2,
        position: [0, 0],
        parameters,
      },
    };
  }

  // Neither pure split nor pure join — real SBPA shouldn't produce this, but
  // guard against it explicitly so it doesn't silently become a bad emission.
  return {
    node: null,
    report: [
      {
        kind: PARALLEL_GATEWAY_SHAPE,
        sbpaId: sbpaNode.id,
        inbound: inbound.length,
        outbound: outbound.length,
        message: `ParallelGateway ${sbpaNode.id} has ${inbound.length} inbound and ${outbound.length} outbound flow(s); expected a pure split (≤1 in, ≥2 out) or join (≥2 in, 1 out). Dropped.`,
      },
    ],
  };
}

module.exports = emitParallelGateway;

if (require.main === module) {
  console.log(
    "parallelGateway.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
