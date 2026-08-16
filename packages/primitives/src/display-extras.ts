/**
 * Display extras — badge, chip, image, keyboard key, code and relative time.
 *
 * The second half of the display family. Like the first half in `display.ts`,
 * none of these renders anything or has any opinion about styling; each owns
 * its state and returns prop objects to spread onto whatever markup the
 * consumer writes.
 *
 * What they have in common is that the interesting part is never the pixels.
 * A badge draws "99+" and has to say "more than 99 unread messages". A chip
 * draws a cross and has to say which tag it removes, and then put focus
 * somewhere sensible once that tag is gone. An image has to reserve its space
 * before it arrives and decide whether it is worth describing at all. A
 * keyboard key draws ⌘ and has to say "Command". A relative time draws
 * "3 minutes ago" and has to keep saying something true a minute later —
 * without every timestamp on the page owning a timer to do it.
 */

import { Signal, effect, onCleanup } from '@voltjs/core';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

/** Whether a change to the count interrupts, and how. */
export type BadgeLive = 'off' | 'polite' | 'assertive';

export interface BadgeLabels {
  /**
   * The accessible name for a count. Default `3 unread messages`.
   *
   * The default does not pluralise, because it cannot: the plural form depends
   * on the locale and on the noun, and neither is knowable from a template
   * string. `Intl.PluralRules` picks the category but not the words, so a
   * consumer who needs "1 unread message" supplies both forms here.
   */
  count?: (count: number, describes: string) => string;
  /** The accessible name past `max`. Default `More than 99 unread messages`. */
  overflow?: (max: number, describes: string) => string;
}

export interface BadgeOptions {
  /**
   * What the number counts — "unread messages". Without it the badge is a bare
   * numeral in the middle of a sentence, which is the thing this exists to
   * prevent: a button labelled "Inbox 3" says nothing about what the 3 is.
   */
  describes?: string;

  /**
   * Supply a signal to control the count from outside; without one the badge
   * owns it. `null` is a badge with no count at all — a status badge whose own
   * content is the whole message.
   */
  count?: Signal.State<number | null>;
  defaultCount?: number | null;

  /** Past this the text becomes `${max}+`. Default no cap. */
  max?: number;
  /** Stay on screen at zero. Default false. */
  showZero?: boolean;

  /**
   * Announce changes to the count. Default off.
   *
   * A badge is a summary of something already on the page, so announcing every
   * change is usually repetition — and a counter that ticks during a page load
   * interrupts continuously. Turning it on sets `aria-atomic`, so the whole
   * badge is re-announced and what is heard is the label rather than the bare
   * digits that changed.
   */
  live?: BadgeLive;

  labels?: BadgeLabels;
  onCountChange?: (count: number | null) => void;
}

export interface BadgeProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Badge {
  /** The count, whole, or null when there is none. */
  count(): number | null;
  setCount(count: number | null): void;
  /** Whether there is anything to show — the `:if` a consumer writes. */
  isVisible(): boolean;
  isOverflowed(): boolean;
  /** The visible text: `3`, `99+`, or '' for a badge with no count. */
  text(): string;
  /** What a screen reader is told instead. */
  label(): string;

  badgeProps(): BadgeProps;
}

/**
 * A count or a status, said properly.
 *
 *   class Inbox {
 *     unread = new Signal.State<number | null>(3);
 *     badge = createBadge({ count: this.unread, describes: 'unread messages', max: 99 });
 *   }
 *
 *   <button>
 *     Inbox
 *     <span :if="badge.isVisible()" :spread="badge.badgeProps()">{ badge.text() }</span>
 *   </button>
 *
 * The digits are hidden from assistive technology and replaced by the label,
 * so that button is named "Inbox 3 unread messages" rather than "Inbox 3".
 * That is what `role="img"` buys: it makes the badge a leaf whose name stands
 * in for its content, the same trick the avatar uses for initials.
 */
