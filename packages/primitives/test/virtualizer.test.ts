import { describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';

describe('probe', () => {
  it('environment', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const host = document.querySelector('#app') as HTMLElement;

    const el = document.createElement('div');
    host.appendChild(el);
    Object.defineProperty(el, 'clientHeight', { value: 321, configurable: true });
    console.log('clientHeight override', el.clientHeight);
    console.log('checkVisibility', el.checkVisibility(), typeof el.checkVisibility);

    el.scrollTop = 40;
    console.log('scrollTop', el.scrollTop);
    el.scrollTo({ top: 90 });
    console.log('after scrollTo', el.scrollTop, el.scrollLeft);
    el.scrollTo({ left: -30 });
    console.log('after negative left', el.scrollLeft);

    console.log('defaultView === globalThis', document.defaultView === (globalThis as unknown));
    console.log('typeof window.ResizeObserver', typeof window.ResizeObserver);
    class Fake {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Fake;
    console.log('view RO is fake', document.defaultView?.ResizeObserver === (Fake as unknown));

    let scrolls = 0;
    el.addEventListener('scroll', () => scrolls++);
    el.scrollTop = 100;
    console.log('scroll events from assignment', scrolls);

    console.log('style transform support');
    el.style.setProperty('transform', 'translateY(10px)');
    console.log('transform', el.style.transform, el.getAttribute('style'));
  });

  it('effect ordering with :for', () => {
    document.body.innerHTML = '<div id="app2"></div>';
    const host = document.querySelector('#app2') as HTMLElement;

    const seen: number[] = [];

    @Component({
      selector: 'v-probe',
      render: compileTemplate(
        `<div :ref="box"><span :for="n in items.get()" :key="n" data-index="{ n }">{ n }</span></div>`,
      ),
    })
    class Probe {
      box = new Signal.State<Element | null>(null);
      items = new Signal.State<number[]>([1, 2]);
      constructor() {
        // deferred user effect: should observe the settled DOM
        queueMicrotask(() => {});
      }
    }

    const handle = mount(Probe, host);
    const instance = handle.instance as Probe;
    flushSync();
    console.log('html', host.innerHTML);
    instance.items.set([1, 2, 3]);
    flushSync();
    console.log('html2', host.innerHTML);
    seen.push(1);
    expect(seen.length).toBe(1);
    handle.unmount();
  });
});
