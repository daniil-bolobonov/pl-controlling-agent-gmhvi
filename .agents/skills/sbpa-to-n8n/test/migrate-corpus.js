#!/usr/bin/env node
// migrate-corpus.js — unified corpus runner.
//
// Fetches (sparse-checkout) or uses a local source directory, runs migration
// over specified subdirectories, and optionally diffs output against verified
// golden files.
//
// Usage:
//   node tests/migrate-corpus.js --source <path|url> [options]
//
// Options:
//   --source <path|url>  local directory OR git remote URL
//   --sparse-dir <dir>   checkout path when source is a URL
//                        (default: .corpus-sparse/<url-slug>)
//   --dirs <a,b,c>       subdirectories within the source to migrate
//                        (omit to migrate the source root)
//   --out <dir>          output base dir (default: out/<slug>)
//   --goldens            diff output against golden/ or verified/ dirs
//   --fetch              force re-fetch even if sparse-dir exists
//
// Golden comparison:
//   Looks for <sourceDir>/<project>/golden/ (fixtures convention) or
//   <sourceDir>/<project>/verified/ (lib convention) and diffs using
//   tests/lib/diff.js. Without --goldens, only produces the gap summary.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { diffWorkflows, nodeMatchPct } = require("./lib/diff");

const repoRoot = path.resolve(__dirname, "..");
const migrateJs = path.join(repoRoot, "scripts", "migrate.js");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const source = argValue(args, "--source");
const sparseArg = argValue(args, "--sparse-dir");
const dirsArg = argValue(args, "--dirs");
const outArg = argValue(args, "--out");
const useGoldens = args.includes("--goldens");
const forceFetch = args.includes("--fetch");

if (!source) {
  console.error(
    "Usage: node tests/migrate-corpus.js --source <path|url> [--dirs a,b,c] [--out dir] [--goldens] [--fetch]",
  );
  process.exit(2);
}

const isRemote = /^(https?|git|ssh):\/\/|^git@/.test(source);
const slug = isRemote ? source.replace(/^.*[/:]([\w-]+)(\.git)?$/, "$1") : path.basename(source);

const sparseDir = sparseArg || path.join(repoRoot, `.corpus-sparse/${slug}`);
const outBase = outArg || path.join(repoRoot, `out/${slug}`);

// ---------------------------------------------------------------------------
// Sparse checkout (when source is a remote URL)
// ---------------------------------------------------------------------------

