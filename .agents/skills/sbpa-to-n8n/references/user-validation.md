# User Validation Guide

Steps the user (or the LLM acting on their behalf) takes after the migrated workflow files are produced and imported into n8n.

## 1. Import and structural check

For each `<processIdentifier>.workflow.json`:

1. Import via n8n Editor UI → **Import from File** (or `POST /api/v1/workflows`).
2. Confirm the workflow appears in the list without an import error.
3. Open the workflow and verify:
   - The topology diagram from the migration response matches what you see on the canvas.
   - All nodes have a visible name (none are labelled `"undefined"` or `"null"`).
   - No red error badges on nodes (these indicate a missing credential or invalid parameter).

## 2. Credentials setup

Open each credential stub from `credential-stubs.json` and create the corresponding credential in n8n:

1. Settings → Credentials → New
2. Match the type to the auth type in `credential-stubs.json` (`HTTP Basic Auth`, `OAuth2`, `SMTP`, etc.)
3. Fill in the URL, client ID / secret, or username / password from your environment.
4. Assign the credential to the relevant nodes in the workflow (each ActionTask / MailTask will show a credential selector).

## 3. Trigger smoke test

For each root process, fire the trigger manually:

| Trigger type | How to test |
|---|---|
| Webhook | Set the workflow to **Active**; send a POST request to the displayed webhook URL with a sample payload |
| Scheduled | Set the cron expression to run in 1 minute; wait and check the Execution log |
| S/4HANA event | Publish a test event from the SAP system or use the event trigger's test panel |
| Form | Open the form URL shown in the FormTrigger node |

Expected: the execution appears in **Executions** with status **Success** and the first node produces output.

## 4. Report.json sign-off

Open `report.json` and review every entry:

| Report kind | What to check |
|---|---|
| `custom-var-unsupported-type` | The non-string field was skipped — resolving the gap (how to carry the value) is a design decision for the author |
| `unresolved-subflow` | The sub-workflow was not in the archive — manually wire the `executeWorkflow` node to the correct imported workflow id |
| `script-task-rewrite` | The ScriptTask body was partially rewritten — run the script in n8n's Code node test harness and confirm output |
| `unknown-class-definition` | A node was skipped — decide whether a manual replacement node is needed |
| `formula-parse-failure` | A mapping expression could not be translated — check the `notes` field on the affected node and hand-fix the expression |

All entries must be either resolved or explicitly accepted as out-of-scope before the migration is considered complete.

## 5. End-to-end test

Run a full business scenario through each migrated workflow:

1. Submit a representative input payload (or trigger a test event).
2. Trace the execution path in the Executions panel.
3. Verify the output of every node matches the expected value from the original SBPA process.
4. For sub-workflow processes: confirm the parent workflow's `executeWorkflow` node receives the expected output.

## 6. Acceptance sign-off

The migration is accepted when:

- [ ] All workflows import and are structurally valid
- [ ] All credentials are filled in and tested
- [ ] Smoke tests pass for every trigger
- [ ] All `report.json` entries are resolved or documented
- [ ] At least one end-to-end test passes per root process
- [ ] No hardcoded URLs, tokens, or secrets exist in any workflow JSON
