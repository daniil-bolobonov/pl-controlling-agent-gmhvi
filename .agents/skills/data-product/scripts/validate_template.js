#!/usr/bin/env node
/**
 * Data Product Static Validator — Template
 * -----------------------------------------
 * Generic validation framework for a derived data product.
 *
 * Usage: copy this file to your data product asset folder as validate.js,
 * then add data-product-specific structural and conformance checks in the designated sections.
 * Most metadata is derived automatically from the `.dpd` file at runtime.
 *
 * Structure:
 *   Section 1 — Structure Tests           : Data product has been generated successfully and is valid (generic, no changes needed)
 *   Section 2 — Data Product Conformance  : CDS authoring rules + compilation + structural patterns + PRD business rules (generic rules need no changes; author PRD-specific checks below)
 *
 * Outputs: test_report.json
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

// ── Constants (auto-derived — no manual setup needed) ─────────────────────────
const ASSET_DIR = __dirname;
const TRANSFORMATION_CDS = path.join(ASSET_DIR, "transformation.cds");
const TRANSFORMATION_CDS_CONTENT = (() => {
  try {
    return fs.readFileSync(TRANSFORMATION_CDS, "utf8");
  } catch {
    return null;
  }
})();
const REPORT_FILE = path.join(ASSET_DIR, "test_report.json");

const _dpdFiles = fs.readdirSync(ASSET_DIR).filter((f) => f.endsWith(".dpd"));
if (_dpdFiles.length !== 1) {
  console.error(`Expected 1 .dpd file in asset folder, found ${_dpdFiles.length}`);
  process.exit(1);
}
const DPD_FILENAME = _dpdFiles[0];
const DPD_FILE = path.join(ASSET_DIR, DPD_FILENAME);
let dpd = null;
let dpdParseError = null;
try {
  dpd = JSON.parse(fs.readFileSync(DPD_FILE, "utf8"));
} catch (error) {
  dpdParseError = error instanceof Error ? error.message : String(error);
}
const ENTITY_NAME =
  Object.keys(dpd?.definition?.target?.definition?.definitions ?? {})[0] ?? "(unknown)";

// ── Helpers ───────────────────────────────────────────────────────────────────
const results = [];

function record(section, name, status, reason, duration = 0.0) {
  results.push({
    section,
    name,
    status,
    reason,
    duration: Math.round(duration * 10000) / 10000,
  });
  const icon = status === "pass" ? "✓" : status === "fail" ? "✗" : "~";
  console.log(`  [${icon}] ${name}`);
}

function runCmd(cmd) {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", rc: 0 };
  } catch (e) {
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      rc: e.status || 1,
    };
  }
}

function grep(pattern, content, flags = "s") {
  if (!content) return false;
  return new RegExp(pattern, flags).test(content);
}

// Prefer this over grep() when your pattern contains special regex characters.
// Pass a RegExp literal directly — no string escaping needed.
// Example: grepRegex(/SO\.SalesOrder\s*=\s*BDI\.SalesDocument/, TRANSFORMATION_CDS_CONTENT)
function grepRegex(regex, content) {
  if (!content) return false;
  return regex.test(content);
}

// Like grep() but searches only the final view definition (from `define view` to end-of-file).
// Use for structural and business rule checks — avoids false positives from source entity definitions.
function grepView(pattern, content, flags = "s") {
  if (!content) return false;
  const start = content.search(/\bdefine view\b/i);
  if (start === -1) return false;
  return new RegExp(pattern, flags).test(content.slice(start));
}

// Like grepRegex() but restricted to the final view definition.
function grepViewRegex(regex, content) {
  if (!content) return false;
  const start = content.search(/\bdefine view\b/i);
  if (start === -1) return false;
  return regex.test(content.slice(start));
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Structure Tests (generic — no changes needed)
// One test: confirms the data product was generated successfully and is valid.
// ══════════════════════════════════════════════════════════════════════════════
console.log("\nSection 1: Structure Tests");

let t0 = Date.now();
if (!fs.existsSync(DPD_FILE)) {
  record(
    "structure",
    "Data product has been generated successfully and is valid",
    "fail",
    "Data product definition file not found — run generate-interop first",
    (Date.now() - t0) / 1000,
  );
} else if (dpd) {
  record(
    "structure",
    "Data product has been generated successfully and is valid",
    "pass",
    "Data product definition file exists and passed interop specification validation",
    (Date.now() - t0) / 1000,
  );
} else {
  record(
    "structure",
    "Data product has been generated successfully and is valid",
    "fail",
    `Data product definition file exists but could not be parsed: ${dpdParseError}`,
    (Date.now() - t0) / 1000,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Data Product Conformance Tests
// Compilation and DPD checks run first, then CDS authoring rules, then PRD checks.
// Generic blocks (marked "no changes needed") require no authoring.
// Add PRD-specific structural patterns and business rules below.
// ══════════════════════════════════════════════════════════════════════════════
console.log("\nSection 2: Data Product Conformance Tests");

// ── Compilation (generic — no changes needed) ─────────────────────────────────
t0 = Date.now();
const {
  stdout: compileOut,
  stderr: compileErr,
  rc: compileRc,
} = runCmd(`cd "${ASSET_DIR}" && cds compile transformation.cds`);
const compileLines = `${compileOut}\n${compileErr}`
  .split(/\r?\n/)
  .filter((line) => /\[Error\]/i.test(line))
  .slice(0, 5);
const compileSummary = compileLines.join("\n").trim();
if (compileRc === 0 && compileSummary.length === 0) {
  record(
    "conformance",
    "Data product logic is free of errors",
    "pass",
    "Transformation compiled with no errors",
    (Date.now() - t0) / 1000,
  );
} else {
  record(
    "conformance",
    "Data product logic is free of errors",
    "fail",
    compileSummary ? `Errors found: ${compileSummary.slice(0, 200)}` : "Compilation failed",
    (Date.now() - t0) / 1000,
  );
}

// ── DPD structure (generic — no changes needed) ───────────────────────────────
if (dpd) {
  const requiredKeys = ["header", "outputPorts", "transformation", "inputPorts"];
  const missing = requiredKeys.filter((k) => !(k in (dpd.definition || {})));
  if (missing.length === 0) {
    record(
      "conformance",
      "Data product is complete and well-structured",
      "pass",
      `All required sections present: ${requiredKeys.join(", ")}`,
    );
  } else {
    record(
      "conformance",
      "Data product is complete and well-structured",
      "fail",
      `Missing sections: ${missing.join(", ")}`,
    );
  }
} else {
  record(
    "conformance",
    "Data product is complete and well-structured",
    "skip",
    "Skipped — data product definition could not be parsed",
  );
}

// ── Output port (fill ENTITY_NAME placeholder) ────────────────────────────────
if (dpd) {
  const defs = dpd.definition?.target?.definition?.definitions ?? {};
  if (defs[ENTITY_NAME]) {
    record(
      "conformance",
      "Data product output is correctly defined",
      "pass",
      `Entity ${ENTITY_NAME} found in DPD definitions`,
    );
  } else {
    record(
      "conformance",
      "Data product output is correctly defined",
      "fail",
      `${ENTITY_NAME} not found in DPD definitions`,
    );
  }
} else {
  record(
    "conformance",
    "Data product output is correctly defined",
    "skip",
    "Skipped — data product definition could not be parsed",
  );
}

// ── Input data products ───────────────────────────────────────────────────────
if (dpd) {
  const declaredInputs = (dpd?.definition?.inputPorts ?? [])
    .flatMap((port) => port.apiResources ?? [])
    .map((resource) => resource.ordId)
    .filter(Boolean);
  if (declaredInputs.length > 0) {
    record(
      "conformance",
      "At least one data source is connected",
      "pass",
      `Declared inputs: ${declaredInputs.join(", ")}`,
    );
  } else {
    record(
      "conformance",
      "At least one data source is connected",
      "fail",
      "No input data products declared in the data product definition",
    );
  }
} else {
  record(
    "conformance",
    "At least one data source is connected",
    "skip",
    "Skipped — data product definition could not be parsed",
  );
}

// ── CDS authoring rules (generic — no changes needed) ─────────────────────────

// ── Non-deterministic functions (SparkMV Cat 1 — hard failure at runtime) ─────
t0 = Date.now();
if (
  grepViewRegex(
    /\b(current_date|current_timestamp|now|rand|uuid|unix_timestamp)\s*\(/i,
    TRANSFORMATION_CDS_CONTENT,
  )
) {
  record(
    "conformance",
    "View contains no non-deterministic functions",
    "fail",
    "Non-deterministic function detected (current_date/current_timestamp/now/rand/uuid/unix_timestamp) — SparkMV Cat 1 failure at runtime",
    (Date.now() - t0) / 1000,
  );
} else {
  record(
    "conformance",
    "View contains no non-deterministic functions",
    "pass",
    "No non-deterministic functions found",
    (Date.now() - t0) / 1000,
  );
}

// ── No SELECT * ───────────────────────────────────────────────────────────────
t0 = Date.now();
if (grepViewRegex(/select\s+\*/i, TRANSFORMATION_CDS_CONTENT)) {
  record(
    "conformance",
    "View uses explicit column projections, not SELECT *",
    "fail",
    "SELECT * found — explicit projections required for a stable schema",
    (Date.now() - t0) / 1000,
  );
} else {
  record(
    "conformance",
    "View uses explicit column projections, not SELECT *",
    "pass",
    "No SELECT * found",
    (Date.now() - t0) / 1000,
  );
}

