/**
 * Framework-overhead benchmark, running the js-framework-benchmark operations.
 *
 * This runs against happy-dom, so the absolute numbers are not browser
 * numbers — there is no layout, paint, or style recalculation. What it does
 * measure honestly is the JavaScript Volt itself executes: reconciliation,
 * effect scheduling, and allocation. That is exactly what the optimisation
 * work targets, and it makes regressions visible in CI.
 *
 * Run with: pnpm bench
 */

import { beforeAll, describe, expect, it } from 'vitest';
import '@voltjs/core/jit';
import { flushSync, mount, type MountHandle } from '@voltjs/core';
import { BenchApp, resetIds, resetSeed } from '../src/bench-app.js';

interface Sample {
  name: string;
  ms: number;
  nodes: number;
}

const results: Sample[] = [];

let host: HTMLElement;
let handle: MountHandle;
let app: BenchApp;

/** Time an operation, including the DOM work its signal writes trigger. */
function measure(name: string, operation: () => void, warmups = 2): number {
  // Warm up so the first sample is not paying for lazy template parsing.
  for (let i = 0; i < warmups; i++) {
    operation();
    flushSync();
    app.clear();
    flushSync();
  }

  const started = performance.now();
  operation();
  flushSync();
  const elapsed = performance.now() - started;

  results.push({ name, ms: elapsed, nodes: host.querySelectorAll('tr').length });
  return elapsed;
}

beforeAll(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  resetIds();
  resetSeed();
  handle = mount(BenchApp, host);
  app = handle.instance as BenchApp;
});

describe('js-framework-benchmark operations', () => {
  it('create 1,000 rows', () => {
    const ms = measure('create 1k', () => app.run(1000));
    expect(host.querySelectorAll('tr')).toHaveLength(1000);
    expect(ms).toBeLessThan(2000);
  });

  it('create 10,000 rows', () => {
    const ms = measure('create 10k', () => app.run(10000), 1);
    expect(host.querySelectorAll('tr')).toHaveLength(10000);
    expect(ms).toBeLessThan(10000);
  });

  it('append 1,000 to 1,000', () => {
    app.clear();
    flushSync();
    app.run(1000);
    flushSync();

    const started = performance.now();
    app.add(1000);
    flushSync();
    results.push({
      name: 'append 1k',
      ms: performance.now() - started,
      nodes: host.querySelectorAll('tr').length,
    });

    expect(host.querySelectorAll('tr')).toHaveLength(2000);
  });

  it('update every 10th row', () => {
    app.clear();
    flushSync();
    app.run(1000);
    flushSync();

    const before = [...host.querySelectorAll('tr')];
    const started = performance.now();
    app.update();
    flushSync();
    results.push({
      name: 'partial update',
      ms: performance.now() - started,
      nodes: 100,
    });

    const after = [...host.querySelectorAll('tr')];
    // Every row element must survive — only 100 labels changed.
    expect(after).toEqual(before);
    expect(after[0]!.querySelector('.col-label')!.textContent).toContain('!!!');
    expect(after[1]!.querySelector('.col-label')!.textContent).not.toContain('!!!');
  });

  it('select a row', () => {
    const started = performance.now();
    app.select(app.rows.get()[500]!.id);
    flushSync();
    results.push({ name: 'select row', ms: performance.now() - started, nodes: 1 });

    expect(host.querySelectorAll('tr.danger')).toHaveLength(1);
  });

  it('swap two rows', () => {
    const rows = [...host.querySelectorAll('tr')];
    const first = rows[1]!;
    const second = rows[998]!;

    const started = performance.now();
    app.swap();
    flushSync();
    results.push({ name: 'swap rows', ms: performance.now() - started, nodes: 2 });

    const after = [...host.querySelectorAll('tr')];
    // The same two elements are moved, never recreated.
    expect(after[1]).toBe(second);
    expect(after[998]).toBe(first);
  });

  it('remove a row', () => {
    const before = host.querySelectorAll('tr').length;

    const started = performance.now();
    app.remove(app.rows.get()[100]!.id);
    flushSync();
    results.push({ name: 'remove row', ms: performance.now() - started, nodes: 1 });

    expect(host.querySelectorAll('tr')).toHaveLength(before - 1);
  });

  it('clear all rows', () => {
    app.clear();
    flushSync();
    app.run(1000);
    flushSync();

    const started = performance.now();
    app.clear();
    flushSync();
    results.push({ name: 'clear 1k', ms: performance.now() - started, nodes: 0 });

    expect(host.querySelectorAll('tr')).toHaveLength(0);
  });

  it('reports the results', () => {
    const lines = [
      '',
      '  Volt — framework overhead (happy-dom, no layout or paint)',
      '  ' + '-'.repeat(46),
      ...results.map((r) => `  ${r.name.padEnd(18)} ${r.ms.toFixed(2).padStart(9)} ms`),
      '',
    ];
    console.info(lines.join('\n'));
    expect(results.length).toBeGreaterThan(0);
  });
});
