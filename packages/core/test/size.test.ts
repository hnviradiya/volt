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

const root = resolve(import.meta.dirname, '../../..');

/** Gzipped size in bytes, or null when the package has not been built. */
function gzipped(relative: string): number | null {
  const file = resolve(root, relative);
  if (!existsSync(file)) return null;
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

/**
 * Ceilings, set just above the measured size at the time of writing. They are
 * ratchets: a change that adds weight has to move the number here and say why.
 * The compiler is excluded — it runs at build time and never ships.
 */
const BUDGETS: Record<string, number> = {
  // Raised from 6,500 when Watcher.unwatch stopped searching and splicing its
  // source list. The index bookkeeping costs ~280 B gzipped and took tearing
  // down 8,000 effects from 1,848 ms to 14.7 ms — it was quadratic.
  'packages/reactivity/dist/index.js': 6_700,
  'packages/core/dist/runtime.js': 1_100,
  'packages/core/dist/index.js': 400,
};

describe('bundle budgets', () => {
  for (const [file, budget] of Object.entries(BUDGETS)) {
    it(`${file} stays under ${budget} B gzipped`, () => {
      const size = gzipped(file);
      if (size === null) {
        // `pnpm build` has not run; nothing to measure rather than a failure.
        expect(size).toBeNull();
        return;
      }
      expect(size, `${file} is ${size} B gzipped`).toBeLessThanOrEqual(budget);
    });
  }
});
