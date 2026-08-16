/**
 * Listbox, driven through real mounted components.
 *
 * What is worth asserting is the keyboard map and the ARIA wiring, because they
 * are the parts a consumer cannot see and cannot retrofit: which option holds
 * the tab stop, what a range press does to the selection either side of the
 * anchor, whether a screen reader is told the size of the whole collection or
 * only of the window that happens to be rendered, and whether a listbox that
 * moved its highlight actually moved anything a user can perceive.
 *
 * `ResizeObserver` is replaced for the virtualized cases with one that delivers
 * exactly the entries a test asks it to — happy-dom lays nothing out, so a
 * scroller is a zero-height scroller until something says otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';
import {
  OPTION_ATTRIBUTE,
  createListbox,
  type Listbox,
  type ListboxOptions,
} from '../src/listbox.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Fruit {
  id: string;
  label: string;
  disabled?: boolean;
}

/** Date is disabled, so every navigation test has a hole to step over. */
const FRUITS: readonly Fruit[] = [
  { id: 'ap', label: 'Apple' },
  { id: 'ba', label: 'Banana' },
  { id: 'ch', label: 'Cherry' },
  { id: 'da', label: 'Date', disabled: true },
  { id: 'el', label: 'Elderberry' },
  { id: 'fi', label: 'Fig' },
];

class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];

  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }

  unobserve(el: Element): void {
    this.targets.delete(el);
  }

  disconnect(): void {
    this.targets.clear();
  }

  deliver(target: Element, size: number): void {
    const box: ResizeObserverSize = { blockSize: size, inlineSize: size };
    this.callback(
      [
        {
          target,
          borderBoxSize: [box],
          contentBoxSize: [box],
          devicePixelContentBoxSize: [box],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
    flushSync();
  }
}

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let restores: (() => void)[] = [];
let selectors = 0;

/** Options for the listbox the next `setup` will build. */
let boxOptions: Omit<ListboxOptions<Fruit>, 'listbox' | 'items'>;
let items: Signal.State<readonly Fruit[]>;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="outside">page</div>';
  host = document.querySelector('#app')!;
  boxOptions = {};
  items = new Signal.State<readonly Fruit[]>(FRUITS);

  FakeResizeObserver.live = [];
  const view = window as unknown as { ResizeObserver: unknown };
  const original = view.ResizeObserver;
  view.ResizeObserver = FakeResizeObserver;
  restores.push(() => {
    view.ResizeObserver = original;
  });
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  restores = [];
  vi.useRealTimers();
});

const PLAIN = `
  <div class="lb" :ref="root" :spread="lb.listboxProps()"
       :keydown="onKey($event)"
       :click="lb.onOptionClick($event)"
       :pointermove="lb.onOptionPointerMove($event)">
    <div class="option" :for="(item, i) in items.get()" :key="item.id"
         :spread="lb.optionProps({ index: i, value: item, disabled: item.disabled })"
    >{ item.label }</div>
  </div>
`;

const GROUPED = `
  <div class="lb" :ref="root" :spread="lb.listboxProps()" :keydown="onKey($event)">
    <div class="group" :spread="lb.groupProps('citrus')">
      <div class="heading" :spread="lb.groupLabelProps('citrus')">Citrus</div>
      <div class="option" :for="(item, i) in items.get()" :key="item.id"
           :spread="lb.optionProps({ index: i, value: item, disabled: item.disabled })"
      >{ item.label }</div>
    </div>
  </div>
`;

const VIRTUAL = `
  <div class="lb" :ref="root" :spread="lb.listboxProps()" :keydown="onKey($event)"
       :click="lb.onOptionClick($event)">
    <div class="sizer" :spread="lb.sizerProps()">
      <div class="box" :ref="box" :spread="lb.containerProps()">
        <div class="option" :for="v in lb.virtualItems()" :key="v.key"
             :spread="lb.optionProps({ index: v.index })">{ labelAt(v.index) }</div>
      </div>
    </div>
  </div>
`;

