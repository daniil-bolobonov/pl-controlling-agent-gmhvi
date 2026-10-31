// activities/scriptTask.js — SBPA ScriptTask → n8n code node.
const {
  CUSTOM_VAR_UNSUPPORTED_TYPE,
  SCRIPT_TASK_REWRITE,
  GENERIC_SKILL_TASK_REWRITE,
  GENERIC_SKILL_TASK_UNSUPPORTED_EXTENSION,
} = require("../report-kinds");
//
// SBPA ScriptTask body accesses process-scoped state via `$.context.<scope>.<field>`,
// where scope is either "startEvent", "custom", or another node id. We rewrite:
//
//   $.context.startEvent.foo     → $('<TriggerName>').item.json.body.foo
//                                  (cross-node ref — safe at any distance from trigger,
//                                  including after a Merge node whose output is empty)
//   $.context.custom.foo         → $execution.customData via local `custom` snapshot
//   $.context.<nodeId>.foo       → $('<nodeName>').item.json.foo
//
// The rewrite is syntactic (regex over identifier-safe paths). It doesn't try
// to parse the JS body. Anything that doesn't match a supported pattern is
// left as-is and logged in the report so the LLM stage can hand-fix.
//
// n8n $execution.customData constraints (hard platform limits):
//   - Values must be STRINGS — objects and arrays cannot be stored
//   - Key max length: 50 characters
//   - Value max length: 255 characters
//   - Max 10 keys per execution
//
// Custom variables of type object or array cannot be migrated automatically.
// The migrator emits a report entry for each such field.

function emitScriptTask(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const source = sbpaNode.script?.content ? sbpaNode.script.content : "";

  const { rewritten, warnings } = rewriteContextRefs(source, ctx, sbpaNode.id);

  // ScriptTasks in SBPA mutate context.custom in place. In n8n the Code node
  // accesses $execution.customData directly — no upstream "Read Custom Data"
  // node is needed. We snapshot all string fields into a local `custom` object,
  // run the original mutations against it, then persist each key back.
  // NOTE: $execution.customData is string-only. Only scalar string values
  // survive the round-trip. Object/array fields require manual redesign.
  const body = [
    `// Migrated from SBPA ScriptTask ${sbpaNode.id}`,
    "// v1 rewrite: $.context.startEvent → $('" +
      (ctx.triggerNodeName || "StartEvent") +
      "').item.json (cross-node ref),",
    "//             $.context.custom.*   → $execution.customData (read + write).",
    "// NOTE: $execution.customData is string-only (max key=50, value=255, items=10).",
    "const custom = Object.assign({}, $execution.customData.getAll());",
    "",
    rewritten,
    "",
    "// Persist mutations back to $execution.customData (string values only).",
    "for (const [_k, _v] of Object.entries(custom)) {",
    "  $execution.customData.set(_k, String(_v));",
    "}",
    "return { ...$json, custom: $execution.customData.getAll() };",
  ].join("\n");

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        mode: "runOnceForEachItem",
        language: "javaScript",
        jsCode: body,
      },
    },
    report: warnings.map((w) => ({
      kind: w.startsWith("custom variable field")
        ? CUSTOM_VAR_UNSUPPORTED_TYPE
        : SCRIPT_TASK_REWRITE,
      sbpaId: sbpaNode.id,
      message: w,
    })),
  };
}

