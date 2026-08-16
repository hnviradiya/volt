/**
 * Anchoring — keeping a floating element attached to the thing it belongs to.
 *
 * This is CSS anchor positioning and nothing else. The reference element gets
 * an `anchor-name`, the floating one a `position-anchor` and a
 * `position-area`, and from there the browser keeps the two together through
 * scrolling, resizing, zooming and every layout change no script would ever
 * hear about. Nothing here measures a rectangle, listens for scroll, or asks
 * for an animation frame — that is the work a JavaScript positioner has to do,
 * on every frame the page moves, for a result the engine already knows.
 *
 *   class Filters {
 *     trigger = new Signal.State<Element | null>(null);
 *     anchor = createAnchor({
 *       anchor: () => this.trigger.get(),
 *       defaultPlacement: 'bottom-start',
 *       offset: 8,
 *     });
 *   }
 *
 *   <button :ref="trigger" :spread="anchor.anchorProps()">Filters</button>
 *   <div :portal :spread="anchor.floatingProps()">
 *     …
 *     <i :spread="anchor.arrowProps()"></i>
 *   </div>
 *
 * Where the engine cannot do it, `isSupported()` says so and `data-anchored`
 * carries the same answer into CSS, so a consumer can choose simpler markup or
 * place the thing themselves. There is deliberately no script fallback:
 * shipping a layout engine to everyone so that one engine without anchor
 * positioning can do collision detection is the wrong trade, and it is the
 * trade that never gets untaken once made.
 *
 * Nothing here is announced. Positioning is presentation, so the only ARIA in
 * the file is the `aria-hidden` on the arrow, which is a drawing of a
 * relationship rather than content — and for the same reason there is no
 * `labels` option, because this puts no string in front of a user.
 */

import { Signal, effect, onCleanup } from '@voltjs/core';
import { createId } from './id.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

/** Which side of the reference the floating element sits on. */
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';

/** How it lines up along the other axis. */
export type AnchorAlignment = 'start' | 'center' | 'end';

/** A side, optionally aligned to one edge of the reference. */
export type AnchorPlacement = AnchorSide | `${AnchorSide}-start` | `${AnchorSide}-end`;

export type WritingDirection = 'ltr' | 'rtl';

/**
 * `absolute` or `fixed`. Both work with anchor positioning; `fixed` is what an
 * element already in the top layer needs, since the UA stylesheet fixes
 * `[popover]` and `<dialog>` and an inline `position: absolute` would undo it.
 */
export type AnchorStrategy = 'absolute' | 'fixed';

/**
 * `position-visibility`, passed through verbatim. `anchors-visible` is the one
 * worth knowing: it hides the floating element once the reference has scrolled
 * out of view, which is otherwise a tooltip left pointing at nothing.
 */
export type AnchorVisibility = 'always' | 'anchors-valid' | 'anchors-visible' | 'no-overflow';

export interface AnchorOptions {
  /** The element to position against, once rendered. */
  anchor: () => Element | null | undefined;

  /**
   * Supply a signal to drive the placement from outside. Without one this owns
   * its own, which is what most callers want.
   */
  placement?: Signal.State<AnchorPlacement>;
  /** Default `bottom`. */
  defaultPlacement?: AnchorPlacement;

  /**
   * The gap between the reference and the floating element. A number is
   * pixels; a string is any CSS length.
   *
   * Setting this makes anchoring the owner of the floating element's margins —
   * all four of them, three of them zero — because a gap written on one side
   * only would linger on the old side when the placement changes.
   */
  offset?: number | string;

  /** Let the browser try the opposite side when this one overflows. Default true. */
  flip?: boolean;
  /**
   * Let it try the other alignment as well. Default true.
   *
   * CSS has no continuous shift: a fallback is a discrete position to try, not
   * a distance to slide by. This is the closest honest translation — the other
   * alignment of the same side, and for a centred placement the two aligned
   * variants, since a centred placement has no "other" alignment.
   */
  shift?: boolean;
  /**
   * Further fallbacks, tried after the generated ones. Either a `@position-try`
   * rule's dashed-ident or a `position-area` value.
   */
  fallbacks?: readonly string[];

  /** Default `absolute`. */
  strategy?: AnchorStrategy;
  /** When set, written as `position-visibility`. */
  positionVisibility?: AnchorVisibility;

  /**
   * Force the writing direction instead of reading it off the reference.
   * Wanted on a server, where there is no element to read, and wherever the
   * application already knows the answer.
   */
  dir?: WritingDirection;

