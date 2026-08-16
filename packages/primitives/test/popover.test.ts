/**
 * Popover, driven through real mounted components.
 *
 * The interesting behaviour is all in the corners: that a non-modal popover
 * leaves the page behind alone, that Tab leaves it beside the trigger rather
 * than beside the portal, that the trigger is not "outside" itself, and that a
 * real button is left to turn Enter into a click on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@volt/core/jit';
import { Signal, defineComponent, flushSync, mount } from '@volt/core';
import { createPopover, type PopoverOptions } from '../src/popover.ts';
import { dismissStackSize } from '../src/dismiss.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

const TEMPLATE = `
  <div>
    <button :ref="trigger" :spread="popover.triggerProps()">open</button>
    <div :if="popover.isPresent()" :portal :ref="content" :spread="popover.contentProps()">
      <h2 :spread="popover.titleProps()">Filters</h2>
      <p :spread="popover.descriptionProps()">Narrow the list</p>
      <button class="one">one</button>
      <button class="two">two</button>
      <button class="close" :spread="popover.closeProps()">x</button>
    </div>
  </div>
`;

/** A trigger the browser knows nothing about, to check what we add to it. */
const DIV_TRIGGER = `
  <div>
    <div :ref="trigger" :spread="popover.triggerProps()">open</div>
    <div :if="popover.isPresent()" :portal :ref="content" :spread="popover.contentProps()">
      <button class="one">one</button>
    </div>
  </div>
`;

/** No title, no description — the case where a label has to come from options. */
const UNTITLED = `
  <div>
    <button :ref="trigger" :spread="popover.triggerProps()">open</button>
    <div :if="popover.isPresent()" :portal :ref="content" :spread="popover.contentProps()">
      <button class="one">one</button>
    </div>
  </div>
`;

let seq = 0;

/**
 * Mount a popover built with `options`.
 *
 * `defineComponent` rather than `@Component` because the tests differ by
 * options rather than by markup; it is what the decorator reduces to.
 */
function mountPopover(
  options: Partial<PopoverOptions> = {},
  template: string = TEMPLATE,
  container: HTMLElement = host,
) {
  class Demo {
    trigger = new Signal.State<Element | null>(null);
    content = new Signal.State<Element | null>(null);
    popover = createPopover({
      trigger: () => this.trigger.get(),
      content: () => this.content.get(),
      ...options,
    });
  }

  seq += 1;
  defineComponent(Demo, { selector: `v-popover-${seq}`, render: compileTemplate(template) });

  const handle = track(mount(Demo, container));
  const instance = handle.instance as Demo;
  return {
    handle,
    popover: instance.popover,
    trigger: () => container.querySelector<HTMLElement>('[aria-haspopup]')!,
    content: () => container.ownerDocument.querySelector<HTMLElement>('[role="dialog"]'),
  };
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function press(el: Element) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup', { bubbles: true }));
}

