// activities/timerEvent.js — SBPA IntermediateCatchEvent + TimerEventDefinition or MessageEventDefinition
// → n8n wait node or webhook node.
//
// For TimerEventDefinition — two top-level properties, four sub-cases:
//
//   PROPERTY: timeDuration  (relative wait — "how long to pause")
//     (A) Literal ISO 8601 (type absent or type: "formula" with a quoted ISO literal):
//         timeDuration.value = '"PT10M"'
//         → n8n wait, resume: 'timeInterval', amount: 10, unit: 'minutes'
//
//     (B) Dynamic duration (type: "formula", ConcatenateStrings builds an ISO 8601 duration):
//         timeDuration = { type: "formula", value: 'ConcatenateStrings(["PT", context.startEvent.waittime, "M"], "")' }
//         Unit inferred from ConcatenateStrings suffix; middle expression becomes the n8n amount.
//         → n8n wait, resume: 'timeInterval', amount: <n8n expression>, unit: <detected>
//
//   PROPERTY: timestamp  (absolute wait — "wait until this point in time")
//     (C) At Specified Date (type: "formula"):
//         timestamp = { type: "formula", value: 'context.startEvent.startat' }
//         → n8n wait, resume: 'specificTime', dateTime: <n8n expression>
//
// For MessageEventDefinition:
//   The IntermediateCatchEvent has a MessageEventDefinition that references
//   a Message in the process header.catches array. The message has an identifier
//   (name), type ("message"), and inputs (JSON Schema). Emits as an n8n wait
//   node with resume: "webhook" mode, which waits for an incoming HTTP POST
//   with the message payload.

const { translate } = require("../formula");
const {
  CATCH_EVENT_DEFINITION_MISSING,
  CATCH_EVENT_DEFINITION_UNKNOWN,
  MESSAGE_DEFINITION_MISSING,
  FORMULA_PARSE_FAILURE,
  TIMER_DURATION_DYNAMIC,
  TIMER_DURATION_APPROXIMATE,
  TIMER_DURATION_UNPARSED,
} = require("../report-kinds");

function emitIntermediateCatchEvent(sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const report = [];

  const defs = sbpaNode.eventDefinitions || {};
  const defId = Object.keys(defs)[0];
  const def = defId ? ctx.graph[defId] : null;

  if (!def) {
    report.push({
      kind: CATCH_EVENT_DEFINITION_MISSING,
      sbpaId: sbpaNode.id,
      message: `IntermediateCatchEvent ${sbpaNode.id} has no attached event definition; emitted a 1-second wait as placeholder`,
    });
    return {
      node: {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [0, 0],
        parameters: { amount: 1, unit: "seconds" },
      },
      report,
    };
  }

  // Dispatch on event definition type
  if (def.classDefinition === "com.sap.bpm.wfs.MessageEventDefinition") {
    return emitMessageEventDefinition(def, sbpaNode, ctx);
  }

  if (def.classDefinition === "com.sap.bpm.wfs.TimerEventDefinition") {
    return emitTimerEventDefinition(def, sbpaNode, ctx);
  }

  // Unknown definition type
  report.push({
    kind: CATCH_EVENT_DEFINITION_UNKNOWN,
    sbpaId: sbpaNode.id,
    classDefinition: def.classDefinition,
    message: `IntermediateCatchEvent ${sbpaNode.id} has unknown event definition type ${def.classDefinition}; emitted a 1-second wait as placeholder`,
  });
  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      position: [0, 0],
      parameters: { amount: 1, unit: "seconds" },
    },
    report,
  };
}

