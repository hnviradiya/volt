/**
 * @voltjs/core
 *
 * Volt is a TypeScript UI framework built from three ideas that fit together:
 *
 *   - components are classes, declared with standard TC39 decorators
 *   - templates are HTML where everything dynamic starts with `:`
 *   - reactivity is the TC39 Signals proposal, with no virtual DOM anywhere
 *
 * A component class is constructed once. Its template compiles to code that
 * clones static markup and wires one effect per dynamic binding, so an update
 * touches exactly the nodes whose inputs changed — never a re-render.
 */

export {
  Component,
  Prop,
  mount,
  getComponentConfig,
  isComponent,
  createComponent,
  slot,
} from './component.js';

export type {
  ComponentConfig,
  ComponentType,
  PropOptions,
  MountHandle,
  OnMount,
  RenderFn,
  SlotMap,
} from './component.js';

// The reactive core is re-exported so an app needs a single import.
export {
  Signal,
  batch,
  effect,
  renderEffect,
  flushSync,
  tick,
  createRoot,
  onCleanup,
  createContext,
  useContext,
  provideContext,
  isSignal,
  isWritableSignal,
} from '@voltjs/reactivity';

export type {
  Context,
  Dispose,
  CleanupFn,
  EffectFn,
  ReadableSignal,
  Scope,
  SignalOptions,
} from '@voltjs/reactivity';
