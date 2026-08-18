/**
 * Lowering the `Signal` namespace to direct imports at build time.
 *
 * The public API is the TC39 spelling, `new Signal.State(0)`, and
 * `export namespace Signal` compiles to a runtime object. An object is opaque
 * to a bundler — reaching one property retains all of them — so an app that
 * only ever constructs state signals still ships the watcher, `untrack` and
 * the six introspection functions, with no line of the application able to
 * reach any of them.
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
 * and the namespace object, along with everything it was holding alive, falls
 * out of the bundle. The original import is deliberately left in place: it is
 * unused afterwards, so a bundler drops it, and leaving it means a usage this
 * pass declined to rewrite still resolves.
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
      /** The import to prepend. */
      importFrom: string;
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
  const used = new Map<string, string>();

  for (const at of findIdentifiers(code, locals, skip)) {
    const access = readAccess(code, at);
    if (!access) {
      return {
        kind: 'declined',
        reason: `\`${code.slice(at.start, at.end)}\` is used as a value, not as \`.State\`, \`.Computed\` or \`.subtle.*\``,
      };
    }
    used.set(access.exported, access.local);
    rewrites.push({ start: at.start, end: access.end, text: access.local });
  }

  if (rewrites.length === 0) return { kind: 'declined', reason: 'imported but never read' };

  return {
    kind: 'lowered',
    rewrites,
    importFrom: [...targets][0]!,
    imports: [...used].map(([exported, local]) => ({ exported, local })),
  };
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
    // dynamic import, not a declaration.
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
 * different expression, and lowering it is not this pass's job.
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
        if (code[before] !== '.' && code[before] !== '#') {
          yield { start: i, end: i + word.length };
        }
      }
      i += word.length;
      continue;
    }
    i++;
  }
}
