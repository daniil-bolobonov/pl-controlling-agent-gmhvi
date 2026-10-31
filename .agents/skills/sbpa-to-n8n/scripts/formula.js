// formula.js — parse the SBPA mapping-formula language and emit the equivalent
// n8n =`{{ }}` expression.
//
// Supported grammar:
//   Fragment       := FragmentStart Path?
//                   | Fragment ('*' | '/') Fragment
//                   | Fragment ('+' | '-') Fragment
//   FragmentStart  := Literal | ObjectLit | ArrayLit | Name | Call | '(' Fragment ')'
//   Literal        := Bool | Null | Undefined | StringLit | NumberLit
//   ObjectLit      := '{' (Entry (',' Entry)*)? '}'
//   Entry          := ObjKey ':' Fragment
//   ObjKey         := Name | StringLit | '(' Fragment ')'
//   ArrayLit       := '[' (Fragment (',' Fragment)*)? ']'
//   Call           := Name '(' Params? ')'
//   Params         := Param (',' Param)* (',' NamedParam)*
//                   | NamedParam (',' NamedParam)*
//   Param          := Fragment
//   NamedParam     := Name ':' Fragment
//   Path           := PathSegment+
//   PathSegment    := '.' Name                        // simple access
//                   | '.' StringLit                   // string-key access
//                   | '.' '(' Fragment ')'            // dynamic access
//                   | '[' IntLit ']'                  // simple array access
//                   | '[' Fragment ']'                // dynamic array access
//   Name           := Ident (unreserved OR a reserved keyword inside a path segment)
//
// This is used ONLY for values inside `mappings.in` / `mappings.out` entries
// on ActionTask, EndEvent, and ReferencedSubflow. Anywhere else that uses
// `${...}` (SequenceFlow.condition, MailDefinition.to/subject/html) speaks
// Java JUEL — see `juel.js` for that parser.
//
// Public API:
//   parse(source)              → { ok: true, ast } | { ok: false, error }
//   emit(ast, resolver)        → n8n expression body (no `={{ }}` wrapper)
//   emitExpression(ast, r)     → the same, wrapped as `={{ … }}` for n8n
//   translate(source, resolver) → { ok, expression, error? } convenience
//
// Zero external dependencies.
//
// Special identifiers preserved from v1:
//   `output`   the entire output object of the current node
//   `listItem` the current element of a Map() call's template
//
// The resolver protocol is documented in emit-paths.js.

const { emitContextPath } = require("./emit-paths");

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const TOK_STRING = "string";
const TOK_NUMBER = "number";
const TOK_IDENT = "ident";
const TOK_PUNCT = "punct";
const TOK_OP = "op";
const TOK_BOOL = "bool";
const TOK_NULL = "null";
const TOK_UNDEF = "undef";
const TOK_EOF = "eof";

// Identifier strings that are also reserved keywords at the top-level. Inside
// a path segment (after `.`) they revert to bare names — SBPA lets you write
// `context.foo.true` and expects `.true` to be a property access, not a bool
// literal. The parser handles that by explicitly consuming the keyword's
// original text in path-segment position.
const KEYWORDS = {
  true: { type: TOK_BOOL, value: true },
  false: { type: TOK_BOOL, value: false },
  null: { type: TOK_NULL, value: null },
  undefined: { type: TOK_UNDEF, value: undefined },
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value, start, text) =>
    tokens.push({
      type,
      value,
      start,
      end: i,
      text: text !== undefined ? text : value === null ? "null" : String(value),
    });

  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (c === '"') {
      const start = i++;
      let value = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          const next = src[i + 1];
          if (next === "n") value += "\n";
          else if (next === "t") value += "\t";
          else if (next === "r") value += "\r";
          else value += next;
          i += 2;
        } else {
          value += src[i++];
        }
      }
      if (src[i] !== '"') throw new SyntaxError(`unterminated string starting at ${start}`);
      i++; // closing quote
      push(TOK_STRING, value, start, src.slice(start, i));
      continue;
    }

    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] || ""))) {
      const start = i;
      if (c === "-") i++;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === "." && /[0-9]/.test(src[i + 1] || "")) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      const text = src.slice(start, i);
      push(TOK_NUMBER, Number(text), start, text);
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
      const text = src.slice(start, i);
      const kw = KEYWORDS[text];
      if (kw) push(kw.type, kw.value, start, text);
      else push(TOK_IDENT, text, start, text);
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/") {
      push(TOK_OP, c, i, c);
      i++;
      continue;
    }
    if ("{}()[],:.".includes(c)) {
      push(TOK_PUNCT, c, i, c);
      i++;
      continue;
    }

    throw new SyntaxError(`unexpected character ${JSON.stringify(c)} at position ${i}`);
  }
  push(TOK_EOF, null, i, "");
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent, precedence climbing for arithmetic
// ---------------------------------------------------------------------------

