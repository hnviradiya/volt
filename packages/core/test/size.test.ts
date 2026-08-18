/**
 * Bundle size is a benchmark, so it gets a test.
 *
 * These are ceilings on the built packages, not targets. They exist so a
 * change that quietly adds a kilobyte has to justify itself by moving the
 * number in this file.
 */
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');

/**
 * Minified, gzipped size in bytes — or null when the package is not built.
 *
 * The published bundles are deliberately unminified, so an app's bundler can
 * minify them in context. Measuring them as-is therefore measured the
 * comments: explaining why a loop is written a certain way cost more
 * "bundle size" than the loop, which is precisely the wrong incentive.
 */
function measured(relative: string): number | null {
  const file = resolve(root, relative);
  if (!existsSync(file)) return null;
  const source = readFileSync(file, 'utf8');
  const minified = transformSync(source, { loader: 'js', minify: true, target: 'esnext' }).code;
  return gzipSync(minified, { level: 9 }).length;
}

/**
 * Ceilings, set just above the measured size at the time of writing. They are
 * ratchets: a change that adds weight has to move the number here and say why.
 * The compiler is excluded — it runs at build time and never ships.
 */
const BUDGETS: Record<string, number> = {
  // Raised from 3000 by the request scope and the data lane: a server keeps
  // one render's queues, styles, ids and locale apart from another's, and the
  // published bundle carries that with the defines still open, so the guarded
  // server paths are measured here even though an application's own build
  // removes them. ~254 B of the raise is the devtools seam, which is here for
  // the same reason: the graph and the scheduler are the only places that know
  // which write woke which effect and what a flush cost.
  'packages/reactivity/dist/index.js': 3_350,
  // The `Signal` namespace, which ships as its own chunk so that an app whose
  // build lowered it away can drop the whole file. Budgeted separately for the
  // same reason it was split out: bytes that leave `index.js` for a file
  // nothing measures have not left anything.
  'packages/reactivity/dist/namespace.js': 300,
  // Raised from 750 when lazy/preload moved to the runtime entry, which is
  // where generated code reaches them now that splitting is the build's
  // decision rather than something an application writes.
  'packages/core/dist/runtime.js': 800,
  // Raised from 400 when ids moved here from @voltdev/primitives, which is
  // where they have to be minted: an id is now a component's position in the
  // tree rather than a number from a counter, and only the component runtime
  // knows the position.
  'packages/core/dist/index.js': 550,
};

describe('bundle budgets', () => {
  for (const [file, budget] of Object.entries(BUDGETS)) {
    it(`${file} stays under ${budget} B gzipped`, () => {
      const size = measured(file);
      if (size === null) {
        // `pnpm build` has not run; nothing to measure rather than a failure.
        expect(size).toBeNull();
        return;
      }
      expect(size, `${file} is ${size} B gzipped`).toBeLessThanOrEqual(budget);
    });
  }
});