function keydown(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

function after(): HTMLElement {
  return document.querySelector<HTMLElement>('#after')!;
}

beforeEach(() => {
  // `#after` sits past the component in tab order, which is where Tab out of a
  // popover has to land — and nowhere near where the portal puts the content.
  document.body.innerHTML =
    '<div id="app"></div><div id="behind">page</div><button id="after">after</button>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.unstubAllGlobals();
});

describe('opening and closing', () => {
  it('starts closed with nothing rendered', () => {
    const { content } = mountPopover();
    expect(content()).toBeNull();
  });

  it('opens from the trigger without the consumer wiring a handler', () => {
    const { trigger, content } = mountPopover();
    // No `:click` in the template: the props carry it, so a trigger cannot be
    // shipped that the mouse opens and the keyboard does not.
    trigger().click();
    flushSync();

    expect(content()).not.toBeNull();
    // Portalled, so it escapes any ancestor's overflow and stacking context.
    expect(host.contains(content())).toBe(false);
  });

  it('toggles once per click, however many times the props are re-applied', () => {
    const onOpenChange = vi.fn();
    const { trigger, content } = mountPopover({ onOpenChange });

    for (let i = 0; i < 4; i++) {
      trigger().click();
      flushSync();
    }

    // Spreading re-applies the whole bag on every state change. A handler built
    // per call would be registered again each time, and the second click would
    // toggle twice and appear to do nothing.
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false, true, false]);
    expect(content()).toBeNull();
  });

  it('closes on Escape', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    escape();
    flushSync();
    expect(content()).toBeNull();
  });

  it('closes on a press outside', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    press(document.querySelector('#behind')!);
    flushSync();
    expect(content()).toBeNull();
  });

  it('does not treat the trigger as outside', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    // Dismissal must ignore this press, or it would close the popover and the
    // trigger's own click would open it straight back up.
    press(trigger());
    flushSync();
    expect(content()).not.toBeNull();

    trigger().click();
    flushSync();
    expect(content()).toBeNull();
  });

  it('honours closeOnEscape and closeOnOutsidePointer', () => {
    const { trigger, content } = mountPopover({
      closeOnEscape: false,
      closeOnOutsidePointer: false,
    });
    trigger().click();
    flushSync();

    escape();
    press(document.querySelector('#behind')!);
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('reports nothing when asked to close while already closed', () => {
    const onOpenChange = vi.fn();
    const { popover } = mountPopover({ onOpenChange });

    popover.close();
    flushSync();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('follows a signal supplied from outside, and writes back to it', () => {
    const open = new Signal.State(false);
    const { content } = mountPopover({ open });

    open.set(true);
    flushSync();
    expect(content()).not.toBeNull();

    escape();
    flushSync();
    expect(open.get()).toBe(false);
    expect(content()).toBeNull();
  });

  it('starts open when told to', () => {
    const { content } = mountPopover({ defaultOpen: true });
    expect(content()).not.toBeNull();
    expect(content()!.getAttribute('data-state')).toBe('open');
  });

  it('leaves no dismiss layer behind when unmounted while open', () => {
    const { handle, trigger } = mountPopover();
    trigger().click();
    flushSync();
    expect(dismissStackSize()).toBe(1);

    handle.unmount();
    flushSync();
    // Otherwise every popover ever opened keeps eating Escape.
    expect(dismissStackSize()).toBe(0);
  });
});

describe('what assistive technology is told', () => {
  it('labels the trigger and links it to the content only while it exists', () => {
    const { trigger, content } = mountPopover();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().hasAttribute('aria-controls')).toBe(false);

    trigger().click();
    flushSync();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(content()!.id);

    escape();
    flushSync();
    // An `aria-controls` pointing at a removed node offers a journey to
    // nowhere, so it goes when the node does.
    expect(trigger().hasAttribute('aria-controls')).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the content as a dialog, labelled and described', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    const el = content()!;
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.getAttribute('data-state')).toBe('open');
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h2')!.id);
    expect(el.getAttribute('aria-describedby')).toBe(el.querySelector('p')!.id);
  });

  it('does not claim to be modal when it is not', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();
    // The page behind is still tabbable and still readable. Saying `aria-modal`
    // here would tell a screen reader otherwise.
    expect(content()!.hasAttribute('aria-modal')).toBe(false);
  });

  it('claims to be modal when it is', () => {
    const { trigger, content } = mountPopover({ modal: true });
    trigger().click();
    flushSync();
    expect(content()!.getAttribute('aria-modal')).toBe('true');
  });

  it('omits the label reference when no title was rendered', () => {
    const { trigger, content } = mountPopover({}, UNTITLED);
    trigger().click();
    flushSync();

    // A dangling aria-labelledby is worse than none: both announce an
    // unlabelled dialog, but the dangling one hides the mistake.
    expect(content()!.hasAttribute('aria-labelledby')).toBe(false);
    expect(content()!.hasAttribute('aria-label')).toBe(false);
  });

  it('takes a name from the labels option when there is no title', () => {
    const { trigger, content } = mountPopover({ labels: { content: 'Filtres' } }, UNTITLED);
    trigger().click();
    flushSync();
    expect(content()!.getAttribute('aria-label')).toBe('Filtres');
  });

  it('prefers a rendered title over the labels option', () => {
    const { trigger, content } = mountPopover({ labels: { content: 'Filtres' } });
    trigger().click();
    flushSync();

    // A visible title names the popover for everyone, not only for a reader.
    expect(content()!.hasAttribute('aria-label')).toBe(false);
    expect(content()!.getAttribute('aria-labelledby')).toBe(content()!.querySelector('h2')!.id);
  });

  it('names the close control, and closes from it', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    const close = content()!.querySelector<HTMLElement>('.close')!;
    // The control is usually a glyph, and a glyph is not a name.
    expect(close.getAttribute('aria-label')).toBe('Close');
    // A button with no type submits the form it happens to be in.
    expect(close.getAttribute('type')).toBe('button');

    close.click();
    flushSync();
    expect(content()).toBeNull();
  });

  it('lets every visible string be replaced', () => {
    const { trigger, content } = mountPopover({ labels: { close: 'Fermer' } });
    trigger().click();
    flushSync();

    // Nothing in here is allowed to be English by construction: this library
    // will be localised, and a hard coded name cannot be.
    expect(content()!.querySelector('.close')!.getAttribute('aria-label')).toBe('Fermer');
  });

  it('tells a non-button trigger to announce itself as one', () => {
    const { trigger } = mountPopover({}, DIV_TRIGGER);
    expect(trigger().getAttribute('role')).toBe('button');
    expect(trigger().getAttribute('tabindex')).toBe('0');
  });

  it('leaves a real button alone', () => {
    const { trigger } = mountPopover();
    // It already announces itself and is already in the tab order; saying so
    // twice is at best noise, and `tabindex` on a button is a way to get the
    // tab order wrong.
    expect(trigger().hasAttribute('role')).toBe(false);
    expect(trigger().hasAttribute('tabindex')).toBe(false);
  });
});

