---
name: third-party-mcp
description: Intent-Based Development asset skill — third-party MCP server discovery. Provides get_third_party_mcp tool integration for discovering customer-provided MCP servers registered in UMS.
metadata:
  version: 1.0.0
  author: sap-joule-studio
---

# Third-Party MCP Server Discovery

This skill module enables discovery of third-party (customer-provided) MCP servers from UMS.
It is checked for by other skills (`intent-analysis`, `specification`) to conditionally invoke
the `get_third_party_mcp` tool. If this skill is not present in the environment, discovery is skipped.

## When to use `get_third_party_mcp`

Call `get_third_party_mcp` when:
- Building or extending an agent that may benefit from third-party data sources
- Running fit-gap analysis and standard SAP MCP servers do not cover all requirements
- The user's challenge involves customer-provided or external system integrations

Do **not** call it when:
- The asset being built is a pure n8n workflow with no agent component
- The fit-gap analysis is already fully covered by standard SAP MCP servers

## Tool behavior

`get_third_party_mcp` takes an optional `query` argument and returns the matching third-party
MCP servers available in the current landscape. Each result includes:
- `title` — human-readable name
- `ordId` — the MCP server ORD ID to record in the agent's `requires`
- `shortDescription` — a short summary of the server
- `url` — the server endpoint when available

Pass `query` as **keywords separated by semicolons** (e.g. `invoice;payment;order`). The tool
splits the string on `;` into individual keywords and keeps any server whose `title` or
`shortDescription` matches at least one keyword (case-insensitive). Omit `query` to return all
servers.

Results are pre-filtered: `sap.*` (LOB/SAP-owned) and `customer.build:*` (Dual Studio-created)
servers are excluded. Only genuinely third-party servers appear.

Third-party server cards in UMS do **not** carry tool details (a deviation from the LoB
approach — the server card is unavailable during UCL aggregation). There is therefore no
tool-schema discovery step: servers are selected by `title` / `shortDescription`, and the
agent discovers the server's tools at runtime through the gateway.

## Integration points

### intent-analysis

In Step 1 sub-step 3 (API and MCP discovery), call `get_third_party_mcp` once alongside
`sap_knowledge_graph_api_discovery`, passing `query` as semicolon-separated keywords drawn from the
user's challenge. Merge returned servers into the Fit Gap table as
additional **MCP Server** rows (no corresponding API ORD ID — use `—` in that column).

### specification

Invoked by the `specification` skill as sub-step 2d. Receives `<asset-name>` as context.

**Workflow:**

1. Derive keywords from the asset's business challenge and required integrations, using the
   business challenge statement and Fit Gap Analysis table from `intent.md`.
2. Call `get_third_party_mcp` with the keywords joined by semicolons to list the matching
   third-party MCP servers in the current landscape.
   Example: `query: "sourcing;invoice;supplier"`
3. Review the returned servers and keep only those whose `title` or `shortDescription` are
   genuinely relevant to the asset's business challenge or required integrations. Discard
   unrelated servers.
4. For each relevant server, add a `requires` entry to the agent's `asset.yaml`:
   ```yaml
   requires:
     - name: <server-name>
       kind: mcp-server
       ordId: <ordId>
   ```
5. Return the list of selected server `title`s and ORD IDs to the caller.
