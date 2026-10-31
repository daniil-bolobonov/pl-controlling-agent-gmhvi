# SBPA expression grammars → n8n expressions

SBPA uses **two** expression languages, not one. They look superficially similar but differ in operators, literals, and semantics. The `sbpa-to-n8n` skill has one parser for each:

- **Mapping formula** — the SBPA-proprietary formula language. Handled by `scripts/formula.js`.
- **Java JUEL** — the Java Unified Expression Language, used everywhere `${…}` appears. Handled by `scripts/juel.js`.

## Decision gate — pick the grammar before reading any rule

Before translating **any** expression, answer this first:

1. **Is the whole value, or an embedded run, wrapped in `${…}`?** → it is **JUEL**. Use `juel.translateJuelWrapped` (whole-string condition) or `juel.translateJuelInterpolated` (text with embedded `${…}`). Applies to `SequenceFlow.condition`, mail `to`/`subject`/`html`, UserTask `recipientUsers`/`recipientGroups`, and any other `${…}` site.
2. **Is it a `mappings.in` / `mappings.out` value (ActionTask, EndEvent, ReferencedSubflow)?** → it is **mapping formula**. Use `formula.translate`. Here `.` is a path segment and `Map(list, template)` is a builtin — *not* `Array.prototype.map`.

**Never route a `${…}` string through the formula parser, or a mapping-formula value through JUEL.** They differ in operators (JUEL has word-form `eq`/`gt`/`and`/`not`/`mod` and `empty x`; formula does not), literals, and semantics.

## Where each grammar applies

| Location | Grammar | Function used |
|---|---|---|
| `ActionTask.mappings.in[i].value` | mapping formula | `formula.translate` |
| `EndEvent.mappings.in[i].value` | mapping formula | `formula.translate` |
| `ReferencedSubflow.mappings.in[i].value` | mapping formula | `formula.translate` |
| `SequenceFlow.condition` (whole string wrapped in `${…}`) | JUEL | `juel.translateJuelWrapped` |
| `MailDefinition.to` / `.subject` / `.html` (plain text with embedded `${…}` runs) | JUEL | `juel.translateJuelInterpolated` |
| Any future `${…}` substitution site | JUEL | one of the above |
| `TimerEventDefinition.timeDuration` | plain string literal (parsed as mapping formula for the string-lit form) | `formula.translate` |

## Mapping formula grammar (formula.js)

Matches the reference `Formula.g4`. Full BNF:

```
Fragment       := FragmentStart Path?
                | Fragment ('*' | '/') Fragment
                | Fragment ('+' | '-') Fragment
FragmentStart  := Literal | ObjectLit | ArrayLit | Name | Call | '(' Fragment ')'
Literal        := Bool | Null | Undefined | StringLit | NumberLit
ObjectLit      := '{' (Entry (',' Entry)*)? '}'
Entry          := ObjKey ':' Fragment
ObjKey         := Name | StringLit | '(' Fragment ')'
ArrayLit       := '[' (Fragment (',' Fragment)*)? ']'
Call           := Name '(' Params? ')'
Params         := Param (',' Param)* (',' NamedParam)*
                | NamedParam (',' NamedParam)*
NamedParam     := Name ':' Fragment
Path           := PathSegment+
PathSegment    := '.' Name                       // simple access
                | '.' StringLit                  // string-key access
                | '.' '(' Fragment ')'           // dynamic access
                | '[' IntLit ']'                 // simple array access
                | '[' Fragment ']'               // dynamic array access
```

Key features vs a naive port of the reference:

- **No comparison or logical operators.** The reference grammar has none. If you see `x > 5` inside a mapping value, it's either wrong or you're looking at a JUEL expression that got put in the wrong field.
- **`true`, `false`, `null`, `undefined`** are keywords at the top level, but revert to bare names inside a path segment (so `context.foo.true` treats `true` as a property).
- **Named function parameters** flatten to a trailing JS object literal: `Fn(1, foo: 2)` → `Fn(1, { "foo": 2 })`. JS has no keyword-arg calling convention, so the report/LLM stage may want to patch per-callee.

### Special identifiers

| Token | Meaning | Emits |
|---|---|---|
| `output` | The entire output object of the current node | `$json` |
| `listItem` | The current element inside a `Map(…)` template | `item` |
| `context.startEvent.<path>` | Read from the trigger's payload | `$('<TriggerName>').item.json.<path>` (with `body.` inserted when the trigger is a webhook) |
| `context.custom.<path>` | Read from the DataObject init Code node | `$('Initialize Custom Data').item.json.<path>` |
| `context.<otherNodeInnerId>.<path>` | Cross-node reference | `$('<display-name>').item.json.<path>` |

The resolver protocol (fields `predecessorId`, `nodeName`, `customInitName`, `triggerIsWebhook`, `inMapLambda`) is documented in `scripts/emit-paths.js` — shared between both parsers.

### Builtins

Only one: `Map(list, template)` — emits `(list).map(item => template)` where every `listItem.X` in the template becomes `item.X`.

