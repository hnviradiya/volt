/**
 * Badge, chip, image, keyboard key, code and relative time, driven through
 * real mounted components.
 *
 * What is worth asserting in all six is the part a screenshot cannot show:
 * what a screen reader is told instead of the digits, where focus lands when
 * the element holding it is deleted, whether an attribute that must never be
 * the string "undefined" is omitted, and that two hundred timestamps really do
 * share one timer rather than merely looking as though they do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, createRoot, flushSync, mount } from '@voltdev/core';
import {
  createBadge,
  createChip,
  createCode,
  createImage,
  createKbd,
  createRelativeTime,
  relativeTimeTickerSize,
  type BadgeOptions,
  type ImageOptions,
  type ImageStatus,
  type KbdOptions,
  type RelativeTimeOptions,
} from '../src/display-extras.ts';

let host: HTMLElement;
let mounted: { unmount(): void }[] = [];
let disposers: (() => void)[] = [];

function track<T extends { unmount(): void }>(handle: T): T {
  mounted.push(handle);
  return handle;
}

/** Run a primitive that owns effects outside a component. */
function inRoot<T>(build: () => T): T {
  let result!: T;
  createRoot((dispose) => {
    disposers.push(dispose);
    result = build();
  });
  return result;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app') as HTMLElement;
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  for (const dispose of disposers) dispose();
  mounted = [];
  disposers = [];
  flushSync();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

/** The shape a consumer writes: a count tucked inside the thing it counts for. */
function mountBadge(overrides: Partial<BadgeOptions> = {}) {
  @Component({
    selector: 'v-inbox',
    render: compileTemplate(`
      <button>
        Inbox
        <span :if="badge.isVisible()" class="badge"
              :spread="badge.badgeProps()">{ badge.text() }</span>
      </button>
    `),
  })
  class Inbox {
    unread = new Signal.State<number | null>(3);
    badge = createBadge({
      count: this.unread,
      describes: 'unread messages',
      ...overrides,
    });
  }

  const handle = track(mount(Inbox, host));
  const instance = handle.instance as Inbox;
  return {
    instance,
    badge: instance.badge,
    el: () => host.querySelector('.badge'),
    button: () => host.querySelector('button') as HTMLButtonElement,
  };
}

describe('badge naming', () => {
  it('says what the number counts rather than leaving a bare digit', () => {
    const { el } = mountBadge();
    flushSync();

    // Without this the button is announced as "Inbox 3", which says nothing
    // about what three of them there are.
    expect(el()!.getAttribute('aria-label')).toBe('3 unread messages');
    expect(el()!.textContent?.trim()).toBe('3');
    // role="img" is what makes the label replace the digits instead of being
    // read alongside them.
    expect(el()!.getAttribute('role')).toBe('img');
  });

  it('abbreviates past max on screen and spells it out in speech', () => {
    const { badge, el } = mountBadge({ max: 99 });
    badge.setCount(150);
    flushSync();

    expect(el()!.textContent?.trim()).toBe('99+');
    expect(el()!.getAttribute('aria-label')).toBe('More than 99 unread messages');
    expect(el()!.hasAttribute('data-overflow')).toBe(true);
    // The real count is still what CSS and tests can see.
    expect(el()!.getAttribute('data-count')).toBe('150');
  });

  it('leaves exactly max alone — the cap is a ceiling, not a limit', () => {
    const { badge, el } = mountBadge({ max: 99 });
    badge.setCount(99);
    flushSync();

    expect(badge.isOverflowed()).toBe(false);
    expect(el()!.textContent?.trim()).toBe('99');
  });

  it('takes both strings from labels', () => {
    const { badge, el } = mountBadge({
      max: 9,
      labels: {
        count: (n, what) => `${n} ${what}, unread`,
        overflow: (m, what) => `over ${m} ${what}`,
      },
    });
    flushSync();
    expect(el()!.getAttribute('aria-label')).toBe('3 unread messages, unread');

    badge.setCount(20);
    flushSync();
    expect(el()!.getAttribute('aria-label')).toBe('over 9 unread messages');
  });
});

describe('badge counting', () => {
  it('disappears at zero, and stays when told to', () => {
    const { badge, el } = mountBadge();
    badge.setCount(0);
    flushSync();
    expect(el()).toBeNull();

    const kept = mountBadge({ showZero: true });
    kept.badge.setCount(0);
    flushSync();
    expect(kept.el()!.getAttribute('aria-label')).toBe('0 unread messages');
  });

  it('goes quiet rather than lying when it is kept mounted while empty', () => {
    // A consumer animating the badge out keeps the node; it must not still be
    // announcing the count it is fading away from.
    @Component({
      selector: 'v-kept',
      render: compileTemplate(
        `<span class="badge" :spread="badge.badgeProps()">{ badge.text() }</span>`,
      ),
    })
    class Kept {
      unread = new Signal.State<number | null>(3);
      badge = createBadge({ count: this.unread, describes: 'unread messages' });
    }

    const handle = track(mount(Kept, host));
    const instance = handle.instance as Kept;
    flushSync();
    expect(host.querySelector('.badge')!.hasAttribute('aria-hidden')).toBe(false);

    instance.unread.set(0);
    flushSync();
    const el = host.querySelector('.badge')!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('reports no count at all rather than announcing NaN', () => {
    const { instance, badge, el } = mountBadge();
    instance.unread.set(Number.NaN);
    flushSync();

    // "NaN unread messages" is read out exactly as written.
    expect(badge.count()).toBeNull();
    expect(el()!.hasAttribute('data-count')).toBe(false);
    expect(el()!.getAttribute('aria-label')).toBe('unread messages');
  });

  it('truncates a fraction rather than announcing one', () => {
    const { instance, badge } = mountBadge();
    instance.unread.set(3.7);
    flushSync();
    expect(badge.count()).toBe(3);
  });

  it('reports changes once, and not when nothing changed', () => {
    const onCountChange = vi.fn();
    const { badge } = mountBadge({ onCountChange });

    badge.setCount(4);
    expect(onCountChange).toHaveBeenCalledWith(4);

    badge.setCount(4);
    expect(onCountChange).toHaveBeenCalledTimes(1);
  });

  it('follows a signal supplied from outside', () => {
    const count = new Signal.State<number | null>(1);
    const { el } = mountBadge({ count });

    count.set(7);
    flushSync();
    expect(el()!.textContent?.trim()).toBe('7');
  });
});

describe('badge announcements', () => {
  it('says nothing spontaneously by default', () => {
    const { el } = mountBadge();
    flushSync();
    expect(el()!.hasAttribute('aria-live')).toBe(false);
  });

  it('re-announces the whole badge when asked to, not just the digits', () => {
    const { el } = mountBadge({ live: 'polite' });
    flushSync();
    expect(el()!.getAttribute('aria-live')).toBe('polite');
    // Without atomic, what is announced is the changed text node — "4" — and
    // the label that gives it meaning is never read.
    expect(el()!.getAttribute('aria-atomic')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

/**
 * Three tags and a field to type new ones into — the arrangement a chip is
 * nearly always part of, and the reason removal has to think about focus.
 *
 * The last chip holds a text field, because an editable tag is the one place
 * Backspace must not delete the tag out from under the person typing.
 */
@Component({
  selector: 'v-tags',
  render: compileTemplate(`
    <div>
      <div class="list" :ref="list">
        <span :if="has('ada')" class="chip" data-name="ada" :ref="adaEl"
              :spread="ada.chipProps()" :keydown="ada.onKeyDown($event)">Ada<button
              class="remove" :spread="ada.removeProps()" :click="ada.remove()">x</button></span>
        <span :if="has('grace')" class="chip" data-name="grace" :ref="graceEl"
              :spread="grace.chipProps()" :keydown="grace.onKeyDown($event)">Grace<button
              class="remove" :spread="grace.removeProps()" :click="grace.remove()">x</button></span>
        <span :if="has('alan')" class="chip" data-name="alan" :ref="alanEl"
              :spread="alan.chipProps()" :keydown="alan.onKeyDown($event)">Alan<input
              class="edit"><button
              class="remove" :spread="alan.removeProps()" :click="alan.remove()">x</button></span>
      </div>
      <input class="field" :ref="field">
    </div>
  `),
})
class Tags {
  tags = new Signal.State(['ada', 'grace', 'alan']);
  frozen = new Signal.State(false);

  list = new Signal.State<Element | null>(null);
  field = new Signal.State<Element | null>(null);
  adaEl = new Signal.State<Element | null>(null);
  graceEl = new Signal.State<Element | null>(null);
  alanEl = new Signal.State<Element | null>(null);

  /** Where focus was at the moment each removal was reported. */
  focusOnRemove: (Element | null)[] = [];

  has(name: string): boolean {
    return this.tags.get().includes(name);
  }

  drop(name: string): void {
    this.focusOnRemove.push(document.activeElement);
    this.tags.set(this.tags.get().filter((tag) => tag !== name));
  }

  ada = createChip({
    chip: () => this.adaEl.get(),
    container: () => this.list.get(),
    fallbackFocus: () => this.field.get(),
    label: () => 'Ada',
    onRemove: () => this.drop('ada'),
  });

  grace = createChip({
    chip: () => this.graceEl.get(),
    container: () => this.list.get(),
    fallbackFocus: () => this.field.get(),
    label: () => 'Grace',
    disabled: () => this.frozen.get(),
    onRemove: () => this.drop('grace'),
  });

  alan = createChip({
    chip: () => this.alanEl.get(),
    container: () => this.list.get(),
    fallbackFocus: () => this.field.get(),
    label: () => 'Alan',
    onRemove: () => this.drop('alan'),
  });
}

function mountTags() {
  const handle = track(mount(Tags, host));
  const instance = handle.instance as Tags;
  flushSync();

  const chip = (name: string) => host.querySelector(`.chip[data-name="${name}"]`) as HTMLElement;
  return {
    instance,
    chip,
    names: () => [...host.querySelectorAll('.chip')].map((el) => el.getAttribute('data-name')),
    field: () => host.querySelector('.field') as HTMLInputElement,
    press: (name: string, key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      chip(name).dispatchEvent(event);
      flushSync();
      return event;
    },
  };
}

describe('chip wiring', () => {
  it('makes the chip the tab stop and keeps the remove control out of it', () => {
    const { chip } = mountTags();

    // One stop per tag rather than two: ten tags should not cost twenty Tab
    // presses to step over.
    expect(chip('ada').getAttribute('tabindex')).toBe('0');
    expect(chip('ada').querySelector('.remove')!.getAttribute('tabindex')).toBe('-1');
  });

  it('names the remove control after the tag it removes', () => {
    const { chip } = mountTags();
    const remove = chip('grace').querySelector('.remove')!;

    // Three controls all announced as "Remove" is three identical buttons.
    expect(remove.getAttribute('aria-label')).toBe('Remove Grace');
    // A button with no type submits the form it is standing in.
    expect(remove.getAttribute('type')).toBe('button');
  });

  it('marks itself as a collection item and offers its text for typeahead', () => {
    const { chip } = mountTags();
    expect(chip('ada').hasAttribute('data-volt-item')).toBe(true);
    expect(chip('ada').getAttribute('data-label')).toBe('Ada');
  });

  it('falls back to a bare name when there is nothing to name it after', () => {
    const chip = inRoot(() => createChip({ chip: () => null }));
    expect(chip.removeProps()['aria-label']).toBe('Remove');
  });

  it('takes the remove control name from labels', () => {
    const chip = inRoot(() =>
      createChip({ chip: () => null, label: () => 'Ada', labels: { remove: (n) => `Drop ${n}` } }),
    );
    expect(chip.removeProps()['aria-label']).toBe('Drop Ada');
  });
});

describe('chip removal', () => {
  it('removes on Delete and moves focus to the next chip', () => {
    const { chip, press, names } = mountTags();
    chip('ada').focus();

    press('ada', 'Delete');
    expect(names()).toEqual(['grace', 'alan']);
    // Without this, focus is on a node that has just left the document and the
    // user is dropped at the top of the page.
    expect(document.activeElement).toBe(chip('grace'));
  });

  it('removes on Backspace too', () => {
    const { press, names } = mountTags();
    press('grace', 'Backspace');
    expect(names()).toEqual(['ada', 'alan']);
  });

  it('falls back to the previous chip when there is nothing after it', () => {
    const { chip, press } = mountTags();
    chip('alan').focus();

    press('alan', 'Delete');
    expect(document.activeElement).toBe(chip('grace'));
  });

  it('finds the neighbour in the DOM rather than in the order it was declared', () => {
    const { chip, press, instance } = mountTags();
    // Grace is gone, so Ada's neighbour is Alan even though Grace was declared
    // between them.
    instance.tags.set(['ada', 'alan']);
    flushSync();

    press('ada', 'Delete');
    expect(document.activeElement).toBe(chip('alan'));
  });

  it('goes to the fallback when the last chip is removed', () => {
    const { press, field, instance } = mountTags();
    instance.tags.set(['ada']);
    flushSync();

    press('ada', 'Delete');
    expect(document.activeElement).toBe(field());
  });

  it('makes the container hold focus when there is no fallback', () => {
    @Component({
      selector: 'v-lone',
      render: compileTemplate(`
        <div class="list" :ref="list">
          <span :if="alive.get()" class="chip" :ref="el"
                :spread="chip.chipProps()" :keydown="chip.onKeyDown($event)">Ada</span>
        </div>
      `),
    })
    class Lone {
      alive = new Signal.State(true);
      list = new Signal.State<Element | null>(null);
      el = new Signal.State<Element | null>(null);
      chip = createChip({
        chip: () => this.el.get(),
        container: () => this.list.get(),
        label: () => 'Ada',
        onRemove: () => this.alive.set(false),
      });
    }

    track(mount(Lone, host));
    flushSync();
    const chip = host.querySelector('.chip') as HTMLElement;
    chip.focus();
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    flushSync();

    const list = host.querySelector('.list') as HTMLElement;
    // Made focusable without entering the tab order, so focus has somewhere to
    // go that is not <body>.
    expect(list.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(list);
  });

  it('moves focus before it reports the removal', () => {
    const { chip, press, instance } = mountTags();
    chip('ada').focus();

    press('ada', 'Delete');
    // The documented order: focusout fires while the chip is still in the
    // document, and a consumer who wants focus elsewhere can override it from
    // inside onRemove.
    expect(instance.focusOnRemove).toEqual([chip('grace')]);
  });

  it('removes from the control as well as from the key', () => {
    const { chip, names } = mountTags();
    (chip('grace').querySelector('.remove') as HTMLElement).click();
    flushSync();
    expect(names()).toEqual(['ada', 'alan']);
  });
});

describe('chip keys it must not answer', () => {
  it('leaves Backspace to a field inside the chip', () => {
    const { names } = mountTags();
    const field = host.querySelector('.chip[data-name="alan"] .edit') as HTMLInputElement;

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    flushSync();
    // Deleting the tag out from under someone correcting its spelling is not
    // what the key meant.
    expect(names()).toEqual(['ada', 'grace', 'alan']);
  });

  it('ignores a modified Delete, which is somebody else’s shortcut', () => {
    const { press, names } = mountTags();
    const event = press('ada', 'Delete', { metaKey: true });
    expect(names()).toEqual(['ada', 'grace', 'alan']);
    expect(event.defaultPrevented).toBe(false);
  });

  it('consumes the key it acts on, and no others', () => {
    const { press, names } = mountTags();
    expect(press('ada', 'Delete').defaultPrevented).toBe(true);

    // Backspace is still "go back" in some configurations; one press should
    // remove one chip and do nothing else.
    expect(press('grace', 'Backspace').defaultPrevented).toBe(true);
    expect(press('alan', 'Enter').defaultPrevented).toBe(false);
    expect(names()).toEqual(['alan']);
  });

  it('refuses to remove a disabled chip but keeps it readable', () => {
    const { instance, chip, press, names } = mountTags();
    instance.frozen.set(true);
    flushSync();

    // aria-disabled, never the disabled attribute: it stays in the
    // accessibility tree to be heard as unavailable rather than vanish.
    expect(chip('grace').getAttribute('aria-disabled')).toBe('true');
    expect(chip('grace').hasAttribute('data-disabled')).toBe(true);
    expect(chip('grace').querySelector('.remove')!.getAttribute('aria-disabled')).toBe('true');

    press('grace', 'Delete');
    expect(names()).toEqual(['ada', 'grace', 'alan']);
  });

  it('does nothing at all when the chip is not removable', () => {
    const onRemove = vi.fn();
    const chip = inRoot(() =>
      createChip({ chip: () => null, removable: false, label: () => 'Ada', onRemove }),
    );

    chip.remove();
    expect(onRemove).not.toHaveBeenCalled();
    expect(chip.isRemovable()).toBe(false);
    expect(chip.removeProps()['data-disabled']).toBe('');
  });

  it('leaves the tab order alone when a group owns it', () => {
    const chip = inRoot(() => createChip({ chip: () => null, focusable: false }));
    expect(chip.chipProps().tabindex).toBeUndefined();
    // With no chip-level stop, the control has to be reachable itself.
    expect(chip.removeProps().tabindex).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function mountImage(options: Partial<ImageOptions> = {}) {
  @Component({
    selector: 'v-figure',
    render: compileTemplate(`
      <div class="box" :spread="picture.boxProps()">
        <img :ref="el" :spread="picture.imageProps()">
      </div>
    `),
  })
  class Figure {
    el = new Signal.State<Element | null>(null);
    src = new Signal.State<string | null>('/cover.jpg');
    picture = createImage({
      image: () => this.el.get(),
      src: () => this.src.get(),
      alt: () => 'The first edition, in green cloth',
      ...options,
    } as ImageOptions);
  }

  const handle = track(mount(Figure, host));
  const instance = handle.instance as Figure;
  flushSync();

  const img = () => host.querySelector('img') as HTMLImageElement;
  return {
    instance,
    picture: instance.picture,
    img,
    box: () => host.querySelector('.box') as HTMLElement,
    load: () => {
      img().dispatchEvent(new Event('load'));
      flushSync();
    },
    fail: () => {
      img().dispatchEvent(new Event('error'));
      flushSync();
    },
  };
}

describe('image alt', () => {
  it('describes a meaningful picture', () => {
    const { img } = mountImage();
    expect(img().getAttribute('alt')).toBe('The first edition, in green cloth');
    expect(img().hasAttribute('role')).toBe(false);
  });

  it('silences a decorative one twice over', () => {
    const { img } = mountImage({ decorative: true, alt: undefined });

    // An empty alt, so it is skipped; and role="presentation" beside it, so a
    // sanitiser that strips empty attributes cannot turn it back into a URL
    // being read aloud.
    expect(img().getAttribute('alt')).toBe('');
    expect(img().getAttribute('role')).toBe('presentation');
  });

  it('never leaves the attribute off entirely', () => {
    // Missing alt is announced by reading the URL, one path segment at a time,
    // so even an empty alt someone passed by accident is written out.
    const { img } = mountImage({ alt: () => null });
    expect(img().hasAttribute('alt')).toBe(true);
    expect(img().getAttribute('alt')).toBe('');
  });
});

describe('image loading', () => {
  it('is loading once there is a source and loaded when the element says so', () => {
    const { picture, load, img } = mountImage();
    expect(picture.status()).toBe('loading');
    expect(img().getAttribute('data-status')).toBe('loading');

    load();
    expect(picture.isLoaded()).toBe(true);
    expect(img().getAttribute('data-status')).toBe('loaded');
  });

  it('reports a failure rather than waiting forever', () => {
    const { picture, fail } = mountImage();
    fail();
    expect(picture.hasError()).toBe(true);
  });

  it('is idle with nothing to fetch, and asks for nothing', () => {
    const { picture, img } = mountImage({ src: () => null });
    expect(picture.status()).toBe('idle');
    // `src` is a real property: undefined would be stringified and fetched as
    // "/undefined".
    expect(img().hasAttribute('src')).toBe(false);
  });

  it('restarts when the source changes', () => {
    const { instance, picture, load } = mountImage();
    load();
    expect(picture.status()).toBe('loaded');

    instance.src.set('/other.jpg');
    flushSync();
    expect(picture.status()).toBe('loading');
  });

  it('counts an image that finished before anything was listening', () => {
    // A cache hit, or server-rendered markup: the load event fired while
    // nothing was watching and will never fire again.
    document.body.insertAdjacentHTML('beforeend', '<img id="ready" src="/cover.jpg">');
    const ready = document.querySelector('#ready') as HTMLImageElement;
    Object.defineProperty(ready, 'complete', { value: true, configurable: true });
    Object.defineProperty(ready, 'naturalWidth', { value: 800, configurable: true });

    const picture = inRoot(() =>
      createImage({
        image: () => ready,
        src: () => '/cover.jpg',
        alt: () => 'Cover',
      }),
    );
    flushSync();
    expect(picture.status()).toBe('loaded');
  });

  it('loads from srcset alone', () => {
    const { picture, img } = mountImage({
      src: () => null,
      srcset: () => '/cover-1x.jpg 1x, /cover-2x.jpg 2x',
      sizes: () => '50vw',
    });

    expect(picture.status()).toBe('loading');
    expect(img().hasAttribute('src')).toBe(false);
    expect(img().getAttribute('srcset')).toBe('/cover-1x.jpg 1x, /cover-2x.jpg 2x');
    expect(img().getAttribute('sizes')).toBe('50vw');
  });

  it('follows a status signal supplied from outside', () => {
    const status = new Signal.State<ImageStatus>('error');
    const { img } = mountImage({ status });
    // The effect claims 'loading' on mount; the point is that the signal is
    // the one place the state lives, so a write from outside is authoritative.
    status.set('error');
    flushSync();
    expect(img().getAttribute('data-status')).toBe('error');
  });

  it('reports every transition once', () => {
    const onStatusChange = vi.fn();
    const { load } = mountImage({ onStatusChange });
    load();
    expect(onStatusChange.mock.calls.map((call) => call[0])).toEqual(['loading', 'loaded']);
  });
});

describe('image layout', () => {
  it('reserves the space from the intrinsic size', () => {
    const { img, box, picture } = mountImage({ width: 1200, height: 800 });

    // A modern browser derives aspect-ratio from the attribute pair, which is
    // what stops the text below jumping when the image lands.
    expect(img().getAttribute('width')).toBe('1200');
    expect(img().getAttribute('height')).toBe('800');
    expect(picture.aspectRatio()).toBe('1200 / 800');
    expect(box().style.getPropertyValue('aspect-ratio')).toBe('1200 / 800');
  });

  it('takes an explicit ratio when the pixel size is not known', () => {
    const { box, picture } = mountImage({ aspectRatio: '16 / 9' });
    expect(picture.aspectRatio()).toBe('16 / 9');
    expect(box().style.getPropertyValue('aspect-ratio')).toBe('16 / 9');
  });

  it('holds no space open when it has no idea of the shape', () => {
    const { box, picture } = mountImage();
    expect(picture.aspectRatio()).toBeNull();
    expect(box().style.getPropertyValue('aspect-ratio')).toBe('');
  });

  it('ignores a size that cannot be a size', () => {
    const { img, picture } = mountImage({ width: 0, height: Number.NaN });
    expect(img().hasAttribute('width')).toBe(false);
    expect(picture.aspectRatio()).toBeNull();
  });
});

describe('image hints', () => {
  it('decodes off the main thread by default and does not lazy-load', () => {
    const { img } = mountImage();
    expect(img().getAttribute('decoding')).toBe('async');
    // Lazy is opt-in: the image most likely to be marked up carefully is the
    // one at the top of the page, and lazy-loading that one delays it.
    expect(img().hasAttribute('loading')).toBe(false);
  });

  it('passes the hints through when they are asked for', () => {
    const { img } = mountImage({ loading: 'lazy', decoding: 'sync', fetchPriority: 'high' });
    expect(img().getAttribute('loading')).toBe('lazy');
    expect(img().getAttribute('decoding')).toBe('sync');
    expect(img().getAttribute('fetchpriority')).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Keyboard key
// ---------------------------------------------------------------------------

function kbd(options: Partial<KbdOptions> = {}) {
  return inRoot(() => createKbd({ keys: () => ['Meta', 'K'], ...options }));
}

describe('keyboard key', () => {
  it('draws symbols and says words on an Apple platform', () => {
    const shortcut = kbd({ platform: 'apple' });
    expect(shortcut.text()).toBe('⌘K');
    // "⌘" read aloud is "place of interest sign", or more often silence.
    expect(shortcut.label()).toBe('Command K');
  });

  it('draws names and joins with a plus everywhere else', () => {
    const shortcut = kbd({ platform: 'other', keys: () => ['Control', 'K'] });
    expect(shortcut.text()).toBe('Ctrl+K');
    expect(shortcut.label()).toBe('Control K');
  });

  it('gives one key different symbols and different names per platform', () => {
    // Meta is ⌘ and "Command" on one, Win and "Windows" on the other — the
    // same physical key, and nothing about it transfers.
    expect(kbd({ platform: 'other' }).text()).toBe('Win+K');
    expect(kbd({ platform: 'other' }).label()).toBe('Windows K');
    expect(kbd({ platform: 'apple', keys: () => ['Alt', 'F'] }).label()).toBe('Option F');
    expect(kbd({ platform: 'other', keys: () => ['Alt', 'F'] }).label()).toBe('Alt F');
  });

  it('replaces its content in the accessibility tree', () => {
    const props = kbd({ platform: 'apple' }).kbdProps();
    expect(props.role).toBe('img');
    expect(props['aria-label']).toBe('Command K');
    expect(props['data-platform']).toBe('apple');
  });

  it('claims no semantics when there is no chord', () => {
    const props = kbd({ keys: () => null }).kbdProps();
    expect(props.role).toBeUndefined();
  });

  it('accepts the chord written as a string', () => {
    const shortcut = kbd({ platform: 'other', keys: () => 'Control+Shift+P' });
    expect(shortcut.keys()).toEqual(['Control', 'Shift', 'P']);
    expect(shortcut.label()).toBe('Control Shift P');
  });

  it('keeps the space key, which trims away to nothing', () => {
    const shortcut = kbd({ platform: 'apple', keys: () => ['Control', ' '] });
    expect(shortcut.text()).toBe('⌃␣');
    expect(shortcut.label()).toBe('Control Space');
  });

  it('names the keys nobody has a symbol for', () => {
    const shortcut = kbd({ platform: 'other', keys: () => ['ArrowUp'] });
    expect(shortcut.text()).toBe('↑');
    // An arrow glyph is another thing a screen reader will not read.
    expect(shortcut.label()).toBe('Up arrow');
  });

  it('passes an unknown key straight through', () => {
    const shortcut = kbd({ platform: 'other', keys: () => ['F13'] });
    expect(shortcut.text()).toBe('F13');
    expect(shortcut.label()).toBe('F13');
  });

  it('leaves a single character in the case it was given', () => {
    // Upper-casing is a text-transform, and here it would need a locale: a
    // Turkish "i" upper-cases to "İ".
    expect(kbd({ platform: 'other', keys: () => ['k'] }).text()).toBe('k');
  });

  it('overrides every visible and spoken string through labels', () => {
    const shortcut = kbd({
      platform: 'apple',
      labels: {
        symbols: { Meta: 'Cmd' },
        names: { Meta: 'Commande' },
        separator: '-',
        join: ' puis ',
      },
    });
    expect(shortcut.text()).toBe('Cmd-K');
    expect(shortcut.label()).toBe('Commande puis K');
  });

  it('breaks the chord into parts for markup that draws each key', () => {
    const shortcut = kbd({ platform: 'apple' });
    expect(shortcut.parts()).toEqual([
      { key: 'Meta', text: '⌘', label: 'Command' },
      { key: 'K', text: 'K', label: 'K' },
    ]);
    expect(shortcut.keyProps('Meta')).toEqual({ 'data-key': 'Meta' });
  });
});

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

/** A ResizeObserver whose callbacks a test can fire. */
class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];
  targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.live.push(this);
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  fire(): void {
    this.callback();
  }
}

function useFakeResizeObserver() {
  FakeResizeObserver.live = [];
  const real = window.ResizeObserver;
  Object.defineProperty(window, 'ResizeObserver', { value: FakeResizeObserver, configurable: true });
  disposers.push(() => {
    Object.defineProperty(window, 'ResizeObserver', { value: real, configurable: true });
  });
}

@Component({
  selector: 'v-sample',
  render: compileTemplate(`
    <pre class="pre" :ref="preEl" :spread="sample.preProps()"><code
      class="code" :spread="sample.codeProps()">const x = 1</code></pre>
  `),
})
class Sample {
  preEl = new Signal.State<Element | null>(null);
  /** Held back so a test can size the element before it is measured. */
  wired = new Signal.State(false);
  lang = new Signal.State<string | null>('TypeScript');
  sample = createCode({
    block: true,
    pre: () => (this.wired.get() ? this.preEl.get() : null),
    language: () => this.lang.get(),
  });
}

function mountSample() {
  const handle = track(mount(Sample, host));
  const instance = handle.instance as Sample;
  flushSync();
  return {
    handle,
    instance,
    pre: () => host.querySelector('.pre') as HTMLElement,
    code: () => host.querySelector('.code') as HTMLElement,
    /** Give the block a size and let the observer see it. */
    measure: (scrollWidth: number, clientWidth: number) => {
      const pre = host.querySelector('.pre') as HTMLElement;
      Object.defineProperty(pre, 'scrollWidth', { value: scrollWidth, configurable: true });
      Object.defineProperty(pre, 'clientWidth', { value: clientWidth, configurable: true });
      instance.wired.set(true);
      flushSync();
    },
  };
}

describe('code semantics', () => {
  it('claims the role, because it cannot see what element it landed on', () => {
    // A <span> needs it; a <code> is not harmed by being told what it is.
    const inline = inRoot(() => createCode({ language: () => 'bash' }));
    expect(inline.codeProps().role).toBe('code');
    expect(inline.codeProps()['data-language']).toBe('bash');
  });

  it('gives an inline run of code no block props at all', () => {
    const inline = inRoot(() => createCode());
    expect(inline.preProps()).toEqual({});
    expect(inline.codeProps()['data-language']).toBeUndefined();
  });
});

describe('code blocks that scroll', () => {
  beforeEach(useFakeResizeObserver);

  it('adds no tab stop when the code fits', () => {
    const { measure, pre } = mountSample();
    measure(200, 400);

    expect(pre().hasAttribute('tabindex')).toBe(false);
    expect(pre().hasAttribute('role')).toBe(false);
    expect(pre().getAttribute('data-language')).toBe('TypeScript');
  });

  it('becomes a focusable named region once it really overflows', () => {
    const { measure, pre } = mountSample();
    measure(900, 400);

    // A scroll container that cannot take focus cannot be scrolled by
    // keyboard at all.
    expect(pre().getAttribute('tabindex')).toBe('0');
    expect(pre().getAttribute('role')).toBe('region');
    // And a tab stop that announces nothing when it takes focus is its own
    // kind of dead end.
    expect(pre().getAttribute('aria-label')).toBe('TypeScript code');
  });

  it('watches the code inside as well as the box around it', () => {
    const { measure, pre, code } = mountSample();
    measure(200, 400);

    const observer = FakeResizeObserver.live.at(-1)!;
    // Highlighting rewrites the content after mount, and the <pre> can stay
    // exactly the same size while what is inside it grows.
    expect(observer.targets).toContain(pre());
    expect(observer.targets).toContain(code());
  });

  it('notices when the content grows later', () => {
    const { measure, pre } = mountSample();
    measure(200, 400);
    expect(pre().hasAttribute('tabindex')).toBe(false);

    Object.defineProperty(pre(), 'scrollWidth', { value: 900, configurable: true });
    FakeResizeObserver.live.at(-1)!.fire();
    flushSync();
    expect(pre().getAttribute('tabindex')).toBe('0');
  });

  it('names the block plainly when the language is unknown', () => {
    const { instance, measure, pre } = mountSample();
    instance.lang.set(null);
    measure(900, 400);
    expect(pre().getAttribute('aria-label')).toBe('Code');
  });

  it('takes the name from labels, and from label over both', () => {
    const named = inRoot(() =>
      createCode({ block: true, language: () => 'Rust', labels: { block: (l) => `${l} sample` } }),
    );
    // No pre to measure, so nothing is claimed to scroll.
    expect(named.preProps()['aria-label']).toBeUndefined();
    expect(named.isScrollable()).toBe(false);
  });

  it('stops observing when it goes away', () => {
    const { handle, measure } = mountSample();
    measure(900, 400);
    const observer = FakeResizeObserver.live.at(-1)!;

    handle.unmount();
    flushSync();
    expect(observer.disconnected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-16T12:00:00Z').getTime();

function mountTimes(dates: (string | number | Date | null)[], options: Partial<RelativeTimeOptions> = {}) {
  @Component({
    selector: 'v-stamp',
    render: compileTemplate(
      `<div><time class="stamp" :for="stamp in stamps" :key="stamp.key"` +
        ` :spread="stamp.time.timeProps()">{ stamp.time.text() }</time></div>`,
    ),
  })
  class Stamps {
    stamps = dates.map((date, index) => ({
      key: index,
      time: createRelativeTime({ date: () => date, ...options }),
    }));
  }

  const handle = track(mount(Stamps, host));
  flushSync();
  return {
    handle,
    instance: handle.instance as Stamps,
    texts: () => [...host.querySelectorAll('.stamp')].map((el) => el.textContent),
    stamps: () => [...host.querySelectorAll('.stamp')] as HTMLTimeElement[],
  };
}

function atNow() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe('relative time text', () => {
  beforeEach(atNow);

  it('says how long ago in the largest unit that still means something', () => {
    const { texts } = mountTimes([
      new Date(NOW - 30 * 1000),
      new Date(NOW - 3 * 60 * 1000),
      new Date(NOW - 5 * 60 * 60 * 1000),
    ]);
    expect(texts()).toEqual(['30 seconds ago', '3 minutes ago', '5 hours ago']);
  });

  it('counts midnights rather than hours once it is talking about days', () => {
    // 01:00 on Tuesday, looking back at 23:00 on Sunday. Twenty-six hours is
    // "yesterday" by the clock and "two days ago" by the calendar, and the
    // calendar is the one a reader means.
    vi.setSystemTime(new Date(2026, 7, 18, 1, 0, 0));
    const { texts } = mountTimes([new Date(2026, 7, 16, 23, 0, 0)]);
    expect(texts()).toEqual(['2 days ago']);
  });

  it('uses the word for it when there is one', () => {
    vi.setSystemTime(new Date(2026, 7, 18, 9, 0, 0));
    const { texts } = mountTimes([new Date(2026, 7, 17, 8, 0, 0)]);
    expect(texts()).toEqual(['yesterday']);
  });

  it('prefers hours to "yesterday" while hours are still the better answer', () => {
    // Thirteen hours ago, over a midnight. "Yesterday" is true and useless.
    vi.setSystemTime(new Date(2026, 7, 18, 9, 0, 0));
    const { texts } = mountTimes([new Date(2026, 7, 17, 20, 0, 0)]);
    expect(texts()).toEqual(['13 hours ago']);
  });

  it('does not call nine days a month', () => {
    // The month has changed, but the day of the month has not come round.
    vi.setSystemTime(new Date(2026, 1, 3, 9, 0, 0));
    const { texts } = mountTimes([new Date(2026, 0, 25, 9, 0, 0)], { numeric: 'always' });
    expect(texts()).toEqual(['1 week ago']);
  });

  it('reaches months and years when the calendar really has moved', () => {
    vi.setSystemTime(new Date(2026, 7, 16, 9, 0, 0));
    const { texts } = mountTimes(
      [new Date(2026, 4, 16, 9, 0, 0), new Date(2023, 7, 16, 9, 0, 0)],
      { numeric: 'always' },
    );
    expect(texts()).toEqual(['3 months ago', '3 years ago']);
  });

  it('looks forward as readily as back', () => {
    const { texts } = mountTimes([new Date(NOW + 10 * 60 * 1000)]);
    expect(texts()).toEqual(['in 10 minutes']);
  });

  it('hands both strings over to labels', () => {
    const { texts, stamps } = mountTimes([new Date(NOW - 2 * 60 * 1000)], {
      labels: {
        relative: (value, unit) => `${Math.abs(value)} ${unit} back`,
        absolute: () => 'noon, more or less',
      },
    });
    expect(texts()).toEqual(['2 minute back']);
    expect(stamps()[0]!.getAttribute('title')).toBe('noon, more or less');
  });
});

describe('relative time markup', () => {
  beforeEach(atNow);

  it('carries the machine-readable moment and the exact one', () => {
    const { stamps } = mountTimes([new Date(NOW - 3 * 60 * 1000)], {
      locale: 'en-GB',
      absoluteOptions: { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' },
    });
    const stamp = stamps()[0]!;

    expect(stamp.getAttribute('datetime')).toBe('2026-08-16T11:57:00.000Z');
    // Nothing about the exact moment is lost by showing an approximation.
    expect(stamp.getAttribute('title')).toBe('16/08/2026, 11:57');
    expect(stamp.getAttribute('data-unit')).toBe('minute');
  });

  it('claims nothing at all for a date it could not parse', () => {
    const { texts, stamps } = mountTimes(['not a date']);
    // A <time> with a broken datetime is worse than a plain span: it promises
    // a machine-readable moment and gives a wrong one.
    expect(texts()).toEqual(['']);
    expect(stamps()[0]!.hasAttribute('datetime')).toBe(false);
    expect(stamps()[0]!.hasAttribute('title')).toBe(false);
  });

  it('is not a live region', () => {
    const { stamps } = mountTimes([new Date(NOW - 60 * 1000)]);
    // A page of timestamps announcing themselves in turn is unusable.
    expect(stamps()[0]!.hasAttribute('aria-live')).toBe(false);
  });
});

describe('the shared ticker', () => {
  beforeEach(atNow);

  it('runs one timer for every instance on the page', () => {
    const before = vi.getTimerCount();
    mountTimes([new Date(NOW - 10_000), new Date(NOW - 20_000), new Date(NOW - 30_000)]);

    expect(relativeTimeTickerSize()).toBe(3);
    // Three hundred timestamps would otherwise mean three hundred timers, all
    // firing at slightly different moments and none of them coordinated.
    expect(vi.getTimerCount()).toBe(before + 1);
  });

  it('keeps every instance in step', () => {
    const { texts } = mountTimes([new Date(NOW - 10_000), new Date(NOW - 40_000)]);
    expect(texts()).toEqual(['10 seconds ago', '40 seconds ago']);

    // One timer moving the clock, so both texts move by the same five seconds.
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(texts()).toEqual(['15 seconds ago', '45 seconds ago']);
  });

  it('stops entirely once the last instance has gone', () => {
    const before = vi.getTimerCount();
    const { handle } = mountTimes([new Date(NOW - 10_000)]);
    expect(vi.getTimerCount()).toBe(before + 1);

    handle.unmount();
    flushSync();
    expect(relativeTimeTickerSize()).toBe(0);
    expect(vi.getTimerCount()).toBe(before);
  });

  it('wakes as often as the fastest instance needs and no faster', () => {
    const relative = vi.fn((value: number, unit: string) => `${value} ${unit}`);
    // Days old, so it asks for the slowest period going.
    mountTimes([new Date(NOW - 3 * 24 * 60 * 60 * 1000)], { labels: { relative } });
    const rendered = relative.mock.calls.length;

    vi.advanceTimersByTime(60_000);
    flushSync();
    // A minute is nothing to a timestamp measured in days; re-rendering it
    // would be work with no output.
    expect(relative).toHaveBeenCalledTimes(rendered);

    vi.advanceTimersByTime(4 * 60_000);
    flushSync();
    expect(relative.mock.calls.length).toBeGreaterThan(rendered);
  });

  it('does not tick in a tab nobody is looking at', () => {
    mountTimes([new Date(NOW - 10_000)]);
    const running = vi.getTimerCount();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(running - 1);

    // Coming back sets the clock before anything is painted, so no time is
    // lost by having stopped.
    Reflect.deleteProperty(document, 'visibilityState');
    vi.setSystemTime(NOW + 3 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    flushSync();
    expect(host.querySelector('.stamp')!.textContent).toBe('3 minutes ago');
    expect(vi.getTimerCount()).toBe(running);
  });

  it('leaves the ticker alone when the clock comes from outside', () => {
    const now = new Signal.State(NOW);
    const before = vi.getTimerCount();
    const { texts } = mountTimes([new Date(NOW - 60_000)], { now });

    expect(relativeTimeTickerSize()).toBe(0);
    expect(vi.getTimerCount()).toBe(before);

    now.set(NOW + 4 * 60_000);
    flushSync();
    expect(texts()).toEqual(['5 minutes ago']);
  });

  it('is still correct when it is not live, it just never says so again', () => {
    const before = vi.getTimerCount();
    const { texts } = mountTimes([new Date(NOW - 60_000)], { live: false });

    expect(relativeTimeTickerSize()).toBe(0);
    expect(vi.getTimerCount()).toBe(before);
    expect(texts()).toEqual(['1 minute ago']);
  });

  it('catches up when an instance mounts long after the last one left', () => {
    const first = mountTimes([new Date(NOW - 10_000)]);
    first.handle.unmount();
    flushSync();

    vi.setSystemTime(NOW + 60 * 60_000);
    const second = mountTimes([new Date(NOW + 60 * 60_000 - 30_000)]);
    // The shared clock stopped an hour ago; a new instance must not read it.
    expect(second.texts()).toEqual(['30 seconds ago']);
  });
});
