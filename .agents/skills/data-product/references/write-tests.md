## Testing Data Products

### Overview

Static validation uses `validate.js` — a Node.js script that checks the transformation CDS and DPD file for compliance with PRD acceptance criteria. It produces `test_report.json` in the asset folder.

### Setup

Copy both template files to the asset folder:

```bash
cp <skill-path>/scripts/validate_template.js assets/<asset-name>/validate.js
cp <skill-path>/scripts/validate_rules_template.js assets/<asset-name>/validate_rules.js
```

No constants to fill in — `ENTITY_NAME`, `DPD_FILENAME`, and source inputs are derived automatically from the `.dpd` file at runtime.

**Author PRD checks in `validate_rules.js` only — never modify `validate.js`.** `validate.js` is the generic runner; `validate_rules.js` is the file Claude reads and writes when authoring tests.

### Writing Tests

Rules:
- One `record()` call per PRD acceptance criterion
- Use business language in test names — do not reference technical artifacts
- Signature: `record(section, name, status, reason, duration)` — no test ID argument
- Two sections: `'structure'` (Structure Tests), `'conformance'` (Data Product Conformance Tests)
- Never modify the Structure Tests or Summary sections — only add to the Data Product Conformance Tests section
- If a criterion has no observable form in the transformation, use `status='skip'` with `reason='Not assertable from static analysis'`

### Writing Conformance Checks

Derive a pattern that proves each acceptance criterion is implemented in `transformation.cds`. The pattern should match a construct that would only be present if the requirement is implemented.

- Use `grepView()` for simple regex strings.
- Use `grepViewRegex()` when the pattern contains escaping-sensitive characters or needs a `RegExp` literal.
- Prefer patterns that are specific enough to avoid matching unrelated source definitions.

Pattern template:

```js
t0 = Date.now();
if (grepView('<regex>', TRANSFORMATION_CDS_CONTENT)) {
    record('conformance', '<criterion in business language>', 'pass', 'Pattern found', (Date.now() - t0) / 1000);
} else {
    record('conformance', '<criterion in business language>', 'fail', 'Pattern missing — <consequence>', (Date.now() - t0) / 1000);
}
```

Use `grepView()` / `grepViewRegex()` (not `grep()`) for all structural and business rule checks — they restrict the search to the final `define view` block, preventing false positives from source entity definitions earlier in the file. Use `grep()` only if you specifically need to match something outside the view (rare).

Common mappings (for criteria not listed, derive a pattern directly from the criterion):

| PRD criterion says... | Check for... |
|---|---|
| Exclude records where X = Y | `WHERE X` with `<>`, `!=`, or `= ''` |
| Derive label from boolean field F | `CASE.*F` or `F.*CASE` |
| Group by dimension D | `D` present in view columns |
| Currency field carried through | Each currency field name individually |
| NULL-safe aggregation | `COALESCE.*<field>` |
| Aggregate measure M | `SUM.*M` or `M.*SUM` |

### Running the Tests

- Always run `node validate.js` from the asset folder so `__dirname` resolves paths relative to the script location.

```bash
cd assets/<asset-name>
node validate.js
```

Verify `test_report.json` exists after the run. Fix any failures before proceeding to deployment.

### Handling Failures

A failing test falls into one of two cases:

- **Missing or incorrect implementation** — the transformation does not satisfy the criterion. Return to Step 7 (Iterative Refinement Loop) in `execution.md` to apply the fix; Step 7 handles the full cycle: CDS edit → `generate-interop` → AMS re-approval if needed. Only re-run `validate.js` once Step 7 exits with user approval — `generate-interop` wipes the AMS policy, so running tests before AMS is re-injected will cause AMS policy conformance checks to fail spuriously.
- **Scope gap** — the criterion was intentionally not implemented or is not feasible from the source. Either fix scope via Step 7, or update the PRD to remove the criterion and change the test to `status='skip'` with `reason='Out of scope: <brief reason>'`.
