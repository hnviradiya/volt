/**
 * The js-framework-benchmark table component, written in Volt.
 *
 * Deliberately kept identical in structure to the reference implementations
 * so the comparison is about framework overhead, not about who wrote a
 * cleverer template.
 */

import { Component, Signal } from '@voltdev/core';

export interface Row {
  id: number;
  label: string;
}

const ADJECTIVES = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome',
  'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful',
  'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive',
  'cheap', 'expensive', 'fancy',
];
const COLOURS = [
  'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown',
  'white', 'black', 'orange',
];
const NOUNS = [
  'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie',
  'sandwich', 'burger', 'pizza', 'mouse', 'keyboard',
];

/**
 * A deterministic generator, so every run builds the same labels and timings
 * are comparable between runs and between frameworks.
 */
let seed = 1;
function random(max: number): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % max;
}

export function resetSeed(): void {
  seed = 1;
}

let nextId = 1;

export function buildRows(count: number): Row[] {
  const rows = new Array<Row>(count);
  for (let i = 0; i < count; i++) {
    rows[i] = {
      id: nextId++,
      label: `${ADJECTIVES[random(ADJECTIVES.length)]} ${COLOURS[random(COLOURS.length)]} ${NOUNS[random(NOUNS.length)]}`,
    };
  }
  return rows;
}

export function resetIds(): void {
  nextId = 1;
}

@Component({
  selector: 'v-bench',
  templateUrl: './bench-app.html',
})
export class BenchApp {
  rows = new Signal.State<Row[]>([]);
  selected = new Signal.State<number>(-1);

  run(count = 1000): void {
    this.rows.set(buildRows(count));
  }

  add(count = 1000): void {
    this.rows.set([...this.rows.get(), ...buildRows(count)]);
  }

  /** Mutate every tenth row's label — the classic partial-update case. */
  update(): void {
    const current = this.rows.get();
    const next = current.slice();
    for (let i = 0; i < next.length; i += 10) {
      next[i] = { ...next[i]!, label: `${next[i]!.label} !!!` };
    }
    this.rows.set(next);
  }

  swap(): void {
    const current = this.rows.get();
    if (current.length < 999) return;
    const next = current.slice();
    const a = next[1]!;
    next[1] = next[998]!;
    next[998] = a;
    this.rows.set(next);
  }

  select(id: number): void {
    this.selected.set(id);
  }

  remove(id: number): void {
    this.rows.set(this.rows.get().filter((row) => row.id !== id));
  }

  clear(): void {
    this.rows.set([]);
  }
}