  /**
   * The `anchor-name` to use, as a dashed-ident. Generated when omitted, which
   * is what keeps two anchors on one page from positioning against each
   * other's references. Supply one only to point several floating elements at
   * a single reference — and supply a valid dashed-ident, because an invalid
   * one is not an error, it is silently no anchor at all.
   */
  name?: string;

  onPlacementChange?: (placement: AnchorPlacement) => void;
}

/** A bag of attributes to spread; `style` is an object of CSS declarations. */
export interface AnchorProps {
  readonly [key: string]: string | undefined | Readonly<Record<string, string>>;
}

export interface Anchor {
  /** The generated (or supplied) `anchor-name`. */
  name(): string;
  /**
   * The placement asked for.
   *
   * Not necessarily the one in use: when the browser takes a `position-try`
   * fallback it does not report which, and there is no API to ask. That is the
   * price of letting the engine do the work, and it is why an arrow drawn from
   * `data-side` stays on the side that was requested.
   */
  placement(): AnchorPlacement;
  side(): AnchorSide;
  alignment(): AnchorAlignment;
  /** The direction the placement was resolved against. */
  direction(): WritingDirection;
  /** The resolved `position-area`, for CSS a consumer writes themselves. */
  positionArea(): string;
  /** Whether this browser can position one element against another in CSS. */
  isSupported(): boolean;

  setPlacement(placement: AnchorPlacement): void;

  /** For the reference element: names it, and nothing else. */
  anchorProps(): AnchorProps;
  /** For the floating element: where it goes and what to try instead. */
  floatingProps(): AnchorProps;
  /** For a decorative arrow: sits in the gap, hidden from readers. */
  arrowProps(): AnchorProps;
}

const PARTS: Record<AnchorPlacement, readonly [AnchorSide, AnchorAlignment]> = {
  top: ['top', 'center'],
  'top-start': ['top', 'start'],
  'top-end': ['top', 'end'],
  right: ['right', 'center'],
  'right-start': ['right', 'start'],
  'right-end': ['right', 'end'],
  bottom: ['bottom', 'center'],
  'bottom-start': ['bottom', 'start'],
  'bottom-end': ['bottom', 'end'],
  left: ['left', 'center'],
  'left-start': ['left', 'start'],
  'left-end': ['left', 'end'],
};

const OPPOSITE: Record<AnchorSide, AnchorSide> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};