function emitMessageEventDefinition(def, sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const report = [];

  // The messageRef is a UUID that points to a Message node in the graph
  const messageRef = def.messageRef;
  const messageNode = messageRef ? ctx.graph[messageRef] : null;

  // Alternative: try to find in header.catches by matching the name/identifier
  let messageDef = null;
  let identifier = "message-event";

  if (messageNode && messageNode.classDefinition === "com.sap.bpm.wfs.Message") {
    // Found the Message node in the graph
    identifier = messageNode.id || messageRef;

    // Message node might have an `identifier` field or we can use its id
    if (messageNode.identifier) {
      identifier = messageNode.identifier;
    }
  } else if (ctx.process.header?.catches) {
    // Try to find in catches array - match by messageRef if it's in the catches
    messageDef = ctx.process.header.catches.find(
      (c) => c.identifier === messageRef || c.name === messageRef,
    );
    if (messageDef) {
      identifier = messageDef.identifier;
    }
  }

  if (!messageNode && !messageDef) {
    report.push({
      kind: MESSAGE_DEFINITION_MISSING,
      sbpaId: sbpaNode.id,
      messageRef,
      message: `MessageEventDefinition references unknown message ${messageRef}; emitted wait node with placeholder webhookId`,
    });
  }

  // Store message schema in ctx for downstream reference
  if (messageDef?.inputs) {
    if (!ctx.messageEventSchemas) {
      ctx.messageEventSchemas = new Map();
    }
    ctx.messageEventSchemas.set(identifier, messageDef.inputs);
  }

  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      position: [0, 0],
      parameters: {
        resume: "webhook",
        httpMethod: "POST",
        options: {},
      },
      webhookId: deterministicWebhookId(identifier),
    },
    report,
  };
}

function emitTimerEventDefinition(def, sbpaNode, ctx) {
  const name = ctx.nodeName(sbpaNode._uuid);
  const report = [];

  // ── (C) At Specified Date — `timestamp` property ─────────────────────────
  // SBPA uses `timestamp` (not `timeDuration`) for absolute point-in-time waits.
  // The UI calls this "At Specified Date"; SBPA only supports type: "formula" here.
  if (def.timestamp) {
    const ts = def.timestamp;
    const resolver = buildResolver(ctx, sbpaNode._uuid);
    const dateResult =
      ts.type === "formula"
        ? translate(ts.value || "", resolver)
        : {
            ok: false,
            error: `Unsupported timestamp type "${ts.type}"`,
            expression: ts.value || "",
          };

    if (!dateResult.ok) {
      report.push({
        kind: FORMULA_PARSE_FAILURE,
        sbpaId: sbpaNode.id,
        source: ts.value,
        error: dateResult.error,
      });
    }
    return {
      node: {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [0, 0],
        parameters: {
          resume: "specificTime",
          dateTime: dateResult.ok ? dateResult.expression : ts.value || "",
        },
      },
      report,
    };
  }

  // ── (A) / (B) Duration — `timeDuration` property ─────────────────────────
  const td = def.timeDuration || {};

  if (td.type === "formula") {
    const formulaValue = td.value || "";
    const resolver = buildResolver(ctx, sbpaNode._uuid);

    // (B) ConcatenateStrings(["PT", <expr>, "M"], "") pattern — dynamic duration.
    // Detects suffix letter to determine unit; translates the middle expression
    // as the n8n amount expression.
    const dynDuration = parseConcatenateStringsDuration(formulaValue);
    if (dynDuration) {
      const amountResult = translate(dynDuration.amountFormula, resolver);
      if (!amountResult.ok) {
        report.push({
          kind: FORMULA_PARSE_FAILURE,
          sbpaId: sbpaNode.id,
          source: dynDuration.amountFormula,
          error: amountResult.error,
        });
      }
      const approxNote = dynDuration.isMonths
        ? ` (approximate: 1 month = 30 days)`
        : dynDuration.isYears
          ? ` (approximate: 1 year = 365 days)`
          : "";
      if (dynDuration.approximate) {
        report.push({
          kind: TIMER_DURATION_DYNAMIC,
          sbpaId: sbpaNode.id,
          source: formulaValue,
          emittedUnit: dynDuration.unit,
          message: `Dynamic timer duration detected; unit "${dynDuration.unit}" inferred from ConcatenateStrings suffix${approxNote} — verify the expression resolves to a number`,
        });
      }
      return {
        node: {
          id: ctx.nextIdCounter(),
          name,
          type: "n8n-nodes-base.wait",
          typeVersion: 1.1,
          position: [0, 0],
          parameters: {
            resume: "timeInterval",
            amount: amountResult.ok ? amountResult.expression : formulaValue,
            unit: dynDuration.unit,
          },
        },
        report,
      };
    }

    // (A-formula) The formula value is a string literal that is a valid ISO 8601
    // duration (e.g. value: '"P1M"'). Treat identically to a bare literal (case A).
    const literalIso = stripQuotes(formulaValue);
    const literalParsed = parseIsoDuration(literalIso);
    if (literalParsed) {
      const { amount, unit, approximate } = literalParsed;
      if (approximate) {
        report.push({
          kind: TIMER_DURATION_APPROXIMATE,
          sbpaId: sbpaNode.id,
          raw: formulaValue,
          emitted: `${amount} ${unit}`,
          message: `ISO 8601 duration ${JSON.stringify(literalIso)} uses years/months which have no exact n8n equivalent; converted to ${amount} ${unit} (1 month = 30 days, 1 year = 365 days) — review after import`,
        });
      }
      return {
        node: {
          id: ctx.nextIdCounter(),
          name,
          type: "n8n-nodes-base.wait",
          typeVersion: 1.1,
          position: [0, 0],
          parameters: { resume: "timeInterval", amount, unit },
        },
        report,
      };
    }

    // Unknown formula pattern in timeDuration — can't determine unit; emit fallback.
    report.push({
      kind: TIMER_DURATION_UNPARSED,
      sbpaId: sbpaNode.id,
      raw: formulaValue,
      message: `timeDuration formula ${JSON.stringify(formulaValue)} is not a recognised pattern (expected ConcatenateStrings or quoted ISO literal); emitted 1 second placeholder`,
    });
    return {
      node: {
        id: ctx.nextIdCounter(),
        name,
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [0, 0],
        parameters: { resume: "timeInterval", amount: 1, unit: "seconds" },
      },
      report,
    };
  }

  // ── (A) Literal ISO 8601 ──────────────────────────────────────────────────
  const raw = td.value;
  const iso = stripQuotes(raw || "");
  const parsed = parseIsoDuration(iso);
  if (!parsed) {
    report.push({
      kind: TIMER_DURATION_UNPARSED,
      sbpaId: sbpaNode.id,
      raw,
      message: `Could not parse ISO 8601 duration ${JSON.stringify(iso)}; emitted 1 second`,
    });
  }

  const { amount, unit, approximate } = parsed || { amount: 1, unit: "seconds" };
  if (approximate) {
    report.push({
      kind: TIMER_DURATION_APPROXIMATE,
      sbpaId: sbpaNode.id,
      raw,
      emitted: `${amount} ${unit}`,
      message: `ISO 8601 duration ${JSON.stringify(iso)} uses years/months which have no exact n8n equivalent; converted to ${amount} ${unit} (1 month = 30 days, 1 year = 365 days) — review after import`,
    });
  }
  return {
    node: {
      id: ctx.nextIdCounter(),
      name,
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      position: [0, 0],
      parameters: { resume: "timeInterval", amount, unit },
    },
    report,
  };
}

