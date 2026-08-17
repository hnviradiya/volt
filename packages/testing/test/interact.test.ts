/**
 * Interactions, against a real primitive wherever the answer depends on one.
 *
 * The checkbox from `@voltdev/primitives` is used rather than a hand-written
 * `<div role="checkbox">` on purpose: it disables with `aria-disabled` and
 * keeps a visually hidden native `<input type="checkbox">` beside the control
 * for form submission, which is exactly the shape that catches a query written
 * against markup — two checkboxes in the DOM, one in the accessibility tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, flushSync } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createCheckbox } from '@voltdev/primitives';
import { getByRole, queryAllByRole } from '../src/queries.ts';
import { cleanup, render } from '../src/render.ts';
import { blur, clear, click, focus, hover, press, typeText, unhover } from '../src/interact.ts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** Whether the checkbox the next render builds is disabled. */
let disabled = new Signal.State(false);

beforeEach(() => {
  disabled = new Signal.State(false);
});

const markup = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.body;
};

/** Every event a listener saw, in the order it arrived. */
function record(element: Element, types: readonly string[]): string[] {
  const seen: string[] = [];
  for (const type of types) element.addEventListener(type, (event) => seen.push(event.type));
  return seen;
}

const POINTER_SEQUENCE = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
] as const;

// ---------------------------------------------------------------------------
// A real checkbox
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-check',
  render: compileTemplate(`
    <div>
      <div :spread="cb.controlProps()"
           :click="cb.toggle()"
           :keydown="cb.onKeyDown($event)">Ship it</div>
      <input :ref="input" :spread="cb.inputProps()">
    </div>
  `),
})
class CheckboxComponent {
  input = new Signal.State<Element | null>(null);
  cb = createCheckbox({
    disabled: () => disabled.get(),
    input: () => this.input.get(),
  });
}

