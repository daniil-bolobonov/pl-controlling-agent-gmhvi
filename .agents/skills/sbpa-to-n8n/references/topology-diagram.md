# Topology diagram — rendering rules for the ASCII trees the skill emits

After migrating an SBPA project, the skill (Path A or Path B) ends its response with a `## Migrated workflow topology` block. This file specifies the exact rendering algorithm so the diagrams are consistent across host harnesses and models.

## When to render

- One indented tree **per emitted workflow JSON**, headed by `## <workflow.name>` — the JSON's top-level `name` field.
- When multiple workflows come out of one migration (caller + sub-workflow), each renders as its own section. Sub-workflow call sites appear inline within the caller's tree (see "Sub-workflow linkage" below); the callee's own tree renders as a sibling section below.
- If zero workflows were emitted, omit the block entirely.

## Node numbering

- Assign each node a 1-based integer in the order it's **drawn** by the traversal (see "Rendering algorithm" below). Numbering restarts at 1 for each workflow.
- **Normal nodes** (nodes reached from a single predecessor) are drawn — and numbered — the moment DFS first visits them.
- **Forward-join nodes** (nodes with ≥2 inbound edges from forward-flow branches — Merges, ParallelGateway joins, or any convergence) are drawn once, under their **last** incoming branch in DFS visit order. Their number is assigned when they're drawn. Earlier branches reaching them forward-reference the eventual number (see "Traversal" and "Rendering algorithm").
- Print each node on its own line: `<n>  <NodeName>  [<short-type>]`.
- `<short-type>` = `type.split('.').pop()` — the last dotted segment of the n8n type. Examples:
  - `n8n-nodes-base.httpRequest` → `httpRequest`
  - `n8n-nodes-base.executeWorkflow` → `executeWorkflow`
  - `n8n-nodes-base.webhook` → `webhook`
  - `n8n-nodes-base.set` → `set`
  - `n8n-nodes-base.merge` → `merge`
  - `n8n-nodes-base.switch` → `switch`
  - `n8n-nodes-base.emailSend` → `emailSend`
  - `n8n-nodes-base.code` → `code`
  - `n8n-nodes-base.wait` → `wait`
  - `n8n-nodes-base.executeWorkflowTrigger` → `executeWorkflowTrigger`
  - `n8n-nodes-base.manualTrigger` → `manualTrigger`

## Traversal

- Start from the **trigger node** — the node whose type ends in `Trigger` or `webhook`. Every emitted workflow has exactly one.
- Depth-first, following each source's outbound edges in `connections[srcName].main[outputIndex]` order.
- When a node has **multiple outputs** (a switch or if — `main` has length ≥ 2, one array per output), traverse each output as a branch.
- When a node has **multiple inbound edges** in `connections{}`, it's a **forward join**. Precompute the total inbound count and observe how many branches have reached it so far. Every branch reaching a join except the last emits a forward-reference: `→ merges into #<n> <NodeName>` where `<n>` is the join's eventual number (assigned when the node is drawn). The **last** branch (in DFS visit order) draws the join node inline at that point and continues traversal past it.
- **True back-edges** — an edge whose target is an *ancestor on the current DFS path* (i.e. the traversal would re-enter a node still open in the recursion stack) — render as `[back to #<n> <NodeName>]`. See "Back edges" below.
- The distinction between forward-join and back-edge is decided by the ancestor test: if the target is on the DFS path when this edge is encountered → back-edge. Otherwise → forward-join reference.

## Indent + connectors

- Root (trigger) at column 0, no leading connector.
- Each child: **2 spaces of indent** under its parent, then the connector on the child's line.
- Single-outbound parent: child prefixed with `└─→ `.
- Multi-outbound parent (switch/if, or a node with `main.length ≥ 2`): siblings prefixed with `├─→ `, last sibling prefixed with `└─→ `.

### Branch labels

When the parent has multiple outputs, label each branch with its output index in parentheses immediately after the `├─` / `└─`:

