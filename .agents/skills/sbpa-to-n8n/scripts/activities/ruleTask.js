// activities/ruleTask.js — emitter for com.sap.bpm.wfs.RuleTask
const { RULE_TASK_UNSUPPORTED } = require("../report-kinds");
//
// An SBPA RuleTask calls a Business Rules service backed by a decision table.
// The correct n8n target is the SAP AI Agent custom node (CUSTOM.sapAgent),
// which is not yet wired up in this converter. Until that node is supported we
// do NOT emit a substitute (the generic langchain agent is not an acceptable
// stand-in), so the RuleTask is elided from the workflow graph and surfaced as
// a report entry for the LLM review stage to resolve.
//
// Elision is connection-safe: graph.js records `node: null` and walkThroughElided
// collapses incoming edges through to the successor, so the workflow stays valid.

// ---------------------------------------------------------------------------
// Main emitter
// ---------------------------------------------------------------------------

/**
 * @param {object} sbpaNode  the com.sap.bpm.wfs.RuleTask entry from the process graph
 * @param {object} ctx       the EmitContext from graph.js
 * @returns {{ node: null, report: ReportEntry[] }}
 */
function emitRuleTask(sbpaNode, ctx) {
  const taskName = ctx.nodeName(sbpaNode._uuid);

  return {
    node: null,
    report: [
      {
        kind: RULE_TASK_UNSUPPORTED,
        sbpaId: sbpaNode.id,
        message:
          `RuleTask "${taskName}" is not converted. It calls a Business Rules ` +
          `decision service, which must be represented by the SAP AI Agent custom ` +
          `node (CUSTOM.sapAgent). That node is not yet supported by the converter, ` +
          `so the task has been left out of the generated workflow — rebuild the ` +
          `decision logic with CUSTOM.sapAgent after import.`,
      },
    ],
  };
}

module.exports = emitRuleTask;

if (require.main === module) {
  console.log(
    "ruleTask.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