function makeParser(tokens) {
  let pos = 0;
  const peek = (offset = 0) => tokens[pos + offset];
  const eat = () => tokens[pos++];
  const check = (type, value) => {
    const t = tokens[pos];
    return t.type === type && (value === undefined || t.value === value);
  };
  const expect = (type, value) => {
    const t = tokens[pos];
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new SyntaxError(
        `expected ${type}${value !== undefined ? `(${JSON.stringify(value)})` : ""} but got ${t.type}(${JSON.stringify(t.text)}) at ${t.start}`,
      );
    }
    return eat();
  };
  return { peek, eat, check, expect };
}

// Fragment := FragmentStart Path? — precedence handled at Additive/Multiplicative
function parseFragment(p) {
  return parseAdditive(p);
}

function parseAdditive(p) {
  let left = parseMultiplicative(p);
  while (p.check(TOK_OP, "+") || p.check(TOK_OP, "-")) {
    const op = p.eat().value;
    const right = parseMultiplicative(p);
    left = { kind: "Arithmetic", op, left, right };
  }
  return left;
}

function parseMultiplicative(p) {
  let left = parseFragmentWithPath(p);
  while (p.check(TOK_OP, "*") || p.check(TOK_OP, "/")) {
    const op = p.eat().value;
    const right = parseFragmentWithPath(p);
    left = { kind: "Arithmetic", op, left, right };
  }
  return left;
}

function parseFragmentWithPath(p) {
  const start = parseFragmentStart(p);
  return attachPath(start, p);
}

function parseFragmentStart(p) {
  const t = p.peek();

  if (t.type === TOK_STRING) {
    p.eat();
    return { kind: "String", value: t.value };
  }
  if (t.type === TOK_NUMBER) {
    p.eat();
    return { kind: "Number", value: t.value };
  }
  if (t.type === TOK_BOOL) {
    p.eat();
    return { kind: "Bool", value: t.value };
  }
  if (t.type === TOK_NULL) {
    p.eat();
    return { kind: "Null" };
  }
  if (t.type === TOK_UNDEF) {
    p.eat();
    return { kind: "Undefined" };
  }

  if (t.type === TOK_PUNCT && t.value === "{") return parseObjectLit(p);
  if (t.type === TOK_PUNCT && t.value === "[") return parseArrayLit(p);
  if (t.type === TOK_PUNCT && t.value === "(") {
    p.eat();
    const inner = parseFragment(p);
    p.expect(TOK_PUNCT, ")");
    inner.parenthesized = true;
    return inner;
  }

  if (t.type === TOK_IDENT) {
    if (p.peek(1) && p.peek(1).type === TOK_PUNCT && p.peek(1).value === "(") {
      return parseCall(p);
    }
    // Bare name — starts a path.
    const name = p.eat().value;
    return { kind: "Path", segments: [name] };
  }

  throw new SyntaxError(`unexpected token ${t.type}(${JSON.stringify(t.text)}) at ${t.start}`);
}

