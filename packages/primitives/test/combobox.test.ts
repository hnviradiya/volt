/**
 * Select and Combobox, driven through real mounted components.
 *
 * Both are the same widget seen twice, so what is worth asserting is the part
 * a consumer cannot see and cannot retrofit: the ARIA triangle between the
 * control, the popup and the highlighted option; that the highlight is never
 * DOM focus; the order Escape unwinds things in; and the fact that a widget
 * made of `<div>`s still submits, validates and resets like a form control.
 *
 * The popup is rendered inline rather than portalled. Nothing here depends on
 * where it lands — anchoring is CSS — and keeping it in the tree means the
 * dismissal tests exercise the containment check on real markup.
 *
 * Timers are real except where the typeahead buffer has to be let go of, and
 * there only `setTimeout`, `clearTimeout` and `Date` are faked: Volt's
 * scheduler coalesces onto `queueMicrotask`, and faking that stops every
 * effect. Where a search has to be waited on, `settle` turns the promise chain
 * and the scheduler over together, the way `async.test.ts` does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';
import { directionWatcherCount } from '../src/anchoring.ts';
import {
  createCombobox,
  createSelect,
  type Combobox,
  type ComboboxOptions,
  type Select,
  type SelectOptions,
} from '../src/combobox.ts';
import { dismissStackSize } from '../src/dismiss.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Fruit {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Blueberry is disabled, so every navigation and every count has a hole in it.
 * No two enabled labels share a first letter, which is what makes the select's
 * typeahead assertions unambiguous.
 */
const FRUITS: readonly Fruit[] = [
  { value: 'ap', label: 'Apple' },
  { value: 'ba', label: 'Banana' },
  { value: 'bl', label: 'Blueberry', disabled: true },
  { value: 'ch', label: 'Cherry' },
  { value: 'da', label: 'Damson' },
];

const ENABLED = 4;

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let items: Signal.State<readonly Fruit[]>;
let selectOptions: Partial<SelectOptions>;
let comboOptions: Partial<ComboboxOptions<Fruit>>;
/** Whether the field's `<label>` is handed to the component as its label. */
let labelled = false;
/** Render the popup from the search resource rather than from `items`. */
let fromSearch = false;
/** Name the field wrapper as the anchor rather than letting it ride the input. */
let anchored = false;
/** Back a `multiple` combobox with an `<input>`, which cannot hold its values. */
let inputBacked = false;
let seq = 0;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="outside">page</div>';
  host = document.querySelector('#app')!;
  items = new Signal.State<readonly Fruit[]>(FRUITS);
  selectOptions = {};
  comboOptions = {};
  labelled = false;
  fromSearch = false;
  anchored = false;
  inputBacked = false;
});

afterEach(() => {
  // Dismissal is a module-level stack and anchoring a module-level observer
  // registry; a test that leaves one mounted is a test that breaks the next.
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.useRealTimers();
});

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

/** Unmount now, without `afterEach` unmounting the same handle again. */
function dispose(handle: { unmount(): void }): void {
  const index = mounted.indexOf(handle);
  if (index !== -1) mounted.splice(index, 1);
  handle.unmount();
  flushSync();
}

/** A promise resolved by hand, so a search can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Let the promise chain and the scheduler catch up.
 *
 * A resolved search is `await fetcher` → signal writes → effect flush, and a
 * MutationObserver adds a turn of its own, so one microtask is never enough.
 */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flushSync();
  }
}

/** A whole press: down, up, then the click, as a pointer really produces it. */
function press(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, ...init }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  flushSync();
}

