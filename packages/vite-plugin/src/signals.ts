/**
 * Lowering the `Signal` namespace to direct imports at build time.
 *
 * The public API is the TC39 spelling, `new Signal.State(0)`, and
 * `export namespace Signal` compiles to a runtime object. An object is opaque
 * to a bundler — reaching one property retains all of them — so an app that
 * only ever constructs state signals still ships `currentComputed` and the
 * four introspection functions, with no line of the application able to reach
 * any of them.
 *
 * Each package exposes the same members individually under a `/signals`
 * subpath, so this pass rewrites
 *
 *   import { Signal } from '@voltdev/core';
 *   const count = new Signal.State(0);
 *
 * to
 *
 *   import { State as __volt_Signal_State } from '@voltdev/core/signals';
 *   import { Signal } from '@voltdev/core';
 *   const count = new __volt_Signal_State(0);
 *
 * after which nothing in the file names the namespace and a bundler can leave
 * it out. It can only do that because the namespace has a module to itself:
 * while it was declared beside `effect` in `@voltdev/reactivity`'s entry every
 * app retained it whatever this pass did, and the rewrite bought 73 B of a
 * possible 522 B on `examples/counter`. See `reactivity/src/namespace.ts`.
 *
 * What leaves with the object is what only it reached: `currentComputed`,
 * `introspectSources`, `introspectSinks`, `hasSinks`, `hasSources`, and
 * `untrack` unless an effect holds it. The watcher never leaves, and neither
 * does `untrack` for an app with an effect — `graph.ts` asks
 * `sink instanceof WatcherNode` on every notification and `effect.ts` imports
 * both straight from the graph, so no lowering of the namespace can reach
 * them. Measured on `examples/counter`: 522 B off the bundle, 179 B of it
 * after gzip.
 *
 * The original import is deliberately left in place: it is unused afterwards,
 * so a bundler drops it, and leaving it means a usage this pass declined to
 * rewrite still resolves.
 *
 * Nothing about how you write a component changes, and nothing about the
 * namespace changes — it is the same bindings under both spellings, so JIT
 * mode, tests and the REPL keep working with no build step at all.
 *
 * The pass only ever rewrites `Signal.State`, `Signal.Computed` and
 * `Signal.subtle.<member>` read directly off the imported binding. Anything
 * else the name is used for — `const S = Signal`, `Signal[key]`, passing the
 * namespace to a function, assigning to a member — means the object is needed
 * as an object, so the whole file is declined rather than half-rewritten.
 *
 * And it only ever sees an application's own source. The default include is
 * `.ts`/`.mts` outside node_modules, and Volt's own packages build without
 * this plugin, so every framework module reaching through the namespace ships
 * as pre-built `.js` and hands the object straight back: `@voltdev/primitives`
 * carries 217 `Signal.` reads on its own, one of them
 * `const { untrack } = Signal.subtle`, which this pass would decline even if
 * it could see it. An app importing a primitive, `@voltdev/query` or
 * `@voltdev/router` keeps the namespace whatever its own source says.
 */

import {
  isIdentChar,
  isRegexStart,
  readIdent,
  skipQuoted,
  skipRegex,
  skipTemplateLiteral,
  skipTrivia,
} from './scan.js';

/** Modules that re-export the namespace, mapped to their lowered subpath. */
const SOURCES: Record<string, string> = {
  '@voltdev/core': '@voltdev/core/signals',
  '@voltdev/reactivity': '@voltdev/reactivity/signals',
};

/** Members of `Signal`. Pinned against the namespace itself by the tests. */
export const SIGNAL_MEMBERS = ['State', 'Computed'] as const;

/** Members of `Signal.subtle`. */
export const SIGNAL_SUBTLE_MEMBERS = [
  'Watcher',
  'untrack',
  'currentComputed',
  'introspectSources',
  'introspectSinks',
  'hasSinks',
  'hasSources',
  'watched',
  'unwatched',
] as const;

