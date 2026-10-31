// graph.js — convert one bpi.process artifact into an n8n workflow JSON.
//
// Input:
//   process   the artifact from unpack.js (has .companion for the graph)
//   archive   the full { artifacts, actions, destinations } from unpack.js
//
// Output:
//   { workflow, report }
//   workflow  the n8n workflow document, ready to POST to /api/v1/workflows
//             or paste into the Editor's Import from File dialog
//   report    array of items the LLM stage should review

const { emit } = require("./activities");
const { resolveSchema, n8nTypeOf } = require("./schema");
const {
  PROCESS_GRAPH_MISSING,
  UNKNOWN_TRIGGER_TYPE,
  CUSTOM_VAR_UNSUPPORTED_TYPE,
} = require("./report-kinds");

const HORIZONTAL_STEP = 240;
const VERTICAL_STEP = 180;

function convert(process, archive) {
  const model = process.companion?.artifact?.model;
  if (!model?.contents) {
    return {
      workflow: null,
      report: [
        {
          kind: PROCESS_GRAPH_MISSING,
          sbpaId: process.uid,
          message: "no artifact.model.contents in companion",
        },
      ],
    };
  }
  const graph = model.contents;

  // ---- 1. build metadata caches -----------------------------------------

  const rootUid = findRootUid(graph);
  const modelRoot = graph[rootUid];

  const displayNames = buildDisplayNames(process, modelRoot, graph);
  const flows = collectSequenceFlows(graph);
  const flowsBySource = groupBy(flows, (f) => f.sourceRef);
  const flowsByTarget = groupBy(flows, (f) => f.targetRef);
  const trigger = findBoundTrigger(process, archive);
  const processIsSubflow = !trigger && isReferencedAsSubflow(process, archive);

  const dataObjects = collectDataObjects(graph);
  const customVarsDetected = dataObjects.length > 0;
  const customInitName = customVarsDetected ? "Initialize Custom Data" : null;
  // Map<fieldName, 'string'|'number'|'boolean'|'object'|'array'>
  // Built from DataObject JSON Schemas so init/writer nodes can skip complex fields.
  const customVarFieldTypes = customVarsDetected
    ? buildCustomVarFieldTypes(dataObjects, graph)
    : new Map();

  const innerToOuter = new Map();
  for (const [outer, node] of Object.entries(graph)) {
    if (node?.id) innerToOuter.set(node.id, outer);
  }
  const nodeName = (idOrUuid) => {
    // Accept either the outer UUID (used by graph.js internals) or the inner
    // short id (used by SBPA formula strings like `context.<innerId>.field`).
    if (displayNames.has(idOrUuid)) return displayNames.get(idOrUuid);
    const outer = innerToOuter.get(idOrUuid);
    if (outer && displayNames.has(outer)) return displayNames.get(outer);
    return idOrUuid;
  };

  // Simple id counter — n8n needs unique node ids per workflow.
  let idCounter = 1;
  const nextIdCounter = () => `n8n-${idCounter++}`;

  // Predecessor helper: first inbound flow's source. For nodes with multiple
  // inbounds (merge gateways), this returns the first — but only the ActionTask
  // and ScriptTask emitters use this, and they never sit after a merge in v1.
  const predecessors = (id) => {
    const inbound = flowsByTarget.get(id) || [];
    return inbound.length > 0 ? inbound[0].sourceRef : null;
  };
  const inboundFlows = (id) => flowsByTarget.get(id) || [];
  const outboundFlows = (id) => flowsBySource.get(id) || [];

  // Set of SBPA inner IDs (e.g. "ruleTask_1") for all RuleTask nodes.
  // Passed in resolvers so emit-paths.js can wrap cross-node references to AI Agent
  // outputs with JSON.parse($('name').item.json.output).<field>.
  const aiAgentInnerIds = new Set(
    Object.values(graph)
      .filter((n) => n && n.classDefinition === "com.sap.bpm.wfs.RuleTask" && n.id)
      .map((n) => n.id),
  );

  const ctx = {
    process,
    graph,
    archive,
    nodeName,
    nextIdCounter,
    predecessors,
    inboundFlows,
    outboundFlows,
    trigger,
    processIsSubflow,
    // trigger.api wraps the incoming request in { headers, body, ... }, so
    // downstream formula references need `.body.<field>`.
    // trigger.event (→ CUSTOM.sapS4HanaEventTrigger), trigger.scheduled, trigger.form,
    // and executeWorkflowTrigger all deliver a flat item — no `.body` wrapping.
    // For subflow processes we always emit a normalize Set node that flattens both
    // paths, so triggerIsWebhook is always false for subflows.
    triggerIsWebhook: !!trigger && trigger.type === "trigger.api" && !processIsSubflow,
    // Display name of the trigger (StartEvent) node — used by scriptTask.js to
    // emit a stable cross-node reference ($('<name>').item.json.*) that works
    // even when the script is downstream of a merge node (where $json is empty).
    triggerNodeName: (() => {
      for (const [uuid, node] of Object.entries(graph)) {
        if (node && node.classDefinition === "com.sap.bpm.wfs.StartEvent") return nodeName(uuid);
      }
      return null;
    })(),
    customInitName,
    customVarFieldTypes, // Map<fieldName, type> from DataObject schemas
    aiAgentInnerIds, // Set<innerId> of RuleTask nodes — used by emit-paths.js to wrap output refs with JSON.parse
    subflowManifest: new Map(),
    webhookNodes: buildWebhookNodesSet(graph), // Pre-scan for webhook wait nodes (MessageEventDefinition)
    mcpMapping: archive.mcpMapping || null, // Optional map loaded from mcp-mapping.json
    // customDataReaderName(outerUuid) → reader node display name for this node (or null).
    // Set after the pre-scan; used by emitters when building formula resolvers.
    customDataReaderName: (outerUuid) => customReaderNamesPreScan?.get(outerUuid) || null,
  };

  // ---- 2. optional init code node for custom variables ------------------

  const emittedNodes = []; // array of { sbpaId, n8nNode, extras }
  const nodesBySbpaId = new Map();
  const report = [];
  const collectedPinData = {};

  if (customInitName) {
    const startEventNode = findStartEventNode(graph);
    const { node: init, report: initReport } = buildCustomDataInitCodeNode(
      customInitName,
      idCounter++,
      startEventNode,
      ctx,
      customVarFieldTypes,
    );
    if (initReport.length) report.push(...initReport);
    emittedNodes.push({ sbpaId: "__init__", n8nNode: init });
    nodesBySbpaId.set("__init__", init);
  }

  // Pre-scan which nodes need a "Read Custom Data" reader node injected before
  // them. We do this before the emit loop so the emitters can use the correct
  // reader node name in their formula resolvers (context.custom.* references
  // will point at the per-node reader rather than the init node).
  // Map: outer UUID → reader display name.
  const customReaderNamesPreScan = new Map();
  if (customVarsDetected) {
    for (const [outerUuid, sbpaNode] of Object.entries(graph)) {
      if (!sbpaNode || !isEmittable(sbpaNode)) continue;
      if (!nodeReadsCustomVar(sbpaNode, graph)) continue;
      // Compute the n8n display name for this node so we can build the reader name.
      const nodeDisplayName = nodeName(outerUuid);
      customReaderNamesPreScan.set(outerUuid, `Read Custom Data: ${nodeDisplayName}`);
    }
  }

  // ---- 3. emit each SBPA node ------------------------------------------

  // Iterate over the ordered activity/event/gateway ids from modelRoot
  // (order-preserving), then any leftovers found in graph but not in root.
  const orderedIds = collectOrderedNodeIds(modelRoot, graph);

  // UserTask nodes with decisionOptions emit a primary SAP Task Center node
  // plus a _decisionSwitch switch node.  Track them here so buildConnections
  // can wire:  Task Center  →  Switch  →  downstream SequenceFlow targets.
  // Key: SBPA outer UUID of the UserTask; value: { taskNode, switchNode }.
  const decisionSwitchMap = new Map();

  for (const sbpaId of orderedIds) {
    const sbpaNode = graph[sbpaId];
    if (!sbpaNode) continue;
    if (!isEmittable(sbpaNode)) continue;
    // Attach the outer UUID so activity emitters can uniformly refer to
    // "the sbpa key for this node" without having to know about the two
    // id systems the graph uses.
    sbpaNode._uuid = sbpaId;
    // Skip DataObjects (handled above) and structural wrappers.

    const result = emit(sbpaNode, ctx);
    if (result.report?.length) report.push(...result.report);
    if (result.pinData) Object.assign(collectedPinData, result.pinData);
    if (!result.node) {
      // Elided (EndEvent, unknown). Record for connection-collapse.
      nodesBySbpaId.set(sbpaId, null);
      continue;
    }

    // Unknown trigger type fallback — emit a report entry and strip the marker.
    if (result.node._unknownTriggerType) {
      report.push({
        kind: UNKNOWN_TRIGGER_TYPE,
        sbpaId: sbpaNode.id,
        triggerType: result.node._unknownTriggerType,
        message: `StartEvent bound to unrecognised trigger type "${result.node._unknownTriggerType}"; emitted manualTrigger`,
      });
      delete result.node._unknownTriggerType;
    }

    // UserTask with decisionOptions: the primary node carries a _decisionSwitch
    // marker.  Extract and register the switch as a follow-up node so that:
    //   • inbound flows  → Task Center (nodesBySbpaId keeps task node)
    //   • outbound flows → switch (decisionSwitchMap overrides for src lookup)
    if (result.node._decisionSwitch) {
      const switchNode = result.node._decisionSwitch;
      delete result.node._decisionSwitch;
      emittedNodes.push({ sbpaId, n8nNode: result.node });
      nodesBySbpaId.set(sbpaId, result.node);
      // Register switch under a synthetic id so layout can place it.
      emittedNodes.push({ sbpaId: `${sbpaId}__switch`, n8nNode: switchNode });
      decisionSwitchMap.set(sbpaId, { taskNode: result.node, switchNode });
      continue;
    }

    // RuleTask (and future AI nodes): primary node carries _aiSubNodes — an array
    // of sub-nodes (e.g. chat model) to register alongside it. Sub-nodes are NOT
    // flow nodes; they get synthetic IDs (sbpaId + '__aisubnode_N') so layoutPositions
    // can place them below the parent and buildConnections can wire ai_languageModel.
    if (result.node._aiSubNodes) {
      const aiSubNodes = result.node._aiSubNodes;
      delete result.node._aiSubNodes;
      emittedNodes.push({ sbpaId, n8nNode: result.node });
      nodesBySbpaId.set(sbpaId, result.node);
      for (let i = 0; i < aiSubNodes.length; i++) {
        emittedNodes.push({ sbpaId: `${sbpaId}__aisubnode_${i}`, n8nNode: aiSubNodes[i] });
        // Not added to nodesBySbpaId — sub-nodes are not SBPA flow targets
      }
      continue;
    }

    // StartEvent dual-trigger: extras = [secondaryTrigger, normalizeSetNode].
    // The normalize node is registered as the canonical StartEvent entry so that
    // all outbound SequenceFlows from the StartEvent wire through it.
    // The extra trigger nodes are appended after the primary trigger.
    if (result.extras?.length) {
      // extras[last] is always the normalize node; register it as the StartEvent.
      const normalizeNode = result.extras[result.extras.length - 1];
      emittedNodes.push({ sbpaId, n8nNode: result.node }); // primary trigger
      for (let i = 0; i < result.extras.length - 1; i++) {
        emittedNodes.push({ sbpaId: `${sbpaId}__extra_${i}`, n8nNode: result.extras[i] });
      }
      emittedNodes.push({ sbpaId: `${sbpaId}__normalize`, n8nNode: normalizeNode });
      // Route StartEvent outbound flows from the normalize node.
      nodesBySbpaId.set(sbpaId, normalizeNode);
      continue;
    }

    emittedNodes.push({ sbpaId, n8nNode: result.node });
    nodesBySbpaId.set(sbpaId, result.node);
  }

  // ---- 3b. inject custom-data writer and reader code nodes ---------------

  // customWriterMap: SBPA outer UUID → synthetic writer sbpaId
  // Used by buildConnections to re-route outbound flows through the writer.
  const customWriterMap = new Map();
  // customReaderMap: SBPA outer UUID → { readerSbpaId, readerName }
  // Used by buildConnections to insert the reader in front of the target node.
  const customReaderMap = new Map();

  if (customVarsDetected) {
    // Writer: inject after every node whose mappings.out has ['custom'][...] keys.
    // Skip __init__ and synthetic nodes (sbpaId includes '__').
    // Skip StartEvent: its custom output mappings are already handled by the
    // "Initialize Custom Data" code node, so no separate writer is needed.
    for (const entry of [...emittedNodes]) {
      if (!entry.sbpaId || entry.sbpaId.includes("__")) continue;
      const sbpaNode = graph[entry.sbpaId];
      if (!sbpaNode) continue;
      if (sbpaNode.classDefinition === "com.sap.bpm.wfs.StartEvent") continue;
      const customOutEntries = getCustomOutEntries(sbpaNode);
      if (customOutEntries.length === 0) continue;
      const writerName = `Update Custom Data: ${entry.n8nNode.name}`;
      // Build a resolver that can translate output.* / context.* formulas for this node.
      const writerResolver = {
        predecessorId: ctx.predecessors(entry.sbpaId),
        nodeName: ctx.nodeName,
        customInitName: ctx.customInitName,
        triggerIsWebhook: ctx.triggerIsWebhook,
        customDataReaderName: null,
        aiAgentInnerIds: ctx.aiAgentInnerIds,
      };
      const isAiAgent = entry.n8nNode.type === "@n8n/n8n-nodes-langchain.agent";
      const { node: writerNode, report: writerReport } = buildCustomDataWriterNode(
        writerName,
        customOutEntries,
        writerResolver,
        idCounter++,
        customVarFieldTypes,
        isAiAgent,
      );
      if (writerReport.length) report.push(...writerReport);
      const writerSbpaId = `${entry.sbpaId}__cdwriter`;
      emittedNodes.push({ sbpaId: writerSbpaId, n8nNode: writerNode });
      nodesBySbpaId.set(writerSbpaId, writerNode);
      customWriterMap.set(entry.sbpaId, writerSbpaId);
    }

    // Reader: inject before every node whose mappings.in or JUEL body
    // references context.custom.*. Also scan MailTask definition fields.
    for (const entry of [...emittedNodes]) {
      if (!entry.sbpaId || entry.sbpaId.includes("__")) continue;
      const sbpaNode = graph[entry.sbpaId];
      if (!sbpaNode) continue;
      if (!nodeReadsCustomVar(sbpaNode, graph)) continue;
      const readerName = `Read Custom Data: ${entry.n8nNode.name}`;
      const readerNode = buildCustomDataReaderNode(readerName, idCounter++);
      const readerSbpaId = `${entry.sbpaId}__cdreader`;
      emittedNodes.push({ sbpaId: readerSbpaId, n8nNode: readerNode });
      nodesBySbpaId.set(readerSbpaId, readerNode);
      customReaderMap.set(entry.sbpaId, { readerSbpaId, readerName });
      // Store the reader name on the n8n node so buildConnections-aware
      // formula resolution can reference it. We use a temporary internal field
      // (stripped before final output) to carry this through to the resolver.
      entry.n8nNode._customDataReaderName = readerName;
    }
  }

  // ---- 4. lay out positions --------------------------------------------

  layoutPositions(
    emittedNodes,
    flows,
    modelRoot,
    decisionSwitchMap,
    customWriterMap,
    customReaderMap,
  );

  // ---- 5. stitch connections -------------------------------------------

  const connections = buildConnections(
    emittedNodes,
    flows,
    nodesBySbpaId,
    customInitName,
    decisionSwitchMap,
    customWriterMap,
    customReaderMap,
  );

  // ---- 6. clean up internal fields on nodes ----------------------------

  const finalNodes = emittedNodes.map((e) => stripInternalFields(e.n8nNode));

  const workflow = {
    name: process.name || process.identifier || "Migrated SBPA process",
    nodes: finalNodes,
    connections,
    settings: {
      executionOrder: "v1",
    },
  };
  if (Object.keys(collectedPinData).length > 0) workflow.pinData = collectedPinData;

  return { workflow, report };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRootUid(graph) {
  for (const [uid, node] of Object.entries(graph)) {
    if (node && node.classDefinition === "com.sap.bpm.wfs.Model") return uid;
  }
  return null;
}

function buildDisplayNames(process, modelRoot, graph) {
  // The graph's outer keys are UUIDs (`f5e25a7f-…`), but every node has an
  // inner `.id` (e.g. `condition_1`) that translations.units references.
  // We publish an outer-UUID → display-name map so callers can use a single
  // vocabulary; also expose the outer-UUID for use by connection stitching.
  const names = new Map();
  const innerToOuter = new Map();
  for (const [outer, node] of Object.entries(graph)) {
    if (node?.id) innerToOuter.set(node.id, outer);
  }

  const units = process.artifactJson?.translations?.units;
  if (Array.isArray(units)) {
    for (const u of units) {
      // key = "c.<companionUid>.data.artifact.model.contents.<innerId>.name"
      const m = /\.contents\.([^.]+)\.name$/.exec(u.key || "");
      if (m && u.values?.dev) {
        const outer = innerToOuter.get(m[1]);
        if (outer) names.set(outer, u.values.dev);
      }
    }
  }
  // Fallback to node.name inside the graph itself, still keyed by outer.
  if (modelRoot) {
    for (const bag of ["events", "activities", "gateways", "sequenceFlows"]) {
      const collection = modelRoot[bag] || {};
      for (const outer of Object.keys(collection)) {
        const node = graph[outer];
        if (!names.has(outer) && node && node.name) names.set(outer, node.name);
      }
    }
  }
  // Deduplicate: if multiple nodes share the same display name, append " 1",
  // " 2", … so that n8n connection keys (keyed by node name) stay unique.
  deduplicateNames(names);
  return names;
}

// Append " 1", " 2", … to duplicate display names so n8n connection keys
// (keyed by node name) remain unique.
function deduplicateNames(names) {
  // Pass 1: count how many nodes share each base name.
  const counts = new Map();
  for (const name of names.values()) counts.set(name, (counts.get(name) || 0) + 1);

  // Pass 2: assign numbered suffixes to every node whose base name is shared.
  const next = new Map();
  for (const [outer, name] of names) {
    if (counts.get(name) <= 1) continue;
    const n = next.get(name) || 1;
    names.set(outer, `${name} ${n}`);
    next.set(name, n + 1);
  }
}

function collectSequenceFlows(graph) {
  return Object.entries(graph)
    .filter(([, n]) => n && n.classDefinition === "com.sap.bpm.wfs.SequenceFlow")
    .map(([outerUid, f]) => ({
      // `id` here is the SBPA outer UUID — matches sourceRef/targetRef and
      // matches the `default: <uuid>` field on ExclusiveGateway.
      id: outerUid,
      innerId: f.id,
      sourceRef: f.sourceRef,
      targetRef: f.targetRef,
      condition: f.condition,
      name: f.name,
    }));
}

function groupBy(arr, keyFn) {
  const out = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

function findBoundTrigger(process, archive) {
  // trigger.scheduled and trigger.event store UIDs with a "$." prefix.
  const normaliseUid = (uid) =>
    typeof uid === "string" && uid.startsWith("$.") ? uid.slice(2) : uid;

  for (const artifact of Object.values(archive.artifacts)) {
    if (!artifact.type.startsWith("trigger.")) continue;
    const bind = artifact.header?.triggerableArtifactUids;
    if (Array.isArray(bind) && bind.map(normaliseUid).includes(process.uid)) return artifact;
  }

  // Form trigger: no dedicated trigger artifact. A process is form-triggered when
  // it has a dependency on a bpi.form whose URI contains "formtrigger" AND that
  // form is NOT referenced as a UserTaskDefinition inside the process graph.
  // UserTask forms share the same URI and dependency pattern — the only reliable
  // distinction is that a UserTask form appears in the graph as a UserTaskDefinition
  // node with a matching uid, while a form trigger form does not.
  const model = process.companion?.artifact?.model;
  const graph = model?.contents || {};
  const graphUids = new Set(
    Object.values(graph)
      .filter((n) => n?.uid)
      .map((n) => n.uid),
  );

  const deps = process.artifactJson?.dependencies;
  if (Array.isArray(deps)) {
    for (const dep of deps) {
      const depArtifact = archive.artifacts[dep.artifactUid];
      if (depArtifact && depArtifact.type === "bpi.form") {
        const uri = depArtifact.header?.uri || "";
        if (uri.toLowerCase().includes("formtrigger") && !graphUids.has(depArtifact.uid)) {
          return { type: "trigger.form", identifier: depArtifact.identifier, uid: depArtifact.uid };
        }
      }
    }
  }

  return null;
}

// A process is a subflow if some other bpi.process has a ProcessDefinition
// wrapper pointing at our uid.
function isReferencedAsSubflow(process, archive) {
  for (const other of Object.values(archive.artifacts)) {
    if (other.uid === process.uid) continue;
    if (other.type !== "bpi.process") continue;
    const graph = other.companion?.artifact?.model?.contents;
    if (!graph) continue;
    for (const node of Object.values(graph)) {
      if (
        node &&
        node.classDefinition === "com.sap.bpm.wfs.ProcessDefinition" &&
        node.uid === process.uid
      ) {
        return true;
      }
    }
  }
  return false;
}

function collectDataObjects(graph) {
  return Object.values(graph).filter(
    (n) => n && n.classDefinition === "com.sap.bpm.wfs.DataObject",
  );
}

function isEmittable(node) {
  const cd = node.classDefinition;
  if (!cd) return false;
  if (cd === "com.sap.bpm.wfs.Model") return false;
  if (cd === "com.sap.bpm.wfs.SequenceFlow") return false;
  if (cd === "com.sap.bpm.wfs.DataObject") return false;
  if (cd === "com.sap.bpm.wfs.Schemas") return false;
  if (cd === "com.sap.bpm.wfs.ProjectDefinition") return false;
  if (cd === "com.sap.bpm.wfs.ProcessDefinition") return false;
  if (cd === "com.sap.bpm.wfs.ActionGroupDefinition") return false;
  if (cd === "com.sap.bpm.wfs.EnvironmentVariableDefinition") return false;
  if (cd === "com.sap.bpm.wfs.MailDefinition") return false;
  if (cd === "com.sap.bpm.wfs.TimerEventDefinition") return false; // consumed by parent
  if (cd === "com.sap.bpm.wfs.LastIDs") return false; // bookkeeping node
  if (cd.startsWith("com.sap.bpm.wfs.ui.")) return false; // diagram layout symbols
  if (cd === "com.sap.bpm.wfs.UserTaskDefinition") return false; // schema descriptor for UserTask
  return true;
}

function collectOrderedNodeIds(modelRoot, graph) {
  const ordered = [];
  const seen = new Set();
  const push = (uid) => {
    if (uid && !seen.has(uid) && graph[uid]) {
      ordered.push(uid);
      seen.add(uid);
    }
  };
  if (modelRoot) {
    for (const bag of ["events", "activities", "gateways"]) {
      const collection = modelRoot[bag] || {};
      for (const uid of Object.keys(collection)) push(uid);
    }
  }
  // Sweep anything else emittable that wasn't listed in the model root
  for (const [uid, node] of Object.entries(graph)) {
    if (isEmittable(node)) push(uid);
  }
  return ordered;
}

function _buildInitSetNode(dataObjects, customInitName, counter, graph) {
  // For each DataObject, initialize an empty object. The customer / LLM
  // stage can seed defaults if needed.
  //
  // `includeOtherFields: true` is critical: without it, n8n's Set node v3.4
  // replaces $json entirely with just the assigned fields. Downstream nodes
  // that reference the trigger's data via `$json.<field>` (which the
  // ScriptTask emitter emits when the trigger is the immediate predecessor)
  // would see `undefined` for everything the trigger provided. With this
  // flag set, the trigger's fields flow through and the DataObject slots
  // are added on top.
  //
  // Per-DataObject type comes from its own JSON Schema (`d.type.schema` +
  // `d.type.definition`). In practice observed DataObjects are always
  // `type: 'object'` at the top level — the schema-driven derivation is
  // future-proofing plus defensive against a DataObject that turns out to
  // be a typed scalar container.
  //
  // Seed the declared properties from the schema: array → [], object → {},
  // scalars omitted. Without this, ScriptTasks that do `custom.names.push(...)`
  // (SBPA declares `names: array` on `custom`, so at runtime the slot is a
  // ready-to-push array) would crash on the first push because we'd have
  // handed them `custom = {}`.
  const assignments = dataObjects.map((d) => {
    const def = resolveSchema(d.type, graph);
    return {
      id: `init-${d.name}`,
      name: d.name,
      type: n8nTypeOf(def),
      value: `={{ ${seedLiteralFromSchema(def)} }}`,
    };
  });
  return {
    id: `n8n-${counter}`,
    name: customInitName,
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position: [0, 0],
    parameters: {
      mode: "manual",
      duplicateItem: false,
      assignments: { assignments },
      includeOtherFields: true,
      options: {},
    },
  };
}

// Emit a JS literal that seeds a DataObject slot from its JSON Schema. Only
// container properties are seeded — array → [], object → {} — so that
// ScriptTasks pushing into declared arrays or setting keys on declared
// sub-objects don't crash. Scalars stay `undefined` (SBPA leaves them
// unassigned too; assignments happen via mappings or scripts).
function seedLiteralFromSchema(def) {
  if (def?.type !== "object" || !def.properties) return "{}";
  const parts = [];
  for (const [key, spec] of Object.entries(def.properties)) {
    if (!spec) continue;
    if (spec.type === "array") parts.push(`${JSON.stringify(key)}: []`);
    else if (spec.type === "object") parts.push(`${JSON.stringify(key)}: {}`);
    // scalars intentionally omitted
  }
  return `{ ${parts.join(", ")} }`;
}

// Branch-aware left→right layout: BFS from the trigger.
// Regular (non-parallel) nodes are placed left-to-right in a single row.
// When a node fans out to N ≥ 2 successors (after resolving elided parallel
// splits), each successor is assigned its own row so the branches spread
// vertically.  The first join (merge node) after a fan-out rejoins to the
// row of the first branch.  This gives a clean swimlane-style layout.
function layoutPositions(
  emittedNodes,
  flows,
  modelRoot,
  decisionSwitchMap,
  customWriterMap,
  customReaderMap,
) {
  if (emittedNodes.length === 0) return;

  const idToNode = new Map(emittedNodes.map((e) => [e.sbpaId, e]));

  // Build raw adjacency from SBPA flows.
  const rawAdj = new Map();
  for (const f of flows) {
    if (!rawAdj.has(f.sourceRef)) rawAdj.set(f.sourceRef, []);
    rawAdj.get(f.sourceRef).push(f.targetRef);
  }
  // Add synthetic task → switch edges.
  if (decisionSwitchMap) {
    for (const [taskSbpaId] of decisionSwitchMap) {
      if (!rawAdj.has(taskSbpaId)) rawAdj.set(taskSbpaId, []);
      rawAdj.get(taskSbpaId).push(`${taskSbpaId}__switch`);
    }
  }
  // Add synthetic edges for writer nodes.
  if (customWriterMap) {
    for (const [srcSbpaId, writerSbpaId] of customWriterMap) {
      if (!rawAdj.has(srcSbpaId)) rawAdj.set(srcSbpaId, []);
      rawAdj.get(srcSbpaId).push(writerSbpaId);
    }
  }
  // Add synthetic edges for reader nodes.
  if (customReaderMap) {
    for (const [targetSbpaId, { readerSbpaId }] of customReaderMap) {
      if (!rawAdj.has(readerSbpaId)) rawAdj.set(readerSbpaId, []);
      rawAdj.get(readerSbpaId).push(targetSbpaId);
    }
  }

  // Build elision-resolved adjacency: for each real (non-elided) node,
  // collect the real successors by walking through any elided intermediates.
  // This surfaces ParallelGateway splits as direct fan-out edges.
  // Use a queue (not stack) to preserve SBPA flow declaration order.
  function resolvedSuccessors(sbpaId) {
    const results = [];
    const seen = new Set();
    const queue = [...(rawAdj.get(sbpaId) || [])];
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      if (idToNode.has(cur)) {
        results.push(cur);
      } else {
        // Elided — enqueue outbound targets to walk through.
        for (const next of rawAdj.get(cur) || []) queue.push(next);
      }
    }
    return results;
  }

  // Find the start — the emitted node whose sbpaId equals the model's StartEvent id.
  const startId = modelRoot?.events
    ? Object.keys(modelRoot.events).find((uid) => idToNode.has(uid))
    : null;

  // BFS tracking (depth, row) per node.
  // `row` is a Y-slot index; parallel branches get distinct rows.
  const depth = new Map(); // sbpaId → column index
  const row = new Map(); // sbpaId → row index
  let nextRow = 0;

  // The init Set node — if present — sits at column 0, row 0.
  const initEntry = emittedNodes.find((e) => e.sbpaId === "__init__");
  if (initEntry) {
    depth.set("__init__", 0);
    row.set("__init__", 0);
  }

  const queue = [];
  let queueIndex = 0;
  if (startId) {
    const startRow = nextRow++;
    depth.set(startId, 1);
    row.set(startId, startRow);
    queue.push(startId);
  }

  while (queueIndex < queue.length) {
    const cur = queue[queueIndex++];
    const d = depth.get(cur) || 0;
    const curRow = row.get(cur) || 0;
    const succs = resolvedSuccessors(cur);

    if (succs.length <= 1) {
      // Single successor — continue on the same row.
      for (const next of succs) {
        if (!depth.has(next)) {
          depth.set(next, d + 1);
          row.set(next, curRow);
          queue.push(next);
        }
      }
    } else {
      // Fan-out (parallel split): assign each new successor its own row.
      // The first branch inherits the current row; the rest get fresh rows.
      let firstBranch = true;
      for (const next of succs) {
        if (!depth.has(next)) {
          const assignedRow = firstBranch ? curRow : nextRow++;
          firstBranch = false;
          depth.set(next, d + 1);
          row.set(next, assignedRow);
          queue.push(next);
        }
      }
    }
  }

  // Anything not reached by BFS gets a fallback at the far right.
  const maxDepth = Math.max(0, ...depth.values());
  for (const e of emittedNodes) {
    if (!depth.has(e.sbpaId)) {
      depth.set(e.sbpaId, maxDepth + 1);
      row.set(e.sbpaId, nextRow++);
    }
  }

  // Apply positions: column → X, row → Y.
  for (const e of emittedNodes) {
    if (e.sbpaId.includes("__aisubnode_")) continue; // handled below
    const d = depth.get(e.sbpaId) || 0;
    const r = row.get(e.sbpaId) || 0;
    e.n8nNode.position = [d * HORIZONTAL_STEP, r * VERTICAL_STEP];
  }

  // Position AI sub-nodes directly below their parent agent node.
  for (const entry of emittedNodes) {
    if (!entry.sbpaId.includes("__aisubnode_")) continue;
    const parentSbpaId = entry.sbpaId.replace(/__aisubnode_\d+$/, "");
    const parentEntry = idToNode.get(parentSbpaId);
    if (!parentEntry) continue;
    const subIndex = parseInt(entry.sbpaId.split("__aisubnode_")[1], 10);
    entry.n8nNode.position = [
      parentEntry.n8nNode.position[0],
      parentEntry.n8nNode.position[1] + VERTICAL_STEP * (subIndex + 1),
    ];
  }
}

// Build the n8n `connections` map. Keyed by source node NAME (not id).
function buildConnections(
  emittedNodes,
  flows,
  nodesBySbpaId,
  _customInitName,
  decisionSwitchMap,
  customWriterMap,
  customReaderMap,
) {
  const connections = {};
  const ensure = (nodeName, output = "main", index = 0) => {
    if (!connections[nodeName]) connections[nodeName] = {};
    if (!connections[nodeName][output]) connections[nodeName][output] = [];
    while (connections[nodeName][output].length <= index) connections[nodeName][output].push([]);
    return connections[nodeName][output][index];
  };
  // Dedup connection triples — necessary once walkThroughElided can return
  // multiple real destinations per flow (elided ParallelGateway splits fan
  // one predecessor's flow out to N branches; the split's own outbound
  // flows would re-emit the same edges from an elided srcNode, but those
  // are dropped by the `if (!srcNode)` guard below — so this Set primarily
  // guards against pathological cases where the same (src, out, dst) is
  // reachable via two distinct SBPA flow paths.
  const seen = new Set();
  // Per-destination-node input-slot counter. Only nodes with multiple input
  // ports (currently: `n8n-nodes-base.merge`) get incrementing slots; every
  // other node type takes all its inbound edges at slot 0. Populated lazily
  // inside pushOnce so callers don't have to know the destination's type.
  const nextInputSlot = new Map();
  const dstTypeByName = new Map(emittedNodes.map((e) => [e.n8nNode.name, e.n8nNode.type]));
  const allocInputSlot = (dstName) => {
    if (dstTypeByName.get(dstName) !== "n8n-nodes-base.merge") return 0;
    const slot = nextInputSlot.get(dstName) || 0;
    nextInputSlot.set(dstName, slot + 1);
    return slot;
  };
  // usedMergeSlots tracks which input slots have already been claimed by a
  // switch→merge edge with a known outputIndex (so we don't double-assign).
  const usedMergeSlots = new Map(); // dstName → Set<slot>
  const pushOnce = (srcName, output, index, dstName, preferredDstIndex) => {
    const key = `${srcName} ${output} ${index} ${dstName}`;
    if (seen.has(key)) return;
    seen.add(key);
    let dstIndex;
    if (preferredDstIndex !== undefined && dstTypeByName.get(dstName) === "n8n-nodes-base.merge") {
      // Switch→merge: use the switch output index as the merge input index so
      // the wiring is straight (output 0 → input 0, output 1 → input 1, …).
      dstIndex = preferredDstIndex;
      if (!usedMergeSlots.has(dstName)) usedMergeSlots.set(dstName, new Set());
      usedMergeSlots.get(dstName).add(dstIndex);
      // Keep nextInputSlot in sync so auto-increment paths don't collide.
      const cur = nextInputSlot.get(dstName) || 0;
      if (dstIndex >= cur) nextInputSlot.set(dstName, dstIndex + 1);
    } else {
      // Non-switch source going into a merge: skip any slots already reserved
      // by switch→merge edges so we don't cross wires.
      if (dstTypeByName.get(dstName) === "n8n-nodes-base.merge") {
        let slot = nextInputSlot.get(dstName) || 0;
        const reserved = usedMergeSlots.get(dstName) || new Set();
        while (reserved.has(slot)) slot++;
        nextInputSlot.set(dstName, slot + 1);
        dstIndex = slot;
      } else {
        dstIndex = allocInputSlot(dstName);
      }
    }
    ensure(srcName, output, index).push({ node: dstName, type: "main", index: dstIndex });
  };

  // If we injected an Init Set node, chain: Init → StartEvent successor.
  // But the trigger is the natural entry point, so instead the Init sits
  // right after the trigger. Insert a synthetic Trigger → Init link, and
  // reroute the trigger's original next-hops through Init.
  // For now: emit Trigger → Init → (first real node after StartEvent).
  const TRIGGER_TYPES = new Set([
    "n8n-nodes-base.webhook",
    "n8n-nodes-base.manualTrigger",
    "n8n-nodes-base.scheduleTrigger",
    "n8n-nodes-base.formTrigger",
    "n8n-nodes-base.executeWorkflowTrigger",
    "CUSTOM.sapS4HanaEventTrigger",
  ]);
  const initNode = emittedNodes.find((e) => e.sbpaId === "__init__");
  const triggerEntry = emittedNodes.find((e) => e.n8nNode && TRIGGER_TYPES.has(e.n8nNode.type));

  if (initNode && triggerEntry) {
    pushOnce(triggerEntry.n8nNode.name, "main", 0, initNode.n8nNode.name);
  }

  // Wire dual-trigger extras: each extra trigger → normalize node.
  // The normalize node is registered as sbpaId + '__normalize'; the extra triggers
  // are sbpaId + '__extra_N'. Connect each extra trigger to the normalize node.
  const normalizeEntries = emittedNodes.filter((e) => e.sbpaId.endsWith("__normalize"));
  for (const normEntry of normalizeEntries) {
    const baseSbpaId = normEntry.sbpaId.slice(0, -"__normalize".length);
    // Primary trigger (sbpaId === baseSbpaId) → normalize
    const primaryEntry = emittedNodes.find((e) => e.sbpaId === baseSbpaId);
    if (primaryEntry) pushOnce(primaryEntry.n8nNode.name, "main", 0, normEntry.n8nNode.name);
    // Secondary triggers (sbpaId === baseSbpaId + '__extra_N') → normalize
    let i = 0;
    while (true) {
      const extraEntry = emittedNodes.find((e) => e.sbpaId === `${baseSbpaId}__extra_${i}`);
      if (!extraEntry) break;
      pushOnce(extraEntry.n8nNode.name, "main", 0, normEntry.n8nNode.name);
      i++;
    }
  }

  // For every SBPA flow, look up source + target n8n nodes (walking through
  // elisions). If the source itself is elided, skip — this flow's edges will
  // be synthesized when we process the flow that led *into* the elided source.
  //
  // UserTask nodes with decisionOptions: outbound flows must originate from
  // the switch node (not the Task Center node), so we consult decisionSwitchMap
  // when looking up the effective source.
  for (const flow of flows) {
    const srcNode = decisionSwitchMap?.has(flow.sourceRef)
      ? decisionSwitchMap.get(flow.sourceRef).switchNode
      : nodesBySbpaId.get(flow.sourceRef);
    if (!srcNode) continue;

    // If source has a writer node, skip this flow here — the writer block
    // below handles the source → writer → dst chain.
    if (customWriterMap?.has(flow.sourceRef)) continue;

    const dstNodes = walkThroughElided(flow.targetRef, flows, nodesBySbpaId);
    if (dstNodes.length === 0) continue;

    // If the source is a switch, output index depends on flowOrder.
    let outputIndex = 0;
    const isSwitchSource = srcNode._flowOrder && Array.isArray(srcNode._flowOrder);
    if (isSwitchSource) {
      const idx = srcNode._flowOrder.indexOf(flow.id);
      outputIndex = idx >= 0 ? idx : 0;
    }

    // If the trigger has an Init Set in front of it, we need to remap the
    // trigger's own outbound edges to originate from Init instead of the
    // trigger — otherwise both trigger and Init would fan out to the same
    // successor.
    let effectiveSourceName = srcNode.name;
    if (initNode && triggerEntry && srcNode === triggerEntry.n8nNode) {
      effectiveSourceName = initNode.n8nNode.name;
    }
    for (const dst of dstNodes) {
      // If this destination has a reader node injected before it, route through
      // the reader instead of connecting directly to the destination.
      const dstEntry = emittedNodes.find((e) => e.n8nNode === dst);
      const dstSbpaId = dstEntry?.sbpaId;
      const readerInfo = dstSbpaId && customReaderMap?.get(dstSbpaId);
      const effectiveDstName = readerInfo ? readerInfo.readerName : dst.name;
      // For switch→merge edges, pass the output index as the preferred merge
      // input index so the wiring is straight (no visual cross).
      pushOnce(
        effectiveSourceName,
        "main",
        outputIndex,
        effectiveDstName,
        isSwitchSource ? outputIndex : undefined,
      );
    }
  }

  // Wire SAP Task Center → Decision Switch for every UserTask with decisionOptions.
  // The Task Center node's single output feeds the switch, which then fans out
  // to the downstream branches via the rules above.
  if (decisionSwitchMap) {
    for (const { taskNode, switchNode } of decisionSwitchMap.values()) {
      pushOnce(taskNode.name, "main", 0, switchNode.name);
    }
  }

  // Wire writer nodes: each writer sits between its source node and the
  // original downstream targets.
  //   effectiveSrc → writer → effectiveDst
  // where:
  //   effectiveSrc = initNode if source is the trigger (same rewiring as main loop)
  //   effectiveDst = readerNode if destination has a reader injected before it
  if (customWriterMap && customWriterMap.size > 0) {
    for (const flow of flows) {
      if (!customWriterMap.has(flow.sourceRef)) continue;
      const writerSbpaId = customWriterMap.get(flow.sourceRef);
      const writerNode = nodesBySbpaId.get(writerSbpaId);
      if (!writerNode) continue;
      const srcNode = nodesBySbpaId.get(flow.sourceRef);
      if (srcNode) {
        // Apply the same trigger → init rewiring as the main loop.
        let effectiveSrcName = srcNode.name;
        if (initNode && triggerEntry && srcNode === triggerEntry.n8nNode) {
          effectiveSrcName = initNode.n8nNode.name;
        }
        pushOnce(effectiveSrcName, "main", 0, writerNode.name);
      }
      // writer → downstream targets (route through reader if destination has one)
      const dstNodes = walkThroughElided(flow.targetRef, flows, nodesBySbpaId);
      for (const dst of dstNodes) {
        const dstEntry = emittedNodes.find((e) => e.n8nNode === dst);
        const dstSbpaId = dstEntry?.sbpaId;
        const readerInfo = dstSbpaId && customReaderMap?.get(dstSbpaId);
        const effectiveDstName = readerInfo ? readerInfo.readerName : dst.name;
        pushOnce(writerNode.name, "main", 0, effectiveDstName);
      }
    }
  }

  // Wire reader nodes: only the reader → target edge. The predecessor → reader
  // edges are already handled in the main loop (effectiveDstName) and writer
  // block (effectiveDstName) above.
  if (customReaderMap && customReaderMap.size > 0) {
    for (const [targetSbpaId, { readerSbpaId }] of customReaderMap) {
      const readerNode = nodesBySbpaId.get(readerSbpaId);
      const targetNode = nodesBySbpaId.get(targetSbpaId);
      if (!readerNode || !targetNode) continue;
      pushOnce(readerNode.name, "main", 0, targetNode.name);
    }
  }

  // Wire AI sub-nodes to their parent agent node via the appropriate AI
  // connection type (typically ai_languageModel). Sub-nodes carry _aiParent
  // (the parent agent's display name) and _aiConnectionType set by the emitter.
  for (const entry of emittedNodes) {
    if (!entry.sbpaId.includes("__aisubnode_")) continue;
    const subNode = entry.n8nNode;
    const parent = subNode._aiParent;
    const connType = subNode._aiConnectionType || "ai_languageModel";
    if (!parent) continue;
    ensure(subNode.name, connType, 0).push({ node: parent, type: connType, index: 0 });
  }

  return connections;
}

// Walk forward through elided nodes to find every real n8n node reachable
// from `sbpaId` — following every outbound flow at each elided intermediate.
// Returns an array (possibly empty). For non-elided nodes, returns [node].
// Elided ParallelGateway splits are the reason this is a fan-out: they have
// ≥2 outbound flows and every one must be followed.
function walkThroughElided(sbpaId, flows, nodesBySbpaId) {
  const results = [];
  const seenResults = new Set();
  const visited = new Set();
  const stack = [sbpaId];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || visited.has(cur)) continue;
    visited.add(cur);
    const entry = nodesBySbpaId.get(cur);
    if (entry) {
      if (!seenResults.has(entry.name)) {
        seenResults.add(entry.name);
        results.push(entry);
      }
      continue; // don't traverse past a real node
    }
    // Elided — enqueue every outbound target.
    for (const f of flows) {
      if (f.sourceRef === cur) stack.push(f.targetRef);
    }
  }
  return results;
}