/** Returns whether the component consumed the key. */
function key(el: HTMLElement, name: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

/** Replace the textbox's contents, as an insertion or a deletion would. */
function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

const SELECT_TEMPLATE = `
  <form class="form" :submit="onSubmit($event)">
    <label class="label" :ref="label" :spread="select.field.labelProps()">Fruit</label>
    <select :ref="native" :spread="select.nativeProps()">
      <option value=""></option>
      <option :for="item of items.get()" :key="item.value"
              :spread="select.nativeOptionProps({ value: item.value, disabled: item.disabled })"
      >{ item.label }</option>
    </select>
    <button class="trigger" :ref="trigger" :spread="select.triggerProps()"
            :click="select.onTriggerClick()"
            :keydown="select.onTriggerKeyDown($event)"
            :blur="select.onTriggerBlur()">{ select.displayValue() }</button>
    <div class="listbox" :if="select.isPresent()" :ref="list"
         :spread="select.listboxProps()"
         :click="select.onOptionClick($event)"
         :pointerdown="select.onListboxPointerDown($event)"
         :pointermove="select.onOptionPointerMove($event)">
      <div class="option" :for="item of items.get()" :key="item.value"
           :spread="select.optionProps({ value: item.value, disabled: item.disabled })"
      >{ item.label }</div>
    </div>
    <p class="status" :spread="select.statusProps()">{ select.status() }</p>
  </form>
`;

interface SelectHarness {
  handle: { unmount(): void };
  select: Select;
  form(): HTMLFormElement;
  trigger(): HTMLButtonElement;
  native(): HTMLSelectElement;
  label(): HTMLElement;
  listbox(): HTMLElement | null;
  status(): HTMLElement;
  options(): HTMLElement[];
  option(value: string): HTMLElement;
  /** Every option's `aria-selected`, so a whole selection reads as one line. */
  selectedFlags(): (string | null)[];
}

function selectDemo(): SelectHarness {
  @Component({ selector: `v-select-${++seq}`, render: compileTemplate(SELECT_TEMPLATE) })
  class SelectDemo {
    trigger = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    native = new Signal.State<Element | null>(null);
    label = new Signal.State<Element | null>(null);
    items = items;

    select = createSelect({
      ...selectOptions,
      trigger: () => this.trigger.get(),
      listbox: () => this.list.get(),
      native: () => this.native.get(),
      ...(labelled ? { field: { label: () => this.label.get() } } : {}),
    });

    /** Kept off the network, and out of the way of every pointer test. */
    onSubmit(event: Event): void {
      event.preventDefault();
    }
  }

  const handle = track(mount(SelectDemo, host));
  flushSync();
  const instance = handle.instance as SelectDemo;

  const find = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  return {
    handle,
    select: instance.select,
    form: () => find<HTMLFormElement>('form'),
    trigger: () => find<HTMLButtonElement>('.trigger'),
    native: () => find<HTMLSelectElement>('select'),
    label: () => find('.label'),
    listbox: () => host.querySelector<HTMLElement>('.listbox'),
    status: () => find('.status'),
    options: () => [...host.querySelectorAll<HTMLElement>('.option')],
    option: (value) => find(`.option[data-value="${value}"]`),
    selectedFlags: () =>
      [...host.querySelectorAll<HTMLElement>('.option')].map((el) =>
        el.getAttribute('aria-selected'),
      ),
  };
}

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

const COMBOBOX_TEMPLATE = `
  <form class="form" :submit="onSubmit($event)">
    <div class="wrapper" :ref="wrapper" :spread="wrapperProps()">
      <ul class="chips" :if="multiple" :spread="combo.chipsProps()">
        <li class="chip" :for="v of combo.values()" :key="v" :spread="combo.chipProps(v)">
          <span>{ combo.labelOf(v) }</span>
          <button class="remove" :spread="combo.removeChipProps(v)"
                  :click="combo.deselect(v)">x</button>
        </li>
      </ul>
      <input class="input" :ref="input" :spread="combo.inputProps()"
             :input="combo.onInput($event)"
             :keydown="combo.onInputKeyDown($event)"
             :click="combo.onInputClick()"
             :blur="combo.onInputBlur()">
      <button class="toggle" :spread="combo.toggleProps()" :click="combo.onToggleClick()"
              :pointerdown="combo.onTogglePointerDown($event)">v</button>
      <button class="clear" :spread="combo.clearProps()" :click="combo.clear()">x</button>
    </div>
    <input class="native" :if="nativeInput" :ref="native" :spread="combo.nativeProps()">
    <select class="native" :if="nativeSelect" :ref="native" :spread="combo.nativeProps()">
      <option :for="v of combo.values()" :key="v"
              :spread="combo.nativeOptionProps({ value: v })">{ combo.labelOf(v) }</option>
    </select>
    <div class="listbox" :if="combo.isPresent()" :ref="list"
         :spread="combo.listboxProps()"
         :click="combo.onOptionClick($event)"
         :pointerdown="combo.onListboxPointerDown($event)"
         :pointermove="combo.onOptionPointerMove($event)">
      <div class="option" :for="item of visible()" :key="item.value"
           :spread="combo.optionProps({ value: item.value, disabled: item.disabled })"
      >{ item.label }</div>
      <div class="empty" :if="combo.isEmpty()">{ combo.emptyMessage() }</div>
    </div>
    <p class="status" :spread="combo.statusProps()">{ combo.status() }</p>
  </form>
`;

interface ComboHarness {
  handle: { unmount(): void };
  combo: Combobox<Fruit>;
  form(): HTMLFormElement;
  input(): HTMLInputElement;
  /** An `<input>`, or a `<select multiple>` when several may be chosen. */
  native(): HTMLElement;
  toggle(): HTMLButtonElement;
  clear(): HTMLButtonElement;
  listbox(): HTMLElement | null;
  wrapper(): HTMLElement;
  status(): HTMLElement;
  empty(): HTMLElement | null;
  options(): HTMLElement[];
  option(value: string): HTMLElement;
  labels(): string[];
  chips(): HTMLElement | null;
  chipLabels(): string[];
  removeButton(value: string): HTMLButtonElement;
}

function comboDemo(): ComboHarness {
  @Component({ selector: `v-combo-${++seq}`, render: compileTemplate(COMBOBOX_TEMPLATE) })
  class ComboDemo {
    input = new Signal.State<Element | null>(null);
    list = new Signal.State<Element | null>(null);
    native = new Signal.State<Element | null>(null);
    wrapper = new Signal.State<Element | null>(null);
    items = items;
    multiple = comboOptions.multiple === true;
    /**
     * One value goes behind an `<input>`; several can only go behind a
     * `<select multiple>`, because an input holds one string. `inputBacked` is
     * the mistake, rendered on purpose by the one test that asserts what it
     * costs.
     */
    nativeInput = comboOptions.multiple !== true || inputBacked;
    nativeSelect = comboOptions.multiple === true && !inputBacked;

    combo = createCombobox<Fruit>({
      ...comboOptions,
      input: () => this.input.get(),
      listbox: () => this.list.get(),
      native: () => this.native.get(),
      ...(anchored ? { anchor: () => this.wrapper.get() } : {}),
    });

    /**
     * `anchorProps` belongs on the element the popup lines up with, and only
     * when that is not the control — spreading it as well as leaving it on the
     * input would give two elements one anchor name.
     */
    wrapperProps(): Record<string, unknown> {
      return anchored ? this.combo.anchorProps() : {};
    }

    /** What the consumer's own markup decides to render, filter included. */
    visible(): readonly Fruit[] {
      if (fromSearch) return this.combo.items();
      return this.items.get().filter((item) => this.combo.matches(item.label));
    }

    /** Kept off the network, and out of the way of every pointer test. */
    onSubmit(event: Event): void {
      event.preventDefault();
    }
  }

  const handle = track(mount(ComboDemo, host));
  flushSync();
  const instance = handle.instance as ComboDemo;

  const find = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  return {
    handle,
    combo: instance.combo,
    form: () => find<HTMLFormElement>('form'),
    input: () => find<HTMLInputElement>('.input'),
    native: () => find('.native'),
    toggle: () => find<HTMLButtonElement>('.toggle'),
    clear: () => find<HTMLButtonElement>('.clear'),
    listbox: () => host.querySelector<HTMLElement>('.listbox'),
    wrapper: () => find('.wrapper'),
    status: () => find('.status'),
    empty: () => host.querySelector<HTMLElement>('.empty'),
    options: () => [...host.querySelectorAll<HTMLElement>('.option')],
    option: (value) => find(`.option[data-value="${value}"]`),
    labels: () => [...host.querySelectorAll<HTMLElement>('.option')].map((el) => el.textContent!),
    chips: () => host.querySelector<HTMLElement>('.chips'),
    chipLabels: () => [...host.querySelectorAll<HTMLElement>('.chip span')].map((el) =>
      el.textContent!,
    ),
    removeButton: (value) => find<HTMLButtonElement>(`.remove[data-value="${value}"]`),
  };
}

/** Open the combobox and put DOM focus where a real interaction leaves it. */
function openCombo(ui: ComboHarness): HTMLInputElement {
  const input = ui.input();
  input.focus();
  press(input);
  return input;
}

// ---------------------------------------------------------------------------
// Select — what assistive technology is told
// ---------------------------------------------------------------------------

describe('the select trigger', () => {
  it('is a combobox that owns the popup, and only claims it while it is there', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    // The APG select-only pattern: role=combobox on the button, because a
    // button role cannot carry `aria-activedescendant`.
    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(trigger.getAttribute('tabindex')).toBe('0');

    press(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Pointing at an id nothing carries announces a control of nothing while
    // hiding the fact that the wiring is missing.
    expect(trigger.getAttribute('aria-controls')).toBe(ui.listbox()!.id);
  });

  it('does not turn into a submit button inside the form it is meant to serve', () => {
    const ui = selectDemo();
    // `clearProps` and `toggleProps` both say `type: button`. A trigger that
    // does not submits the surrounding form on every attempt to open the list.
    expect(ui.trigger().type).toBe('button');
  });

  it('says the value is missing until one is chosen', () => {
    const ui = selectDemo();
    expect(ui.trigger().hasAttribute('data-placeholder')).toBe(true);

    ui.select.select('ch');
    flushSync();
    expect(ui.trigger().hasAttribute('data-placeholder')).toBe(false);
  });

  it('shows the label of the value it starts with, before any popup has existed', () => {
    selectOptions = { defaultValue: 'ch' };
    const ui = selectDemo();

    // The native `<select>` is where the labels come from while nothing is
    // rendered; without that a select restored from a server shows a code.
    expect(ui.trigger().textContent).toBe('Cherry');
  });

  it('joins several labels the way the locale joins a list', () => {
    selectOptions = { multiple: true, defaultValue: ['ap', 'ch'] };
    const ui = selectDemo();
    expect(ui.select.displayValue()).toBe('Apple and Cherry');
  });

  it('marks itself unavailable without leaving the keyboard unable to find it', () => {
    selectOptions = { disabled: () => true };
    const ui = selectDemo();

    expect(ui.trigger().getAttribute('aria-disabled')).toBe('true');
    // Still in the tab order: a control a keyboard user cannot reach is a
    // control they cannot discover is disabled.
    expect(ui.trigger().getAttribute('tabindex')).toBe('0');
    expect(ui.trigger().hasAttribute('disabled')).toBe(false);

    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(false);
  });

  it('records having been left, for validation that waits for it', () => {
    const ui = selectDemo();
    expect(ui.select.field.isTouched()).toBe(false);

    ui.trigger().focus();
    ui.trigger().blur();
    flushSync();
    expect(ui.select.field.isTouched()).toBe(true);
  });
});

describe('the popup a select opens', () => {
  it('is a listbox named by the field label when there is one', () => {
    labelled = true;
    const ui = selectDemo();
    press(ui.trigger());

    const listbox = ui.listbox()!;
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.getAttribute('aria-labelledby')).toBe(ui.label().id);
    expect(listbox.hasAttribute('aria-label')).toBe(false);
    // Focus never enters the popup, so a tab stop here would be a place a user
    // can land with nothing to operate.
    expect(listbox.hasAttribute('tabindex')).toBe(false);
  });

  it('names itself when no field label exists to point at', () => {
    const ui = selectDemo();
    press(ui.trigger());

    // A dangling `aria-labelledby` announces an unnamed listbox and hides the
    // mistake; a name of its own announces something.
    expect(ui.listbox()!.hasAttribute('aria-labelledby')).toBe(false);
    expect(ui.listbox()!.getAttribute('aria-label')).toBe('Suggestions');
  });

  it('states selection on every option, so each is heard to be selectable', () => {
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.selectedFlags()).toEqual(['false', 'false', 'false', 'false', 'false']);

    press(ui.option('ch'));
    press(ui.trigger());
    expect(ui.selectedFlags()).toEqual(['false', 'false', 'false', 'true', 'false']);
  });

  it('says nothing about multiple selection unless several may be chosen', () => {
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.listbox()!.hasAttribute('aria-multiselectable')).toBe(false);

    dispose(ui.handle);
    selectOptions = { multiple: true };
    const many = selectDemo();
    press(many.trigger());
    expect(many.listbox()!.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('leaves a disabled option in the accessibility tree', () => {
    const ui = selectDemo();
    press(ui.trigger());

    const blueberry = ui.option('bl');
    expect(blueberry.getAttribute('aria-disabled')).toBe('true');
    // Not the `disabled` attribute: it can still be found and heard to be
    // unavailable rather than appear to have vanished.
    expect(blueberry.hasAttribute('disabled')).toBe(false);
    expect(blueberry.hasAttribute('data-disabled')).toBe(true);
  });

  it('announces how many options there are, from a region that was always there', () => {
    const ui = selectDemo();

    // A live region that appears together with its message announces nothing,
    // so it is rendered empty and stays.
    expect(ui.status().getAttribute('role')).toBe('status');
    expect(ui.status().getAttribute('aria-live')).toBe('polite');
    expect(ui.status().getAttribute('aria-atomic')).toBe('true');
    expect(ui.status().textContent).toBe('');

    press(ui.trigger());
    // Four, not five: the disabled one is not an option anybody can take.
    expect(ui.status().textContent).toBe(`${ENABLED} results available`);

    press(ui.trigger());
    expect(ui.status().textContent).toBe('');
  });
});

describe('virtual focus in a select', () => {
  it('names the active option instead of moving focus to it', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();
    trigger.focus();

    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');

    const named = trigger.getAttribute('aria-activedescendant');
    // The id has to resolve, or the attribute is a promise of an option that
    // a screen reader will never find.
    expect(named).toBe(ui.option('ba').id);
    expect(document.getElementById(named!)).toBe(ui.option('ba'));
    expect(document.activeElement).toBe(trigger);
    expect(ui.option('ba').hasAttribute('data-highlighted')).toBe(true);
    // No second tab stop anywhere in the popup.
    expect(ui.options().every((el) => !el.hasAttribute('tabindex'))).toBe(true);
  });

  it('lets go of the highlight when the option it named leaves the list', async () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'End');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(ui.option('da').id);

    items.set(FRUITS.slice(0, 2));
    await settle();

    // Damson has gone. Typing is not the only way a list changes — a late
    // search answer and a consumer's own filter never reach this component —
    // and an id nothing carries is a promise of an option no screen reader
    // will ever find.
    expect(ui.select.activeValue()).toBeNull();
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('drops the reference when the popup goes, rather than pointing into nothing', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'ArrowDown');
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(true);

    key(trigger, 'Escape');
    expect(ui.listbox()).toBeNull();
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ui.select.activeValue()).toBeNull();
  });
});