// ── @EndUserText.label annotation present ────────────────────────────────────
t0 = Date.now();
if (grep("@EndUserText\\.label", TRANSFORMATION_CDS_CONTENT)) {
  record(
    "conformance",
    "View carries a business label annotation",
    "pass",
    "@EndUserText.label found",
    (Date.now() - t0) / 1000,
  );
} else {
  record(
    "conformance",
    "View carries a business label annotation",
    "fail",
    "@EndUserText.label missing — required by generate-interop",
    (Date.now() - t0) / 1000,
  );
}

// ── Single define view block ──────────────────────────────────────────────────
t0 = Date.now();
if (TRANSFORMATION_CDS_CONTENT !== null) {
  const _viewCount = (TRANSFORMATION_CDS_CONTENT.match(/\bdefine view\b/gi) ?? []).length;
  if (_viewCount === 1) {
    record(
      "conformance",
      "Transformation contains exactly one output view",
      "pass",
      "One define view block found",
      (Date.now() - t0) / 1000,
    );
  } else {
    record(
      "conformance",
      "Transformation contains exactly one output view",
      "fail",
      `${_viewCount} define view blocks found — refinement may have appended a second view instead of replacing the first`,
      (Date.now() - t0) / 1000,
    );
  }
} else {
  record(
    "conformance",
    "Transformation contains exactly one output view",
    "skip",
    "Skipped — transformation.cds could not be read",
    (Date.now() - t0) / 1000,
  );
}