// Attach zero or more path segments to a start fragment. If the start is a
// `Path` AND every segment is a simple `.name` / `[intLit]`, we grow the
// existing Path.segments — this is the reference grammar's
// growContextReferencePath optimization and keeps `context.<...>` chains as
// a single Path node the emitter can pattern-match against.
function attachPath(start, p) {
  let node = start;

  while (isPathSegmentStart(p)) {
    if (node.kind === "Path" && !node.parenthesized && isSimpleSegment(p)) {
      // Grow the existing path.
      if (p.check(TOK_PUNCT, ".")) {
        p.eat();
        // `.name` — permit keyword-like idents as property names here.
        const nameTok = eatNameOrKeyword(p);
        node.segments.push(nameTok);
      } else {
        // `[<intLit>]`
        p.expect(TOK_PUNCT, "[");
        const idxTok = p.expect(TOK_NUMBER);
        if (!Number.isInteger(idxTok.value)) {
          throw new SyntaxError(`expected integer array index at ${idxTok.start}`);
        }
        p.expect(TOK_PUNCT, "]");
        node.segments.push(`[${idxTok.value}]`);
      }
      continue;
    }

    // Non-simple or non-Path start — wrap in ObjectLookup / ListAccess.
    if (p.check(TOK_PUNCT, ".")) {
      p.eat();
      if (p.check(TOK_STRING)) {
        const s = p.eat();
        node = { kind: "ObjectLookup", object: node, key: { kind: "String", value: s.value } };
      } else if (p.check(TOK_PUNCT, "(")) {
        p.eat();
        const inner = parseFragment(p);
        p.expect(TOK_PUNCT, ")");
        node = { kind: "ObjectLookup", object: node, key: inner };
      } else {
        const nameTok = eatNameOrKeyword(p);
        node = { kind: "ObjectLookup", object: node, key: { kind: "String", value: nameTok } };
      }
    } else {
      // '[' Fragment | IntLit ']'
      p.expect(TOK_PUNCT, "[");
      const idx = parseFragment(p);
      p.expect(TOK_PUNCT, "]");
      node = { kind: "ListAccess", list: node, index: idx };
    }
  }

  return node;
}

function isPathSegmentStart(p) {
  return p.check(TOK_PUNCT, ".") || p.check(TOK_PUNCT, "[");
}

// A "simple" segment is `.name` (identifier, possibly a keyword-like word) or
// `[<intLit>]`. These can be folded into a Path.segments array. Anything more
// complex forces a wrap in ObjectLookup / ListAccess.
function isSimpleSegment(p) {
  if (p.check(TOK_PUNCT, ".")) {
    const t1 = p.peek(1);
    if (!t1) return false;
    return (
      t1.type === TOK_IDENT || t1.type === TOK_BOOL || t1.type === TOK_NULL || t1.type === TOK_UNDEF
    );
  }
  if (p.check(TOK_PUNCT, "[")) {
    const t1 = p.peek(1);
    const t2 = p.peek(2);
    if (!t1 || !t2) return false;
    // Only `[intLit]` counts as simple. Negative/decimal/non-integer isn't.
    return (
      t1.type === TOK_NUMBER &&
      Number.isInteger(t1.value) &&
      t1.value >= 0 &&
      t2.type === TOK_PUNCT &&
      t2.value === "]"
    );
  }
  return false;
}

// Consume an identifier OR a keyword's original text as a name (for path
// segments where reserved words revert to bare names).
function eatNameOrKeyword(p) {
  const t = p.peek();
  if (t.type === TOK_IDENT || t.type === TOK_BOOL || t.type === TOK_NULL || t.type === TOK_UNDEF) {
    p.eat();
    return t.text;
  }
  throw new SyntaxError(
    `expected a name after '.', got ${t.type}(${JSON.stringify(t.text)}) at ${t.start}`,
  );
}

