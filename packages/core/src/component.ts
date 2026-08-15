/**
 * Volt's component layer: Angular-shaped classes, TC39 standard decorators,
 * and no dependency injection.
 *
 *   @Component({
 *     selector: 'v-counter',
 *     templateUrl: './counter.html',
 *   })
 *   export class Counter {
 *     @Prop() start = new Signal.State(0);
 *     @Prop() onChanged?: (value: number) => void;
 *
 *     count = new Signal.State(0);
 *
 *     increment() {
 *       this.count.set(this.count.get() + 1);
 *       this.onChanged?.(this.count.get());
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
  flushSync,
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

const PROPS = Symbol.for('volt.props');

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

  /**
   * Path to an `.html` file holding the template, relative to this file.
   *
   * The preferred form: a real `.html` file gets syntax highlighting,
   * formatting and Emmet, none of which a template literal does. Resolved and
   * compiled at build time by `@voltjs/vite-plugin`, which also watches the
   * file so edits hot-reload.
   */
  templateUrl?: string;

  /**
   * A pre-compiled render function.
   *
   * Normally filled in by `@voltjs/vite-plugin` from `templateUrl`. Supply it
   * directly with `compileTemplate()` from `@voltjs/core/jit` when there is no
   * build step — tests and playgrounds.
   */
  render?: RenderFn;

  /** Path(s) to CSS files, relative to this file. Inlined at build time. */
  styleUrl?: string;
  styleUrls?: string[];

  /** Component-scoped CSS, injected once per component. */
  styles?: string | string[];

  /**
   * Components this template is allowed to reference.
   *
   * A function form defers evaluation, which is what mutually recursive
   * components need: `imports: () => [Other]` where a plain array would read
   * `Other` before its class binding exists. A component never needs to list
   * itself — self-recursion resolves automatically.
   */
  imports?: ComponentType<unknown>[] | (() => ComponentType<unknown>[]);
}

export interface PropOptions {
  /** Template-facing name, when it differs from the property name. */
  alias?: string;
  required?: boolean;
}

interface PropDef {
  property: string;
  alias: string;
  required: boolean;
}

interface ResolvedConfig {
  config: ComponentConfig;
  propsByAlias: Map<string, PropDef>;
  stylesInjected: boolean;
  /** Lazily resolved once, since a function form must not run per instance. */
  resolvedImports?: ComponentType<unknown>[];
}

/**
 * The only lifecycle hook.
 *
 * Setup belongs in field initializers: a `Signal.Computed` for derived state,
 * an `effect` for work with side effects — both see props, because a computed
 * is lazy and an effect's first run is deferred. Teardown belongs in
 * `onCleanup`, beside the setup it undoes.
 *
 * What none of those can do is touch DOM that is in the document, which is
 * what this is for: focus, measurement, handing an element to a library.
 */
export interface OnMount {
  onMount(): void;
}

interface LifecycleHooks {
  onMount?: () => void;
}

export type SlotMap = Record<string, (props?: Record<string, unknown>) => unknown>;

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

const CONFIGS = new WeakMap<ComponentType<unknown>, ResolvedConfig>();
const RENDERERS = new WeakMap<ComponentType<unknown>, RenderFn>();
const SLOTS = new WeakMap<object, SlotMap | null>();

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

    const propsByAlias = new Map<string, PropDef>();
    for (const def of readMetadata<PropDef>(metadata, PROPS)) {
      propsByAlias.set(def.alias, def);
    }

    CONFIGS.set(target, { config, propsByAlias, stylesInjected: false });
    return target;
  };
}

/**
 * Declare something the parent passes in.
 *
 * Covers both data and callbacks — a component notifies its parent by calling
 * a function it was given, so there is no separate event channel.
 *
 *   `@Prop() n = new Signal.State(0)`      parent writes call `.set()` — reactive
 *   `@Prop() accessor n = 0`               signal-backed automatically — reactive
 *   `@Prop() n = 0`                        plain assignment — not reactive
 *   `@Prop() onDone?: (v: T) => void`      a callback the child invokes
 */
