# SBPA → n8n Node & Property Mapping Reference

Detailed mapping of every SBPA node class to its n8n equivalent, including which SBPA property becomes which n8n parameter, with sample payloads for each type.

---

## 1. StartEvent

**SBPA class:** `com.sap.bpm.wfs.StartEvent`
**Source file:** `scripts/activities/startEvent.js`

The emitted n8n node type depends on how the process is invoked:

| Condition (bound trigger) | n8n Node Type | typeVersion |
|-----------|--------------|-------------|
| `trigger.api` | `n8n-nodes-base.webhook` | 2 |
| `trigger.event` | `CUSTOM.sapS4HanaEventTrigger` | 1 |
| `trigger.scheduled` | `n8n-nodes-base.scheduleTrigger` | 1.2 |
| `trigger.form` (`bpi.form` dependency) | `n8n-nodes-base.formTrigger` | 1 |
| Neither (fallback) | `n8n-nodes-base.manualTrigger` | 1 |

> **Subflow processes emit three nodes, not one.** When a process is referenced as a sub-workflow by another process, the StartEvent emits: (1) `n8n-nodes-base.executeWorkflowTrigger` (typeVersion 1, `inputSource: 'passthrough'`) as the primary trigger; (2) the standalone trigger from the table above, suffixed `(Standalone)`; and (3) a `n8n-nodes-base.set` (typeVersion 3.4) *normalize* node named exactly as the StartEvent, with `jsonOutput: '={{ Object.assign({}, $json.body ?? {}, $json) }}'` so downstream expressions resolve identically whether invoked via webhook (`$json.body`) or `executeWorkflow` (`$json`). See `activity-mapping.md` → *StartEvent trigger dispatch* for the full dispatch logic.

### Property mapping — Webhook trigger

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `trigger.api.header.triggerId` | `parameters.path` | kebab-cased path segment |
| *(fixed)* | `parameters.httpMethod` | Always `"POST"` |
| *(fixed)* | `parameters.responseMode` | Always `"onReceived"` |
| `trigger.uid` | `parameters.webhookId` | UUID that identifies the webhook |

### Property mapping — executeWorkflowTrigger

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| *(fixed)* | `parameters.inputSource` | Always `"passthrough"` |

### Property mapping — manualTrigger

No parameters emitted (`parameters: {}`).

### Sample payloads

**SBPA input (StartEvent node in bpi.process):**
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "_uuid": "startEvent",
  "id": "StartEvent_1"
}
```
*Trigger artifact (`trigger.api` header):*
```json
{
  "triggerId": "new-order",
  "uid": "d30240e5-eef5-45bc-9044-d82f775dafe7"
}
```

**n8n output (webhook variant):**
```json
{
  "id": "a1b2c3d4",
  "name": "StartEvent",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "parameters": {
    "httpMethod": "POST",
    "path": "new-order",
    "responseMode": "onReceived"
  },
  "webhookId": "d30240e5-eef5-45bc-9044-d82f775dafe7"
}
```

**n8n output (subflow variant):**
```json
{
  "id": "a1b2c3d4",
  "name": "StartEvent",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1,
  "parameters": {
    "inputSource": "passthrough"
  }
}
```

---

## 2. EndEvent

**SBPA class:** `com.sap.bpm.wfs.EndEvent`
**Source file:** `scripts/activities/endEvent.js`

| Condition | n8n Node Type | typeVersion |
|-----------|--------------|-------------|
| No output mappings | *(elided — no node emitted)* | — |
| Has output mappings | `n8n-nodes-base.set` | 3.4 |

### Property mapping — Set node (with mappings)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `mappings.in` key | `parameters.assignments.assignments[].name` | Each mapping key becomes an assignment |
| `mappings.in[key].value` (formula) | `parameters.assignments.assignments[].value` | Translated via `translate()` |
| `interfaces.in` JSON Schema for key | `parameters.assignments.assignments[].type` | Resolved from schema; fallback `"string"` |
| *(fixed)* | `parameters.assignments.mode` | Always `"manual"` |
| *(fixed)* | `parameters.assignments.duplicateItem` | Always `false` |

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.EndEvent",
  "_uuid": "endEvent",
  "id": "EndEvent_1",
  "mappings": {
    "in": {
      "names":        { "value": "context.custom.names" },
      "approvaltype": { "value": "'Manual'" }
    }
  },
  "interfaces": {
    "in": {
      "names":        { "type": "array" },
      "approvaltype": { "type": "string" }
    }
  }
}
```

**n8n output:**
```json
{
  "id": "e5f6a7b8",
  "name": "EndEvent",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "parameters": {
    "mode": "manual",
    "duplicateItem": false,
    "assignments": {
      "assignments": [
        {
          "id": "assign-names",
          "name": "names",
          "type": "array",
          "value": "={{ $('Read Custom Data: EndEvent').item.json.custom.names }}"
        },
        {
          "id": "assign-approvaltype",
          "name": "approvaltype",
          "type": "string",
          "value": "Manual"
        }
      ]
    },
    "options": {}
  }
}
```

