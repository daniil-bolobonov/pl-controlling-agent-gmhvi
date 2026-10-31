// activities/startEvent.js — SBPA StartEvent → n8n trigger node(s).
//
// Trigger type dispatch (ctx.trigger.type):
//   trigger.api       → n8n webhook (POST, path from trigger identifier)
//   trigger.event     → CUSTOM.sapS4HanaEventTrigger (manualTopic mode; broker topic must be set post-import → emits trigger-event-manual-topic report entry)
//   trigger.scheduled → n8n scheduleTrigger (no schedule config — customer sets cron post-import)
//   trigger.form      → n8n formTrigger     (customer configures form fields post-import)
//   (none)            → n8n manualTrigger   (fallback)
//
// Subflow processes (ctx.processIsSubflow = true):
//   Always emit THREE nodes returned as { node, extras: [secondaryTrigger, normalizeSetNode] }:
//     node       — executeWorkflowTrigger (primary; required by n8n when called as sub-workflow)
//     extras[0]  — standalone trigger (same type as above, but named "<name> (Standalone)")
//                  OR manualTrigger when no bound trigger exists
//     extras[1]  — normalize Set node (named as the StartEvent display name so downstream
//                  expressions like $('StartEvent') still resolve correctly)
//   The normalize Set node merges { ...$json.body, ...$json } so all trigger types produce
//   the same flat output shape regardless of whether input arrived via webhook or sub-workflow.
//
// Non-subflow processes: emit a single { node } (existing behaviour, extended for new types).

const { resolveSchema } = require("../schema");
const { TRIGGER_EVENT_MANUAL_TOPIC } = require("../report-kinds");

// Returns a report array for trigger types that require post-import action.
function buildTriggerReport(trigger) {
  if (trigger?.type !== "trigger.event") return [];
  return [
    {
      kind: TRIGGER_EVENT_MANUAL_TOPIC,
      sbpaId: trigger.identifier || trigger.uid,
      message: `SAP S/4HANA Event Trigger: broker topic "${trigger.identifier || ""}" must be verified and configured in n8n after import (node is in manualTopic mode).`,
    },
  ];
}

function emitStartEvent(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const inputSchema = resolveSchema(sbpaNode.interfaces?.out, ctx.graph) || null;
  const pinDefaults = buildPinDefaults(inputSchema);

  if (ctx.processIsSubflow) {
    return buildDualTrigger(name, ctx, pinDefaults);
  }

  if (ctx.trigger) {
    const node = buildStandaloneTriggerNode(name, ctx.trigger, ctx);
    const item =
      ctx.trigger.type === "trigger.api" && pinDefaults ? { body: pinDefaults } : pinDefaults;
    return {
      node,
      pinData: item ? { [name]: [item] } : null,
      report: buildTriggerReport(ctx.trigger),
    };
  }

  // Fallback — no trigger binding, not a subflow.
  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
    pinData: pinDefaults ? { [name]: [pinDefaults] } : null,
    report: [],
  };
}

// ---------------------------------------------------------------------------
// Dual-trigger emitter (subflow processes)
// ---------------------------------------------------------------------------

function buildDualTrigger(name, ctx, pinDefaults) {
  // Primary: executeWorkflowTrigger (required for n8n sub-workflow calling).
  const primary = {
    id: ctx.nextIdCounter(),
    name: "Execute Workflow Trigger",
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1,
    position: [0, 0],
    parameters: { inputSource: "passthrough" },
  };

  // Secondary: standalone trigger for independent execution, or manualTrigger.
  const standaloneName = `${name} (Standalone)`;
  let secondary;
  if (ctx.trigger) {
    secondary = buildStandaloneTriggerNode(standaloneName, ctx.trigger, ctx);
  } else {
    secondary = {
      id: ctx.nextIdCounter(),
      name: standaloneName,
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    };
  }

  // Normalize Set node — named as the StartEvent so expressions like
  // $('StartEvent').item.json.field resolve to the flat merged output.
  // Merges $json.body (webhook path) with $json (sub-workflow / non-webhook path).
  const normalizeNode = {
    id: ctx.nextIdCounter(),
    name,
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position: [0, 0],
    parameters: {
      mode: "raw",
      jsonOutput: "={{ Object.assign({}, $json.body ?? {}, $json) }}",
    },
  };

  const secondaryItem =
    ctx.trigger && ctx.trigger.type === "trigger.api" && pinDefaults
      ? { body: pinDefaults }
      : pinDefaults;
  return {
    node: primary,
    extras: [secondary, normalizeNode],
    pinData: secondaryItem ? { [secondary.name]: [secondaryItem] } : null,
    report: buildTriggerReport(ctx.trigger),
  };
}

// ---------------------------------------------------------------------------
// Standalone trigger builder — dispatch on trigger.type
// ---------------------------------------------------------------------------

function buildStandaloneTriggerNode(name, trigger, ctx) {
  switch (trigger.type) {
    case "trigger.api": {
      const path = kebabCase(trigger.identifier || "sbpa-trigger");
      return {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [0, 0],
        parameters: {
          httpMethod: "POST",
          path,
          responseMode: "onReceived",
        },
        webhookId: trigger.uid,
      };
    }

    case "trigger.event":
      return {
        id: ctx.nextIdCounter(),
        name,
        type: "CUSTOM.sapS4HanaEventTrigger",
        typeVersion: 1,
        position: [0, 0],
        parameters: {
          manualTopic: true,
          topic: trigger.identifier || "",
          additionalFields: {},
        },
        webhookId: trigger.uid,
      };

    case "trigger.scheduled":
      return {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        // No schedule config in SBPA export — customer configures cron rule after import.
        parameters: {},
      };

    case "trigger.form":
      return {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.formTrigger",
        typeVersion: 1,
        position: [0, 0],
        // Form fields are not in the SBPA artifact — customer configures after import.
        parameters: {},
        webhookId: trigger.uid,
      };

    default:
      // Unknown trigger type — fall back to manualTrigger and emit a report entry.
      return {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.manualTrigger",
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
        _unknownTriggerType: trigger.type,
      };
  }
}

function kebabCase(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function buildDefaultFromSpec(spec) {
  if (!spec) return "";
  const t = spec.type;
  if (t === "number") return 0;
  if (t === "boolean") return false;
  if (t === "array") {
    const items = spec.items;
    if (items && items.type === "object" && items.properties) {
      return [buildDefaultFromSpec(items)];
    }
    return [];
  }
  if (t === "object") {
    if (!spec.properties) return {};
    const obj = {};
    for (const [k, v] of Object.entries(spec.properties)) {
      obj[k] = buildDefaultFromSpec(v);
    }
    return obj;
  }
  return ""; // string / unknown
}

function buildPinDefaults(schema) {
  const props = schema?.properties;
  if (!props || Object.keys(props).length === 0) return null;
  const defaults = {};
  for (const [key, spec] of Object.entries(props)) {
    defaults[key] = buildDefaultFromSpec(spec);
  }
  return defaults;
}

module.exports = emitStartEvent;

if (require.main === module) {
  console.log(
    "startEvent.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
