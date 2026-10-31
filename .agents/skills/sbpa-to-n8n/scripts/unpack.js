// unpack.js — turn an SBPA .mtar (or an already-unpacked project directory) into
// an in-memory index of every artifact, keyed by uid.
//
// Zero external deps. Zip extraction shells out to /usr/bin/unzip which ships on
// every macOS/Linux worth caring about; also works under WSL and inside a Node
// container. For pure-Node zip we'd have to ship a decoder — deferred until we
// hit a runtime that lacks unzip.
//
// The tree an SBPA .mtar carries, top-down:
//
//   META-INF/mtad.yaml               declares modules and their paths
//   META-INF/MANIFEST.MF
//   lobby/lobby_project.json
//   <module>/content.zip             one per module in mtad.yaml
//     └── package.json               (only in "actions" projects)
//     └── project.json               (only in "spa" projects — the process module)
//     └── checksum.json
//     └── <artifactUid>/artifact.json     one folder per artifact
//                     /<companionUid>     optional; the graph, for bpi.process
//
// Actions modules flatten differently: files sit at content.zip root, prefixed
// with the module id (e.g. "eu10-canary...ordermanagementactionsactions.json").
//
// **Declared-but-not-bundled modules.** mtad.yaml can reference modules that
// aren't packaged in the archive itself — typically external action packs
// from the ap_store, listed under a process module's `deployed-after`. Those
// modules resolve at deploy time on the SBPA tenant, not at export time. We
// don't fail the whole unpack: the missing entries are recorded in the
// returned `missingModules[]`, and each module in `modules[]` gets a
// `missing: true` flag with `root: null` so callers can distinguish present
// modules from placeholders. The migrator surfaces these as `module-missing`
// report entries so the LLM review stage can flag any downstream references.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

/**
 * @param {string} inputPath  either a .mtar/.zip file or an already-unpacked project dir
 * @returns {{
 *   rootDir: string,
 *   mtad: object,                            parsed mtad.yaml
 *   modules: Array<{
 *     name: string,
 *     type: string,
 *     projectType: string,
 *     root: string | null,                   null when the module is declared-but-not-bundled
 *     missing?: true,                        present only when `root` is null
 *   }>,
 *   missingModules: Array<{                  declared in mtad.yaml but no content.zip
 *     name: string,                          in the archive (typically ap_store
 *     path: string,                          references listed under `deployed-after`).
 *     reason: string,                        Never fatal — callers should surface
 *   }>,                                      these in their report/output.
 *   artifacts: Record<string, Artifact>,     keyed by uid
 *   actions: Record<string, ActionModule>,   keyed by module name
 *   destinations: Record<string, Artifact>,  environment-variable artifacts, keyed by identifier
 * }}
 *
 * @typedef {{
 *   uid: string,
 *   type: string,                            e.g. "bpi.process", "trigger.api"
 *   identifier: string,
 *   name: string,
 *   header: object,
 *   artifactJson: object,                    the whole artifact.json contents
 *   companion?: object,                      parsed graph JSON if the artifact has one
 *   companionUid?: string,
 *   dir: string,                             filesystem location
 *   moduleName: string,
 * }} Artifact
 *
 * @typedef {{
 *   name: string,
 *   metadata?: object,                       parsed metadata.json
 *   openApi?: object,                        parsed open_api_spec.json (often empty)
 *   actions?: object,                        parsed actions.json
 * }} ActionModule
 */
