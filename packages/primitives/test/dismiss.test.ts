/**
 * Dismissal.
 *
 * The cases worth testing are the ones libraries get wrong: a drag that starts
 * inside and releases outside, Escape reaching only the topmost layer, and a
 * nested layer counting as inside its parent even though portalling has made
 * it a DOM sibling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, flushSync } from '@voltjs/core';
import { createDismiss, dismissStackSize } from '@voltjs/primitives';

let disposers: (() => void)[] = [];

/** Register a layer around `el`, returning the spy it dismisses through. */
function layer(el: Element, options: Parameters<typeof createDismiss>[2] = {}) {
  const onDismiss = vi.fn();
  createRoot((dispose) => {
    disposers.push(dispose);
    createDismiss(() => el, onDismiss, options);
  });
  return onDismiss;
}

function press(target: Element | Document, type: 'pointerdown' | 'pointerup') {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

/** A full press: down and up on the same element. */
function click(target: Element) {
  press(target, 'pointerdown');
  press(target, 'pointerup');
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="outside">outside</div>
    <div id="a"><button id="a-btn">a</button></div>
    <div id="b"><button id="b-btn">b</button></div>`;
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
});

const el = (id: string) => document.querySelector(`#${id}`)!;

describe('escape', () => {
  it('dismisses the layer', () => {
    const onDismiss = layer(el('a'));
    escape();
    expect(onDismiss).toHaveBeenCalledWith('escape');
  });

  it('reaches only the topmost layer', () => {
    const outer = layer(el('a'));
    const inner = layer(el('b'));

    escape();
    // One keypress closes one layer.
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('falls to the layer below once the top one goes', () => {
    const outer = layer(el('a'));
    let innerDispose!: () => void;
    const inner = vi.fn();
    createRoot((dispose) => {
      innerDispose = dispose;
      createDismiss(() => el('b'), inner);
    });

    escape();
    expect(inner).toHaveBeenCalledTimes(1);

    innerDispose();
    escape();
    expect(outer).toHaveBeenCalledWith('escape');
  });

  it('can be turned off for a layer', () => {
    const onDismiss = layer(el('a'), { escape: false });
    escape();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('pointer outside', () => {
  it('dismisses on a press that starts and ends outside', () => {
    const onDismiss = layer(el('a'));
    click(el('outside'));
    expect(onDismiss).toHaveBeenCalledWith('outside-pointer');
  });

  it('ignores a press inside', () => {
    const onDismiss = layer(el('a'));
    click(el('a-btn'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a drag that starts inside and releases outside', () => {
    const onDismiss = layer(el('a'));
    // Selecting text in a dialog and releasing past its edge must not close it.
    press(el('a-btn'), 'pointerdown');
    press(el('outside'), 'pointerup');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a drag that starts outside and releases inside', () => {
    const onDismiss = layer(el('a'));
    press(el('outside'), 'pointerdown');
    press(el('a-btn'), 'pointerup');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('treats a nested layer as inside its parent', () => {
    const outer = layer(el('a'));
    const inner = layer(el('b'));

    // `b` is a DOM sibling of `a` — as a portalled popover would be — but it
    // is stacked above it, so pressing in it is not outside `a`.
    click(el('b-btn'));
    expect(outer).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it('counts declared exclusions as inside', () => {
    const onDismiss = layer(el('a'), { exclude: () => [el('outside')] });
    click(el('outside'));
    // A trigger button must not dismiss the layer it opened and then reopen it.
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('can be turned off for a layer', () => {
    const onDismiss = layer(el('a'), { outsidePointer: false });
    click(el('outside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('registration', () => {
  it('leaves the stack empty once every layer is disposed', () => {
    layer(el('a'));
    layer(el('b'));
    expect(dismissStackSize()).toBe(2);

    for (const dispose of disposers) dispose();
    disposers = [];
    expect(dismissStackSize()).toBe(0);
  });

  it('stops responding after disposal', () => {
    const onDismiss = layer(el('a'));
    for (const dispose of disposers) dispose();
    disposers = [];

    escape();
    click(el('outside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