describe('the select keyboard', () => {
  it('opens on the four keys that open it, at the selected option', () => {
    for (const name of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      selectOptions = { defaultValue: 'ch' };
      const ui = selectDemo();
      expect(key(ui.trigger(), name)).toBe(true);
      expect(ui.select.isOpen()).toBe(true);
      expect(ui.select.activeValue()).toBe('ch');
      dispose(ui.handle);
    }
  });

  it('opens with nothing highlighted under Alt, which is the "just show me" key', () => {
    selectOptions = { defaultValue: 'ch' };
    const ui = selectDemo();

    key(ui.trigger(), 'ArrowDown', { altKey: true });
    expect(ui.select.isOpen()).toBe(true);
    expect(ui.select.activeValue()).toBeNull();
    expect(ui.trigger().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('opens at the first and last option from Home and End', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'End');
    expect(ui.select.activeValue()).toBe('da');

    key(ui.trigger(), 'Home');
    expect(ui.select.activeValue()).toBe('ap');
  });

  it('steps over the disabled option and stops at the ends', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();

    key(trigger, 'ArrowDown');
    expect(ui.select.activeValue()).toBe('ap');
    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');
    // Blueberry sits between Banana and Cherry and is not stopped on.
    expect(ui.select.activeValue()).toBe('ch');

    key(trigger, 'End');
    // The key is still consumed at the end, or the page scrolls underneath.
    expect(key(trigger, 'ArrowDown')).toBe(true);
    expect(ui.select.activeValue()).toBe('da');
  });

  it('wraps only when asked to', () => {
    selectOptions = { loop: true };
    const ui = selectDemo();
    key(ui.trigger(), 'End');
    key(ui.trigger(), 'ArrowDown');
    expect(ui.select.activeValue()).toBe('ap');
  });

  it('commits on Enter and closes, leaving focus on the trigger', () => {
    const ui = selectDemo();
    const trigger = ui.trigger();
    trigger.focus();

    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');
    expect(key(trigger, 'Enter')).toBe(true);

    expect(ui.select.value()).toBe('ba');
    expect(ui.select.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('commits and collapses in one press with Alt and Up', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'ArrowDown');
    key(ui.trigger(), 'ArrowUp', { altKey: true });

    expect(ui.select.value()).toBe('ap');
    expect(ui.select.isOpen()).toBe(false);
  });

  it('takes the highlighted option on Tab and leaves the key to the browser', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'ArrowDown');

    // Not prevented: the user asked to leave, and they should end up after the
    // trigger rather than back where they were.
    expect(key(ui.trigger(), 'Tab')).toBe(false);
    expect(ui.select.value()).toBe('ap');
    expect(ui.select.isOpen()).toBe(false);
  });

  it('closes on Escape with the value untouched', () => {
    selectOptions = { defaultValue: 'ch' };
    const ui = selectDemo();

    key(ui.trigger(), 'ArrowDown');
    key(ui.trigger(), 'ArrowDown');
    expect(ui.select.activeValue()).toBe('da');

    key(ui.trigger(), 'Escape');
    expect(ui.select.isOpen()).toBe(false);
    expect(ui.select.value()).toBe('ch');
  });

  it('chooses by typed prefix without ever opening, as a native select does', () => {
    // Only the typeahead buffer's timeout is faked. Volt's scheduler runs on
    // queueMicrotask, and faking that stops every effect.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const ui = selectDemo();

    // The hidden `<select>` is a collection of its own, which is what makes
    // this possible while nothing is rendered.
    key(ui.trigger(), 'd');
    expect(ui.select.value()).toBe('da');
    expect(ui.select.isOpen()).toBe(false);

    // Characters accumulate, so "ch" is one search and not two.
    vi.advanceTimersByTime(600);
    key(ui.trigger(), 'c');
    key(ui.trigger(), 'h');
    expect(ui.select.value()).toBe('ch');
    expect(ui.select.isOpen()).toBe(false);

    vi.advanceTimersByTime(600);
    key(ui.trigger(), 'a');
    expect(ui.select.value()).toBe('ap');
  });

  it('moves the highlight by typed prefix while open, without choosing', () => {
    const ui = selectDemo();
    key(ui.trigger(), 'ArrowDown');

    key(ui.trigger(), 'c');
    expect(ui.select.activeValue()).toBe('ch');
    expect(ui.select.value()).toBeNull();
  });

  it('leaves a shortcut to the application', () => {
    const ui = selectDemo();
    expect(key(ui.trigger(), 'ArrowDown', { ctrlKey: true })).toBe(false);
    expect(ui.select.isOpen()).toBe(false);
  });
});