interface Instance {
  lb: Listbox<Fruit>;
  /** What `onKeyDown` returned for the last key the listbox saw. */
  handled: boolean;
}

interface Harness {
  lb: Listbox<Fruit>;
  instance: Instance;
  root: HTMLElement;
  options(): HTMLElement[];
  option(index: number): HTMLElement;
  /** Every option's `aria-selected`, so a whole selection reads as one line. */
  selectedFlags(): (string | null)[];
  labels(): string[];
}

function build(template: string): Harness {
  @Component({ selector: `v-lb-${++selectors}`, render: compileTemplate(template) })
  class ListboxComponent {
    root = new Signal.State<Element | null>(null);
    box = new Signal.State<Element | null>(null);
    items = items;
    handled = false;
    lb = createListbox<Fruit>({
      ...boxOptions,
      listbox: () => this.root.get(),
      items: () => this.items.get(),
      ...(boxOptions.virtual
        ? { virtual: { ...boxOptions.virtual, container: () => this.box.get() } }
        : {}),
    });

    labelAt(index: number): string {
      return this.items.get()[index]?.label ?? '';
    }

    onKey(event: KeyboardEvent): void {
      this.handled = this.lb.onKeyDown(event);
      if (this.handled) event.preventDefault();
    }
  }

  const handle = mount(ListboxComponent, host);
  mounted.push(handle);
  const instance = handle.instance as unknown as Instance;

  return {
    lb: instance.lb,
    instance,
    root: host.querySelector<HTMLElement>('.lb')!,
    options: () => [...host.querySelectorAll<HTMLElement>('.option')],
    option: (index) => host.querySelector<HTMLElement>(`[${OPTION_ATTRIBUTE}="${index}"]`)!,
    selectedFlags: () =>
      [...host.querySelectorAll<HTMLElement>('.option')].map((el) =>
        el.getAttribute('aria-selected'),
      ),
    labels: () => [...host.querySelectorAll<HTMLElement>('.option')].map((el) => el.textContent!),
  };
}

function setup(): Harness {
  return build(PLAIN);
}

