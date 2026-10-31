// referencedSubflow.test.js — unit tests for the ReferencedSubflow emitter.
//
// Run from the repo root: `node tests/referencedSubflow.test.js`.
// Exits 0 on green, 1 on any failure. No test framework required.

const emitReferencedSubflow = require("../scripts/activities/referencedSubflow");

// ---- Helpers ----------------------------------------------------------------

let idCounter = 0;
function makeCtx(overrides = {}) {
  idCounter = 0;
  return {
    nodeName: (id) => overrides.nodeNames?.[id] || id,
    predecessors: () => null,
    customInitName: "Initialize Custom Data",
    triggerIsWebhook: false,
    webhookNodes: new Set(),
    nextIdCounter: () => `n8n-${++idCounter}`,
    archive: overrides.archive || { artifacts: {} },
    graph: overrides.graph || {},
  };
}

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${e}`);
    console.error(`  actual:   ${a}`);
    return false;
  }
  console.log(`ok: ${label}`);
  return true;
}

let failed = 0;
let total = 0;

function test(label, fn) {
  total++;
  try {
    if (!fn()) failed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  threw: ${err.message}`);
  }
}

// ---- Test cases -------------------------------------------------------------

// 1. Resolved target → emits executeWorkflow node + subflow-id-placeholder report entry.
test("resolved target → node emitted + subflow-id-placeholder report entry", () => {
  const targetUid = "uid-sub-1";
  const sbpaNode = {
    _uuid: "sf1",
    id: "ReferencedSubflow_1",
    executionArtifactRef: "procDefWrapper",
  };
  const ctx = makeCtx({
    nodeNames: { sf1: "Invoice Handling" },
    archive: {
      artifacts: {
        [targetUid]: {
          uid: targetUid,
          identifier: "subProcess1",
          name: "Sub Process 1",
        },
      },
    },
    graph: {
      procDefWrapper: { uid: targetUid },
    },
  });

  const { node, report } = emitReferencedSubflow(sbpaNode, ctx);

  const placeholder = report.find((r) => r.kind === "subflow-id-placeholder");

  return (
    check("node type", node.type, "n8n-nodes-base.executeWorkflow") &&
    check("node name", node.name, "Invoice Handling") &&
    check("workflowId value is sbpa id", node.parameters.workflowId.value, "subProcess1") &&
    check("placeholder report exists", !!placeholder, true) &&
    check("placeholder sbpaId", placeholder.sbpaId, "ReferencedSubflow_1") &&
    check("placeholder nodeName", placeholder.nodeName, "Invoice Handling") &&
    check("placeholder targetIdentifier", placeholder.targetIdentifier, "subProcess1") &&
    check("placeholder targetName", placeholder.targetName, "Sub Process 1") &&
    check("placeholder message non-empty", placeholder.message.length > 0, true)
  );
});

// 2. Unresolved target → emits unresolved-subflow report entry, no placeholder.
test("unresolved target → unresolved-subflow report, no placeholder", () => {
  const sbpaNode = {
    _uuid: "sf2",
    id: "ReferencedSubflow_2",
    executionArtifactRef: "missingWrapper",
  };
  const ctx = makeCtx({
    nodeNames: { sf2: "Unknown Sub" },
    graph: {}, // wrapper not found
  });

  const { node, report } = emitReferencedSubflow(sbpaNode, ctx);

  const unresolved = report.find((r) => r.kind === "unresolved-subflow");
  const placeholder = report.find((r) => r.kind === "subflow-id-placeholder");

  return (
    check("node emitted", !!node, true) &&
    check("unresolved entry exists", !!unresolved, true) &&
    check("no placeholder", placeholder, undefined) &&
    check("workflowId empty", node.parameters.workflowId.value, "")
  );
});

// 3. No executionArtifactRef → unresolved-subflow report, no placeholder.
test("no executionArtifactRef → unresolved-subflow, no placeholder", () => {
  const sbpaNode = {
    _uuid: "sf3",
    id: "ReferencedSubflow_3",
    // no executionArtifactRef
  };
  const ctx = makeCtx({ nodeNames: { sf3: "No Ref Sub" } });

  const { report } = emitReferencedSubflow(sbpaNode, ctx);

  const unresolved = report.find((r) => r.kind === "unresolved-subflow");
  const placeholder = report.find((r) => r.kind === "subflow-id-placeholder");

  return (
    check("unresolved entry exists", !!unresolved, true) &&
    check("no placeholder", placeholder, undefined)
  );
});

// 4. Resolved target without a name falls back to identifier for cachedResultName.
test("resolved target without name → identifier used as cachedResultName", () => {
  const targetUid = "uid-sub-4";
  const sbpaNode = {
    _uuid: "sf4",
    id: "ReferencedSubflow_4",
    executionArtifactRef: "wrapper4",
  };
  const ctx = makeCtx({
    nodeNames: { sf4: "No Name Sub" },
    archive: {
      artifacts: {
        [targetUid]: { uid: targetUid, identifier: "noNameProcess" /* no name */ },
      },
    },
    graph: { wrapper4: { uid: targetUid } },
  });

  const { node, report } = emitReferencedSubflow(sbpaNode, ctx);
  const placeholder = report.find((r) => r.kind === "subflow-id-placeholder");

  return (
    check(
      "cachedResultName falls back to identifier",
      node.parameters.workflowId.cachedResultName,
      "noNameProcess",
    ) &&
    check("placeholder targetName also uses identifier", placeholder.targetName, "noNameProcess")
  );
});

// ---- Summary ----------------------------------------------------------------
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