- `├─(0)→ `, `└─(1)→ `, and so on.
- If the parent is an `n8n-nodes-base.switch` and its `parameters.rules.values[i]` has a `renameOutput: true` with an `outputKey`, use that string in place of the numeric index: `├─(if)→ `, `└─(else)→ `.
- If the switch has `options.fallbackOutput: 'extra'`, the last output is the default branch — label it `(default)` instead of a number.

### Sub-workflow linkage

For any node with `type === 'n8n-nodes-base.executeWorkflow'`, append `  → subflow: <identifier>` to the end of the node's line. `<identifier>` = `parameters.workflowId.value`. This is the migrator's placeholder (the SBPA process identifier), which matches a sibling `## <workflowName>` section elsewhere in the response so the reader can cross-reference.

## Back edges

A **true back-edge** is an edge whose target is an ancestor on the current DFS path — the traversal would re-enter a node currently open in the recursion stack. Render as:

```
[back to #<n> <NodeName>]
```

at the current indent. The line has no children — traversal stops at the reference. Loops (a switch's "not-done" branch cycling back to a node visited earlier in the same lineage) are the canonical case. See Example 4 below.

Do **not** use this notation for forward joins (Merge, ParallelGateway join, any convergence where flow proceeds *through* the target). Those use the `→ merges into #<n> <NodeName>` forward-reference notation described in "Traversal" and drawn via the algorithm below.

## Rendering algorithm (two-pass with structural pre-scan)

Because forward-join draw sites and their eventual numbers must be known before earlier branches can forward-reference them — and because a node's inbound edges may include back-edges from downstream loops that must not be counted as forward-join inputs — produce the diagram with a **structural pre-scan** followed by two passes.

### Pass 0: structural pre-scan (identify back-edges)

DFS from the trigger once, ignoring rendering. Maintain a `pathSet` (ancestor stack). For every edge encountered:

- If the target is currently in `pathSet` → mark this edge as a **back-edge**.
- Else → forward edge; push target onto `pathSet`, recurse, pop.

At the end of pass 0, every edge is classified as forward or back-edge. Compute `forwardInboundCount[node]` = (raw count of edges targeting the node in `connections{}`) − (number of back-edges targeting the node). This is the count of edges that will drive forward-join classification in pass 1.

### Pass 1: analyze (assign draw sites + plannedNumbers)

DFS from the trigger again. Maintain:

- **`pathSet`** — ancestor stack.
- **`reachCount[node]`** — running count of forward branches that have reached this node.
- **`plannedNumber[node]`** — 1..N in the order nodes will be *drawn*.

For each edge encountered:

1. If the edge was marked back-edge in pass 0 → record `{ kind: 'back', target }`. Do not descend.
2. Else if `forwardInboundCount[target] ≥ 2`: increment `reachCount[target]`. If `reachCount[target] < forwardInboundCount[target]` → record `{ kind: 'join-ref', target }`, do not descend. Otherwise (this is the last forward incoming) → record `{ kind: 'draw', target }`, assign `plannedNumber[target]` = next unused number, push, recurse, pop.
3. Else (`forwardInboundCount[target] === 1`) → record `{ kind: 'draw', target }`, assign `plannedNumber[target]` = next unused number, push, recurse, pop.

At the end of pass 1, every reachable node has a `plannedNumber` and every edge has a `kind`.

### Pass 2: print

Walk the DFS again in the same order. For each edge encountered:

- `kind: 'draw'` — print the target node's line with its `plannedNumber`, indented under its parent with the appropriate connector, then recurse (so the target's outbound edges are printed under it).
- `kind: 'join-ref'` — print `→ merges into #<n> <NodeName>` where `<n>` = `plannedNumber[target]`. No recursion.
- `kind: 'back'` — print `[back to #<n> <NodeName>]` where `<n>` = `plannedNumber[target]`. No recursion.

The result: forward joins render inline where their last incoming branch lands, and all earlier branches naturally read as "this branch merges into #<n> ahead" — matching execution flow. True cycles remain visually distinct with `[back to …]`.

