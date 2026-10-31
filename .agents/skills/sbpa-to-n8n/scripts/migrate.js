#!/usr/bin/env node
// migrate.js — CLI entry point for the SBPA → n8n skill.
//
// Usage:
//   node migrate.js <input> [out-dir]
//
// <input> may be:
//   - A single .json or .workflow flat WFS model file
//   - A directory of .json/.workflow flat WFS model files (top-level only)
//   - A .mtar or .zip archive
//   - An unpacked SBPA project directory (contains META-INF/mtad.yaml)
//   - A fixture directory containing exactly one .mtar/.zip
//
// One-arg mode:
//   node migrate.js <fixture-dir-or-mtar>
//   → out-dir defaults to `<input-dir>/out/`. Convenient for ad-hoc runs when
//     you want the emitted workflows to land next to their source.
//
// Two-arg mode:
//   node migrate.js <input> <out-dir>
//   → out-dir may be absolute (used verbatim) or relative. Relative paths are
//     resolved against the *input's* directory, not the CWD — so
//     `migrate.js fixtures/simple-order-management/ golden` writes to
//     `fixtures/simple-order-management/golden/` regardless of where you run
//     from. Migration.test.js relies on this to bootstrap goldens in place.
//
// Writes into out-dir:
//   <processIdentifier>.workflow.json    one per bpi.process
//   credential-stubs.json                     stubs for each environment-variable
//   report.json                          gaps for the LLM stage to review
//   backlog.json                         cumulative per-file error log (flat-dir mode)

const fs = require("node:fs");
const path = require("node:path");
const { unpack, unpackFlat } = require("./unpack");
const { convert } = require("./graph");
const {
  MODULE_MISSING,
  NO_TRIGGER_BINDING,
  TRIGGER_EVENT_MANUAL_TOPIC,
  ACTION_BINDING_MISSING,
  DESTINATION_MISSING,
  TIMER_DURATION_UNPARSED,
  CATCH_EVENT_DEFINITION_MISSING,
  UNRESOLVED_SUBFLOW,
  UNKNOWN_CLASS_DEFINITION,
  GATEWAY_CONDITION_TRANSLATE_FAILURE,
  FORMULA_PARSE_FAILURE,
  UNPARSEABLE_UNQUOTED_KEYS,
  PARSE_ERROR,
  NO_GRAPH,
} = require("./report-kinds");
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: node migrate.js <input> [out-dir]\n" +
        "\n" +
        "<input> may be:\n" +
        "  A .mtar or .zip archive\n" +
        "  An unpacked SBPA project directory (contains META-INF/mtad.yaml)\n" +
        "  A fixture directory containing exactly one .mtar/.zip\n" +
        "  A single .workflow.json flat WFS file\n" +
        "  A directory of .json/.workflow flat WFS model files\n" +
        "\n" +
        "out-dir defaults to <input>/out/ if omitted.\n" +
        "\n" +
        "Outputs (in out-dir):\n" +
        "  <processIdentifier>.workflow.json  one per bpi.process artifact\n" +
        "  credential-stubs.json                   destination credential stubs\n" +
        "  report.json                        unresolved items for LLM review\n" +
        "\n" +
        "Exit codes: 0 success, 1 migration error, 2 usage error",
    );
    process.exit(0);
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const [inputArg, outArg] = positional;
  if (!inputArg) {
    console.error(
      "usage: node migrate.js <mtar-or-project-dir | workflow.json | dir-of-jsons> [out-dir]",
    );
    process.exit(2);
  }

  const input = resolveInput(inputArg);
  const outDir = resolveOutDir(inputArg, outArg);
  fs.mkdirSync(outDir, { recursive: true });

  if (input.mode === "flat-file") {
    runSingleFlat(input.path, outDir);
  } else if (input.mode === "flat-dir") {
    runFlatDir(input.path, outDir);
  } else {
    runMtar(input.path, outDir);
  }
}

// ---------------------------------------------------------------------------
// mtar / unpacked-project mode (existing behaviour)
// ---------------------------------------------------------------------------

