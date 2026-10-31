// validate.js — sanity-check emitted n8n workflow JSON.
//
// Zero-dep constraint means no full JSON Schema / AJV / OpenAPI validation.
// Instead we check the structural invariants that matter for n8n import via
// `POST /api/v1/workflows`:
//
//   • top-level: name (string), nodes (array), connections (object), settings (object)
//   • each node: name (unique string), type (string), typeVersion (number),
//                position ([number, number]), parameters (object)
//   • each connections[srcName][output][index] entry: { node: <existing name>, type, index }
//   • no orphan node ids in connections
//
// Usage:
//   node validate.js <workflow.json> [more.json ...]
// Exits 0 if all valid, 1 otherwise (details to stderr).

const fs = require("node:fs");
const path = require("node:path");

function validate(workflow, _filename) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (!workflow || typeof workflow !== "object") {
    err("workflow must be an object");
    return errors;
  }
  if (typeof workflow.name !== "string" || !workflow.name)
    err("workflow.name must be a non-empty string");
  if (!Array.isArray(workflow.nodes)) err("workflow.nodes must be an array");
  if (typeof workflow.connections !== "object" || workflow.connections == null)
    err("workflow.connections must be an object");
  if (typeof workflow.settings !== "object" || workflow.settings == null)
    err("workflow.settings must be an object");
  if (errors.length) return errors;

  const nameSet = new Set();
  for (const [i, node] of workflow.nodes.entries()) {
    const path = `nodes[${i}]${node?.name ? ` (${node.name})` : ""}`;
    if (typeof node.name !== "string" || !node.name) err(`${path}.name must be a non-empty string`);
    if (nameSet.has(node.name)) err(`${path}.name is duplicated`);
    nameSet.add(node.name);
    if (typeof node.type !== "string" || !node.type.includes("."))
      err(`${path}.type must look like "package.node"`);
    if (typeof node.typeVersion !== "number") err(`${path}.typeVersion must be a number`);
    if (
      !Array.isArray(node.position) ||
      node.position.length !== 2 ||
      node.position.some((n) => typeof n !== "number")
    ) {
      err(`${path}.position must be [x, y] with numeric coords`);
    }
    if (typeof node.parameters !== "object" || node.parameters == null)
      err(`${path}.parameters must be an object`);
  }

  for (const [srcName, outputs] of Object.entries(workflow.connections)) {
    if (!nameSet.has(srcName)) err(`connections["${srcName}"]: source node not found`);
    if (typeof outputs !== "object" || outputs == null) {
      err(`connections["${srcName}"] must be an object`);
      continue;
    }
    for (const [outputKey, indexed] of Object.entries(outputs)) {
      if (!Array.isArray(indexed)) {
        err(`connections["${srcName}"].${outputKey} must be an array of arrays`);
        continue;
      }
      for (const [idx, batch] of indexed.entries()) {
        if (!Array.isArray(batch)) {
          err(`connections["${srcName}"].${outputKey}[${idx}] must be an array`);
          continue;
        }
        for (const conn of batch) {
          if (!conn || typeof conn !== "object") {
            err(`connections["${srcName}"].${outputKey}[${idx}] entry must be an object`);
            continue;
          }
          if (typeof conn.node !== "string" || !nameSet.has(conn.node))
            err(`connections["${srcName}"].${outputKey}[${idx}].node "${conn.node}" not found`);
          if (typeof conn.type !== "string")
            err(`connections["${srcName}"].${outputKey}[${idx}].type must be a string`);
          if (typeof conn.index !== "number")
            err(`connections["${srcName}"].${outputKey}[${idx}].index must be a number`);
        }
      }
    }
  }

  return errors;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.includes("--help") || files.includes("-h")) {
    console.log(
      "Usage: node validate.js <workflow.json> [more.json ...]\n" +
        "\n" +
        "Checks n8n structural invariants required for POST /api/v1/workflows:\n" +
        "  top-level keys: name, nodes, connections, settings\n" +
        "  each node: unique name, type, typeVersion, position ([x,y]), parameters\n" +
        "  connection entries reference existing node names\n" +
        "\n" +
        'Prints "ok   <file>" for each passing file, "FAIL <file>" with details for each failure.\n' +
        "\n" +
        "Exit codes: 0 all valid, 1 one or more failures, 2 usage error",
    );
    process.exit(0);
  }
  if (files.length === 0) {
    console.error("usage: node validate.js <workflow.json> [more.json ...]");
    process.exit(2);
  }
  let allOk = true;
  for (const f of files) {
    const abs = path.resolve(f);
    const wf = JSON.parse(fs.readFileSync(abs, "utf8"));
    const errors = validate(wf, f);
    if (errors.length) {
      allOk = false;
      console.error(`FAIL ${f}: ${errors.length} issue(s)`);
      for (const e of errors) console.error(`  - ${e}`);
    } else {
      console.log(`ok   ${f}`);
    }
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) main(process.argv);

module.exports = { validate };
