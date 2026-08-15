import { afterEach, beforeEach, describe, it } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';
import { createDialog } from '../src/dialog.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="behind">page</div>';
  host = document.querySelector('#app')!;
});
afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
});
function clickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

@Component({
  selector: 'v-s1',
  render: compileTemplate(`
    <div>
      <button id="a" :ref="t1" :click="d1.open()">one</button>
      <div :if="d1.isPresent()" :portal :ref="c1" :spread="d1.contentProps()">
        <button id="b" :ref="t2" :click="d2.open()">two</button>
      </div>
      <div :if="d2.isPresent()" :portal :ref="c2" :spread="d2.contentProps()">
        <button id="c">inner</button>
      </div>
    </div>
  `),
})
class S1 {
  t1 = new Signal.State<Element | null>(null);
  c1 = new Signal.State<Element | null>(null);
  t2 = new Signal.State<Element | null>(null);
  c2 = new Signal.State<Element | null>(null);
  d1 = createDialog({ trigger: () => this.t1.get(), content: () => this.c1.get() });
  d2 = createDialog({ trigger: () => this.t2.get(), content: () => this.c2.get() });
}

describe('probe: stacked dialogs', () => {
  it('counts focusin churn', () => {
    let n = 0;
    const count = () => {
      n += 1;
    };
    track(mount(S1, host));
    clickOn(document.querySelector('#a')!);
    document.addEventListener('focusin', count, true);
    clickOn(document.querySelector('#b')!);
    console.log('[stacked dialogs] focusins =', n, 'focus =', document.activeElement?.id || document.activeElement?.nodeName);
    document.removeEventListener('focusin', count, true);
  });
});