## Isolated nodes

Any node in `nodes[]` that is never visited by the trigger-rooted DFS is an isolated (unreachable) node. Render these under a second heading `### Unreachable nodes` after the main tree, as a flat list — one per line, in `nodes[]` order:

```
### Unreachable nodes
- Orphan Set  [set]
- Dead Http   [httpRequest]
```

In healthy migrations this section is empty and should be omitted.

## Worked examples

The three checked-in fixtures give one example of each shape the algorithm needs to handle.

### Example 1 — Linear (`simple-empty-process`)

Input `connections`:
```json
{
  "StartEvent": { "main": [ [ { "node": "EndEvent", "type": "main", "index": 0 } ] ] }
}
```

Nodes: `StartEvent` (webhook), `EndEvent` (set).

Expected output:
```
## SimpleEmptyProcess

1  StartEvent  [webhook]
  └─→ 2  EndEvent  [set]
```

### Example 2 — Diamond via switch + merge, plus a sub-workflow call (`simple-order-management`)

Nodes (in the caller `Order Management`): `Initialize Custom Data` (code), `StartEvent` (webhook), `Wait 10 minutes` (wait), `Script Task` (code), `Resolve Customer` (executeWorkflow, `workflowId.value: "resolveCustomer"`), `Create Order` (httpRequest), `Send Mail` (emailSend), `Condition` (switch, fallbackOutput: extra), `Merge` (merge).

Connections (abbreviated):
- `StartEvent → Initialize Custom Data`
- `Initialize Custom Data → Script Task`
- `Script Task → Resolve Customer`
- `Resolve Customer → Condition`
- `Condition.main[0] → Wait 10 minutes` (the `<= 10000` rule branch)
- `Condition.main[1] → Create Order` (the default fallback branch)
- `Wait 10 minutes → Send Mail`
- `Send Mail → Merge`
- `Create Order → Merge`

Expected output:
```
## Order Management

1  StartEvent  [webhook]
  └─→ 2  Initialize Custom Data  [code]
       └─→ 3  Script Task  [code]
            └─→ 4  Resolve Customer  [executeWorkflow]  → subflow: resolveCustomer
                 └─→ 5  Condition  [switch]
                      ├─(0)→ 6  Wait 10 minutes  [wait]
                      │      └─→ 7  Send Mail  [emailSend]
                      │           └─→ → merges into #9 Merge
                      └─(default)→ 8  Create Order  [httpRequest]
                                    └─→ 9  Merge  [merge]

## Resolve Customer

1  StartEvent  [executeWorkflowTrigger]
  └─→ 2  EndEvent  [set]
```

Notes:
- `Condition` has two outputs. DFS visits `main[0]` (Wait/SendMail branch) first; that branch reaches Merge as reach #1 of 2, so it emits `→ merges into #9 Merge` — the number Merge will get when it's drawn later. Then DFS visits `main[1]` (Create Order branch); that branch reaches Merge as the last incoming (2 of 2), so **Merge draws inline** as `#9` and traversal continues past it (nothing here, since Merge has no outbound).
- Numbering follows draw order: Create Order draws as `#8` right before Merge draws as `#9`. Numbering never "reserves" a slot for a not-yet-drawn join.
- `Condition` has `options.fallbackOutput: 'extra'`, so its second output labels as `(default)` rather than `(1)`.
- The `Resolve Customer` executeWorkflow node's line gets the `→ subflow: resolveCustomer` suffix so the reader can jump to the callee's own tree below.

### Example 3 — Fan-out via elided ParallelGateway split, then AND-join (`simple-parallel-action-process`)

Nodes: `StartEvent` (webhook), `HelloAction` (httpRequest), `HelloAction 1` (httpRequest), `Merge` (merge — the ParallelGateway join).

Connections:
- `StartEvent.main[0]` contains **both** `HelloAction 1` and `HelloAction` (elided split fan-out; order per the array)
- `HelloAction → Merge`
- `HelloAction 1 → Merge`