describe('choosing with the pointer', () => {
  it('does not treat a press on the trigger as a press outside', () => {
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(true);

    // Dismissal running first would close it and the trigger's own handler
    // would open it straight back up, so the button would never close it.
    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(false);
  });

  it('closes on a press outside', () => {
    const ui = selectDemo();
    press(ui.trigger());

    press(document.querySelector<HTMLElement>('#outside')!);
    expect(ui.select.isOpen()).toBe(false);
  });

  it('commits an option and closes', () => {
    const ui = selectDemo();
    press(ui.trigger());
    press(ui.option('ch'));

    expect(ui.select.value()).toBe('ch');
    expect(ui.select.isOpen()).toBe(false);
    expect(ui.trigger().textContent).toBe('Cherry');
  });

  it('swallows a press on a disabled option', () => {
    const ui = selectDemo();
    press(ui.trigger());

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    ui.option('bl').dispatchEvent(event);
    flushSync();

    // Visibly there, and an `<a>` used as an option would follow its href.
    expect(event.defaultPrevented).toBe(true);
    expect(ui.select.value()).toBeNull();
    expect(ui.select.isOpen()).toBe(true);
  });

  it('keeps focus on the control when the press lands in the popup', () => {
    const ui = selectDemo();
    press(ui.trigger());

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    ui.option('ap').dispatchEvent(event);
    flushSync();

    // Cancelled, or a focusable option — or a scrollbar drag — would take
    // focus off the control and close the popup out from under the press.
    expect(event.defaultPrevented).toBe(true);
  });

  it('accumulates in a multiple and keeps the popup open', () => {
    selectOptions = { multiple: true };
    const ui = selectDemo();
    press(ui.trigger());

    press(ui.option('ap'));
    press(ui.option('ch'));
    expect(ui.select.values()).toEqual(['ap', 'ch']);
    expect(ui.select.isOpen()).toBe(true);

    press(ui.option('ap'));
    expect(ui.select.values()).toEqual(['ch']);
  });

  it('refuses to change anything while read-only, but still opens', () => {
    selectOptions = { readOnly: () => true, defaultValue: 'ap' };
    const ui = selectDemo();
    press(ui.trigger());
    expect(ui.select.isOpen()).toBe(true);

    press(ui.option('ch'));
    expect(ui.select.value()).toBe('ap');
  });
});

