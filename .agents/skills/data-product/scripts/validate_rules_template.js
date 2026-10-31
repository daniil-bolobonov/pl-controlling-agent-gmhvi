/**
 * Validation Rules — Template
 * -----------------------------
 * Author PRD-specific structural patterns and business rules here.
 * Called from validate.js — do not run directly.
 *
 * Context provided: record, grep, grepRegex, grepView, grepViewRegex,
 *                   TRANSFORMATION_CDS_CONTENT, dpd
 */
module.exports = function runRules({
  _record,
  _grep,
  _grepRegex,
  _grepView,
  _grepViewRegex,
  _TRANSFORMATION_CDS_CONTENT,
  _dpd,
}) {
  let _t0;

  // ── Structural patterns (author per data product) ─────────────────────────────
  // Add checks for key patterns in transformation.cds specific to this data product.
  // Use grepView() / grepViewRegex() — restricts the search to the final view definition,
  // avoiding false positives from source entity definitions earlier in the file.
  // Examples:
  //
  // Field present in view output
  // t0 = Date.now();
  // if (grepView('FieldName', TRANSFORMATION_CDS_CONTENT)) {
  //     record('conformance', '<dimension> is exposed', 'pass', 'Field found in view', (Date.now() - t0) / 1000);
  // } else {
  //     record('conformance', '<dimension> is exposed', 'fail', 'Field missing from view', (Date.now() - t0) / 1000);
  // }
  //
  // Field with special regex characters — use grepViewRegex()
  // t0 = Date.now();
  // if (grepViewRegex(/SOI\.SalesOrder\s*=\s*BDI\.SalesDocument/, TRANSFORMATION_CDS_CONTENT)) {
  //     record('conformance', '<join condition>', 'pass', 'Join condition found', (Date.now() - t0) / 1000);
  // } else {
  //     record('conformance', '<join condition>', 'fail', 'Join condition missing — <consequence>', (Date.now() - t0) / 1000);
  // }

  // ── Business rules (author per PRD acceptance criteria) ───────────────────────
  // One record() call per PRD acceptance criterion. Use plain business language.
  //
  // t0 = Date.now();
  // if (grepView('<regex that proves the criterion>', TRANSFORMATION_CDS_CONTENT)) {
  //     record('conformance', '<plain language criterion>', 'pass', 'Pattern found', (Date.now() - t0) / 1000);
  // } else {
  //     record('conformance', '<plain language criterion>', 'fail', 'Pattern missing — <consequence>', (Date.now() - t0) / 1000);
  // }
};