---

## 3. IntermediateCatchEvent — TimerEventDefinition

**SBPA class:** `com.sap.bpm.wfs.IntermediateCatchEvent` (child: `TimerEventDefinition`)
**Source file:** `scripts/activities/timerEvent.js`
**n8n node:** `n8n-nodes-base.wait` (typeVersion 1.1)

The `wait` node has two modes, selected by which property the SBPA timer carries:

**(A) Relative wait — `timeDuration` property → `resume: "timeInterval"`**

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `TimerEventDefinition.timeDuration.value` | `parameters.amount` | Numeric quantity extracted from ISO 8601 |
| `TimerEventDefinition.timeDuration.value` | `parameters.unit` | Unit extracted: `"days"` / `"hours"` / `"minutes"` / `"seconds"` |
| *(fixed)* | `parameters.resume` | `"timeInterval"` |

**(B) Absolute wait — `timestamp` property → `resume: "specificTime"`**

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `TimerEventDefinition.timestamp` (formula / JUEL) | `parameters.dateTime` | Translated expression (absolute point-in-time) |
| *(fixed)* | `parameters.resume` | `"specificTime"` |

**ISO 8601 parsing:**

| Duration string | `amount` | `unit` | Notes |
|----------------|---------|--------|-------|
| `P2D` | `2` | `"days"` | |
| `PT3H` | `3` | `"hours"` | |
| `PT10M` | `10` | `"minutes"` | |
| `PT30S` | `30` | `"seconds"` | |
| `P1W` *(weeks)* | `7` | `"days"` | converted exactly |
| `P2W` *(weeks)* | `14` | `"days"` | converted exactly |
| `P1M` *(months)* | `30` | `"days"` | approximate — see gap note |
| `P1Y` *(years)* | `365` | `"days"` | approximate — see gap note |

> **Gap — Months and Years have no exact `timeInterval` unit.**
> SBPA allows timer durations expressed in months (`P{n}M`) and years (`P{n}Y`). The n8n `wait` node's `timeInterval` mode has no native months or years unit, so the migrator converts them to days using fixed multipliers (1 month = 30 days, 1 year = 365 days) and emits a `timer-duration-approximate` report entry.
> **Preferred fix during authoring:** switch the node to `resume: "specificTime"` with a Luxon-computed `dateTime`, which resolves calendar months/years correctly:
> ```
> dateTime: {{ DateTime.now().plus({ months: n }).toISO() }}
> ```
> Use this instead of the fixed day-count approximation whenever the business meaning is a true calendar offset (e.g. a "1-month SLA").

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.IntermediateCatchEvent",
  "_uuid": "timerEvent1",
  "id": "IntermediateCatchEvent_1",
  "eventDefinitions": {
    "timerDef1": "TimerEventDefinition_ref"
  }
}
```
*Referenced TimerEventDefinition:*
```json
{
  "classDefinition": "com.sap.bpm.wfs.TimerEventDefinition",
  "_uuid": "TimerEventDefinition_ref",
  "timeDuration": { "value": "\"PT10M\"" }
}
```

**n8n output:**
```json
{
  "id": "c9d0e1f2",
  "name": "Wait 10 minutes",
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "parameters": {
    "resume": "timeInterval",
    "amount": 10,
    "unit": "minutes"
  }
}
```

---

## 4. IntermediateCatchEvent — MessageEventDefinition

**SBPA class:** `com.sap.bpm.wfs.IntermediateCatchEvent` (child: `MessageEventDefinition`)
**Source file:** `scripts/activities/timerEvent.js`
**n8n node:** `n8n-nodes-base.wait` (typeVersion 1.1)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `MessageEventDefinition.messageRef` | `parameters.webhookId` | Deterministic UUID derived from message identifier |
| *(fixed)* | `parameters.resume` | Always `"webhook"` |
| *(fixed)* | `parameters.httpMethod` | Always `"POST"` |

Message schema (if present) is stored in `ctx.messageEventSchemas` for downstream reference but does not produce additional parameters.

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.IntermediateCatchEvent",
  "_uuid": "msgEvent1",
  "id": "IntermediateCatchEvent_2",
  "eventDefinitions": {
    "msgDef1": "MessageEventDefinition_ref"
  }
}
```
*Referenced MessageEventDefinition:*
```json
{
  "classDefinition": "com.sap.bpm.wfs.MessageEventDefinition",
  "_uuid": "MessageEventDefinition_ref",
  "messageRef": "Message_approvalResult"
}
```

