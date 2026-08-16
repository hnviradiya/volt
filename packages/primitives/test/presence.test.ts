/**
 * Presence, driven through a real mounted component.
 *
 * happy-dom does not run animations, so `getComputedStyle` reports no
 * animation for every element here. That is exactly the "nothing is
 * animating" path, which is the one that has to be synchronous — an
 * unanimated library must not pay a frame of latency to close a menu. The
 * animated path is exercised by declaring the styles and dispatching the end
 * event, which is what a browser would do.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@volt/core/jit';
import { Component, Signal, flushSync, mount } from '@volt/core';
import { createPresence } from '@volt/primitives';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

@Component({
  selector: 'v-overlay',
  render: compileTemplate(
    `<div><p :if="presence.isPresent()" :ref="content" :attr-data-state="presence.state()">body</p></div>`,
  ),
})
class Overlay {
  open = new Signal.State(false);
  content = new Signal.State<Element | null>(null);
  presence = createPresence(
    () => this.open.get(),
    () => this.content.get(),
  );
}

function setup() {
  const handle = mount(Overlay, host);
  const instance = handle.instance as Overlay;
  return { handle, instance, panel: () => host.querySelector('p') };
}

describe('without an animation', () => {
  it('starts absent when closed', () => {
    const { panel } = setup();
    expect(panel()).toBeNull();
  });

  it('appears immediately on open, marked open', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute('data-state')).toBe('open');
  });

  it('leaves immediately on close, since nothing is animating', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    instance.open.set(false);
    flushSync();
    // No waiting for a frame or a timer that would never fire.
    expect(panel()).toBeNull();
  });

  it('survives repeated open and close', () => {
    const { instance, panel } = setup();
    for (let i = 0; i < 3; i++) {
      instance.open.set(true);
      flushSync();
      expect(panel()).not.toBeNull();
      instance.open.set(false);
      flushSync();
      expect(panel()).toBeNull();
    }
  });
});

describe('with an exit animation', () => {
  /** Report a running animation, the way a browser would mid-transition. */
  function pretendAnimating(el: Element) {
    const view = el.ownerDocument!.defaultView!;
    const original = view.getComputedStyle.bind(view);
    view.getComputedStyle = ((node: Element, pseudo?: string | null) => {
      if (node === el) {
        return {
          animationName: 'fade-out',
          animationDuration: '0.15s',
          transitionDuration: '0s',
          transitionProperty: 'none',
        } as unknown as CSSStyleDeclaration;
      }
      return original(node, pseudo ?? undefined);
    }) as typeof view.getComputedStyle;
    return () => {
      view.getComputedStyle = original;
    };
  }

  it('stays mounted until the animation ends', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    const el = panel()!;
    const restore = pretendAnimating(el);

    instance.open.set(false);
    flushSync();

    // Still in the DOM, and marked closed so CSS can animate it out.
    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute('data-state')).toBe('closed');

    el.dispatchEvent(new Event('animationend'));
    flushSync();
    expect(panel()).toBeNull();

    restore();
  });

  it('ignores an animation ending on a descendant', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    const el = panel()!;
    const child = document.createElement('span');
    el.appendChild(child);
    const restore = pretendAnimating(el);

    instance.open.set(false);
    flushSync();

    // A child finishing its own animation must not tear down the parent.
    child.dispatchEvent(new Event('animationend', { bubbles: true }));
    flushSync();
    expect(panel()).not.toBeNull();

    el.dispatchEvent(new Event('animationend'));
    flushSync();
    expect(panel()).toBeNull();

    restore();
  });

  it('cancels the exit when reopened mid-animation', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    const el = panel()!;
    const restore = pretendAnimating(el);

    instance.open.set(false);
    flushSync();
    expect(panel()!.getAttribute('data-state')).toBe('closed');

    instance.open.set(true);
    flushSync();
    expect(panel()!.getAttribute('data-state')).toBe('open');

    // The superseded exit must not release the content it no longer owns.
    el.dispatchEvent(new Event('animationend'));
    flushSync();
    expect(panel()).not.toBeNull();

    restore();
  });

  it('releases on animationcancel too', () => {
    const { instance, panel } = setup();
    instance.open.set(true);
    flushSync();

    const el = panel()!;
    const restore = pretendAnimating(el);

    instance.open.set(false);
    flushSync();
    expect(panel()).not.toBeNull();

    el.dispatchEvent(new Event('animationcancel'));
    flushSync();
    expect(panel()).toBeNull();

    restore();
  });
});