export function createBadge(options: BadgeOptions = {}): Badge {
  const state = options.count ?? new Signal.State<number | null>(options.defaultCount ?? null);
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const describes = options.describes ?? '';
  const live = options.live ?? 'off';

  const countLabel = options.labels?.count ?? ((n, what) => (what ? `${n} ${what}` : String(n)));
  const overflowLabel =
    options.labels?.overflow ??
    ((limit, what) => (what ? `More than ${limit} ${what}` : `More than ${limit}`));

  const count = (): number | null => {
    const raw = state.get();
    // A count that is not a real number is a caller bug. No count at all beats
    // a badge reading "NaN unread messages", which is announced as written.
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
    // Nobody counts a third of a message.
    return Math.trunc(raw);
  };

  const isOverflowed = (): boolean => {
    const current = count();
    return current !== null && current > max;
  };

  const isVisible = (): boolean => {
    const current = count();
    // No count means the badge carries its own text — "Beta", "Deprecated" —
    // and there is nothing here that could make it empty.
    if (current === null) return true;
    return current !== 0 || options.showZero === true;
  };

  const text = (): string => {
    const current = count();
    if (current === null) return '';
    return isOverflowed() ? `${max}+` : String(current);
  };

  const label = (): string => {
    const current = count();
    if (current === null) return describes;
    return isOverflowed() ? overflowLabel(max, describes) : countLabel(current, describes);
  };

  return {
    count,
    isVisible,
    isOverflowed,
    text,
    label,

    setCount(next) {
      if (untrack(() => state.get()) === next) return;
      state.set(next);
      options.onCountChange?.(next);
    },

    badgeProps: () => {
      const current = count();
      const props: Record<string, string> = {};
      if (current !== null) props['data-count'] = String(current);
      if (isOverflowed()) props['data-overflow'] = '';

      if (!isVisible()) {
        // Still in the DOM only because something is animating it out. "0
        // unread messages" is not worth saying, and the stale "3" it is fading
        // from would be a lie.
        props['aria-hidden'] = 'true';
        props['data-empty'] = '';
        return props;
      }

      const name = label();
      if (name) {
        // The name replaces the content rather than joining it: "99+" is an
        // abbreviation, and read aloud it is either "ninety nine plus" or
        // nothing at all depending on the screen reader.
        props.role = 'img';
        props['aria-label'] = name;
      }

      if (live !== 'off') {
        props['aria-live'] = live;
        props['aria-atomic'] = 'true';
      }

      return props;
    },
  };
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

export interface ChipLabels {
  /**
   * Accessible name for the remove control. Default `Remove Ada`, or plain
   * `Remove` when the chip has no label to name — five controls all called
   * "Remove" is the reason `label` is worth supplying.
   */
  remove?: (label: string) => string;
}

export interface ChipOptions {
  /** The chip's own element, once rendered. */
  chip: () => Element | null | undefined;
  /**
   * The element holding the sibling chips. Defaults to the chip's parent,
   * which is right whenever the chips are siblings; give it explicitly when
   * each chip is wrapped in something of its own.
   */
  container?: () => Element | null | undefined;
  /**
   * Where focus goes when the last chip is removed — usually the field that
   * creates them. Without one it lands on the container.
   */
  fallbackFocus?: () => Element | null | undefined;

  /** What the chip says, for the remove control's name. */
  label?: () => string | null | undefined;

  /** Whether it can be removed at all. Default true. */
  removable?: boolean;
  /** Announced as unavailable, and refuses to be removed. */
  disabled?: () => boolean;
  /**
   * Put the chip itself in the tab order. Default true.
   *
   * The chip is the tab stop and the remove control is not, so a field with
   * ten tags costs ten Tab presses rather than twenty. The cost is that the
   * remove control cannot be reached by Tab at all, which is why Delete and
   * Backspace on the chip do the same job. Set this false when the chips are
   * wrapped in `createRovingFocus` and the group owns the tab order instead.
   */
  focusable?: boolean;

  labels?: ChipLabels;
  /** Called when the chip asks to be removed. The consumer drops it. */
  onRemove?: () => void;
}

export interface ChipProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Chip {
  label(): string;
  isDisabled(): boolean;
  isRemovable(): boolean;
  /** The chip that will take focus when this one goes, or null. */
  neighbour(): HTMLElement | null;
  /** Move focus off, then ask to be removed. */
  remove(): void;
  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;

  chipProps(): ChipProps;
  removeProps(): ChipProps;
}

/**
 * A removable tag.
 *
 *   @Component({ selector: 'v-chip', render: compileTemplate(`
 *     <span :ref="el" :spread="chip.chipProps()" :keydown="chip.onKeyDown($event)">
 *       { tag }
 *       <button :spread="chip.removeProps()" :click="chip.remove()">×</button>
 *     </span>
 *   `) })
 *   class Tag {
 *     @Prop() tag = '';
 *     @Prop() onDrop: () => void = () => {};
 *     el = new Signal.State<Element | null>(null);
 *     chip = createChip({
 *       chip: () => this.el.get(),
 *       label: () => this.tag,
 *       onRemove: () => this.onDrop(),
 *     });
 *   }
 *
 * The one thing that has to be got right is where focus goes. Removing the
 * chip that has focus drops a keyboard user on `<body>`, at the top of the
 * document, with no way back to the field they were filling in — so focus
 * moves to the next chip first, or to the previous one when there is no next,
 * or to `fallbackFocus` when the last chip has just gone.
 *
 * Focus moves *before* `onRemove` runs, for two reasons: the chip is still in
 * the document, so `focusout` handlers see a coherent state; and a consumer
 * who wants focus somewhere else entirely can simply set it in `onRemove` and
 * win. The neighbour is found in the DOM rather than remembered, which is why
 * `container` matters — and why a list rendered without `:key` can still lose
 * focus, since the reconciler is then free to replace the node underneath it.
 *
 * Arrow keys are deliberately absent. A row of chips is a row of tab stops,
 * not a composite widget, and a primitive that owned the arrows would have to
 * own the tab order too; `createRovingFocus` over the same collection is the
 * thing to reach for when a field holds enough tags for Tab to be tedious.
 */
export function createChip(options: ChipOptions): Chip {
  const focusable = options.focusable !== false;
  const removable = options.removable !== false;
  const removeLabel = options.labels?.remove ?? ((name) => (name ? `Remove ${name}` : 'Remove'));

  const containerOf = (): Element | null =>
    options.container?.() ?? options.chip()?.parentElement ?? null;

  // Siblings are read from the DOM, in the order they appear, which is the
  // only place that order is actually true — an array of tags can be sorted or
  // filtered between renders.
  const siblings = createCollection(containerOf, { skipDisabled: false });

  const label = (): string => options.label?.()?.trim() ?? '';
  const isDisabled = (): boolean => options.disabled?.() === true;
  const isRemovable = (): boolean => removable && !isDisabled();

  const neighbour = (): HTMLElement | null => {
    const el = options.chip();
    if (!el) return null;
    const chips = siblings.all();
    const index = chips.indexOf(el as HTMLElement);
    if (index === -1) return null;
    // The one after, because the row closes up leftwards and that is where the
    // eye already is; the one before when this was the last.
    return chips[index + 1] ?? chips[index - 1] ?? null;
  };

  const focusFallback = (): void => {
    const explicit = asHtmlElement(options.fallbackFocus?.());
    if (explicit) {
      explicit.focus();
      return;
    }

    const box = asHtmlElement(containerOf());
    if (!box) return;
    // The container is almost certainly not focusable — a plain element
    // holding the chips — so it is made focusable without being put into the
    // tab order, the same trick the focus scope uses to keep focus from
    // escaping to the page.
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    box.focus();
  };

  const remove = (): void => {
    if (!isRemovable()) return;
    // Worked out first: once `onRemove` has run this chip may already be gone,
    // and a detached node has no siblings to measure from.
    const next = neighbour();
    if (next) next.focus();
    else focusFallback();
    options.onRemove?.();
  };

  return {
    label,
    isDisabled,
    isRemovable,
    neighbour,
    remove,

    onKeyDown(event: KeyboardEvent): boolean {
      // A modified key is a shortcut, not a deletion.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return false;
      // A chip with a field inside it — an editable tag — owns Backspace.
      // Deleting the tag out from under someone correcting its spelling is not
      // what the key meant.
      if (isEditable(event.target)) return false;
      if (!isRemovable()) return false;

      // Backspace is still "go back" in some browser configurations, and an
      // ancestor may treat Delete as a shortcut of its own; one press should
      // remove one chip and do nothing else.
      event.preventDefault();
      remove();
      return true;
    },

    chipProps: () => {
      const props: Record<string, string> = { [ITEM_ATTRIBUTE]: '' };
      // The text typeahead would match on, if the consumer wraps these in a
      // roving focus group.
      const name = label();
      if (name) props['data-label'] = name;
      if (focusable) props.tabindex = '0';
      if (isDisabled()) {
        // `aria-disabled`, never the `disabled` attribute: a disabled chip
        // stays in the accessibility tree, so it can still be read and heard
        // to be unavailable rather than appear to have vanished.
        props['aria-disabled'] = 'true';
        props['data-disabled'] = '';
      }
      return props;
    },

    removeProps: () => {
      const props: Record<string, string> = {
        // Inside a form, a button with no type submits it.
        type: 'button',
        'aria-label': removeLabel(label()),
        // Not a tab stop of its own when the chip is one — see `focusable`.
        // It stays reachable by pointer and by a screen reader's own cursor.
        tabindex: focusable ? '-1' : '0',
      };
      if (isDisabled()) props['aria-disabled'] = 'true';
      if (!removable) props['data-disabled'] = '';
      return props;
    },
  };
}

/** Whether a key press landed somewhere the user is typing. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * `el` as something that can be focused.
 *
 * The element's own view rather than the `HTMLElement` global, which does not
 * exist when rendering on a server.
 */
function asHtmlElement(el: Element | null | undefined): HTMLElement | null {
  const view = el?.ownerDocument?.defaultView;
  if (!view || !(el instanceof view.HTMLElement)) return null;
  return el;
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export type ImageStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface ImageBaseOptions {
  /** The `<img>` element, once rendered. */
  image: () => Element | null | undefined;

  /** What to load. Empty, null or undefined means there is nothing to fetch. */
  src: () => string | null | undefined;
  /** Candidate sources, and the widths that choose between them. */
  srcset?: () => string | null | undefined;
  sizes?: () => string | null | undefined;

  /**
   * Intrinsic size in CSS pixels. Both together are what reserve the space:
   * a modern browser derives `aspect-ratio` from the pair, so the box is the
   * right shape before a single byte arrives and nothing below it jumps when
   * the image lands.
   */
  width?: number;
  height?: number;
  /**
   * The ratio for the box, as CSS writes it — `16 / 9`. Overrides the one
   * implied by `width` and `height`, and is the way to reserve space for an
   * image whose pixel size is not known in advance.
   */
  aspectRatio?: string;

  /**
   * Default unset, which is the browser's own eager loading.
   *
   * `lazy` is not the default because the one image most likely to be marked
   * up carefully is the one at the top of the page, and lazy-loading that one
   * measurably delays it. Below the fold, set it.
   */
  loading?: 'eager' | 'lazy';
  /**
   * Default `async`, so decoding never blocks the main thread. `sync` is worth
   * it only when the image must appear in the same frame as the text beside
   * it.
   */
  decoding?: 'async' | 'sync' | 'auto';
  fetchPriority?: 'high' | 'low' | 'auto';

  /**
   * Supply a signal to control status from outside — a gallery that already
   * knows which of its images failed. Without one the image owns its own.
   */
  status?: Signal.State<ImageStatus>;
  onStatusChange?: (status: ImageStatus) => void;
}

/**
 * Options for `createImage`.
 *
 * The decorative-versus-meaningful rule is in the type, because it is the one
 * decision about an image that cannot be deferred and is wrong by default in
 * every codebase that leaves it optional. Either the picture carries meaning
 * the surrounding text does not, and it needs an `alt` describing what that
 * meaning is; or it is a flourish beside text that already says everything,
 * and it must be announced as nothing at all. There is no third answer, and
 * "no `alt` attribute" is not one either — a screen reader falls back to
 * reading the URL aloud.
 */
export type ImageOptions =
  | (ImageBaseOptions & {
      /** The picture adds nothing that the text around it does not already say. */
      decorative: true;
      alt?: never;
    })
  | (ImageBaseOptions & {
      decorative?: false;
      /** What the picture says. '' is not a shortcut for decorative; say so. */
      alt: () => string | null | undefined;
    });

export type ImageBoxStyle = Readonly<Record<string, string>>;

export interface ImageBoxProps {
  readonly [key: string]: string | ImageBoxStyle | undefined;
}

export interface ImageProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Image {
  status(): ImageStatus;
  isLoading(): boolean;
  isLoaded(): boolean;
  hasError(): boolean;
  /** Whether the picture is announced at all. */
  isDecorative(): boolean;
  /** The reserved ratio as CSS writes it, or null when no size is known. */
  aspectRatio(): string | null;

  /** For a wrapper that holds the space open. */
  boxProps(): ImageBoxProps;
  /** For the `<img>` itself. */
  imageProps(): ImageProps;
}

/**
 * A picture that reserves its space and knows how it went.
 *
 *   class Cover {
 *     img = new Signal.State<Element | null>(null);
 *     cover = createImage({
 *       image: () => this.img.get(),
 *       src: () => '/cover.jpg',
 *       alt: () => 'The first edition, in green cloth',
 *       width: 1200,
 *       height: 800,
 *     });
 *   }
 *
 *   <div :spread="cover.boxProps()">
 *     <img :ref="img" :spread="cover.imageProps()">
 *   </div>
 *
 * The load is watched on the rendered element rather than through a detached
 * `new Image()`. That costs one constraint — the element has to stay mounted,
 * because an element outside the document never loads — and buys three things:
 * no second request, `srcset` and `sizes` working because the browser is doing
 * the choosing, and no `document` global in a primitive that may run on a
 * server.
 */
export function createImage(options: ImageOptions): Image {
  const status = options.status ?? new Signal.State<ImageStatus>('idle');
  const decorative = options.decorative === true;
  const decoding = options.decoding ?? 'async';

  const readSrc = (): string => options.src()?.trim() ?? '';
  const readSrcset = (): string => options.srcset?.()?.trim() ?? '';
  const readAlt = (): string => (decorative ? '' : (options.alt?.() ?? ''));

  const size = (value: number | undefined): string | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : null;
  const width = size(options.width);
  const height = size(options.height);

  const aspectRatio = (): string | null => {
    if (options.aspectRatio) return options.aspectRatio;
    return width !== null && height !== null ? `${width} / ${height}` : null;
  };

  const setStatus = (next: ImageStatus) => {
    // Untracked: this runs from inside an effect, which must not come to depend
    // on the value it writes — a load event would otherwise re-run the effect
    // that started the load.
    if (untrack(() => status.get()) === next) return;
    status.set(next);
    options.onStatusChange?.(next);
  };

  effect(() => {
    const src = readSrc();
    const srcset = readSrcset();
    const el = options.image();

    if (!src && !srcset) {
      setStatus('idle');
      return;
    }
    setStatus('loading');

    // The element may not exist yet — rendered under a `:if`, or simply not
    // wired up on the first run — so there is nothing to do but run again when
    // the accessor produces one.
    if (!el) return;

    // A cached image can already be complete before this first runs: its load
    // event fired while nothing was listening, and will not fire again.
    if (isComplete(el)) {
      setStatus('loaded');
      return;
    }

    const onLoad = () => setStatus('loaded');
    const onError = () => setStatus('error');
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    onCleanup(() => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    });
  });

  return {
    status: () => status.get(),
    isLoading: () => status.get() === 'loading',
    isLoaded: () => status.get() === 'loaded',
    hasError: () => status.get() === 'error',
    isDecorative: () => decorative,
    aspectRatio,

    boxProps: () => {
      const ratio = aspectRatio();
      const props: Record<string, string | ImageBoxStyle> = { 'data-status': status.get() };
      // A ratio is not really styling: it is the shape of the hole the image
      // will fill, and getting it out of the primitive is the whole point of
      // knowing the size. Everything else about the box is the consumer's.
      if (ratio) props.style = { 'aspect-ratio': ratio };
      return props;
    },

    imageProps: () => {
      const props: Record<string, string> = {
        // Always an alt, even an empty one: an `<img>` with no alt attribute is
        // announced by reading its URL aloud, one path segment at a time.
        alt: readAlt(),
        decoding,
        'data-status': status.get(),
      };

      // Belt and braces on top of the empty alt. The two say the same thing,
      // and a sanitiser or a CMS that strips empty attributes leaves one of
      // them standing.
      if (decorative) props.role = 'presentation';

      // Omitted rather than set to undefined, because these are real
      // properties on the element: undefined would be stringified and fetched
      // as "/undefined". Re-applying an unchanged URL is not a new load, which
      // is what lets these props be rewritten on every status change.
      const src = readSrc();
      if (src) props.src = src;
      const srcset = readSrcset();
      if (srcset) props.srcset = srcset;
      const sizes = options.sizes?.()?.trim();
      if (sizes) props.sizes = sizes;

      if (options.loading) props.loading = options.loading;
      if (options.fetchPriority) props.fetchpriority = options.fetchPriority;
      if (width !== null) props.width = width;
      if (height !== null) props.height = height;

      return props;
    },
  };
}

/**
 * Whether an image has already finished loading successfully.
 *
 * The mirror-image inference — complete with no intrinsic width means the load
 * failed — is deliberately not made. An environment that never fetches images
 * is indistinguishable from a broken one by these two properties alone, and a
 * false 'error' is worse than waiting for an event a real browser will send.
 */
function isComplete(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  return el instanceof view.HTMLImageElement && el.complete && el.naturalWidth > 0;
}

// ---------------------------------------------------------------------------
// Keyboard key
// ---------------------------------------------------------------------------

/** Which key symbols to draw. */
export type KbdPlatform = 'apple' | 'other';

/** One key of a chord: its name, what is drawn, and what is said. */
export interface KbdPart {
  /** The `KeyboardEvent.key` name it came from. */
  readonly key: string;
  /** What to draw — `⌘`. */
  readonly text: string;
  /** What to say — `Command`. */
  readonly label: string;
}

export interface KbdLabels {
  /** What each key is drawn as, by `KeyboardEvent.key` name. Merged over the defaults. */
  symbols?: Readonly<Record<string, string>>;
  /** What each key is called aloud, by `KeyboardEvent.key` name. Merged over the defaults. */
  names?: Readonly<Record<string, string>>;
  /** Drawn between the keys. Default '' on Apple platforms, '+' elsewhere. */
  separator?: string;
  /** Spoken between the keys. Default a space. */
  join?: string;
}

export interface KbdOptions {
  /** The chord, in `KeyboardEvent.key` names: `['Meta', 'K']`. */
  keys: () => readonly string[] | string | null | undefined;
  /**
   * Which symbols to draw. Defaults to the platform the browser is running on,
   * sniffed from the user agent — which is unpleasant, and is the only thing
   * left: `navigator.platform` is deprecated and `userAgentData` is absent
   * from exactly the browser this most needs to be right about. An application
   * that knows better should say so.
   */
  platform?: KbdPlatform;
  labels?: KbdLabels;
}

export interface KbdProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Kbd {
  platform(): KbdPlatform;
  keys(): string[];
  /** One entry per key: what to draw and what to say. */
  parts(): KbdPart[];
  /** The whole chord as drawn — `⌘K`, `Ctrl+K`. */
  text(): string;
  /** The whole chord as spoken — `Command K`. */
  label(): string;

  kbdProps(): KbdProps;
  /** For each key when they are drawn as separate `<kbd>` elements. */
  keyProps(key: string): KbdProps;
}

/**
 * A keyboard shortcut, drawn as symbols and said as words.
 *
 *   <kbd :spread="shortcut.kbdProps()">{ shortcut.text() }</kbd>
 *
 * `⌘` read aloud is "place of interest sign" or, more often, silence — so the
 * element is a leaf with a name of its own, and the name is "Command K". That
 * is the whole of the semantics: `<kbd>` has no role, and needs none.
 *
 * Single characters are left in the case they were given. Upper-casing is a
 * visual convention, so it belongs in `text-transform`, and doing it here
 * would need a locale to be correct — a Turkish "i" upper-cases to "İ".
 */
export function createKbd(options: KbdOptions): Kbd {
  const platform = options.platform ?? detectPlatform();
  const symbols = platform === 'apple' ? APPLE_SYMBOLS : OTHER_SYMBOLS;
  const names = platform === 'apple' ? APPLE_NAMES : OTHER_NAMES;
  const separator = options.labels?.separator ?? (platform === 'apple' ? '' : '+');
  const join = options.labels?.join ?? ' ';

  const keys = (): string[] => {
    const raw = options.keys();
    if (!raw) return [];
    return (typeof raw === 'string' ? raw.split('+') : [...raw])
      .map((key) => (key === ' ' ? key : key.trim()))
      .filter(Boolean);
  };

  const parts = (): KbdPart[] =>
    keys().map((key) => ({
      key,
      text: options.labels?.symbols?.[key] ?? symbols[key] ?? key,
      label: options.labels?.names?.[key] ?? names[key] ?? SPOKEN[key] ?? key,
    }));

  const text = (): string => parts().map((part) => part.text).join(separator);
  const label = (): string => parts().map((part) => part.label).join(join);

  return {
    platform: () => platform,
    keys,
    parts,
    text,
    label,

    kbdProps: () => {
      const name = label();
      if (!name) return { 'data-platform': platform };
      return {
        // A leaf named by its label. Anything drawn inside — one `<kbd>` per
        // key, a separator glyph — is then out of the accessibility tree
        // already, so the parts need no `aria-hidden` of their own.
        role: 'img',
        'aria-label': name,
        'data-platform': platform,
      };
    },

    keyProps: (key: string) => ({ 'data-key': key }),
  };
}

const APPLE_SYMBOLS: Readonly<Record<string, string>> = {
  Meta: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  CapsLock: '⇪',
  Enter: '↩',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'esc',
  ' ': '␣',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
};

const OTHER_SYMBOLS: Readonly<Record<string, string>> = {
  Meta: 'Win',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  CapsLock: 'Caps',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Del',
  Escape: 'Esc',
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
};

/** Spoken names shared by every platform. */
const SPOKEN: Readonly<Record<string, string>> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  CapsLock: 'Caps lock',
  ' ': 'Space',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  PageUp: 'Page up',
  PageDown: 'Page down',
  Home: 'Home',
  End: 'End',
};