/** Mount a virtualized listbox whose scroller has a known client box. */
function setupVirtual(count = 1000, height = 100): Harness {
  items.set(
    Array.from({ length: count }, (_, i) => ({ id: `i${i}`, label: `Option ${i}` }) as Fruit),
  );
  const harness = build(VIRTUAL);

  Object.defineProperty(harness.root, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(harness.root, 'clientWidth', { value: 0, configurable: true });
  // The size then arrives the way it does in a browser: through the observer,
  // after layout. Mounting already flushed, so this is the only way in.
  FakeResizeObserver.live.at(-1)!.deliver(harness.root, height);
  return harness;
}

function press(el: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  el.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

function click(el: HTMLElement, modifiers: Partial<MouseEventInit> = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
  flushSync();
}

/** The ids of the selected fruit, which is what every selection test compares. */
function ids(harness: Harness): string[] {
  return harness.lb.selectedValues().map((fruit) => fruit.id);
}

// ---------------------------------------------------------------------------

describe('what assistive technology is told', () => {
  it('marks the listbox and its options', () => {
    boxOptions = { label: 'Fruit' };
    const { root, option } = setup();

    expect(root.getAttribute('role')).toBe('listbox');
    expect(root.getAttribute('aria-label')).toBe('Fruit');
    // Vertical is ARIA's own default, so saying it adds nothing.
    expect(root.hasAttribute('aria-orientation')).toBe(false);
    expect(root.hasAttribute('aria-multiselectable')).toBe(false);

    expect(option(0).getAttribute('role')).toBe('option');
    expect(option(0).id).toBeTruthy();
  });

  it('prefers an external label to one of its own', () => {
    boxOptions = { label: 'ignored', labelledBy: 'heading-1' };
    const { root } = setup();

    expect(root.getAttribute('aria-labelledby')).toBe('heading-1');
    expect(root.hasAttribute('aria-label')).toBe(false);
  });

  it('states selection on only the selected option when one may be chosen', () => {
    const { lb, selectedFlags } = setup();
    lb.select(FRUITS[1]!);
    flushSync();

    // In a single-select listbox every option is selectable by definition of
    // the role, so "not selected" on the other five is five announcements of
    // something already known.
    expect(selectedFlags()).toEqual([null, 'true', null, null, null, null]);
  });

  it('states selection on every option when several may be chosen', () => {
    boxOptions = { selectionMode: 'multiple' };
    const { lb, root, selectedFlags } = setup();

    expect(root.getAttribute('aria-multiselectable')).toBe('true');
    lb.select(FRUITS[1]!);
    flushSync();
    // Here "false" is what tells the user the option can be toggled on.
    expect(selectedFlags()).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
  });

  it('says nothing about selection in a list that cannot be selected from', () => {
    boxOptions = { selectionMode: 'none' };
    const { selectedFlags } = setup();
    expect(selectedFlags()).toEqual([null, null, null, null, null, null]);
  });

  it('leaves a disabled option in the accessibility tree', () => {
    const { option } = setup();
    const date = option(3);

    // `aria-disabled`, not the `disabled` attribute: it can still be found and
    // heard to be unavailable rather than appear to have vanished.
    expect(date.getAttribute('aria-disabled')).toBe('true');
    expect(date.hasAttribute('disabled')).toBe(false);
    expect(date.hasAttribute('data-disabled')).toBe(true);
  });

  it('announces a horizontal listbox as horizontal', () => {
    boxOptions = { orientation: 'horizontal' };
    const { root } = setup();
    expect(root.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('marks the whole listbox unavailable and stops answering keys', () => {
    boxOptions = { disabled: () => true };
    const { root, instance, lb } = setup();

    expect(root.getAttribute('aria-disabled')).toBe('true');
    expect(press(root, 'ArrowDown')).toBe(false);
    expect(instance.handled).toBe(false);
    expect(lb.activeIndex()).toBe(-1);
  });
});

describe('the tab stop', () => {
  it('puts exactly one option in the tab order, starting at the first', () => {
    const { options } = setup();
    expect(options().map((el) => el.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
    ]);
  });

  it('moves the tab stop with the active option', () => {
    const { root, options } = setup();
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');

    // A twenty-option listbox that cost twenty Tab presses to step over would
    // be a keyboard trap in everything but name.
    expect(options().map((el) => el.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
      '-1',
      '-1',
      '-1',
    ]);
  });

  it('moves real focus onto the active option', () => {
    const { root, option } = setup();
    press(root, 'ArrowDown');
    expect(document.activeElement).toBe(option(0));
  });
});

describe('virtual focus', () => {
  it('moves an activedescendant and never touches DOM focus', () => {
    boxOptions = { virtualFocus: true };
    const { root, option, options } = setup();

    expect(root.getAttribute('tabindex')).toBe('0');
    // No option is focusable: DOM focus belongs to whatever is above, which for
    // a combobox is the text input, and typing must keep working.
    expect(options().every((el) => !el.hasAttribute('tabindex'))).toBe(true);

    root.focus();
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');

    expect(root.getAttribute('aria-activedescendant')).toBe(option(1).id);
    expect(document.activeElement).toBe(root);
    expect(option(1).hasAttribute('data-active')).toBe(true);
  });

  it('offers the activedescendant for an input that holds focus instead', () => {
    boxOptions = { virtualFocus: true, focusable: false };
    const { root, lb, option } = setup();

    // A second tab stop on a combobox popup is worse than none.
    expect(root.hasAttribute('tabindex')).toBe(false);
    expect(lb.activeDescendantProps()['aria-activedescendant']).toBeUndefined();

    press(root, 'ArrowDown');
    expect(lb.activeDescendantProps()['aria-activedescendant']).toBe(option(0).id);
  });
});

describe('moving', () => {
  it('steps down and up, skipping the disabled option', () => {
    const { root, lb } = setup();

    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    press(root, 'ArrowDown');
    expect(lb.activeIndex()).toBe(2);

    // Date, at 3, is disabled.
    press(root, 'ArrowDown');
    expect(lb.activeIndex()).toBe(4);
    press(root, 'ArrowUp');
    expect(lb.activeIndex()).toBe(2);
  });

  it('stops at the ends rather than wrapping', () => {
    const { root, lb } = setup();
    press(root, 'End');
    expect(lb.activeIndex()).toBe(5);

    // A listbox is a range being scanned; wrapping hides the fact that the end
    // was reached. The key is still consumed, or the page scrolls underneath.
    expect(press(root, 'ArrowDown')).toBe(true);
    expect(lb.activeIndex()).toBe(5);
  });

  it('wraps when asked to', () => {
    boxOptions = { loop: true };
    const { root, lb } = setup();
    press(root, 'End');
    press(root, 'ArrowDown');
    expect(lb.activeIndex()).toBe(0);
    press(root, 'ArrowUp');
    expect(lb.activeIndex()).toBe(5);
  });

  it('goes to the first and last option that can be moved to', () => {
    items.set([...FRUITS, { id: 'gr', label: 'Grape', disabled: true }]);
    const { root, lb } = setup();

    press(root, 'End');
    // Grape is disabled, so End lands on the last option that is not.
    expect(lb.activeIndex()).toBe(5);
    press(root, 'Home');
    expect(lb.activeIndex()).toBe(0);
  });

  it('pages by whole options and clamps at the ends', () => {
    boxOptions = { pageSize: 3 };
    const { root, lb } = setup();

    press(root, 'PageDown');
    expect(lb.activeIndex()).toBe(2);
    press(root, 'PageDown');
    // 2 + 3 lands on the disabled Date; the next one along is taken instead.
    expect(lb.activeIndex()).toBe(5);
    // Paging past the top means the top, unlike arrowing past it.
    press(root, 'PageUp');
    press(root, 'PageUp');
    expect(lb.activeIndex()).toBe(0);
  });

  it('mirrors the arrows in a right-to-left horizontal listbox', () => {
    boxOptions = { orientation: 'horizontal' };
    host.setAttribute('dir', 'rtl');
    const { root, lb } = setup();

    press(root, 'ArrowLeft');
    expect(lb.activeIndex()).toBe(0);
    press(root, 'ArrowLeft');
    expect(lb.activeIndex()).toBe(1);
    press(root, 'ArrowRight');
    expect(lb.activeIndex()).toBe(0);

    // Up and down are not mirrored, and are not this listbox's keys at all.
    expect(press(root, 'ArrowDown')).toBe(false);
  });

  it('leaves Alt to whatever wraps the listbox', () => {
    const { root, lb, instance } = setup();
    // Alt+ArrowDown opens a combobox; a listbox that swallowed it would break
    // the control around it.
    expect(press(root, 'ArrowDown', { altKey: true })).toBe(false);
    expect(instance.handled).toBe(false);
    expect(lb.activeIndex()).toBe(-1);
  });

  it('reports every move', () => {
    const onActiveChange = vi.fn();
    boxOptions = { onActiveChange };
    const { root } = setup();

    press(root, 'ArrowDown');
    press(root, 'End');
    expect(onActiveChange.mock.calls).toEqual([[0], [5]]);
  });

  it('pulls the active option back inside a collection that shrank', () => {
    const { root, lb } = setup();
    press(root, 'End');
    expect(lb.activeIndex()).toBe(5);

    // What filtering a combobox down to two matches looks like.
    items.set(FRUITS.slice(0, 2));
    flushSync();
    expect(lb.activeIndex()).toBe(1);
  });
});

describe('typeahead', () => {
  it('jumps to the option a letter starts', () => {
    const { root, lb } = setup();
    press(root, 'c');
    expect(lb.activeIndex()).toBe(2);
  });

  it('accumulates characters, then starts over', () => {
    vi.useFakeTimers();
    const { root, lb } = setup();

    press(root, 'e');
    expect(lb.activeIndex()).toBe(4);
    // "el" is still Elderberry; without accumulation the "l" would find nothing.
    press(root, 'l');
    expect(lb.activeIndex()).toBe(4);

    vi.advanceTimersByTime(600);
    press(root, 'f');
    expect(lb.activeIndex()).toBe(5);
  });

  it('walks through the options a repeated character starts', () => {
    items.set([
      { id: 'a1', label: 'Almond' },
      { id: 'a2', label: 'Apple' },
      { id: 'a3', label: 'Apricot' },
    ]);
    const { root, lb } = setup();

    press(root, 'a');
    expect(lb.activeIndex()).toBe(0);
    press(root, 'a');
    expect(lb.activeIndex()).toBe(1);
    press(root, 'a');
    expect(lb.activeIndex()).toBe(2);
  });

  it('ignores accents, because nobody types them to find a name', () => {
    items.set([
      { id: 'x', label: 'Apple' },
      { id: 'y', label: 'Éclair' },
    ]);
    const { root, lb } = setup();

    press(root, 'e');
    expect(lb.activeIndex()).toBe(1);
  });

  it('skips disabled options and reports an unmatched key as unhandled', () => {
    const { root, lb, instance } = setup();
    press(root, 'd');
    // Date is the only D, and it is disabled.
    expect(instance.handled).toBe(false);
    expect(lb.activeIndex()).toBe(-1);
  });

  it('can be turned off', () => {
    boxOptions = { typeahead: false };
    const { root, lb } = setup();
    press(root, 'c');
    expect(lb.activeIndex()).toBe(-1);
  });

  it('does not fire for a shortcut', () => {
    const { root, lb } = setup();
    press(root, 'c', { ctrlKey: true });
    expect(lb.activeIndex()).toBe(-1);
  });
});

describe('choosing one option', () => {
  it('selects with Enter and with Space', () => {
    const { root, lb } = setup();
    press(root, 'ArrowDown');
    press(root, 'Enter');
    expect(ids({ lb } as Harness)).toEqual(['ap']);

    press(root, 'ArrowDown');
    press(root, ' ');
    expect(lb.selectedValues().map((f) => f.id)).toEqual(['ba']);
  });

  it('replaces rather than accumulates when only one may be chosen', () => {
    const harness = setup();
    click(harness.option(0));
    click(harness.option(1));
    expect(ids(harness)).toEqual(['ba']);
  });

  it('leaves Enter alone while nothing is active', () => {
    const { root, instance } = setup();
    // The form still owns it: a listbox nobody has moved in has made no choice
    // to commit.
    expect(press(root, 'Enter')).toBe(false);
    expect(instance.handled).toBe(false);
  });

  it('selects as focus moves when told to', () => {
    boxOptions = { selectionFollowsFocus: true };
    const harness = setup();
    press(harness.root, 'ArrowDown');
    expect(ids(harness)).toEqual(['ap']);
    press(harness.root, 'ArrowDown');
    expect(ids(harness)).toEqual(['ba']);
  });

  it('reports the selection and can be driven from outside', () => {
    const onSelectionChange = vi.fn();
    const value = new Signal.State<readonly Fruit[]>([]);
    boxOptions = { value, onSelectionChange };
    const harness = setup();

    click(harness.option(2));
    expect(onSelectionChange).toHaveBeenCalledWith([FRUITS[2]]);
    expect(value.get()).toEqual([FRUITS[2]]);

    value.set([FRUITS[0]!]);
    flushSync();
    expect(harness.selectedFlags()[0]).toBe('true');
    expect(harness.option(2).hasAttribute('data-selected')).toBe(false);
  });

  it('refuses to leave nothing selected when the answer is mandatory', () => {
    boxOptions = { disallowEmptySelection: true, defaultValue: [FRUITS[1]!] };
    const harness = setup();

    harness.lb.clear();
    flushSync();
    expect(ids(harness)).toEqual(['ba']);
  });

  it('compares by key, so a re-fetched list keeps its selection', () => {
    boxOptions = { compareBy: (fruit) => fruit.id };
    const harness = setup();
    click(harness.option(1));

    // The same fruit, from the server, as different objects.
    items.set(FRUITS.map((fruit) => ({ ...fruit })));
    flushSync();

    expect(harness.option(1).getAttribute('aria-selected')).toBe('true');
    expect(harness.lb.isSelected({ id: 'ba', label: 'Banana' })).toBe(true);
  });
});

describe('choosing several options', () => {
  it('toggles on each press in multiple mode', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();

    click(harness.option(0));
    click(harness.option(2));
    expect(ids(harness)).toEqual(['ap', 'ch']);

    click(harness.option(0));
    expect(ids(harness)).toEqual(['ch']);
  });

  it('toggles with Space and moves without selecting with an arrow', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();

    press(harness.root, 'ArrowDown');
    press(harness.root, ' ');
    press(harness.root, 'ArrowDown');
    expect(ids(harness)).toEqual(['ap']);
    press(harness.root, ' ');
    expect(ids(harness)).toEqual(['ap', 'ba']);
  });

  it('toggles one option at a time with Shift and an arrow', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();

    click(harness.option(5));
    press(harness.root, 'Home');
    press(harness.root, 'ArrowDown', { shiftKey: true });
    press(harness.root, 'ArrowDown', { shiftKey: true });

    // In a multi-select listbox Shift+Arrow moves focus to and toggles the
    // next option, one at a time — it does not sweep a range, which is the
    // extended-selection pattern instead. So Banana and Cherry join Fig, and
    // Apple, which was only ever focused, does not.
    expect(ids(harness).sort()).toEqual(['ba', 'ch', 'fi']);
  });

  it('sweeps a range with Shift and an arrow in extended mode', () => {
    boxOptions = { selectionMode: 'extended' };
    const harness = setup();

    click(harness.option(0));
    press(harness.root, 'ArrowDown', { shiftKey: true });
    press(harness.root, 'ArrowDown', { shiftKey: true });

    // The other half of the same decision: extended selection is the desktop
    // file-list convention, where Shift+Arrow grows one contiguous range.
    expect(ids(harness).sort()).toEqual(['ap', 'ba', 'ch']);
  });

  it('takes a range from the anchor with Shift and Space', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();

    click(harness.option(1));
    // Banana(1) -> Cherry(2) -> over Date(3, disabled) -> Elderberry(4) -> Fig(5).
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown');
    expect(harness.lb.activeIndex()).toBe(5);

    press(harness.root, ' ', { shiftKey: true });
    // The range runs from the anchor to the active option, and the disabled
    // one inside it is not selectable however the range was drawn.
    expect(ids(harness)).toEqual(['ba', 'ch', 'el', 'fi']);
  });

  it('takes a range with Shift and a press', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();

    click(harness.option(1));
    click(harness.option(4), { shiftKey: true });
    expect(ids(harness)).toEqual(['ba', 'ch', 'el']);
  });

  it('selects every option with Ctrl+A, and clears with the same press', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();

    expect(press(harness.root, 'a', { ctrlKey: true })).toBe(true);
    expect(ids(harness)).toEqual(['ap', 'ba', 'ch', 'el', 'fi']);

    // Pressing it twice is what everyone tries, and there is no other key for
    // "none of them".
    press(harness.root, 'a', { ctrlKey: true });
    expect(ids(harness)).toEqual([]);
  });

  it('leaves Ctrl+A to the browser where only one may be chosen', () => {
    const { root, instance } = setup();
    expect(press(root, 'a', { ctrlKey: true })).toBe(false);
    expect(instance.handled).toBe(false);
  });

  it('counts the selection for a live region, in the locale', () => {
    boxOptions = { selectionMode: 'multiple' };
    const harness = setup();
    click(harness.option(0));
    click(harness.option(1));

    expect(harness.lb.status()).toBe('2 selected');
    expect(harness.lb.statusProps()).toEqual({ role: 'status' });
  });

  it('lets the count string be overridden', () => {
    boxOptions = {
      selectionMode: 'multiple',
      labels: { selected: (n) => `${n} fruits chosen` },
    };
    const harness = setup();
    click(harness.option(0));
    expect(harness.lb.status()).toBe('1 fruits chosen');
  });

  it('says nothing where only one option can be chosen', () => {
    const harness = setup();
    click(harness.option(0));
    // "1 selected" is noise where one is all there can be, and the option has
    // already been announced.
    expect(harness.lb.status()).toBe('');
  });
});