export function createAnchor(options: AnchorOptions): Anchor {
  const state = options.placement ?? new Signal.State(options.defaultPlacement ?? 'bottom');
  const strategy = options.strategy ?? 'absolute';
  const flip = options.flip !== false;
  const shift = options.shift !== false;
  const extra = options.fallbacks ?? [];
  // `--volt-anchor-1` is both unique and a valid dashed-ident, so the id
  // counter names the anchor too. Two anchors sharing a name would position
  // against each other's references, which is the kind of bug that only shows
  // up on the one page that renders both.
  const name = options.name ?? createId('--volt-anchor');

  const direction = new Signal.State<WritingDirection>(options.dir ?? 'ltr');

  // Direction is resolved here rather than left to the browser's own logical
  // keywords, because the browser resolves those against the floating
  // element's containing block — and a floating element is nearly always
  // portalled to <body>, which does not share the direction of the RTL form
  // the reference sits in. Reading the reference gives the same answer on a
  // page that is RTL throughout and the right one on a page that is not.
  if (!options.dir) {
    effect(() => {
      const el = options.anchor();
      if (!el) return;

      const read = () => direction.set(writingDirection(el));
      read();
      // `dir` is a live attribute: a language switch flips it on <html> long
      // after everything anchored to anything has mounted.
      onCleanup(watchDirection(el.ownerDocument, read));
    });
  }

  const setPlacement = (next: AnchorPlacement) => {
    // Untracked because this may well be called from inside an effect, and
    // subscribing that effect to the state it just wrote would re-run it every
    // time the placement moves.
    if (untrack(() => state.get()) === next) return;
    state.set(next);
    options.onPlacementChange?.(next);
  };

  const area = () => positionAreaFor(state.get(), direction.get());

  return {
    name: () => name,
    placement: () => state.get(),
    side: () => PARTS[state.get()][0],
    alignment: () => PARTS[state.get()][1],
    direction: () => direction.get(),
    positionArea: area,
    isSupported: supportsAnchorPositioning,

    setPlacement,

    anchorProps: () => {
      // Nothing else belongs here. A reference is whatever the consumer's
      // markup already says it is — a button, a cell, a word in a paragraph —
      // and being pointed at by a floating element changes none of that.
      if (!supportsAnchorPositioning()) return {};
      return { style: { 'anchor-name': name } };
    },

    floatingProps: () => {
      const placement = state.get();
      const [side] = PARTS[placement];
      const supported = supportsAnchorPositioning();

      const props: Record<string, AnchorProps[string]> = {
        // Both halves, because CSS keys off both: the side decides a transform
        // origin, the alignment decides which corner an entry animation grows
        // from.
        'data-placement': placement,
        // Advisory, for CSS that has to place the element itself where the
        // browser cannot: `[data-anchored='false'] { … }`.
        'data-anchored': String(supported),
      };
      if (!supported) return props;

      const style: Record<string, string> = {
        // Without a positioning scheme `position-area` does nothing at all,
        // and a silently unpositioned popover is the most common way to get
        // this wrong. The cost is that an inline declaration beats the
        // consumer's stylesheet, which is what `strategy` is for.
        position: strategy,
        'position-anchor': name,
        'position-area': area(),
      };

      if (flip || shift || extra.length > 0) {
        style['position-try-fallbacks'] = fallbacksFor(placement, direction.get(), {
          flip,
          shift,
          extra,
        });
      }

      if (options.offset !== undefined) {
        const gap = toLength(options.offset);
        // A margin, not an inset: the element is placed in a `position-area`
        // grid cell and aligned towards the reference, so a margin on the side
        // that faces it pushes it away by exactly that much. It also survives
        // a flip, because `flip-block` and `flip-inline` swap the margins along
        // with everything else — an inset would have to be recomputed, and
        // nothing here is watching to recompute it.
        for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
          style[`margin-${edge}`] = edge === OPPOSITE[side] ? gap : '0';
        }
        // Exposed so an arrow can be drawn exactly as tall as the gap it fills.
        style['--volt-anchor-offset'] = gap;
      }

      if (options.positionVisibility) style['position-visibility'] = options.positionVisibility;

      props.style = style;
      return props;
    },

    arrowProps: () => {
      const [side] = PARTS[state.get()];
      const props: Record<string, AnchorProps[string]> = {
        // An arrow draws a relationship the surrounding markup already states.
        'aria-hidden': 'true',
        // The side alone: which way it points is the only question an arrow's
        // styling ever asks.
        'data-side': side,
      };
      if (!supportsAnchorPositioning()) return props;

      // Anchored to the reference rather than to the floating element, so it
      // keeps pointing at the reference when a fallback moves the floating
      // element along its own edge. Centred on the reference, which is right
      // until the reference is much wider than the floating element — then the
      // arrow can end up beyond its edge, and that one is the consumer's to
      // place from `data-side`.
      const style: Record<string, string> = {
        position: strategy,
        'position-anchor': name,
        'position-area': `${side} center`,
      };
      // Repeated rather than inherited, because an arrow is often a sibling of
      // the floating element rather than a child of it.
      if (options.offset !== undefined) style['--volt-anchor-offset'] = toLength(options.offset);

      props.style = style;
      return props;
    },
  };
}

/**
 * Whether the browser can position one element against another in CSS.
 *
 * Asked rather than assumed, so a consumer can choose different markup where
 * the answer is no. Not cached: the cost is one syntax check, and caching it
 * would mean the answer a page starts with is the one it is stuck with.
 */
export function supportsAnchorPositioning(): boolean {
  // `CSS` is a browser global with no equivalent on a server. Rendered there
  // the declarations are inert anyway, so claim support and let the browser
  // that receives the markup be the one to decide.
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  return CSS.supports('anchor-name', '--volt');
}

/**
 * The `position-area` for a placement, in physical keywords.
 *
 * Physical deliberately. `x-start` and its friends are resolved by the browser
 * against a writing mode this cannot see — and, for a portalled floating
 * element, one that has nothing to do with the reference. Resolving here means
 * the emitted value depends on the reference alone, and reads the same in
 * devtools as it does in the source.
 */
export function positionAreaFor(
  placement: AnchorPlacement,
  direction: WritingDirection = 'ltr',
): string {
  const [side, alignment] = PARTS[placement];
  if (alignment === 'center') return `${side} center`;
  return `${side} ${spanFor(side, alignment, direction)}`;
}

/**
 * The cross-axis half of a `position-area`.
 *
 * The span keywords read as though they were inverted, and are not:
 * `span-right` puts the floating element in the reference's centre column *and*
 * everything to the right of it, so its left edge lines up with the reference's
 * left edge — which is what `-start` asks for in a left-to-right page.
 */