function unpack(inputPath) {
  const stat = fs.statSync(inputPath);
  const tmpDirs = []; // temp dirs created by extractArchive — removed by cleanup()

  let rootDir;
  if (stat.isDirectory()) {
    rootDir = inputPath;
  } else {
    rootDir = extractArchive(inputPath);
    tmpDirs.push(rootDir);
  }

  // Zip-wrapped mtar: if the outer archive doesn't look like an SBPA project
  // (no META-INF/mtad.yaml at root) but contains an .mtar file, the user
  // dropped a .zip that wraps an .mtar. Extract the inner .mtar automatically.
  if (!stat.isDirectory() && !fs.existsSync(path.join(rootDir, "META-INF", "mtad.yaml"))) {
    const innerMtar = fs.readdirSync(rootDir).find((f) => /\.mtar$/i.test(f));
    if (innerMtar) {
      rootDir = extractArchive(path.join(rootDir, innerMtar));
      tmpDirs.push(rootDir);
    }
  }

  const mtad = parseMtad(path.join(rootDir, "META-INF", "mtad.yaml"));
  const modules = [];
  const missingModules = [];
  const artifacts = {};
  const actions = {};
  const destinations = {};
  const ruleServices = {}; // keyed by RuleService.SpaUid → { name, ruleServiceId, dataObjects, rules, rulesets }

  for (const mod of mtad.modules) {
    let moduleRoot;
    try {
      moduleRoot = ensureModuleUnpacked(rootDir, mod);
    } catch (err) {
      // Declared-but-not-bundled module (typically an ap_store action pack
      // listed under `deployed-after` in mtad.yaml). Its content.zip isn't
      // in the archive because it resolves at deploy time on the SBPA
      // tenant. We record the omission and keep going — migrate.js turns
      // each entry into a `module-missing` report item so the LLM review
      // stage can flag any process node that references its actions.
      // Anything else (permissions, corrupted archive) re-throws.
      const declaredZip = path.join(rootDir, mod.path);
      if (!fs.existsSync(declaredZip) && !fs.existsSync(path.dirname(declaredZip))) {
        missingModules.push({ name: mod.name, path: mod.path, reason: err.message });
        modules.push({
          name: mod.name,
          type: mod.type,
          projectType: mod.parameters?.projectType || "unknown",
          root: null,
          missing: true,
        });
        continue;
      }
      throw err;
    }
    const projectType = mod.parameters?.projectType || "unknown";
    modules.push({ name: mod.name, type: mod.type, projectType, root: moduleRoot });

    if (projectType === "com.sap.project.spa") {
      collectProcessArtifacts(moduleRoot, mod.name, artifacts, destinations);
      collectRuleRepository(moduleRoot, ruleServices);
    } else if (projectType === "com.sap.project.actions") {
      actions[mod.name] = collectActionModule(moduleRoot, mod.name);
    }
    // Unknown module types are recorded but not indexed. The migrate step will
    // flag any process-level dependencies that can't be resolved.
  }

  const cleanup = () => {
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  };

  return {
    rootDir,
    mtad,
    modules,
    missingModules,
    artifacts,
    actions,
    destinations,
    ruleServices,
    cleanup,
  };
}

// ---------------------------------------------------------------------------
// Zip / archive handling
// ---------------------------------------------------------------------------

function extractArchive(archivePath) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sbpa-unpack-"));
  runUnzip(archivePath, tmpRoot);
  return tmpRoot;
}

function ensureModuleUnpacked(rootDir, mod) {
  // mtad.yaml's `path:` names the module by its stable id, but the on-disk
  // directory may carry a version suffix (e.g. `_1.0.0`) that mtad.yaml
  // doesn't reflect. Resolve by literal path first, then fall back to
  // prefix-matching a sibling directory under rootDir.
  const declaredZip = path.join(rootDir, mod.path);
  const declaredDir = path.dirname(declaredZip);
  const declaredBase = path.basename(declaredDir);

  let zipPath = declaredZip;
  let contentDir = path.join(declaredDir, "content");

  if (!fs.existsSync(declaredDir)) {
    const sibling = fs
      .readdirSync(rootDir, { withFileTypes: true })
      .find((e) => e.isDirectory() && e.name.startsWith(`${declaredBase}_`));
    if (sibling) {
      const resolvedDir = path.join(rootDir, sibling.name);
      zipPath = path.join(resolvedDir, path.basename(mod.path));
      contentDir = path.join(resolvedDir, "content");
    }
  }

  if (fs.existsSync(contentDir) && fs.readdirSync(contentDir).length > 0) {
    return contentDir;
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error(
      `module content missing for ${mod.name}: neither ${contentDir} nor ${zipPath} exists`,
    );
  }
  fs.mkdirSync(contentDir, { recursive: true });
  runUnzip(zipPath, contentDir);
  return contentDir;
}

