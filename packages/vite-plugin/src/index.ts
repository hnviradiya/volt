/**
 * @voltjs/vite-plugin
 *
 * Two build-time jobs, both of which remove work from the browser:
 *
 *  1. **Standard decorators.** `@Component` and friends are TC39 stage-3
 *     syntax that no engine implements yet, and Vite's oxc transformer does
 *     not lower them. This plugin does, via esbuild.
 *
 *  2. **Template compilation.** `template: \`...\`` in a `@Component` becomes a
 *     `render` function built from hoisted `<template>` clones, so no compiler
 *     ships to production and no template is parsed at runtime.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { transform as esbuildTransform } from 'esbuild';
import { compile, CompilerError } from '@voltjs/compiler';
import type { Plugin } from 'vite';

export interface VoltPluginOptions {
  /** File pattern to process. Defaults to `.ts`/`.mts` outside node_modules. */
  include?: RegExp;
  exclude?: RegExp;
  /**
   * Compile `template` strings to `render` functions at build time.
   * Turning this off requires importing `@voltjs/core/jit` at runtime.
   */
  precompileTemplates?: boolean;
  /** Module the generated code imports its runtime helpers from. */
  runtimeModule?: string;
  /** Log what the compiler folded away for each template. */
  debug?: boolean;
}

const DEFAULT_INCLUDE = /\.m?ts$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;
const RUNTIME_NAMESPACE = '__volt_rt';

export function volt(options: VoltPluginOptions = {}): Plugin[] {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const runtimeModule = options.runtimeModule ?? '@voltjs/core/runtime';
  const precompile = options.precompileTemplates ?? true;

  const shouldProcess = (id: string): boolean => {
    const clean = id.split('?')[0] ?? id;
    return include.test(clean) && !exclude.test(clean);
  };

  const templatePlugin: Plugin = {
    name: 'volt:templates',
    // Must see the original source, before decorators are lowered away.
    enforce: 'pre',
    async transform(code, id) {
      if (!precompile || !shouldProcess(id)) return null;
      if (!code.includes('@Component')) return null;

      try {
        return await compileTemplates(code, id, runtimeModule, options.debug ?? false, (file) =>
          this.addWatchFile(file),
        );
      } catch (err) {
        if (err instanceof CompilerError) {
          // The message already names the template's own file, which for a
          // templateUrl is not this module.
          this.error(err.filename ? err.message : `${err.message}\n  in ${id}`);
        }
        throw err;
      }
    },
  };

  const decoratorPlugin: Plugin = {
    name: 'volt:decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!shouldProcess(id)) return null;
      // Cheap gate: only files that actually decorate something.
      if (!/^\s*@[A-Za-z_$]/m.test(code)) return null;

      const result = await esbuildTransform(code, {
        loader: 'ts',
        // es2022 keeps modern output while still lowering decorators, which
        // esnext would leave in place as unsupported syntax.
        target: 'es2022',
        sourcefile: id,
        sourcemap: true,
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: false,
            useDefineForClassFields: true,
          },
        },
      });

      return { code: result.code, map: result.map };
    },
  };

  return [templatePlugin, decoratorPlugin];
}

export default volt;

// ---------------------------------------------------------------------------
// Template precompilation
// ---------------------------------------------------------------------------

interface TemplateSite {
  /** Range covering the whole `templateUrl:` property. */
  start: number;
  end: number;
  /** Path to the `.html` file, relative to the declaring module. */
  path: string;
}

interface StyleSite {
  start: number;
  end: number;
  /** One or more paths to CSS files. */
  paths: string[];
}

/**
 * Replace every template in a `@Component({...})` with a compiled `render`,
 * and inline any `styleUrl`/`styleUrls` files.
 *
 * Sites are located by scanning tokens rather than matching source patterns,
 * so a backtick inside a string, a comment mentioning `template:`, or a nested
 * object literal cannot produce a false hit.
 */