**n8n output:**
```json
{
  "id": "f3a4b5c6",
  "name": "Wait for IME SubProcess",
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "parameters": {
    "resume": "webhook",
    "httpMethod": "POST",
    "options": {}
  },
  "webhookId": "00000000-0000-0000-0000-000029e2b98b"
}
```

---

## 5. ScriptTask / GenericSkill(Script)

**SBPA classes:**
- `com.sap.bpm.wfs.ScriptTask`
- `com.sap.bpm.wfs.GenericSkillTask` with `extensionType: "ScriptTask"`

**Source file:** `scripts/activities/scriptTask.js`
**n8n node:** `n8n-nodes-base.code` (typeVersion 2)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `script.content` (ScriptTask) | `parameters.jsCode` | Full script body; context refs rewritten (see below) |
| `customProperties.script.content` (GenericSkillTask) | `parameters.jsCode` | Same rewrite applied |
| *(fixed)* | `parameters.mode` | Always `"runOnceForEachItem"` |
| *(fixed)* | `parameters.language` | Always `"javaScript"` |

**Context reference rewrites inside `jsCode`:**

| SBPA pattern in script | Rewritten to | When |
|------------------------|-------------|------|
| `$.context.startEvent.<path>` | `$json.body.<path>` | Trigger is webhook |
| `$.context.startEvent.<path>` | `$json.<path>` | Trigger is not webhook |
| `$.context.custom.<path>` | `custom.<path>` | Local scoped variable |
| `$.context.<nodeId>.<path>` | `$('<NodeDisplayName>').item.json.<path>` | Cross-node reference |

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ScriptTask",
  "_uuid": "scriptTask1",
  "id": "ScriptTask_1",
  "script": {
    "content": "var i = 0;\nfor (i = 0; i < $.context.startEvent.firstnames.length; i++) {\n  custom.names.push($.context.startEvent.firstnames[i] + ' ' + $.context.startEvent.lastnames[i]);\n}\n"
  }
}
```

**n8n output:**
```json
{
  "id": "d7e8f9a0",
  "name": "Script Task",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "mode": "runOnceForEachItem",
    "language": "javaScript",
    "jsCode": "// Migrated from SBPA ScriptTask ScriptTask_1\nconst custom = JSON.parse(JSON.stringify($json.custom || {}));\n\nvar i = 0;\nfor (i = 0; i < $json.body.firstnames.length; i++) {\n  custom.names.push($json.body.firstnames[i] + ' ' + $json.body.lastnames[i]);\n}\n\nreturn { ...$json, custom };"
  }
}
```

---

## 6. ActionTask

**SBPA class:** `com.sap.bpm.wfs.ActionTask`
**Source file:** `scripts/activities/actionTask.js`

Always emits `n8n-nodes-base.httpRequest` (typeVersion 4.2).

### Property mapping — httpRequest

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `actionIdentifier` (resolved via metadata) | `parameters.url` | Full URL constructed from destination base URL + REST path |
| `destination` (static name) | `parameters.url` prefix | `{{ $vars.<dest>_baseUrl }}<path>` placeholder |
| `destination` (static name) | `credentials.httpHeaderAuth.name` | Credential stub name: `"SBPA destination: <dest>"` |
| HTTP operation from metadata | `parameters.method` | e.g. `"GET"`, `"POST"`, `"PATCH"` |
| Content type from metadata | `parameters.contentType` | `"json"` or `"raw"` |
| `mappings.in` key | `parameters.bodyParameters.parameters[].name` | Each input mapping key |
| `mappings.in[key].value` (formula) | `parameters.bodyParameters.parameters[].value` | Translated via `translate()` |
| *(fixed)* | `parameters.sendBody` | Always `true` |
| *(fixed)* | `parameters.specifyBody` | Always `"keypair"` |

**Dynamic destination (expression-valued):**

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| Destination expression | `parameters.url` | `{{ $vars.<safeId>_baseUrl }}/dispatch<path>` |
| Destination expression (translated) | `parameters.headerParameters[X-Destination]` | Evaluated header for runtime dispatch |

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ActionTask",
  "_uuid": "actionTask1",
  "id": "ActionTask_1",
  "actionIdentifier": "post_orders",
  "destination": "erp",
  "mappings": {
    "in": {
      "channel":  { "value": "context.startEvent.channel" },
      "currency": { "value": "context.startEvent.currency" }
    }
  }
}
```

**n8n output (httpRequest — default):**
```json
{
  "id": "b1c2d3e4",
  "name": "Create Order",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "POST",
    "url": "={{ $vars.erp_baseUrl }}/orders",
    "sendBody": true,
    "contentType": "json",
    "specifyBody": "keypair",
    "bodyParameters": {
      "parameters": [
        { "name": "channel",  "value": "={{ $json.body.channel }}" },
        { "name": "currency", "value": "={{ $json.body.currency }}" }
      ]
    }
  },
  "credentials": {
    "httpHeaderAuth": {
      "id": "",
      "name": "SBPA destination: erp"
    }
  }
}
```