function parseObjectLit(p) {
  p.expect(TOK_PUNCT, "{");
  const props = [];
  if (!p.check(TOK_PUNCT, "}")) {
    do {
      // ObjKey := Name | StringLit | '(' Fragment ')'
      let key;
      if (p.check(TOK_STRING)) {
        const s = p.eat();
        key = { kind: "String", value: s.value };
      } else if (p.check(TOK_PUNCT, "(")) {
        p.eat();
        key = parseFragment(p);
        p.expect(TOK_PUNCT, ")");
      } else if (
        p.peek().type === TOK_IDENT ||
        p.peek().type === TOK_BOOL ||
        p.peek().type === TOK_NULL ||
        p.peek().type === TOK_UNDEF
      ) {
        // Bare-name key — treat as string.
        const nameTok = eatNameOrKeyword(p);
        key = { kind: "String", value: nameTok };
      } else {
        const t = p.peek();
        throw new SyntaxError(
          `expected object key at ${t.start}, got ${t.type}(${JSON.stringify(t.text)})`,
        );
      }
      p.expect(TOK_PUNCT, ":");
      const value = parseFragment(p);
      props.push({ key, value });
      // biome-ignore lint/complexity/noCommaOperator: idiomatic parser loop
    } while (p.check(TOK_PUNCT, ",") && (p.eat(), true));
  }
  p.expect(TOK_PUNCT, "}");
  return { kind: "Object", props };
}

function parseArrayLit(p) {
  p.expect(TOK_PUNCT, "[");
  const items = [];
  if (!p.check(TOK_PUNCT, "]")) {
    do {
      items.push(parseFragment(p));
      // biome-ignore lint/complexity/noCommaOperator: idiomatic parser loop
    } while (p.check(TOK_PUNCT, ",") && (p.eat(), true));
  }
  p.expect(TOK_PUNCT, "]");
  return { kind: "Array", items };
}

function parseCall(p) {
  const name = p.expect(TOK_IDENT).value;
  p.expect(TOK_PUNCT, "(");
  const positional = [];
  const named = {};
  let sawNamed = false;

  if (!p.check(TOK_PUNCT, ")")) {
    do {
      // Named parameter: IDENT ':' Fragment. Distinguished from a positional
      // Fragment that happens to start with an ident by looking ahead: if
      // the next-next token is `:`, it's a named param.
      const t0 = p.peek();
      const t1 = p.peek(1);
      const isNamed = t0.type === TOK_IDENT && t1 && t1.type === TOK_PUNCT && t1.value === ":";
      if (isNamed) {
        const pname = p.eat().value;
        p.eat(); // ':'
        const value = parseFragment(p);
        named[pname] = value;
        sawNamed = true;
      } else {
        if (sawNamed) {
          throw new SyntaxError(`unnamed parameter after named parameter at ${t0.start}`);
        }
        positional.push(parseFragment(p));
      }
      // biome-ignore lint/complexity/noCommaOperator: idiomatic parser loop
    } while (p.check(TOK_PUNCT, ",") && (p.eat(), true));
  }
  p.expect(TOK_PUNCT, ")");
  return { kind: "Call", name, positional, named };
}

// ---------------------------------------------------------------------------
// Public API — parse
// ---------------------------------------------------------------------------

/** Parse a mapping-formula source string. */
function parse(source) {
  try {
    const tokens = tokenize(source);
    const p = makeParser(tokens);
    const ast = parseFragment(p);
    if (!p.check(TOK_EOF)) {
      const t = p.peek();
      throw new SyntaxError(`trailing tokens starting at ${t.start}`);
    }
    return { ok: true, ast };
  } catch (err) {
    return { ok: false, error: err.message, source };
  }
}

// ---------------------------------------------------------------------------
// Emitter — AST → n8n JS body (no `={{ }}` wrapping; use emitExpression for that)
// ---------------------------------------------------------------------------