function runMtar(inputPath, outDir) {
  const archive = unpack(inputPath);
  const stagingDir = `${outDir}.tmp`;
  try {
    const reports = [];

    // Declared-but-not-bundled modules (typically ap_store action packs referenced
    // via `deployed-after` in mtad.yaml) surface as report entries so the LLM
    // review stage can flag any process node that references their actions.
    // The migration itself continues — an ActionTask pointing at a missing
    // module falls through action resolution and emits its own report entry.
    for (const m of archive.missingModules || []) {
      reports.push({
        kind: MODULE_MISSING,
        moduleName: m.name,
        declaredPath: m.path,
        message: `module "${m.name}" is declared in mtad.yaml (path "${m.path}") but not bundled in the archive: ${m.reason}. If any ActionTask references its actions, add the action pack to the export or wire the target manually before importing to n8n.`,
      });
    }

    const processes = Object.values(archive.artifacts).filter((a) => a.type === "bpi.process");
    if (processes.length === 0) {
      console.error("no bpi.process artifacts found in input");
      process.exit(1);
    }

    fs.mkdirSync(stagingDir, { recursive: true });

    const outFiles = [];
    for (const proc of processes) {
      let workflow, report;
      ({ workflow, report } = convert(proc, archive));
      if (report?.length) {
        reports.push(...report.map((r) => ({ ...r, process: proc.identifier || proc.uid })));
      }
      if (!workflow) {
        console.error(`skipped ${proc.identifier}: no graph`);
        continue;
      }
      const filename = `${proc.identifier}.workflow.json`;
      fs.writeFileSync(path.join(stagingDir, filename), `${JSON.stringify(workflow, null, 2)}\n`);
      outFiles.push(filename);
    }

    // Credentials stub — one entry per destination.
    const credentials = buildCredentials(archive);
    fs.writeFileSync(
      path.join(stagingDir, "credential-stubs.json"),
      `${JSON.stringify(credentials, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(stagingDir, "report.json"), `${JSON.stringify(reports, null, 2)}\n`);

    // Atomically replace the output directory.
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, outDir);

    const missingCount = (archive.missingModules || []).length;
    process.stderr.write(
      `migrated ${outFiles.length} workflow(s): ${outFiles.join(", ")}\n` +
        `credentials stubs: ${credentials.length}\n` +
        `review items: ${reports.length}\n` +
        (missingCount ? `missing modules: ${missingCount} (see report.json)\n` : "") +
        `out dir: ${outDir}\n`,
    );
  } finally {
    archive.cleanup();
    // Remove staging dir if it still exists (i.e. rename never happened due to an error).
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Flat single-file mode
// ---------------------------------------------------------------------------

function runSingleFlat(filePath, outDir) {
  const archive = unpackFlat(filePath);
  const reports = [];

  const outFiles = [];

  const processes = Object.values(archive.artifacts).filter((a) => a.type === "bpi.process");
  for (const proc of processes) {
    let workflow, report;
    ({ workflow, report } = convert(proc, archive));
    if (report?.length) {
      reports.push(...report.map((r) => ({ ...r, process: proc.identifier || proc.uid })));
    }
    if (!workflow) {
      console.error(`skipped ${proc.identifier}: no graph`);
      continue;
    }
    const filename = `${proc.identifier}.workflow.json`;
    fs.writeFileSync(path.join(outDir, filename), `${JSON.stringify(workflow, null, 2)}\n`);
    outFiles.push(filename);
  }

  const credentials = buildCredentialsFromReports(reports);
  if (credentials.length) {
    fs.writeFileSync(
      path.join(outDir, "credential-stubs.json"),
      `${JSON.stringify(credentials, null, 2)}\n`,
    );
  }

  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(reports, null, 2)}\n`);

  process.stderr.write(
    `migrated ${outFiles.length} workflow(s): ${outFiles.join(", ")}\n` +
      `review items: ${reports.length}\n` +
      `out dir: ${outDir}\n`,
  );
}

// ---------------------------------------------------------------------------
// Flat directory (batch) mode
// ---------------------------------------------------------------------------

// Kinds that are correct behaviour in flat mode or have safe fallbacks —
// informational only, not surfaced in the gap summary.
const INFORMATIONAL_KINDS = new Set([
  NO_TRIGGER_BINDING, // every flat-mode process emits manualTrigger; expected
  ACTION_BINDING_MISSING, // placeholder httpRequest is the right flat-mode output
  DESTINATION_MISSING, // same — no archive context available
  TIMER_DURATION_UNPARSED, // emits 1-second wait as placeholder; safe fallback
  UNRESOLVED_SUBFLOW, // executeWorkflow stub with empty workflowId is correct current output;
  // cross-file resolution is a planned post-pass (backlog item 16)
]);

function reportsToGapErrors(reports) {
  return reports
    .filter((r) => !INFORMATIONAL_KINDS.has(r.kind))
    .map((r) => {
      // Carry the most useful sub-detail per kind for the summary display.
      let detail;
      if (r.kind === UNKNOWN_CLASS_DEFINITION) detail = r.classDefinition;
      else if (r.kind === UNRESOLVED_SUBFLOW) detail = r.sbpaId || r.message;
      else if (r.kind === TIMER_DURATION_UNPARSED) detail = r.duration || r.message;
      else if (r.kind === CATCH_EVENT_DEFINITION_MISSING) detail = r.sbpaId || r.message;
      else if (r.kind === TRIGGER_EVENT_MANUAL_TOPIC) detail = r.sbpaId || r.message;
      else if (r.kind === GATEWAY_CONDITION_TRANSLATE_FAILURE) detail = r.expression || r.message;
      else if (r.kind === FORMULA_PARSE_FAILURE) detail = r.formula || r.message;
      return { kind: r.kind, message: r.message || r.kind, detail };
    });
}

function runFlatDir(dirPath, outDir) {
  const flatFiles = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".json") || f.endsWith(".workflow"));

  if (flatFiles.length === 0) {
    console.error(`no .json or .workflow files found in ${dirPath}`);
    process.exit(1);
  }

  let totalWorkflows = 0;
  let totalReportItems = 0;
  const allReports = [];
  // gaps: filePath → error[] for files that need attention
  const gaps = {};

  for (const fname of flatFiles) {
    const filePath = path.join(dirPath, fname);
    const fileErrors = [];

    let archive;
    try {
      archive = unpackFlat(filePath);
    } catch (err) {
      const isUnquotedKeys =
        err instanceof SyntaxError && /Expected double-quoted property name/i.test(err.message);
      fileErrors.push({
        kind: isUnquotedKeys ? UNPARSEABLE_UNQUOTED_KEYS : PARSE_ERROR,
        message: isUnquotedKeys
          ? "file uses JavaScript-style unquoted object keys (not valid JSON)"
          : err.message,
      });
      gaps[filePath] = fileErrors;
      continue;
    }

    const processes = Object.values(archive.artifacts).filter((a) => a.type === "bpi.process");
    if (processes.length === 0) {
      fileErrors.push({ kind: NO_GRAPH, message: "no bpi.process model found in file" });
      gaps[filePath] = fileErrors;
      continue;
    }

    for (const proc of processes) {
      let workflow, report;
      try {
        ({ workflow, report } = convert(proc, archive));
      } catch (err) {
        fileErrors.push({ kind: PARSE_ERROR, message: `convert failed: ${err.message}` });
        continue;
      }
      if (report?.length) {
        const tagged = report.map((r) => ({ ...r, process: proc.identifier || proc.uid }));
        allReports.push(...tagged);
        totalReportItems += tagged.length;
        fileErrors.push(...reportsToGapErrors(tagged));
      }
      if (!workflow) {
        fileErrors.push({
          kind: NO_GRAPH,
          message: `convert returned no workflow for ${proc.identifier}`,
        });
        continue;
      }
      const filename = `${proc.identifier}.workflow.json`;
      fs.writeFileSync(path.join(outDir, filename), `${JSON.stringify(workflow, null, 2)}\n`);
      totalWorkflows++;
    }

    if (fileErrors.length > 0) gaps[filePath] = fileErrors;
  }

  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(allReports, null, 2)}\n`);

  const credentials = buildCredentialsFromReports(allReports);
  if (credentials.length) {
    fs.writeFileSync(
      path.join(outDir, "credential-stubs.json"),
      `${JSON.stringify(credentials, null, 2)}\n`,
    );
  }

  // Tier classification for unknown-class-definition entries.
  const TIER2_CLASSES = new Set([
    "com.sap.bpm.wfs.UserTask",
    "com.sap.bpm.wfs.BoundaryEvent",
    "com.sap.bpm.wfs.TerminateEventDefinition",
    "com.sap.bpm.wfs.EscalationEventDefinition",
    "com.sap.bpm.wfs.IntermediateThrowEvent",
    "com.sap.bpm.wfs.MessageEventDefinition",
    "com.sap.bpm.wfs.ServiceTask",
    "com.sap.bpm.wfs.AutomationTask",
    "com.sap.bpm.wfs.RuleTask",
    "com.sap.bpm.wfs.NotificationTask",
    "com.sap.bpm.wfs.CaseTask",
    "com.sap.bpm.wfs.ConnectorTask",
  ]);
  const DROPPED_CLASSES = new Set([
    "com.sap.bpm.wfs.Subflow",
    "com.sap.bpm.wfs.GenericSkillTask",
    "com.sap.bpm.wfs.data.DataField",
    "com.sap.bpm.wfs.data.DataView",
  ]);

  // Build gap summary
  const unknownCounts = {}; // classDefinition → count (for unknown-class-definition)
  const parseErrors = {}; // "filename:message" → count
  const otherKinds = {}; // kind → { files, details }

  for (const [filePath, errors] of Object.entries(gaps)) {
    const fname = path.basename(filePath);
    for (const err of errors) {
      if (err.kind === UNKNOWN_CLASS_DEFINITION) {
        const cd = err.detail || err.classDefinition || "?";
        unknownCounts[cd] = (unknownCounts[cd] || 0) + 1;
      } else if (err.kind === PARSE_ERROR) {
        const key = `${fname}: ${(err.message || "").slice(0, 100)}`;
        parseErrors[key] = (parseErrors[key] || 0) + 1;
      } else {
        if (!otherKinds[err.kind]) otherKinds[err.kind] = { files: new Set(), details: {} };
        otherKinds[err.kind].files.add(fname);
        if (err.detail) {
          otherKinds[err.kind].details[err.detail] =
            (otherKinds[err.kind].details[err.detail] || 0) + 1;
        }
      }
    }
  }

  let summary =
    `processed ${flatFiles.length} file(s)\n` +
    `migrated ${totalWorkflows} workflow(s)\n` +
    `review items: ${totalReportItems}\n` +
    `gap files: ${Object.keys(gaps).length}\n`;

  // unknown-class-definition: split into tiers
  if (Object.keys(unknownCounts).length > 0) {
    const tier2 = {},
      dropped = {},
      other = {};
    for (const [cd, n] of Object.entries(unknownCounts)) {
      if (TIER2_CLASSES.has(cd)) tier2[cd] = n;
      else if (DROPPED_CLASSES.has(cd)) dropped[cd] = n;
      else other[cd] = n;
    }
    const printGroup = (label, group) => {
      const entries = Object.entries(group).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return "";
      let s = `  ${label}\n`;
      for (const [cd, n] of entries) {
        s += `    ${String(n).padStart(4)}x  ${cd}\n`;
      }
      return s;
    };
    summary += `\nunknown-class-definition:\n`;
    summary += printGroup("tier 2 (planned emitters):", tier2);
    summary += printGroup("permanently dropped:", dropped);
    summary += printGroup("other (not yet classified):", other);
  }

  // parse-error: show filename + message
  if (Object.keys(parseErrors).length > 0) {
    summary += `\nparse-error:\n`;
    for (const [key, n] of Object.entries(parseErrors).sort((a, b) => b[1] - a[1])) {
      summary += `  ${String(n).padStart(4)}x  ${key}\n`;
    }
  }

  // other gap kinds
  const sorted = Object.entries(otherKinds).sort((a, b) => b[1].files.size - a[1].files.size);
  if (sorted.length > 0) {
    summary += `\nother gaps:\n`;
    for (const [kind, { files, details }] of sorted) {
      summary += `  ${String(files.size).padStart(4)}  ${kind}\n`;
      const detailEntries = Object.entries(details).sort((a, b) => b[1] - a[1]);
      for (const [detail, count] of detailEntries.slice(0, 8)) {
        summary += `         ${String(count).padStart(4)}x  ${detail}\n`;
      }
      if (detailEntries.length > 8) {
        summary += `               … +${detailEntries.length - 8} more\n`;
      }
    }
  }

  summary += `\nout dir: ${outDir}\n`;
  process.stderr.write(summary);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildCredentials(archive) {
  return Object.values(archive.destinations).map((d) => ({
    name: `SBPA destination: ${d.identifier}`,
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: "" },
    _sbpa: {
      identifier: d.identifier,
      artifactUid: d.uid,
      note: `Fill in an Authorization header value (e.g. "Bearer <token>") or replace with the credential type your destination expects. Also set n8n Variable "${varSafe(d.identifier)}_baseUrl" to the destination base URL.`,
    },
  }));
}

// Build credential stubs from destination-missing report entries.
// Used in flat mode where archive.destinations is empty — the destination
// name is known from the report even without the full artifact.
function buildCredentialsFromReports(reports) {
  const seen = new Set();
  const creds = [];
  for (const r of reports) {
    if (r.kind === "destination-missing" && r.destination && !seen.has(r.destination)) {
      seen.add(r.destination);
      creds.push({
        name: `SBPA destination: ${r.destination}`,
        type: "httpHeaderAuth",
        data: { name: "Authorization", value: "" },
        _sbpa: {
          identifier: r.destination,
          note: `Fill in an Authorization header value (e.g. "Bearer <token>") or replace with the credential type your destination expects. Also set n8n Variable "${varSafe(r.destination)}_baseUrl" to the destination base URL.`,
        },
      });
    }
    if (
      r.kind === "dynamic-destination" &&
      r.dispatchCredential &&
      !seen.has(r.dispatchCredential)
    ) {
      seen.add(r.dispatchCredential);
      const safeId = varSafe((r.destination || "").replace(/^\$\{|\}$/g, ""));
      creds.push({
        name: r.dispatchCredential,
        type: "httpHeaderAuth",
        data: { name: "Authorization", value: "" },
        _sbpa: {
          identifier: r.destination,
          dynamic: true,
          note: `This destination is resolved at runtime from "${r.destination}". A scenario-specific dispatch endpoint must be deployed that reads the X-Destination header and routes to the real target. Fill in the dispatch endpoint base URL as n8n Variable "${safeId}_baseUrl" and set the Authorization credential for the dispatch endpoint.`,
        },
      });
    }
  }
  return creds;
}

// ---------------------------------------------------------------------------
// Input / output path resolution
// ---------------------------------------------------------------------------

// Auto-detect the actual SBPA source when the caller passes a fixture
// directory (as opposed to a bare .mtar or an unpacked project).
//
// A fixture directory has this shape:
//   fixtures/<name>/
//   ├── <Something>.mtar         ← the archive we should hand to unpack
//   ├── expected.json
//   └── golden/                  ← checked-in migrator output
//
// Resolution order:
//   1. If the path is a .json or .workflow file, treat as flat WFS model.
//   2. If it's a .mtar or .zip file, use it verbatim.
//   3. If it's a directory containing META-INF/mtad.yaml, it IS an unpacked
//      project — use it verbatim.
//   4. If it's a directory containing exactly one .mtar/.zip file, use that.
//   5. If it's a directory containing .json/.workflow files, use flat-dir mode.
//   6. Otherwise fall through — unpack.js will complain with a clearer error
//      than we'd produce here.
// Returns { mode: 'mtar'|'flat-file'|'flat-dir', path: string }
function resolveInput(inputArg) {
  const abs = path.resolve(inputArg);
  const stat = fs.statSync(abs);

  if (!stat.isDirectory()) {
    // Single file — flat WFS model or archive
    if (abs.endsWith(".json") || abs.endsWith(".workflow")) return { mode: "flat-file", path: abs };
    return { mode: "mtar", path: abs };
  }

  // Directory: check for mtar markers first
  if (fs.existsSync(path.join(abs, "META-INF", "mtad.yaml"))) return { mode: "mtar", path: abs };

  const entries = fs.readdirSync(abs);
  const archives = entries.filter((e) => e.endsWith(".mtar") || e.endsWith(".zip"));
  if (archives.length === 1) return { mode: "mtar", path: path.join(abs, archives[0]) };
  if (archives.length > 1) {
    throw new Error(
      `fixture directory ${abs} contains multiple archives (${archives.join(", ")}) — pass one explicitly`,
    );
  }

  // No archive markers — check for flat WFS files (top-level only)
  const flatFiles = entries.filter((e) => e.endsWith(".json") || e.endsWith(".workflow"));
  if (flatFiles.length > 0) return { mode: "flat-dir", path: abs };

  // Nothing detected — let unpack() produce a clear error
  return { mode: "mtar", path: abs };
}

// Resolve the output directory from the input path + optional out-dir arg.
//
//   inputDir = the directory that "contains" the SBPA input
//              (the project dir itself if unpacked, or the dir holding the
//              archive if input is an .mtar).
//
//   no outArg          → `<inputDir>/out/`
//   absolute outArg    → outArg verbatim
//   relative outArg    → path.resolve(inputDir, outArg) — resolved against
//                        the input's location, not process.cwd(). This means
//                        `migrate.js fixtures/foo/ golden` always writes to
//                        `fixtures/foo/golden/`, regardless of where the
//                        caller happens to be.
function resolveOutDir(input, outArg) {
  const inputAbs = path.resolve(input);
  const inputStat = fs.statSync(inputAbs);
  const inputDir = inputStat.isDirectory() ? inputAbs : path.dirname(inputAbs);

  if (!outArg) return path.join(inputDir, "out");
  if (path.isAbsolute(outArg)) return outArg;
  return path.resolve(inputDir, outArg);
}

function varSafe(s) {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

if (require.main === module) main(process.argv);