---

## 7. MailTask

**SBPA class:** `com.sap.bpm.wfs.MailTask`
**Source file:** `scripts/activities/mailTask.js`
**n8n node:** `n8n-nodes-base.emailSend` (typeVersion 2.1)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `MailDefinition.to` (JUEL string) | `parameters.toEmail` | JUEL interpolation → n8n expression |
| `MailDefinition.subject` (JUEL string) | `parameters.subject` | JUEL interpolation → n8n expression |
| `MailDefinition.html` (JUEL string) | `parameters.html` | JUEL interpolation → n8n expression |
| *(fixed)* | `parameters.emailFormat` | Always `"html"` |
| *(fixed)* | `parameters.fromEmail` | Placeholder `"sender@example.invalid"` (user must fill) |

`MailDefinition` is a separate artifact in the `.mtar`; the task references it via `mailDefinitionRef`.

### Sample payloads

**SBPA input (MailTask node):**
```json
{
  "classDefinition": "com.sap.bpm.wfs.MailTask",
  "_uuid": "mailTask1",
  "id": "MailTask_1",
  "mailDefinitionRef": "mailDef-uuid-abc"
}
```
*Referenced MailDefinition artifact:*
```json
{
  "classDefinition": "com.sap.bpm.wfs.MailDefinition",
  "_uuid": "mailDef-uuid-abc",
  "to": "ops@example.com",
  "subject": "Check Order: ${context.startEvent.orderid}",
  "html": "<p>Dear Ops Team,</p><p>please check order: ${context.startEvent.orderid}.</p>"
}
```

**n8n output:**
```json
{
  "id": "f5a6b7c8",
  "name": "Send Mail",
  "type": "n8n-nodes-base.emailSend",
  "typeVersion": 2.1,
  "parameters": {
    "fromEmail": "sender@example.invalid",
    "toEmail": "ops@example.com",
    "subject": "={{ \"Check Order: \" + ($json.body.orderid) }}",
    "emailFormat": "html",
    "html": "={{ \"<p>Dear Ops Team,</p><p>please check order: \" + ($json.body.orderid) + \".</p>\" }}",
    "options": {}
  }
}
```

---

## 8. UserTask

**SBPA class:** `com.sap.bpm.wfs.UserTask`
**Source file:** `scripts/activities/userTask.js`

| Condition | n8n Node Type | typeVersion |
|-----------|--------------|-------------|
| Always | `CUSTOM.sapTaskCenter` | 1 |
| Has `decisionOptions` | + inline `n8n-nodes-base.switch` | 3.2 |

> For the full, maintained contract of this node (parameters, recipient rules, custom attributes), see the `n8n-workflow` skill's `references/n8n-sap-task-center/n8n-sap-task-center.md`. The table below reflects only what the converter emits. Note that skill's "always ask the user for the recipient" rule is satisfied here by the SBPA archive — `recipientUsers` / `recipientGroups` come from the source process, so the authoring pass must **not** prompt the user.

### Property mapping — SAP Task Center node

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| *(fixed)* | `parameters.action` | `"sendApprovalTask"` |
| `subject` (JUEL) | `parameters.subject` | JUEL interpolation → n8n expression |
| `priority` | `parameters.priority` | Direct; default `"MEDIUM"` |
| `description` | `parameters.description` | Direct; `""` if empty |
| `name` (display name) | `parameters.taskDefinition.definitionName` | Task definition name shown in SAP Task Center |
| `recipientUsers` (JUEL) | `parameters.recipients.recipientValues[].userId` | JUEL interpolation → n8n expression; omitted if absent |
| `recipientGroups` (JUEL) | `parameters.recipientGroups.recipientGroupValues[].groupId` | JUEL interpolation → n8n expression; omitted if absent |