describe('the keyboard map', () => {
  it('opens a non-button trigger on Enter and on Space', () => {
    const { trigger, content } = mountPopover({}, DIV_TRIGGER);

    keydown(trigger(), 'Enter');
    flushSync();
    expect(content()).not.toBeNull();

    keydown(trigger(), 'Enter');
    flushSync();
    expect(content()).toBeNull();

    const space = keydown(trigger(), ' ');
    flushSync();
    expect(content()).not.toBeNull();
    // Space scrolls the page unless the default is taken away.
    expect(space.defaultPrevented).toBe(true);
  });

  it('leaves a real button to turn the key into a click itself', () => {
    const { trigger, content } = mountPopover();

    keydown(trigger(), 'Enter');
    flushSync();
    // The browser will fire a click for this keypress. Acting on the keydown
    // as well would open and immediately close it.
    expect(content()).toBeNull();

    trigger().click();
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('returns focus to the trigger on Escape', () => {
    const { trigger, content } = mountPopover();
    trigger().focus();
    trigger().click();
    flushSync();
    expect(content()!.contains(document.activeElement)).toBe(true);

    escape();
    flushSync();
    // Losing focus to <body> drops a keyboard user at the top of the document
    // with no way back to where they were.
    expect(document.activeElement).toBe(trigger());
  });

  it('tabs forwards out of the popover to what follows the trigger', () => {
    const { trigger, content } = mountPopover();
    trigger().focus();
    trigger().click();
    flushSync();

    const last = content()!.querySelector<HTMLElement>('.close')!;
    last.focus();
    const event = keydown(last, 'Tab');
    flushSync();

    // The content is portalled to the end of <body>, so left alone the browser
    // would tab to whatever sits beside the portal instead.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(after());
    expect(content()).toBeNull();
  });

  it('tabs backwards out of the popover to the trigger', () => {
    const { trigger, content } = mountPopover();
    trigger().focus();
    trigger().click();
    flushSync();

    const first = content()!.querySelector<HTMLElement>('.one')!;
    first.focus();
    const event = keydown(first, 'Tab', { shiftKey: true });
    flushSync();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger());
    expect(content()).toBeNull();
  });

  it('leaves Tab alone in the middle of the popover', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    const middle = content()!.querySelector<HTMLElement>('.two')!;
    middle.focus();
    const event = keydown(middle, 'Tab');
    flushSync();

    expect(event.defaultPrevented).toBe(false);
    expect(content()).not.toBeNull();
  });

  it('does not tab out of a modal popover', () => {
    const { trigger, content } = mountPopover({ modal: true });
    trigger().focus();
    trigger().click();
    flushSync();

    const last = content()!.querySelector<HTMLElement>('.close')!;
    last.focus();
    const event = keydown(last, 'Tab');
    flushSync();

    // Modal means the focus scope owns Tab; wrapping is its job, not ours.
    expect(event.defaultPrevented).toBe(false);
    expect(content()).not.toBeNull();
  });
});

