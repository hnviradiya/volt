/**
 * Volt's component layer: Angular-shaped classes, TC39 standard decorators,
 * and no dependency injection.
 *
 *   @Component({
 *     selector: 'v-counter',
 *     template: `
 *       <button :click="increment()">{{ count.get() }}</button>
 *     `,
 *   })
 *   export class Counter {
 *     @Input() start = new Signal.State(0);
 *     @Output() changed = new EventEmitter<number>();
 *
 *     count = new Signal.State(0);
 *
 *     increment() {
 *       this.count.set(this.count.get() + 1);
 *       this.changed.emit(this.count.get());
 *     }
 *   }
 *
 * A component class is instantiated exactly once per mounted instance. Its
 * methods are never re-run to produce a view — the template's bindings own
 * their own nodes and update independently.
 */

import {
  Signal,
  createRoot,
  getScope,
  isWritableSignal,
  onCleanup,
  renderEffect,
  runWithScope,
  type Dispose,
  type Scope,
} from '@voltjs/reactivity';

import { insert } from './dom.js';

// `Symbol.metadata` is stage-3 and missing from current engines. Without it
// the decorator transform quietly skips attaching metadata to the class, so it
// must exist before any decorated class is evaluated.
(Symbol as { metadata?: symbol }).metadata ??= Symbol('Symbol.metadata');

const INPUTS = Symbol.for('volt.inputs');
const OUTPUTS = Symbol.for('volt.outputs');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenderFn = (ctx: unknown) => unknown;

export interface ComponentType<T = unknown> {
  new (): T;
  readonly name: string;
}

export interface ComponentConfig {
  /** Tag this component answers to in a template, e.g. `v-counter`. */
  selector: string;
  /** Template source, compiled on first use unless `render` is supplied. */
  template?: string;
  /** A pre-compiled render function. The Vite plugin fills this in. */
  render?: RenderFn;
  /** Component-scoped CSS, injected once per component. */
  styles?: string | string[];
  /** Components this template is allowed to reference. */
  imports?: ComponentType<unknown>[];
}

export interface InputOptions {
  /** Template-facing name, when it differs from the property name. */
  alias?: string;
  required?: boolean;
}

interface InputDef {
  property: string;
  alias: string;
  required: boolean;
}

interface OutputDef {
  property: string;
  alias: string;
}

interface ResolvedConfig {
  config: ComponentConfig;
  inputsByAlias: Map<string, InputDef>;
  outputsByAlias: Map<string, OutputDef>;
  stylesInjected: boolean;
}

export interface OnInit {
  /** Runs after inputs are applied, before the template is built. */
  onInit(): void;
}

export interface OnMount {
  /** Runs once the component's DOM is in the document. */
  onMount(): void;
}

export interface OnDestroy {
  /** Runs when the component is torn down. */
  onDestroy(): void;
}

interface LifecycleHooks {
  onInit?: () => void;
  onMount?: () => void;
  onDestroy?: () => void;
}

export type SlotMap = Record<string, (props?: Record<string, unknown>) => unknown>;

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

const CONFIGS = new WeakMap<ComponentType<unknown>, ResolvedConfig>();
const RENDERERS = new WeakMap<ComponentType<unknown>, RenderFn>();
const SLOTS = new WeakMap<object, SlotMap | null>();
const GLOBAL_COMPONENTS = new Map<string, ComponentType<unknown>>();

/**
 * Compiling a template needs the compiler, which most production apps should
 * not ship. `@voltjs/core/jit` registers it; the Vite plugin makes it
 * unnecessary by emitting `render` at build time.
 */
let templateCompiler: ((template: string, filename: string) => RenderFn) | null = null;

export function setTemplateCompiler(
  compile: (template: string, filename: string) => RenderFn,
): void {
  templateCompiler = compile;
}

