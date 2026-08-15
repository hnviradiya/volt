/**
 * Menu, driven through real mounted components.
 *
 * A menu is almost entirely keyboard and ARIA, so that is what is asserted:
 * which item focus lands on for each way of opening, what navigation skips,
 * what a screen reader is told about each item, and which keys must be
 * prevented — the ones that would otherwise scroll the page or fire a second
 * activation on their way back up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';
import { createMenu } from '../src/menu.ts';

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

/**
 * A dropdown menu with the awkward cases in it: a disabled item between two
 * enabled ones, a separator, a checkbox item that keeps the menu open, and an
 * item whose text lives in a child element.
 */
@Component({
  selector: 'v-actions',
  render: compileTemplate(`
    <div>
      <button :ref="trigger" :spread="menu.triggerProps()"
              :click="menu.toggle()"
              :keydown="menu.onTriggerKeyDown($event)">Actions</button>
      <div :if="menu.isPresent()" :portal :ref="content"
           :spread="menu.contentProps()"
           :keydown="menu.onContentKeyDown($event)"
           :click="menu.onItemClick($event)"
           :pointermove="menu.onItemPointerMove($event)">
        <button :spread="menu.itemProps({ value: 'save' })">Save</button>
        <button :spread="menu.itemProps({ value: 'send', disabled: true })">Send</button>
        <div :spread="menu.separatorProps()"></div>
        <button :spread="menu.itemProps({ value: 'share' })">Share</button>
        <button :spread="menu.itemProps({ value: 'sync', role: 'menuitemcheckbox', checked: true, closeOnSelect: false })">Sync</button>
        <button :spread="menu.itemProps({ value: 'delete' })"><span class="text">Delete</span></button>
      </div>
    </div>
  `),
})
class Actions {
  chosen: (string | undefined)[] = [];
  trigger = new Signal.State<Element | null>(null);
  content = new Signal.State<Element | null>(null);
  menu = createMenu({
    trigger: () => this.trigger.get(),
    content: () => this.content.get(),
    onSelect: (_item, value) => {
      this.chosen.push(value);
    },
  });
}

function setup() {
  const handle = track(mount(Actions, host));
  const instance = handle.instance as Actions;
  return {
    instance,
    menu: instance.menu,
    trigger: () => host.querySelector('button')!,
    content: () => document.querySelector('[role="menu"]'),
    items: () => [...document.querySelectorAll<HTMLElement>('[data-volt-item]')],
    item: (value: string) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
  };
}

/** Open by pointer, which is the case that highlights no item. */
function openByClick(trigger: Element) {
  clickOn(trigger);
}

