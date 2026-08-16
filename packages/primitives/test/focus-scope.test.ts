/**
 * Focus scope.
 *
 * A modal that does not trap focus is not modal for keyboard users, and one
 * that does not restore focus drops them at the top of the document with no
 * way back. Both are invisible to anyone testing with a mouse, so they are
 * tested here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, flushSync } from '@voltdev/core';
import { createFocusScope, focusableWithin } from '@voltdev/primitives';

let disposers: (() => void)[] = [];

function scope(el: Element, options: Parameters<typeof createFocusScope>[1] = {}) {
  createRoot((dispose) => {
    disposers.push(dispose);
    createFocusScope(() => el, options);
  });
}

beforeEach(() => {
  document.body.innerHTML = `
    <button id="opener">open</button>
    <div id="page"><button id="page-btn">page</button></div>
    <div id="layer">
      <button id="first">first</button>
      <input id="middle" />
      <button id="last">last</button>
    </div>
    <div id="empty"></div>`;
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
});

const el = (id: string) => document.querySelector(`#${id}`) as HTMLElement;

describe('collecting focusable elements', () => {
  it('finds them in tab order', () => {
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first', 'middle', 'last']);
  });

  it('skips disabled and hidden elements', () => {
    el('middle').setAttribute('disabled', '');
    el('last').setAttribute('hidden', '');
    expect(focusableWithin(el('layer')).map((n) => n.id)).toEqual(['first']);
  });
});

describe('entering', () => {
  it('focuses the first focusable element', () => {
    el('opener').focus();
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));
  });

  it('honours an explicit initial target', () => {
    scope(el('layer'), { initialFocus: () => el('middle') });
    expect(document.activeElement).toBe(el('middle'));
  });

  it('can be told not to take focus', () => {
    el('opener').focus();
    scope(el('layer'), { autoFocus: false });
    expect(document.activeElement).toBe(el('opener'));
  });

  it('focuses the container when nothing inside can take focus', () => {
    scope(el('empty'));
    // Otherwise focus stays in the page behind, which is the bug this avoids.
    expect(document.activeElement).toBe(el('empty'));
    expect(el('empty').getAttribute('tabindex')).toBe('-1');
  });
});

describe('trapping', () => {
  it('pulls focus back when it escapes to the page', () => {
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));

    // However focus got out — Tab, a click, or script — it comes back.
    el('page-btn').focus();
    expect(document.activeElement).toBe(el('first'));
  });

  it('leaves focus alone while it stays inside', () => {
    scope(el('layer'));
    el('last').focus();
    expect(document.activeElement).toBe(el('last'));
  });

  it('stops trapping once disposed', () => {
    scope(el('layer'));
    for (const dispose of disposers) dispose();
    disposers = [];

    el('page-btn').focus();
    expect(document.activeElement).toBe(el('page-btn'));
  });
});

describe('restoring', () => {
  it('returns focus to whatever had it before', () => {
    el('opener').focus();
    scope(el('layer'));
    expect(document.activeElement).toBe(el('first'));

    for (const dispose of disposers) dispose();
    disposers = [];
    expect(document.activeElement).toBe(el('opener'));
  });

  it('can be told not to restore', () => {
    el('opener').focus();
    scope(el('layer'), { restoreFocus: false });
    for (const dispose of disposers) dispose();
    disposers = [];

    expect(document.activeElement).not.toBe(el('opener'));
  });

  it('does not restore to an element that has left the document', () => {
    el('opener').focus();
    scope(el('layer'));
    el('opener').remove();

    // Must not throw, and must not try to focus a detached node.
    expect(() => {
      for (const dispose of disposers) dispose();
      disposers = [];
    }).not.toThrow();
  });
});

describe('recovering from an escape cannot recurse', () => {
  it('survives a container with nothing focusable inside', () => {
    // Moving focus fires blur on the old holder and focusin on the new one, so
    // a trap that recovers inside its own focusin handler can bounce between
    // them until the stack runs out. A review probe found exactly that.
    scope(el('empty'));

    expect(() => {
      el('page-btn').focus();
      el('page-btn').focus();
    }).not.toThrow();
  });

  it('survives an element that refuses focus', () => {
    const stubborn = el('layer');
    // An element whose focus() does nothing is indistinguishable from one the
    // browser declined to focus, which is the real-world version of this.
    const original = HTMLElement.prototype.focus;
    let calls = 0;
    HTMLElement.prototype.focus = function patched(this: HTMLElement) {
      calls += 1;
      if (calls > 500) throw new Error('runaway focus recovery');
    };

    try {
      scope(stubborn);
      expect(() => el('page-btn').dispatchEvent(new Event('focusin', { bubbles: true })))
        .not.toThrow();
    } finally {
      HTMLElement.prototype.focus = original;
    }
  });
});
