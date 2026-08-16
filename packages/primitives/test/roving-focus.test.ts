/**
 * Collection ordering and roving focus.
 *
 * These two carry menus, tab lists, toolbars, radio groups, trees, selects and
 * comboboxes between them, so the edge cases here — wrapping, disabled items,
 * RTL, repeated-character typeahead — are paid for many times over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, flushSync } from '@volt/core';
import { createCollection, createRovingFocus } from '@volt/primitives';

let disposers: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = `
    <div id="menu">
      <button data-volt-item id="save">Save</button>
      <button data-volt-item id="send" data-disabled>Send</button>
      <button data-volt-item id="share">Share</button>
      <button data-volt-item id="delete">Delete</button>
    </div>`;
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
});

const el = (id: string) => document.querySelector(`#${id}`) as HTMLElement;
const menu = () => document.querySelector('#menu')!;

function build(options: Parameters<typeof createRovingFocus>[3] = {}) {
  const collection = createCollection(() => menu());
  let active: HTMLElement | null = null;
  let roving!: ReturnType<typeof createRovingFocus>;

  createRoot((dispose) => {
    disposers.push(dispose);
    roving = createRovingFocus(
      collection,
      () => active,
      (el) => {
        active = el;
      },
      options,
    );
  });

  const key = (k: string, target: Element = menu()) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true });
    Object.defineProperty(event, 'currentTarget', { value: target });
    return roving.onKeyDown(event);
  };

  return { collection, roving, key, active: () => active };
}

describe('collection order', () => {
  it('reads items in DOM order, not registration order', () => {
    const { collection } = build();
    expect(collection.all().map((n) => n.id)).toEqual(['save', 'send', 'share', 'delete']);
  });

  it('excludes disabled items from navigation', () => {
    const { collection } = build();
    expect(collection.enabled().map((n) => n.id)).toEqual(['save', 'share', 'delete']);
  });

  it('follows the DOM when items are reordered', () => {
    const { collection } = build();
    menu().prepend(el('delete'));
    // A `:for` list can reorder without re-registering; the DOM is the truth.
    expect(collection.enabled().map((n) => n.id)).toEqual(['delete', 'save', 'share']);
  });
});

describe('arrow navigation', () => {
  it('moves down, skipping disabled items', () => {
    const { key, active } = build();
    key('ArrowDown');
    expect(active()!.id).toBe('save');
    key('ArrowDown');
    expect(active()!.id).toBe('share');
  });

  it('wraps at both ends by default', () => {
    const { key, active } = build();
    key('End');
    expect(active()!.id).toBe('delete');
    key('ArrowDown');
    expect(active()!.id).toBe('save');
    key('ArrowUp');
    expect(active()!.id).toBe('delete');
  });

  it('clamps instead of wrapping when told to', () => {
    const { key, active } = build({ loop: false });
    key('End');
    key('ArrowDown');
    expect(active()!.id).toBe('delete');
  });

  it('enters from the end when moving backwards first', () => {
    const { key, active } = build();
    key('ArrowUp');
    expect(active()!.id).toBe('delete');
  });

  it('ignores the axis it does not own', () => {
    const { key, active } = build({ orientation: 'vertical' });
    expect(key('ArrowRight')).toBe(false);
    expect(active()).toBeNull();
  });

  it('goes to the ends with Home and End', () => {
    const { key, active } = build();
    key('End');
    expect(active()!.id).toBe('delete');
    key('Home');
    expect(active()!.id).toBe('save');
  });

  it('leaves modified keys alone', () => {
    const { roving, active } = build();
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true });
    // Ctrl+Down is a shortcut, not navigation.
    expect(roving.onKeyDown(event)).toBe(false);
    expect(active()).toBeNull();
  });
});

describe('right-to-left', () => {
  it('swaps the horizontal arrows only', () => {
    menu().setAttribute('dir', 'rtl');
    const { key, active } = build({ orientation: 'horizontal' });

    // In RTL, "next" is to the left.
    key('ArrowLeft');
    expect(active()!.id).toBe('save');
    key('ArrowLeft');
    expect(active()!.id).toBe('share');
    key('ArrowRight');
    expect(active()!.id).toBe('save');
  });
});

describe('typeahead', () => {
  it('jumps to the first item starting with the character', () => {
    const { key, active } = build();
    key('d');
    expect(active()!.id).toBe('delete');
  });

  it('accumulates characters into a prefix', () => {
    const { key, active } = build();
    key('s');
    key('h');
    // "sh" is Share, not Save — so the second key must refine, not restart.
    expect(active()!.id).toBe('share');
  });

  it('walks through matches when one character repeats', () => {
    const { key, active } = build();
    key('s');
    expect(active()!.id).toBe('save');
    key('s');
    // "ss" matches nothing; repeating a letter cycles the s-items instead.
    expect(active()!.id).toBe('share');
  });

  it('skips disabled items', () => {
    const { key, active } = build();
    key('s');
    key('s');
    key('s');
    // Send is disabled, so cycling never lands on it.
    expect(active()!.id).toBe('save');
  });

  it('can be turned off', () => {
    const { key, active } = build({ typeahead: false });
    expect(key('d')).toBe(false);
    expect(active()).toBeNull();
  });
});

describe('selection and tab stops', () => {
  it('reports the chosen item on Enter', () => {
    const onSelect = vi.fn();
    const { key } = build({ onSelect });
    key('ArrowDown');
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith(el('save'));
  });

  it('keeps exactly one item in the tab order', () => {
    const { roving, key } = build();
    const stops = () =>
      ['save', 'send', 'share', 'delete'].map((id) => roving.itemProps(el(id)).tabindex);

    // Before any movement the first item is the way in.
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);

    key('End');
    // Tab now leaves the group in one press, rather than walking every item.
    expect(stops()).toEqual(['-1', '-1', '-1', '0']);
  });
});
