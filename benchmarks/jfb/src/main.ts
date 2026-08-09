/**
 * Volt implementation for js-framework-benchmark (keyed).
 *
 * Structured to mirror the Solid implementation as closely as the two
 * frameworks allow, so the comparison is about the frameworks and not about
 * the two authors' choices:
 *
 *   - each row owns a `label` signal, so "update every 10th row" writes 100
 *     signals and touches 100 text nodes, never the list
 *   - rows are keyed by id, so "swap" and "remove" move existing elements
 *   - the row id is captured as a plain value, exactly as Solid does
 */

import { Component, Signal, batch, mount } from '@voltjs/core';

const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy']; // prettier-ignore
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']; // prettier-ignore
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard']; // prettier-ignore

const random = (max: number): number => Math.round(Math.random() * 1000) % max;

interface Row {
  id: number;
  label: Signal.State<string>;
}

let nextId = 1;

function buildData(count: number): Row[] {
  const data = new Array<Row>(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: nextId++,
      label: new Signal.State(
        `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`,
      ),
    };
  }
  return data;
}

@Component({
  selector: 'v-benchmark',
  template: `
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Volt</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="run" :click="run()">Create 1,000 rows</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="runlots" :click="runLots()">Create 10,000 rows</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add" :click="add()">Append 1,000 rows</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="update" :click="update()">Update every 10th row</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="clear" :click="clear()">Clear</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="swaprows" :click="swapRows()">Swap Rows</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <table class="table table-hover table-striped test-data">
        <tbody>
          <tr
            :for="row in data.get()"
            :key="row.id"
            :class="{ danger: row.id === selected.get() }"
          >
            <td class="col-md-1">{{ row.id }}</td>
            <td class="col-md-4"><a :click="select(row.id)">{{ row.label.get() }}</a></td>
            <td class="col-md-1">
              <a :click="remove(row.id)">
                <span class="glyphicon glyphicon-remove" aria-hidden="true"></span>
              </a>
            </td>
            <td class="col-md-6"></td>
          </tr>
        </tbody>
      </table>

      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
    </div>
  `,
})
export class Benchmark {
  data = new Signal.State<Row[]>([]);
  selected = new Signal.State<number>(-1);

  run(): void {
    this.data.set(buildData(1000));
  }

  runLots(): void {
    this.data.set(buildData(10000));
  }

  add(): void {
    this.data.set([...this.data.get(), ...buildData(1000)]);
  }

  /** Writes 100 label signals; the list itself never changes. */
  update(): void {
    batch(() => {
      const rows = this.data.get();
      for (let i = 0; i < rows.length; i += 10) {
        const label = rows[i]!.label;
        label.set(`${label.get()} !!!`);
      }
    });
  }

  clear(): void {
    this.data.set([]);
  }

  swapRows(): void {
    const list = this.data.get().slice();
    if (list.length > 998) {
      const item = list[1]!;
      list[1] = list[998]!;
      list[998] = item;
      this.data.set(list);
    }
  }

  select(id: number): void {
    this.selected.set(id);
  }

  remove(id: number): void {
    const rows = this.data.get();
    const index = rows.findIndex((row) => row.id === id);
    this.data.set(rows.toSpliced(index, 1));
  }
}

mount(Benchmark, '#main');
