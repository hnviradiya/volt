/**
 * The package as a consumer imports it.
 *
 * One test that uses nothing but the public entry, doing what a component test
 * is for: mount, find by role, drive it, wait for a timer, assert, unmount,
 * check nothing was left running. If the barrel stops exporting something this
 * stops compiling, which is the cheapest possible guard on the surface staying
 * whole.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Signal, onCleanup } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import {
  cleanup,
  click,
  getByRole,
  getRole,
  installClock,
  isAccessibilityHidden,
  liveEffectCount,
  normalizeText,
  press,
  render,
  settle,
  typeText,
} from '@voltdev/testing';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** A toast: shown by a press, gone once its own timeout has run. */
@Component({
  selector: 'v-toaster',
  render: compileTemplate(`
    <div>
      <button :click="show()">Save</button>
      <p :if="visible.get()" role="status">Saved</p>
    </div>
  `),
})
class Toaster {
  visible = new Signal.State(false);
  timer: ReturnType<typeof setTimeout> | null = null;

  show(): void {
    this.visible.set(true);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.visible.set(false), 3_000);
    // Registered on the component's own scope, so unmounting mid-toast cannot
    // leave a timer pointing at a signal nothing renders.
    onCleanup(() => {
      if (this.timer !== null) clearTimeout(this.timer);
    });
  }
}

describe('a component test, end to end', () => {
  it('mounts, interacts, waits, asserts and unmounts clean', async () => {
    const clock = installClock({ now: 0 });
    const view = render(Toaster);

    expect(view.queryByRole('status')).toBeNull();

    click(view.getByRole('button', { name: 'Save' }));
    expect(view.getByRole('status').textContent).toBe('Saved');

    await clock.advance(2_999);
    expect(view.queryByRole('status')).not.toBeNull();

    await clock.advance(1);
    expect(view.queryByRole('status')).toBeNull();

    view.unmount();
    expect(view.leakedEffects()).toBe(0);
    expect(clock.pending()).toBe(0);
    clock.uninstall();
  });

  it('exports the pieces those helpers are built from', async () => {
    const before = liveEffectCount();
    const view = render(Toaster);

    press(view.getByRole('button', { name: 'Save' }), 'Enter');
    await settle();
    expect(view.getByRole('status').textContent).toBe('Saved');

    expect(getRole(view.getByRole('button', { name: 'Save' }))).toBe('button');
    expect(normalizeText('  Saved\n ')).toBe('Saved');
    expect(isAccessibilityHidden(view.getByRole('status'))).toBe(false);
    expect(getByRole(view.container, 'status').textContent).toBe('Saved');

    view.unmount();
    expect(liveEffectCount()).toBe(before);
  });

  it('reports a missing control by what the page does contain', () => {
    const view = render(Toaster);
    expect(() => view.getByRole('button', { name: 'Delete' })).toThrow(/button\s+"Save"/);
  });

  it('types into a field found by its label', () => {
    @Component({
      selector: 'v-named-field',
      render: compileTemplate(`
        <div>
          <label for="q">Search</label>
          <input id="q" :value="text.get()" :input="text.set($event.target.value)">
        </div>
      `),
    })
    class NamedField {
      text = new Signal.State('');
    }

    const view = render(NamedField);
    typeText(view.getByRole('textbox', { name: 'Search' }), 'volt');

    expect(view.instance.text.get()).toBe('volt');
  });
});