const MEMBERS = new Set<string>(SIGNAL_MEMBERS);
const SUBTLE_MEMBERS = new Set<string>(SIGNAL_SUBTLE_MEMBERS);

export type SignalPlan =
  /** The namespace is not imported here — the file can be left as it is. */
  | { kind: 'none' }
  /** The namespace is imported, and used in a way this pass will not guess at. */
  | { kind: 'declined'; reason: string }
  | {
      kind: 'lowered';
      /** Ranges to overwrite, in source order. */
      rewrites: { start: number; end: number; text: string }[];
      /** The import to add. */
      importFrom: string;
      /** Where it can go: after a shebang and any directive prologue. */
      importAt: number;
      /** Lowered name → local alias, in emission order. */
      imports: { exported: string; local: string }[];
    };

/**
 * Plan the edits that replace every `Signal.*` in `code` with a direct import.
 *
 * A `declined` result means the file is left exactly as written, which is
 * always correct and only larger.
 */
export function planSignalLowering(code: string): SignalPlan {
  const bindings = findNamespaceImports(code);
  if (bindings.length === 0) return { kind: 'none' };

  const targets = new Set(bindings.map((binding) => binding.target));
  if (targets.size > 1) {
    // One alias per member, so two lowered modules would collide on it. Nobody
    // imports the namespace from both packages in one file.
    return { kind: 'declined', reason: 'imported from more than one module' };
  }

  const locals = new Set(bindings.map((binding) => binding.local));
  const skip = bindings.map((binding) => binding.declaration);
  const rewrites: { start: number; end: number; text: string }[] = [];
  // Keyed by the local alias, not the export: the two levels of the namespace
  // share one flat module, and importing one export under two names is legal
  // where emitting one specifier for two aliases would leave one undeclared.
  const used = new Map<string, string>();

  for (const at of findIdentifiers(code, locals, skip)) {
    const access = readAccess(code, at);
    if (!access) {
      return {
        kind: 'declined',
        reason: `\`${code.slice(at.start, at.end)}\` is used as a value, not as \`.State\`, \`.Computed\` or \`.subtle.*\``,
      };
    }
    used.set(access.local, access.exported);
    rewrites.push({ start: at.start, end: access.end, text: access.local });
  }

  if (rewrites.length === 0) return { kind: 'declined', reason: 'imported but never read' };

  return {
    kind: 'lowered',
    rewrites,
    importFrom: [...targets][0]!,
    importAt: importOffset(code),
    imports: [...used].map(([local, exported]) => ({ exported, local })),
  };
}

/**
 * Where an added import may go: past a shebang and the directive prologue.
 *
 * Both are positional. `#!` is a comment on line one and a syntax error on
 * line two, so an import in front of it does not slow a file down, it stops it
 * parsing; and `'use client'` one statement in is an expression statement
 * whose value nobody reads, which fails by doing nothing at all.
 */
function importOffset(code: string): number {
  let at = 0;
  if (code.startsWith('#!')) {
    const line = code.indexOf('\n');
    if (line === -1) return code.length;
    at = line + 1;
  }

  for (;;) {
    const start = skipTrivia(code, at);
    const quote = code[start];
    if (quote !== '"' && quote !== "'") return at;
    const end = skipQuoted(code, start, quote);

    const next = skipTrivia(code, end);
    if (code[next] === ';') {
      at = startOfNextLine(code, next + 1);
      continue;
    }
    // No semicolon: a directive only if the string ends the statement, which
    // it does when a line break separates it from something that cannot
    // continue the expression. `'volt'.length` is not a prologue.
    if (next < code.length && !STATEMENT_HEAD.test(code[next]!)) return at;
    if (!code.slice(end, next).includes('\n')) return at;
    at = startOfNextLine(code, end);
  }
}

