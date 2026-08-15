/**
 * Focus scope — trapping focus inside a layer and restoring it afterwards.
 *
 * A modal that does not trap focus is not modal for keyboard users: Tab walks
 * straight out into the page behind it, which is still there and still
 * interactive. Restoring focus on close matters just as much — losing focus to
 * `<body>` drops a keyboard user back at the top of the document with no way
 * back to where they were.
 *
 * Focus is trapped by watching `focusin` rather than by intercepting Tab.
 * Intercepting the key means reimplementing tab order, which browsers already
 * compute and which no reimplementation gets right for shadow roots, iframes,
 * or `tabindex` ordering. Watching where focus lands catches every route in —
 * keyboard, mouse, programmatic, and the browser's own address-bar cycle.
 */

import { onCleanup } from '@voltjs/core';

/**
 * Elements that can hold focus. `:not([hidden])` and the disabled checks
 * remove the common cases cheaply; visibility is checked separately, since it
 * needs layout.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

export interface FocusScopeOptions {
  /** Move focus into the layer on mount. Default true. */
  autoFocus?: boolean;
  /** Restore focus to whatever had it before. Default true. */
  restoreFocus?: boolean;
  /** What to focus first, instead of the first focusable element. */
  initialFocus?: () => Element | null | undefined;
}

export function createFocusScope(
  node: () => Element | null | undefined,
  options: FocusScopeOptions = {},
): void {
  if (typeof document === 'undefined') return;

  const previouslyFocused = document.activeElement as HTMLElement | null;

  // Registered before the trap, and cleanups run newest-first, so this runs
  // *after* the trap has been removed. The other order restores focus while
  // the trap is still live, which immediately drags it back inside.
  onCleanup(() => {
    if (options.restoreFocus === false) return;
    // Only restore if the element is still in the document and can take focus;
    // otherwise leaving focus where the browser put it is the lesser evil.
    if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  });

  const container = node();
  if (container) {
    if (options.autoFocus !== false) focusFirst(container, options.initialFocus?.());

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || container.contains(target)) return;
      // Focus escaped — pull it back to the first thing inside.
      focusFirst(container, options.initialFocus?.());
    };
    document.addEventListener('focusin', onFocusIn, true);
    onCleanup(() => document.removeEventListener('focusin', onFocusIn, true));
  }
}

/** Focusable descendants in tab order, minus anything not actually visible. */
export function focusableWithin(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible);
}

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return true;
  const styles = view.getComputedStyle(el);
  return styles.display !== 'none' && styles.visibility !== 'hidden';
}

function focusFirst(container: Element, preferred: Element | null | undefined): void {
  const target =
    (preferred as HTMLElement | null) ?? focusableWithin(container)[0] ?? (container as HTMLElement);

  // A container with nothing focusable inside still has to hold focus, or it
  // escapes to the page behind. `tabindex="-1"` makes that possible without
  // putting the container into the tab order.
  if (target === container && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  (target as HTMLElement).focus?.();
}
