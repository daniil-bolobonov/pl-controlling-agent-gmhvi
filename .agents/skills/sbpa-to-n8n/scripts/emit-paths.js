// emit-paths.js — shared context-path → n8n-reference translation used by
// both parsers (mapping formula and JUEL). Zero deps.
//
// Both grammars share the same "context.<scope>.<rest>" convention for
// referencing SBPA process data (start event payload, custom variables,
// other nodes' outputs). This module is the single source of truth for
// how those paths map onto n8n's expression forms:
//
//   context.startEvent.customer.externalId
//     → $('StartEvent').item.json.customer.externalId
//     → $('StartEvent').item.json.body.customer.externalId    (webhook trigger)
//     → $json.customer.externalId                              (when trigger is
//                                                              the immediate
//                                                              predecessor)
//   context.custom.normalizedtotals.gross
//     → $('Initialize Custom Data').item.json.custom.normalizedtotals.gross
//   context.<otherNodeInnerId>.field
//     → $('<display-name>').item.json.field
//   output
//     → $json                             (whole predecessor output)
//   listItem                              (only inside a Map(...) template)
//     → item                              (JS lambda-local name)
//
// Segments format: an Array<string>. A segment shaped '[<intLit>]' is an
// array index and does NOT get a leading '.' during concatenation. All
// other segments are name accessors.
//
// Resolver protocol (all optional):
//   predecessorId      the SBPA inner id whose output feeds this emit call;
//                      when it matches the referenced scope, we use $json
//                      instead of $('name').item.json.
//   nodeName(id)       maps SBPA inner id → n8n display name.
//   customInitName     display name of the DataObject init Set node.
//   triggerIsWebhook   true when the trigger is an n8n webhook (payload
//                      wraps in {headers, body, params, query, ...}).
//   inMapLambda        true when emitting inside a Map(...) template's
//                      arrow body; `listItem` binds to `item`.

/**
 * Join a name path into a JS accessor chain. Segments starting with `[`
 * are treated as array indexers (no leading dot).
 * @param {string[]} segments
 * @returns {string}
 */
function joinPath(segments) {
  let out = "";
  for (const seg of segments) {
    if (seg.startsWith("[")) out += seg;
    else out += (out ? "." : "") + seg;
  }
  return out;
}

/**
 * Translate a `context.<scope>.<rest>` (or `output`, or `listItem`) path
 * into the n8n expression body.
 *
 * @param {string[]} segments  path segments (name strings, or '[N]' indexers)
 * @param {object} resolver    see file header
 * @returns {string}           JS expression body (no `={{ }}` wrapping)
 */
function emitContextPath(segments, resolver) {
  const [head, ...tail] = segments;

  // The special `output` token references the entire output of the current
  // node. Emitted mappings often use `out.startEvent = output`, meaning
  // "everything the trigger produced" → $json in n8n.
  if (head === "output" && tail.length === 0) return "$json";

  // Map(...) lambda binding — `listItem.foo` becomes `item.foo`.
  if (head === "listItem" && resolver && resolver.inMapLambda) {
    return joinPath(["item", ...tail]);
  }

  // context.<something> — the primary reference form.
  if (head === "context" && tail.length > 0) {
    const [scope, ...rest] = tail;

    if (scope === "custom") {
      // customDataReaderName is set per-node by graph.js when a dedicated
      // "Read Custom Data: <NodeName>" code node has been injected immediately
      // before this node to refresh $json.custom from $execution.customData.
      // liveWriterName is provided by the IR-based resolver to override the
      // default Initialize Custom Data reference when a ScriptTask has mutated
      // the DataObject more recently.
      const customDataReader = resolver?.customDataReaderName;
      const liveWriter = resolver?.liveWriterName?.("custom");
      const sourceName = customDataReader || liveWriter || resolver?.customInitName;
      if (sourceName) {
        // The reader/init code node returns [{ custom: $execution.customData.getAll() }],
        // so the custom fields live at .item.json.custom.<field>.
        const suffix = rest.length ? `.custom.${joinPath(rest)}` : ".custom";
        return `$('${sourceName}').item.json${suffix}`;
      }
    }

    if (scope === "startEvent") {
      // n8n webhook triggers wrap the request in
      //   { headers, body, params, query, webhookUrl, executionMode }
      // — the SBPA payload lives at `.body.<field>`. Other trigger types
      // (manualTrigger, executeWorkflowTrigger) pass JSON through unwrapped.
      const bodyPrefix = resolver?.triggerIsWebhook ? "body" : "";
      const prefixed = bodyPrefix ? [bodyPrefix, ...rest] : rest;

      if (resolver && resolver.predecessorId === "startEvent") {
        return prefixed.length ? `$json.${joinPath(prefixed)}` : "$json";
      }
      const triggerName = resolver?.nodeName ? resolver.nodeName("startEvent") : "StartEvent";
      const suffix = prefixed.length ? `.${joinPath(prefixed)}` : "";
      return `$('${triggerName}').item.json${suffix}`;
    }

    // context.<otherNodeInnerId>.field — cross-node reference.
    // Similar to startEvent: check if this node wraps response in body (webhook nodes).
    const nodeName = resolver?.nodeName ? resolver.nodeName(scope) : scope;

    if (resolver && resolver.predecessorId === scope) {
      return rest.length ? `$json.${joinPath(rest)}` : "$json";
    }

    // AI Agent (RuleTask) output is parsed by the connected Structured Output
    // Parser sub-node, so `output` is already a validated object — downstream
    // parameter expressions access the fields directly (no JSON.parse, no Code node).
    if (resolver?.aiAgentInnerIds?.has(scope)) {
      const suffix = rest.length ? `.${joinPath(rest)}` : "";
      return `$('${nodeName}').item.json.output${suffix}`;
    }

    const bodyPrefix = resolver?.webhookNodes?.has(scope) ? "body" : "";
    const prefixed = bodyPrefix ? [bodyPrefix, ...rest] : rest;
    const suffix = prefixed.length ? `.${joinPath(prefixed)}` : "";
    return `$('${nodeName}').item.json${suffix}`;
  }

  // usertasks.<taskInnerId>.last.decision — SBPA UserTask decision reference.
  // The SAP Task Center node (which UserTask maps to) returns:
  //   { result: { response: 'approved' | 'rejected', respondedAt: '...' } }
  // So `usertasks.X.last.decision` → $('X').item.json.result.response
  if (head === "usertasks" && tail.length >= 1) {
    const taskId = tail[0];
    const name = resolver?.nodeName ? resolver.nodeName(taskId) : taskId;
    const rest = tail.slice(1); // typically ['last', 'decision']
    if (rest[rest.length - 1] === "decision") {
      return `$('${name}').item.json.result.response`;
    }
    const suffix = rest.length ? `.${joinPath(rest)}` : "";
    return `$('${name}').item.json${suffix}`;
  }

  // Anything else — emit as-is. Rare: local JS variable inside a ScriptTask
  // rewrite, or future extensions like `$vars.X`.
  return joinPath(segments);
}

module.exports = { emitContextPath, joinPath };

if (require.main === module) {
  console.log(
    "emit-paths.js — context-path to n8n reference translator.\nThis is a library module. Import it with require('./emit-paths'). Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
