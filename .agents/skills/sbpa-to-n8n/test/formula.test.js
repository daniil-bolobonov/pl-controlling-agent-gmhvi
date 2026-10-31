// formula.test.js — regression suite for the SBPA mapping-formula parser + emitter.
//
// Lives at repo root under tests/, not inside the sbpa-to-n8n/ skill —
// the skill ships without tests so it can be published as a clean harness.
//
// Run from the repo root: `node tests/formula.test.js`.
// Exits 0 on green, 1 on any failure. No test framework — runnable on any Node 20 host.
//
// This file covers the MAPPING-formula grammar only (values inside
// `mappings.in` / `mappings.out` entries on ActionTask, EndEvent,
// ReferencedSubflow). JUEL — used in `${…}` conditions and interpolated
// string fields — lives in tests/juel.test.js.

const { translate } = require("../scripts/formula");

const resolver = {
  predecessorId: null,
  nodeName: (id) => {
    // Table maps inner SBPA short-ids → n8n display names. In real graphs
    // this is populated from artifact.translations; the fixtures here use
    // generic labels.
    const map = {
      startEvent: "StartEvent",
      script_1: "Script Task",
      subflow_1: "Sub Process",
      action_1: "HTTP Action",
    };
    return map[id] || id;
  },
  customInitName: "Initialize Custom Data",
};

const cases = [
  // ---- Baseline mapping cases (preserved from v1) ----
  {
    name: "simple context.startEvent.field access",
    source: "context.startEvent.customer.externalId",
    expected: `={{ $('StartEvent').item.json.customer.externalId }}`,
  },
  {
    name: "context.custom.<field> hits the init node",
    source: "context.custom.normalizedtotals.gross",
    expected: `={{ $('Initialize Custom Data').item.json.custom.normalizedtotals.gross }}`,
  },
  {
    name: "special `output` token",
    source: "output",
    expected: `={{ $json }}`,
  },
  {
    name: "empty object literal",
    source: "{}",
    expected: `={{ ({  }) }}`,
  },
  {
    name: "object literal with nested context refs",
    source:
      '{"gross": context.custom.normalizedtotals.gross, "net": context.custom.normalizedtotals.net, "tax": context.custom.normalizedtotals.tax}',
    expected: `={{ ({ "gross": $('Initialize Custom Data').item.json.custom.normalizedtotals.gross, "net": $('Initialize Custom Data').item.json.custom.normalizedtotals.net, "tax": $('Initialize Custom Data').item.json.custom.normalizedtotals.tax }) }}`,
  },
  {
    name: "Map(list, template) with listItem binding",
    source:
      'Map(context.startEvent.lines, {"description": listItem.description, "lineNo": listItem.lineNo, "lineTotal": listItem.lineTotal, "materialNumber": listItem.materialNumber, "quantity": listItem.quantity, "unitOfMeasure": listItem.unitOfMeasure, "unitPrice": listItem.unitPrice})',
    expected: `={{ ($('StartEvent').item.json.lines).map(item => ({ "description": item.description, "lineNo": item.lineNo, "lineTotal": item.lineTotal, "materialNumber": item.materialNumber, "quantity": item.quantity, "unitOfMeasure": item.unitOfMeasure, "unitPrice": item.unitPrice })) }}`,
  },
  {
    name: "plain string literal (used by TimerEventDefinition.timeDuration)",
    source: '"PT10M"',
    expected: `={{ "PT10M" }}`,
  },

  // ---- New literals (grammar parity with the reference Formula.g4) ----
  {
    name: "bool literal true",
    source: "true",
    expected: `={{ true }}`,
  },
  {
    name: "bool literal false",
    source: "false",
    expected: `={{ false }}`,
  },
  {
    name: "null literal",
    source: "null",
    expected: `={{ null }}`,
  },
  {
    name: "undefined literal",
    source: "undefined",
    expected: `={{ undefined }}`,
  },

  // ---- Array literals + indexing ----
  {
    name: "array literal",
    source: "[1, 2, 3]",
    expected: `={{ [1, 2, 3] }}`,
  },
  {
    name: "array index on a context path",
    source: "context.startEvent.lines[0].materialNumber",
    expected: `={{ $('StartEvent').item.json.lines[0].materialNumber }}`,
  },

  // ---- Object keys: bare name AND dynamic ----
  {
    name: "object with bare-name key",
    source: "{key: 1}",
    expected: `={{ ({ "key": 1 }) }}`,
  },

  // ---- Named function parameters ----
  {
    name: "named function parameter is flattened as a trailing object literal",
    source: "Fn(1, foo: 2)",
    expected: `={{ Fn(1, { "foo": 2 }) }}`,
  },

  // ---- Property access on a non-name (path attached to a function call) ----
  {
    name: "path after a function call",
    source: "Fn().x",
    expected: `={{ Fn().x }}`,
  },

  // ---- Arithmetic ----
  {
    name: "arithmetic + and *",
    source: "context.startEvent.a * 2 + context.startEvent.b",
    expected: `={{ $('StartEvent').item.json.a * 2 + $('StartEvent').item.json.b }}`,
  },
];

let failed = 0;
for (const c of cases) {
  const actual = translate(c.source, resolver);
  const ok = actual.ok && actual.expression === c.expected;
  if (!ok) {
    failed++;
    console.error(`FAIL: ${c.name}`);
    console.error(`  source:   ${c.source}`);
    console.error(`  expected: ${c.expected}`);
    console.error(`  actual:   ${actual.expression}`);
    if (actual.error) console.error(`  error:    ${actual.error}`);
  } else {
    console.log(`ok: ${c.name}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
