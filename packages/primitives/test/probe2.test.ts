/** Scratch probes 2 — not part of the suite. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';
import { createToggle, createToggleGroup, type ToggleOptions } from '../src/toggle.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});
afterEach(() => {
  for (const h of mounted) h.unmount();
  mounted = [];
  flushSync();
});

function setupToggle(options: ToggleOptions = {}, tag = 'button') {
  @Component({
    selector: 'v-p2-toggle',
    render: compileTemplate(`<${tag} :spread="toggle.props()">B</${tag}>`),
  })
  class Host {
    toggle = createToggle(options);
  }
  const handle = mount(Host, host);
  mounted.push(handle);
  flushSync();
  return handle.instance as Host;
}

const el = () => host.firstElementChild!;
function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

describe('probes 2', () => {
  it('R1: held Space on a div toggle repeats activation', () => {
    setupToggle({}, 'div');
    (el() as HTMLElement).focus();
    // One physical press held down: browsers emit keydown with repeat=true.
    press(' ');
    press(' ', { repeat: true });
    press(' ', { repeat: true });
    press(' ', { repeat: true });
    console.log('R1 after 1 press held for 4 keydowns:', el().getAttribute('aria-pressed'));
  });

  it('R2: div toggle disabled — focusability', () => {
    setupToggle({ disabled: () => true }, 'div');
    console.log(
      'R2 div disabled: tabindex=',
      el().getAttribute('tabindex'),
      'aria-disabled=',
      el().getAttribute('aria-disabled'),
      'disabled attr=',
      el().hasAttribute('disabled'),
    );
  });

  it('R3: mute/unmute label with aria-pressed', () => {
    setupToggle({ label: (p) => (p ? 'Unmute' : 'Mute') });
    console.log('R3 off:', el().getAttribute('aria-label'), el().getAttribute('aria-pressed'));
    (el() as HTMLElement).click();
    flushSync();
    console.log('R3 on:', el().getAttribute('aria-label'), el().getAttribute('aria-pressed'));
  });

  it('R4: shift+arrow / shift+space', () => {
    setupToggle({}, 'div');
    (el() as HTMLElement).focus();
    press(' ', { shiftKey: true });
    console.log('R4 shift+space pressed:', el().getAttribute('aria-pressed'));
  });

  it('R5: toggle group construction outside a component scope warns?', () => {
    const g = new Signal.State<Element | null>(null);
    const inst = createToggleGroup({ group: () => g.get() });
    expect(inst).toBeTruthy();
    console.log('R5 constructed outside a scope OK');
  });
});
