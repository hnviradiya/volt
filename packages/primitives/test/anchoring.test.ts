/**
 * Anchoring, driven through real mounted components.
 *
 * What is worth asserting is the CSS contract, exactly: the keywords emitted,
 * which of them mirror under RTL and which must not, and — just as much — what
 * is never emitted. A positioning primitive that quietly starts measuring
 * rectangles on scroll has broken its promise while every visual test still
 * passes, so the absence of that is tested here as a fact rather than assumed.
 *
 * There is no keyboard map and no ARIA to cover: anchoring is presentation.
 * The tests for that are the negative ones — that a reference element comes
 * back with nothing but a name on it, and that the arrow is hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Signal, defineComponent, flushSync, mount } from '@voltdev/core';
import {
  createAnchor,
  directionWatcherCount,
  positionAreaFor,
  supportsAnchorPositioning,
  writingDirection,
  type AnchorOptions,
  type AnchorPlacement,
} from '../src/anchoring.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];

interface Handle {
  unmount(): void;
}

function track<T extends Handle>(handle: T): T {
  mounted.push(handle);
  return handle;
}

/** Unmount early, without afterEach then unmounting the same handle twice. */
function dispose(handle: Handle): void {
  const index = mounted.indexOf(handle);
  if (index !== -1) mounted.splice(index, 1);
  handle.unmount();
  flushSync();
}

let seq = 0;

/**
 * Mount an anchor built with `options`.
 *
 * The floating element is portalled, as it nearly always is in practice, and
 * that is not incidental: it is what puts the floating element in a containing
 * block that knows nothing about the reference's writing direction.
 */
function mountAnchor(options: Partial<AnchorOptions> = {}, container: HTMLElement = host) {
  seq += 1;
  const id = seq;

  class Demo {
    reference = new Signal.State<Element | null>(null);
    anchor = createAnchor({
      anchor: () => this.reference.get(),
      ...options,
    });
  }

  defineComponent(Demo, {
    selector: `v-anchor-${id}`,
    render: compileTemplate(`
      <div>
        <button :ref="reference" :spread="anchor.anchorProps()">open</button>
        <div class="floating f${id}" :portal :spread="anchor.floatingProps()">
          <i class="arrow a${id}" :spread="anchor.arrowProps()"></i>
        </div>
      </div>
    `),
  });

  const handle = track(mount(Demo, container));
  flushSync();

  return {
    handle,
    anchor: (handle.instance as Demo).anchor,
    reference: () => container.querySelector<HTMLElement>('button')!,
    floating: () => document.querySelector<HTMLElement>(`.f${id}`)!,
    arrow: () => document.querySelector<HTMLElement>(`.a${id}`)!,
  };
}

/** A style value read as a number, so `0` and `0px` are the same answer. */
function px(el: HTMLElement, property: string): number {
  return Number.parseFloat(el.style.getPropertyValue(property));
}

function area(el: HTMLElement): string {
  return el.style.getPropertyValue('position-area');
}

function region(dir?: string): HTMLElement {
  const el = document.createElement('div');
  if (dir !== undefined) el.setAttribute('dir', dir);
  document.body.append(el);
  return el;
}

