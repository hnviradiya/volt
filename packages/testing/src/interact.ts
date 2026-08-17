/**
 * Drive a component the way a person does — with the event sequence the
 * platform actually produces, not the one event the handler happens to listen
 * for.
 *
 * Calling `element.click()` tests nothing about a widget that closes on
 * `pointerdown`, focuses on `mousedown`, or activates from the keyboard. Every
 * helper here dispatches the full sequence, in the order a browser dispatches
 * it, and flushes the scheduler between each one — a browser reaches a
 * microtask checkpoint after every event, so a component that reads a signal
 * written by `pointerdown` while handling `mouseup` must see the new value
 * here too.
 *
 * They are all synchronous: the DOM is settled by the time one returns. Work
 * that has to wait on a promise needs `await settle()`, and work that has to
 * wait on a timer needs the clock advanced.
 *
 * Two rules are worth knowing before reading the code:
 *
 *   - **`aria-disabled` is clicked.** The platform delivers every event to an
 *     `aria-disabled` element, because the attribute says nothing to the
 *     browser — it is the widget's own job to ignore the press. Refusing to
 *     dispatch would make every "a disabled item does nothing" test pass
 *     against a component that never checks, which is the bug those tests
 *     exist to catch. Volt's primitives disable with `aria-disabled` almost
 *     everywhere, precisely so a disabled control stays reachable by keyboard,
 *     so this is the common case rather than the exotic one.
 *   - **The `disabled` attribute is not.** There the platform really does drop
 *     the event, so dispatching one would test a sequence no user can produce.
 *
 * `click()` does not imply `hover()`. A pointer arriving is a separate thing
 * from a press — keyboard and touch activation produce no hover at all — and a
 * tooltip that only opens on hover should have to be hovered.
 */

import { flushSync } from '@voltdev/core';
import { isTextField } from './aria.js';

const tagOf = (element: Element): string => element.tagName.toLowerCase();

/** Elements the `disabled` attribute actually applies to. */
const DISABLEABLE = new Set([
  'button',
  'fieldset',
  'input',
  'optgroup',
  'option',
  'select',
  'textarea',
]);

/**
 * Whether the platform would refuse to deliver a pointer event here.
 *
 * Checked up the chain: a press lands on the `<span>` inside a disabled
 * button, and a `<fieldset disabled>` disables everything it contains.
 */
function isNativelyDisabled(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (DISABLEABLE.has(tagOf(node)) && node.hasAttribute('disabled')) return true;
  }
  return false;
}

const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, ' +
  '[contenteditable=""], [contenteditable="true"], [tabindex]';

/**
 * What a press focuses: the nearest focusable ancestor-or-self, or nothing.
 *
 * `tabindex="-1"` counts. It takes an element out of the Tab order, not out of
 * reach of the pointer, and that is the whole basis of roving focus — the
 * options in a listbox are all `-1` but a click still focuses the one pressed.
 */
function focusTarget(element: Element): HTMLElement | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches(FOCUSABLE) && !isNativelyDisabled(node)) return node as HTMLElement;
  }
  return null;
}

function fire(element: Element, event: Event): boolean {
  const notCancelled = element.dispatchEvent(event);
  flushSync();
  return notCancelled;
}

const pointer = (type: string, init: PointerEventInit): PointerEvent =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    ...init,
  });

const mouse = (type: string, init: MouseEventInit): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, ...init });

/**
 * A full mouse press: down, focus, up, click.
 *
 * Focus moves on `mousedown` and only if nothing cancelled it, which is how a
 * menu keeps focus on its trigger while its items are pressed — the handler
 * calls `preventDefault()` on the down, and the browser leaves focus alone.
 */
export function click(element: Element, init: PointerEventInit = {}): void {
  if (isNativelyDisabled(element)) return;

  fire(element, pointer('pointerdown', { button: 0, buttons: 1, ...init }));

  if (fire(element, mouse('mousedown', { button: 0, buttons: 1, ...init }))) {
    const target = focusTarget(element);
    if (target) target.focus();
    // A press on nothing focusable takes focus off whatever had it, rather
    // than leaving a stale ring behind — this is how clicking the page
    // background dismisses a focus-driven popover.
    else (element.ownerDocument.activeElement as HTMLElement | null)?.blur();
    flushSync();
  }

  fire(element, pointer('pointerup', { button: 0, buttons: 0, ...init }));
  fire(element, mouse('mouseup', { button: 0, buttons: 0, ...init }));
  fire(element, mouse('click', { button: 0, buttons: 0, ...init }));
}

/** The pointer arriving over an element. */
export function hover(element: Element, init: PointerEventInit = {}): void {
  if (isNativelyDisabled(element)) return;

  fire(element, pointer('pointerover', init));
  // `enter` does not bubble; the platform fires one per element entered, and a
  // handler that cares is on the element being entered.
  fire(element, pointer('pointerenter', { ...init, bubbles: false }));
  fire(element, mouse('mouseover', init));
  fire(element, mouse('mouseenter', { ...init, bubbles: false }));
  fire(element, pointer('pointermove', init));
  fire(element, mouse('mousemove', init));
}