async function compileTemplates(
  code: string,
  id: string,
  runtimeModule: string,
  debug: boolean,
  watch: (file: string) => void,
): Promise<{ code: string; map: null } | null> {
  const templates = findTemplateSites(code);
  const styles = findStyleSites(code);
  if (templates.length === 0 && styles.length === 0) return null;

  const dir = dirname(id.split('?')[0] ?? id);
  const preamble: string[] = [];

  interface Replacement {
    start: number;
    end: number;
    text: string;
  }
  const edits: Replacement[] = [];
  let index = 0;

  for (const site of templates) {
    const file = resolvePath(dir, site.path);
    // Registering the file makes an edit to the markup re-run this transform,
    // so templates hot-reload like any other source file.
    watch(file);

    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      throw new Error(
        `[volt] templateUrl "${site.path}" could not be read (resolved to ${file}), referenced by ${id}`,
      );
    }

    const result = compile(source, {
      filename: file,
      runtime: RUNTIME_NAMESPACE,
      runtimeModule,
    });

    if (debug) {
      const { stats } = result;
      console.info(
        `[volt] ${id}: ${stats.templates} template(s), ${stats.effects} effect(s), ` +
          `${stats.foldedBindings} binding(s) folded, ` +
          `${stats.delegatedEvents} event(s) delegated, ` +
          `${stats.dedupedTemplates} markup dedupe(s)`,
      );
    }

    const renderName = `__volt_render_${index++}`;
    preamble.push(...result.hoisted);
    preamble.push(`function ${renderName}(_ctx) {\n  return ${result.renderExpression};\n}`);
    edits.push({ start: site.start, end: site.end, text: `render: ${renderName}` });
  }

  for (const site of styles) {
    const collected: string[] = [];
    for (const relative of site.paths) {
      const file = resolvePath(dir, relative);
      watch(file);
      try {
        collected.push(await readFile(file, 'utf8'));
      } catch {
        throw new Error(
          `[volt] styleUrl "${relative}" could not be read (resolved to ${file}), referenced by ${id}`,
        );
      }
    }
    edits.push({
      start: site.start,
      end: site.end,
      text: `styles: ${JSON.stringify(collected.join('\n'))}`,
    });
  }

  edits.sort((a, b) => a.start - b.start);

  let output = '';
  let cursor = 0;
  for (const edit of edits) {
    output += code.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  output += code.slice(cursor);

  const header =
    preamble.length > 0
      ? `import * as ${RUNTIME_NAMESPACE} from ${JSON.stringify(runtimeModule)};\n` +
        preamble.join('\n') +
        '\n'
      : '';

  return { code: header + output, map: null };
}

/**
 * Scan for `templateUrl:` properties inside a `@Component(` call, ignoring
 * anything in a comment, a string, or an unrelated object literal.
 */
function findTemplateSites(code: string): TemplateSite[] {
  const sites: TemplateSite[] = [];

  scanComponentProperties(code, (name, start, valueStart) => {
    if (name !== 'templateUrl') return null;
    const quote = code[valueStart];
    if (quote !== '"' && quote !== "'") return null;
    const end = skipQuoted(code, valueStart, quote);
    sites.push({ start, end, path: code.slice(valueStart + 1, end - 1) });
    return end;
  });

  return sites;
}

/** Scan for `styleUrl:` / `styleUrls:` inside a `@Component(` call. */
function findStyleSites(code: string): StyleSite[] {
  const sites: StyleSite[] = [];

  scanComponentProperties(code, (name, start, valueStart) => {
    if (name !== 'styleUrl' && name !== 'styleUrls') return null;

    const quote = code[valueStart];
    if (quote === '"' || quote === "'") {
      const end = skipQuoted(code, valueStart, quote);
      sites.push({ start, end, paths: [code.slice(valueStart + 1, end - 1)] });
      return end;
    }

    if (quote === '[') {
      const end = matchBracket(code, valueStart);
      const inner = code.slice(valueStart + 1, end - 1);
      const paths = [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      if (paths.length === 0) return null;
      sites.push({ start, end, paths });
      return end;
    }

    return null;
  });

  return sites;
}

/**
 * Walk `code`, invoking `onProperty` for each `name:` found directly inside a
 * `@Component(` argument. The callback returns the index to resume from when
 * it consumed the value, or null to skip.
 */
function scanComponentProperties(
  code: string,
  onProperty: (name: string, start: number, valueStart: number) => number | null,
): void {
  let i = 0;
  let componentDepth = -1;
  let depth = 0;

  const isIdentChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);

  while (i < code.length) {
    const ch = code[i]!;

    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
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

    if (ch === '@' && code.startsWith('@Component', i) && !isIdentChar(code[i + 10] ?? '')) {
      const paren = code.indexOf('(', i + 10);
      if (paren !== -1) {
        componentDepth = depth;
        i = paren + 1;
        depth++;
        continue;
      }
    }

    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (componentDepth !== -1 && depth <= componentDepth) componentDepth = -1;
      i++;
      continue;
    }

    if (componentDepth !== -1 && /[A-Za-z_$]/.test(ch) && !isIdentChar(code[i - 1] ?? ' ')) {
      let j = i;
      while (j < code.length && isIdentChar(code[j]!)) j++;
      const name = code.slice(i, j);

      let k = j;
      while (k < code.length && /\s/.test(code[k]!)) k++;
      if (code[k] === ':') {
        k++;
        while (k < code.length && /\s/.test(code[k]!)) k++;
        const resume = onProperty(name, i, k);
        if (resume !== null) {
          i = resume;
          continue;
        }
      }
      i = j;
      continue;
    }

    i++;
  }
}

/** Index just past the `]` matching the `[` at `start`. */
function matchBracket(code: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function skipQuoted(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function skipTemplateLiteral(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === '`') return i + 1;
    if (code[i] === '$' && code[i + 1] === '{') {
      let braces = 1;
      i += 2;
      while (i < code.length && braces > 0) {
        if (code[i] === '{') braces++;
        else if (code[i] === '}') braces--;
        else if (code[i] === '`') {
          i = skipTemplateLiteral(code, i);
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

export { compile, CompilerError };