describe('finding a primitive through its accessibility surface', () => {
  it('finds the control and not the hidden input that submits it', () => {
    const view = render(CheckboxComponent);

    // Two elements in the DOM expose a checkbox role; one of them is
    // `aria-hidden`, so a user — and this query — sees one.
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(queryAllByRole(view.container, 'checkbox', { hidden: true })).toHaveLength(2);

    // Unnarrowed on purpose. Asking by name would pick the control whether or
    // not the query consulted the accessibility tree, since the mirror carries
    // no name; asking for "the checkbox" is only unambiguous because the
    // mirror is not in the tree at all. This is the assertion that goes red if
    // the hidden filter is dropped — it starts throwing on two matches.
    const control = view.getByRole('checkbox');
    expect(control).toBe(view.getByRole('checkbox', { name: 'Ship it' }));
    expect(control.tagName.toLowerCase()).toBe('div');
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('narrows by the state the primitive publishes', () => {
    const view = render(CheckboxComponent);
    view.instance.cb.setChecked(true);
    flushSync();

    expect(view.getByRole('checkbox', { checked: true, name: 'Ship it' })).toBeTruthy();
    expect(view.queryByRole('checkbox', { checked: false })).toBeNull();
  });
});

describe('click', () => {
  it('dispatches the sequence a browser dispatches, in order', () => {
    const root = markup('<button>Save</button>');
    const button = getByRole(root, 'button');
    const seen = record(button, POINTER_SEQUENCE);

    click(button);

    expect(seen).toEqual([...POINTER_SEQUENCE]);
  });

  it('drives a primitive that only listens for one of them', () => {
    const view = render(CheckboxComponent);
    const control = view.getByRole('checkbox', { name: 'Ship it' });

    click(control);
    expect(view.instance.cb.isChecked()).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('true');

    click(control);
    expect(view.instance.cb.isChecked()).toBe(false);
  });

  it('keeps the hidden input in step, so the form would submit what is on screen', () => {
    const view = render(CheckboxComponent);
    click(view.getByRole('checkbox', { name: 'Ship it' }));

    expect(view.container.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });

  it('moves focus on mousedown, to the nearest focusable ancestor', () => {
    const root = markup('<button><span id="label">Save</span></button>');
    click(document.querySelector('#label')!);

    expect(document.activeElement).toBe(root.querySelector('button'));
  });

  it('leaves focus alone when mousedown is cancelled', () => {
    const root = markup('<input id="field"><button>Save</button>');
    const field = root.querySelector<HTMLInputElement>('#field')!;
    field.focus();

    const button = root.querySelector('button')!;
    // What a menu trigger does to keep focus where it is while its items are
    // pressed.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    click(button);

    expect(document.activeElement).toBe(field);
  });

  it('takes focus off everything when nothing focusable was pressed', () => {
    const root = markup('<input id="field"><div id="page">background</div>');
    root.querySelector<HTMLInputElement>('#field')!.focus();

    click(root.querySelector('#page')!);

    expect(document.activeElement).not.toBe(root.querySelector('#field'));
  });

  it('focuses an element that is out of the Tab order but not out of reach', () => {
    const root = markup('<div role="option" tabindex="-1">Apple</div>');
    const option = getByRole(root, 'option');

    click(option);

    expect(document.activeElement).toBe(option);
  });
});

describe('a disabled control', () => {
  it('receives nothing at all when the platform would drop it', () => {
    const root = markup('<button disabled><span id="label">Save</span></button>');
    const seen = record(root, POINTER_SEQUENCE);

    click(root.querySelector('#label')!);

    // Not even `pointerdown`: a browser delivers no pointer event to a
    // disabled control, so dispatching one would test a sequence no user can
    // produce.
    expect(seen).toEqual([]);
  });

  it('receives every event when it is only aria-disabled, and ignores them', () => {
    disabled.set(true);
    const view = render(CheckboxComponent);
    const control = view.getByRole('checkbox', { name: 'Ship it' });
    expect(control.getAttribute('aria-disabled')).toBe('true');

    const seen = record(control, POINTER_SEQUENCE);
    click(control);

    // The events land — `aria-disabled` says nothing to the browser, and
    // refusing to dispatch would make this test pass against a component that
    // never checks. It is the primitive that declines to change.
    expect(seen).toEqual([...POINTER_SEQUENCE]);
    expect(view.instance.cb.isChecked()).toBe(false);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('starts working again when it is enabled', () => {
    disabled.set(true);
    const view = render(CheckboxComponent);
    const control = view.getByRole('checkbox', { name: 'Ship it' });

    click(control);
    expect(view.instance.cb.isChecked()).toBe(false);

    disabled.set(false);
    flushSync();
    click(control);
    expect(view.instance.cb.isChecked()).toBe(true);
  });

  it('is not typed into when it is readonly', () => {
    const root = markup('<input id="a" readonly value="fixed"><input id="b" disabled>');
    typeText(root.querySelector('#a')!, 'x');
    typeText(root.querySelector('#b')!, 'x');

    expect(root.querySelector<HTMLInputElement>('#a')!.value).toBe('fixed');
    expect(root.querySelector<HTMLInputElement>('#b')!.value).toBe('');
  });
});

describe('press', () => {
  it('raises the click a browser raises from Enter, before the key comes up', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['keydown', 'click', 'keyup']);

    press(button, 'Enter');

    expect(seen).toEqual(['keydown', 'click', 'keyup']);
  });

  it('raises it from Space after the key comes up', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['keydown', 'click', 'keyup']);

    press(button, ' ');

    // The order is the reason a component cancels Space on keydown: the click
    // it is suppressing has not happened yet.
    expect(seen).toEqual(['keydown', 'keyup', 'click']);
  });

  it('suppresses that click when the keydown was cancelled', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const clicks = vi.fn();
    button.addEventListener('click', clicks);
    button.addEventListener('keydown', (event) => event.preventDefault());

    press(button, ' ');
    press(button, 'Enter');

    expect(clicks).not.toHaveBeenCalled();
  });

  it('toggles a checkbox once on Space, not twice', () => {
    @Component({
      selector: 'v-check-button',
      render: compileTemplate(`
        <button :spread="cb.controlProps()"
                :click="cb.toggle()"
                :keydown="cb.onKeyDown($event)">Ship it</button>
      `),
    })
    class CheckboxButton {
      cb = createCheckbox();
    }

    const view = render(CheckboxButton);
    press(view.getByRole('checkbox', { name: 'Ship it' }), ' ');

    // The primitive toggles from its own keydown handler and cancels the
    // event; the click the browser would otherwise raise on keyup — and would
    // toggle straight back — never arrives.
    expect(view.instance.cb.isChecked()).toBe(true);
  });

  it('raises no click for a widget built out of divs', () => {
    const root = markup('<div role="button" tabindex="0">Save</div>');
    const control = getByRole(root, 'button');
    const clicks = vi.fn();
    control.addEventListener('click', clicks);

    press(control, 'Enter');
    press(control, ' ');

    // No browser synthesizes a click for `role="button"`. A helper that did
    // would make a widget with no keydown handler look reachable by keyboard
    // when it is not.
    expect(clicks).not.toHaveBeenCalled();
  });

  it('follows a link on Enter but not on Space', () => {
    const root = markup('<a href="/x">Go</a><a id="nohref">Go</a>');
    const link = root.querySelector('a')!;
    const clicks = vi.fn();
    link.addEventListener('click', clicks);
    root.querySelector('#nohref')!.addEventListener('click', clicks);

    press(link, ' ');
    expect(clicks).not.toHaveBeenCalled();

    press(link, 'Enter');
    expect(clicks).toHaveBeenCalledTimes(1);

    press(root.querySelector('#nohref')!, 'Enter');
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('carries modifiers and reaches a delegated handler', () => {
    @Component({
      selector: 'v-keys',
      render: compileTemplate(`
        <div :keydown="log($event)" tabindex="0" role="grid">
          <span>{ last.get() }</span>
        </div>
      `),
    })
    class Keys {
      last = new Signal.State('');
      log(event: KeyboardEvent): void {
        this.last.set(`${event.shiftKey ? 'Shift+' : ''}${event.key}`);
      }
    }

    const view = render(Keys);
    press(view.getByRole('grid'), 'ArrowDown', { shiftKey: true });

    expect(view.getByRole('grid').textContent).toBe('Shift+ArrowDown');
  });

  it('does nothing to a natively disabled control', () => {
    const root = markup('<button disabled>Save</button>');
    const seen = record(root, ['keydown', 'keyup', 'click']);

    press(root.querySelector('button')!, 'Enter');

    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-search',
  render: compileTemplate(`
    <div>
      <input aria-label="Search"
             :value="text.get()"
             :input="text.set($event.target.value)">
      <p role="status">{ text.get() }</p>
    </div>
  `),
})
class Search {
  text = new Signal.State('');
}

describe('typing', () => {
  it('sends one event per character', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    const inputs: string[] = [];
    field.addEventListener('input', (event) => inputs.push(String((event as InputEvent).data)));

    typeText(field, 'cat');

    // A search box that debounces, or a tags input that splits on a comma,
    // behaves differently for three events than for one assignment to `value`.
    expect(inputs).toEqual(['c', 'a', 't']);
    expect(view.instance.text.get()).toBe('cat');
    expect(view.getByRole('status').textContent).toBe('cat');
  });

  it('settles the DOM between characters', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    const rendered: string[] = [];
    field.addEventListener('keydown', () => rendered.push(view.getByRole('status').textContent!));

    typeText(field, 'cat');

    // What the page showed as each key went down: the character before it is
    // already painted. Volt coalesces onto a microtask, so this is the
    // assertion that the helper flushes rather than leaving three keystrokes
    // to land at once — which is the difference between a debounce test that
    // means something and one that does not.
    expect(rendered).toEqual(['', 'c', 'ca']);
  });

  it('focuses the field first, the way typing into one requires', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });

    typeText(field, 'a');

    expect(document.activeElement).toBe(field);
  });

  it('counts a character built from a surrogate pair as one keystroke', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    const keys: string[] = [];
    field.addEventListener('keydown', (event) => keys.push((event as KeyboardEvent).key));

    typeText(field, 'a🎉');

    expect(keys).toEqual(['a', '🎉']);
    expect(view.instance.text.get()).toBe('a🎉');
  });

  it('writes nothing when beforeinput is cancelled', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    field.addEventListener('beforeinput', (event) => event.preventDefault());
    const keys: string[] = [];
    field.addEventListener('keyup', (event) => keys.push((event as KeyboardEvent).key));

    typeText(field, 'ab');

    expect(view.instance.text.get()).toBe('');
    // The character is suppressed; the key still comes back up.
    expect(keys).toEqual(['a', 'b']);
  });

  it('empties a field with one deletion rather than one per character', () => {
    const view = render(Search);
    const field = view.getByRole('textbox', { name: 'Search' });
    typeText(field, 'cat');

    const types: string[] = [];
    field.addEventListener('input', (event) => types.push((event as InputEvent).inputType));
    clear(field);

    expect(types).toEqual(['deleteContentBackward']);
    expect(view.instance.text.get()).toBe('');
  });

  it('says what to do instead when given something that is not a field', () => {
    const root = markup('<div role="textbox">rich</div>');
    expect(() => typeText(getByRole(root, 'textbox'), 'x')).toThrow(/needs a text field/);
    expect(() => clear(getByRole(root, 'textbox'))).toThrow(/needs a text field/);
  });
});