export function Prop(options: PropOptions = {}) {
  return function decorateProp(
    target: unknown,
    context: ClassFieldDecoratorContext | ClassAccessorDecoratorContext,
  ): unknown {
    if (context.static) {
      throw new Error(`[volt] @Prop cannot be used on a static member (${String(context.name)}).`);
    }
    if (typeof context.name === 'symbol') {
      throw new Error('[volt] @Prop cannot be used on a symbol-named property.');
    }

    const property = context.name;
    appendMetadata<PropDef>(context.metadata as MetadataRecord, PROPS, {
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

/**
 * Resolve a tag against the using component's `imports`, and nowhere else.
 *
 * There is no global registry: a template can only reference what its own
 * component declares. That keeps the dependency visible in the source and
 * lets a bundler see it, at the cost of listing each import once.
 */
function resolveComponent(parentCtx: unknown, tag: string): ComponentType<unknown> | null {
  const parentClass = (parentCtx as { constructor?: ComponentType<unknown> } | null)
    ?.constructor;
  if (!parentClass) return null;

  const resolved = CONFIGS.get(parentClass);
  if (!resolved) return null;

  // A component always resolves itself. Recursion cannot be expressed through
  // `imports` — the class binding does not exist yet when its own decorator
  // runs — and a tree or menu rendering itself is ordinary enough that it
  // should not need a workaround.
  if (resolved.config.selector === tag || parentClass.name === tag) return parentClass;

  const imports = (resolved.resolvedImports ??= resolveImports(resolved.config.imports));
  for (const candidate of imports) {
    const candidateConfig = CONFIGS.get(candidate);
    if (candidateConfig?.config.selector === tag || candidate.name === tag) return candidate;
  }

  return null;
}

function resolveImports(
  imports: ComponentConfig['imports'],
): ComponentType<unknown>[] {
  if (!imports) return [];
  return typeof imports === 'function' ? imports() : imports;
}

function getRenderFn(component: ComponentType<unknown>, resolved: ResolvedConfig): RenderFn {
  const cached = RENDERERS.get(component);
  if (cached) return cached;

  const { config } = resolved;
  let render: RenderFn;

  if (config.render) {
    render = config.render;
  } else if (typeof config.templateUrl === 'string') {
    // Reaching here means the build-time pass did not run: `templateUrl` is
    // read from disk, which the browser cannot do.
    throw new Error(
      `[volt] ${component.name} declares templateUrl "${config.templateUrl}", which is ` +
        'resolved at build time. Add @voltjs/vite-plugin to your Vite config, or supply ' +
        "`render` directly using compileTemplate() from '@voltjs/core/jit'.",
    );
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

function applyProps(
  instance: Record<string, unknown>,
  props: Record<string, unknown> | null,
  resolved: ResolvedConfig,
): void {
  const seen = new Set<string>();

  if (props) {
    for (const key of Object.keys(props)) {
      if (key === '__ref') continue;
      seen.add(key);

      const def = resolved.propsByAlias.get(key);
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

  for (const def of resolved.propsByAlias.values()) {
    if (def.required && !seen.has(def.alias)) {
      throw new Error(
        `[volt] <${resolved.config.selector}> requires the prop "${def.alias}".`,
      );
    }
  }
}

interface InstantiateOptions {
  props?: Record<string, unknown> | null;
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

  applyProps(instance, options.props ?? null, resolved);

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
  if (component) {
    if (events) {
      // Components have no event channel: a parent passes a function in as an
      // ordinary input and the child calls it.
      const name = Object.keys(events)[0] ?? '';
      throw new Error(
        `[volt] <${tag}> is a component, so \`:on-${name}\` does not apply. ` +
          `Pass a callback instead: \`:on${name.charAt(0).toUpperCase()}${name.slice(1)}="..."\`, ` +
          `declared on the child as a @Prop.`,
      );
    }
    return instantiate(component, { props, slots });
  }

  // Volt selectors are hyphenated too, so "has a hyphen" cannot distinguish a
  // web component from a forgotten import. The platform's own registry can:
  // a real custom element has to be defined to work at all.
  if (tag.includes('-') && globalThis.customElements?.get(tag)) {
    return createCustomElement(tag, props, events, slots);
  }

  const owner = (parentCtx as { constructor?: { name: string } } | null)?.constructor?.name;
  throw new Error(
    `[volt] Unknown component <${tag}>` +
      (owner ? ` used by ${owner}` : '') +
      `. Add it to that component's \`imports\`` +
      (tag.includes('-')
        ? ', or define it as a custom element before the component mounts.'
        : '.'),
  );
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

  // Effects are deferred, so without this the tree handed back would not yet
  // reflect them — a component whose setup runs in a field effect would paint
  // its placeholder first.
  flushSync();

  return {
    instance,
    unmount() {
      dispose();
      host.textContent = '';
    },
  };
}

export { getScope, runWithScope, type Scope };
