// Shared diff utilities used by migration.test.js and validate-lib.js.

function normalize(obj) {
  if (Array.isArray(obj)) return obj.map(normalize);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = normalize(v);
    return out;
  }
  return obj;
}

function findFirstDiff(a, b, prefix = "") {
  if (typeof a !== typeof b) return `${prefix} (type)`;
  if (a === null || b === null || typeof a !== "object") {
    return a === b ? null : `${prefix} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = findFirstDiff(a[k], b[k], prefix ? `${prefix}.${k}` : k);
    if (d) return d;
  }
  return null;
}

// Produce a structured node-level diff between actual and verified workflow JSONs.
// Returns { identical, firstDiffPath, nodesSummary }.
function diffWorkflows(actual, verified) {
  if (!actual || !verified) {
    return { identical: false, firstDiffPath: null, nodesSummary: null };
  }

  const normActual = normalize(actual);
  const normVerified = normalize(verified);
  const identical = JSON.stringify(normActual) === JSON.stringify(normVerified);
  const firstDiffPath = identical ? null : findFirstDiff(normVerified, normActual);

  // Node-level summary
  const verifiedNodes = new Map((verified.nodes || []).map((n) => [n.name, n]));
  const actualNodes = new Map((actual.nodes || []).map((n) => [n.name, n]));

  const onlyInVerified = [...verifiedNodes.keys()].filter((n) => !actualNodes.has(n));
  const onlyInActual = [...actualNodes.keys()].filter((n) => !verifiedNodes.has(n));

  const typeMismatches = [];
  const paramDiffs = [];

  for (const [name, vNode] of verifiedNodes) {
    const aNode = actualNodes.get(name);
    if (!aNode) continue;
    if (vNode.type !== aNode.type || vNode.typeVersion !== aNode.typeVersion) {
      typeMismatches.push({
        name,
        expected: `${vNode.type}@${vNode.typeVersion}`,
        actual: `${aNode.type}@${aNode.typeVersion}`,
      });
    } else {
      const pDiff = findFirstDiff(normalize(vNode.parameters), normalize(aNode.parameters));
      if (pDiff) paramDiffs.push({ name, firstDiffPath: `parameters.${pDiff}` });
    }
  }

  return {
    identical,
    firstDiffPath,
    nodesSummary: { onlyInVerified, onlyInActual, typeMismatches, paramDiffs },
  };
}

// % of verified node names present in actual with matching type.
function nodeMatchPct(actual, verified) {
  if (!verified?.nodes || verified.nodes.length === 0) return null;
  const actualNodes = new Map((actual?.nodes || []).map((n) => [n.name, n]));
  let matched = 0;
  for (const vNode of verified.nodes) {
    const aNode = actualNodes.get(vNode.name);
    if (aNode && aNode.type === vNode.type) matched++;
  }
  return Math.round((matched / verified.nodes.length) * 100);
}

module.exports = { normalize, findFirstDiff, diffWorkflows, nodeMatchPct };