function spanFor(
  side: AnchorSide,
  alignment: 'start' | 'end',
  direction: WritingDirection,
): string {
  if (side === 'top' || side === 'bottom') {
    // The inline axis is the one direction mirrors, so this is the whole of
    // what RTL changes.
    const rtl = direction === 'rtl';
    if (alignment === 'start') return rtl ? 'span-left' : 'span-right';
    return rtl ? 'span-right' : 'span-left';
  }
  // Beside the reference, alignment runs down the block axis, which `dir` does
  // not mirror — only a vertical writing mode would, and this resolves `dir`
  // rather than `writing-mode`. A page in `vertical-rl` should ask for the
  // placement it actually wants.
  return alignment === 'start' ? 'span-bottom' : 'span-top';
}

interface FallbackOptions {
  flip: boolean;
  shift: boolean;
  extra: readonly string[];
}

/**
 * `position-try-fallbacks`, in the order they are worth trying.
 *
 * The opposite side comes first: a popover that would run off the bottom of
 * the window belongs above its trigger, not shunted sideways under it. Only
 * then the other alignment, and only then both at once.
 */
function fallbacksFor(
  placement: AnchorPlacement,
  direction: WritingDirection,
  options: FallbackOptions,
): string {
  const [side, alignment] = PARTS[placement];
  const vertical = side === 'top' || side === 'bottom';
  const primary = vertical ? 'flip-block' : 'flip-inline';
  const cross = vertical ? 'flip-inline' : 'flip-block';

  const tried: string[] = [];
  if (options.flip) tried.push(primary);

  if (options.shift) {
    if (alignment === 'center') {
      // A centred placement has no other alignment to flip to, and centred is
      // exactly the placement that overflows sideways on a narrow window. The
      // two aligned variants are written out, since a tactic cannot express
      // "align to an edge you were not aligned to".
      tried.push(
        `${side} ${spanFor(side, 'start', direction)}`,
        `${side} ${spanFor(side, 'end', direction)}`,
      );
    } else {
      tried.push(cross);
      // The corner case, literally: overflowing on both axes at once.
      if (options.flip) tried.push(`${primary} ${cross}`);
    }
  }

  tried.push(...options.extra);
  return tried.join(', ');
}

/** A bare number is pixels; anything else is already a CSS length. */
function toLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Writing direction at `el`.
 *
 * The nearest `dir` attribute wins over computed style. An application that
 * marks up direction with `dir` is stating intent, and the attribute can be
 * read before styles resolve — during construction, and on a server, where
 * there is no computed style at all.
 */
export function writingDirection(el: Element | null | undefined): WritingDirection {
  if (!el) return 'ltr';

  const declared = el.closest('[dir]')?.getAttribute('dir')?.toLowerCase();
  if (declared === 'rtl' || declared === 'ltr') return declared;
  // `dir="auto"` is a deferral, not a direction: the browser decides it from
  // the first strong character, and the only place that answer exists is the
  // computed style. Treating it as a declaration would read an Arabic comment
  // on an English page as left-to-right.

  const view = el.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(el).direction === 'rtl' ? 'rtl' : 'ltr';
}

// ---------------------------------------------------------------------------
// Watching for a direction change
// ---------------------------------------------------------------------------

interface DirectionWatch {
  observer: MutationObserver;
  listeners: Set<() => void>;
}

/**
 * One observer per document, however many anchors are on it.
 *
 * Module state, like the dismissal stack, and for the same reason: `dir` on
 * <html> is a page-wide fact, and every anchor on the page wants to hear the
 * same mutation. A page of fifty tooltips should not carry fifty observers of
 * the same attribute. The tradeoff is a shared registry to keep correct — so
 * the observer is disconnected the moment its last listener goes, and the test
 * seam below exists to prove it.
 */
const watches = new WeakMap<Document, DirectionWatch>();

function watchDirection(doc: Document, listener: () => void): () => void {
  // No MutationObserver means a server: nothing is going to change `dir`
  // between now and the response being written.
  if (typeof MutationObserver === 'undefined') return () => {};

  let watch = watches.get(doc);
  if (!watch) {
    const listeners = new Set<() => void>();
    const observer = new MutationObserver(() => {
      for (const fn of listeners) fn();
    });
    // Subtree, because direction is set on a region as often as on the
    // document — a comment field, a quoted message. The attribute filter is
    // what keeps that affordable.
    observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['dir'],
      subtree: true,
    });
    watch = { observer, listeners };
    watches.set(doc, watch);
  }

  const current = watch;
  current.listeners.add(listener);

  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.observer.disconnect();
    watches.delete(doc);
  };
}

/** Test seam: how many anchors are watching `doc` for a direction change. */
export function directionWatcherCount(doc: Document = document): number {
  return watches.get(doc)?.listeners.size ?? 0;
}