describe('the form behind a select', () => {
  it('submits through a real select', () => {
    selectOptions = { name: 'fruit' };
    const ui = selectDemo();

    expect(new FormData(ui.form()).get('fruit')).toBe('');
    press(ui.trigger());
    press(ui.option('ch'));
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
  });

  it('hides the native control from assistive technology and from Tab', () => {
    selectOptions = { name: 'fruit' };
    const ui = selectDemo();
    const native = ui.native();

    // The visible control carries the role and the tab stop; announcing both
    // announces the widget twice.
    expect(native.getAttribute('aria-hidden')).toBe('true');
    expect(native.getAttribute('tabindex')).toBe('-1');
    // Present but not seen: an unrendered control has nowhere for the
    // browser's own validation bubble to point.
    expect(native.style.position).toBe('absolute');
    expect(native.style.getPropertyValue('clip-path')).toBe('inset(50%)');
  });

  it('lets the platform enforce required, and clears it once a value is chosen', () => {
    selectOptions = { name: 'fruit', required: () => true };
    const ui = selectDemo();

    expect(ui.native().required).toBe(true);
    expect(ui.form().checkValidity()).toBe(false);

    press(ui.trigger());
    press(ui.option('ch'));
    expect(ui.form().checkValidity()).toBe(true);
  });

  it('writes disabled through to the native control, so the platform excludes it', () => {
    selectOptions = { name: 'fruit', defaultValue: 'ch', disabled: () => true };
    const ui = selectDemo();

    // The flag has to reach the real control: a widget that only looks
    // disabled still submits, still validates, and still fails a form.
    expect(ui.native().disabled).toBe(true);
    expect(ui.select.field.isDisabled()).toBe(true);
  });

  it('follows a form reset back to the value the form holds', async () => {
    selectOptions = { name: 'fruit', defaultValue: 'ap' };
    const ui = selectDemo();

    press(ui.trigger());
    press(ui.option('ch'));
    expect(ui.select.value()).toBe('ch');

    ui.form().reset();
    await settle();
    // A widget that ignored reset would leave the page showing a value the
    // form no longer holds.
    expect(ui.select.value()).toBe('ap');
    expect(new FormData(ui.form()).get('fruit')).toBe('ap');
  });
});

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

describe('the combobox textbox', () => {
  it('is a combobox that says how much it promises about the list', () => {
    const ui = comboDemo();
    const input = ui.input();

    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-haspopup')).toBe('listbox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    // The browser's own autofill drops a second list on top of this one, and
    // its spellchecker underlines every proper noun in the catalogue.
    expect(input.getAttribute('autocomplete')).toBe('off');
    // A property rather than an attribute on a real input, so it is asserted
    // where it is written.
    expect(ui.combo.inputProps().spellcheck).toBe(false);

    openCombo(ui);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(ui.listbox()!.id);
  });

  it('says so when typing does not narrow the list at all', () => {
    comboOptions = { autocomplete: 'none' };
    const ui = comboDemo();
    const input = openCombo(ui);

    expect(input.getAttribute('aria-autocomplete')).toBe('none');
    type(input, 'zzz');
    // `none` is a combobox used purely as an opener; the list is not a search.
    expect(ui.options()).toHaveLength(FRUITS.length);
  });

  it('shows the value it starts with rather than an empty box over a filled form', () => {
    comboOptions = { name: 'fruit', defaultValue: 'ba' };
    const ui = comboDemo();

    expect(new FormData(ui.form()).get('fruit')).toBe('ba');
    // The component owns the textbox's value — it forbids a `:value` binding
    // beside it — so an empty box here is the two halves of one control
    // disagreeing about what has been chosen.
    expect(ui.input().value).not.toBe('');
  });

  it('keeps DOM focus in the textbox and points at the option instead', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');

    // The defining constraint of the pattern: typing has to keep working, so
    // focus never leaves the textbox.
    expect(document.activeElement).toBe(input);
    const named = input.getAttribute('aria-activedescendant');
    expect(named).toBe(ui.option('ba').id);
    expect(document.getElementById(named!)).toBe(ui.option('ba'));
    expect(ui.options().every((el) => !el.hasAttribute('tabindex'))).toBe(true);
  });

  it('never points at an option the filter has just removed', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(ui.option('ap').id);

    type(input, 'ch');
    // Apple has left the document; an attribute still naming it is a promise
    // of an element a screen reader will never find.
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ui.combo.activeValue()).toBeNull();
  });

  it('keeps every option id stable across a re-render, so nothing dangles', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    const before = ui.option('ch').id;

    type(input, 'ch');
    expect(ui.option('ch').id).toBe(before);
    type(input, '');
    expect(ui.option('ch').id).toBe(before);
  });
});