function emit(ast, resolver) {
  switch (ast.kind) {
    case "String":
      return JSON.stringify(ast.value);
    case "Number":
      return String(ast.value);
    case "Bool":
      return ast.value ? "true" : "false";
    case "Null":
      return "null";
    case "Undefined":
      return "undefined";
    case "Path":
      return emitContextPath(ast.segments, resolver);
    case "Arithmetic":
      return emitArithmetic(ast, resolver);
    case "Object":
      return emitObject(ast, resolver);
    case "Array":
      return emitArray(ast, resolver);
    case "Call":
      return emitCall(ast, resolver);
    case "ObjectLookup":
      return emitObjectLookup(ast, resolver);
    case "ListAccess":
      return emitListAccess(ast, resolver);
    default:
      throw new Error(`unhandled ast kind ${ast.kind}`);
  }
}

function emitArithmetic(ast, resolver) {
  return `${emit(ast.left, resolver)} ${ast.op} ${emit(ast.right, resolver)}`;
}

function emitObject(ast, resolver) {
  const parts = ast.props.map((pr) => {
    // Static string keys — quote as a normal JS property. Dynamic keys —
    // computed-property syntax `[expr]: value`.
    if (pr.key.kind === "String") {
      return `${JSON.stringify(pr.key.value)}: ${emit(pr.value, resolver)}`;
    }
    return `[${emit(pr.key, resolver)}]: ${emit(pr.value, resolver)}`;
  });
  return `({ ${parts.join(", ")} })`;
}

function emitArray(ast, resolver) {
  return `[${ast.items.map((i) => emit(i, resolver)).join(", ")}]`;
}

function emitObjectLookup(ast, resolver) {
  const obj = emit(ast.object, resolver);
  if (ast.key.kind === "String") {
    // Static string key — use dot syntax when the key is a valid JS identifier,
    // bracket otherwise.
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ast.key.value)) {
      return `${obj}.${ast.key.value}`;
    }
    return `${obj}[${JSON.stringify(ast.key.value)}]`;
  }
  return `${obj}[${emit(ast.key, resolver)}]`;
}

function emitListAccess(ast, resolver) {
  return `${emit(ast.list, resolver)}[${emit(ast.index, resolver)}]`;
}

function emitCall(ast, resolver) {
  // The Map(list, template) builtin is the only formula-language function we
  // rewrite semantically. Everything else passes through as JS `Name(args)`
  // and relies on the report/LLM stage to fix if it isn't a valid n8n global.
  if (ast.name === "Map" && ast.positional.length === 2 && Object.keys(ast.named).length === 0) {
    const [listExpr, template] = ast.positional;
    const listCode = emit(listExpr, resolver);
    const templateCode = emit(template, { ...resolver, inMapLambda: true });
    return `(${listCode}).map(item => ${templateCode})`;
  }
  const allArgs = ast.positional.map((a) => emit(a, resolver));
  // Named parameters get flattened as `name: value` object entries in a
  // trailing object literal — JS doesn't have keyword args, so this is the
  // closest JS approximation. The report/LLM stage should verify per-callee.
  const namedEntries = Object.entries(ast.named);
  if (namedEntries.length > 0) {
    const namedObj = `{ ${namedEntries.map(([k, v]) => `${JSON.stringify(k)}: ${emit(v, resolver)}`).join(", ")} }`;
    allArgs.push(namedObj);
  }
  return `${ast.name}(${allArgs.join(", ")})`;
}

/** Wrap the emitted body in n8n's expression syntax. */
function emitExpression(ast, resolver) {
  return `={{ ${emit(ast, resolver)} }}`;
}

/**
 * Convenience: parse + emit in one call. Returns { ok, expression, error }.
 * On parse failure, expression is the source string verbatim so downstream
 * can preserve the original in the emitted JSON.
 */
function translate(source, resolver) {
  const parsed = parse(source);
  if (!parsed.ok) return { ok: false, error: parsed.error, expression: source };
  return { ok: true, expression: emitExpression(parsed.ast, resolver) };
}

module.exports = {
  parse,
  emit,
  emitExpression,
  translate,
};

if (require.main === module) {
  console.log(
    "formula.js — SBPA mapping-formula parser and n8n expression emitter.\nThis is a library module. Import it with require('./formula'). Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
