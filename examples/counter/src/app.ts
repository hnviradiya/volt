import { Component, Signal } from '@voltjs/core';
import { Counter } from './counter.js';
import { Todos } from './todos.js';

@Component({
  selector: 'v-app',
  imports: [Counter, Todos],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  step = new Signal.State(1);
  lastCount = new Signal.State(0);

  onCount(value: number): void {
    this.lastCount.set(value);
  }
}