### Property mapping — Decision Switch node (when `decisionOptions` present)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `decisionOptions[].id == "approve"` | Switch rule: `result.response == "approved"` | String-equals condition |
| `decisionOptions[].id == "reject"` | Switch rule: `result.response == "rejected"` | String-equals condition |
| SequenceFlow.condition (fallback) | Switch rule: JUEL-wrapped boolean | Used when decision option not recognised |

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.UserTask",
  "_uuid": "userTask1",
  "id": "UserTask_1",
  "subject": "Approve Invoice: ${context.startEvent.orderId}",
  "priority": "MEDIUM",
  "recipientUsers": "${context.startEvent.approver}",
  "decisionOptions": [
    { "id": "approve", "label": "Approve" },
    { "id": "reject",  "label": "Reject" }
  ]
}
```

**n8n output — SAP Task Center node:**
```json
{
  "id": "d9e0f1a2",
  "name": "UserTask_1",
  "type": "CUSTOM.sapTaskCenter",
  "typeVersion": 1,
  "parameters": {
    "action": "sendApprovalTask",
    "subject": "={{ \"Approve Invoice: \" + ($json.body.orderId) }}",
    "priority": "MEDIUM",
    "description": "",
    "taskDefinition": {
      "definitionName": "UserTask_1"
    },
    "recipients": {
      "recipientValues": [
        { "userId": "={{ ($json.body.approver) }}" }
      ]
    }
  }
}
```

**n8n output — attached Decision Switch:**
```json
{
  "id": "b3c4d5e6",
  "name": "UserTask_1 Decision",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.2,
  "parameters": {
    "mode": "rules",
    "rules": {
      "values": [
        {
          "conditions": {
            "conditions": [
              {
                "leftValue":  "={{ $('UserTask_1').item.json.result.response }}",
                "rightValue": "approved",
                "operator": { "type": "string", "operation": "equals" }
              }
            ]
          }
        },
        {
          "conditions": {
            "conditions": [
              {
                "leftValue":  "={{ $('UserTask_1').item.json.result.response }}",
                "rightValue": "rejected",
                "operator": { "type": "string", "operation": "equals" }
              }
            ]
          }
        }
      ]
    }
  }
}
```

---

## 9. ReferencedSubflow

**SBPA class:** `com.sap.bpm.wfs.ReferencedSubflow`
**Source file:** `scripts/activities/referencedSubflow.js`
**n8n node:** `n8n-nodes-base.executeWorkflow` (typeVersion 1.2)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| `executionArtifactRef` → ProcessDefinition.uid | `parameters.workflowId.value` | SBPA process UID (LLM patches to actual n8n workflow ID post-import) |
| `executionArtifactRef` → ProcessDefinition.name | `parameters.workflowId.cachedResultName` | Display name for reference |
| *(fixed)* | `parameters.workflowId.__rl` | Always `true` (resource locator) |
| *(fixed)* | `parameters.workflowId.mode` | Always `"id"` |
| *(fixed)* | `parameters.source` | Always `"database"` |
| *(fixed)* | `parameters.mode` | Always `"each"` |
| `mappings.in[key]` formula | `parameters.workflowInputs.value[key]` | Translated input mapping |
| `interfaces.in` JSON Schema for key | `parameters.workflowInputs.schema[].type` | Type per key; fallback `"string"` |

**Schema entry structure per input key:**
```json
{
  "id": "<key>",
  "displayName": "<key>",
  "type": "<n8nType>",
  "defaultMatch": false,
  "display": true,
  "required": false,
  "canBeUsedToMatch": false
}
```

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ReferencedSubflow",
  "_uuid": "subflow1",
  "id": "ReferencedSubflow_1",
  "executionArtifactRef": "procDefWrapper-resolve-customer",
  "mappings": {
    "in": {
      "customerid": { "value": "context.startEvent.customer.externalId" }
    }
  },
  "interfaces": {
    "in": {
      "customerid": { "type": "string" }
    }
  }
}
```
*Referenced ProcessDefinition:*
```json
{
  "classDefinition": "com.sap.bpm.wfs.ProcessDefinition",
  "uid": "resolveCustomer",
  "name": "Resolve Customer"
}
```

**n8n output:**
```json
{
  "id": "c7d8e9f0",
  "name": "Resolve Customer",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.2,
  "parameters": {
    "source": "database",
    "mode": "each",
    "workflowId": {
      "__rl": true,
      "value": "resolveCustomer",
      "mode": "id",
      "cachedResultName": "Resolve Customer"
    },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": {
        "customerid": "={{ $json.body.customer.externalId }}"
      },
      "schema": [
        {
          "id": "customerid",
          "displayName": "customerid",
          "type": "string",
          "defaultMatch": false,
          "display": true,
          "required": false,
          "canBeUsedToMatch": false
        }
      ]
    }
  }
}
```

---

## 10. ExclusiveGateway — Branch shape

**SBPA class:** `com.sap.bpm.wfs.ExclusiveGateway` (≥2 outbound flows, conditions present)
**Source file:** `scripts/activities/exclusiveGateway.js`
**n8n node:** `n8n-nodes-base.switch` (typeVersion 3.2)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| Each non-default SequenceFlow | `parameters.rules.values[]` | One rule object per conditional outbound flow |
| `SequenceFlow.condition` (JUEL) | `rules[i].conditions.conditions[].leftValue` | Translated to n8n expression |
| *(fixed)* | `rules[i].conditions.conditions[].rightValue` | Always `true` |
| *(fixed)* | `rules[i].conditions.operator` | `{ type: "boolean", operation: "true" }` |
| `default` SequenceFlow present | `parameters.options.fallbackOutput` | `"extra"` if default exists, else `"none"` |

