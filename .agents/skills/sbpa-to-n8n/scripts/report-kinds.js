// report-kinds.js — canonical string constants for every report.kind value.
//
// Every report object emitted by the migrator carries a `kind` field that
// identifies the type of gap or issue.  Centralising the strings here:
//   • prevents typos from silently creating unrecognised kinds
//   • makes the full set easy to audit in one place
//   • lets callers compare with === against the constants rather than
//     against bare string literals

// -- Process / graph level ---------------------------------------------------
const PROCESS_GRAPH_MISSING = "process-graph-missing";
const MODULE_MISSING = "module-missing";
const PARSE_ERROR = "parse-error";
const UNPARSEABLE_UNQUOTED_KEYS = "unparseable-unquoted-keys";
const NO_GRAPH = "no-graph";

// -- Trigger / start event ---------------------------------------------------
const NO_TRIGGER_BINDING = "no-trigger-binding";
const UNKNOWN_TRIGGER_TYPE = "unknown-trigger-type";
const TRIGGER_EVENT_MANUAL_TOPIC = "trigger-event-manual-topic";

// -- Node dispatch -----------------------------------------------------------
const MALFORMED_SBPA_NODE = "malformed-sbpa-node";
const UNKNOWN_CLASS_DEFINITION = "unknown-class-definition";

// -- Action task -------------------------------------------------------------
const ACTION_BINDING_MISSING = "action-binding-missing";
const DESTINATION_MISSING = "destination-missing";
const DYNAMIC_DESTINATION = "dynamic-destination";

// -- End event ---------------------------------------------------------------
const TERMINATE_END_EVENT_UNSUPPORTED = "terminate-end-event-unsupported";
const END_EVENT_MAPPING_PARSE_FAILURE = "end-event-mapping-parse-failure";
const END_EVENT_MAPPING_TYPE_FALLBACK = "end-event-mapping-type-fallback";

// -- Gateway -----------------------------------------------------------------
const GATEWAY_CONDITION_TRANSLATE_FAILURE = "gateway-condition-translate-failure";
const PARALLEL_GATEWAY_SHAPE = "parallel-gateway-shape";

// -- Mail task ---------------------------------------------------------------
const MAIL_DEFINITION_MISSING = "mail-definition-missing";
const MAIL_BODY_TRANSLATE_FAILURE = "mail-body-translate-failure";

// -- Rule task ---------------------------------------------------------------
const RULE_TASK_UNSUPPORTED = "rule-task-unsupported";

// -- Script / skill task -----------------------------------------------------
const SCRIPT_TASK_REWRITE = "script-task-rewrite";
const GENERIC_SKILL_TASK_REWRITE = "generic-skill-task-rewrite";
const GENERIC_SKILL_TASK_UNSUPPORTED_EXTENSION = "generic-skill-task-unsupported-extension";
const CUSTOM_VAR_UNSUPPORTED_TYPE = "custom-var-unsupported-type";

// -- Referenced subflow ------------------------------------------------------
const UNRESOLVED_SUBFLOW = "unresolved-subflow";
const SUBFLOW_ID_PLACEHOLDER = "subflow-id-placeholder";
const SUBFLOW_INPUT_TYPE_FALLBACK = "subflow-input-type-fallback";

// -- Timer / catch event -----------------------------------------------------
const CATCH_EVENT_DEFINITION_MISSING = "catch-event-definition-missing";
const CATCH_EVENT_DEFINITION_UNKNOWN = "catch-event-definition-unknown";
const MESSAGE_DEFINITION_MISSING = "message-definition-missing";
const TIMER_DURATION_DYNAMIC = "timer-duration-dynamic";
const TIMER_DURATION_APPROXIMATE = "timer-duration-approximate";
const TIMER_DURATION_UNPARSED = "timer-duration-unparsed";

// -- User task ---------------------------------------------------------------
const USERTASK_UNKNOWN_DECISION = "usertask-unknown-decision";
const USERTASK_DUEDATE_NO_DIRECT_MAPPING = "usertask-duedate-no-direct-mapping";

// -- Formula translation (shared across multiple emitters) -------------------
const FORMULA_PARSE_FAILURE = "formula-parse-failure";

module.exports = {
  // Process / graph level
  PROCESS_GRAPH_MISSING,
  MODULE_MISSING,
  PARSE_ERROR,
  UNPARSEABLE_UNQUOTED_KEYS,
  NO_GRAPH,
  // Trigger / start event
  NO_TRIGGER_BINDING,
  UNKNOWN_TRIGGER_TYPE,
  TRIGGER_EVENT_MANUAL_TOPIC,
  // Node dispatch
  MALFORMED_SBPA_NODE,
  UNKNOWN_CLASS_DEFINITION,
  // Action task
  ACTION_BINDING_MISSING,
  DESTINATION_MISSING,
  DYNAMIC_DESTINATION,
  // End event
  TERMINATE_END_EVENT_UNSUPPORTED,
  END_EVENT_MAPPING_PARSE_FAILURE,
  END_EVENT_MAPPING_TYPE_FALLBACK,
  // Gateway
  GATEWAY_CONDITION_TRANSLATE_FAILURE,
  PARALLEL_GATEWAY_SHAPE,
  // Mail task
  MAIL_DEFINITION_MISSING,
  MAIL_BODY_TRANSLATE_FAILURE,
  // Rule task
  RULE_TASK_UNSUPPORTED,
  // Script / skill task
  SCRIPT_TASK_REWRITE,
  GENERIC_SKILL_TASK_REWRITE,
  GENERIC_SKILL_TASK_UNSUPPORTED_EXTENSION,
  CUSTOM_VAR_UNSUPPORTED_TYPE,
  // Referenced subflow
  UNRESOLVED_SUBFLOW,
  SUBFLOW_ID_PLACEHOLDER,
  SUBFLOW_INPUT_TYPE_FALLBACK,
  // Timer / catch event
  CATCH_EVENT_DEFINITION_MISSING,
  CATCH_EVENT_DEFINITION_UNKNOWN,
  MESSAGE_DEFINITION_MISSING,
  TIMER_DURATION_DYNAMIC,
  TIMER_DURATION_APPROXIMATE,
  TIMER_DURATION_UNPARSED,
  // User task
  USERTASK_UNKNOWN_DECISION,
  USERTASK_DUEDATE_NO_DIRECT_MAPPING,
  // Formula translation
  FORMULA_PARSE_FAILURE,
};

if (require.main === module) {
  console.log("report-kinds.js — report kind constants. Import to use in emitters and migrate.js.");
  process.exit(0);
}
