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
  'packages/reactivity/dist/index.js': 3_000,
  'packages/core/dist/runtime.js': 750,
  'packages/core/dist/index.js': 400,
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