### Sample payloads

**SBPA input (gateway + outbound flows):**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ExclusiveGateway",
  "_uuid": "gw1",
  "id": "ExclusiveGateway_1",
  "default": "flow-default"
}
```
*Outbound SequenceFlows:*
```json
[
  {
    "classDefinition": "com.sap.bpm.wfs.SequenceFlow",
    "_uuid": "flow-low",
    "sourceRef": "gw1",
    "condition": "${context.custom.normalizedtotals.gross <= 10000}"
  },
  {
    "classDefinition": "com.sap.bpm.wfs.SequenceFlow",
    "_uuid": "flow-default",
    "sourceRef": "gw1"
  }
]
```

**n8n output:**
```json
{
  "id": "a2b3c4d5",
  "name": "Condition",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.2,
  "parameters": {
    "mode": "rules",
    "rules": {
      "values": [
        {
          "conditions": {
            "options": { "caseSensitive": true, "typeValidation": "strict" },
            "conditions": [
              {
                "leftValue":  "={{ $json.custom.normalizedtotals.gross <= 10000 }}",
                "rightValue": true,
                "operator": { "type": "boolean", "operation": "true" }
              }
            ]
          }
        }
      ]
    },
    "options": { "fallbackOutput": "extra" }
  }
}
```

---

## 11. ExclusiveGateway — Merge shape

**SBPA class:** `com.sap.bpm.wfs.ExclusiveGateway` (≥2 inbound flows, 1 outbound, no conditions)
**Source file:** `scripts/activities/exclusiveGateway.js`
**n8n node:** `n8n-nodes-base.merge` (typeVersion 3.2)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| *(fixed)* | `parameters.mode` | Always `"append"` (XOR passthrough semantics) |
| Number of inbound flows > 2 | `parameters.numberInputs` | Only set when > 2 |

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ExclusiveGateway",
  "_uuid": "gwMerge1",
  "id": "ExclusiveGateway_Merge"
}
```
*(Two inbound SequenceFlows, one outbound, no conditions on any flow)*

**n8n output:**
```json
{
  "id": "e6f7a8b9",
  "name": "Merge",
  "type": "n8n-nodes-base.merge",
  "typeVersion": 3.2,
  "parameters": {
    "mode": "append"
  }
}
```

---

## 12. ParallelGateway — Split shape

**SBPA class:** `com.sap.bpm.wfs.ParallelGateway` (≤1 inbound, ≥2 outbound)
**Source file:** `scripts/activities/parallelGateway.js`

**Elided** — no n8n node emitted. Fan-out is handled natively by n8n v1 execution order when a node has multiple outbound connections.

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ParallelGateway",
  "_uuid": "pgSplit1",
  "id": "ParallelGateway_Split"
}
```
*(One inbound flow, two or more outbound flows)*

**n8n output:** *(none — the predecessor node's output is wired directly to both branches)*

---

## 13. ParallelGateway — Join shape

**SBPA class:** `com.sap.bpm.wfs.ParallelGateway` (≥2 inbound, 1 outbound)
**Source file:** `scripts/activities/parallelGateway.js`
**n8n node:** `n8n-nodes-base.merge` (typeVersion 3.2)

| SBPA source | n8n parameter | Notes |
|-------------|--------------|-------|
| *(fixed)* | `parameters.mode` | Always `"chooseBranch"` (AND-join semantics) |
| *(fixed)* | `parameters.chooseBranchMode` | Always `"waitForAll"` |
| *(fixed)* | `parameters.output` | Always `"empty"` (emits a single empty item after sync) |
| Number of inbound flows > 2 | `parameters.numberInputs` | Only set when > 2 |

### Sample payloads

**SBPA input:**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ParallelGateway",
  "_uuid": "pgJoin1",
  "id": "ParallelGateway_Join"
}
```
*(Two or more inbound flows, one outbound flow)*

**n8n output:**
```json
{
  "id": "c0d1e2f3",
  "name": "Merge",
  "type": "n8n-nodes-base.merge",
  "typeVersion": 3.2,
  "parameters": {
    "mode": "chooseBranch",
    "chooseBranchMode": "waitForAll",
    "output": "empty"
  }
}
```

---

## 14. DataObject / Custom Variables

**SBPA class:** `com.sap.bpm.wfs.DataObject`
**Source file:** `scripts/graph.js`

**Detection:** A process uses custom variables if it contains at least one `com.sap.bpm.wfs.DataObject` node (`graph.js`: `customVarsDetected = dataObjects.length > 0`). Detection is based on `DataObject` presence only — mapping-key inspection does **not** trigger injection.

When detected, three `n8n-nodes-base.code` (typeVersion 2, `runOnceForAllItems`) nodes are auto-injected around the affected nodes. `$execution.customData` is used as the process-scoped key-value store; it persists across nodes within the same execution.