describe('opening and closing a combobox', () => {
  it('opens on a press, and a second press does not take the list away', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    expect(ui.combo.isOpen()).toBe(true);

    // A press to reposition the caret in text already typed is not a request
    // to close, and the textbox is never "outside" its own popup.
    press(input);
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('opens down onto the first option and up onto the last', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    expect(key(input, 'ArrowDown')).toBe(true);
    expect(ui.combo.activeValue()).toBe('ap');

    key(input, 'Escape');
    key(input, 'ArrowUp');
    expect(ui.combo.activeValue()).toBe('da');
  });

  it('opens with nothing highlighted under Alt, and closes again on Alt and Up', () => {
    const ui = comboDemo();
    const input = ui.input();

    key(input, 'ArrowDown', { altKey: true });
    expect(ui.combo.isOpen()).toBe(true);
    expect(ui.combo.activeValue()).toBeNull();

    key(input, 'ArrowUp', { altKey: true });
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('opens on typing, including a deletion back to an empty box', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'c');
    expect(ui.combo.isOpen()).toBe(true);
    // Nothing is highlighted: the user is typing a query, not picking.
    expect(ui.combo.activeValue()).toBeNull();

    key(input, 'Escape');
    key(input, 'Escape');
    type(input, '');
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('leaves Home and End to the caret', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    // In a textbox they belong to editing; taking them for the list would make
    // the query impossible to correct.
    expect(key(input, 'Home')).toBe(false);
    expect(key(input, 'End')).toBe(false);
    expect(ui.combo.activeValue()).toBeNull();
  });

  it('takes Escape in two stages: the popup first, then the text', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'ch');
    expect(ui.combo.isOpen()).toBe(true);

    key(input, 'Escape');
    // The visible layer is the one being addressed. Clearing the text under a
    // list the user wanted rid of reverses what they asked for.
    expect(ui.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');

    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(ui.combo.inputValue()).toBe('');
  });

  it('empties the value as well as the box on that second Escape', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');

    key(input, 'Escape');
    // A single-value combobox showing nothing holds nothing.
    expect(input.value).toBe('');
    expect(ui.combo.value()).toBeNull();
  });

  it('closes from the toggle button beside it', () => {
    const ui = comboDemo();
    press(ui.toggle());
    expect(ui.combo.isOpen()).toBe(true);
    expect(ui.toggle().getAttribute('aria-expanded')).toBe('true');
    expect(ui.toggle().getAttribute('aria-controls')).toBe(ui.listbox()!.id);

    // The button offers to close as well as open; dismissal treating it as an
    // outside press would close and reopen in one gesture, and it would never
    // close at all.
    press(ui.toggle());
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('keeps focus in the textbox when the toggle is pressed', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    ui.toggle().dispatchEvent(event);
    flushSync();

    // A `tabindex="-1"` button is still click-focusable, and focus leaving the
    // textbox blurs it — which closes the popup before the click that was
    // meant to open it, and takes typing away from a pattern built on it.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('leaves an Escape that another layer has already answered alone', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'ch');
    key(input, 'Escape');
    expect(ui.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');

    // A second widget elsewhere on the page, with its popup up: a dialog or
    // another combobox is the layer above this collapsed one.
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    const own = host;
    host = elsewhere;
    const other = comboDemo();
    host = own;
    other.combo.open();
    flushSync();
    expect(dismissStackSize()).toBe(1);

    key(input, 'Escape');
    // One press closes one layer. This one is not that layer, so it keeps
    // text the user can still see — and the value under it.
    expect(other.combo.isOpen()).toBe(false);
    expect(input.value).toBe('ch');
    expect(ui.combo.inputValue()).toBe('ch');
  });

  it('names its two side buttons and keeps them out of the tab order', () => {
    const ui = comboDemo();
    // Both duplicate something the textbox already does from the keyboard, so
    // a tab stop each is one more thing to step over on every pass.
    expect(ui.toggle().getAttribute('aria-label')).toBe('Show suggestions');
    expect(ui.toggle().getAttribute('tabindex')).toBe('-1');
    expect(ui.clear().getAttribute('aria-label')).toBe('Clear');
    expect(ui.clear().getAttribute('tabindex')).toBe('-1');
  });

  it('puts the text back to the value it holds when focus leaves', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    type(input, 'nonsense');

    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    // Leaving it would show text the form does not hold.
    expect(input.value).toBe('Cherry');
    expect(ui.combo.isOpen()).toBe(false);
    expect(ui.combo.field.isTouched()).toBe(true);
  });
});

