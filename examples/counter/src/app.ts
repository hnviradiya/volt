import { Component, Signal } from '@voltjs/core';
import { Counter } from './counter.js';
import { Todos } from './todos.js';

@Component({
  selector: 'v-app',
  imports: [Counter, Todos],
  template: `
    <main class="app">
      <header>
        <h1>Volt</h1>
        <p class="tagline">
          Angular-shaped classes, Vue-shaped templates, TC39 signals, no virtual DOM.
        </p>
      </header>

      <div class="grid">
        <article class="card">
          <v-counter
            :label="'Steps of ' + step.get()"
            :step="step.get()"
            :min="-10"
            :on-changed="onCount($event)"
          ></v-counter>

          <div class="row">
            <label for="step">Step size</label>
            <input id="step" type="range" min="1" max="10" :model.number="step" />
            <span class="value">{{ step.get() }}</span>
          </div>

          <p class="log">Last value seen by the parent: <strong>{{ lastCount.get() }}</strong></p>
        </article>

        <article class="card">
          <v-todos></v-todos>
        </article>
      </div>
    </main>
  `,
  styles: `
    .app { max-width: 62rem; margin: 0 auto; padding: 3rem 1.5rem; display: grid; gap: 2rem; }
    .app h1 { margin: 0; font-size: 2.5rem; letter-spacing: -0.02em; }
    .app .tagline { margin: 0.35rem 0 0; color: var(--muted); }
    .app .grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); }
    .app .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 1.5rem; display: grid; gap: 1.25rem; align-content: start; }
    .app .row { display: flex; align-items: center; gap: 0.75rem; }
    .app .log { margin: 0; color: var(--muted); font-size: 0.9rem; }
  `,
})
export class App {
  step = new Signal.State(1);
  lastCount = new Signal.State(0);

  onCount(value: number): void {
    this.lastCount.set(value);
  }
}
