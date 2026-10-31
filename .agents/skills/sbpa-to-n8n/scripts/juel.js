// juel.js — parse Java Unified Expression Language (JUEL 2.2) as used by
// SBPA in every `${...}` position OTHER than mapping values. Emits the
// equivalent n8n `={{ ... }}` expression.
//
// Grammar (precedence-climbing recursive descent):
//
//   Expr           := Ternary
//   Ternary        := Or ('?' Expr ':' Expr)?
//   Or             := And ('||' And)*
//   And            := Equality ('&&' Equality)*
//   Equality       := Relational (('==' | '!=') Relational)*
//   Relational     := Additive (('<' | '>' | '<=' | '>=') Additive)*
//   Additive       := Multiplicative (('+' | '-') Multiplicative)*
//   Multiplicative := Unary (('*' | '/' | '%') Unary)*
//   Unary          := ('!' | '-' | 'empty') Unary
//                   | Postfix
//   Postfix        := Primary Access*
//   Access         := '.' IDENT
//                   | '[' Expr ']'
//                   | '(' Args? ')'          // function call after path
//   Primary        := Literal
//                   | '(' Expr ')'
//                   | IDENT (':' IDENT)?      // possibly ns-qualified name
//   Args           := Expr (',' Expr)*
//   Literal        := StringLit | NumberLit | Bool | Null
//
// Word-form operator aliases (JUEL 2.2 spec) are tokenized to their symbol
// equivalents at the lexer level so the parser stays operator-symbol only:
//   and → && , or → || , not → !
//   eq  → == , ne → !=
//   lt  → <  , gt → > , le → <= , ge → >=
//   div → /  , mod → %
//   empty stays as its own keyword (unary)
//
// Used for:
//   - SequenceFlow.condition (wrapped in `${...}`)
//   - MailDefinition.to/subject/html (plain text with embedded `${...}` runs)
//   - Any future ${...} substitution site.
//
// Mapping values on ActionTask/EndEvent/ReferencedSubflow use a different
// grammar — see formula.js.
//
// Public API:
//   parseJuel(source)              → { ok, ast } | { ok: false, error }
//   parseJuelWrapped(source)       → strips a single ${...} wrapper first
//   parseJuelInterpolated(source)  → { ok, segments: [{ kind:'Text'|'Expr', ... }] }
//   emitJuel(ast, resolver)        → n8n JS body (no `={{ }}`)
//   emitJuelExpression(ast, r)     → the same, wrapped
//   translateJuel(source, r)              → { ok, expression, error? }
//   translateJuelWrapped(source, r)       → same, for `${...}`
//   translateJuelInterpolated(source, r)  → interpolated string
//
// Zero external dependencies.

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
const TOK_KW = "kw"; // reserved keywords other than literals (empty, instanceof)
const TOK_EOF = "eof";

// Word-form operator aliases → symbolic form. Applied when the identifier
// is at a position where an operator would go — but we normalize at tokenize
// time because the identifiers only appear as operators in JUEL (they aren't
// valid identifier names for variables).
const WORD_OPS = {
  and: "&&",
  or: "||",
  not: "!",
  eq: "==",
  ne: "!=",
  lt: "<",
  gt: ">",
  le: "<=",
  ge: ">=",
  div: "/",
  mod: "%",
};