describe('extended selection', () => {
  beforeEach(() => {
    boxOptions = { selectionMode: 'extended' };
  });

  it('replaces the selection as the arrows move', () => {
    const harness = setup();
    press(harness.root, 'ArrowDown');
    expect(ids(harness)).toEqual(['ap']);
    press(harness.root, 'ArrowDown');
    expect(ids(harness)).toEqual(['ba']);
  });

  it('moves without selecting under Ctrl', () => {
    const harness = setup();
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown', { ctrlKey: true });

    // The escape hatch that makes an extended list navigable once something is
    // selected.
    expect(harness.lb.activeIndex()).toBe(1);
    expect(ids(harness)).toEqual(['ap']);
  });

  it('toggles one option with Ctrl and Space, leaving the rest', () => {
    const harness = setup();
    press(harness.root, 'ArrowDown');
    press(harness.root, 'ArrowDown', { ctrlKey: true });
    press(harness.root, 'ArrowDown', { ctrlKey: true });
    press(harness.root, ' ', { ctrlKey: true });
    expect(ids(harness)).toEqual(['ap', 'ch']);
  });

  it('replaces the selection with a Shift range rather than adding to it', () => {
    const harness = setup();
    click(harness.option(5));
    click(harness.option(0));
    click(harness.option(2), { shiftKey: true });

    // The range is the selection here, as in every file manager.
    expect(ids(harness)).toEqual(['ap', 'ba', 'ch']);
  });

  it('adds a second range under Ctrl and Shift', () => {
    const harness = setup();
    click(harness.option(0));
    click(harness.option(1), { shiftKey: true });
    click(harness.option(4));
    click(harness.option(5), { shiftKey: true, ctrlKey: true });
    expect(ids(harness)).toEqual(['el', 'fi']);
  });

  it('toggles one option with Ctrl and a press', () => {
    const harness = setup();
    click(harness.option(0));
    click(harness.option(2), { ctrlKey: true });
    expect(ids(harness)).toEqual(['ap', 'ch']);
    click(harness.option(0), { ctrlKey: true });
    expect(ids(harness)).toEqual(['ch']);
  });
});