function stripInternalFields(node) {
  const out = { ...node };
  delete out._flowOrder;
  delete out._customDataReaderName;
  delete out._aiParent;
  delete out._aiConnectionType;
  return out;
}

// Pre-scan graph for webhook wait nodes (IntermediateCatchEvent with MessageEventDefinition).
// These nodes wrap incoming data in { body: {...} }, so downstream formula references
// need to include 'body' in the path.
function buildWebhookNodesSet(graph) {
  const set = new Set();
  for (const [, node] of Object.entries(graph)) {
    if (
      node &&
      node.classDefinition === "com.sap.bpm.wfs.IntermediateCatchEvent" &&
      node.eventDefinitions
    ) {
      const defId = Object.keys(node.eventDefinitions || {})[0];
      const def = defId ? graph[defId] : null;
      if (def && def.classDefinition === "com.sap.bpm.wfs.MessageEventDefinition") {
        set.add(node.id);
      }
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// Custom variable helpers
// ---------------------------------------------------------------------------

// Detect if any node in the graph has a ['custom'][...] key in mappings.out or .in.
function _graphHasCustomMappings(graph) {
  const CUSTOM_KEY_RE = /^\['custom'\]/;
  for (const node of Object.values(graph)) {
    if (!node?.mappings) continue;
    for (const dir of ["out", "in"]) {
      const m = node.mappings[dir];
      if (!m) continue;
      for (const key of Object.keys(m)) {
        if (CUSTOM_KEY_RE.test(key)) return true;
      }
    }
  }
  return false;
}

// Find the StartEvent node in the graph.
function findStartEventNode(graph) {
  for (const node of Object.values(graph)) {
    if (node && node.classDefinition === "com.sap.bpm.wfs.StartEvent") return node;
  }
  return null;
}

// Return { field, formulaValue } pairs for custom-variable writes in a node's mappings.out.
// Keys shaped ['custom']['<field>'] → returns [{ field: '<field>', formulaValue: '<raw formula>' }].
function getCustomOutEntries(sbpaNode) {
  const CUSTOM_FIELD_RE = /^\['custom'\]\['([^']+)'\]$/;
  const entries = [];
  const out = sbpaNode?.mappings?.out;
  if (!out) return entries;
  for (const [rawKey, entry] of Object.entries(out)) {
    const m = CUSTOM_FIELD_RE.exec(rawKey);
    if (m)
      entries.push({
        field: m[1],
        formulaValue: entry && entry.value != null ? entry.value : null,
      });
  }
  return entries;
}

// Check if a node reads from context.custom.* in any of its inputs.
// Checks: mappings.in formula values, MailDefinition fields (for MailTask),
// and the script body (for ScriptTask / GenericSkillTask).
// NOTE: ScriptTask and GenericSkillTask(ScriptTask) are excluded — they
// read/write $execution.customData directly in their generated code node,
// so no upstream "Read Custom Data" injector is needed.
function nodeReadsCustomVar(sbpaNode, graph) {
  // ScriptTask uses $execution.customData directly — no reader node needed.
  if (sbpaNode.classDefinition === "com.sap.bpm.wfs.ScriptTask") {
    return false;
  }
  // GenericSkillTask only uses $execution.customData when extensionType === 'ScriptTask'.
  if (
    sbpaNode.classDefinition === "com.sap.bpm.wfs.GenericSkillTask" &&
    sbpaNode.extensionType === "ScriptTask"
  ) {
    return false;
  }
  // mappings.in formula values
  const inMap = sbpaNode.mappings?.in;
  if (inMap) {
    for (const entry of Object.values(inMap)) {
      if (entry?.value?.includes("context.custom")) return true;
    }
  }
  // MailTask: check MailDefinition node's to/subject/html for context.custom
  if (sbpaNode.classDefinition === "com.sap.bpm.wfs.MailTask" && sbpaNode.mailDefinitionRef) {
    const def = graph[sbpaNode.mailDefinitionRef];
    if (def) {
      for (const field of [def.to, def.subject, def.html]) {
        if (field?.includes("context.custom")) return true;
      }
    }
  }
  // UserTask: subject / recipientUsers / recipientGroups
  if (sbpaNode.classDefinition === "com.sap.bpm.wfs.UserTask") {
    for (const field of [
      sbpaNode.subject,
      sbpaNode.recipientUsers,
      sbpaNode.recipientGroups,
      sbpaNode.description,
    ]) {
      if (field?.includes("context.custom")) return true;
    }
  }
  return false;
}

// Build a map of custom variable field names → JSON Schema type from the
// DataObject definitions. Used to decide whether a field can be stored in
// $execution.customData (strings only) or must be flagged as unsupported.
function buildCustomVarFieldTypes(dataObjects, graph) {
  const types = new Map();
  for (const d of dataObjects) {
    const def = resolveSchema(d.type, graph);
    if (!def?.properties) continue;
    for (const [fieldName, spec] of Object.entries(def.properties)) {
      if (spec?.type) types.set(fieldName, spec.type);
    }
  }
  return types;
}

// Build the "Initialize Custom Data" code node. Reads $execution.customData,
// seeds fields declared in StartEvent mappings.out['custom'][...], writes back.
// Skips fields of type object/array (not supported by $execution.customData)
// and emits a report entry for each skipped field.
function buildCustomDataInitCodeNode(name, counter, startEventNode, ctx, customVarFieldTypes) {
  const CUSTOM_FIELD_RE = /^\['custom'\]\['([^']+)'\]$/;
  const report = [];
  const lines = [
    "// Initialize custom variables from $execution.customData.",
    "// Fields with defaults from StartEvent are seeded only if not already set.",
    "const cd = $execution.customData.getAll();",
    "",
  ];

  if (startEventNode?.mappings?.out) {
    // Build a resolver that points context.startEvent.* at the StartEvent trigger.
    const resolver = {
      predecessorId: null,
      nodeName: ctx.nodeName,
      customInitName: null,
      triggerIsWebhook: ctx.triggerIsWebhook,
    };
    const { translate } = require("./formula");
    for (const [rawKey, entry] of Object.entries(startEventNode.mappings.out)) {
      const m = CUSTOM_FIELD_RE.exec(rawKey);
      if (!m || !entry || entry.value == null) continue;
      const field = m[1];

      // Object and array types cannot be stored in $execution.customData (string-only).
      const fieldType = customVarFieldTypes?.get(field);
      if (fieldType === "object" || fieldType === "array") {
        report.push({
          kind: CUSTOM_VAR_UNSUPPORTED_TYPE,
          field,
          fieldType,
          message: `Custom variable field "${field}" has type "${fieldType}" which cannot be stored in $execution.customData (string values only, max 255 chars). This field was skipped.`,
        });
        continue;
      }

      const result = translate(entry.value, resolver);
      const expr = result.ok
        ? result.expression
            .replace(/^=\{\{/, "")
            .replace(/\}\}$/, "")
            .trim()
        : JSON.stringify(entry.value);
      lines.push(
        `if (!(${JSON.stringify(field)} in cd)) $execution.customData.set(${JSON.stringify(field)}, String(${expr}));`,
      );
    }
    if (lines[lines.length - 1] !== "") lines.push("");
  }

  // Spread the trigger payload so downstream nodes can access $json.body.* etc.
  const triggerName =
    ctx.nodeName && startEventNode ? ctx.nodeName(startEventNode._uuid || startEventNode.id) : null;
  const spreadExpr = triggerName ? `, ...$('${triggerName}').item.json` : "";
  lines.push(`return [{ json: { custom: $execution.customData.getAll()${spreadExpr} } }];`);

  return {
    node: {
      id: `n8n-${counter}`,
      name,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        mode: "runOnceForAllItems",
        language: "javaScript",
        jsCode: lines.join("\n"),
      },
    },
    report,
  };
}

