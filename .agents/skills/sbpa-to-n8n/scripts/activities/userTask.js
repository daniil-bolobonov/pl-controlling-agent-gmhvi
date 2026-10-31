// activities/userTask.js — SBPA UserTask → n8n SAP Task Center node.
//
const {
  USERTASK_UNKNOWN_DECISION,
  USERTASK_DUEDATE_NO_DIRECT_MAPPING,
  GATEWAY_CONDITION_TRANSLATE_FAILURE,
} = require("../report-kinds");
//
// Two shapes:
//
// 1. With decisionOptions (e.g. Approve / Reject):
//    Emit the SAP Task Center node as the primary node and attach a
//    `_decisionSwitch` marker containing a switch node that branches on
//    the task outcome.  graph.js reads this marker and inlines the switch
//    immediately after the Task Center node, routing the UserTask's outbound
//    SequenceFlows through it.
//
// 2. Without decisionOptions:
//    Emit only the SAP Task Center node — a single unconditional outbound.
//
// Conditions on outbound SequenceFlows are expected to match the SBPA
// pattern:
//   ${usertasks.<taskInnerId>.last.decision == "approve"}
// which translates to a string-equals rule against the SAP Task Center
// node's `result.response` output field ('approved' | 'rejected').
// Any other condition shape falls back to standard JUEL translation
// (boolean-left rule, same as ExclusiveGateway).
//
// Subject and recipientUsers/Groups may contain JUEL interpolation
// (e.g. "Invoice ${context.startEvent.subpname}") and are translated via
// translateJuelInterpolated.

const { translateJuelInterpolated, translateJuelWrapped } = require("../juel");

// SBPA decision option id → SAP Task Center result.response value.
// The SAP Task Center node normalises: code "approve" → "approved",
// everything else → "rejected".
const DECISION_RESPONSE_MAP = {
  approve: "approved",
  reject: "rejected",
};

// Regex to extract the decision value from a condition like:
//   ${usertasks.form_mApproval_1.last.decision == "approve"}
const DECISION_CONDITION_RE =
  /^\$\{\s*usertasks\.[^.]+\.last\.decision\s*==\s*["']([^"']+)["']\s*\}$/;

function emitUserTask(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
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
    aiAgentInnerIds: ctx.aiAgentInnerIds,
  };

  // -- subject (JUEL-interpolated, e.g. "Invoice id: ${context.startEvent.subpname}")
  const subjectRaw = sbpaNode.subject || "";
  const subjectT = translateJuelInterpolated(subjectRaw, resolver);
  const subject = subjectT.ok ? subjectT.expression : subjectRaw;

  // -- priority
  const priority = sbpaNode.priority || "MEDIUM";

  // -- description
  const description = (sbpaNode.description || "").trim();

  // -- dueDate: SBPA stores a `dueDateRef` (external definition UUID) rather than
  //    a plain date/expression.  There is no direct mapping to n8n's Task Center
  //    dueDate parameter — report the gap so it can be set manually after import.
  if (sbpaNode.dueDateRef) {
    report.push({
      kind: USERTASK_DUEDATE_NO_DIRECT_MAPPING,
      sbpaId: sbpaNode.id,
      dueDateRef: sbpaNode.dueDateRef,
      message: `UserTask "${sbpaNode.id}" has a dueDateRef ("${sbpaNode.dueDateRef}") which has no direct n8n SAP Task Center mapping; set the dueDate manually after import.`,
    });
  }

  // -- recipients
  const recipientUsersRaw = (sbpaNode.recipientUsers || "").trim();
  const recipientGroupsRaw = (sbpaNode.recipientGroups || "").trim();

  let recipientUsersExpr = "";
  let recipientGroupsExpr = "";
  if (recipientUsersRaw) {
    const t = translateJuelInterpolated(recipientUsersRaw, resolver);
    recipientUsersExpr = t.ok ? t.expression : recipientUsersRaw;
  }
  if (recipientGroupsRaw) {
    const t = translateJuelInterpolated(recipientGroupsRaw, resolver);
    recipientGroupsExpr = t.ok ? t.expression : recipientGroupsRaw;
  }

  // Build parameters for the SAP Task Center node.
  const parameters = {
    action: "sendApprovalTask",
    subject,
    priority,
    description,
    taskDefinition: { definitionName: name },
  };

  if (recipientUsersExpr) {
    parameters.recipients = {
      recipientValues: [{ userId: recipientUsersExpr }],
    };
  }
  if (recipientGroupsExpr) {
    parameters.recipientGroups = {
      recipientGroupValues: [{ groupId: recipientGroupsExpr }],
    };
  }

  const sapNode = {
    id: ctx.nextIdCounter(),
    name,
    type: "CUSTOM.sapTaskCenter",
    typeVersion: 1,
    position: [0, 0],
    parameters,
  };

  // -- No decisionOptions: simple single-output node, done.
  const decisionOptions = sbpaNode.decisionOptions;
  if (!Array.isArray(decisionOptions) || decisionOptions.length === 0) {
    return { node: sapNode, report };
  }

  // -- Build the switch node that branches on the task decision ---------------

  const outbound = ctx.outboundFlows(sbpaNode._uuid);
  const rules = [];
  const flowOrder = [];
  let defaultFlowId = null;

  for (const flow of outbound) {
    if (!flow.condition) {
      // No condition → unconditional fallback branch.
      defaultFlowId = flow.id;
      continue;
    }

    const m = DECISION_CONDITION_RE.exec(flow.condition);
    if (m) {
      const rawDecision = m[1];
      const responseValue = DECISION_RESPONSE_MAP[rawDecision] || rawDecision;

      if (!(rawDecision in DECISION_RESPONSE_MAP)) {
        report.push({
          kind: USERTASK_UNKNOWN_DECISION,
          sbpaId: sbpaNode.id,
          flowId: flow.id,
          rawDecision,
          message: `UserTask "${sbpaNode.id}": decision id "${rawDecision}" has no known SAP Task Center response mapping; used raw value in switch rule`,
        });
      }

      rules.push({
        conditions: {
          options: { caseSensitive: false, leftValue: "", typeValidation: "loose" },
          conditions: [
            {
              id: `${sbpaNode.id}-${flow.id}`,
              leftValue: `={{ $('${name}').item.json.result.response }}`,
              rightValue: responseValue,
              operator: { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        renameOutput: false,
      });
    } else {
      // Non-usertask condition — fall back to JUEL translation (boolean rule).
      const t = translateJuelWrapped(flow.condition, resolver);
      let expression = "true";
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
    }
    flowOrder.push(flow.id);
  }

  // Default / fallback flow is always last in flowOrder.
  if (defaultFlowId) flowOrder.push(defaultFlowId);

  const switchNode = {
    id: ctx.nextIdCounter(),
    name: `${name} Decision`,
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    position: [0, 0],
    parameters: {
      mode: "rules",
      rules: { values: rules },
      options: {
        fallbackOutput: defaultFlowId ? "extra" : "none",
      },
    },
    // Consumed by graph.js to wire the correct output port per SequenceFlow.
    _flowOrder: flowOrder,
  };

  // Attach the switch as a marker.  graph.js will extract it, insert it
  // into the node list right after the SAP Task Center node, wire
  //   SAP Task Center  →  Switch  →  downstream targets
  // and use _flowOrder to route each outbound SequenceFlow.
  sapNode._decisionSwitch = switchNode;

  return { node: sapNode, report };
}

module.exports = emitUserTask;

if (require.main === module) {
  console.log(
    "userTask.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
