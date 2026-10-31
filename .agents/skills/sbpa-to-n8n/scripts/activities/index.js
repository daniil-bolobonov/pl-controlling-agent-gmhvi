// activities/index.js — shared types and the dispatch table.
//
// Each emitter is a function (sbpaNode, ctx) → EmitResult, where:
//
//   sbpaNode      the entry from artifact.model.contents (has .classDefinition)
//   ctx           see EmitContext below
//
// EmitResult:
//   {
//     node?: N8nNode,             the primary n8n node to emit (or null to elide)
//     extraNodes?: N8nNode[],     ancillary nodes (e.g. the Init Set for DataObjects)
//     report?: ReportEntry[],     things the LLM stage must review
//     rewireIncoming?: string,    when eliding, name of the successor to which
//                                 incoming edges should redirect
//   }
//
// EmitContext:
//   {
//     process:     the enclosing bpi.process artifact (from unpack.js)
//     graph:       artifact.model.contents (map of uid → node blob)
//     archive:     the full { artifacts, actions, destinations } from unpack
//     nodeName:    (sbpaNodeId) → n8n display name
//     nextIdCounter(): returns a globally unique node id string
//     predecessors: (sbpaNodeId) → sbpaNodeId | null  (first inbound flow)
//     trigger?:    the trigger.api artifact bound to the process (if any)
//     customInitName?: name of the emitted DataObject init node (if any)
//     subflowManifest: Map<sbpaProcessUid, workflowNamePlaceholder>  set by graph.js
//   }

const { MALFORMED_SBPA_NODE, UNKNOWN_CLASS_DEFINITION } = require("../report-kinds");
const startEvent = require("./startEvent");
const endEvent = require("./endEvent");
const scriptTask = require("./scriptTask");
const { emitGenericSkillTask } = scriptTask;
const referencedSubflow = require("./referencedSubflow");
const actionTask = require("./actionTask");
const mailTask = require("./mailTask");
const gateway = require("./exclusiveGateway");
const parallelGateway = require("./parallelGateway");
const timerEvent = require("./timerEvent");
const userTask = require("./userTask");
const ruleTask = require("./ruleTask");

// Dispatch by the fully-qualified SBPA classDefinition.
const emitters = {
  "com.sap.bpm.wfs.StartEvent": startEvent,
  "com.sap.bpm.wfs.EndEvent": endEvent,
  "com.sap.bpm.wfs.ScriptTask": scriptTask,
  "com.sap.bpm.wfs.GenericSkillTask": emitGenericSkillTask,
  "com.sap.bpm.wfs.ReferencedSubflow": referencedSubflow,
  "com.sap.bpm.wfs.ActionTask": actionTask,
  "com.sap.bpm.wfs.MailTask": mailTask,
  "com.sap.bpm.wfs.ExclusiveGateway": gateway,
  "com.sap.bpm.wfs.ParallelGateway": parallelGateway,
  "com.sap.bpm.wfs.IntermediateCatchEvent": timerEvent,
  "com.sap.bpm.wfs.UserTask": userTask,
  "com.sap.bpm.wfs.RuleTask": ruleTask,
  // Structural nodes that don't emit their own n8n nodes (handled by parent)
  "com.sap.bpm.wfs.MessageEventDefinition": () => ({ node: null }),
  "com.sap.bpm.wfs.TimerEventDefinition": () => ({ node: null }),
  "com.sap.bpm.wfs.TerminateEventDefinition": () => ({ node: null }),
  "com.sap.bpm.wfs.Message": () => ({ node: null }),
  "com.sap.bpm.wfs.UserTaskDefinition": () => ({ node: null }),
  "com.sap.bpm.wfs.RuleDefinition": () => ({ node: null }),
  "com.sap.bpm.wfs.RuleTaskDefinition": () => ({ node: null }),
};

function emit(sbpaNode, ctx) {
  if (!sbpaNode?.classDefinition) {
    return {
      node: null,
      report: [
        {
          kind: MALFORMED_SBPA_NODE,
          sbpaId: sbpaNode?.id || "(missing id)",
          message: "Encountered a graph node without a classDefinition; node was skipped.",
        },
      ],
    };
  }

  const emitter = emitters[sbpaNode.classDefinition];
  if (!emitter) {
    return {
      node: null,
      report: [
        {
          kind: UNKNOWN_CLASS_DEFINITION,
          classDefinition: sbpaNode.classDefinition,
          sbpaId: sbpaNode.id,
          message: `No v1 emitter for ${sbpaNode.classDefinition}; node ${sbpaNode.id} was skipped.`,
        },
      ],
    };
  }

  return emitter(sbpaNode, ctx);
}

module.exports = { emit, emitters };

if (require.main === module) {
  console.log(
    "index.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