function sparseFetch(remote, localDir, subdirs, force) {
  const testPath = subdirs.length > 0 ? path.join(localDir, subdirs[0]) : localDir;

  if (!force && fs.existsSync(testPath) && fs.readdirSync(testPath).length > 0) {
    console.error(`==> Using existing checkout in ${localDir}`);
    return;
  }

  console.error(`==> Sparse checkout of ${remote} into ${localDir}`);
  fs.rmSync(localDir, { recursive: true, force: true });
  fs.mkdirSync(localDir, { recursive: true });

  run("git", ["-C", localDir, "init", "-q"]);
  run("git", ["-C", localDir, "remote", "add", "origin", remote]);
  run("git", ["-C", localDir, "sparse-checkout", "init", "--cone"]);
  // If no explicit subdirs given, include 'projects/' — the standard lib layout.
  // Without an explicit set, cone mode only fetches root files.
  const checkoutDirs = subdirs.length > 0 ? subdirs : ["projects"];
  run("git", ["-C", localDir, "sparse-checkout", "set", ...checkoutDirs]);
  console.error("==> Fetching...");
  run("git", ["-C", localDir, "fetch", "--depth=1", "--no-tags", "origin", "HEAD"]);
  run("git", ["-C", localDir, "checkout", "FETCH_HEAD", "-q"]);
  console.error("==> Fetch complete");
}

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const msg = result.stderr ? result.stderr.toString() : `exit ${result.status}`;
    throw new Error(`${cmd} failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Determine source directories to migrate
// ---------------------------------------------------------------------------

let sourceRoot;
if (isRemote) {
  const subdirs = dirsArg ? dirsArg.split(",").map((s) => s.trim()) : [];
  sparseFetch(source, sparseDir, subdirs, forceFetch);
  sourceRoot = sparseDir;
} else {
  sourceRoot = path.resolve(source);
}

const migrationDirs = dirsArg
  ? dirsArg.split(",").map((s) => path.join(sourceRoot, s.trim()))
  : [sourceRoot];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

function runMigration(inputPath, outDir) {
  try {
    execFileSync(process.execPath, [migrateJs, inputPath, outDir], {
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 60000,
    });
    return { crashed: false };
  } catch (err) {
    return { crashed: true, crashMessage: String(err.message || err) };
  }
}

// ---------------------------------------------------------------------------
// Golden discovery
// ---------------------------------------------------------------------------

function findGoldens(dir) {
  // Returns Map<workflowName, { path, json }>
  const map = new Map();
  for (const subdir of ["golden", "verified"]) {
    const goldenDir = path.join(dir, subdir);
    if (!fs.existsSync(goldenDir)) continue;
    for (const f of fs.readdirSync(goldenDir)) {
      if (!f.endsWith(".workflow.json")) continue;
      try {
        const fullPath = path.join(goldenDir, f);
        const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        map.set(json.name || f.replace(".workflow.json", ""), { path: fullPath, json });
      } catch {}
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Corpus discovery (lib convention: projects/<name>/<name>.mtar)
// ---------------------------------------------------------------------------

function discoverMtarProjects(baseDir) {
  const projects = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    const mtars = entries.filter((e) => e.endsWith(".mtar") || e.endsWith(".zip"));
    if (mtars.length > 0) {
      for (const mtar of mtars) {
        projects.push({
          name: path.relative(baseDir, dir) || path.basename(dir),
          dir,
          mtar: path.join(dir, mtar),
          goldens: findGoldens(dir),
        });
      }
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      try {
        if (fs.statSync(full).isDirectory()) walk(full);
      } catch {}
    }
  }
  // Check if baseDir itself has MTARs first, otherwise walk
  const topEntries = fs.readdirSync(baseDir);
  const topMtars = topEntries.filter((e) => e.endsWith(".mtar") || e.endsWith(".zip"));
  if (topMtars.length > 0) {
    for (const mtar of topMtars) {
      projects.push({
        name: path.basename(baseDir),
        dir: baseDir,
        mtar: path.join(baseDir, mtar),
        goldens: findGoldens(baseDir),
      });
    }
  } else {
    const projectsDir = path.join(baseDir, "projects");
    if (fs.existsSync(projectsDir)) {
      walk(projectsDir);
    } else {
      walk(baseDir);
    }
  }
  return projects;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let totalWorkflows = 0;
let totalWithGoldens = 0;
let totalIdentical = 0;
let _totalCrashes = 0;
const comparison = [];

for (const migDir of migrationDirs) {
  const label = path.relative(repoRoot, migDir) || migDir;
  console.error(`==> ${label}`);
  const outDir = path.join(outBase, path.basename(migDir));
  fs.mkdirSync(outDir, { recursive: true });

  // Determine corpus type: MTAR-based (recurse for .mtar files) or flat JSON
  const hasMtarTree = containsMtarRecursive(migDir, 2);

  if (hasMtarTree) {
    // MTAR / lib corpus — discover projects
    const projects = discoverMtarProjects(migDir);
    for (const proj of projects) {
      const projOut = path.join(outDir, proj.name.replace(/[/\\]/g, "_"));
      fs.mkdirSync(projOut, { recursive: true });
      const { crashed, crashMessage } = runMigration(proj.mtar, projOut);
      if (crashed) {
        _totalCrashes++;
        console.error(`   CRASH: ${proj.name}: ${crashMessage}`);
        continue;
      }
      const emitted = fs.readdirSync(projOut).filter((f) => f.endsWith(".workflow.json"));
      totalWorkflows += emitted.length;

      if (useGoldens && proj.goldens.size > 0) {
        for (const wfFile of emitted) {
          const wfJson = JSON.parse(fs.readFileSync(path.join(projOut, wfFile), "utf8"));
          const verified = proj.goldens.get(wfJson.name);
          if (verified) {
            totalWithGoldens++;
            const diff = diffWorkflows(wfJson, verified.json);
            if (diff.identical) totalIdentical++;
            comparison.push({
              project: proj.name,
              workflow: wfJson.name,
              identical: diff.identical,
              firstDiffPath: diff.firstDiffPath,
              nodeMatchPct: nodeMatchPct(wfJson, verified.json),
            });
          }
        }
      }
    }
  } else {
    // Flat JSON corpus (workflow-service style) — run migrate.js on directory
    runMigration(migDir, outDir);
    const emitted = fs.readdirSync(outDir).filter((f) => f.endsWith(".workflow.json"));
    totalWorkflows += emitted.length;
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (useGoldens && comparison.length > 0) {
  const comparisonOut = path.join(outBase, "comparison.json");
  fs.writeFileSync(
    comparisonOut,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source,
        totalWorkflows,
        totalWithGoldens,
        totalIdentical,
        projects: comparison,
      },
      null,
      2,
    )}\n`,
  );
  console.error(`\ncomparison: ${totalIdentical}/${totalWithGoldens} identical to verified`);
  console.error(`comparison report: ${comparisonOut}`);

  if (totalIdentical < totalWithGoldens) {
    console.error("\nfailures:");
    for (const c of comparison.filter((c) => !c.identical)) {
      console.error(
        `  ${c.project}/${c.workflow}: first diff at ${c.firstDiffPath} (${c.nodeMatchPct}% node match)`,
      );
    }
    process.exit(1);
  }
}

console.error(`\nout dir: ${outBase}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function argValue(arr, flag) {
  const idx = arr.indexOf(flag);
  return idx !== -1 && idx + 1 < arr.length ? arr[idx + 1] : null;
}

function containsMtarRecursive(dir, maxDepth) {
  if (maxDepth < 0) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.endsWith(".mtar") || e.endsWith(".zip")) return true;
    const full = path.join(dir, e);
    try {
      if (fs.statSync(full).isDirectory() && containsMtarRecursive(full, maxDepth - 1)) return true;
    } catch {}
  }
  return false;
}