const KEYWORDS = {
  true: { type: TOK_BOOL, value: true },
  false: { type: TOK_BOOL, value: false },
  null: { type: TOK_NULL, value: null },
  empty: { type: TOK_KW, value: "empty" },
  instanceof: { type: TOK_KW, value: "instanceof" },
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value, start, text) =>
    tokens.push({ type, value, start, end: i, text: text !== undefined ? text : String(value) });

  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Strings — JUEL allows either single OR double quotes.
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i++;
      let value = "";
      while (i < src.length && src[i] !== quote) {
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
      if (src[i] !== quote) throw new SyntaxError(`unterminated string starting at ${start}`);
      i++;
      push(TOK_STRING, value, start, src.slice(start, i));
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const start = i;
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
      if (WORD_OPS[text]) {
        push(TOK_OP, WORD_OPS[text], start, text);
      } else if (KEYWORDS[text]) {
        const kw = KEYWORDS[text];
        push(kw.type, kw.value, start, text);
      } else {
        push(TOK_IDENT, text, start, text);
      }
      continue;
    }

    // Two-char operators come first.
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      push(TOK_OP, two, i, two);
      i += 2;
      continue;
    }
    if ("<>+-*/%!".includes(c)) {
      push(TOK_OP, c, i, c);
      i++;
      continue;
    }
    if ("()[].,:?".includes(c)) {
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
// Parser
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

function parseExpr(p) {
  return parseTernary(p);
}

function parseTernary(p) {
  const cond = parseOr(p);
  if (p.check(TOK_PUNCT, "?")) {
    p.eat();
    const then_ = parseExpr(p);
    p.expect(TOK_PUNCT, ":");
    const else_ = parseExpr(p);
    // biome-ignore lint/suspicious/noThenProperty: AST ternary node, not a Promise thenable
    return { kind: "Ternary", test: cond, then: then_, else: else_ };
  }
  return cond;
}

function parseOr(p) {
  return parseBinary(p, ["||"], parseAnd);
}
function parseAnd(p) {
  return parseBinary(p, ["&&"], parseEquality);
}
function parseEquality(p) {
  return parseBinary(p, ["==", "!="], parseRelational);
}
function parseRelational(p) {
  return parseBinary(p, ["<", ">", "<=", ">="], parseAdditive);
}
function parseAdditive(p) {
  return parseBinary(p, ["+", "-"], parseMultiplicative);
}
function parseMultiplicative(p) {
  return parseBinary(p, ["*", "/", "%"], parseUnary);
}

function parseBinary(p, ops, sub) {
  let left = sub(p);
  while (ops.some((op) => p.check(TOK_OP, op))) {
    const op = p.eat().value;
    const right = sub(p);
    left = { kind: "Binary", op, left, right };
  }
  return left;
}

function parseUnary(p) {
  if (p.check(TOK_OP, "!") || p.check(TOK_OP, "-") || p.check(TOK_KW, "empty")) {
    const t = p.eat();
    const op = t.value === "empty" ? "empty" : t.value;
    const operand = parseUnary(p);
    return { kind: "Unary", op, operand };
  }
  return parsePostfix(p);
}

function parsePostfix(p) {
  let node = parsePrimary(p);
  while (true) {
    if (p.check(TOK_PUNCT, ".")) {
      p.eat();
      // A dot access consumes the next IDENT (or a reserved-word-like ident).
      const t = p.peek();
      let name;
      if (t.type === TOK_IDENT) {
        p.eat();
        name = t.value;
      } else if (t.type === TOK_BOOL || t.type === TOK_NULL || t.type === TOK_KW) {
        p.eat();
        name = t.text;
      } else
        throw new SyntaxError(
          `expected name after '.' at ${t.start}, got ${t.type}(${JSON.stringify(t.text)})`,
        );
      // Fold into a Name if the LHS was a Name (context.foo.bar chain).
      if (node.kind === "Name") {
        node = { kind: "Name", path: [...node.path, name] };
      } else {
        node = { kind: "Index", object: node, index: { kind: "String", value: name } };
      }
    } else if (p.check(TOK_PUNCT, "[")) {
      p.eat();
      const idx = parseExpr(p);
      p.expect(TOK_PUNCT, "]");
      // Fold into Name.path when the index is a static positive integer,
      // matching formula.js's simple-index optimization.
      if (
        node.kind === "Name" &&
        idx.kind === "Number" &&
        Number.isInteger(idx.value) &&
        idx.value >= 0
      ) {
        node = { kind: "Name", path: [...node.path, `[${idx.value}]`] };
      } else if (node.kind === "Name" && idx.kind === "String") {
        node = { kind: "Name", path: [...node.path, idx.value] };
      } else {
        node = { kind: "Index", object: node, index: idx };
      }
    } else if (p.check(TOK_PUNCT, "(") && node.kind === "Name") {
      // Function call — the Name.path becomes the callee (namespace-qualified
      // via a single ':' between two idents becomes path with two entries).
      p.eat();
      const args = [];
      if (!p.check(TOK_PUNCT, ")")) {
        do {
          args.push(parseExpr(p));
          // biome-ignore lint/complexity/noCommaOperator: idiomatic parser loop
        } while (p.check(TOK_PUNCT, ",") && (p.eat(), true));
      }
      p.expect(TOK_PUNCT, ")");
      node = { kind: "Call", fn: node.path, args };
    } else {
      break;
    }
  }
  return node;
}

function parsePrimary(p) {
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
  if (t.type === TOK_PUNCT && t.value === "(") {
    p.eat();
    const inner = parseExpr(p);
    p.expect(TOK_PUNCT, ")");
    return inner;
  }
  if (t.type === TOK_IDENT) {
    p.eat();
    // Namespace-qualified: `<ns> : <name>` — two IDENTs joined by a colon.
    // Only recognized in function-call position (parsePostfix will see the
    // trailing `(` and turn this into a Call). Otherwise it's a Name.
    if (p.check(TOK_PUNCT, ":")) {
      const save = p.eat();
      if (p.peek().type === TOK_IDENT) {
        const suffix = p.eat().value;
        return { kind: "Name", path: [t.value, suffix] };
      }
      // Not a ns qualifier — put the colon back? We can't; but this only
      // matters inside a ternary parse where the colon is legitimately a
      // ternary marker. parseTernary consumed its `?` before recursing, so
      // reaching a bare colon here means malformed input.
      throw new SyntaxError(`unexpected ':' after identifier at ${save.start}`);
    }
    return { kind: "Name", path: [t.value] };
  }
  throw new SyntaxError(`unexpected token ${t.type}(${JSON.stringify(t.text)}) at ${t.start}`);
}

// ---------------------------------------------------------------------------
// Public API — parse
// ---------------------------------------------------------------------------

function parseJuel(source) {
  try {
    const tokens = tokenize(source);
    const p = makeParser(tokens);
    const ast = parseExpr(p);
    if (!p.check(TOK_EOF)) {
      const t = p.peek();
      throw new SyntaxError(`trailing tokens starting at ${t.start}`);
    }
    return { ok: true, ast };
  } catch (err) {
    return { ok: false, error: err.message, source };
  }
}

function parseJuelWrapped(source) {
  const m = /^\$\{([\s\S]+)\}$/.exec(source.trim());
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal text in error message
  if (!m) return { ok: false, error: "not a ${...} wrapper", source };
  return parseJuel(m[1]);
}

/**
 * Parse an interpolated string like `<p>Hello ${customer.name} !</p>` into
 * an array of segments: { kind: 'Text', value } | { kind: 'Expr', ast }.
 */
function parseJuelInterpolated(source) {
  const segments = [];
  let i = 0;
  let buf = "";
  while (i < source.length) {
    if (source[i] === "$" && source[i + 1] === "{") {
      if (buf) {
        segments.push({ kind: "Text", value: buf });
        buf = "";
      }
      const start = i;
      let depth = 0;
      i += 2;
      const exprStart = i;
      while (i < source.length) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
          if (depth === 0) break;
          depth--;
        }
        i++;
      }
      if (source[i] !== "}") return { ok: false, error: `unterminated \${ at ${start}`, source };
      const inner = source.slice(exprStart, i);
      i++;
      const parsed = parseJuel(inner);
      if (!parsed.ok) return { ok: false, error: parsed.error, source };
      segments.push({ kind: "Expr", ast: parsed.ast });
    } else {
      buf += source[i++];
    }
  }
  if (buf) segments.push({ kind: "Text", value: buf });
  return { ok: true, segments };
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

