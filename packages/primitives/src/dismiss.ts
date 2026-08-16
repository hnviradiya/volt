/**
 * Dismissal — closing a layer on Escape or a pointer outside it.
 *
 * Every dismissable layer needs the same three rules, and the details are
 * where libraries get this wrong:
 *
 *   - **Only the topmost layer responds to Escape.** With a dialog open over a
 *     popover, one keypress must close one layer, not both. That needs a
 *     shared stack, which is why this is a module-level registry rather than
 *     per-component state.
 *   - **Outside is measured on pointer *down*, acted on at pointer *up*.**
 *     Using click alone closes a layer when a drag that began inside it
 *     happens to release outside — selecting text in a dialog and releasing
 *     past its edge should not dismiss it.
 *   - **Nested layers are inside their parent.** A popover opened from a
 *     dialog is not "outside" the dialog, even though it is not a DOM
 *     descendant once portalled, so containment is asked of the whole stack
 *     above a layer rather than of its element alone.
 */

import { onCleanup } from '@volt/core';

export interface DismissOptions {
  /** Elements that count as inside, beyond the layer itself — e.g. a trigger. */
  exclude?: () => (Element | null | undefined)[];
  /** Escape closes this layer. Default true. */
  escape?: boolean;
  /** A pointer press outside closes this layer. Default true. */
  outsidePointer?: boolean;
}

interface Layer {
  node: () => Element | null | undefined;
  onDismiss: (reason: DismissReason) => void;
  options: DismissOptions;
}

export type DismissReason = 'escape' | 'outside-pointer';

/** Open layers, oldest first. The last entry is the topmost. */
const stack: Layer[] = [];
let listening = false;

/**
 * Close `onDismiss` when this layer should go away.
 *
 * Registers for as long as the calling scope lives, so a layer rendered under
 * `:if` is on the stack exactly while it is on screen.
 */
export function createDismiss(
  node: () => Element | null | undefined,
  onDismiss: (reason: DismissReason) => void,
  options: DismissOptions = {},
): void {
  const layer: Layer = { node, onDismiss, options };
  stack.push(layer);
  attach();

  onCleanup(() => {
    const index = stack.indexOf(layer);
    if (index !== -1) stack.splice(index, 1);
    detachIfIdle();
  });
}

function attach(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // Capture, so a layer still dismisses when something inside the page stops
  // propagation on the way up.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
}

function detachIfIdle(): void {
  if (!listening || stack.length > 0) return;
  listening = false;
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('pointerup', onPointerUp, true);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top || top.options.escape === false) return;
  top.onDismiss('escape');
}

/**
 * Where the current press started.
 *
 * Held between down and up so a drag that began inside a layer cannot dismiss
 * it by releasing outside.
 */
let pressedInside: boolean | null = null;

function onPointerDown(event: PointerEvent): void {
  const top = stack[stack.length - 1];
  if (!top || top.options.outsidePointer === false) {
    pressedInside = null;
    return;
  }
  pressedInside = isInsideStack(event.target, stack.indexOf(top));
}

function onPointerUp(event: PointerEvent): void {
  const startedInside = pressedInside;
  pressedInside = null;
  if (startedInside !== false) return;

  const top = stack[stack.length - 1];
  if (!top || top.options.outsidePointer === false) return;
  // Both ends of the press have to be outside before this counts.
  if (isInsideStack(event.target, stack.indexOf(top))) return;

  top.onDismiss('outside-pointer');
}

/**
 * Whether `target` lies within the layer at `index` or anything stacked above
 * it, or within that layer's declared exclusions.
 */
function isInsideStack(target: EventTarget | null, index: number): boolean {
  if (!(target instanceof Node)) return false;

  for (let i = index; i < stack.length; i++) {
    const layer = stack[i]!;
    const el = layer.node();
    if (el?.contains(target)) return true;

    for (const extra of layer.options.exclude?.() ?? []) {
      if (extra?.contains(target)) return true;
    }
  }
  return false;
}

/** Test seam: the number of layers currently registered. */
export function dismissStackSize(): number {
  return stack.length;
}
