/**
 * Control measurement: what does the DOM environment cost on its own?
 *
 * The benchmark runs against happy-dom, whose DOM is JavaScript. Before
 * attributing a number to framework overhead, it is worth knowing what the
 * same DOM work costs with no framework at all — otherwise you optimise the
 * environment instead of the code.
 */

import { describe, expect, it } from 'vitest';
import { buildRows, resetIds, resetSeed } from '../src/bench-app.js';

function timed(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe('environment baseline (no framework)', () => {
  it('reports hand-written DOM cost for the same table', () => {
    document.body.innerHTML = '<div id="control"></div>';
    const host = document.querySelector('#control')!;
    resetIds();
    resetSeed();

    const rows = buildRows(10000);

    // The most direct construction possible: clone a prepared row and fill it.
    const proto = document.createElement('template');
    proto.innerHTML =
      '<tr><td class="col-id"></td><td class="col-label"><a></a></td>' +
      '<td class="col-remove"><a>x</a></td><td class="col-spacer"></td></tr>';
    const rowTemplate = proto.content.firstChild!;

    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    host.appendChild(table);

    const build = timed(() => {
      for (const row of rows) {
        const tr = rowTemplate.cloneNode(true) as HTMLElement;
        const id = tr.firstChild as HTMLElement;
        id.textContent = String(row.id);
        const label = id.nextSibling!.firstChild as HTMLElement;
        label.textContent = row.label;
        tbody.appendChild(tr);
      }
    });

    const clear = timed(() => {
      tbody.textContent = '';
    });

    console.info(
      [
        '',
        '  Control — hand-written DOM, no framework (happy-dom)',
        '  ' + '-'.repeat(46),
        `  build 10k rows     ${build.toFixed(2).padStart(9)} ms`,
        `  clear 10k rows     ${clear.toFixed(2).padStart(9)} ms`,
        '',
      ].join('\n'),
    );

    expect(build).toBeGreaterThan(0);
  });
});
