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
    transform(code, id) {
      if (!precompile || !shouldProcess(id)) return null;
      if (!code.includes('@Component')) return null;

      try {
        return compileTemplates(code, id, runtimeModule, options.debug ?? false);
      } catch (err) {
        if (err instanceof CompilerError) {
          this.error(`${err.message}\n  in ${id}`);
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
  /** Range covering `template: \`...\`` including the key. */
  start: number;
  end: number;
  source: string;
}

/**
 * Replace every `template` in a `@Component({...})` with a compiled `render`.
 *
 * Sites are located by scanning tokens rather than matching source patterns,
 * so a backtick inside a string, a comment mentioning `template:`, or a nested
 * object literal cannot produce a false hit.
 */
function compileTemplates(
  code: string,
  id: string,
  runtimeModule: string,
  debug: boolean,
): { code: string; map: null } | null {
  const sites = findTemplateSites(code);
  if (sites.length === 0) return null;

  const preamble: string[] = [];
  let output = '';
  let cursor = 0;
  let index = 0;

  for (const site of sites) {
    const result = compile(site.source, {
      filename: id,
      runtime: RUNTIME_NAMESPACE,
      runtimeModule,
    });

    if (debug) {
      const { stats } = result;
      console.info(
        `[volt] ${id}: ${stats.templates} template(s), ${stats.effects} effect(s), ` +
          `${stats.foldedBindings} binding(s) folded, ` +
          `${stats.dedupedTemplates} markup dedupe(s)`,
      );
    }

    const renderName = `__volt_render_${index++}`;
    preamble.push(...result.hoisted);
    preamble.push(
      `function ${renderName}(_ctx) {\n  return ${result.renderExpression};\n}`,
    );

    output += code.slice(cursor, site.start);
    output += `render: ${renderName}`;
    cursor = site.end;
  }

  output += code.slice(cursor);

  const header =
    `import * as ${RUNTIME_NAMESPACE} from ${JSON.stringify(runtimeModule)};\n` +
    preamble.join('\n') +
    '\n';

  return { code: header + output, map: null };
}

/** Scan for `template:` properties that sit inside a `@Component(` call. */
function findTemplateSites(code: string): TemplateSite[] {
  const sites: TemplateSite[] = [];
  let i = 0;

  // Depth of brackets since entering a @Component( call, or -1 when outside.
  let componentDepth = -1;
  let depth = 0;

  const isIdentChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);

  while (i < code.length) {
    const ch = code[i]!;

    // Skip over anything that could contain misleading text.
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

    // Only inside a @Component(...) call is `template:` meaningful.
    if (
      componentDepth !== -1 &&
      code.startsWith('template', i) &&
      !isIdentChar(code[i - 1] ?? ' ') &&
      !isIdentChar(code[i + 8] ?? '')
    ) {
      const start = i;
      let j = i + 8;
      while (j < code.length && /\s/.test(code[j]!)) j++;
      if (code[j] === ':') {
        j++;
        while (j < code.length && /\s/.test(code[j]!)) j++;
        if (code[j] === '`') {
          const literalStart = j;
          const literalEnd = skipTemplateLiteral(code, j);
          const raw = code.slice(literalStart + 1, literalEnd - 1);

          // An interpolated template literal is host-language interpolation,
          // not a Volt template; leave it for the runtime compiler.
          if (!/\$\{/.test(raw)) {
            sites.push({ start, end: literalEnd, source: unescapeTemplate(raw) });
            i = literalEnd;
            continue;
          }
        }
      }
      i = start + 8;
      continue;
    }

    i++;
  }

  return sites;
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

/** Turn the raw literal text back into the string the author wrote. */
function unescapeTemplate(raw: string): string {
  return raw.replaceAll('\\`', '`').replaceAll('\\$', '$').replaceAll('\\\\', '\\');
}

export { compile, CompilerError };