describe('filtering, and what is announced while it happens', () => {
  it('narrows the list and announces the count', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    expect(ui.labels()).toEqual(['Cherry']);
    expect(ui.combo.optionCount()).toBe(1);
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('ignores case and accents, because nobody types them to find a name', () => {
    items.set([...FRUITS, { value: 'ec', label: 'Éclair' }]);
    const ui = comboDemo();
    type(ui.input(), 'ecl');
    expect(ui.labels()).toEqual(['Éclair']);
  });

  it('announces the empty state instead of leaving the list silently empty', () => {
    const ui = comboDemo();
    type(ui.input(), 'zzz');

    expect(ui.options()).toHaveLength(0);
    expect(ui.combo.isEmpty()).toBe(true);
    // Said out loud, not only drawn: a list that quietly becomes empty is a
    // list a screen reader user is still being told has options in it.
    expect(ui.status().textContent).toBe('No results');
    expect(ui.empty()?.textContent).toBe('No results');
  });

  it('takes an override for both messages', () => {
    comboOptions = {
      labels: { empty: 'Rien', results: (n) => `${n} fruits` },
    };
    const ui = comboDemo();
    type(ui.input(), 'zzz');
    expect(ui.status().textContent).toBe('Rien');

    type(ui.input(), 'ch');
    expect(ui.status().textContent).toBe('1 fruits');
  });

  it('shows the whole list again when reopened after a choice', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(input.value).toBe('Cherry');

    press(ui.toggle());
    // The single most common way this pattern is got wrong: reopening a
    // combobox holding "Cherry" and being shown only Cherry.
    expect(ui.options()).toHaveLength(FRUITS.length);
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('keeps the count honest when the list changes underneath it', async () => {
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.combo.optionCount()).toBe(ENABLED);

    items.set(FRUITS.slice(0, 2));
    await settle();
    // Counted from the DOM through an observer, because the list is the
    // consumer's to render and this component is never told what went into it.
    expect(ui.combo.optionCount()).toBe(2);
    expect(ui.status().textContent).toBe('2 results available');
  });
});

describe('a combobox that searches', () => {
  interface Search {
    ui: ComboHarness;
    resolve(query: string, results: readonly Fruit[]): void;
    pending(): string[];
  }

  function searchDemo(): Search {
    const gates = new Map<string, ReturnType<typeof deferred<readonly Fruit[]>>>();
    fromSearch = true;
    comboOptions = {
      ...comboOptions,
      searchDebounce: 0,
      search: (request) => {
        const gate = deferred<readonly Fruit[]>();
        gates.set(request.source, gate);
        return gate.promise;
      },
    };

    const ui = comboDemo();
    return {
      ui,
      resolve: (query, results) => gates.get(query)?.resolve(results),
      pending: () => [...gates.keys()],
    };
  }

  it('announces that it is loading, and then the count', async () => {
    const { ui, resolve } = searchDemo();
    type(ui.input(), 'ch');

    expect(ui.combo.isLoading()).toBe(true);
    expect(ui.status().textContent).toBe('Loading…');

    resolve('ch', [FRUITS[3]!]);
    await settle();
    expect(ui.labels()).toEqual(['Cherry']);
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('does not claim there are no results while it is still asking', () => {
    const { ui } = searchDemo();
    type(ui.input(), 'ch');

    // "Open, settled, and showing nothing" — a search in flight is not
    // settled, and a combobox that flashes "No results" between every
    // keystroke and its answer is telling the user something untrue.
    expect(ui.combo.isEmpty()).toBe(false);
    expect(ui.empty()).toBeNull();
  });

  it('lets a fast later answer stand over a slow earlier one', async () => {
    const { ui, resolve, pending } = searchDemo();
    const input = ui.input();

    type(input, 'ca');
    type(input, 'cat');
    expect(pending()).toEqual(['ca', 'cat']);

    resolve('cat', [{ value: 'c2', label: 'Cat results' }]);
    await settle();
    resolve('ca', [{ value: 'c1', label: 'Ca results' }]);
    await settle();

    // Results for "ca" landing under the word "cat" is the single commonest
    // async combobox defect, and it reads to everyone as a backend bug.
    expect(ui.labels()).toEqual(['Cat results']);
    expect(ui.status().textContent).toBe('1 result available');
  });

  it('asks nothing until there is enough typed to ask about', () => {
    comboOptions = { minLength: 2 };
    const { ui, pending } = searchDemo();

    type(ui.input(), 'c');
    expect(pending()).toEqual([]);
    type(ui.input(), 'ch');
    expect(pending()).toEqual(['ch']);
  });

  it('stops the request when the component goes away mid-search', async () => {
    const aborted: string[] = [];
    fromSearch = true;
    comboOptions = {
      searchDebounce: 0,
      search: (request) => {
        request.signal.addEventListener('abort', () => aborted.push(request.source));
        return new Promise<readonly Fruit[]>(() => {});
      },
    };
    const ui = comboDemo();

    type(ui.input(), 'ch');
    dispose(ui.handle);
    await settle();

    expect(aborted).toContain('ch');
  });
});

describe('committing a value', () => {
  it('takes the highlighted option on Enter, closes, and fills the box', () => {
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    expect(key(input, 'Enter')).toBe(true);

    expect(ui.combo.value()).toBe('ba');
    expect(input.value).toBe('Banana');
    expect(ui.combo.isOpen()).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it('takes an option pressed with the pointer, and fills the box the same way', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'ch');
    press(ui.option('ch'));

    // The pointer route goes through the core rather than through the key
    // handler, and is the one that would otherwise leave the query sitting in
    // the box under the chosen value.
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('leaves Enter to the form when there is nothing to take', () => {
    const ui = comboDemo();
    const input = ui.input();
    type(input, 'zzz');

    // Swallowing it here is how a combobox stops a one-field form ever being
    // submitted.
    expect(key(input, 'Enter')).toBe(false);
    expect(ui.combo.value()).toBeNull();
  });

  it('refuses a value that matches nothing unless custom values are allowed', () => {
    const ui = comboDemo();
    type(ui.input(), 'Kumquat');
    key(ui.input(), 'Enter');
    expect(ui.combo.value()).toBeNull();

    dispose(ui.handle);
    comboOptions = { allowCustomValue: true };
    const free = comboDemo();
    type(free.input(), 'Kumquat');
    expect(key(free.input(), 'Enter')).toBe(true);
    expect(free.combo.value()).toBe('Kumquat');
    expect(free.combo.isOpen()).toBe(false);
  });

  it('does not swap the option chosen for its own label when focus leaves', () => {
    comboOptions = { allowCustomValue: true, name: 'fruit' };
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ch');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.value()).toBe('ch');
    expect(input.value).toBe('Cherry');

    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    // The box holds the label of what was chosen, so every blur after a
    // successful pick offers "Cherry" to a combobox that will take anything.
    // Committing it replaces the option's id with its human text, and the
    // form submits a different thing than the one the user pressed.
    expect(ui.combo.value()).toBe('ch');
    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(input.value).toBe('Cherry');
  });

  it('takes the highlighted option on Tab and carries on out', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    key(input, 'ArrowDown');

    expect(key(input, 'Tab')).toBe(false);
    expect(ui.combo.value()).toBe('ap');
    expect(ui.combo.isOpen()).toBe(false);
  });

  it('submits through a real hidden input', () => {
    comboOptions = { name: 'fruit' };
    const ui = comboDemo();

    expect(new FormData(ui.form()).get('fruit')).toBe('');
    type(ui.input(), 'ch');
    key(ui.input(), 'ArrowDown');
    key(ui.input(), 'Enter');

    expect(new FormData(ui.form()).get('fruit')).toBe('ch');
    expect(ui.native().getAttribute('aria-hidden')).toBe('true');
    expect(ui.native().getAttribute('tabindex')).toBe('-1');
  });

  it('empties both halves when cleared', () => {
    comboOptions = { name: 'fruit' };
    const ui = comboDemo();
    type(ui.input(), 'ch');
    key(ui.input(), 'ArrowDown');
    key(ui.input(), 'Enter');

    press(ui.clear());
    expect(ui.combo.value()).toBeNull();
    expect(ui.input().value).toBe('');
    expect(new FormData(ui.form()).get('fruit')).toBe('');
  });
});

describe('choosing several, with chips', () => {
  beforeEach(() => {
    comboOptions = { multiple: true, name: 'fruit' };
  });

  it('lists the chips, counted, each with a button that names what it removes', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    press(ui.option('ch'));

    expect(ui.combo.values()).toEqual(['ap', 'ch']);
    expect(ui.chipLabels()).toEqual(['Apple', 'Cherry']);
    expect(ui.chips()!.getAttribute('role')).toBe('list');
    expect(ui.chips()!.getAttribute('aria-label')).toBe('2 selected');

    const remove = ui.removeButton('ap');
    // A tab stop each, rather than a roving tabindex the user has to discover.
    expect(remove.getAttribute('aria-label')).toBe('Remove Apple');
    expect(remove.getAttribute('tabindex')).toBe('0');
    expect(remove.type).toBe('button');

    press(remove);
    expect(ui.combo.values()).toEqual(['ch']);
  });

  it('empties the query after each choice, so the list is not narrowed to the new chip', () => {
    const ui = comboDemo();
    const input = ui.input();

    type(input, 'ap');
    key(input, 'ArrowDown');
    key(input, 'Enter');

    expect(ui.combo.values()).toEqual(['ap']);
    expect(input.value).toBe('');
    expect(ui.combo.isFiltering()).toBe(false);
  });

  it('leaves the popup open after a keyboard choice, as a pointer choice does', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    // The pointer route honours `closeOnSelect`, which defaults to false here:
    // picking three things should not mean opening the list three times.
    expect(ui.combo.isOpen()).toBe(true);

    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(ui.combo.values()).toEqual(['ap', 'ba']);
    expect(ui.combo.isOpen()).toBe(true);
  });

  it('carries every value chosen into the control that submits, not only the first', () => {
    const ui = comboDemo();
    const submitted = () =>
      [...(ui.native() as HTMLSelectElement).selectedOptions].map((option) => option.value);

    press(ui.input());
    press(ui.option('ap'));
    press(ui.option('ch'));
    expect(ui.combo.values()).toEqual(['ap', 'ch']);

    // An `<input>` holds one string, so the control behind a multiple is a
    // `<select multiple>` fed one option per chosen value. A form that
    // receives Apple alone is wrong in a way nobody can see in the payload.
    //
    // Asserted through `selectedOptions` — what the browser's own serialiser
    // walks — rather than through `FormData`, because happy-dom reads a single
    // option out of a multiple select whatever the DOM says.
    expect((ui.native() as HTMLSelectElement).multiple).toBe(true);
    expect(submitted()).toEqual(['ap', 'ch']);

    press(ui.removeButton('ap'));
    expect(submitted()).toEqual(['ch']);
  });

  it('leaves an `<input>` behind a multiple empty rather than half right', () => {
    inputBacked = true;
    const ui = comboDemo();

    press(ui.input());
    press(ui.option('ap'));
    press(ui.option('ch'));
    expect(ui.combo.values()).toEqual(['ap', 'ch']);

    // The unsupported markup, rendered on purpose. A form that receives Apple
    // where Apple and Cherry were chosen is wrong in a way nobody can see in
    // the payload; empty fails the required check and says so.
    expect(new FormData(ui.form()).get('fruit')).toBe('');
  });

  it('removes the last chip on Backspace, and only from an empty box', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    press(ui.option('ch'));

    type(input, 'da');
    // Never eats a character the user meant to type.
    expect(key(input, 'Backspace')).toBe(false);
    expect(ui.combo.values()).toEqual(['ap', 'ch']);

    type(input, '');
    key(input, 'Backspace');
    expect(ui.combo.values()).toEqual(['ap']);
  });

  it('keeps its chips when Escape clears the box', () => {
    const ui = comboDemo();
    const input = ui.input();

    press(input);
    press(ui.option('ap'));
    type(input, 'ch');

    key(input, 'Escape');
    key(input, 'Escape');
    expect(input.value).toBe('');
    // Chips go through Backspace and the chip buttons, not through Escape.
    expect(ui.combo.values()).toEqual(['ap']);
  });

  it('says the popup allows more than one', () => {
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.listbox()!.getAttribute('aria-multiselectable')).toBe('true');
  });
});