const APPLE_NAMES: Readonly<Record<string, string>> = {
  ...SPOKEN,
  Meta: 'Command',
  Control: 'Control',
  Alt: 'Option',
  Shift: 'Shift',
};

const OTHER_NAMES: Readonly<Record<string, string>> = {
  ...SPOKEN,
  Meta: 'Windows',
  Control: 'Control',
  Alt: 'Alt',
  Shift: 'Shift',
};

function detectPlatform(): KbdPlatform {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? 'apple' : 'other';
}

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

export interface CodeLabels {
  /**
   * Accessible name for a code block that scrolls. Default `TypeScript code`,
   * or plain `Code` when no language is known.
   */
  block?: (language: string) => string;
}

export interface CodeOptions {
  /** A block rather than a run of code inside a sentence. Default false. */
  block?: boolean;
  /** The `<pre>` wrapping a block, once rendered. Needed to know if it scrolls. */
  pre?: () => Element | null | undefined;
  /** Language name, written to `data-language` and used in the block's name. */
  language?: () => string | null | undefined;
  /** Accessible name for the block, overriding the one built from the language. */
  label?: string;
  labels?: CodeLabels;
}

export interface CodeProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Code {
  language(): string;
  /** Whether the block actually overflows, and so has to be operable by keyboard. */
  isScrollable(): boolean;

