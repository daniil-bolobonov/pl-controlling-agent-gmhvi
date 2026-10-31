// juel.test.js — regression suite for the Java JUEL parser + emitter.
//
// Lives at repo root under tests/, not inside the sbpa-to-n8n/ skill.
//
// Run from the repo root: `node tests/juel.test.js`.
// Exits 0 on green, 1 on any failure. No test framework.
//
// This file covers JUEL — used for SequenceFlow.condition and every `${…}`
// interpolation site (MailDefinition.to/subject/html and any future field).
// The MAPPING-formula grammar has its own tests in formula.test.js.

const {
  translateJuel,
  translateJuelWrapped,
  translateJuelInterpolated,
} = require("../scripts/juel");

const resolver = {
  predecessorId: null,
  nodeName: (id) =>
    ({
      startEvent: "StartEvent",
      script_1: "Script Task",
      ut_approval: "MApproval",
    })[id] || id,
  customInitName: "Initialize Custom Data",
};

const cases = [
  // ---- Literals ----
  { name: "number literal", source: "42", expected: `={{ 42 }}` },
  { name: "string literal", source: '"hi"', expected: `={{ "hi" }}` },
  { name: "single-quoted string (JUEL accepts both)", source: "'hi'", expected: `={{ "hi" }}` },
  { name: "bool true", source: "true", expected: `={{ true }}` },
  { name: "null", source: "null", expected: `={{ null }}` },

  // ---- Symbolic operators ----
  { name: "symbolic <=", source: "x <= 10", expected: `={{ x <= 10 }}` },
  { name: "symbolic &&", source: "x && y", expected: `={{ x && y }}` },
  { name: "symbolic ==", source: 'x == "gold"', expected: `={{ x == "gold" }}` },

  // ---- Word-form operator aliases normalize to symbols ----
  { name: "word-form gt", source: "x gt 10", expected: `={{ x > 10 }}` },
  { name: "word-form le", source: "x le 10", expected: `={{ x <= 10 }}` },
  { name: "word-form eq", source: 'x eq "gold"', expected: `={{ x == "gold" }}` },
  { name: "word-form ne", source: "x ne null", expected: `={{ x != null }}` },
  { name: "word-form and", source: "x and y", expected: `={{ x && y }}` },
  { name: "word-form or", source: "x or y", expected: `={{ x || y }}` },
  { name: "word-form not", source: "not x", expected: `={{ !x }}` },
  { name: "word-form mod", source: "x mod 2", expected: `={{ x % 2 }}` },
  { name: "word-form div", source: "x div 2", expected: `={{ x / 2 }}` },

  // ---- empty operator (JS approximation) ----
  { name: "empty x", source: "empty x", expected: `={{ ((x) == null || (x).length === 0) }}` },
  {
    name: "not empty x",
    source: "not empty x",
    expected: `={{ !((x) == null || (x).length === 0) }}`,
  },

  // ---- Ternary ----
  { name: "ternary", source: 'x > 0 ? "pos" : "neg"', expected: `={{ (x > 0 ? "pos" : "neg") }}` },

  // ---- Property access (dot AND bracket produce same output when the
  // key is a static string identifier)
  { name: "dot access", source: "foo.bar.baz", expected: `={{ foo.bar.baz }}` },
  {
    name: "bracket with string equals dot",
    source: 'foo["bar"].baz',
    expected: `={{ foo.bar.baz }}`,
  },
  {
    name: "bracket with number (array index)",
    source: "foo[0].name",
    expected: `={{ foo[0].name }}`,
  },

  // ---- context.<...> paths — the resolver protocol still applies ----
  {
    name: "context.startEvent path resolves to $('StartEvent')",
    source: "context.startEvent.customer.tier",
    expected: `={{ $('StartEvent').item.json.customer.tier }}`,
  },
  {
    name: "context.custom path resolves to init node",
    source: "context.custom.total gt 100",
    expected: `={{ $('Initialize Custom Data').item.json.custom.total > 100 }}`,
  },

  // ---- Function calls ----
  { name: "bare function call", source: "max(a, b)", expected: `={{ max(a, b) }}` },
  {
    name: "namespaced function call flattens with underscore",
    source: "math:max(a, b)",
    expected: `={{ math_max(a, b) }}`,
  },

  // ---- Combined: real-shape gateway condition ----
  {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    name: "gateway condition wrapped in ${}",
    wrapped: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: "${context.custom.normalizedtotals.gross <= 10000}",
    expected: `={{ $('Initialize Custom Data').item.json.custom.normalizedtotals.gross <= 10000 }}`,
  },
  {
    name: "gateway condition with word-form ops",
    wrapped: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: "${totals.gross gt 10000 and not empty items}",
    expected: `={{ totals.gross > 10000 && !((items) == null || (items).length === 0) }}`,
  },

  // ---- Interpolated strings (mail body/subject) ----
  {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    name: "mail HTML body with one ${}",
    interp: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: "<p>please check this order: ${context.startEvent.orderid} .</p>",
    expected: `={{ "<p>please check this order: " + ($('StartEvent').item.json.orderid) + " .</p>" }}`,
  },
  {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    name: "mail body with no ${} stays literal",
    interp: true,
    source: "Static subject line",
    expected: "Static subject line",
  },
  {
    name: "interpolated with ternary inside",
    interp: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: 'Welcome, ${customer.tier eq "gold" ? "VIP" : "guest"}!',
    expected: `={{ "Welcome, " + ((customer.tier == "gold" ? "VIP" : "guest")) + "!" }}`,
  },

  // ---- usertasks.* paths (UserTask decision references) ----
  {
    name: "usertasks.<id>.last.decision resolves to result.response",
    wrapped: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: '${usertasks.ut_approval.last.decision == "approve"}',
    expected: `={{ $('MApproval').item.json.result.response == "approve" }}`,
  },
  {
    name: "usertasks.<id>.last.decision in inequality condition",
    wrapped: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: '${usertasks.ut_approval.last.decision != "reject"}',
    expected: `={{ $('MApproval').item.json.result.response != "reject" }}`,
  },
  {
    name: "usertasks.<id> without decision suffix → item.json accessor",
    wrapped: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JUEL expression syntax
    source: "${usertasks.ut_approval.last.subject != null}",
    expected: `={{ $('MApproval').item.json.last.subject != null }}`,
  },
];

let failed = 0;
for (const c of cases) {
  let actual;
  if (c.wrapped) actual = translateJuelWrapped(c.source, resolver);
  else if (c.interp) actual = translateJuelInterpolated(c.source, resolver);
  else actual = translateJuel(c.source, resolver);

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