describe('the pointer', () => {
  it('swallows a press on a disabled option', () => {
    const harness = setup();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    harness.option(3).dispatchEvent(event);
    flushSync();

    // Visibly there, and an `<a>` option would otherwise follow its href.
    expect(event.defaultPrevented).toBe(true);
    expect(ids(harness)).toEqual([]);
    expect(harness.lb.activeIndex()).toBe(-1);
  });

  it('resolves the option from markup inside it', () => {
    const harness = setup();
    const inner = document.createElement('span');
    harness.option(2).append(inner);
    click(inner);
    expect(ids(harness)).toEqual(['ch']);
  });

  it('leaves the highlight alone on hover unless asked', () => {
    const harness = setup();
    harness.option(2).dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    flushSync();
    expect(harness.lb.activeIndex()).toBe(-1);
  });

  it('follows the pointer when asked', () => {
    boxOptions = { focusOnHover: true };
    const harness = setup();
    harness.option(2).dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    flushSync();
    expect(harness.lb.activeIndex()).toBe(2);

    harness.option(3).dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    flushSync();
    expect(harness.lb.activeIndex()).toBe(2);
  });
});

describe('sections', () => {
  it('names a group with the heading inside it', () => {
    const harness = build(GROUPED);
    const group = host.querySelector('.group')!;
    const heading = host.querySelector('.heading')!;

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-labelledby')).toBe(heading.id);
    // A heading between a listbox and its options would be read twice: once as
    // itself, once as the group's name.
    expect(heading.getAttribute('role')).toBe('presentation');
    expect(harness.lb.count()).toBe(6);
  });

  it('still navigates across the group', () => {
    const harness = build(GROUPED);
    press(harness.root, 'End');
    expect(harness.lb.activeIndex()).toBe(5);
  });
});