function stripQuotes(s) {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

// parseConcatenateStringsDuration — detect the SBPA dynamic-duration pattern:
//   ConcatenateStrings(["PT", <amountFormula>, "S"|"M"|"H"], "")
//   ConcatenateStrings(["P",  <amountFormula>, "D"|"W"|"M"|"Y"], "")
// n8n has no months/years unit:
//   P…M → multiplies the expression by 30 (approximate)
//   P…Y → multiplies the expression by 365 (approximate)
// Returns { amountFormula, unit, approximate? } or null if the string doesn't match.
function parseConcatenateStringsDuration(source) {
  // Match: ConcatenateStrings([<prefix>, <middle>, <suffix>], "")
  // prefix must be "P" or "PT", suffix must be a single ISO 8601 designator.
  const m =
    /^ConcatenateStrings\s*\(\s*\[\s*"(PT?)",\s*([\s\S]+?),\s*"([YMWDHSM])"\s*\]\s*,\s*""\s*\)$/.exec(
      source.trim(),
    );
  if (!m) return null;
  const [, prefix, middle, designator] = m;

  // Map designator to n8n unit.
  // P…M (months) has no n8n equivalent → convert to days × 30 (approximate).
  // P…W (weeks) → days × 7 (exact).
  const unitMap = {
    S: "seconds",
    M: prefix === "PT" ? "minutes" : "days", // PT…M = minutes; P…M = months → days (×30)
    H: "hours",
    D: "days",
    W: "days",
    Y: "days", // P…Y = years → days (×365, approximate)
  };
  const unit = unitMap[designator];
  if (!unit) return null;

  const isMonths = designator === "M" && prefix === "P";
  const isYears = designator === "Y";
  const approximate = isMonths || isYears;

  let amountFormula = middle.trim();
  if (isMonths) amountFormula = `(${amountFormula}) * 30`;
  if (isYears) amountFormula = `(${amountFormula}) * 365`;

  return { amountFormula, unit, approximate, isMonths, isYears };
}

// buildResolver — minimal resolver for formula.translate() in this emitter.
function buildResolver(ctx, currentId) {
  return {
    predecessorId: ctx.predecessors ? ctx.predecessors(currentId) : [],
    nodeName: ctx.nodeName,
    customInitName: ctx.customInitName,
    triggerIsWebhook: ctx.triggerIsWebhook,
    customDataReaderName: ctx.customDataReaderName ? ctx.customDataReaderName(currentId) : null,
  };
}

// Very small ISO 8601 duration parser — handles the forms SBPA emits.
// Supported: P{n}Y, P{n}M (months), P{n}W, P{n}D, PT{n}H, PT{n}M, PT{n}S, and mixes.
// n8n's wait node (timeInterval mode) does not support years or months units, so:
//   P{n}Y → converted to days exactly  (1Y = 365D)
//   P{n}M → converted to days, 30 days per month (approximate; caller emits a report entry)
// Returns { amount, unit, approximate? } or null if the string is unparseable.
function parseIsoDuration(iso) {
  // Groups: years, months, weeks, days, hours, minutes, seconds
  const m =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      iso,
    );
  if (!m) return null;
  const [, years, months, weeks, days, hours, minutes, seconds] = m.map((v) =>
    v == null ? null : Number(v),
  );

  // Convert years and months to days (n8n has no years/months unit)
  const extraDays = (years || 0) * 365 + (months || 0) * 30 + (weeks || 0) * 7;
  const totalDays = (days || 0) + extraDays;
  const approximate = (years || 0) > 0 || (months || 0) > 0;

  // Pure single-unit cases (no conversion needed)
  if (seconds != null && !hours && !minutes && !totalDays)
    return { amount: seconds, unit: "seconds" };
  if (minutes != null && !hours && !totalDays && !seconds)
    return { amount: minutes, unit: "minutes" };
  if (hours != null && !totalDays && !minutes && !seconds) return { amount: hours, unit: "hours" };
  if (totalDays > 0 && !hours && !minutes && !seconds)
    return { amount: totalDays, unit: "days", approximate };

  // Mixed durations: convert everything to seconds, then pick the largest whole unit.
  const totalSec = totalDays * 86400 + (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
  if (totalSec % 86400 === 0) return { amount: totalSec / 86400, unit: "days", approximate };
  if (totalSec % 3600 === 0) return { amount: totalSec / 3600, unit: "hours" };
  if (totalSec % 60 === 0) return { amount: totalSec / 60, unit: "minutes" };
  return { amount: totalSec, unit: "seconds" };
}

// kebabCase — convert camelCase or other formats to kebab-case.
function _kebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase → kebab
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2") // letter followed by digit
    .replace(/\s+/g, "-") // spaces
    .toLowerCase();
}

// generateWebhookId — generate a random UUID-style webhook id.
function _generateWebhookId() {
  return crypto.randomUUID();
}

// deterministicWebhookId — generate a deterministic UUID from a seed string.
// Used for MessageEventDefinition webhooks so tests are reproducible.
function deterministicWebhookId(seed) {
  // Simple deterministic hash: convert string to hex pairs
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit int
  }

  // Convert hash to UUID-like format (8-4-4-4-12 hex digits)
  const hex = Math.abs(hash).toString(16).padStart(32, "0");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join("-");
}

module.exports = emitIntermediateCatchEvent;

if (require.main === module) {
  console.log(
    "timerEvent.js — activities library module. Import via activities/index.js. Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