function emitJuel(ast, resolver) {
  switch (ast.kind) {
    case "String":
      return JSON.stringify(ast.value);
    case "Number":
      return String(ast.value);
    case "Bool":
      return ast.value ? "true" : "false";
    case "Null":
      return "null";
    case "Name":
      return emitContextPath(ast.path, resolver);
    case "Index":
      return `${emitJuel(ast.object, resolver)}[${emitJuel(ast.index, resolver)}]`;
    case "Unary":
      return emitUnary(ast, resolver);
    case "Binary":
      return `${emitJuel(ast.left, resolver)} ${ast.op} ${emitJuel(ast.right, resolver)}`;
    case "Ternary":
      return `(${emitJuel(ast.test, resolver)} ? ${emitJuel(ast.then, resolver)} : ${emitJuel(ast.else, resolver)})`;
    case "Call":
      return emitCall(ast, resolver);
    default:
      throw new Error(`unhandled juel ast kind ${ast.kind}`);
  }
}

function emitUnary(ast, resolver) {
  if (ast.op === "empty") {
    // JUEL's `empty x` returns true for null, empty string, empty array, empty
    // map/collection. JS approximation: null/undefined check + length check
    // when it's an Array. n8n's runtime handles String.length via `.length`.
    const inner = emitJuel(ast.operand, resolver);
    return `((${inner}) == null || (${inner}).length === 0)`;
  }
  return `${ast.op}${emitJuel(ast.operand, resolver)}`;
}

