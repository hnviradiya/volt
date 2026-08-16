/**
 * Browser entry for the benchmark.
 *
 * The happy-dom suite in `test/` measures the update path, where Volt's own
 * work dominates. Create and clear are dominated there by happy-dom's
 * JavaScript DOM, so real numbers for those need a real browser — this page.
 *
 *   pnpm --filter @volt/benchmarks run dev
 */

import { Component, Signal, flushSync, mount } from '@volt/core';
import { BenchApp } from './bench-app.js';

interface Timing {
  name: string;
  ms: number;
}

@Component({
  selector: 'v-harness',
  imports: [BenchApp],
  templateUrl: './harness.html',
})
export class Harness {
  bench: BenchApp | null = null;
  report = new Signal.State('Ready.');

  private readonly timings: Timing[] = [];

  /** Time an operation including the DOM work its signal writes trigger. */
  private measure(name: string, operation: () => void): void {
    const started = performance.now();
    operation();
    flushSync();
    const ms = performance.now() - started;

    this.timings.unshift({ name, ms });
    this.timings.length = Math.min(this.timings.length, 12);
    this.report.set(
      this.timings.map((t) => `${t.name.padEnd(20)}${t.ms.toFixed(2).padStart(9)} ms`).join('\n'),
    );
  }

  run(count: number): void {
    this.measure(`create ${count}`, () => this.bench?.run(count));
  }

  append(): void {
    this.measure('append 1,000', () => this.bench?.add(1000));
  }

  update(): void {
    this.measure('update every 10th', () => this.bench?.update());
  }

  swap(): void {
    this.measure('swap rows', () => this.bench?.swap());
  }

  clear(): void {
    this.measure('clear', () => this.bench?.clear());
  }
}

mount(Harness, '#app');