/** Register a component so any template can use it without importing it. */
export function registerComponent(component: ComponentType<unknown>): void {
  const resolved = CONFIGS.get(component);
  if (!resolved) {
    throw new Error(`[volt] ${component.name} is not a @Component.`);
  }
  GLOBAL_COMPONENTS.set(resolved.config.selector, component);
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

type MetadataRecord = Record<symbol, unknown>;

/**
 * Append to a metadata list, giving the subclass its own copy first.
 *
 * Decorator metadata inherits through the prototype chain, so appending
 * directly would push a subclass's members into the base class's array and
 * corrupt it for every other subclass.
 */
function appendMetadata<T>(metadata: MetadataRecord, key: symbol, value: T): void {
  if (!Object.hasOwn(metadata, key)) {
    const inherited = metadata[key] as T[] | undefined;
    metadata[key] = inherited ? [...inherited] : [];
  }
  (metadata[key] as T[]).push(value);
}

function readMetadata<T>(metadata: MetadataRecord | undefined, key: symbol): T[] {
  return (metadata?.[key] as T[] | undefined) ?? [];
}

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

/**
 * Mark a class as a component.
 *
 * Runs after every member decorator, so the metadata it reads is complete.
 */
export function Component(config: ComponentConfig) {
  return function decorateComponent<T extends ComponentType<unknown>>(
    target: T,
    context: ClassDecoratorContext,
  ): T {
    if (context.kind !== 'class') {
      throw new Error('[volt] @Component can only be applied to a class.');
    }
    if (!config.selector) {
      throw new Error(`[volt] @Component on ${String(context.name)} needs a selector.`);
    }

    const metadata = context.metadata as MetadataRecord | undefined;

    const inputsByAlias = new Map<string, InputDef>();
    for (const def of readMetadata<InputDef>(metadata, INPUTS)) {
      inputsByAlias.set(def.alias, def);
    }

    const outputsByAlias = new Map<string, OutputDef>();
    for (const def of readMetadata<OutputDef>(metadata, OUTPUTS)) {
      outputsByAlias.set(def.alias, def);
    }

    CONFIGS.set(target, { config, inputsByAlias, outputsByAlias, stylesInjected: false });
    return target;
  };
}

/**
 * Declare a property the parent template can bind to.
 *
 * Three shapes are supported, and which one you pick decides reactivity:
 *
 *   `@Input() n = new Signal.State(0)`  parent writes call `.set()` — reactive
 *   `@Input() accessor n = 0`           signal-backed automatically — reactive
 *   `@Input() n = 0`                    plain assignment — not reactive
 */
export function Input(options: InputOptions = {}) {
  return function decorateInput(
    target: unknown,
    context: ClassFieldDecoratorContext | ClassAccessorDecoratorContext,
  ): unknown {
    if (context.static) {
      throw new Error(`[volt] @Input cannot be used on a static member (${String(context.name)}).`);
    }
    if (typeof context.name === 'symbol') {
      throw new Error('[volt] @Input cannot be used on a symbol-named property.');
    }

    const property = context.name;
    appendMetadata<InputDef>(context.metadata as MetadataRecord, INPUTS, {
      property,
      alias: options.alias ?? property,
      required: options.required ?? false,
    });

    if (context.kind === 'accessor') {
      // Back the accessor with a signal so reads inside a template subscribe.
      const store = new WeakMap<object, Signal.State<unknown>>();
      void (target as ClassAccessorDecoratorTarget<unknown, unknown>);
      return {
        get(this: object) {
          return store.get(this)?.get();
        },
        set(this: object, value: unknown) {
          store.get(this)?.set(value);
        },
        init(this: object, initial: unknown) {
          store.set(this, new Signal.State(initial));
          return initial;
        },
      } satisfies ClassAccessorDecoratorResult<object, unknown>;
    }

    return undefined;
  };
}

/**
 * Declare an event the parent can listen to with `:on-name`.
 * Defaults to a fresh `EventEmitter` when the field has no initialiser.
 */
export function Output(alias?: string) {
  return function decorateOutput(
    _target: unknown,
    context: ClassFieldDecoratorContext,
  ): (initial: unknown) => unknown {
    if (typeof context.name === 'symbol') {
      throw new Error('[volt] @Output cannot be used on a symbol-named property.');
    }

    const property = context.name;
    appendMetadata<OutputDef>(context.metadata as MetadataRecord, OUTPUTS, {
      property,
      alias: alias ?? property,
    });

    return (initial: unknown) => initial ?? new EventEmitter<unknown>();
  };
}

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------

export class EventEmitter<T = void> {
  private readonly listeners = new Set<(value: T) => void>();

  emit(value: T): void {
    // Copied so a listener that unsubscribes mid-emit cannot skip another.
    for (const listener of [...this.listeners]) listener(value);
  }

  subscribe(listener: (value: T) => void): Dispose {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function getComponentConfig(
  component: ComponentType<unknown>,
): ComponentConfig | undefined {
  return CONFIGS.get(component)?.config;
}

export function isComponent(value: unknown): value is ComponentType<unknown> {
  return typeof value === 'function' && CONFIGS.has(value as ComponentType<unknown>);
}

function resolveComponent(parentCtx: unknown, tag: string): ComponentType<unknown> | null {
  const parentClass = (parentCtx as { constructor?: ComponentType<unknown> } | null)
    ?.constructor;
  const imports = parentClass ? CONFIGS.get(parentClass)?.config.imports : undefined;

  if (imports) {
    for (const candidate of imports) {
      const resolved = CONFIGS.get(candidate);
      if (resolved?.config.selector === tag || candidate.name === tag) return candidate;
    }
  }

  return GLOBAL_COMPONENTS.get(tag) ?? null;
}

function getRenderFn(component: ComponentType<unknown>, resolved: ResolvedConfig): RenderFn {
  const cached = RENDERERS.get(component);
  if (cached) return cached;

  const { config } = resolved;
  let render: RenderFn;

  if (config.render) {
    render = config.render;
  } else if (typeof config.template === 'string') {
    if (!templateCompiler) {
      throw new Error(
        `[volt] ${component.name} has a template but no compiler is available. ` +
          'Use @voltjs/vite-plugin to compile templates at build time, or import ' +
          "'@voltjs/core/jit' to compile them in the browser.",
      );
    }
    render = templateCompiler(config.template, config.selector);
  } else {
    render = () => null;
  }

  RENDERERS.set(component, render);
  return render;
}

function injectStyles(resolved: ResolvedConfig): void {
  if (resolved.stylesInjected) return;
  const { styles } = resolved.config;
  if (!styles) {
    resolved.stylesInjected = true;
    return;
  }

  const text = Array.isArray(styles) ? styles.join('\n') : styles;
  if (text.trim() && typeof document !== 'undefined') {
    const el = document.createElement('style');
    el.setAttribute('data-volt', resolved.config.selector);
    el.textContent = text;
    document.head.appendChild(el);
  }
  resolved.stylesInjected = true;
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

function applyInputs(
  instance: Record<string, unknown>,
  props: Record<string, unknown> | null,
  resolved: ResolvedConfig,
): void {
  const seen = new Set<string>();

  if (props) {
    for (const key of Object.keys(props)) {
      if (key === '__ref') continue;
      seen.add(key);

      const def = resolved.inputsByAlias.get(key);
      const property = def?.property ?? key;
      const descriptor = Object.getOwnPropertyDescriptor(props, key);
      const current = instance[property];

      if (isWritableSignal(current)) {
        // A getter means the parent's expression is dynamic, so keep it live.
        if (descriptor?.get) {
          renderEffect(() => current.set(props[key]));
        } else {
          current.set(props[key]);
        }
        continue;
      }

      if (descriptor?.get) {
        renderEffect(() => {
          instance[property] = props[key];
        });
      } else {
        instance[property] = props[key];
      }
    }
  }

  for (const def of resolved.inputsByAlias.values()) {
    if (def.required && !seen.has(def.alias)) {
      throw new Error(
        `[volt] <${resolved.config.selector}> requires the input "${def.alias}".`,
      );
    }
  }
}

function wireOutputs(
  instance: Record<string, unknown>,
  events: Record<string, unknown> | null,
  resolved: ResolvedConfig,
): void {
  if (!events) return;

  for (const [alias, handler] of Object.entries(events)) {
    if (typeof handler !== 'function') continue;

    const def = resolved.outputsByAlias.get(alias);
    const property = def?.property ?? alias;
    const emitter = instance[property];

    if (emitter instanceof EventEmitter) {
      onCleanup(emitter.subscribe(handler as (value: unknown) => void));
    } else {
      throw new Error(
        `[volt] <${resolved.config.selector}> has no @Output named "${alias}".`,
      );
    }
  }
}

interface InstantiateOptions {
  props?: Record<string, unknown> | null;
  events?: Record<string, unknown> | null;
  slots?: SlotMap | null;
}

function instantiate(
  component: ComponentType<unknown>,
  options: InstantiateOptions = {},
): unknown {
  const resolved = CONFIGS.get(component);
  if (!resolved) {
    throw new Error(
      `[volt] ${component.name} is not decorated with @Component.`,
    );
  }

  injectStyles(resolved);

  const instance = new component() as Record<string, unknown> & LifecycleHooks;
  SLOTS.set(instance, options.slots ?? null);

  applyInputs(instance, options.props ?? null, resolved);
  wireOutputs(instance, options.events ?? null, resolved);

  instance.onInit?.();
  if (instance.onDestroy) onCleanup(() => instance.onDestroy!());

  const render = getRenderFn(component, resolved);
  const dom = render(instance);

  if (instance.onMount) {
    // Deferred so the node is in the document by the time this runs.
    queueMicrotask(() => instance.onMount!());
  }

  const ref = options.props?.['__ref'];
  if (typeof ref === 'function') (ref as (value: unknown) => void)(instance);

  return dom;
}

/**
 * Called by compiled templates for every component tag.
 *
 * A hyphenated tag that resolves to nothing is treated as a real custom
 * element rather than an error, so web components work without registration.
 */
export function createComponent(
  parentCtx: unknown,
  tag: string,
  props: Record<string, unknown> | null,
  events: Record<string, unknown> | null,
  slots: SlotMap | null,
): unknown {
  const component = resolveComponent(parentCtx, tag);

  if (!component) {
    if (tag.includes('-')) return createCustomElement(tag, props, events, slots);
    throw new Error(
      `[volt] Unknown component <${tag}>. Add it to the \`imports\` of the ` +
        'component whose template uses it, or register it globally.',
    );
  }

  return instantiate(component, { props, events, slots });
}

function createCustomElement(
  tag: string,
  props: Record<string, unknown> | null,
  events: Record<string, unknown> | null,
  slots: SlotMap | null,
): Node {
  const el = document.createElement(tag);

  if (props) {
    for (const key of Object.keys(props)) {
      if (key === '__ref') continue;
      const descriptor = Object.getOwnPropertyDescriptor(props, key);
      if (descriptor?.get) {
        renderEffect(() => applyCustomElementProp(el, key, props[key]));
      } else {
        applyCustomElementProp(el, key, props[key]);
      }
    }
  }

  if (events) {
    for (const [name, handler] of Object.entries(events)) {
      if (typeof handler !== 'function') continue;
      el.addEventListener(name, handler as EventListener);
      onCleanup(() => el.removeEventListener(name, handler as EventListener));
    }
  }

  const defaultSlot = slots?.['default'];
  if (defaultSlot) insert(el, defaultSlot());

  return el;
}

function applyCustomElementProp(el: Element, name: string, value: unknown): void {
  if (name in el) {
    (el as unknown as Record<string, unknown>)[name] = value;
  } else if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value === true ? '' : String(value));
  }
}

/** Called by compiled templates for `<slot>`. */
export function slot(
  ctx: unknown,
  name: string,
  props: Record<string, unknown> | null,
  fallback: (() => unknown) | null,
): unknown {
  const slots = SLOTS.get(ctx as object);
  const render = slots?.[name];
  if (render) return render(props ?? undefined);
  return fallback ? fallback() : null;
}

// ---------------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------------

export interface MountHandle {
  /** Tear the component down and clear the host element. */
  unmount(): void;
  /** The component instance, for tests and imperative access. */
  instance: unknown;
}

/**
 * Mount a component into the document. The returned handle disposes every
 * effect the component created, so nothing is left observing after unmount.
 */
export function mount(
  component: ComponentType<unknown>,
  target: Element | string,
): MountHandle {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) {
    throw new Error(`[volt] Mount target not found: ${String(target)}`);
  }

  let dispose: Dispose = () => {};
  let instance: unknown = null;

  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const resolved = CONFIGS.get(component);
    if (!resolved) {
      throw new Error(`[volt] ${component.name} is not decorated with @Component.`);
    }

    // Capture the instance without a second construction.
    const dom = instantiate(component, {
      props: { __ref: (value: unknown) => (instance = value) },
    });
    insert(host, dom);
  });

  return {
    instance,
    unmount() {
      dispose();
      host.textContent = '';
    },
  };
}

export { getScope, runWithScope, type Scope };
