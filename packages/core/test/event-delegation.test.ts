/**
 * Which events get a real listener, and why that is not a preference.
 *
 * Chrome registers a `wheel`, `touchstart` or `touchmove` listener on the
 * document as passive whatever the listener asked for, so `preventDefault()`
 * from inside one is discarded. Delegating those events therefore compiled
 * `:wheel.prevent` into a handler that could not prevent anything — silently,
 * since the only symptom is a console warning in a browser no test runs in.
 *
 * happy-dom does not enforce that rule, so this file installs it: a
 * document-level listener for one of those types runs with `preventDefault`
 * neutered, exactly as the browser leaves it. Delegate `wheel` again and the
 * first test below goes red rather than passing on a lie.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, mount } from '@voltdev/core';

/** The types a browser forces passive when the listener sits at the root. */
const FORCED_PASSIVE = new Set(['wheel', 'touchstart', 'touchmove']);

/** Every event type a listener has been registered for on the document. */
const documentTypes: string[] = [];

const addToDocument = document.addEventListener.bind(document);

function recordAndForcePassive(
  type: string,
  listener: EventListener,
  options?: boolean | AddEventListenerOptions,
): void {
  documentTypes.push(type);
  if (!FORCED_PASSIVE.has(type)) {
    addToDocument(type, listener, options);
    return;
  }
  addToDocument(
    type,
    (event: Event) => {
      Object.defineProperty(event, 'preventDefault', { configurable: true, value: () => {} });
      try {
        listener.call(document, event);
      } finally {
        Reflect.deleteProperty(event, 'preventDefault');
      }
    },
    options,
  );
}

// Installed for the file rather than per test: the runtime registers a type at
// the document only the first time it delegates one, so a patch installed in a
// hook would miss whichever test ran second.
document.addEventListener = recordAndForcePassive as typeof document.addEventListener;

let host: HTMLElement;

beforeEach(() => {
  documentTypes.length = 0;
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

describe('events that must not be delegated', () => {
  it('cancels a wheel, which a delegated listener could not', () => {
    const adjust = vi.fn();

    @Component({
      selector: 'v-wheelslider',
      render: compileTemplate(`<div :wheel.prevent="adjust()"></div>`),
    })
    class WheelSlider {
      adjust = adjust;
    }

    mount(WheelSlider, host);
    const event = new Event('wheel', { bubbles: true, cancelable: true });
    host.querySelector('div')!.dispatchEvent(event);

    expect(adjust).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // The passive rule covers the first three; the rest are here because an
  // ancestor walk per event is the wrong trade for one that fires all frame,
  // and because cancelling `dragover` is how a drop target declares itself.
  for (const name of [
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'mousemove',
    'mouseover',
    'mouseout',
    'pointermove',
    'pointerover',
    'pointerout',
    'dragover',
  ]) {
    it(`attaches :${name} to the element rather than the document`, () => {
      const seen = vi.fn();

      @Component({
        selector: `v-direct-${name}`,
        render: compileTemplate(`<div :${name}="seen()"></div>`),
      })
      class Direct {
        seen = seen;
      }

      mount(Direct, host);
      // Nothing that does not bubble ever reaches a document listener, so only
      // a listener on the element itself can see this one.
      host.querySelector('div')!.dispatchEvent(new Event(name, { bubbles: false }));

      expect(seen).toHaveBeenCalledTimes(1);
      expect(documentTypes).not.toContain(name);
    });
  }

  it('still delegates a click, so the absences above mean something', () => {
    @Component({
      selector: 'v-delegatedclick',
      render: compileTemplate(`<button :click="go()"></button>`),
    })
    class Delegated {
      go = vi.fn();
    }

    mount(Delegated, host);
    expect(documentTypes).toContain('click');
  });
});