describe('focus', () => {
  it('moves into the popover on open', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();
    expect(document.activeElement).toBe(content()!.querySelector('.one'));
  });

  it('stays where it was when autoFocus is off', () => {
    const { trigger } = mountPopover({ autoFocus: false });
    trigger().focus();
    trigger().click();
    flushSync();
    expect(document.activeElement).toBe(trigger());
  });

  it('honours initialFocus', () => {
    const { trigger, content } = mountPopover({
      initialFocus: () => document.querySelector('[role="dialog"] .two'),
    });
    trigger().click();
    flushSync();
    expect(document.activeElement).toBe(content()!.querySelector('.two'));
  });

  it('closes when focus lands somewhere else entirely, and leaves it there', () => {
    const { trigger, content } = mountPopover();
    trigger().focus();
    trigger().click();
    flushSync();

    after().focus();
    flushSync();
    expect(content()).toBeNull();
    // The user asked for that element. Dragging focus back to the trigger
    // because the popover happened to be closing is the rudest thing this
    // could do.
    expect(document.activeElement).toBe(after());
  });

  it('does not close when focus moves to the trigger', () => {
    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    // A pointer press focuses the trigger before the click arrives. Closing on
    // that would let the click reopen what the user meant to dismiss.
    trigger().focus();
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('can be told to stay open when focus leaves', () => {
    const { trigger, content } = mountPopover({ closeOnFocusOutside: false });
    trigger().click();
    flushSync();

    after().focus();
    flushSync();
    expect(content()).not.toBeNull();
  });

  it('keeps focus inside a modal popover', () => {
    const { trigger, content } = mountPopover({ modal: true });
    trigger().click();
    flushSync();

    after().focus();
    expect(content()!.contains(document.activeElement)).toBe(true);
  });
});

describe('the page behind', () => {
  it('stays interactive, readable and scrollable', () => {
    const { trigger } = mountPopover();
    trigger().click();
    flushSync();

    const behind = document.querySelector<HTMLElement>('#behind')!;
    // All three are what a dialog does and a popover must not: a popover that
    // takes the page away from you is a dialog with the wrong name.
    expect(behind.hasAttribute('aria-hidden')).toBe(false);
    expect(behind.inert).toBeFalsy();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('anchor positioning', () => {
  it('names the trigger and points the content at that name', () => {
    const { trigger, content, popover } = mountPopover();
    trigger().click();
    flushSync();

    const name = popover.anchorName();
    expect(name.startsWith('--volt-popover-')).toBe(true);
    expect(trigger().style.getPropertyValue('anchor-name')).toBe(name);

    const el = content()!;
    expect(el.style.getPropertyValue('position-anchor')).toBe(name);
    expect(el.style.getPropertyValue('position-area')).toBe('bottom center');
    expect(el.getAttribute('data-anchored')).toBe('true');
    expect(el.getAttribute('data-placement')).toBe('bottom');
  });

  it('gives every popover its own anchor name', () => {
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);

    const first = mountPopover();
    const second = mountPopover({}, TEMPLATE, elsewhere);

    // Two popovers sharing a name would position against each other's
    // triggers, which only shows up on the one page that renders both.
    expect(first.popover.anchorName()).not.toBe(second.popover.anchorName());
    expect(first.trigger().style.getPropertyValue('anchor-name')).toBe(
      first.popover.anchorName(),
    );
    expect(second.trigger().style.getPropertyValue('anchor-name')).toBe(
      second.popover.anchorName(),
    );
  });

  it('translates each placement into a position area', () => {
    const cases: [PopoverOptions['placement'], string][] = [
      ['top', 'top center'],
      // Aligned to the anchor's leading edge, which is what the popover
      // spanning towards the end achieves.
      ['top-start', 'top span-x-end'],
      ['top-end', 'top span-x-start'],
      ['left-start', 'left span-y-end'],
      ['left-end', 'left span-y-start'],
      ['right', 'right center'],
    ];

    for (const [placement, area] of cases) {
      const { trigger, content } = mountPopover({ placement });
      trigger().click();
      flushSync();
      expect(content()!.style.getPropertyValue('position-area')).toBe(area);
      expect(content()!.getAttribute('data-placement')).toBe(placement);
      escape();
      flushSync();
    }
  });

  it('offers the opposite side first when it would overflow', () => {
    const vertical = mountPopover({ placement: 'bottom' });
    vertical.trigger().click();
    flushSync();
    expect(vertical.content()!.style.getPropertyValue('position-try-fallbacks')).toBe(
      'flip-block, flip-inline',
    );
    escape();
    flushSync();

    const horizontal = mountPopover({ placement: 'right-start' });
    horizontal.trigger().click();
    flushSync();
    expect(horizontal.content()!.style.getPropertyValue('position-try-fallbacks')).toBe(
      'flip-inline, flip-block',
    );
  });

  it('does not offer to flip when told not to', () => {
    const { trigger, content } = mountPopover({ flip: false });
    trigger().click();
    flushSync();
    expect(content()!.style.getPropertyValue('position-try-fallbacks')).toBe('');
  });

  it('says so where the browser cannot anchor, instead of guessing in script', () => {
    vi.stubGlobal('CSS', { supports: () => false });

    const { trigger, content } = mountPopover();
    trigger().click();
    flushSync();

    // The consumer's CSS can place it from `[data-anchored='false']`; what it
    // will not get is a scroll handler measuring rectangles on every frame.
    expect(content()!.getAttribute('data-anchored')).toBe('false');
    expect(content()!.style.getPropertyValue('position-anchor')).toBe('');
    expect(trigger().style.getPropertyValue('anchor-name')).toBe('');
  });

  it('anchors a decorative arrow to the same trigger', () => {
    const { popover } = mountPopover();
    const props = popover.arrowProps();

    // An arrow draws a relationship the ARIA already states.
    expect(props['aria-hidden']).toBe('true');
    expect(props.style).toEqual({ 'position-anchor': popover.anchorName() });
    expect(props['data-placement']).toBe('bottom');
  });
});