// Build the "Update Custom Data: <name>" code node that persists specific
// custom-variable fields written by the preceding node back to $execution.customData.
// Primitive types (string, boolean, number) are stored as strings via String().
// Complex types (object, array) are skipped and a report entry is emitted for each.
// When isAiAgent is true the preceding node is an AI Agent whose structured output
// is parsed by a connected Structured Output Parser sub-node, so it arrives as a real
// object under the key `output`; the `output.output.<field>` formula rewrites resolve
// against that object directly (no JSON.parse needed).
function buildCustomDataWriterNode(
  name,
  customOutEntries,
  resolver,
  counter,
  customVarFieldTypes,
  isAiAgent,
) {
  const { translate } = require("./formula");
  const report = [];
  const lines = ["// Persist custom variable updates to $execution.customData."];
  if (isAiAgent) {
    lines.push(
      "// Preceding node is an AI Agent — output is parsed by the Structured Output Parser.",
    );
    lines.push("const output = $input.first().json.output || {};");
  } else {
    lines.push("const output = $input.first().json;");
  }
  for (const { field, formulaValue } of customOutEntries) {
    // Object and array types cannot be stored in $execution.customData (string-only).
    const fieldType = customVarFieldTypes?.get(field);
    if (fieldType === "object" || fieldType === "array") {
      report.push({
        kind: CUSTOM_VAR_UNSUPPORTED_TYPE,
        field,
        fieldType,
        message: `Custom variable field "${field}" has type "${fieldType}" which cannot be stored in $execution.customData (string values only, max 255 chars). This write was skipped.`,
      });
      continue;
    }

    let valueExpr;
    if (formulaValue != null) {
      const result = translate(formulaValue, resolver);
      if (result.ok) {
        // result.expression is like `={{ $json.returnstatus }}` — strip the ={{ }} wrapper
        valueExpr = result.expression
          .replace(/^=\{\{/, "")
          .replace(/\}\}$/, "")
          .trim();
      } else {
        // Translation failed — fall back to the raw formula (may reference `output.*`)
        valueExpr = formulaValue;
      }
    } else {
      valueExpr = "undefined";
    }
    lines.push(`$execution.customData.set(${JSON.stringify(field)}, String(${valueExpr}));`);
  }
  lines.push("return [{ json: { custom: $execution.customData.getAll() } }];");
  return {
    node: {
      id: `n8n-${counter}`,
      name,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        mode: "runOnceForAllItems",
        language: "javaScript",
        jsCode: lines.join("\n"),
      },
    },
    report,
  };
}

// Build the "Read Custom Data: <name>" code node that loads $execution.customData
// into $json.custom so downstream formula references can use it.
function buildCustomDataReaderNode(name, counter) {
  return {
    id: `n8n-${counter}`,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [0, 0],
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: [
        "// Load $execution.customData into $json.custom for downstream formula access.",
        "return [ {custom: $execution.customData.getAll()} ];",
      ].join("\n"),
    },
  };
}

module.exports = { convert };

if (require.main === module) {
  console.log(
    "graph.js — bpi.process artifact to n8n workflow JSON converter.\nThis is a library module. Import it with require('./graph'). Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