  /** For the `<code>`. */
  codeProps(): CodeProps;
  /** For the `<pre>` around a block. Empty for inline code. */
  preProps(): CodeProps;
}

/**
 * Code, inline or in a block.
 *
 *   <code :spread="inline.codeProps()">Array.prototype.at</code>
 *
 *   <pre :ref="pre" :spread="sample.preProps()">
 *     <code :spread="sample.codeProps()">…</code>
 *   </pre>
 *
 * Semantics only, and there are exactly two worth having.
 *
 * `role="code"` goes on unconditionally, because this cannot see what element
 * it is about to be spread onto: a `<span>` needs it and a `<code>` is not
 * harmed by being told what it already is.
 *
 * A block that overflows horizontally is a scroll container, and a scroll
 * container that cannot be focused cannot be scrolled by keyboard at all. So
 * it becomes a focusable, named region — but only while it really does
 * overflow, which is measured rather than assumed. The alternative, a
 * permanent `tabindex="0"`, puts an empty tab stop in front of every short
 * snippet on the page. The cost of naming it is one more landmark in the
 * landmark list; the cost of not naming it is a tab stop that announces
 * nothing when it takes focus.
 */
export function createCode(options: CodeOptions = {}): Code {
  const block = options.block === true;
  const overflowing = new Signal.State(false);

  const language = (): string => options.language?.()?.trim() ?? '';
  const blockLabel = options.labels?.block ?? ((lang) => (lang ? `${lang} code` : 'Code'));

  effect(() => {
    if (!block) return;
    const el = options.pre?.();
    if (!el) return;

    const view = el.ownerDocument?.defaultView;
    // No observer means no layout to observe: a server render, or a test DOM
    // that reports every box as zero. Assuming it does not scroll is the
    // conservative half of the guess — it leaves out a tab stop rather than
    // adding a nameless one.
    if (typeof view?.ResizeObserver !== 'function') return;

    const measure = () => overflowing.set(el.scrollWidth > el.clientWidth);
    measure();

    const observer = new view.ResizeObserver(measure);
    observer.observe(el);
    // The `<pre>` can stay exactly the same size while the code inside it
    // grows, which is the case that matters: a highlighter rewrites the
    // content after mount, and only the child's box changes.
    for (const child of el.children) observer.observe(child);
    onCleanup(() => observer.disconnect());
  });

  return {
    language,
    isScrollable: () => overflowing.get(),

    codeProps: () => {
      const props: Record<string, string> = { role: 'code' };
      const lang = language();
      if (lang) props['data-language'] = lang;
      return props;
    },

    preProps: () => {
      if (!block) return {};
      const props: Record<string, string> = { 'data-block': '' };
      const lang = language();
      if (lang) props['data-language'] = lang;
      if (!overflowing.get()) return props;

      props.tabindex = '0';
      props.role = 'region';
      props['aria-label'] = options.label ?? blockLabel(lang);
      return props;
    },
  };
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

export type RelativeTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface RelativeTimeLabels {
  /**
   * The relative text. Default `Intl.RelativeTimeFormat`, which already knows
   * every language's plural rules and its word for "yesterday".
   */
  relative?: (value: number, unit: RelativeTimeUnit, date: Date) => string;
  /** The absolute time behind it. Default a full local date and time. */
  absolute?: (date: Date) => string;
}

export interface RelativeTimeOptions {
  /** The moment being described. Strings are parsed by `Date`, so pass ISO 8601. */
  date: () => Date | number | string | null | undefined;

  /**
   * Supply a signal to control "now" from outside — a test, or a clock the
   * application already owns. Without one every live instance on the page
   * shares a single ticker.
   */
  now?: Signal.State<number>;
  /**
   * Keep it up to date. Default true. When false the text is still correct
   * every time it is read; it simply never re-reads itself.
   */
  live?: boolean;

  /** BCP 47 locale. Defaults to the browser's. */
  locale?: string | string[];
  /** Default `long`, which is the one a screen reader reads as a sentence. */
  style?: Intl.RelativeTimeFormatStyle;
  /** `auto` turns "1 day ago" into "yesterday". Default `auto`. */
  numeric?: Intl.RelativeTimeFormatNumeric;
  /** How the absolute time in `title` is formatted. */
  absoluteOptions?: Intl.DateTimeFormatOptions;

  labels?: RelativeTimeLabels;
}

export interface RelativeTimeProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface RelativeTime {
  /** The parsed date, or null when it could not be parsed. */
  date(): Date | null;
  /** The unit the text is currently expressed in. */
  unit(): RelativeTimeUnit;
  /** How many of that unit away, negative in the past. */
  value(): number;
  /** The relative text — "3 minutes ago". */
  text(): string;
  /** The absolute time, as it appears in `title`. */
  absolute(): string;

  timeProps(): RelativeTimeProps;
}

/**
 * A timestamp that reads the way a person would say it, and stays true.
 *
 *   class Comment {
 *     posted = createRelativeTime({ date: () => this.postedAt });
 *   }
 *
 *   <time :spread="posted.timeProps()">{ posted.text() }</time>
 *
 * Every live instance shares one ticker. A timer each is the obvious
 * implementation and the wrong one: a comment thread with two hundred
 * timestamps then holds two hundred timers, all firing at slightly different
 * moments, none of them coordinated, and none of them stopping when the tab
 * goes to the background. Here there is exactly one timeout on the page, its
 * period is the shortest any instance asks for, and it stops entirely when
 * nothing is mounted or the document is hidden — with a catch-up the moment it
 * comes back.
 *
 * The period is a fraction of the unit on display — a second for seconds, ten
 * seconds for minutes — rather than the exact moment the text would change.
 * Waking on the boundary is more accurate and needs a timer per instance to be
 * worth anything, which is the thing being avoided; the text is instead never
 * more than that fraction stale.
 *
 * There is no live region. A timestamp quietly becoming "4 minutes ago" is not
 * news, and a page of them announcing themselves in turn is unusable. The
 * absolute time goes in `title`, and the machine-readable one in `datetime`,
 * so nothing about the exact moment is lost.
 */
export function createRelativeTime(options: RelativeTimeOptions): RelativeTime {
  const live = options.live !== false;
  const external = options.now;

  // Built once and kept: constructing an Intl formatter is expensive enough
  // that doing it per render shows up on a page with a few hundred of these.
  let relativeFormat: Intl.RelativeTimeFormat | null = null;
  let absoluteFormat: Intl.DateTimeFormat | null = null;

  const now = (): number => {
    if (external) return external.get();
    // Not live: correct whenever it is read, and never a reason to re-render.
    if (!live) return Date.now();
    return clock.get();
  };

  const date = (): Date | null => toDate(options.date());

  const parts = (): { value: number; unit: RelativeTimeUnit } => {
    const target = date();
    if (!target) return { value: 0, unit: 'second' };
    return difference(target, new Date(now()));
  };

  const text = (): string => {
    const target = date();
    if (!target) return '';
    const { value, unit } = parts();
    const custom = options.labels?.relative;
    if (custom) return custom(value, unit, target);
    relativeFormat ??= new Intl.RelativeTimeFormat(options.locale, {
      numeric: options.numeric ?? 'auto',
      style: options.style ?? 'long',
    });
    return relativeFormat.format(value, unit);
  };

  const absolute = (): string => {
    const target = date();
    if (!target) return '';
    const custom = options.labels?.absolute;
    if (custom) return custom(target);
    absoluteFormat ??= new Intl.DateTimeFormat(
      options.locale,
      options.absoluteOptions ?? { dateStyle: 'long', timeStyle: 'short' },
    );
    return absoluteFormat.format(target);
  };

  if (live && !external) {
    subscribeToClock(() => {
      const target = date();
      // Nothing to keep up to date, so ask for the slowest period going and
      // let some other instance set the pace.
      if (!target) return DAY;
      return periodFor(difference(target, new Date(clock.get())).unit);
    });
  }

  return {
    date,
    unit: () => parts().unit,
    value: () => parts().value,
    text,
    absolute,

    timeProps: () => {
      const target = date();
      // A `<time>` with an unparseable `datetime` is worse than a plain span:
      // it claims a machine-readable moment and gives a broken one.
      if (!target) return {};

      const props: Record<string, string> = {
        datetime: target.toISOString(),
        'data-unit': parts().unit,
      };
      const title = absolute();
      if (title) props.title = title;
      return props;
    },
  };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The one ticker, and everything that wants waking by it.
 *
 * Each entry is a function returning the period that instance would like, in
 * milliseconds; the ticker runs at the smallest of them and is rescheduled
 * after every tick, because an instance's answer changes as its timestamp
 * ages out of seconds and into minutes.
 */
const tickers = new Set<() => number>();
const clock = new Signal.State(Date.now());
let timer: ReturnType<typeof setTimeout> | null = null;
let watchingVisibility = false;

/** Test seam: how many instances the shared ticker is driving. */
export function relativeTimeTickerSize(): number {
  return tickers.size;
}

function schedule(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (tickers.size === 0) return;
  // A tab nobody is looking at does not need the time updating. Nothing is
  // lost: coming back sets the clock before anything is painted.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  let period = Number.POSITIVE_INFINITY;
  // Untracked: this runs during a flush as often as not, and a ticker that
  // subscribed to the signals it reads would re-enter the graph it is driving.
  for (const wanted of tickers) period = Math.min(period, untrack(wanted));
  if (!Number.isFinite(period)) return;

  timer = setTimeout(() => {
    clock.set(Date.now());
    schedule();
  }, Math.max(period, SECOND));
}

const onVisibilityChange = (): void => {
  if (document.visibilityState === 'visible') clock.set(Date.now());
  schedule();
};

function subscribeToClock(period: () => number): void {
  // The shared clock stops when the last instance goes, so it may be an hour
  // stale by the time a new one arrives.
  clock.set(Date.now());

  tickers.add(period);
  if (!watchingVisibility && typeof document !== 'undefined') {
    watchingVisibility = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  schedule();

  onCleanup(() => {
    tickers.delete(period);
    if (tickers.size === 0 && watchingVisibility) {
      watchingVisibility = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    schedule();
  });
}

/** How often a timestamp showing this unit is worth re-reading. */
function periodFor(unit: RelativeTimeUnit): number {
  switch (unit) {
    case 'second':
      return SECOND;
    case 'minute':
      return 10 * SECOND;
    case 'hour':
      return MINUTE;
    default:
      return 5 * MINUTE;
  }
}

function toDate(input: Date | number | string | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How far `target` is from `now`, in the largest unit that still says
 * something — negative in the past, positive in the future.
 *
 * Below a day it is elapsed time, because that is what "five minutes ago"
 * means and it is more use than "yesterday" would be. From a day up it is
 * calendar arithmetic, because from there on the unit is a date rather than a
 * duration: at 01:00 on Tuesday, something posted at 23:00 on Sunday is
 * twenty-six hours old, and calling that "yesterday" is wrong — it was the day
 * before yesterday, and only counting the midnights between says so. Rounding
 * the day difference also absorbs the 23- and 25-hour days daylight saving
 * produces.
 */
function difference(target: Date, now: Date): { value: number; unit: RelativeTimeUnit } {
  const ms = target.getTime() - now.getTime();
  const size = Math.abs(ms);

  if (size < MINUTE) return { value: Math.trunc(ms / SECOND), unit: 'second' };
  if (size < HOUR) return { value: Math.trunc(ms / MINUTE), unit: 'minute' };
  if (size < DAY) return { value: Math.trunc(ms / HOUR), unit: 'hour' };

  const days = calendarDays(target, now);
  if (Math.abs(days) < 7) return { value: days, unit: 'day' };

  const months = calendarMonths(target, now);
  if (months === 0) return { value: Math.trunc(days / 7), unit: 'week' };
  if (Math.abs(months) < 12) return { value: months, unit: 'month' };
  return { value: Math.trunc(months / 12), unit: 'year' };
}

function calendarDays(target: Date, now: Date): number {
  return Math.round((startOfDay(target) - startOfDay(now)) / DAY);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Whole calendar months between two dates.
 *
 * The day of the month has to have come round as well, or the 25th of January
 * and the 3rd of February — nine days apart — would be reported as a month.
 */
function calendarMonths(target: Date, now: Date): number {
  let months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  if (months > 0 && target.getDate() < now.getDate()) months -= 1;
  if (months < 0 && target.getDate() > now.getDate()) months += 1;
  return months;
}
