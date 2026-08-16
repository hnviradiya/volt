/**
 * Dialog, driven through a real mounted component.
 *
 * The behaviour worth asserting is the accessibility: what a screen reader is
 * told, where focus goes and comes back to, and that the page behind is really
 * inert rather than merely covered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createDialog } from '@voltdev/primitives';

let host: HTMLElement;
/**
 * Mounted components, unmounted after each test.
 *
 * Scroll locking is counted across every open dialog on the page, so a test
 * that leaves one mounted holds the lock for the next one — the same way an
 * application that never unmounts would.
 */
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

@Component({
  selector: 'v-confirm',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="dialog.triggerProps()" :click="dialog.toggle()">open</button>
      <div :if="dialog.isPresent()" :portal :ref="content" :spread="dialog.contentProps()">
        <h2 :spread="dialog.titleProps()">Title</h2>
        <p :spread="dialog.descriptionProps()">Description</p>
        <button class="ok" :click="dialog.close()">ok</button>
      </div>
    </div>
  `),
})
class Confirm {
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  dialog = createDialog({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
  });
}

function setup() {
  const handle = track(mount(Confirm, host));
  const instance = handle.instance as Confirm;
  return {
    handle,
    instance,
    trigger: () => host.querySelector('button')!,
    content: () => document.querySelector('[role="dialog"]'),
  };
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('opening and closing', () => {
  it('starts closed with nothing rendered', () => {
    const { content } = setup();
    expect(content()).toBeNull();
  });

  it('opens from the trigger and renders outside the component', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    expect(content()).not.toBeNull();
    // Portalled, so it escapes any ancestor's overflow and stacking context.
    expect(host.contains(content())).toBe(false);
  });

  it('closes on Escape', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    escape();
    flushSync();
    expect(content()).toBeNull();
  });

  it('closes on a press outside', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    const behind = document.querySelector('#behind')!;
    behind.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    behind.dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();
    expect(content()).toBeNull();
  });

  it('does not close when the press is on the trigger', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    // Otherwise dismissal would close it and the trigger would reopen it.
    trigger().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    trigger().dispatchEvent(new Event('pointerup', { bubbles: true }));
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('reports changes through onOpenChange', () => {
    const onOpenChange = vi.fn();

    @Component({
      selector: 'v-cb',
      render: compileTemplate(
        `<div><button :click="dialog.open()">go</button>` +
          `<div :if="dialog.isPresent()" :ref="content" :spread="dialog.contentProps()">x</div></div>`,
      ),
    })
    class WithCallback {
      content = new Signal.State<Element | null>(null);
      dialog = createDialog({ content: () => this.content.get(), onOpenChange });
    }

    const handle = track(mount(WithCallback, host));
    host.querySelector('button')!.click();
    flushSync();
    expect(onOpenChange).toHaveBeenCalledWith(true);

    (handle.instance as WithCallback).dialog.close();
    flushSync();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

describe('what assistive technology is told', () => {
  it('labels the trigger and links it to the content', () => {
    const { trigger, content } = setup();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    trigger().click();
    flushSync();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(content()!.id);
  });

  it('marks the content as a modal dialog, labelled and described', () => {
    const { trigger, content } = setup();
    trigger().click();
    flushSync();

    const el = content()!;
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h2')!.id);
    expect(el.getAttribute('aria-describedby')).toBe(el.querySelector('p')!.id);
  });

  it('omits the label reference when no title was rendered', () => {
    @Component({
      selector: 'v-bare',
      render: compileTemplate(
        `<div><button :click="dialog.open()">go</button>` +
          `<div :if="dialog.isPresent()" :ref="content" :spread="dialog.contentProps()">no title</div></div>`,
      ),
    })
    class Bare {
      content = new Signal.State<Element | null>(null);
      dialog = createDialog({ content: () => this.content.get() });
    }

    track(mount(Bare, host));
    host.querySelector('button')!.click();
    flushSync();

    // A dangling aria-labelledby is worse than none: both announce an
    // unlabelled dialog, but the dangling one hides the mistake.
    const el = document.querySelector('[role="dialog"]')!;
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('hides the rest of the page from screen readers while open', () => {
    const { trigger } = setup();
    const behind = document.querySelector('#behind')!;

    trigger().click();
    flushSync();
    // A focus trap does not bind a screen reader's own cursor; without this
    // the page behind can be read straight through the dialog.
    expect(behind.getAttribute('aria-hidden')).toBe('true');

    escape();
    flushSync();
    expect(behind.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('focus', () => {
  it('moves into the dialog on open and back to the trigger on close', () => {
    const { trigger, content } = setup();
    trigger().focus();

    trigger().click();
    flushSync();
    expect(content()!.contains(document.activeElement)).toBe(true);

    escape();
    flushSync();
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps focus inside while open', () => {
    const { trigger } = setup();
    trigger().click();
    flushSync();

    const behind = document.querySelector('#behind') as HTMLElement;
    behind.tabIndex = 0;
    behind.focus();

    expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });
});

describe('scroll locking', () => {
  it('locks the page while open and releases it after', () => {
    const { trigger } = setup();
    trigger().click();
    flushSync();
    expect(document.body.style.overflow).toBe('hidden');

    escape();
    flushSync();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