function emitCall(ast, resolver) {
  const fn = ast.fn;
  const args = ast.args.map((a) => emitJuel(a, resolver)).join(", ");

  // Method call on a context path: context.foo.bar.methodName(args).
  // The parser folds the full dotted path (including the method name) into
  // the Call's fn array. Translate known JUEL collection/string methods to
  // their JS equivalents so they work in n8n expressions.
  if (fn.length >= 2 && fn[0] === "context") {
    const methodName = fn[fn.length - 1];
    const objPath = fn.slice(0, -1);
    const objExpr = emitContextPath(objPath, resolver);
    switch (methodName) {
      case "contains":
        return `${objExpr}.includes(${args})`;
      case "containsAll":
        // containsAll(otherArray) → every element of other is in this array.
        return `(${args}).every(_el => ${objExpr}.includes(_el))`;
      case "isEmpty":
        return `(${objExpr} == null || (${objExpr}).length === 0)`;
      case "size":
        return `(${objExpr}).length`;
      case "startsWith":
        return `${objExpr}.startsWith(${args})`;
      case "endsWith":
        return `${objExpr}.endsWith(${args})`;
      case "toUpperCase":
        return `${objExpr}.toUpperCase()`;
      case "toLowerCase":
        return `${objExpr}.toLowerCase()`;
      case "trim":
        return `${objExpr}.trim()`;
      case "substring":
        return `${objExpr}.substring(${args})`;
      case "replace":
        return `${objExpr}.replace(${args})`;
      default:
        // Unknown method — still emit as valid JS obj.method(args).
        return `${objExpr}.${methodName}(${args})`;
    }
  }

  // Namespace-qualified calls (`math:max(a, b)`) — n8n has no direct
  // equivalent; emit as `math_max(...)` and rely on the report/LLM stage to
  // patch. Bare calls pass through as JS.
  const name = fn.length > 1 ? fn.join("_") : fn[0];
  return `${name}(${args})`;
}

function emitJuelExpression(ast, resolver) {
  return `={{ ${emitJuel(ast, resolver)} }}`;
}

function translateJuel(source, resolver) {
  const parsed = parseJuel(source);
  if (!parsed.ok) return { ok: false, error: parsed.error, expression: source };
  return { ok: true, expression: emitJuelExpression(parsed.ast, resolver) };
}

function translateJuelWrapped(source, resolver) {
  const parsed = parseJuelWrapped(source);
  if (!parsed.ok) return { ok: false, error: parsed.error, expression: source };
  return { ok: true, expression: emitJuelExpression(parsed.ast, resolver) };
}

function translateJuelInterpolated(source, resolver) {
  const parsed = parseJuelInterpolated(source);
  if (!parsed.ok) return { ok: false, error: parsed.error, expression: source };

  const hasExpr = parsed.segments.some((s) => s.kind === "Expr");
  if (!hasExpr) return { ok: true, expression: source };

  const jsParts = parsed.segments.map((s) => {
    if (s.kind === "Text") return JSON.stringify(s.value);
    return `(${emitJuel(s.ast, resolver)})`;
  });
  return { ok: true, expression: `={{ ${jsParts.join(" + ")} }}` };
}

module.exports = {
  parseJuel,
  parseJuelWrapped,
  parseJuelInterpolated,
  emitJuel,
  emitJuelExpression,
  translateJuel,
  translateJuelWrapped,
  translateJuelInterpolated,
};

if (require.main === module) {
  console.log(
    "juel.js — Java JUEL parser and n8n expression emitter.\nThis is a library module. Import it with require('./juel'). Run node scripts/migrate.js --help for the CLI entry point.",
  );
  process.exit(0);
}