// ---------------------------------------------------------------------------
// Pointer arrival, focus
// ---------------------------------------------------------------------------

describe('hover', () => {
  it('sends the arrival sequence, with enter events not bubbling', () => {
    const root = markup('<div id="outer"><button>Save</button></div>');
    const button = root.querySelector('button')!;
    const types = [
      'pointerover',
      'pointerenter',
      'mouseover',
      'mouseenter',
      'pointermove',
      'mousemove',
    ];
    const onButton = record(button, types);
    const onOuter = record(root.querySelector('#outer')!, types);

    hover(button);

    expect(onButton).toEqual(types);
    // `enter` is per-element and does not bubble; a handler that cares is on
    // the element being entered.
    expect(onOuter).toEqual(['pointerover', 'mouseover', 'pointermove', 'mousemove']);
  });

  it('sends the departure sequence', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']);

    unhover(button);

    expect(seen).toEqual(['pointerout', 'pointerleave', 'mouseout', 'mouseleave']);
  });

  it('is separate from a press, because touch and keyboard produce no hover', () => {
    const root = markup('<button>Save</button>');
    const button = root.querySelector('button')!;
    const seen = record(button, ['pointerover', 'mouseover']);

    click(button);

    expect(seen).toEqual([]);
  });
});

describe('focus', () => {
  it('moves what the platform considers focused, not just the listeners', () => {
    const root = markup('<button id="a">A</button><button id="b">B</button>');
    const a = root.querySelector<HTMLElement>('#a')!;
    const seen = record(a, ['focus', 'blur']);

    focus(a);
    expect(document.activeElement).toBe(a);

    blur(a);
    expect(document.activeElement).not.toBe(a);
    expect(seen).toEqual(['focus', 'blur']);
  });
});