function press(key: string, target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

/** Whatever holds focus now — the menu's whole navigation model is real focus. */
function focused(): Element | null {
  return document.activeElement;
}

function clickOn(el: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  flushSync();
  return event;
}

function pointerOver(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  flushSync();
}

function pressOutside(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup', { bubbles: true }));
  flushSync();
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
}

describe('opening from a trigger', () => {
  it('starts closed with nothing rendered', () => {
    const { content } = setup();
    expect(content()).toBeNull();
  });

  it('opens on click with no item highlighted', () => {
    const { trigger, content } = setup();
    openByClick(trigger());

    expect(content()).not.toBeNull();
    // A pointer opened it, so highlighting the first item would claim a choice
    // the user has not made. The menu itself holds focus instead.
    expect(focused()).toBe(content());
  });

  it('opens on ArrowDown with the first item focused', () => {
    const { trigger, item } = setup();
    press('ArrowDown', trigger());
    expect(focused()).toBe(item('save'));
  });

  it('opens on ArrowUp with the last item focused', () => {
    const { trigger, item } = setup();
    press('ArrowUp', trigger());
    expect(focused()).toBe(item('delete'));
  });

  it('opens on Enter and Space, and prevents the click they would fire', () => {
    const first = setup();
    const enter = press('Enter', first.trigger());
    expect(focused()).toBe(first.item('save'));
    // A button turns Enter and Space into a click. Unprevented, that click
    // reaches the trigger's own handler and toggles the menu straight shut.
    expect(enter.defaultPrevented).toBe(true);

    document.body.innerHTML = '<div id="app"></div>';
    host = document.querySelector('#app')!;
    const second = setup();
    const space = press(' ', second.trigger());
    expect(focused()).toBe(second.item('save'));
    expect(space.defaultPrevented).toBe(true);
  });

  it('continues from the item it opened on rather than re-focusing it', () => {
    const { trigger, content, item } = setup();
    press('ArrowDown', trigger());

    press('ArrowDown', content()!);
    // The item focused on open must also be the item the arrows move from,
    // or the first press after opening goes nowhere.
    expect(focused()).toBe(item('share'));
  });

  it('ignores a modified key on the trigger', () => {
    const { trigger, content } = setup();
    // Ctrl+Down is a shortcut somewhere else, not a request to open a menu.
    press('ArrowDown', trigger(), { ctrlKey: true });
    expect(content()).toBeNull();
  });

  it('closes again when the trigger is clicked a second time', () => {
    const { trigger, content } = setup();
    openByClick(trigger());
    openByClick(trigger());
    expect(content()).toBeNull();
  });
});

describe('what assistive technology is told', () => {
  it('marks the trigger as owning a menu and links it while open', () => {
    const { trigger, content } = setup();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().hasAttribute('aria-controls')).toBe(false);

    openByClick(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(content()!.id);
  });

  it('names the menu after the trigger that opened it', () => {
    const { trigger, content } = setup();
    openByClick(trigger());

    expect(content()!.getAttribute('role')).toBe('menu');
    expect(content()!.getAttribute('aria-labelledby')).toBe(trigger().id);
    expect(content()!.hasAttribute('aria-label')).toBe(false);
    // Vertical is ARIA's default for a menu; saying so again is noise.
    expect(content()!.hasAttribute('aria-orientation')).toBe(false);
    expect(content()!.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to a label when the trigger props were never spread', () => {
    @Component({
      selector: 'v-unspread',
      render: compileTemplate(
        `<div><button :ref="trigger" :click="menu.open()">go</button>` +
          `<div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()">x</div></div>`,
      ),
    })
    class Unspread {
      trigger = new Signal.State<Element | null>(null);
      content = new Signal.State<Element | null>(null);
      menu = createMenu({
        trigger: () => this.trigger.get(),
        content: () => this.content.get(),
      });
    }

    track(mount(Unspread, host));
    clickOn(host.querySelector('button')!);

    // The trigger carries no id, so pointing at it would name the menu after
    // nothing at all — worse than an honest label, because it hides the fault.
    const el = document.querySelector('[role="menu"]')!;
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Menu');
  });

  it('takes the menu label from the options, for translation', () => {
    @Component({
      selector: 'v-localised',
      render: compileTemplate(
        `<div><button :click="menu.open()">go</button>` +
          `<div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()">x</div></div>`,
      ),
    })
    class Localised {
      content = new Signal.State<Element | null>(null);
      menu = createMenu({
        content: () => this.content.get(),
        labels: { menu: 'Actions de la ligne' },
      });
    }

    track(mount(Localised, host));
    clickOn(host.querySelector('button')!);
    expect(document.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe(
      'Actions de la ligne',
    );
  });

  it('gives every item a role, and a state to the checkable ones', () => {
    const { trigger, item } = setup();
    openByClick(trigger());

    expect(item('save').getAttribute('role')).toBe('menuitem');
    // A plain item with aria-checked would be announced as a checkbox.
    expect(item('save').hasAttribute('aria-checked')).toBe(false);
    expect(item('sync').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('sync').getAttribute('aria-checked')).toBe('true');
  });

  it('defaults a checkable item to unchecked rather than stateless', () => {
    @Component({
      selector: 'v-radio-menu',
      render: compileTemplate(
        `<div><button :click="menu.open()">go</button>` +
          `<div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()">` +
          `<button :spread="menu.itemProps({ value: 'asc', role: 'menuitemradio' })">Ascending</button>` +
          `</div></div>`,
      ),
    })
    class RadioMenu {
      content = new Signal.State<Element | null>(null);
      menu = createMenu({ content: () => this.content.get() });
    }

    track(mount(RadioMenu, host));
    clickOn(host.querySelector('button')!);
    // Without aria-checked a menuitemradio is announced as an ordinary item.
    expect(document.querySelector('[data-value="asc"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('keeps a disabled item in the accessibility tree', () => {
    const { trigger, item } = setup();
    openByClick(trigger());

    const send = item('send');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    // `disabled` would remove it from the tree entirely, so a screen-reader
    // user could not find out that the action exists but is unavailable.
    expect(send.hasAttribute('disabled')).toBe(false);
    // The data- twin is what navigation skips by.
    expect(send.hasAttribute('data-disabled')).toBe(true);
  });

  it('marks the separator as one, and keeps it out of the collection', () => {
    const { trigger, content, items } = setup();
    openByClick(trigger());

    const separator = content()!.querySelector('[role="separator"]')!;
    expect(separator).not.toBeNull();
    // Navigation must never be able to land on it.
    expect(separator.hasAttribute('data-volt-item')).toBe(false);
    expect(items()).toHaveLength(5);
    // Horizontal is the ARIA default for a separator, and correct in a
    // vertical menu, so nothing is emitted.
    expect(separator.hasAttribute('aria-orientation')).toBe(false);
  });

  it('keeps every item out of the tab order', () => {
    const { trigger, items } = setup();
    openByClick(trigger());
    // Tab closes the menu rather than walking it, so there is no tab stop to
    // rove: one press leaves, whatever the menu's length.
    expect(items().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1', '-1']);
  });

  it('says so when the menu is horizontal', () => {
    @Component({
      selector: 'v-horizontal',
      render: compileTemplate(
        `<div><button :click="menu.open()">go</button>` +
          `<div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()">` +
          `<div class="rule" :spread="menu.separatorProps()"></div></div></div>`,
      ),
    })
    class Horizontal {
      content = new Signal.State<Element | null>(null);
      menu = createMenu({ content: () => this.content.get(), orientation: 'horizontal' });
    }

    track(mount(Horizontal, host));
    clickOn(host.querySelector('button')!);

    expect(document.querySelector('[role="menu"]')!.getAttribute('aria-orientation')).toBe(
      'horizontal',
    );
    // A separator lies across the menu, so it turns with it.
    expect(document.querySelector('.rule')!.getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('navigating', () => {
  it('skips disabled items in both directions', () => {
    const { trigger, content, item } = setup();
    press('ArrowDown', trigger());

    press('ArrowDown', content()!);
    expect(focused()).toBe(item('share'));
    press('ArrowUp', content()!);
    // Send sits between Save and Share and is never landed on.
    expect(focused()).toBe(item('save'));
  });

  it('wraps at both ends', () => {
    const { trigger, content, item } = setup();
    press('ArrowUp', trigger());
    expect(focused()).toBe(item('delete'));

    press('ArrowDown', content()!);
    expect(focused()).toBe(item('save'));
  });

  it('jumps to the ends with Home and End', () => {
    const { trigger, content, item } = setup();
    openByClick(trigger());

    press('End', content()!);
    expect(focused()).toBe(item('delete'));
    press('Home', content()!);
    expect(focused()).toBe(item('save'));
  });

  it('jumps by typeahead from an unhighlighted menu', () => {
    const { trigger, content, item } = setup();
    openByClick(trigger());

    press('d', content()!);
    expect(focused()).toBe(item('delete'));
  });

  it('cycles the items sharing a letter, skipping the disabled one', () => {
    const { trigger, content, item } = setup();
    openByClick(trigger());

    press('s', content()!);
    expect(focused()).toBe(item('save'));
    press('s', content()!);
    // Send starts with "s" too, but it is disabled, so cycling passes it by.
    expect(focused()).toBe(item('share'));
    press('s', content()!);
    expect(focused()).toBe(item('sync'));
  });

  it('prevents the keys that would otherwise scroll the page', () => {
    const { trigger, content } = setup();
    openByClick(trigger());

    expect(press('ArrowDown', content()!).defaultPrevented).toBe(true);
    expect(press('End', content()!).defaultPrevented).toBe(true);
    // Nothing was consumed, so the page keeps whatever else this key means.
    expect(press('ArrowRight', content()!).defaultPrevented).toBe(false);
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    const { trigger, content } = setup();
    trigger().focus();
    openByClick(trigger());

    escape();
    expect(content()).toBeNull();
    expect(focused()).toBe(trigger());
  });

  it('closes on Tab without swallowing the key', () => {
    const { trigger, content } = setup();
    trigger().focus();
    openByClick(trigger());

    const event = press('Tab', content()!);
    expect(content()).toBeNull();
    // Focus is back on the trigger and Tab is left alone, so the browser
    // carries on from there to the next control — which is where a user who
    // tabbed out of a menu expects to arrive.
    expect(focused()).toBe(trigger());
    expect(event.defaultPrevented).toBe(false);
  });

  it('forgets the highlight between openings', () => {
    const { menu, trigger, content, item } = setup();
    press('ArrowUp', trigger());
    expect(menu.activeItem()).toBe(item('delete'));

    escape();
    expect(menu.activeItem()).toBeNull();

    openByClick(trigger());
    press('ArrowDown', content()!);
    // A stale item from last time would make this the second item, not the
    // first — and it is not even the same element after a re-render.
    expect(focused()).toBe(item('save'));
  });
});

describe('choosing an item', () => {
  it('reports the item and closes on Enter', () => {
    const { instance, trigger, content } = setup();
    trigger().focus();
    press('ArrowDown', trigger());

    const event = press('Enter', content()!);
    expect(instance.chosen).toEqual(['save']);
    expect(content()).toBeNull();
    expect(focused()).toBe(trigger());
    // Unprevented, Enter fires a click on the focused button item on its way
    // out, and the item is chosen twice.
    expect(event.defaultPrevented).toBe(true);
  });

  it('reports the item and closes on click', () => {
    const { instance, trigger, content, item } = setup();
    openByClick(trigger());

    clickOn(item('share'));
    expect(instance.chosen).toEqual(['share']);
    expect(content()).toBeNull();
  });

  it('chooses the item when the press lands on markup inside it', () => {
    const { instance, trigger, item } = setup();
    openByClick(trigger());

    clickOn(item('delete').querySelector('.text')!);
    // An item is rarely a bare text node — an icon, a label and a shortcut are
    // all children, and a press on any of them is a press on the item.
    expect(instance.chosen).toEqual(['delete']);
  });

  it('does nothing when a disabled item is pressed', () => {
    const { instance, trigger, content, item } = setup();
    openByClick(trigger());

    const event = clickOn(item('send'));
    expect(instance.chosen).toEqual([]);
    expect(content()).not.toBeNull();
    // The item swallows the press rather than letting an `<a>` follow its href.
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the menu open for an item that asks to stay', () => {
    const { instance, trigger, content, item } = setup();
    openByClick(trigger());

    clickOn(item('sync'));
    expect(instance.chosen).toEqual(['sync']);
    // Toggling a checkbox item is rarely the end of what the user came to do.
    expect(content()).not.toBeNull();
  });

  it('takes the default from the menu when the item says nothing', () => {
    @Component({
      selector: 'v-sticky',
      render: compileTemplate(
        `<div><button :click="menu.open()">go</button>` +
          `<div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()"` +
          ` :click="menu.onItemClick($event)">` +
          `<button :spread="menu.itemProps({ value: 'bold' })">Bold</button></div></div>`,
      ),
    })
    class Sticky {
      content = new Signal.State<Element | null>(null);
      menu = createMenu({ content: () => this.content.get(), closeOnSelect: false });
    }

    track(mount(Sticky, host));
    clickOn(host.querySelector('button')!);
    clickOn(document.querySelector('[data-value="bold"]')!);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });
});

describe('the pointer and the keyboard sharing one highlight', () => {
  it('moves focus to the item under the pointer', () => {
    const { trigger, content, item } = setup();
    openByClick(trigger());

    pointerOver(item('share'));
    expect(focused()).toBe(item('share'));

    press('ArrowDown', content()!);
    // The arrow keys continue from where the mouse left off, rather than from
    // wherever the keyboard had last been.
    expect(focused()).toBe(item('sync'));
  });

  it('leaves the highlight alone over a disabled item', () => {
    const { trigger, item } = setup();
    openByClick(trigger());

    pointerOver(item('save'));
    pointerOver(item('send'));
    expect(focused()).toBe(item('save'));
  });
});

describe('dismissal', () => {
  it('closes on a press outside', () => {
    const { trigger, content } = setup();
    openByClick(trigger());

    pressOutside(document.querySelector('#behind')!);
    expect(content()).toBeNull();
  });

  it('does not treat the trigger as outside', () => {
    const { trigger, content } = setup();
    openByClick(trigger());

    // Otherwise dismissal closes it and the trigger's own click reopens it,
    // and the menu never closes at all.
    pressOutside(trigger());
    expect(content()).not.toBeNull();
  });
});

describe('as a context menu', () => {
  @Component({
    selector: 'v-context',
    render: compileTemplate(`
      <div>
        <div id="area" :contextmenu="menu.onContextMenu($event)">rows</div>
        <div :if="menu.isPresent()" :portal :ref="content"
             :spread="menu.contentProps()"
             :keydown="menu.onContentKeyDown($event)"
             :click="menu.onItemClick($event)">
          <button :spread="menu.itemProps({ value: 'copy' })">Copy</button>
          <button :spread="menu.itemProps({ value: 'paste' })">Paste</button>
        </div>
      </div>
    `),
  })
  class ContextArea {
    opened: boolean[] = [];
    content = new Signal.State<Element | null>(null);
    menu = createMenu({
      content: () => this.content.get(),
      onOpenChange: (open) => {
        this.opened.push(open);
      },
    });
  }

  function rightClick(el: Element, x: number, y: number): MouseEvent {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    el.dispatchEvent(event);
    flushSync();
    return event;
  }

  function contextSetup() {
    const handle = track(mount(ContextArea, host));
    const instance = handle.instance as ContextArea;
    return {
      instance,
      menu: instance.menu,
      area: () => host.querySelector('#area')!,
      content: () => document.querySelector('[role="menu"]'),
    };
  }

  it('opens at the pointer and suppresses the platform menu', () => {
    const { menu, area, content } = contextSetup();
    const event = rightClick(area(), 120, 80);

    expect(content()).not.toBeNull();
    expect(menu.position()).toEqual({ x: 120, y: 80 });
    // Without this the browser's own menu opens over the one just rendered.
    expect(event.defaultPrevented).toBe(true);
  });

  it('holds focus itself, with no item highlighted', () => {
    const { menu, area, content } = contextSetup();
    rightClick(area(), 10, 10);

    expect(focused()).toBe(content());
    expect(menu.activeItem()).toBeNull();
  });

  it('names itself, having no trigger to borrow a name from', () => {
    const { area, content } = contextSetup();
    rightClick(area(), 10, 10);

    expect(content()!.hasAttribute('aria-labelledby')).toBe(false);
    expect(content()!.getAttribute('aria-label')).toBe('Menu');
  });

  it('moves rather than reopens on a second press', () => {
    const { instance, menu, area, content } = contextSetup();
    rightClick(area(), 10, 10);
    const first = content();

    rightClick(area(), 200, 40);
    expect(menu.position()).toEqual({ x: 200, y: 40 });
    // Closing and reopening would tear the content down and hand focus back to
    // the page in between, for a menu the user never stopped asking for.
    expect(content()).toBe(first);
    expect(instance.opened).toEqual([true]);
  });

  it('treats the area it opened over as outside', () => {
    const { area, content } = contextSetup();
    rightClick(area(), 10, 10);

    // The area is not a trigger: it has no handler that would reopen the menu,
    // so a press on it must dismiss like any other.
    pressOutside(area());
    expect(content()).toBeNull();
  });

  it('returns focus to whatever had it before', () => {
    const { area, content } = contextSetup();
    const behind = document.querySelector<HTMLElement>('#behind')!;
    behind.tabIndex = 0;
    behind.focus();

    rightClick(area(), 10, 10);
    expect(content()).not.toBeNull();

    escape();
    expect(focused()).toBe(behind);
  });

  it('keeps the position while the exit plays out', () => {
    const { menu, area } = contextSetup();
    rightClick(area(), 60, 60);
    escape();
    // Clearing it on close would slide a menu that is animating out back to
    // the corner of the screen.
    expect(menu.position()).toEqual({ x: 60, y: 60 });
  });
});

describe('items rendered from a loop', () => {
  @Component({
    selector: 'v-loop',
    render: compileTemplate(`
      <div>
        <button :ref="trigger" :spread="menu.triggerProps()"
                :keydown="menu.onTriggerKeyDown($event)">Sort</button>
        <div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()"
             :keydown="menu.onContentKeyDown($event)">
          <button :for="option in options" :key="option.value"
                  :spread="menu.itemProps({ value: option.value, disabled: option.disabled, textValue: option.text })">
            {{ option.label }}
          </button>
        </div>
      </div>
    `),
  })
  class Loop {
    chosen: (string | undefined)[] = [];
    options = [
      { value: 'name', label: '↑ Name', text: 'Name', disabled: false },
      { value: 'size', label: '↑ Size', text: 'Size', disabled: true },
      { value: 'date', label: '↑ Date', text: 'Date', disabled: false },
    ];
    trigger = new Signal.State<Element | null>(null);
    content = new Signal.State<Element | null>(null);
    menu = createMenu({
      trigger: () => this.trigger.get(),
      content: () => this.content.get(),
      onSelect: (_item, value) => {
        this.chosen.push(value);
      },
    });
  }

  it('needs no per-item wiring to navigate and choose', () => {
    const handle = track(mount(Loop, host));
    const instance = handle.instance as Loop;
    const content = () => document.querySelector('[role="menu"]')!;
    const item = (value: string) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!;

    press('ArrowDown', host.querySelector('button')!);
    expect(focused()).toBe(item('name'));

    press('ArrowDown', content());
    // An item in a loop cannot hold a `:ref`, so everything the menu needs is
    // read back off the DOM instead.
    expect(focused()).toBe(item('date'));

    press('Enter', content());
    expect(instance.chosen).toEqual(['date']);
  });

  it('matches typeahead on the text value, not the decorated label', () => {
    track(mount(Loop, host));
    const content = () => document.querySelector('[role="menu"]')!;

    press('ArrowDown', host.querySelector('button')!);
    press('d', content());
    // Nobody types the arrow that the label starts with.
    expect(focused()).toBe(document.querySelector('[data-value="date"]'));
  });
});

describe('controlling it from outside', () => {
  it('follows a supplied signal', () => {
    const open = new Signal.State(false);

    @Component({
      selector: 'v-controlled',
      render: compileTemplate(
        `<div><div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()">x</div></div>`,
      ),
    })
    class Controlled {
      content = new Signal.State<Element | null>(null);
      menu = createMenu({ content: () => this.content.get(), open });
    }

    track(mount(Controlled, host));
    expect(document.querySelector('[role="menu"]')).toBeNull();

    open.set(true);
    flushSync();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('reports every change through onOpenChange, once each', () => {
    const onOpenChange = vi.fn();

    @Component({
      selector: 'v-reported',
      render: compileTemplate(
        `<div><button :spread="menu.triggerProps()" :ref="trigger" :click="menu.toggle()">go</button>` +
          `<div :if="menu.isPresent()" :ref="content" :spread="menu.contentProps()"` +
          ` :click="menu.onItemClick($event)">` +
          `<button :spread="menu.itemProps({ value: 'one' })">One</button></div></div>`,
      ),
    })
    class Reported {
      trigger = new Signal.State<Element | null>(null);
      content = new Signal.State<Element | null>(null);
      menu = createMenu({
        trigger: () => this.trigger.get(),
        content: () => this.content.get(),
        onOpenChange,
      });
    }

    track(mount(Reported, host));
    clickOn(host.querySelector('button')!);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    clickOn(document.querySelector('[data-value="one"]')!);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
