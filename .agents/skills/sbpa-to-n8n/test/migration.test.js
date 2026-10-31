// migration.test.js — golden-file regression for every fixture.
//
// For each directory under `fixtures/` containing an `expected.json`:
//
//   - If `<fixture>/golden/` doesn't exist or is empty → SKIP with a hint on
//     how to bootstrap the golden. Skips do NOT count as failures.
//   - Otherwise → run migrate.js against the fixture into a scratch temp dir,
//     diff each golden file against the emitted output.
//
// Run from the repo root: `node tests/migration.test.js`.
// Exit 0 iff every non-skipped fixture matches. Skips don't affect the exit
// code — new fixtures ratchet in coverage once someone commits their golden,
// without retroactively breaking CI.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalize, findFirstDiff } = require("./lib/diff");
const { execFileSync } = require("node:child_process");

const repoRoot = path.dirname(__dirname);
const migrateJs = path.join(repoRoot, "scripts", "migrate.js");
const fixturesDir = path.join(repoRoot, "fixtures");

if (!fs.existsSync(fixturesDir)) {
  console.error(`fixtures directory not found at ${fixturesDir}`);
  process.exit(2);
}

const fixtures = fs
  .readdirSync(fixturesDir)
  .map((name) => ({ name, dir: path.join(fixturesDir, name) }))
  .filter((f) => {
    try {
      return fs.statSync(f.dir).isDirectory();
    } catch {
      return false;
    }
  })
  .filter((f) => fs.existsSync(path.join(f.dir, "expected.json")));

if (fixtures.length === 0) {
  console.error(`no fixtures found (looked under ${fixturesDir} for dirs with expected.json)`);
  process.exit(2);
}

let mismatches = 0;
let passed = 0;
let skipped = 0;

for (const fixture of fixtures) {
  const goldenDir = path.join(fixture.dir, "golden");
  const hasGolden =
    fs.existsSync(goldenDir) &&
    fs.statSync(goldenDir).isDirectory() &&
    fs.readdirSync(goldenDir).some((f) => f.endsWith(".json"));

  if (!hasGolden) {
    console.log(
      `SKIP ${fixture.name} (no golden — run \`node scripts/migrate.js ${path.relative(repoRoot, fixture.dir)} golden\` to bootstrap)`,
    );
    skipped++;
    continue;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `migration-${fixture.name}-`));
  try {
    execFileSync(process.execPath, [migrateJs, fixture.dir, tmp], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    console.error(`FAIL ${fixture.name}: migrate.js crashed`);
    if (err.stderr) console.error(err.stderr.toString());
    mismatches++;
    fs.rmSync(tmp, { recursive: true, force: true });
    continue;
  }

  const files = fs.readdirSync(goldenDir).filter((f) => f.endsWith(".json"));
  let fixtureFailed = false;

  for (const f of files) {
    const goldenPath = path.join(goldenDir, f);
    const actualPath = path.join(tmp, f);
    if (!fs.existsSync(actualPath)) {
      console.error(`FAIL ${fixture.name}/${f}: not produced by migrator`);
      mismatches++;
      fixtureFailed = true;
      continue;
    }
    const golden = normalize(JSON.parse(fs.readFileSync(goldenPath, "utf8")));
    const actual = normalize(JSON.parse(fs.readFileSync(actualPath, "utf8")));
    if (JSON.stringify(golden) !== JSON.stringify(actual)) {
      const diff = findFirstDiff(golden, actual);
      console.error(`FAIL ${fixture.name}/${f}: differs from golden${diff ? ` at ${diff}` : ""}`);
      mismatches++;
      fixtureFailed = true;
    } else {
      console.log(`ok   ${fixture.name}/${f}`);
    }
  }

  if (!fixtureFailed) passed++;
  fs.rmSync(tmp, { recursive: true, force: true });
}

const total = fixtures.length - skipped;
console.log(`\n${passed}/${total} fixture(s) passed${skipped ? ` (${skipped} skipped)` : ""}`);
process.exit(mismatches === 0 ? 0 : 1);
