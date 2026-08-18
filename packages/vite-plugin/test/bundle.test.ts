/**
 * What the `Signal` lowering is worth to an application, measured on a built
 * bundle, and what a bundle it rewrote does when it runs.
 *
 * Every other test of the pass reads its output as text, and that cannot see
 * either half of the claim. A transform can be textually perfect and save
 * nothing: for a while this one bought 73 B of a possible 522 B on
 * `examples/counter`, because `export namespace Signal` sat in the same module
 * as `effect` and compiles to a top-level call no bundler may drop, so every
 * app kept the object the rewrite had just stopped using. And the rest of the
 * suite runs the namespace spelling only — nothing else here has ever executed
 * a module this pass rewrote.
 *
 * So the application is built the way an application really is: against the
 * package as it ships, `.ts` already compiled to `.js`. Building against the
 * sources cannot show any of this — the TypeScript transform marks the
 * namespace IIFE removable on the way through, and the bundle comes out the
 * same either way.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { volt } from '../src/index.js';

const reactivity = resolve(import.meta.dirname, '../../reactivity');
const entry = resolve(import.meta.dirname, 'fixtures/signal-app.ts');
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * `@voltdev/reactivity` built by its own config, which is what decides whether
 * the namespace ships in a chunk of its own — the thing an application's
 * bundler can act on. Built once and shared; nothing here writes to it.
 */
const published = (async () => {
  const out = await mkdtemp(join(tmpdir(), 'volt-signals-'));
  temporary.push(out);
  const dist = join(out, 'dist');
  await build({
    root: reactivity,
    logLevel: 'silent',
    build: { outDir: dist, sourcemap: false, emptyOutDir: false },
  });
  // The manifest travels with the output: `sideEffects: false` is half of why
  // an application can drop the namespace chunk, and a package built without
  // it measures a saving no real install would see.
  await copyFile(join(reactivity, 'package.json'), join(out, 'package.json'));
  return dist;
})();

/** The fixture app, bundled against that package the way a project would. */
async function bundle(lowerSignals: boolean): Promise<string> {
  const dist = await published;
  const result = (await build({
    root: resolve(import.meta.dirname, '..'),
    configFile: false,
    logLevel: 'silent',
    plugins: [volt({ lowerSignals })],
    resolve: {
      alias: {
        '@voltdev/reactivity/signals': join(dist, 'signals.js'),
        '@voltdev/reactivity': join(dist, 'index.js'),
      },
    },
    build: {
      write: false,
      target: 'esnext',
      // Names have to survive for the assertions below to be able to say what
      // is gone; the byte comparison is between two unminified builds.
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'app' },
    },
  })) as RollupOutput[];

  return result[0]!.output[0].code;
}

/** Run a built bundle, without writing it anywhere. */
async function load(code: string): Promise<typeof import('./fixtures/signal-app.js')> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return (await import(/* @vite-ignore */ url)) as typeof import('./fixtures/signal-app.js');
}

/** Reachable only through the namespace object, once an app stops naming it. */
const INTROSPECTION = [
  'currentComputed',
  'introspectSources',
  'introspectSinks',
  'hasSinks',
  'hasSources',
];

const both = Promise.all([bundle(true), bundle(false)]);

describe('what lowering takes out of an application bundle', { timeout: 120_000 }, () => {
  it('drops the namespace object and the introspection surface behind it', async () => {
    const [lowered, kept] = await both;

    expect(kept).toContain('var Signal;');
    expect(lowered).not.toContain('var Signal;');
    for (const name of INTROSPECTION) {
      expect(kept, `${name} is reachable through the namespace`).toContain(`function ${name}(`);
      expect(lowered, `${name} outlived the namespace`).not.toContain(`function ${name}(`);
    }
  });

  it('leaves the watcher and `untrack` alone, which an effect holds either way', async () => {
    // `effect.ts` imports both straight from `graph.js`, and `graph.ts` asks
    // `sink instanceof WatcherNode` on every notification. No lowering of the
    // namespace can drop what the graph itself reaches for, and a comment that
    // says otherwise sends the next reader looking for bytes that were never
    // there to save.
    const [lowered] = await both;
    expect(lowered).toContain('function untrack(');
    expect(lowered).toContain('instanceof WatcherNode');
  });

  it('is smaller by far more than the import it adds', async () => {
    const [lowered, kept] = await both;

    // ~2.6 kB unminified here; ~522 B minified and ~179 B gzipped on
    // `examples/counter`. The floor is low enough to survive the framework
    // growing around it, and high enough that only the namespace object
    // falling out of the bundle can meet it — the rewrite itself writes about
    // 60 B into the file.
    expect(kept.length - lowered.length).toBeGreaterThan(1000);
  });
});

describe('what a lowered bundle does when it runs', { timeout: 120_000 }, () => {
  it('behaves exactly as the same source does under the namespace', async () => {
    const [lowered, kept] = await both;

    const viaImports = (await load(lowered)).run();
    const viaNamespace = (await load(kept)).run();

    expect(viaImports).toEqual({ seen: [2, 8], peeked: 4, sameClass: true });
    expect(viaImports).toEqual(viaNamespace);
  });
});
