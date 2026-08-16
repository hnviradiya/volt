/**
 * @voltjs/primitives
 *
 * Component behaviour and accessibility, with no styling of any kind.
 *
 * Around fifty components are assembled from a handful of shared behaviours —
 * presence, dismissal, focus scope, roving focus, collection, anchoring, form
 * field, virtualization. Those live here, and the components are largely
 * composition on top of them. Everything is built to the WAI-ARIA Authoring
 * Practices, including the full keyboard interaction map rather than roles
 * alone, because that is the part which cannot be retrofitted.
 */

export { createPresence, type Presence, type PresenceState } from './presence.js';
export {
  createDismiss,
  dismissStackSize,
  type DismissOptions,
  type DismissReason,
} from './dismiss.js';
export {
  createFocusScope,
  focusableWithin,
  type FocusScopeOptions,
} from './focus-scope.js';
export { createId, resetIdCounter } from './id.js';
export {
  createCollection,
  ITEM_ATTRIBUTE,
  type Collection,
  type CollectionOptions,
} from './collection.js';
export {
  createRovingFocus,
  type Orientation,
  type RovingFocus,
  type RovingFocusOptions,
} from './roving-focus.js';
export {
  createDialog,
  type Dialog,
  type DialogOptions,
  type DialogProps,
} from './dialog.js';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export * from './popover.js';
export * from './tooltip.js';
export * from './menu.js';
export * from './tabs.js';
export * from './disclosure.js';
export * from './toggle.js';
export * from './form-controls.js';
export * from './toast.js';
export * from './display.js';
export * from './async.js';