// ── GROUP BY present when aggregates are used ─────────────────────────────────
t0 = Date.now();
const _hasAggregates = grepViewRegex(/\b(SUM|AVG|COUNT|MIN|MAX)\s*\(/i, TRANSFORMATION_CDS_CONTENT);
const _hasGroupBy = grepView("GROUP BY", TRANSFORMATION_CDS_CONTENT);
if (_hasAggregates && !_hasGroupBy) {
  record(
    "conformance",
    "Aggregate functions are paired with a GROUP BY clause",
    "fail",
    "Aggregate found without GROUP BY — result collapses to a single-row rollup",
    (Date.now() - t0) / 1000,
  );
} else {
  record(
    "conformance",
    "Aggregate functions are paired with a GROUP BY clause",
    "pass",
    _hasAggregates
      ? "Aggregates present and GROUP BY found"
      : "No aggregates — GROUP BY not required",
    (Date.now() - t0) / 1000,
  );
}

// ── Currency and unit-of-measure fields present in GROUP BY ───────────────────
// Uses DPD entity definitions to identify annotated fields — no per-DP authoring needed.
if (dpd && _hasAggregates) {
  const _elements = dpd?.definition?.target?.definition?.definitions?.[ENTITY_NAME]?.elements ?? {};

  const _groupByContent = (() => {
    if (!TRANSFORMATION_CDS_CONTENT) return "";
    const m = TRANSFORMATION_CDS_CONTENT.match(/\bGROUP BY\b([\s\S]*)/i);
    return m ? m[1] : "";
  })();

  const _currencyFields = Object.entries(_elements)
    .filter(([, el]) => el["@Semantics.currencyCode"] === true)
    .map(([name]) => name);

  if (_currencyFields.length > 0) {
    t0 = Date.now();
    const _missingCurrency = _currencyFields.filter((f) => !_groupByContent.includes(f));
    if (_missingCurrency.length === 0) {
      record(
        "conformance",
        "Currency fields are present in GROUP BY to prevent cross-currency aggregation",
        "pass",
        `Currency field(s) found in GROUP BY: ${_currencyFields.join(", ")}`,
        (Date.now() - t0) / 1000,
      );
    } else {
      record(
        "conformance",
        "Currency fields are present in GROUP BY to prevent cross-currency aggregation",
        "fail",
        `Currency field(s) missing from GROUP BY: ${_missingCurrency.join(", ")} — amounts may be summed across mixed currencies`,
        (Date.now() - t0) / 1000,
      );
    }
  }

  const _uomFields = Object.entries(_elements)
    .filter(([, el]) => el["@Semantics.unitOfMeasure"] === true)
    .map(([name]) => name);

  if (_uomFields.length > 0) {
    t0 = Date.now();
    const _missingUom = _uomFields.filter((f) => !_groupByContent.includes(f));
    if (_missingUom.length === 0) {
      record(
        "conformance",
        "Unit of measure fields are present in GROUP BY to prevent cross-unit aggregation",
        "pass",
        `Unit of measure field(s) found in GROUP BY: ${_uomFields.join(", ")}`,
        (Date.now() - t0) / 1000,
      );
    } else {
      record(
        "conformance",
        "Unit of measure fields are present in GROUP BY to prevent cross-unit aggregation",
        "fail",
        `Unit of measure field(s) missing from GROUP BY: ${_missingUom.join(", ")} — quantities may be summed across mixed units`,
        (Date.now() - t0) / 1000,
      );
    }
  }
}

require("./validate_rules")({
  record,
  grep,
  grepRegex,
  grepView,
  grepViewRegex,
  TRANSFORMATION_CDS_CONTENT,
  dpd,
});

// ══════════════════════════════════════════════════════════════════════════════
// Summary & Report (generic — no changes needed)
// ══════════════════════════════════════════════════════════════════════════════
const total = results.length;
const passed = results.filter((r) => r.status === "pass").length;
const failed = results.filter((r) => r.status === "fail").length;
const skipped = results.filter((r) => r.status === "skip").length;

const SECTION_DEFS = [
  ["structure", "Structure Tests"],
  ["conformance", "Data Product Conformance Tests"],
];

const sectionsOut = SECTION_DEFS.map(([marker, label]) => {
  const tests = results.filter((r) => r.section === marker);
  const tTotal = tests.length;
  const tPassed = tests.filter((t) => t.status === "pass").length;
  const tFailed = tests.filter((t) => t.status === "fail").length;
  const tSkipped = tests.filter((t) => t.status === "skip").length;
  return {
    name: label,
    marker,
    total: tTotal,
    passed: tPassed,
    failed: tFailed,
    skipped: tSkipped,
    score: tTotal ? Math.round((tPassed / tTotal) * 100) : 0,
    tests: tests.map((t) => ({
      name: t.name,
      outcome: t.status === "pass" ? "passed" : t.status === "fail" ? "failed" : "skipped",
      duration: t.duration,
    })),
  };
});

const report = {
  summary: {
    total,
    passed,
    failed,
    score: total ? Math.round((passed / total) * 100) : 0,
  },
  sections: sectionsOut,
};

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

console.log(`\n${"=".repeat(60)}`);
console.log(
  `  Results: ${passed} passed / ${failed} failed / ${skipped} skipped  (total ${total})`,
);
console.log(`  Overall: ${failed === 0 ? "PASS" : "FAIL"}`);
console.log(`  Report:  ${REPORT_FILE}`);
console.log(`${"=".repeat(60)}\n`);

process.exit(failed === 0 ? 0 : 1);