---

### 14a. "Initialize Custom Data" — injected after the trigger

Reads the current `$execution.customData`, seeds any fields declared in the StartEvent's `mappings.out['custom'][...]` (only if not already set), and returns `[]`.

**Generated code shape:**
```js
// Initialize custom variables from $execution.customData.
// Fields with defaults from StartEvent are seeded only if not already set.
const cd = $execution.customData.getAll();

if (!("custstr" in cd)) $execution.customData.set("custstr", "defaultValue");
if (!("cust2"  in cd)) $execution.customData.set("cust2",  $('StartEvent').item.json.body.instatus);

return [];
```

| Source | Generated JS |
|--------|-------------|
| `StartEvent.mappings.out["['custom']['field']"].value` (literal) | `if (!(field in cd)) $execution.customData.set(field, "literal");` |
| `StartEvent.mappings.out["['custom']['field']"].value` (formula) | `if (!(field in cd)) $execution.customData.set(field, <translated n8n expr>);` |

**Wiring:** Trigger → **Initialize Custom Data** → first real node

---

### 14b. "Update Custom Data: \<NodeName\>" — injected after each writer node

Emitted after every node whose `mappings.out` contains a `['custom']['field']` key (except StartEvent, which is already handled by 14a). Translates the formula value and calls `$execution.customData.set()`. Returns `[]`.

**Generated code shape:**
```js
// Persist custom variable updates to $execution.customData.
// output = the JSON output of the preceding node.
const output = $input.first().json;
$execution.customData.set("custstr", output.returnstatus);
return [{ ...$execution.customData.getAll() }];
```

| SBPA source | Generated JS |
|-------------|-------------|
| `mappings.out["['custom']['field']"].value = "output.returnstatus"` | `$execution.customData.set("field", output.returnstatus);` |
| `mappings.out["['custom']['field']"].value = "context.startEvent.x"` | `$execution.customData.set("field", $('StartEvent').item.json.body.x);` |

`const output = $input.first().json;` is always prepended so raw `output.*` formula values are resolvable.

**Wiring:** NodeName → **Update Custom Data: NodeName** → next node (or reader if next node reads custom vars)

---

### 14c. "Read Custom Data: \<NodeName\>" — injected before each reader node

Emitted before every node that references `context.custom.*` in its `mappings.in`, JUEL fields (subject/description/html), or script body. Returns `[{ custom: $execution.customData.getAll() }]` so downstream formula expressions resolve via `$json.custom.<field>`.

**Generated code (fixed):**
```js
// Load $execution.customData into $json.custom for downstream formula access.
return [{ ...$execution.customData.getAll() }];
```

**Wiring:** previous node → **Read Custom Data: NodeName** → NodeName

---

### Full injection example

For a process with StartEvent → subProcess → Send Mail (reads custom) → EndEvent (reads custom):

```
StartEvent
  → Initialize Custom Data
    → subProcess
      → Update Custom Data: subProcess
        → Read Custom Data: Send Mail
          → Send Mail
            → Read Custom Data: EndEvent
              → EndEvent
```

### Sample payloads

**SBPA input (StartEvent with custom var default):**
```json
{
  "classDefinition": "com.sap.bpm.wfs.StartEvent",
  "mappings": {
    "out": {
      "['custom']['custstr']": { "value": "\"defaultValue\"" }
    }
  }
}
```

**n8n output — "Initialize Custom Data" code node:**
```json
{
  "id": "n8n-1",
  "name": "Initialize Custom Data",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "// Initialize custom variables from $execution.customData.\n// Fields with defaults from StartEvent are seeded only if not already set.\nconst cd = $execution.customData.getAll();\n\nif (!(\"custstr\" in cd)) $execution.customData.set(\"custstr\", \"defaultValue\");\n\nreturn [];"
  }
}
```

**SBPA input (subProcess writing to custom var):**
```json
{
  "classDefinition": "com.sap.bpm.wfs.ReferencedSubflow",
  "mappings": {
    "out": {
      "['custom']['custstr']": { "value": "output.returnstatus" }
    }
  }
}
```

**n8n output — "Update Custom Data: subProcess" code node:**
```json
{
  "id": "n8n-5",
  "name": "Update Custom Data: subProcess",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "// Persist custom variable updates to $execution.customData.\n// output = the JSON output of the preceding node.\nconst output = $input.first().json;\n$execution.customData.set(\"custstr\", output.returnstatus);\nreturn [];"
  }
}
```

**n8n output — "Read Custom Data: Send Mail" code node:**
```json
{
  "id": "n8n-6",
  "name": "Read Custom Data: Send Mail",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "// Load $execution.customData into $json.custom for downstream formula access.\nreturn [{ custom: $execution.customData.getAll() }];"
  }
}
```