function runUnzip(zipPath, targetDir) {
  try {
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", targetDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : String(err);
    throw new Error(`unzip failed for ${zipPath}: ${stderr}`);
  }
}

// ---------------------------------------------------------------------------
// mtad.yaml parser
// ---------------------------------------------------------------------------
// SBPA's mtad.yaml is a small, well-structured subset of YAML: two-space
// indent, keys with string/number values, one nested `parameters:` block,
// and one `deployed-after:` list. That's it. Writing a 40-line parser is
// less risk than shipping js-yaml just for this file.

function parseMtad(mtadPath) {
  const raw = fs.readFileSync(mtadPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const out = { modules: [] };
  let currentModule = null;
  let currentSubBlock = null; // 'parameters' | 'deployed-after' | null
  let inModules = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line || line === "---" || line.startsWith("#")) continue;

    // Top-level scalar or block opener: `KEY: value` / `KEY:`
    if (!line.startsWith(" ") && !line.startsWith("-")) {
      const opener = /^([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
      if (opener && opener[1] === "modules") {
        inModules = true;
        continue;
      }
      const scalar = /^([A-Za-z_][A-Za-z0-9_-]*):\s+"?(.*?)"?\s*$/.exec(line);
      if (scalar) {
        inModules = false;
        out[scalar[1]] = stripQuotes(scalar[2]);
        continue;
      }
    }

    if (inModules) {
      // New module: `- path: "..."`
      if (/^-\s+path:/.test(line)) {
        currentModule = { parameters: {} };
        out.modules.push(currentModule);
        currentSubBlock = null;
        currentModule.path = extractYamlValue(line);
        continue;
      }
      if (!currentModule) continue;

      // Sub-block openers
      if (/^\s+parameters:\s*$/.test(line)) {
        currentSubBlock = "parameters";
        continue;
      }
      if (/^\s+deployed-after:\s*$/.test(line)) {
        currentSubBlock = "deployed-after";
        currentModule["deployed-after"] = [];
        continue;
      }

      // deployed-after list item: `  - "value"`
      const listItem = /^\s+-\s+"?(.*?)"?$/.exec(line);
      if (listItem && currentSubBlock === "deployed-after") {
        currentModule["deployed-after"].push(listItem[1]);
        continue;
      }

      // Nested scalar under parameters
      const nested = /^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*"?(.*?)"?$/.exec(line);
      if (nested) {
        const [, key, val] = nested;
        if (currentSubBlock === "parameters") {
          currentModule.parameters[key] = stripQuotes(val);
        } else {
          // top-level module scalar (name, type, etc.)
          currentSubBlock = null;
          currentModule[key] = stripQuotes(val);
        }
      }
    }
  }
  return out;
}

function extractYamlValue(line) {
  const m = /:\s*"?(.*?)"?\s*$/.exec(line);
  return m ? stripQuotes(m[1]) : "";
}

function stripQuotes(s) {
  if (s == null) return s;
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

// ---------------------------------------------------------------------------
// Process module scan
// ---------------------------------------------------------------------------

function collectProcessArtifacts(moduleRoot, moduleName, artifacts, destinations) {
  const entries = fs.readdirSync(moduleRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const artifactDir = path.join(moduleRoot, entry.name);
    const artifactJsonPath = path.join(artifactDir, "artifact.json");
    if (!fs.existsSync(artifactJsonPath)) continue;

    const artifactJson = JSON.parse(fs.readFileSync(artifactJsonPath, "utf8"));
    const uid = artifactJson.uid || entry.name;
    const type = artifactJson.type;

    const artifact = {
      uid,
      type,
      identifier: artifactJson.identifier || uid,
      name: artifactJson.name || artifactJson.identifier || uid,
      header: artifactJson.header || {},
      artifactJson,
      dir: artifactDir,
      moduleName,
    };

    // Load companion graph file if listed under contents[]. The companion is
    // an extension-less file named by its own uid.
    const contents = artifactJson.contents;
    if (Array.isArray(contents) && contents.length > 0) {
      const companionUid = contents[0].uid;
      const companionPath = path.join(artifactDir, companionUid);
      if (fs.existsSync(companionPath)) {
        artifact.companionUid = companionUid;
        try {
          artifact.companion = JSON.parse(fs.readFileSync(companionPath, "utf8"));
        } catch {
          // Non-JSON companion (rare — e.g. RPA automation JS body). Leave
          // .companion undefined; the migrate step will report it.
        }
      }
    }

    artifacts[uid] = artifact;
    if (type === "environment-variable") {
      destinations[artifact.identifier] = artifact;
    }
  }
}

// ---------------------------------------------------------------------------
// Actions module scan
// ---------------------------------------------------------------------------

function collectActionModule(moduleRoot, moduleName) {
  // The four canonical actions-module files are prefixed with the module id.
  const files = fs.readdirSync(moduleRoot);
  const pick = (suffix) => files.find((f) => f.endsWith(suffix));

  const result = { name: moduleName };
  const readIf = (name) => {
    if (!name) return undefined;
    try {
      return JSON.parse(fs.readFileSync(path.join(moduleRoot, name), "utf8"));
    } catch {
      return undefined;
    }
  };

  result.metadata = readIf(pick("metadata.json"));
  result.openApi = readIf(pick("open_api_spec.json"));
  result.actions = readIf(pick("actions.json"));
  return result;
}

// ---------------------------------------------------------------------------
// Flat WFS model format reader
// ---------------------------------------------------------------------------
// Accepts a single .json or .workflow file in the flat WFS format:
//   { "contents": { "<uuid>": { "classDefinition": "...", ... }, ... } }
// Returns an archive object in the same shape as unpack() so the rest of the
// migration pipeline (graph.js, migrate.js) works without modification.

/**
 * @param {string} filePath  path to a flat WFS model JSON (or .workflow) file
 * @returns same shape as unpack()
 */
function unpackFlat(filePath) {
  let raw = fs.readFileSync(filePath, "utf8");
  // Three-pass placeholder substitution for Java template tokens:
  // Pass 1: remove lines where a __token__ stands alone — these represent an
  //         absent optional key-value pair (the whole "key": value, line is gone).
  raw = raw.replace(/^[ \t]*__[a-zA-Z_]+__[ \t]*,?[ \t]*\r?\n?/gm, "");
  // Pass 2: substitute __token__ inside quoted strings with a harmless value.
  raw = raw.replace(/__[a-zA-Z_]+__/g, "__placeholder__");
  // Pass 3: replace any remaining bare __placeholder__ tokens (e.g. as unquoted
  //         JSON values in mapping blocks) with an empty object.
  raw = raw.replace(/__placeholder__/g, "{}");

  const doc = JSON.parse(raw);
  // Tolerate a bare contents map (no outer wrapper) just in case.
  const contents =
    doc && typeof doc.contents === "object" && doc.contents !== null ? doc.contents : doc;

  // Derive process identity from the Model node, falling back to the filename.
  const modelNode = Object.values(contents).find(
    (n) => n && n.classDefinition === "com.sap.bpm.wfs.Model",
  );
  const id = modelNode?.id || path.basename(filePath, path.extname(filePath));
  const name = modelNode?.name || id;

  // Synthesize a minimal artifact in the shape graph.js convert() expects:
  //   process.companion.artifact.model.contents  → the flat UUID map
  //   process.artifactJson                       → minimal envelope (no translations)
  const artifact = {
    uid: id,
    type: "bpi.process",
    identifier: id,
    name,
    header: {},
    artifactJson: { uid: id, type: "bpi.process", identifier: id, name },
    companion: { artifact: { model: { contents } } },
    companionUid: null,
    dir: path.dirname(filePath),
    moduleName: path.basename(filePath),
  };

  return {
    rootDir: path.dirname(filePath),
    mtad: null,
    modules: [],
    missingModules: [],
    artifacts: { [id]: artifact },
    actions: {},
    destinations: {},
  };
}

// ---------------------------------------------------------------------------
// Business Rules repository scan
// ---------------------------------------------------------------------------
// An SBPA project that contains a RuleTask ships a
//   bpmrulerepository/external_export.zip
// inside the SPA module's content directory. That zip holds one *.brproject
// JSON file per rule project, containing the full decision table definition.
// We extract and index it here so ruleTask.js can build derived agent prompts.

/**
 * Look for bpmrulerepository/external_export.zip in the module root, extract
 * it, parse every *.brproject file found, and populate ruleServices keyed by
 * RuleService.SpaUid → { name, ruleServiceId, spaUid, dataObjects, rules, rulesets }.
 */
function collectRuleRepository(moduleRoot, ruleServices) {
  const zipPath = path.join(moduleRoot, "bpmrulerepository", "external_export.zip");
  if (!fs.existsSync(zipPath)) return;

  const extractDir = path.join(moduleRoot, "bpmrulerepository", "_extracted");
  if (!fs.existsSync(extractDir) || fs.readdirSync(extractDir).length === 0) {
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      runUnzip(zipPath, extractDir);
    } catch {
      return; // silently skip unreadable rule archives
    }
  }

  for (const file of fs.readdirSync(extractDir)) {
    if (!file.endsWith(".brproject")) continue;
    try {
      const raw = fs.readFileSync(path.join(extractDir, file), "utf8");
      indexBrProject(JSON.parse(raw), ruleServices);
    } catch {
      // Skip malformed or unreadable brproject files
    }
  }
}

/**
 * Parse one brproject document and add each RuleService entry (keyed by
 * SpaUid) to the ruleServices map.
 *
 * Each entry exposes only the DataObject, Rule, and Ruleset records that
 * belong to this RuleService (ContainerId === RuleService.Id).
 */
function indexBrProject(doc, ruleServices) {
  const allDataObjects = doc.DataObject || [];
  const allRules = doc.Rule || [];
  const allRulesets = doc.Ruleset || [];

  for (const rs of doc.RuleService || []) {
    if (!rs.SpaUid) continue;
    ruleServices[rs.SpaUid] = {
      name: rs.Name,
      ruleServiceId: rs.Id,
      spaUid: rs.SpaUid,
      vocabulary: rs.Vocabulary || {},
      dataObjects: allDataObjects.filter((d) => d.ContainerId === rs.Id),
      rules: allRules.filter((r) => r.ContainerId === rs.Id),
      rulesets: allRulesets.filter((r) => r.RuleService && r.RuleService.ObjectId === rs.Id),
    };
  }
}

module.exports = { unpack, unpackFlat };

// ---------------------------------------------------------------------------
// CLI passthrough — `node unpack.js <path>` prints an inventory. Useful for
// debugging without going through the full migrate pipeline.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const input = process.argv[2];
  if (!input || input === "--help" || input === "-h") {
    console.log(
      "Usage: node unpack.js <mtar-or-project-dir>\n" +
        "\n" +
        "Prints a JSON inventory of artifacts found in the archive or directory.\n" +
        "Useful for inspecting an SBPA project before running migrate.js.\n" +
        "\n" +
        "Exit codes: 0 success, 2 usage error",
    );
    process.exit(input ? 0 : 2);
  }
  const out = unpack(input);
  const summary = {
    rootDir: out.rootDir,
    modules: out.modules.map((m) => ({
      name: m.name,
      projectType: m.projectType,
      ...(m.missing ? { missing: true } : {}),
    })),
    missingModules: out.missingModules,
    artifacts: Object.values(out.artifacts).map((a) => ({
      uid: a.uid,
      type: a.type,
      name: a.name,
    })),
    actionModules: Object.keys(out.actions),
    destinations: Object.keys(out.destinations),
  };
  console.log(JSON.stringify(summary, null, 2));
}
