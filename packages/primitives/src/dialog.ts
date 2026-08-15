/**
 * Dialog — a modal or non-modal layer, with the accessibility wired in.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders,
 * and nothing here has an opinion about styling.
 *
 *   class Confirm {
 *     trigger = new Signal.State<Element | null>(null);
 *     content = new Signal.State<Element | null>(null);
 *     dialog = createDialog({
 *       trigger: () => this.trigger.get(),
 *       content: () => this.content.get(),
 *     });
 *   }
 *
 *   <button :ref="trigger" :spread="dialog.triggerProps()">Delete</button>
 *   <div :if="dialog.isPresent()" :portal
 *        :ref="content" :spread="dialog.contentProps()">
 *     <h2 :spread="dialog.titleProps()">Are you sure?</h2>
 *     <p  :spread="dialog.descriptionProps()">This cannot be undone.</p>
 *     <button :click="dialog.close()">Cancel</button>
 *   </div>
 *
 * `aria-labelledby` and `aria-describedby` are only emitted when a title and
 * description actually exist, because pointing at a missing id is worse than
 * pointing at nothing: a screen reader announces an unlabelled dialog either
 * way, but a dangling reference hides the fact that the label is missing.
 */

import { Signal, effect, onCleanup } from '@voltjs/core';
import { createPresence, type PresenceState } from './presence.js';
import { createDismiss, type DismissReason } from './dismiss.js';
import { createFocusScope } from './focus-scope.js';
import { createId } from './id.js';

export interface DialogOptions {
  /** The dialog's content element, once rendered. */
  content: () => Element | null | undefined;
  /** The element that opens it, so a press on it is not treated as outside. */
  trigger?: () => Element | null | undefined;

  /**
   * Supply a signal to control the dialog from outside. Without one it owns
   * its own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Modal dialogs trap focus, mark the rest of the page inert to assistive
   * technology, and lock scrolling. Default true.
   */
  modal?: boolean;

  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;
  /** A press outside closes it. Default true. */
  closeOnOutsidePointer?: boolean;

  onOpenChange?: (open: boolean) => void;
}

export interface DialogProps {
  readonly [key: string]: string | boolean | undefined;
}

export interface Dialog {
  /** Whether the dialog is logically open. */
  isOpen(): boolean;
  /** Whether its content should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;

  open(): void;
  close(): void;
  toggle(): void;

  triggerProps(): DialogProps;
  contentProps(): DialogProps;
  titleProps(): DialogProps;
  descriptionProps(): DialogProps;
}

export function createDialog(options: DialogOptions): Dialog {
  const state = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const modal = options.modal !== false;

  const contentId = createId('dialog-content');
  const titleId = createId('dialog-title');
  const descriptionId = createId('dialog-description');

  // Whether a title or description was actually rendered. Read from the DOM
  // rather than declared, so the consumer cannot forget to say so and get a
  // dangling `aria-labelledby` for their trouble.
  const hasTitle = new Signal.State(false);
  const hasDescription = new Signal.State(false);

  const presence = createPresence(
    () => state.get(),
    () => options.content(),
  );

  const setOpen = (next: boolean) => {
    if (state.get() === next) return;
    state.set(next);
    options.onOpenChange?.(next);
  };

  // Everything that only applies while open lives in one effect, so it is set
  // up and torn down as a unit — and, because these register cleanups, in
  // exactly the reverse order on the way out.
  effect(() => {
    if (!state.get()) return;
    const content = options.content();
    if (!content) return;

    // These ids are generated here, in a known-safe form, so they need no
    // escaping — and escaping them would pull in `CSS`, a browser global that
    // does not exist when rendering on a server.
    hasTitle.set(Boolean(content.querySelector(`#${titleId}`)));
    hasDescription.set(Boolean(content.querySelector(`#${descriptionId}`)));

    createDismiss(
      () => options.content(),
      (reason: DismissReason) => {
        if (reason === 'escape' && options.closeOnEscape === false) return;
        if (reason === 'outside-pointer' && options.closeOnOutsidePointer === false) return;
        setOpen(false);
      },
      {
        escape: options.closeOnEscape !== false,
        outsidePointer: options.closeOnOutsidePointer !== false,
        // The trigger is not "outside": dismissing on it would close the
        // dialog and then the trigger's own handler would reopen it.
        exclude: () => (options.trigger ? [options.trigger()] : []),
      },
    );

    if (modal) {
      createFocusScope(() => options.content(), { restoreFocus: true });
      lockScroll();
      hideFromScreenReaders(content);
    }
  });

  return {
    isOpen: () => state.get(),
    isPresent: () => presence.isPresent(),
    state: () => presence.state(),

    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!state.get()),

    triggerProps: () => ({
      'aria-haspopup': 'dialog',
      'aria-expanded': String(state.get()),
      'aria-controls': state.get() ? contentId : undefined,
    }),

    contentProps: () => ({
      id: contentId,
      role: 'dialog',
      'aria-modal': modal ? 'true' : undefined,
      'aria-labelledby': hasTitle.get() ? titleId : undefined,
      'aria-describedby': hasDescription.get() ? descriptionId : undefined,
      'data-state': presence.state(),
      tabindex: '-1',
    }),

    titleProps: () => ({ id: titleId }),
    descriptionProps: () => ({ id: descriptionId }),
  };
}

/**
 * Stop the page behind scrolling, and compensate for the scrollbar.
 *
 * Without the padding the page visibly jumps sideways as the scrollbar
 * disappears. Nesting is counted, so two stacked dialogs do not release the
 * lock when only the inner one closes.
 */
let scrollLocks = 0;
let restoreScroll: (() => void) | null = null;

function lockScroll(): void {
  scrollLocks += 1;

  if (scrollLocks === 1 && typeof document !== 'undefined') {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    restoreScroll = () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }

  onCleanup(() => {
    scrollLocks -= 1;
    if (scrollLocks === 0) {
      restoreScroll?.();
      restoreScroll = null;
    }
  });
}

/**
 * Mark everything except the dialog inert to assistive technology.
 *
 * A focus trap stops Tab leaving, but a screen reader's own cursor is not
 * bound by focus — without this, the page behind can still be read straight
 * through a "modal" dialog.
 */
function hideFromScreenReaders(content: Element): void {
  if (typeof document === 'undefined') return;

  const changed: { el: Element; previous: string | null }[] = [];

  for (const el of document.body.children) {
    if (el === content || el.contains(content)) continue;
    if (el.hasAttribute('aria-live')) continue;
    changed.push({ el, previous: el.getAttribute('aria-hidden') });
    el.setAttribute('aria-hidden', 'true');
  }

  onCleanup(() => {
    for (const { el, previous } of changed) {
      if (previous === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', previous);
    }
  });
}