describe('virtualized', () => {
  it('renders a window of a thousand options', () => {
    boxOptions = { virtual: { container: () => null, itemSize: 20 } };
    const harness = setupVirtual();

    // Five options fill a hundred pixels, plus two of overscan each way.
    expect(harness.options()).toHaveLength(7);
    expect(harness.labels()[0]).toBe('Option 0');
    expect(harness.lb.count()).toBe(1000);
  });

  it('counts the whole collection, not the window', () => {
    boxOptions = { virtual: { container: () => null, itemSize: 20 } };
    const harness = setupVirtual();

    // Virtualization is invisible to a sighted reader and a lie to everyone
    // else unless the real numbers are put back by hand.
    expect(harness.option(3).getAttribute('aria-setsize')).toBe('1000');
    expect(harness.option(3).getAttribute('aria-posinset')).toBe('4');
  });

  it('hides the scrolling scaffolding from the accessibility tree', () => {
    boxOptions = { virtual: { container: () => null, itemSize: 20 } };
    setupVirtual();

    const sizer = host.querySelector<HTMLElement>('.sizer')!;
    const box = host.querySelector<HTMLElement>('.box')!;
    // A listbox owns options; a generic element in between would break that.
    expect(sizer.getAttribute('role')).toBe('presentation');
    expect(box.getAttribute('role')).toBe('presentation');
    expect(sizer.style.height).toBe('20000px');
  });

  it('reaches an option that was never rendered, and renders it', () => {
    boxOptions = { virtual: { container: () => null, itemSize: 20 } };
    const harness = setupVirtual();

    press(harness.root, 'End');
    expect(harness.lb.activeIndex()).toBe(999);
    expect(harness.root.scrollTop).toBe(19_900);
    // The option exists now, and holds DOM focus, though the key that moved to
    // it was pressed while it did not exist at all.
    expect(harness.option(999)).not.toBeNull();
    expect(document.activeElement).toBe(harness.option(999));
  });

  it('pages by what the viewport actually holds', () => {
    boxOptions = { virtual: { container: () => null, itemSize: 20 } };
    const harness = setupVirtual();

    press(harness.root, 'Home');
    press(harness.root, 'PageDown');
    // Four whole options fit above the fold, so that is what a page is.
    expect(harness.lb.activeIndex()).toBe(4);
  });

  it('points the activedescendant at an option before it renders', () => {
    boxOptions = { virtualFocus: true, virtual: { container: () => null, itemSize: 20 } };
    const harness = setupVirtual();

    press(harness.root, 'End');
    // The id is derived from the position, not read back off the DOM, so it is
    // right the instant the option is asked for.
    expect(harness.root.getAttribute('aria-activedescendant')).toBe(harness.option(999).id);
  });

  it('selects an option that scrolled far out of the window', () => {
    boxOptions = {
      selectionMode: 'multiple',
      compareBy: (fruit) => fruit.id,
      virtual: { container: () => null, itemSize: 20 },
    };
    const harness = setupVirtual(1000);

    press(harness.root, 'Home');
    press(harness.root, ' ');
    press(harness.root, 'End');
    press(harness.root, ' ', { shiftKey: true });

    // A thousand values, none of which the DOM ever held more than seven of.
    expect(harness.lb.selectedValues()).toHaveLength(1000);
  });
});
