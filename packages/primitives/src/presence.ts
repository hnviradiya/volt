/**
 * Presence — keeping content mounted until its exit animation has finished.
 *
 * Every overlay needs this. Removing a node the instant it closes means no
 * exit animation can ever play, but removing it on a timer means guessing a
 * duration that CSS already knows.
 *
 * This needs no support from the framework. Volt removes nodes when `:if`
 * turns false, so presence simply keeps that condition true a little longer:
 * on close it flips a `data-state` attribute, asks the element whether
 * anything is actually animating, and only then lets the node go. If nothing
 * is animating — no animation declared, or reduced motion turning it off —
 * the node is released synchronously, so a library that never animates pays
 * nothing and needs no configuration.
 *
 *   class Dialog {
 *     open = new Signal.State(false);
 *     content = new Signal.State<Element | null>(null);
 *     presence = createPresence(
 *       () => this.open.get(),
 *       () => this.content.get(),
 *     );
 *   }
 *
 *   <div :if="presence.isPresent()"
 *        :ref="content"
 *        :attr-data-state="presence.state()">…</div>
 *
 * and in CSS:
 *
 *   [data-state='open']   { animation: fade-in  150ms; }
 *   [data-state='closed'] { animation: fade-out 150ms; }
 */

import { Signal, effect, onCleanup } from '@volt/core';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

export type PresenceState = 'open' | 'closed';

export interface Presence {
  /** Whether the content should be in the DOM right now. */
  isPresent(): boolean;
  /** Write to `data-state` so CSS can drive the animation. */
  state(): PresenceState;
}

/** Events that can end an exit animation, including the ones that cancel it. */
const END_EVENTS = ['animationend', 'animationcancel', 'transitionend', 'transitioncancel'];

export function createPresence(
  open: () => boolean,
  node: () => Element | null | undefined,
): Presence {
  const initial = untrack(open);
  const present = new Signal.State(initial);
  const state = new Signal.State<PresenceState>(initial ? 'open' : 'closed');

  let stopWaiting: (() => void) | null = null;

  const release = () => {
    stopWaiting?.();
    stopWaiting = null;
    present.set(false);
  };

  effect(() => {
    const isOpen = open();

    if (isOpen) {
      // Re-opening mid-exit has to cancel the wait, or the pending release
      // would tear down content that is on its way back in.
      stopWaiting?.();
      stopWaiting = null;
      present.set(true);
      state.set('open');
      return;
    }

    if (!untrack(() => present.get())) return;

    state.set('closed');

    // Read the element after the state attribute has been written. Volt
    // flushes render effects before user effects, so by here the DOM already
    // carries `data-state="closed"` and computed style reflects the exit rule.
    const el = untrack(node);
    if (!el || !isAnimating(el)) {
      release();
      return;
    }

    const onEnd = (event: Event) => {
      // A descendant's animation must not end the parent's presence.
      if (event.target === el) release();
    };
    for (const type of END_EVENTS) el.addEventListener(type, onEnd);
    stopWaiting = () => {
      for (const type of END_EVENTS) el.removeEventListener(type, onEnd);
    };
  });

  onCleanup(() => stopWaiting?.());

  return {
    isPresent: () => present.get(),
    state: () => state.get(),
  };
}

/**
 * Whether an exit animation or transition will actually run.
 *
 * Asking the element rather than being told a duration is what lets CSS stay
 * the single source of truth — including when a `prefers-reduced-motion` rule
 * has turned the animation off, which shows up here as no animation at all.
 */
function isAnimating(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return false;

  const styles = view.getComputedStyle(el);

  const animated =
    styles.animationName !== '' &&
    styles.animationName !== 'none' &&
    hasDuration(styles.animationDuration);

  const transitioned =
    hasDuration(styles.transitionDuration) &&
    styles.transitionProperty !== '' &&
    styles.transitionProperty !== 'none';

  return animated || transitioned;
}

/** True when any comma-separated duration in the list is non-zero. */
function hasDuration(value: string): boolean {
  if (!value) return false;
  return value.split(',').some((part) => {
    const seconds = Number.parseFloat(part);
    return Number.isFinite(seconds) && seconds > 0;
  });
}
