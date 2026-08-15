/**
 * Roving focus — arrow-key navigation over a collection.
 *
 * The pattern behind menus, tab lists, toolbars, radio groups and trees: the
 * collection holds one tab stop, and the arrow keys move it. Tab therefore
 * enters and leaves the whole group in one press instead of walking through
 * every item, which is the entire point — a twenty-item menu that costs twenty
 * Tab presses to step over is a keyboard trap in everything but name.
 *
 * Direction is resolved against writing direction, so Left and Right swap
 * under `dir="rtl"`. Up and Down never swap: vertical order is not mirrored.
 *
 * Typeahead is included because it belongs to the same key handler. It has to
 * compose with arrow keys — typing "s" in a menu should jump to Save, not be
 * swallowed as a shortcut — and splitting them across two handlers makes that
 * ordering ambiguous.
 */

import { onCleanup } from '@voltjs/core';
import type { Collection } from './collection.js';

export type Orientation = 'vertical' | 'horizontal' | 'both';

export interface RovingFocusOptions {
  /** Which arrows move. Default vertical. */
  orientation?: Orientation;
  /** Wrap past the ends. Default true. */
  loop?: boolean;
  /** Typing letters jumps to a matching item. Default true. */
  typeahead?: boolean;
  /** Called when an item is chosen with Enter or Space. */
  onSelect?: (item: HTMLElement) => void;
  /** How long typed characters accumulate, in ms. Default 500. */
  typeaheadTimeout?: number;
}

export interface RovingFocus {
  /** Handle a keydown. Returns true when it was consumed. */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Move focus to an item and make it the group's tab stop. */
  focus(item: HTMLElement | null): void;
  /** Props for each item — index decides which one holds the tab stop. */
  itemProps(item: Element | null | undefined): { tabindex: string };
}

export function createRovingFocus(
  collection: Collection,
  active: () => Element | null | undefined,
  setActive: (el: HTMLElement | null) => void,
  options: RovingFocusOptions = {},
): RovingFocus {
  const orientation = options.orientation ?? 'vertical';
  const loop = options.loop !== false;

  let search = '';
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (searchTimer !== null) clearTimeout(searchTimer);
  });

  const focus = (item: HTMLElement | null) => {
    if (!item) return;
    setActive(item);
    item.focus();
  };

  const move = (delta: number) => {
    focus(collection.next(active(), delta, loop) as HTMLElement | null);
  };

  return {
    focus,

    itemProps(item) {
      const current = active();
      // Exactly one item is in the tab order. With nothing active yet the
      // first item takes it, so Tab can enter the group at all.
      const isTabStop = current ? item === current : item === collection.first();
      return { tabindex: isTabStop ? '0' : '-1' };
    },

    onKeyDown(event: KeyboardEvent): boolean {
      // A modified key is a shortcut, not navigation.
      if (event.ctrlKey || event.metaKey || event.altKey) return false;

      const vertical = orientation === 'vertical' || orientation === 'both';
      const horizontal = orientation === 'horizontal' || orientation === 'both';

      // Resolve arrows against writing direction. Only the horizontal pair
      // mirrors — vertical order is the same in every direction.
      const rtl = isRtl(event.currentTarget ?? event.target);
      const forwardKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      const backKey = rtl ? 'ArrowRight' : 'ArrowLeft';

      switch (event.key) {
        case 'ArrowDown':
          if (!vertical) return false;
          move(1);
          return true;
        case 'ArrowUp':
          if (!vertical) return false;
          move(-1);
          return true;
        case forwardKey:
          if (!horizontal) return false;
          move(1);
          return true;
        case backKey:
          if (!horizontal) return false;
          move(-1);
          return true;
        case 'Home':
          focus(collection.first());
          return true;
        case 'End':
          focus(collection.last());
          return true;
        case 'Enter':
        case ' ': {
          const current = active() as HTMLElement | null;
          if (!current) return false;
          options.onSelect?.(current);
          return true;
        }
        default:
          break;
      }

      if (options.typeahead === false) return false;
      // Single printable characters only: anything longer is a named key.
      if (event.key.length !== 1 || event.key === ' ') return false;

      search += event.key;
      if (searchTimer !== null) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        search = '';
        searchTimer = null;
      }, options.typeaheadTimeout ?? 500);

      // Repeating one character walks through items starting with it, rather
      // than searching for "aaa" — the behaviour every native listbox has.
      const query = search.length > 1 && [...search].every((c) => c === search[0])
        ? search[0]!
        : search;

      const match = collection.match(query, active());
      if (match) focus(match);
      return Boolean(match);
    },
  };
}

/**
 * Writing direction at `target`.
 *
 * The nearest `dir` attribute wins over computed style. An application that
 * marks up direction with `dir` is stating intent, and reading the attribute
 * also works before styles resolve — during construction, and in test
 * environments that do not implement `direction` at all.
 */
function isRtl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const declared = target.closest('[dir]');
  if (declared) return declared.getAttribute('dir')?.toLowerCase() === 'rtl';

  const view = target.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(target).direction === 'rtl';
}