describe('completing the textbox inline', () => {
  beforeEach(() => {
    comboOptions = { autocomplete: 'both' };
  });

  it('completes from the first match and selects the part not typed', () => {
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'ap');
    expect(input.value).toBe('Apple');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
    // The completion is a proposal the user is looking at, so Enter should
    // take the option it came from.
    expect(ui.combo.activeValue()).toBe('ap');
    expect(input.getAttribute('aria-autocomplete')).toBe('both');
  });

  it('completes from an answer that arrives after the keystroke that asked', async () => {
    const gate = deferred<readonly Fruit[]>();
    fromSearch = true;
    comboOptions = { autocomplete: 'both', searchDebounce: 0, search: () => gate.promise };
    const ui = comboDemo();
    const input = ui.input();
    input.focus();

    type(input, 'a');
    // Nothing has been rendered to complete from yet, and the keystroke that
    // opened the popup is long gone by the time the list exists.
    expect(input.value).toBe('a');

    gate.resolve([{ value: 'ap', label: 'Apple' }]);
    await settle();

    expect(input.value).toBe('Apple');
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(5);
    expect(ui.combo.activeValue()).toBe('ap');
  });

  it('does not complete after a deletion, or the box can never be emptied', () => {
    const ui = comboDemo();
    const input = ui.input();

    // Two keystrokes, because the first one is the one that opens the popup.
    type(input, 'a');
    type(input, 'ap');
    expect(input.value).toBe('Apple');

    // What Backspace over the selected completion leaves behind.
    type(input, 'a');
    expect(input.value).toBe('a');
    expect(ui.combo.activeValue()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What has to be given back
// ---------------------------------------------------------------------------

describe('cleaning up', () => {
  it('leaves nothing on the dismissal stack when unmounted while open', () => {
    expect(dismissStackSize()).toBe(0);
    const ui = comboDemo();
    openCombo(ui);
    expect(dismissStackSize()).toBe(1);

    dispose(ui.handle);
    // A layer left behind swallows the next Escape on the page, from a
    // component that is no longer on it.
    expect(dismissStackSize()).toBe(0);
  });

  it('stops watching the document for a direction change', () => {
    expect(directionWatcherCount()).toBe(0);
    const ui = comboDemo();
    expect(directionWatcherCount()).toBe(1);

    dispose(ui.handle);
    expect(directionWatcherCount()).toBe(0);
  });

  it('gives up the dismissal layer as soon as the popup closes', () => {
    const ui = comboDemo();
    const input = openCombo(ui);
    expect(dismissStackSize()).toBe(1);

    key(input, 'Escape');
    expect(dismissStackSize()).toBe(0);
  });
});

describe('where the popup is anchored', () => {
  it('rides the control by default', () => {
    const ui = comboDemo();
    openCombo(ui);

    const name = ui.input().style.getPropertyValue('anchor-name');
    expect(name).not.toBe('');
    expect(ui.listbox()!.style.getPropertyValue('position-anchor')).toBe(name);
    expect(ui.wrapper().style.getPropertyValue('anchor-name')).toBe('');
  });

  it('moves onto the field wrapper when one is named', () => {
    anchored = true;
    const ui = comboDemo();
    openCombo(ui);

    // A combobox with chips is wider than its textbox, and a popup lined up
    // with the textbox alone sits under the middle of the field.
    const name = ui.wrapper().style.getPropertyValue('anchor-name');
    expect(name).not.toBe('');
    expect(ui.listbox()!.style.getPropertyValue('position-anchor')).toBe(name);
    // Named once, or two elements claim the same anchor.
    expect(ui.input().style.getPropertyValue('anchor-name')).toBe('');
  });
});

describe('right to left', () => {
  it('mirrors the popup along the inline axis and nothing else', () => {
    host.setAttribute('dir', 'rtl');
    const ui = comboDemo();
    openCombo(ui);

    // `bottom-start` means the popup's start edge lines up with the field's,
    // and which edge that is is the whole of what direction changes.
    expect(ui.listbox()!.style.getPropertyValue('position-area')).toBe('bottom span-left');
    expect(ui.combo.anchor.direction()).toBe('rtl');
  });

  it('lines up the other way when nothing says otherwise', () => {
    const ui = comboDemo();
    openCombo(ui);
    expect(ui.listbox()!.style.getPropertyValue('position-area')).toBe('bottom span-right');
  });

  it('does not mirror the arrow keys, which run down a vertical list', () => {
    host.setAttribute('dir', 'rtl');
    const ui = comboDemo();
    const input = openCombo(ui);

    key(input, 'ArrowDown');
    expect(ui.combo.activeValue()).toBe('ap');
    key(input, 'ArrowDown');
    expect(ui.combo.activeValue()).toBe('ba');
  });
});
