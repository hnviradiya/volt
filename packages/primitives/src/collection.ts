/**
 * Collection — the items of a menu, listbox, tab list or tree, in DOM order.
 *
 * Roving focus, typeahead and "move to next enabled item" all need the same
 * thing: the items, ordered as they appear on screen, with the disabled ones
 * excluded. Getting that order from registration order is wrong, because a
 * list rendered from `:for` registers in array order but can be reordered,
 * filtered, or split across nested groups. So the order is read from the DOM,
 * which is the only place it is actually true.
 *
 * Items mark themselves with a data attribute rather than registering through
 * a context. That keeps a menu item from needing to know it is inside a menu,
 * which is what makes `<MenuItem>` usable inside a group, a submenu, or a
 * fragment the consumer wrote themselves.
 */

export const ITEM_ATTRIBUTE = 'data-volt-item';

export interface CollectionOptions {
  /** Attribute marking an item. Defaults to `data-volt-item`. */
  attribute?: string;
  /** Treat `[data-disabled]` items as skippable. Default true. */
  skipDisabled?: boolean;
}

export interface Collection {
  /** Items in DOM order, disabled ones included. */
  all(): HTMLElement[];
  /** Items that can be moved to. */
  enabled(): HTMLElement[];
  /** Index of `el` among the enabled items, or -1. */
  indexOf(el: Element | null | undefined): number;
  /** The enabled item at `index`, clamped or wrapped per `loop`. */
  at(index: number, loop?: boolean): HTMLElement | null;
  /** The enabled item `delta` places from `from`. */
  next(from: Element | null | undefined, delta: number, loop?: boolean): HTMLElement | null;
  first(): HTMLElement | null;
  last(): HTMLElement | null;
  /** First enabled item whose text starts with `search`, after `from`. */
  match(search: string, from?: Element | null): HTMLElement | null;
}

export function createCollection(
  container: () => Element | null | undefined,
  options: CollectionOptions = {},
): Collection {
  const attribute = options.attribute ?? ITEM_ATTRIBUTE;
  const skipDisabled = options.skipDisabled !== false;

  const all = (): HTMLElement[] => {
    const root = container();
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)];
  };

  const enabled = (): HTMLElement[] =>
    skipDisabled
      ? all().filter((el) => !el.hasAttribute('data-disabled') && !el.hasAttribute('disabled'))
      : all();

  const indexOf = (el: Element | null | undefined): number =>
    el ? enabled().indexOf(el as HTMLElement) : -1;

  const at = (index: number, loop = false): HTMLElement | null => {
    const items = enabled();
    if (items.length === 0) return null;
    if (loop) {
      // `%` alone leaves negatives negative, which is exactly the wrap-backwards
      // case this is for.
      const wrapped = ((index % items.length) + items.length) % items.length;
      return items[wrapped]!;
    }
    return items[Math.min(Math.max(index, 0), items.length - 1)] ?? null;
  };

  return {
    all,
    enabled,
    indexOf,
    at,

    next(from, delta, loop = true) {
      const items = enabled();
      if (items.length === 0) return null;
      const current = indexOf(from);
      // With nothing current, a forward move starts at the first item and a
      // backward move at the last — which is what Home/End-less arrow entry
      // into a fresh menu should do.
      if (current === -1) return delta > 0 ? items[0]! : items[items.length - 1]!;
      return at(current + delta, loop);
    },

    first: () => enabled()[0] ?? null,
    last: () => {
      const items = enabled();
      return items[items.length - 1] ?? null;
    },

    match(search, from) {
      const items = enabled();
      if (items.length === 0 || !search) return null;

      const needle = search.toLowerCase();
      // -1 when there is no current item, which makes the loop below start at
      // item 0 — otherwise the very first keystroke would skip the first item.
      const start = indexOf(from);

      // Start just after the current item and wrap all the way round, so
      // repeatedly typing one letter walks through the items beginning with
      // it, and the current item is considered last rather than not at all.
      for (let i = 1; i <= items.length; i++) {
        const item = items[(start + i + items.length) % items.length]!;
        if (textOf(item).toLowerCase().startsWith(needle)) return item;
      }
      return null;
    },
  };
}

/**
 * The text a user would say this item is.
 *
 * `data-label` wins when present, because an item's visible text may include
 * an icon's alt text, a keyboard shortcut, or a badge — none of which anyone
 * types when reaching for it.
 */
function textOf(el: HTMLElement): string {
  return (el.getAttribute('data-label') ?? el.textContent ?? '').trim();
}
