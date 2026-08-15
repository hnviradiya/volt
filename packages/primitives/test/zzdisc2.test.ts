import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';
import {
  ACCORDION_TRIGGER_ATTRIBUTE,
  createAccordion,
  createCollapsible,
  type AccordionOptions,
} from '../src/disclosure.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  for (const h of mounted) h.unmount();
  mounted = [];
  flushSync();
});

function stubScrollHeight(px: number): void {
  const proto = Element.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => px });
  restores.push(() => {
    if (original) Object.defineProperty(proto, 'scrollHeight', original);
    else Reflect.deleteProperty(proto, 'scrollHeight');
  });
}

function fakeRO() {
  const disconnect = vi.fn();
  const observe = vi.fn();
  class FakeRO {
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
  }
  const view = window as unknown as { ResizeObserver?: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeRO;
  restores.push(() => {
    view.ResizeObserver = original;
  });
  return { observe, disconnect };
}

const ACCORDION_TEMPLATE = `
  <div :ref="root" :spread="a.rootProps()" :keydown="a.onTriggerKeyDown($event)">
    <div :for="item in items.get()" :key="item"
         class="item" :attr-data-item="item" :spread="a.itemProps(item)">
      <h3><button :spread="a.triggerProps(item)" :click="a.toggle(item)">{{ item }}</button></h3>
      <div :if="a.isPresent(item)" class="panel" :spread="a.contentProps(item)">x</div>
    </div>
  </div>
`;

function mountAccordion(options: Omit<AccordionOptions, 'container'> = {}, sel = 'v-s') {
  @Component({ selector: sel, render: compileTemplate(ACCORDION_TEMPLATE) })
  class Sections {
    root = new Signal.State<Element | null>(null);
    items = new Signal.State(['one', 'two', 'three']);
    a = createAccordion({ ...options, container: () => this.root.get() });
  }
  const handle = mount(Sections, host);
  mounted.push(handle);
  const instance = handle.instance as Sections;
  flushSync();
  const item = (v: string) => host.querySelector(`[data-item="${v}"]`)!;
  return {
    handle,
    accordion: instance.a,
    items: instance.items,
    item,
    trigger: (v: string) =>
      host.querySelector<HTMLElement>(`[${ACCORDION_TRIGGER_ATTRIBUTE}="${v}"]`)!,
    panel: (v: string) => item(v).querySelector('.panel'),
  };
}

describe('cleanup on unmount', () => {
  it('disconnects observers and drops presence listeners', () => {
    const { disconnect, observe } = fakeRO();
    stubScrollHeight(80);
    const { handle, trigger } = mountAccordion({ type: 'multiple' });

    trigger('one').click();
    trigger('two').click();
    flushSync();
    console.log('observe after opening two panels:', observe.mock.calls.length);

    handle.unmount();
    mounted = mounted.filter((h) => h !== handle);
    flushSync();
    console.log('disconnect after unmount:', disconnect.mock.calls.length);
    expect(disconnect.mock.calls.length).toBe(2);
  });

  it('collapsible: disconnects on unmount', () => {
    const { disconnect } = fakeRO();
    stubScrollHeight(80);
    @Component({
      selector: 'v-c2',
      render: compileTemplate(`
        <div>
          <button :spread="c.triggerProps()" :click="c.toggle()">x</button>
          <div :if="c.isPresent()" class="panel" :ref="content" :spread="c.contentProps()">b</div>
        </div>`),
    })
    class C {
      content = new Signal.State<Element | null>(null);
      c = createCollapsible({ defaultOpen: true, content: () => this.content.get() });
    }
    const handle = mount(C, host);
    flushSync();
    handle.unmount();
    flushSync();
    console.log('collapsible disconnect after unmount:', disconnect.mock.calls.length);
  });
});

describe('two accordions on a page', () => {
  it('keys in one do not move focus in the other', () => {
    const a = mountAccordion({}, 'v-a1');
    const b = mountAccordion({}, 'v-b1');
    const triggers = [...host.querySelectorAll<HTMLElement>(`[${ACCORDION_TRIGGER_ATTRIBUTE}]`)];
    console.log('total triggers:', triggers.length);
    triggers[0]!.focus();
    triggers[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    flushSync();
    const active = document.activeElement as HTMLElement;
    console.log('after End from first accordion:', triggers.indexOf(active));
    void a;
    void b;
  });
});

describe('accordion labels + region combinations', () => {
  it('per-value label replaces labelledby', () => {
    const { trigger, panel } = mountAccordion({
      labels: { content: (v) => (v === 'one' ? 'First section' : undefined) },
    });
    trigger('one').click();
    trigger('two').click();
    flushSync();
    console.log(
      'one:',
      panel('one')?.getAttribute('aria-label'),
      panel('one')?.getAttribute('aria-labelledby'),
    );
    console.log(
      'two:',
      panel('two')?.getAttribute('aria-label'),
      panel('two')?.getAttribute('aria-labelledby'),
    );
  });
});

describe('exit animation + aria', () => {
  it('what the trigger says while the panel animates out', () => {
    const view = window;
    const original = view.getComputedStyle.bind(view);
    const { trigger, panel } = mountAccordion({ collapsible: true });
    trigger('one').click();
    flushSync();
    const el = panel('one')!;
    view.getComputedStyle = ((node: Element, p?: string | null) =>
      node === el
        ? ({
            animationName: 'collapse',
            animationDuration: '0.15s',
            transitionDuration: '0s',
            transitionProperty: 'none',
          } as unknown as CSSStyleDeclaration)
        : original(node, p ?? undefined)) as typeof view.getComputedStyle;
    restores.push(() => {
      view.getComputedStyle = original;
    });

    trigger('one').click();
    flushSync();
    console.log(
      'during exit -> expanded:',
      trigger('one').getAttribute('aria-expanded'),
      'controls:',
      trigger('one').getAttribute('aria-controls'),
      'panel id:',
      panel('one')?.id,
      'panel in doc:',
      document.getElementById(trigger('one').getAttribute('aria-controls') ?? '') !== null,
    );
  });
});

describe('accordion imperative API before render', () => {
  it('open() on a value whose panel has never been asked about', () => {
    const { accordion, panel } = mountAccordion();
    accordion.open('three');
    flushSync();
    console.log('three open?', panel('three') !== null);
    console.log('value:', accordion.value());
  });
});