Anything else passes through as-is (`FnName(args)`) with no error; the LLM stage patches if it hits n8n as unknown JS.

### Worked examples

| Source | Emission |
|---|---|
| `context.startEvent.customer.externalId` | `={{ $('StartEvent').item.json.customer.externalId }}` |
| `context.custom.normalizedtotals.gross` | `={{ $('Initialize Custom Data').item.json.normalizedtotals.gross }}` |
| `output` | `={{ $json }}` |
| `{}` | `={{ ({  }) }}` |
| `{key: 1}` (bare-name key) | `={{ ({ "key": 1 }) }}` |
| `[1, 2, 3]` | `={{ [1, 2, 3] }}` |
| `context.startEvent.lines[0].materialNumber` | `={{ $('StartEvent').item.json.lines[0].materialNumber }}` |
| `Map(context.startEvent.lines, {"description": listItem.description})` | `={{ ($('StartEvent').item.json.lines).map(item => ({ "description": item.description })) }}` |
| `"PT10M"` | `={{ "PT10M" }}` |
| `Fn(1, foo: 2)` (named param) | `={{ Fn(1, { "foo": 2 }) }}` |

## JUEL grammar (juel.js)

Java EE JUEL 2.2 spec. Precedence-climbing recursive descent:

```
Expr           := Ternary
Ternary        := Or ('?' Expr ':' Expr)?
Or             := And ('||' And)*
And            := Equality ('&&' Equality)*
Equality       := Relational (('==' | '!=') Relational)*
Relational     := Additive (('<' | '>' | '<=' | '>=') Additive)*
Additive       := Multiplicative (('+' | '-') Multiplicative)*
Multiplicative := Unary (('*' | '/' | '%') Unary)*
Unary          := ('!' | '-' | 'empty') Unary
                | Postfix
Postfix        := Primary Access*
Access         := '.' IDENT
                | '[' Expr ']'
                | '(' Args? ')'          // function call after path
Primary        := Literal
                | '(' Expr ')'
                | IDENT (':' IDENT)?      // possibly ns-qualified name
```

### Word-form operator aliases

Normalized at tokenize time to their symbolic equivalents:

| Word | Symbol |
|---|---|
| `and` | `&&` |
| `or`  | `\|\|` |
| `not` | `!` |
| `eq`  | `==` |
| `ne`  | `!=` |
| `lt`  | `<` |
| `gt`  | `>` |
| `le`  | `<=` |
| `ge`  | `>=` |
| `div` | `/` |
| `mod` | `%` |

So `x gt 10 and not empty items` emits identical JS as `x > 10 && !(empty items)`.

### `empty x`

Unary operator; JUEL semantic is "true if x is null / empty string / empty array / empty map". Emitted as the JS approximation:

```
((x) == null || (x).length === 0)
```

This is a lossy translation for maps — JS `Object.keys(x).length` would be closer but we don't want to auto-generate a bulkier form. Correct for the observed use cases (arrays and strings). If a real fixture surfaces a map-empty-check, replace this emitter branch.

### Function calls

Bare calls pass through as `name(args)`. Namespace-qualified `ns:name(args)` flattens to `ns_name(args)` — n8n has no direct equivalent of JUEL namespaces, so the LLM stage may want to patch. Consider adding a report entry when a namespaced call is emitted; deferred until a real fixture uses one.

### Wrappers

- `${expr}` — SequenceFlow.condition and any single-expression `${…}`. `translateJuelWrapped` strips the wrapper before parsing.
- `"text ${expr1} more ${expr2}"` interpolated — mail body / subject / to. `translateJuelInterpolated` returns a string-concatenated n8n expression when any `${…}` is present, or the literal source string when none is.

### Worked examples

| Source | Emission |
|---|---|
| `${context.custom.normalizedtotals.gross <= 10000}` | `={{ $('Initialize Custom Data').item.json.normalizedtotals.gross <= 10000 }}` |
| `${totals.gross gt 10000 and not empty items}` | `={{ totals.gross > 10000 && !((items) == null || (items).length === 0) }}` |
| `${customer.tier eq "gold"}` | `={{ customer.tier == "gold" }}` |
| `${x mod 2 == 0}` | `={{ x % 2 == 0 }}` |
| `${x > 0 ? "pos" : "neg"}` | `={{ (x > 0 ? "pos" : "neg") }}` |
| `<p>Order: ${context.startEvent.orderid}</p>` | `={{ "<p>Order: " + ($('StartEvent').item.json.orderid) + "</p>" }}` |
| `${math:max(a, b)}` | `={{ math_max(a, b) }}` |

## Error surface

Every `translate*` function returns `{ ok, expression, error? }`:

- `ok: true` — `expression` is the ready-to-embed n8n expression string (already includes `={{ … }}` for wrapped/plain, or a plain string for interpolated when no `${…}` is present).
- `ok: false` — `expression` is the source verbatim so emitted JSON preserves the original; `error` is a parser message. Report under `kind: 'formula-parse-failure'` (mapping) or `kind: 'juel-parse-failure'` (JUEL) so the LLM stage can hand-fix.