/** The pointer leaving an element. */
export function unhover(element: Element, init: PointerEventInit = {}): void {
  if (isNativelyDisabled(element)) return;

  fire(element, pointer('pointerout', init));
  fire(element, pointer('pointerleave', { ...init, bubbles: false }));
  fire(element, mouse('mouseout', init));
  fire(element, mouse('mouseleave', { ...init, bubbles: false }));
}

/**
 * Move focus, through the platform rather than by dispatching a `focus` event.
 *
 * `dispatchEvent(new FocusEvent('focus'))` notifies the listeners and leaves
 * `document.activeElement` pointing somewhere else, so every subsequent
 * assertion about focus is a lie. `.focus()` is what a browser does.
 */
export function focus(element: Element): void {
  (element as HTMLElement).focus();
  flushSync();
}

export function blur(element: Element): void {
  (element as HTMLElement).blur();
  flushSync();
}

/**
 * Whether the browser itself would raise a click from this key.
 *
 * Only the host language's own activation is listed. A `<div role="button">`
 * is not here, because no browser synthesizes a click for one — a widget built
 * out of `<div>`s has to handle the key itself, and a helper that clicked on
 * its behalf would hide exactly the omission that leaves keyboard users stuck.
 */
function nativeActivation(element: Element, key: string): boolean {
  const activation = key === 'Enter' || key === ' ';
  switch (tagOf(element)) {
    case 'button':
    case 'summary':
      return activation;
    case 'a':
    case 'area':
      // Space scrolls the page on a link; only Enter follows it.
      return key === 'Enter' && element.hasAttribute('href');
    case 'input': {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return key === ' ';
      return (type === 'button' || type === 'submit' || type === 'reset') && activation;
    }
    default:
      return false;
  }
}

/**
 * Press and release a key.
 *
 * The click a browser raises from Enter or Space is raised here too, and at
 * the point the browser raises it: Enter activates on the way down, Space on
 * the way up. That difference is not pedantry — a component cancelling Space
 * on `keydown` to stop the page scrolling is also, on a `<button>`, cancelling
 * the click that would otherwise arrive on `keyup` and toggle it a second
 * time. Getting the order wrong here would make that double-toggle invisible.
 */
export function press(element: Element, key: string, init: KeyboardEventInit = {}): void {
  if (isNativelyDisabled(element)) return;

  const alive = fire(
    element,
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init, key }),
  );

  if (alive && key === 'Enter' && nativeActivation(element, key)) {
    fire(element, mouse('click', { detail: 0 }));
  }

  fire(element, new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init, key }));

  if (alive && key === ' ' && nativeActivation(element, key)) {
    fire(element, mouse('click', { detail: 0 }));
  }
}

/**
 * Type into a text field, one character at a time.
 *
 * Per character, because that is what the field's own handler sees: a search
 * box that debounces, a tags input that splits on a comma, and a masked date
 * field all behave differently for "0102" arriving as four events than as one
 * assignment to `value`.
 *
 * Text is appended. There is no caret model here — `clear()` covers replacing
 * what is there, and anything finer belongs in an end-to-end test with a real
 * browser behind it.
 */
export function typeText(element: Element, text: string): void {
  const field = writableField(element, 'typeText');
  if (!field) return;

  focus(field);

  // Iterating the string rather than indexing it: an emoji or an accented
  // character built from a surrogate pair is one keystroke, not two.
  for (const char of text) {
    if (fire(field, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }))) {
      insert(field, char, 'insertText', field.value + char);
    }
    // Released whatever happened above: cancelling a keydown suppresses the
    // character, never the key coming back up.
    fire(field, new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
  }
}

/**
 * Empty a text field the way selecting all and deleting does — one
 * `deleteContentBackward`, not one per character.
 */
export function clear(element: Element): void {
  const field = writableField(element, 'clear');
  if (!field || field.value === '') return;

  focus(field);
  insert(field, null, 'deleteContentBackward', '');
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * The field, or null when the platform would ignore the input anyway.
 *
 * A wrong element is a mistake in the test and throws; a `readonly` or
 * disabled field is a legitimate state to drive at, and typing into one
 * quietly doing nothing is exactly what a browser does.
 */
function writableField(element: Element, helper: string): TextField | null {
  if (!isTextField(element)) {
    throw new Error(
      `[volt] ${helper}() needs a text field, but was given <${tagOf(element)}>. ` +
        'For a contenteditable or a custom editor, dispatch the input events the ' +
        'component listens for directly.',
    );
  }
  if (isNativelyDisabled(element) || element.hasAttribute('readonly')) return null;
  return element as TextField;
}

/** `beforeinput`, the write, then `input` — cancelling the first skips both. */
function insert(field: TextField, data: string | null, inputType: string, next: string): void {
  const before = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data,
  });
  if (!fire(field, before)) return;

  field.value = next;
  fire(field, new InputEvent('input', { bubbles: true, inputType, data }));
}