Expected output:
```
## SimpleParallelActionProcess

1  StartEvent  [webhook]
  ├─→ 2  HelloAction 1  [httpRequest]
  │    └─→ → merges into #4 Merge
  └─→ 3  HelloAction  [httpRequest]
       └─→ 4  Merge  [merge]
```

Notes:
- No switch node between StartEvent and the two HelloAction branches — because the SBPA split ParallelGateway is elided in the emitted workflow, `StartEvent` itself has two children on `main[0]`. The tree is topologically correct.
- The Merge has `inboundCount = 2`. DFS visits HelloAction 1 first (first in the array) → that branch reaches Merge as reach #1 of 2 → emits `→ merges into #4 Merge`. Then DFS visits HelloAction → that branch reaches Merge as the last incoming → **Merge draws inline** as `#4`.
- `StartEvent`'s two children use `├─→` / `└─→` because there are multiple downstream nodes from the same output port, not because of separate output indices. No numeric/label prefix is needed on the connectors — `StartEvent` isn't a switch, so `main.length === 1` and the multiple children just fan out from that one output.

### Example 4 — True cycle (synthetic loop-until-done)

None of the checked-in fixtures produce a cyclic emitted workflow, but the algorithm supports one. Given a hand-authored workflow: `StartEvent → Init → Loop Body → Check Done → { not-done → Increment → back to Loop Body ; done → Finalize }`.

Nodes: `StartEvent` (webhook), `Init` (set), `Loop Body` (code), `Check Done` (switch, no fallback — pure rules), `Increment` (set), `Finalize` (set).

Connections:
- `StartEvent → Init`
- `Init → Loop Body`
- `Loop Body → Check Done`
- `Check Done.main[0] → Increment` (rule: not done)
- `Check Done.main[1] → Finalize` (rule: done)
- `Increment → Loop Body` (**back-edge** — Loop Body is an ancestor when this edge is followed)

Pass 0 identifies `Increment → Loop Body` as a back-edge (Loop Body is on the DFS ancestor stack when this edge is encountered). So even though `Loop Body`'s raw inbound count is 2, its `forwardInboundCount` = 1 → it's a normal node drawn at first visit, not a forward join.

Expected output:
```
## Loop Example

1  StartEvent  [webhook]
  └─→ 2  Init  [set]
       └─→ 3  Loop Body  [code]
            └─→ 4  Check Done  [switch]
                 ├─(0)→ 5  Increment  [set]
                 │       └─→ [back to #3 Loop Body]
                 └─(1)→ 6  Finalize  [set]
```

Notes:
- `[back to #3 Loop Body]` renders because Increment's outbound target (Loop Body) is on the current DFS ancestor stack when the edge is followed — the ancestor test fires, not the forward-join test.
- Contrast with Example 2: Merge is *not* on Send Mail's DFS ancestor path when Send Mail's outbound points at it (they're siblings under Condition), so Merge is a forward join, not a back-edge.

## Edge cases and clarifications

- **`main` length 1 with multiple children in `main[0]`** (as in example 3): siblings still use `├─→ ` / `└─→ ` because they visually branch; no numeric label because there's only one output port.
- **`main` length ≥ 2** (switch): each output gets its own branch line with the `(<label>)→` prefix, even if that output happens to contain only one child.
- **Elided-EndEvent tails**: EndEvents with no `mappings.in` don't appear in the emitted workflow, so leaf nodes just have no children in the tree — that's the natural encoding of "flow ends here".
- **Initialize Custom Data**: this Code node is emitted between the trigger and the first real node. It renders as `└─→ 2  Initialize Custom Data  [code]` under the trigger, and downstream nodes descend from it — matching the actual connections in the emitted workflow.
- **A merge that's not reached at all**: if for some reason a Merge is present in `nodes[]` but no `connections` entry points at it, it lands in `### Unreachable nodes`. Report a warning inline.