/** Let a MutationObserver deliver, which it does on a microtask. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  document.documentElement.removeAttribute('dir');
  host = document.querySelector('#app')!;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  flushSync();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the link between the two elements', () => {
  it('names the reference and points the floating element at that name', () => {
    const { reference, floating, anchor } = mountAnchor();

    expect(anchor.name().startsWith('--volt-anchor-')).toBe(true);
    expect(reference().style.getPropertyValue('anchor-name')).toBe(anchor.name());
    expect(floating().style.getPropertyValue('position-anchor')).toBe(anchor.name());
    expect(floating().getAttribute('data-anchored')).toBe('true');

    // Portalled out of the component, which is the arrangement every one of
    // these tests is really about.
    expect(host.contains(floating())).toBe(false);
  });

  it('gives every anchor its own name', () => {
    const first = mountAnchor();
    const second = mountAnchor({}, region());

    // Two anchors sharing a name would position against each other's
    // references, which only shows up on the one page that renders both.
    expect(first.anchor.name()).not.toBe(second.anchor.name());
    expect(first.reference().style.getPropertyValue('anchor-name')).toBe(first.anchor.name());
    expect(second.reference().style.getPropertyValue('anchor-name')).toBe(second.anchor.name());
  });

  it('uses a supplied name, so several floating elements can share a reference', () => {
    const { reference, floating } = mountAnchor({ name: '--shared' });
    expect(reference().style.getPropertyValue('anchor-name')).toBe('--shared');
    expect(floating().style.getPropertyValue('position-anchor')).toBe('--shared');
  });

  it('positions the floating element, because position-area alone does nothing', () => {
    const absolute = mountAnchor();
    expect(absolute.floating().style.getPropertyValue('position')).toBe('absolute');
    expect(absolute.arrow().style.getPropertyValue('position')).toBe('absolute');

    // An element the UA has already fixed — anything in the top layer — would
    // be dragged back out of it by an inline `absolute`.
    const fixed = mountAnchor({ strategy: 'fixed' }, region());
    expect(fixed.floating().style.getPropertyValue('position')).toBe('fixed');
    expect(fixed.arrow().style.getPropertyValue('position')).toBe('fixed');
  });

  it('writes no coordinates of its own', () => {
    const { floating } = mountAnchor({ offset: 8 });

    // The moment any of these appear, something is measuring.
    for (const property of ['top', 'left', 'right', 'bottom', 'inset', 'transform', 'width']) {
      expect(floating().style.getPropertyValue(property)).toBe('');
    }
  });

  it('passes position-visibility through only when asked', () => {
    expect(mountAnchor().floating().style.getPropertyValue('position-visibility')).toBe('');

    const { floating } = mountAnchor({ positionVisibility: 'anchors-visible' }, region());
    expect(floating().style.getPropertyValue('position-visibility')).toBe('anchors-visible');
  });
});

describe('placement', () => {
  const LTR: [AnchorPlacement, string][] = [
    ['top', 'top center'],
    // Aligned to the reference's left edge, which is what spanning towards the
    // right achieves — the keyword reads inverted and is not.
    ['top-start', 'top span-right'],
    ['top-end', 'top span-left'],
    ['bottom', 'bottom center'],
    ['bottom-start', 'bottom span-right'],
    ['bottom-end', 'bottom span-left'],
    ['left', 'left center'],
    ['left-start', 'left span-bottom'],
    ['left-end', 'left span-top'],
    ['right', 'right center'],
    ['right-start', 'right span-bottom'],
    ['right-end', 'right span-top'],
  ];

  it('translates every placement into a position area', () => {
    for (const [placement, expected] of LTR) {
      const { floating, anchor } = mountAnchor({ defaultPlacement: placement }, region());
      expect(area(floating())).toBe(expected);
      expect(floating().getAttribute('data-placement')).toBe(placement);
      expect(anchor.positionArea()).toBe(expected);
    }
  });

  it('reports the side and alignment it was asked for', () => {
    const { anchor } = mountAnchor({ defaultPlacement: 'left-end' });
    expect(anchor.side()).toBe('left');
    expect(anchor.alignment()).toBe('end');

    // A bare side is centred, not unaligned.
    expect(mountAnchor({ defaultPlacement: 'left' }, region()).anchor.alignment()).toBe('center');
  });

  it('follows a placement signal supplied from outside', () => {
    const placement = new Signal.State<AnchorPlacement>('bottom-start');
    const { floating, arrow } = mountAnchor({ placement });
    expect(area(floating())).toBe('bottom span-right');

    placement.set('left-end');
    flushSync();
    expect(area(floating())).toBe('left span-top');
    expect(floating().getAttribute('data-placement')).toBe('left-end');
    expect(arrow().getAttribute('data-side')).toBe('left');
  });

  it('owns the placement when no signal is given', () => {
    const { anchor, floating } = mountAnchor({ defaultPlacement: 'top' });
    anchor.setPlacement('right-start');
    flushSync();
    expect(area(floating())).toBe('right span-bottom');
    expect(anchor.placement()).toBe('right-start');
  });

  it('reports a change once, and not at all when nothing changed', () => {
    const onPlacementChange = vi.fn();
    const { anchor } = mountAnchor({ defaultPlacement: 'bottom', onPlacementChange });

    anchor.setPlacement('top');
    expect(onPlacementChange).toHaveBeenCalledExactlyOnceWith('top');

    anchor.setPlacement('top');
    expect(onPlacementChange).toHaveBeenCalledOnce();
  });
});

describe('writing direction', () => {
  it('mirrors the inline axis under rtl', () => {
    const rtl = region('rtl');
    for (const [placement, expected] of [
      ['top-start', 'top span-left'],
      ['top-end', 'top span-right'],
      ['bottom-start', 'bottom span-left'],
      ['bottom-end', 'bottom span-right'],
    ] as [AnchorPlacement, string][]) {
      const { floating } = mountAnchor({ defaultPlacement: placement }, rtl);
      expect(area(floating())).toBe(expected);
    }
  });

  it('leaves the block axis alone under rtl', () => {
    const rtl = region('rtl');
    for (const [placement, expected] of [
      // Beside the reference, alignment runs top to bottom, and no writing
      // direction turns a page upside down.
      ['left-start', 'left span-bottom'],
      ['right-end', 'right span-top'],
      // The side itself is physical too: `left` means left in every language.
      ['left', 'left center'],
    ] as [AnchorPlacement, string][]) {
      const { floating } = mountAnchor({ defaultPlacement: placement }, rtl);
      expect(area(floating())).toBe(expected);
    }
  });

  it('resolves against the reference, not against the document', () => {
    const rtl = region('rtl');
    const { floating } = mountAnchor({ defaultPlacement: 'bottom-start' }, rtl);

    // The page is left-to-right and the floating element is portalled into it,
    // so a logical `span-x-end` left for the browser to resolve would be
    // resolved against <body> and align to the wrong edge of the reference.
    expect(document.documentElement.getAttribute('dir')).toBeNull();
    expect(floating().parentElement).toBe(document.body);
    expect(area(floating())).toBe('bottom span-left');
  });

  it('takes the nearest declaration, not the outermost', () => {
    const rtl = region('rtl');
    const ltr = document.createElement('div');
    ltr.setAttribute('dir', 'ltr');
    rtl.append(ltr);

    const { floating } = mountAnchor({ defaultPlacement: 'bottom-start' }, ltr);
    expect(area(floating())).toBe('bottom span-right');
  });

  it('does not care how the attribute is cased', () => {
    const { floating } = mountAnchor({ defaultPlacement: 'bottom-start' }, region('RTL'));
    expect(area(floating())).toBe('bottom span-left');
  });

  it('treats dir="auto" as a deferral rather than as a direction', () => {
    const rtl = region('rtl');
    const auto = document.createElement('div');
    auto.setAttribute('dir', 'auto');
    rtl.append(auto);

    // `auto` means "read it off the content", so the answer comes from
    // computed style. Reading the attribute literally would give neither
    // direction, and falling back to the outer `rtl` would ignore the very
    // element that asked to be decided separately.
    const { floating } = mountAnchor({ defaultPlacement: 'bottom-start' }, auto);
    expect(area(floating())).toBe('bottom span-right');
  });

  it('follows a direction change made long after mount', async () => {
    const later = region();
    const { floating } = mountAnchor({ defaultPlacement: 'bottom-start' }, later);
    expect(area(floating())).toBe('bottom span-right');

    // A language switch flips `dir` on a page that mounted hours earlier.
    later.setAttribute('dir', 'rtl');
    await tick();
    flushSync();
    expect(area(floating())).toBe('bottom span-left');
  });

  it('takes a direction given as an option, and then watches nothing', () => {
    const { floating } = mountAnchor({ defaultPlacement: 'bottom-start', dir: 'rtl' });

    // Nothing in the document says rtl; the caller does, and on a server that
    // is the only way to know.
    expect(area(floating())).toBe('bottom span-left');
    expect(directionWatcherCount()).toBe(0);
  });

  it('gives back its watch on unmount', () => {
    expect(directionWatcherCount()).toBe(0);

    const first = mountAnchor();
    expect(directionWatcherCount()).toBe(1);
    const second = mountAnchor({}, region());
    expect(directionWatcherCount()).toBe(2);

    dispose(first.handle);
    expect(directionWatcherCount()).toBe(1);
    dispose(second.handle);
    // The document observer behind these is shared and is disconnected with
    // the last of them. A page that opens and closes a thousand tooltips would
    // otherwise be left observing on behalf of every one of them.
    expect(directionWatcherCount()).toBe(0);
  });

  it('answers ltr for an element that has no document to ask', () => {
    expect(writingDirection(null)).toBe('ltr');
    expect(writingDirection(document.createElement('div'))).toBe('ltr');
  });

  it('defaults to ltr when asked for a position area directly', () => {
    expect(positionAreaFor('bottom-start')).toBe('bottom span-right');
    expect(positionAreaFor('bottom-start', 'rtl')).toBe('bottom span-left');
  });
});

describe('offset', () => {
  it('becomes a margin on the side that faces the reference', () => {
    const { floating } = mountAnchor({ offset: 8 });

    // Below the reference, so the gap is above the floating element.
    expect(px(floating(), 'margin-top')).toBe(8);
    expect(px(floating(), 'margin-bottom')).toBe(0);
    expect(px(floating(), 'margin-left')).toBe(0);
    expect(px(floating(), 'margin-right')).toBe(0);
  });

  it('moves the gap with the placement, leaving none behind', () => {
    const placement = new Signal.State<AnchorPlacement>('bottom');
    const { floating } = mountAnchor({ placement, offset: 8 });
    expect(px(floating(), 'margin-top')).toBe(8);

    placement.set('top');
    flushSync();

    // The reason all four sides are written rather than only the one that
    // matters: an inline property that is dropped from a later render is not
    // removed from the element, so a gap written on one side alone would stay
    // there and the floating element would be pushed twice.
    expect(px(floating(), 'margin-bottom')).toBe(8);
    expect(px(floating(), 'margin-top')).toBe(0);

    placement.set('right');
    flushSync();
    expect(px(floating(), 'margin-left')).toBe(8);
    expect(px(floating(), 'margin-bottom')).toBe(0);
  });

  it('touches no margin at all when no offset was asked for', () => {
    const { floating } = mountAnchor();
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(floating().style.getPropertyValue(`margin-${edge}`)).toBe('');
    }
    expect(floating().style.getPropertyValue('--volt-anchor-offset')).toBe('');
  });

  it('takes any CSS length, and publishes it for the arrow to draw against', () => {
    const { floating, arrow } = mountAnchor({ offset: '0.5rem' });
    expect(floating().style.getPropertyValue('margin-top')).toBe('0.5rem');
    expect(floating().style.getPropertyValue('--volt-anchor-offset')).toBe('0.5rem');
    // Repeated on the arrow, which is often a sibling rather than a child.
    expect(arrow().style.getPropertyValue('--volt-anchor-offset')).toBe('0.5rem');
  });

  it('honours a zero offset as an instruction rather than an omission', () => {
    const { floating } = mountAnchor({ offset: 0 });
    expect(px(floating(), 'margin-top')).toBe(0);
    expect(floating().style.getPropertyValue('--volt-anchor-offset')).toBe('0px');
  });
});

describe('fallbacks', () => {
  function fallbacks(options: Partial<AnchorOptions>): string {
    return mountAnchor(options, region()).floating().style.getPropertyValue(
      'position-try-fallbacks',
    );
  }

  it('offers the opposite side first, then the other alignment, then both', () => {
    // Something that would run off the bottom of the window belongs above the
    // reference, not shunted sideways underneath it.
    expect(fallbacks({ defaultPlacement: 'bottom-start' })).toBe(
      'flip-block, flip-inline, flip-block flip-inline',
    );
  });

  it('flips along its own axis first when the placement is beside the reference', () => {
    expect(fallbacks({ defaultPlacement: 'right-start' })).toBe(
      'flip-inline, flip-block, flip-inline flip-block',
    );
  });

  it('offers both alignments for a centred placement, which has no other one', () => {
    // `flip-inline` on a centred placement produces the same position again,
    // and centred is precisely the placement that overflows sideways.
    expect(fallbacks({ defaultPlacement: 'bottom' })).toBe(
      'flip-block, bottom span-right, bottom span-left',
    );
  });

  it('resolves those written-out areas against the direction too', () => {
    expect(fallbacks({ defaultPlacement: 'bottom', dir: 'rtl' })).toBe(
      'flip-block, bottom span-left, bottom span-right',
    );
  });

  it('drops the tactics it was told not to use', () => {
    expect(fallbacks({ defaultPlacement: 'bottom-start', shift: false })).toBe('flip-block');
    expect(fallbacks({ defaultPlacement: 'bottom-start', flip: false })).toBe('flip-inline');
  });

  it('says nothing at all when both are off, so a stylesheet can own it', () => {
    expect(fallbacks({ flip: false, shift: false })).toBe('');
  });

  it('appends fallbacks of the caller’s own last', () => {
    expect(fallbacks({ defaultPlacement: 'top-end', fallbacks: ['--squeeze'] })).toBe(
      'flip-block, flip-inline, flip-block flip-inline, --squeeze',
    );
    expect(fallbacks({ flip: false, shift: false, fallbacks: ['--squeeze'] })).toBe('--squeeze');
  });
});

describe('the arrow', () => {
  it('sits in the gap on the reference edge that faces the floating element', () => {
    const { arrow, anchor } = mountAnchor({ defaultPlacement: 'top-start', offset: 6 });

    // Anchored to the reference rather than to the floating element, so it
    // keeps pointing at the reference when a fallback slides the floating
    // element along its edge.
    expect(arrow().style.getPropertyValue('position-anchor')).toBe(anchor.name());
    expect(area(arrow())).toBe('top center');
    expect(arrow().getAttribute('data-side')).toBe('top');
  });

  it('stays centred on the reference whatever the alignment', () => {
    const { arrow } = mountAnchor({ defaultPlacement: 'bottom-end' });
    expect(area(arrow())).toBe('bottom center');
  });

  it('is hidden from assistive technology and holds no tab stop', () => {
    const { arrow } = mountAnchor();

    // An arrow is a drawing of a relationship the surrounding markup already
    // states; announcing it says nothing and interrupts.
    expect(arrow().getAttribute('aria-hidden')).toBe('true');
    expect(arrow().hasAttribute('tabindex')).toBe(false);
    expect(arrow().hasAttribute('role')).toBe(false);
  });
});

describe('what it refuses to add', () => {
  it('claims no semantics on the reference', () => {
    const { reference, anchor } = mountAnchor();

    // A reference is whatever the consumer's markup already says it is. Being
    // pointed at by a floating element changes none of that, and a role or a
    // tab stop added here would be a lie nobody asked for.
    expect(Object.keys(anchor.anchorProps())).toEqual(['style']);
    expect(reference().hasAttribute('role')).toBe(false);
    expect(reference().hasAttribute('tabindex')).toBe(false);
    expect(ariaAttributes(reference())).toEqual([]);
  });

  it('claims no semantics on the floating element either', () => {
    const { floating } = mountAnchor();

    // Whether this is a dialog, a listbox or a tooltip is the component's
    // business; anchoring only knows where it goes.
    expect(floating().hasAttribute('role')).toBe(false);
    expect(ariaAttributes(floating())).toEqual([]);
  });

  it('never measures and never listens for the page moving', () => {
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const onWindow = vi.spyOn(window, 'addEventListener');
    const onDocument = vi.spyOn(document, 'addEventListener');

    const placement = new Signal.State<AnchorPlacement>('bottom');
    mountAnchor({ placement, offset: 8 });
    placement.set('right-end');
    flushSync();
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    flushSync();

    // This is the whole bargain. A JavaScript positioner has to measure on
    // every frame the page moves; the reason this one can be a bag of
    // attributes is that it never does.
    expect(measure).not.toHaveBeenCalled();
    const listened = [...onWindow.mock.calls, ...onDocument.mock.calls].map(([type]) => type);
    expect(listened).not.toContain('scroll');
    expect(listened).not.toContain('resize');
  });
});

describe('where the browser cannot anchor', () => {
  it('says so, and does not quietly do it in script instead', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    const { reference, floating, arrow, anchor } = mountAnchor({ offset: 8 });

    expect(anchor.isSupported()).toBe(false);
    expect(floating().getAttribute('data-anchored')).toBe('false');

    // Not one declaration, on any of the three elements: the consumer's CSS
    // places it from `[data-anchored='false']`, and what they will not get is
    // a scroll handler measuring rectangles on every frame.
    expect(reference().style.getPropertyValue('anchor-name')).toBe('');
    expect(floating().style.getPropertyValue('position')).toBe('');
    expect(floating().style.getPropertyValue('position-anchor')).toBe('');
    expect(area(floating())).toBe('');
    expect(floating().style.getPropertyValue('margin-top')).toBe('');
    expect(arrow().style.getPropertyValue('position-anchor')).toBe('');
    expect(measure).not.toHaveBeenCalled();
  });

  it('still reports where it wanted to go, and still hides the arrow', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    const { floating, arrow } = mountAnchor({ defaultPlacement: 'left-end' });

    // Everything that is advice rather than instruction survives, because it
    // is exactly what the consumer's own CSS has to work from.
    expect(floating().getAttribute('data-placement')).toBe('left-end');
    expect(arrow().getAttribute('data-side')).toBe('left');
    expect(arrow().getAttribute('aria-hidden')).toBe('true');
  });

  it('assumes support where there is no CSS object to ask', () => {
    vi.stubGlobal('CSS', undefined);

    // A server has no `CSS`, and the declarations it renders are inert there
    // anyway. Claiming support leaves the decision to the browser that
    // receives the markup, rather than baking a "no" into the HTML.
    expect(supportsAnchorPositioning()).toBe(true);
  });
});

function ariaAttributes(el: Element): string[] {
  return [...el.attributes].map((a) => a.name).filter((name) => name.startsWith('aria-'));
}