---

## 15. Environment Variables / Destinations

**SBPA concept:** `archive.destinations` (declared in the `.mtar` manifest)
**n8n concept:** Credential stubs in `credential-stubs.json`

| SBPA element | n8n element | Notes |
|-------------|------------|-------|
| Destination identifier | Credential name | `"SBPA destination: <identifier>"` |
| *(fixed)* | Credential type | `httpHeaderAuth` |
| *(fixed)* | `data.name` | `"Authorization"` |
| *(fixed)* | `data.value` | `""` (customer must fill post-import) |

URL placeholder in `httpRequest` nodes:
```
={{ $vars.<destName_safe>_baseUrl }}<rest-path>
```
`<destName_safe>` replaces all non-alphanumeric characters with `_`.

### Sample payloads

**SBPA input (manifest entry):**
```json
{
  "destinations": [
    { "name": "erp", "type": "HTTP" },
    { "name": "my-backend", "type": "HTTP" }
  ]
}
```

**n8n output (`credential-stubs.json` stubs):**
```json
[
  {
    "id": "cred-erp",
    "name": "SBPA destination: erp",
    "type": "httpHeaderAuth",
    "data": { "name": "Authorization", "value": "" }
  },
  {
    "id": "cred-my-backend",
    "name": "SBPA destination: my-backend",
    "type": "httpHeaderAuth",
    "data": { "name": "Authorization", "value": "" }
  }
]
```

**URL placeholder in httpRequest node:**
```
={{ $vars.my_backend_baseUrl }}/api/v1/orders
```

---

## 16. Structural Nodes (no emission)

These SBPA classes are processed by their parent emitter and produce no standalone n8n node (`{ node: null }`):

| SBPA class | Consumed by | Purpose |
|------------|------------|---------|
| `MessageEventDefinition` | IntermediateCatchEvent emitter | Provides webhook ID / message reference |
| `TimerEventDefinition` | IntermediateCatchEvent emitter | Provides ISO 8601 duration |
| `Message` | IntermediateCatchEvent emitter | Message reference resolution |
| `UserTaskDefinition` | UserTask emitter | Form schema descriptor |
| `MailDefinition` | MailTask emitter | Email field source |
| `ProcessDefinition` | ReferencedSubflow emitter | Target process wrapper |
| `SequenceFlow` | `graph.js` | Connection data only |
| `Model` | `graph.js` root | Process container |
| `ProjectDefinition` | `graph.js` | Project container |

---

## 17. Expression / Formula Translation

Two expression grammars are used in SBPA. Both are translated to n8n `={{ … }}` expressions.

### SBPA Formula (mapping values)

Used in `mappings.in[*].value`, `mappings.out[*].value`, ActionTask / ReferencedSubflow body parameters.

| SBPA reference | n8n expression | Condition |
|---------------|---------------|-----------|
| `context.startEvent.<path>` | `={{ $json.body.<path> }}` | Trigger is webhook |
| `context.startEvent.<path>` | `={{ $json.<path> }}` | Trigger is not webhook |
| `context.custom.<path>` | `={{ $('Read Custom Data: <NodeName>').item.json.custom.<path> }}` | Node has dedicated reader injected |
| `context.custom.<path>` | `={{ $('Initialize Custom Data').item.json.custom.<path> }}` | Fallback when no dedicated reader |
| `context.<nodeId>.<path>` | `={{ $('<NodeName>').item.json.<path> }}` | Cross-node reference |
| `output.<path>` | `output.<path>` (raw JS via `const output = $input.first().json;`) | Inside "Update Custom Data" code nodes only |
| `$vars.<name>` | `={{ $vars.<name> }}` | n8n variable (passthrough) |

### JUEL (conditions, mail bodies, user task fields)

Used in `SequenceFlow.condition`, `MailDefinition` strings, `UserTask` subject/description.

| JUEL expression | n8n expression |
|----------------|---------------|
| `${context.startEvent.X}` | `={{ $json.body.X }}` (webhook) or `={{ $json.X }}` |
| `${context.custom.X}` | `={{ $('Initialize Custom Data').item.json.custom.X }}` |
| `${context.<id>.X}` | `={{ $('<Name>').item.json.X }}` |
| JUEL boolean condition | Full boolean expression in switch rule `leftValue` |

### Examples

| SBPA formula | n8n expression (webhook trigger) |
|-------------|----------------------------------|
| `context.startEvent.orderId` | `={{ $json.body.orderId }}` |
| `context.startEvent.customer.name` | `={{ $json.body.customer.name }}` |
| `context.custom.names` | `={{ $('Read Custom Data: EndEvent').item.json.custom.names }}` |
| `context.scriptTask1.result` | `={{ $('Script Task').item.json.result }}` |
| `$vars.env` | `={{ $vars.env }}` |