/** What a statement after a semicolon-less directive can begin with. */
const STATEMENT_HEAD = /["'@]|[A-Za-z_$]/;

/**
 * The start of the next line, when nothing but trivia stands in the way.
 *
 * Landing on the line the directive ended would leave the import wedged onto
 * the end of it; stepping over live code would put it somewhere the rewrites
 * have already claimed.
 */
function startOfNextLine(code: string, from: number): number {
  const line = code.indexOf('\n', from);
  if (line === -1) return from;
  return skipTrivia(code, from) > line ? line + 1 : from;
}

interface Binding {
  local: string;
  target: string;
  /** The whole import declaration, which the occurrence scan must not read. */
  declaration: { start: number; end: number };
}

/** The identifier occurrence to rewrite, as a half-open range. */
interface Occurrence {
  start: number;
  end: number;
}

interface Access {
  /** Just past the member — `Signal.subtle.untrack` ends after `untrack`. */
  end: number;
  exported: string;
  local: string;
}

/**
 * Read the member access starting at an occurrence of the namespace binding.
 *
 * Returns null for anything that needs the namespace as an object, including
 * writes: `Signal.State = x` would lower to an assignment to an import, which
 * is not merely wrong but unparseable.
 */
function readAccess(code: string, at: Occurrence): Access | null {
  let i = skipTrivia(code, at.end);
  // Optional chaining off a namespace is pointless, and `?.[` is a computed
  // access; neither is worth a second code path.
  if (code[i] !== '.') return null;

  i = skipTrivia(code, i + 1);
  const member = readIdent(code, i);
  if (!member) return null;
  let end = i + member.length;

  let exported: string;
  let local: string;
  if (MEMBERS.has(member)) {
    exported = member;
    local = `__volt_Signal_${member}`;
  } else if (member === 'subtle') {
    i = skipTrivia(code, end);
    if (code[i] !== '.') return null;
    i = skipTrivia(code, i + 1);
    const inner = readIdent(code, i);
    if (!SUBTLE_MEMBERS.has(inner)) return null;
    end = i + inner.length;
    exported = inner;
    local = `__volt_Signal_subtle_${inner}`;
  } else {
    return null;
  }

  if (isWriteTarget(code, at.start, end)) return null;
  return { end, exported, local };
}

const ASSIGNMENT_HEADS = new Set(['+', '-', '*', '/', '%', '&', '|', '^']);

/** Whether the access spanning `[start, end)` is written to rather than read. */
function isWriteTarget(code: string, start: number, end: number): boolean {
  // `delete Signal.State` lowers to `delete __volt_Signal_State`, which is a
  // SyntaxError in a module rather than a wrong answer.
  let before = start - 1;
  while (before >= 0 && /\s/.test(code[before]!)) before--;
  if (before >= 0 && isIdentChar(code[before])) {
    let word = before;
    while (word >= 0 && isIdentChar(code[word]!)) word--;
    if (code.slice(word + 1, before + 1) === 'delete') return true;
  }

  const i = skipTrivia(code, end);
  const ch = code[i];
  if (ch === undefined) return false;
  // `=` alone assigns; `==`, `===` and `=>` do not.
  if (ch === '=') return code[i + 1] !== '=' && code[i + 1] !== '>';
  if ((ch === '+' || ch === '-') && code[i + 1] === ch) return true;
  // Compound assignment, including the three-character `**=`, `<<=`, `>>>=`,
  // `&&=` and their kin: a run of one operator ending in a single `=`.
  if (ASSIGNMENT_HEADS.has(ch) || ch === '<' || ch === '>' || ch === '?') {
    let j = i;
    while (code[j] === ch) j++;
    return code[j] === '=' && code[j + 1] !== '=';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Every value import of `Signal` from a module that re-exports it. */
function findNamespaceImports(code: string): Binding[] {
  const bindings: Binding[] = [];

  for (const at of findKeyword(code, 'import')) {
    let i = skipTrivia(code, at + 'import'.length);
    // `import type { ... }` binds nothing at runtime, and `import(` is a
    // dynamic import, not a declaration. `import Volt, { Signal }` is missed
    // rather than declined, which is silent — but neither package this pass
    // knows has a default export, so the form cannot occur.
    if (code[i] !== '{') continue;

    const names: { imported: string; local: string }[] = [];
    i++;
    for (;;) {
      i = skipTrivia(code, i);
      if (code[i] === '}') {
        i++;
        break;
      }
      if (code[i] === ',') {
        i++;
        continue;
      }
      let word = readIdent(code, i);
      if (!word) break;
      i += word.length;

      let typeOnly = false;
      if (word === 'type') {
        const next = skipTrivia(code, i);
        const after = readIdent(code, next);
        // `import { type Signal }` versus importing something called `type`.
        if (after && after !== 'as') {
          typeOnly = true;
          word = after;
          i = next + after.length;
        }
      }

      let local = word;
      const next = skipTrivia(code, i);
      if (readIdent(code, next) === 'as') {
        const aliasAt = skipTrivia(code, next + 2);
        local = readIdent(code, aliasAt);
        if (!local) break;
        i = aliasAt + local.length;
      }
      if (!typeOnly) names.push({ imported: word, local });
    }

    if (!names.some((name) => name.imported === 'Signal')) continue;

    i = skipTrivia(code, i);
    if (readIdent(code, i) !== 'from') continue;
    i = skipTrivia(code, i + 'from'.length);
    const quote = code[i];
    if (quote !== '"' && quote !== "'") continue;
    const end = skipQuoted(code, i, quote);
    const target = SOURCES[code.slice(i + 1, end - 1)];
    if (!target) continue;

    for (const name of names) {
      if (name.imported !== 'Signal') continue;
      bindings.push({ local: name.local, target, declaration: { start: at, end } });
    }
  }

  return bindings;
}

/**
 * Every occurrence of `keyword` as a standalone word in real code.
 *
 * Strings, comments, template literals and regex literals are stepped over, so
 * a match is always the keyword itself.
 */
function* findKeyword(code: string, keyword: string): Generator<number> {
  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;

    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }
    if (ch === '/') {
      const next = skipTrivia(code, i);
      if (next !== i) {
        i = next;
        continue;
      }
      if (isRegexStart(code, i)) {
        i = skipRegex(code, i);
        continue;
      }
    }
    if (isIdentChar(ch)) {
      const word = readIdent(code, i);
      if (word === keyword) yield i;
      i += word.length;
      continue;
    }
    i++;
  }
}

/**
 * Every occurrence of one of `names` that could be the imported binding.
 *
 * A name after `.` or `#` is somebody else's property, so it is passed over
 * rather than declined — `volt.Signal.State` off a namespace import is a
 * different expression, and lowering it is not this pass's job. The `.` of a
 * spread is not one of those: `{ ...Signal }` reads the whole object, and
 * skipping it would leave the file half-rewritten instead of declined.
 */
function* findIdentifiers(
  code: string,
  names: Set<string>,
  skip: { start: number; end: number }[],
): Generator<Occurrence> {
  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;

    const inside = skip.find((range) => i >= range.start && i < range.end);
    if (inside) {
      i = inside.end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }
    if (ch === '/') {
      const next = skipTrivia(code, i);
      if (next !== i) {
        i = next;
        continue;
      }
      if (isRegexStart(code, i)) {
        i = skipRegex(code, i);
        continue;
      }
    }
    if (isIdentChar(ch)) {
      const word = readIdent(code, i);
      if (names.has(word)) {
        let before = i - 1;
        while (before >= 0 && /\s/.test(code[before]!)) before--;
        const property =
          (code[before] === '.' && code[before - 1] !== '.') || code[before] === '#';
        if (!property) yield { start: i, end: i + word.length };
      }
      i += word.length;
      continue;
    }
    i++;
  }
}
