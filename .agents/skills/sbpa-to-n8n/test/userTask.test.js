// userTask.test.js — unit tests for the UserTask emitter.
//
// Run from the repo root: `node tests/userTask.test.js`.
// Exits 0 on green, 1 on any failure. No test framework required.

const emitUserTask = require("../scripts/activities/userTask");

// ---- Helpers ----------------------------------------------------------------

let idCounter = 0;
function makeCtx(overrides = {}) {
  idCounter = 0;
  const flows = overrides.outboundFlows || [];
  return {
    nodeName: (id) => overrides.nodeNames?.[id] || id,
    predecessors: () => null,
    customInitName: "Initialize Custom Data",
    triggerIsWebhook: overrides.triggerIsWebhook !== undefined ? overrides.triggerIsWebhook : false,
    webhookNodes: new Set(),
    nextIdCounter: () => `n8n-${++idCounter}`,
    outboundFlows: () => flows,
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

// ---- Test cases -------------------------------------------------------------

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

// 1. No decisionOptions — emits a single SAP Task Center node, no switch.
test("no decisionOptions → single sapTaskCenter node, no _decisionSwitch", () => {
  const sbpaNode = {
    _uuid: "ut1",
    id: "UserTask_1",
    subject: "Please review the request",
    priority: "HIGH",
  };
  const ctx = makeCtx({ nodeNames: { ut1: "Review Task" } });
  const { node, report } = emitUserTask(sbpaNode, ctx);

  return (
    check("node type", node.type, "CUSTOM.sapTaskCenter") &&
    check("node name", node.name, "Review Task") &&
    check("typeVersion", node.typeVersion, 1) &&
    check("action", node.parameters.action, "sendApprovalTask") &&
    check("subject", node.parameters.subject, "Please review the request") &&
    check("priority", node.parameters.priority, "HIGH") &&
    check("no _decisionSwitch", node._decisionSwitch, undefined) &&
    check("no report items", report.length, 0)
  );
});

// 2. decisionOptions present → emits sapTaskCenter + attached _decisionSwitch.
test("with decisionOptions → _decisionSwitch attached to sapTaskCenter node", () => {
  const sbpaNode = {
    _uuid: "ut2",
    id: "UserTask_2",
    subject: "Approve Invoice",
    priority: "MEDIUM",
    decisionOptions: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
    ],
  };
  const ctx = makeCtx({
    nodeNames: { ut2: "MApproval" },
    outboundFlows: [
      {
        id: "flow_approve",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
        condition: '${usertasks.ut2.last.decision == "approve"}',
        sourceRef: "ut2",
        targetRef: "next1",
      },
      {
        id: "flow_reject",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
        condition: '${usertasks.ut2.last.decision == "reject"}',
        sourceRef: "ut2",
        targetRef: "next2",
      },
    ],
  });
  const { node, report } = emitUserTask(sbpaNode, ctx);
  const sw = node._decisionSwitch;

  return (
    check("primary node type", node.type, "CUSTOM.sapTaskCenter") &&
    check("switch exists", !!sw, true) &&
    check("switch name", sw.name, "MApproval Decision") &&
    check("switch type", sw.type, "n8n-nodes-base.switch") &&
    check("switch typeVersion", sw.typeVersion, 3.2) &&
    check("switch mode", sw.parameters.mode, "rules") &&
    check("rule count", sw.parameters.rules.values.length, 2) &&
    check(
      "approve leftValue",
      sw.parameters.rules.values[0].conditions.conditions[0].leftValue,
      "={{ $('MApproval').item.json.result.response }}",
    ) &&
    check(
      "approve rightValue",
      sw.parameters.rules.values[0].conditions.conditions[0].rightValue,
      "approved",
    ) &&
    check(
      "reject rightValue",
      sw.parameters.rules.values[1].conditions.conditions[0].rightValue,
      "rejected",
    ) &&
    check("fallbackOutput none", sw.parameters.options.fallbackOutput, "none") &&
    check("flowOrder length", sw._flowOrder.length, 2) &&
    check("no report items", report.length, 0)
  );
});

// 3. Default (unconditional) flow alongside decision flows → fallbackOutput: 'extra'.
test("unconditional outbound flow → fallbackOutput: extra", () => {
  const sbpaNode = {
    _uuid: "ut3",
    id: "UserTask_3",
    subject: "Task",
    decisionOptions: [{ id: "approve", label: "Approve" }],
  };
  const ctx = makeCtx({
    nodeNames: { ut3: "Approval" },
    outboundFlows: [
      {
        id: "flow_approve",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
        condition: '${usertasks.ut3.last.decision == "approve"}',
        sourceRef: "ut3",
        targetRef: "next1",
      },
      { id: "flow_default", condition: null, sourceRef: "ut3", targetRef: "next2" },
    ],
  });
  const { node } = emitUserTask(sbpaNode, ctx);
  const sw = node._decisionSwitch;

  return (
    check("rule count (only conditional)", sw.parameters.rules.values.length, 1) &&
    check("fallbackOutput extra", sw.parameters.options.fallbackOutput, "extra") &&
    check(
      "flowOrder: conditional then default",
      JSON.stringify(sw._flowOrder),
      JSON.stringify(["flow_approve", "flow_default"]),
    )
  );
});

// 4. Subject with JUEL interpolation is translated.
test("JUEL-interpolated subject is translated", () => {
  const sbpaNode = {
    _uuid: "ut4",
    id: "UserTask_4",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    subject: "Invoice id: ${context.startEvent.orderId}",
  };
  const ctx = makeCtx({ nodeNames: { ut4: "Approval Task", startEvent: "StartEvent" } });
  const { node } = emitUserTask(sbpaNode, ctx);

  return check(
    "translated subject",
    node.parameters.subject,
    `={{ "Invoice id: " + ($('StartEvent').item.json.orderId) }}`,
  );
});

// 5. recipientUsers with JUEL interpolation is translated.
test("JUEL-interpolated recipientUsers is translated", () => {
  const sbpaNode = {
    _uuid: "ut5",
    id: "UserTask_5",
    subject: "Task",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    recipientUsers: "${context.startEvent.approver}",
  };
  const ctx = makeCtx({ nodeNames: { ut5: "My Task", startEvent: "StartEvent" } });
  const { node } = emitUserTask(sbpaNode, ctx);

  return check(
    "recipients userId",
    node.parameters.recipients.recipientValues[0].userId,
    `={{ ($('StartEvent').item.json.approver) }}`,
  );
});

// 6. Unknown decision id → report entry emitted but switch rule still uses raw value.
test("unknown decision id → report entry + raw value used", () => {
  const sbpaNode = {
    _uuid: "ut6",
    id: "UserTask_6",
    subject: "Task",
    decisionOptions: [{ id: "escalate", label: "Escalate" }],
  };
  const ctx = makeCtx({
    nodeNames: { ut6: "Escalation Task" },
    outboundFlows: [
      {
        id: "flow_esc",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
        condition: '${usertasks.ut6.last.decision == "escalate"}',
        sourceRef: "ut6",
        targetRef: "next1",
      },
    ],
  });
  const { node, report } = emitUserTask(sbpaNode, ctx);
  const sw = node._decisionSwitch;

  return (
    check("report has unknown-decision entry", report.length, 1) &&
    check("report kind", report[0].kind, "usertask-unknown-decision") &&
    check(
      "raw value used in switch rule",
      sw.parameters.rules.values[0].conditions.conditions[0].rightValue,
      "escalate",
    )
  );
});

// 7. description field is included when present.
test("description field is included when non-empty", () => {
  const sbpaNode = {
    _uuid: "ut7",
    id: "UserTask_7",
    subject: "Task",
    description: "Please review and approve",
  };
  const ctx = makeCtx({ nodeNames: { ut7: "Doc Review" } });
  const { node } = emitUserTask(sbpaNode, ctx);

  return check("description parameter", node.parameters.description, "Please review and approve");
});

// 8. No recipients when recipientUsers and recipientGroups are absent.
test("no recipients field when recipientUsers absent", () => {
  const sbpaNode = { _uuid: "ut8", id: "UserTask_8", subject: "Task" };
  const ctx = makeCtx({ nodeNames: { ut8: "Plain Task" } });
  const { node } = emitUserTask(sbpaNode, ctx);

  return check("no recipients", node.parameters.recipients, undefined);
});

// ---- Summary ----------------------------------------------------------------
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
