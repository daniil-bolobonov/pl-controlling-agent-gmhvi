// activities/mailTask.js — SBPA MailTask → n8n emailSend.
//
// The mail body/subject/to are inlined in the graph as a MailDefinition node
// referenced by `mailDefinitionRef`. Typical shape:
//   mailDefinitionRef → node with { to, subject, html, ignoreInvalidRecipients }
//
// `html` and `subject` may contain ${…} substitutions — those are Java JUEL
// expressions (not the SBPA mapping-formula grammar); we translate them with
// juel.js's interpolated-string handler.

const { translateJuelInterpolated } = require("../juel");
const { MAIL_DEFINITION_MISSING, MAIL_BODY_TRANSLATE_FAILURE } = require("../report-kinds");

function emitMailTask(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const report = [];
  const def = ctx.graph[sbpaNode.mailDefinitionRef];

  if (!def) {
    report.push({
      kind: MAIL_DEFINITION_MISSING,
      sbpaId: sbpaNode.id,
      message: `MailTask has mailDefinitionRef ${sbpaNode.mailDefinitionRef} but no matching node in the graph`,
    });
    return {
      node: {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.emailSend",
        typeVersion: 2.1,
        position: [0, 0],
        parameters: { toEmail: "", subject: "", html: "" },
      },
      report,
    };
  }

  const resolver = {
    predecessorId: ctx.predecessors(sbpaNode._uuid),
    nodeName: ctx.nodeName,
    customInitName: ctx.customInitName,
    triggerIsWebhook: ctx.triggerIsWebhook,
    customDataReaderName: ctx.customDataReaderName
      ? ctx.customDataReaderName(sbpaNode._uuid)
      : null,
    aiAgentInnerIds: ctx.aiAgentInnerIds,
  };

  const toResult = translateJuelInterpolated(def.to || "", resolver);
  const subjectResult = translateJuelInterpolated(def.subject || "", resolver);
  const htmlResult = translateJuelInterpolated(def.html || "", resolver);

  for (const [field, r] of Object.entries({
    to: toResult,
    subject: subjectResult,
    html: htmlResult,
  })) {
    if (!r.ok) {
      report.push({
        kind: MAIL_BODY_TRANSLATE_FAILURE,
        sbpaId: sbpaNode.id,
        field,
        source: r.expression,
        error: r.error,
      });
    }
  }

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2.1,
      position: [0, 0],
      parameters: {
        // fromEmail is required by n8n's emailSend validator — empty string
        // triggers a workflow-level "issues" error before any node runs. SBPA
        // MailDefinitions don't carry a sender (destination-scoped SMTP is
        // resolved at run time), so we emit a documented placeholder the
        // customer replaces after import.
        fromEmail: "sender@example.invalid",
        toEmail: toResult.expression,
        subject: subjectResult.expression,
        emailFormat: "html",
        html: htmlResult.expression,
        options: {},
      },
      // Credential id must be non-empty or n8n's schema validator complains
      // similarly. Keep the credentials block only as a naming hint the
      // customer can point at a real credential; drop it if empty.
    },
    report,
  };
}

module.exports = emitMailTask;

if (require.main === module) {
  console.log(
    "mailTask.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