// Rewrite the two supported access patterns. Everything else stays literal.
// Also warns if the script accesses custom variable fields whose type is not
// 'string' — $execution.customData is string-only (max 255 chars, max 10 keys).
function rewriteContextRefs(source, ctx, _currentId) {
  const warnings = [];
  let out = source;

  // n8n's webhook trigger wraps the request in { headers, body, ... } —
  // trigger fields the ScriptTask referenced via $.context.startEvent.<field>
  // live at .body.<field>, not .<field>. Non-webhook triggers
  // (manualTrigger, executeWorkflowTrigger) pass their JSON unwrapped.
  const startPrefix = ctx.triggerIsWebhook ? "body." : "";

  // $.context.startEvent.<path> → $('<TriggerName>').item.json.<path>
  // Always use the cross-node reference form: it works at any graph distance
  // from the trigger (including after a Merge node whose output is 'empty').
  const triggerName = ctx.triggerNodeName || "StartEvent";
  out = out.replace(/\$\.context\.startEvent\.([A-Za-z_$][A-Za-z0-9_$.]*)/g, (_, tail) => {
    return `$('${triggerName}').item.json.${startPrefix}${tail}`;
  });

  // $.context.custom.<path> → local `custom.<path>` (we merged it in above).
  // Track the top-level field names accessed so we can type-check them.
  const accessedCustomFields = new Set();
  out = out.replace(/\$\.context\.custom\.([A-Za-z_$][A-Za-z0-9_$.]*)/g, (_, tail) => {
    accessedCustomFields.add(tail.split(".")[0]); // top-level field name only
    return `custom.${tail}`;
  });

  // Warn for any accessed custom field whose type is not 'string'.
  if (ctx.customVarFieldTypes && accessedCustomFields.size > 0) {
    for (const fieldName of accessedCustomFields) {
      const fieldType = ctx.customVarFieldTypes.get(fieldName);
      if (fieldType !== undefined && fieldType !== "string") {
        warnings.push(
          `custom variable field "${fieldName}" has type "${fieldType}" which is not supported by $execution.customData (string values only).`,
        );
      }
    }
  }

  // $.context.<otherNode>.<path> → cross-node ref
  out = out.replace(
    /\$\.context\.([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$.]*)/g,
    (_, scope, tail) => {
      const target = ctx.nodeName(scope) || scope;
      return `$('${target}').item.json.${tail}`;
    },
  );

  // Any leftover `$.context` reference is unhandled — leave literal, warn.
  if (/\$\.context\./.test(out)) {
    warnings.push("leftover $.context reference in rewritten body — inspect and fix by hand");
  }

  return { rewritten: out, warnings };
}

// GenericSkillTask dispatches on extensionType. Currently only "ScriptTask"
// is supported; anything else is skipped and flagged for the LLM review stage.
function emitGenericSkillTask(sbpaNode, ctx) {
  const extensionType = sbpaNode.extensionType;

  if (extensionType !== "ScriptTask") {
    return {
      node: null,
      report: [
        {
          kind: GENERIC_SKILL_TASK_UNSUPPORTED_EXTENSION,
          sbpaId: sbpaNode.id,
          extensionType: extensionType || "(none)",
          message: `GenericSkillTask ${sbpaNode.id} has unsupported extensionType "${extensionType || "(none)"}"; node was skipped — add an emitter for this type`,
        },
      ],
    };
  }

  // extensionType === 'ScriptTask': script body lives at customProperties.script.content
  const source = sbpaNode.customProperties?.script?.content
    ? sbpaNode.customProperties.script.content
    : "";

  const name = ctx.nodeName(sbpaNode._uuid);
  const { rewritten, warnings } = rewriteContextRefs(source, ctx, sbpaNode.id);

  const body = [
    `// Migrated from SBPA GenericSkillTask (ScriptTask) ${sbpaNode.id}`,
    "// v1 rewrite: $.context.startEvent → $('" +
      (ctx.triggerNodeName || "StartEvent") +
      "').item.json (cross-node ref),",
    "//             $.context.custom.*   → $execution.customData (read + write).",
    "// NOTE: $execution.customData is string-only (max key=50, value=255, items=10).",
    "const custom = Object.assign({}, $execution.customData.getAll());",
    "",
    rewritten,
    "",
    "// Persist mutations back to $execution.customData (string values only).",
    "for (const [_k, _v] of Object.entries(custom)) {",
    "  $execution.customData.set(_k, String(_v));",
    "}",
    "return { ...$json };",
  ].join("\n");

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        mode: "runOnceForEachItem",
        language: "javaScript",
        jsCode: body,
      },
    },
    report: warnings.map((w) => ({
      kind: w.startsWith("custom variable field")
        ? CUSTOM_VAR_UNSUPPORTED_TYPE
        : GENERIC_SKILL_TASK_REWRITE,
      sbpaId: sbpaNode.id,
      message: w,
    })),
  };
}

module.exports = emitScriptTask;
module.exports.emitGenericSkillTask = emitGenericSkillTask;

if (require.main === module) {
  console.log(
    "scriptTask.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
