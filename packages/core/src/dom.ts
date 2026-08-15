/**
 * The DOM runtime that compiled templates call into.
 *
 * Every export here is addressed as `_rt.<name>` from generated code. Nothing
 * in this file walks a tree looking for changes: each binding is its own
 * effect, wired directly to the node it owns.
 */

import {
  Signal,
  batch,
  createRoot,
  effect,
  getScope,
  isSignal,
  isWritableSignal,
  onCleanup,
  renderEffect,
  type Scope,
} from '@voltjs/reactivity';

// Annotated explicitly: the inferred type names an internal module, which
// would leak a non-portable path into the emitted declarations.
const untrack: <T>(cb: () => T) => T = Signal.subtle.untrack;

export type Accessor<T> = () => T;
export type MaybeAccessor<T> = T | Accessor<T>;
/** Anything a compiled block may produce. */
export type BlockResult = Node | Node[] | string | number | boolean | null | undefined;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Compile a static markup string into a cloner. The markup is parsed exactly
 * once per template, no matter how many instances are created.
 */
export function template(html: string, rootCount = 1, isSvg = false): () => Node {
  let cached: Node | undefined;

  const create = (): Node => {
    const el = document.createElement('template');
    el.innerHTML = isSvg ? `<svg>${html}</svg>` : html;

    if (isSvg) {
      const svg = el.content.firstChild as Element;
      if (rootCount === 1) return svg.firstChild!;
      const fragment = document.createDocumentFragment();
      while (svg.firstChild) fragment.appendChild(svg.firstChild);
      return fragment;
    }

    return rootCount === 1 ? el.content.firstChild! : el.content;
  };

  return () => (cached ??= create()).cloneNode(true);
}

/** Snapshot a fragment's top-level nodes before insertion moves them out. */
export function childNodes(node: Node): Node[] {
  return Array.from(node.childNodes);
}

export function omit(source: unknown, keys: string[]): Record<string, unknown> {
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

export function withDefault<T>(value: T | undefined, fallback: () => T): T {
  return value === undefined ? fallback() : value;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

export function insert(parent: Node, accessor: unknown, marker: Node | null = null): void {
  if (typeof accessor !== 'function') {
    insertExpression(parent, accessor, marker, null);
    return;
  }
  // The previously inserted content is held in a closure rather than threaded
  // through the effect's return value, which is reserved for cleanup.
  let current: Current = null;
  renderEffect(() => {
    current = insertExpression(parent, (accessor as Accessor<unknown>)(), marker, current);
  });
}

type Current = Node | Node[] | null;

function insertExpression(
  parent: Node,
  value: unknown,
  marker: Node | null,
  current: unknown,
): Current {
  let resolved = value;
  while (typeof resolved === 'function') resolved = (resolved as Accessor<unknown>)();

  const previous = current as Current;
  if (resolved === previous) return previous;

  const type = typeof resolved;

  // Only null and undefined render as nothing. Everything else stringifies,
  // matching `toDisplayString` — the text-only compile path uses that, and an
  // optimisation must not change what a template displays.
  if (resolved === null || resolved === undefined) {
    return replaceContent(parent, previous, marker, null);
  }

  if (type === 'string' || type === 'number' || type === 'bigint' || type === 'boolean') {
    const text = String(resolved);
    // Reuse the existing text node so a changing value never re-creates DOM.
    if (previous instanceof Text) {
      if (previous.data !== text) previous.data = text;
      return previous;
    }
    return replaceContent(parent, previous, marker, document.createTextNode(text));
  }

  if (resolved instanceof Node) {
    return replaceContent(parent, previous, marker, resolved);
  }

  if (Array.isArray(resolved)) {
    const nodes = flattenToNodes(resolved);
    if (nodes.length === 0) return replaceContent(parent, previous, marker, null);
    if (Array.isArray(previous) && previous.length > 0 && previous[0]!.parentNode === parent) {
      reconcileArrays(parent, previous, nodes, marker);
      return nodes;
    }
    return replaceContent(parent, previous, marker, nodes);
  }

  return replaceContent(parent, previous, marker, document.createTextNode(String(resolved)));
}

function replaceContent(
  parent: Node,
  current: Current,
  marker: Node | null,
  replacement: Node | Node[] | null,
): Current {
  if (marker === null) {
    // Without a marker this binding owns the entire parent.
    (parent as Element).textContent = '';
    if (replacement) appendAll(parent, replacement, null);
    return replacement ?? null;
  }

  removeNodes(current);
  if (replacement) appendAll(parent, replacement, marker);
  return replacement ?? null;
}

function appendAll(parent: Node, value: Node | Node[], before: Node | null): void {
  if (Array.isArray(value)) {
    for (const node of value) parent.insertBefore(node, before);
  } else {
    parent.insertBefore(value, before);
  }
}

function removeNodes(current: Current): void {
  if (current === null || current === undefined) return;
  if (Array.isArray(current)) {
    for (const node of current) (node as ChildNode).remove();
  } else {
    (current as ChildNode).remove();
  }
}

function flattenToNodes(value: unknown[], out: Node[] = []): Node[] {
  for (const entry of value) {
    let item = entry;
    while (typeof item === 'function') item = (item as Accessor<unknown>)();
    if (item === null || item === undefined) continue;
    if (item instanceof Node) out.push(item);
    else if (Array.isArray(item)) flattenToNodes(item, out);
    else out.push(document.createTextNode(String(item)));
  }
  return out;
}

/**
 * Keyed list reconciliation. Trims the common prefix and suffix first, then
 * falls back to an index map for the genuinely reordered middle, so the common
 * cases (append, prepend, remove, swap) touch the minimum number of nodes.
 */
function reconcileArrays(parent: Node, a: Node[], b: Node[], marker: Node | null): void {
  const bLength = b.length;
  let aEnd = a.length;
  let bEnd = bLength;
  let aStart = 0;
  let bStart = 0;
  const after = aEnd > 0 ? a[aEnd - 1]!.nextSibling : marker;
  let map: Map<Node, number> | null = null;

  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }

    while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }

    if (aEnd === aStart) {
      const node =
        bEnd < bLength ? (bStart > 0 ? b[bStart - 1]!.nextSibling : (b[bEnd] ?? null)) : after;
      while (bStart < bEnd) parent.insertBefore(b[bStart++]!, node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        const node = a[aStart]!;
        if (!map?.has(node)) (node as ChildNode).remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      // A straight swap of the two ends.
      const node = a[--aEnd]!.nextSibling;
      parent.insertBefore(b[bStart++]!, a[aStart++]!.nextSibling);
      parent.insertBefore(b[--bEnd]!, node);
      a[aEnd] = b[bEnd]!;
    } else {
      if (!map) {
        map = new Map();
        for (let i = bStart; i < bEnd; i++) map.set(b[i]!, i);
      }

      const index = map.get(a[aStart]!);
      if (index !== undefined) {
        if (bStart < index && index < bEnd) {
          let i = aStart;
          let sequence = 1;
          while (++i < aEnd && i < bEnd) {
            const t = map.get(a[i]!);
            if (t === undefined || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart]!;
            while (bStart < index) parent.insertBefore(b[bStart++]!, node);
          } else {
            parent.replaceChild(b[bStart++]!, a[aStart++]!);
          }
        } else {
          aStart++;
        }
      } else {
        const node = a[aStart++]!;
        (node as ChildNode).remove();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

export type BranchEntry = [Accessor<unknown> | null, () => unknown];

/**
 * `:if` / `:else-if` / `:else`. Conditions are tested in order; only the
 * winning branch is built, and switching branches disposes the previous
 * branch's effects along with its DOM.
 */
export function branch(branches: BranchEntry[]): Accessor<unknown> {
  // The winning index is its own computed, so re-testing conditions does not
  // rebuild the branch unless the winner actually changes.
  const active = new Signal.Computed(() => {
    for (let i = 0; i < branches.length; i++) {
      const condition = branches[i]![0];
      if (condition === null || condition()) return i;
    }
    return -1;
  });

  const result = new Signal.State<unknown>(null);

  // A render effect, not a computed: building a branch creates effects, and
  // re-running this disposes the previous branch's scope along with them.
  renderEffect(() => {
    const index = active.get();
    result.set(index === -1 ? null : untrack(() => branches[index]![1]()));
  });

  return () => result.get();
}

/**
 * A row's DOM is read through `nodes()` rather than cached, because a row
 * whose own content is conditional can change which nodes it occupies without
 * the list itself ever changing.
 */
interface MountedBlock {
  nodes(): Node[];
}

interface Row {
  block: MountedBlock;
  dispose: () => void;
  item: Signal.State<unknown>;
  index: Signal.State<number>;
}

/**
 * `:for`. Rows are keyed, and a row that survives a change is never rebuilt —
 * its item and index signals are updated in place, so only the bindings that
 * actually read them re-run.
 *
 * With no `:key`, rows are keyed by **item identity**. That makes reordering
 * correct by default: the elements move and whatever is attached to them —
 * focus, input values, a running transition — moves too. Keying by position
 * instead would leave that state stranded on the wrong row, which is the
 * failure every framework with an index default shares.
 *
 * The trade-off is that replacing an item with an equal-but-new object counts
 * as a different row. `:key="item.id"` is the answer when data is refetched;
 * `:key="$index"` opts back into positional keying.
 */
export function each(
  list: Accessor<unknown>,
  rowFn: (item: Accessor<unknown>, index: Accessor<number>) => unknown,
  keyFn: ((item: unknown, index: number) => unknown) | null,
): Accessor<Node[]> {
  const scope = getScope();
  let prevKeys: unknown[] = [];
  let prevRows: Row[] = [];

  onCleanup(() => {
    for (const row of prevRows) row.dispose();
    prevRows = [];
    prevKeys = [];
  });

  const result = new Signal.State<Node[]>([]);

  // A render effect rather than a computed, because reconciling writes the
  // per-row item and index signals — something a pure computed may not do.
  renderEffect(() => {
    const raw = list();
    const items: unknown[] = Array.isArray(raw)
      ? raw
      : raw === null || raw === undefined
        ? []
        : Array.from(raw as Iterable<unknown>);

    const count = items.length;
    const keys = new Array<unknown>(count);
    // No key function means key by the item itself. Duplicates are fine: the
    // reconciler buckets equal keys and pairs them up in order.
    for (let i = 0; i < count; i++) keys[i] = keyFn ? keyFn(items[i], i) : items[i];

    const rows = new Array<Row>(count);

    const out = untrack(() => {
      // Buckets, not a plain index map, so duplicate keys still pair up 1:1.
      const available = new Map<unknown, number[]>();
      for (let i = 0; i < prevKeys.length; i++) {
        const bucket = available.get(prevKeys[i]);
        if (bucket) bucket.push(i);
        else available.set(prevKeys[i], [i]);
      }

      const reused = new Set<number>();

      for (let i = 0; i < count; i++) {
        const bucket = available.get(keys[i]);
        const oldIndex = bucket && bucket.length > 0 ? bucket.shift() : undefined;

        if (oldIndex !== undefined) {
          const row = prevRows[oldIndex]!;
          reused.add(oldIndex);
          rows[i] = row;
          // Refresh in place; the row's DOM stays exactly where it is.
          row.item.set(items[i]);
          row.index.set(i);
          continue;
        }

        rows[i] = createRow(scope, rowFn, items[i], i);
      }

      for (let i = 0; i < prevRows.length; i++) {
        if (!reused.has(i)) prevRows[i]!.dispose();
      }

      prevKeys = keys;
      prevRows = rows;

      const nodes: Node[] = [];
      for (const row of rows) nodes.push(...row.block.nodes());
      return nodes;
    });

    result.set(out);
  });

  return () => result.get();
}

function createRow(
  scope: Scope | null,
  rowFn: (item: Accessor<unknown>, index: Accessor<number>) => unknown,
  item: unknown,
  index: number,
): Row {
  const itemSignal = new Signal.State<unknown>(item);
  const indexSignal = new Signal.State(index);
  let block: MountedBlock = { nodes: () => [] };

  // Rows are rooted at the scope that created the list, not at the reconciling
  // effect — otherwise every recompute would dispose the rows we mean to keep.
  const dispose = createRoot((disposeRow) => {
    block = materializeBlock(rowFn(() => itemSignal.get(), () => indexSignal.get()));
    return disposeRow;
  }, scope);

  return { block, dispose, item: itemSignal, index: indexSignal };
}

/**
 * Turn any block result into DOM with a stable identity.
 *
 * A block that is just an accessor (`{{ item }}`, a bare `:if`, a nested
 * `:for`) has no element of its own, so it gets a zero-width anchor and keeps
 * its content immediately before it. Reading `nodes()` reports whatever the
 * block currently occupies rather than what it occupied when it was built.
 */
function materializeBlock(value: unknown): MountedBlock {
  if (value instanceof Node) {
    const fixed = [value];
    return { nodes: () => fixed };
  }

  if (Array.isArray(value)) {
    const parts = value.map(materializeBlock);
    return { nodes: () => parts.flatMap((part) => part.nodes()) };
  }

  if (typeof value === 'function') {
    const anchor = document.createTextNode('');
    // The anchor starts in a detached holder so the first run has somewhere to
    // write; once the row is mounted, `anchor.parentNode` is the real parent.
    const holder = document.createDocumentFragment();
    holder.appendChild(anchor);

    let current: Current = null;
    renderEffect(() => {
      const parent = anchor.parentNode ?? holder;
      current = insertExpression(parent, (value as Accessor<unknown>)(), anchor, current);
    });

    return {
      nodes: () => {
        const out: Node[] = [];
        if (Array.isArray(current)) out.push(...current);
        else if (current) out.push(current);
        out.push(anchor);
        return out;
      },
    };
  }

  if (value === null || value === undefined) {
    const empty = [document.createTextNode('') as Node];
    return { nodes: () => empty };
  }

  const text = [document.createTextNode(toDisplayString(value)) as Node];
  return { nodes: () => text };
}

/** Materialise a block and return its current nodes. */
export function materialize(value: unknown): Node | Node[] {
  const nodes = materializeBlock(value).nodes();
  return nodes.length === 1 ? nodes[0]! : nodes;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
}

export function on(
  el: Element,
  name: string,
  handler: EventListener,
  options?: EventOptions,
): void {
  el.addEventListener(name, handler, options);
  onCleanup(() => el.removeEventListener(name, handler, options));
}

/** Event types that already have a document-level listener installed. */
const delegatedTypes = new Set<string>();

/**
 * Attach a handler without adding a listener to the element.
 *
 * One listener per event *type* is installed on the document; dispatch walks
 * up from the target looking for a handler stashed on each node. A table of a
 * thousand rows with two handlers each costs two listeners instead of two
 * thousand, and rows can be created and discarded without touching the
 * listener registry at all.
 */
export function delegate(el: Element, name: string, handler: EventListener): void {
  const key = `$$${name}`;
  (el as unknown as Record<string, unknown>)[key] = handler;

  if (!delegatedTypes.has(name)) {
    delegatedTypes.add(name);
    document.addEventListener(name, dispatchDelegated);
  }

  // No cleanup is registered on purpose. The handler is a property of the
  // node, so discarding the node discards it; and a re-run overwrites it in
  // place. Registering one would allocate a closure and a cleanups array per
  // handler, which is pure cost in exactly the teardown paths that matter —
  // a thousand-row table would carry two thousand of them.
}

function dispatchDelegated(event: Event): void {
  const key = `$$${event.type}`;
  let node = event.target as (Node & Record<string, unknown>) | null;

  // The walk is synthetic, so the browser's own bubbling has already
  // finished; `stopPropagation` is intercepted to stop *this* walk. Reading
  // `cancelBubble` would be the alternative, but it is deprecated.
  let stopped = false;
  const stopPropagation = event.stopPropagation.bind(event);
  Object.defineProperty(event, 'stopPropagation', {
    configurable: true,
    value() {
      stopped = true;
      stopPropagation();
    },
  });

  try {
    while (node !== null) {
      const handler = node[key] as EventListener | undefined;
      if (handler) {
        // `currentTarget` is null during a synthetic walk, so expose the node
        // the handler was attached to — that is what `.self` compares against.
        Object.defineProperty(event, 'currentTarget', {
          configurable: true,
          value: node,
        });
        Reflect.apply(handler, node, [event]);
        if (stopped) return;
      }
      node = node.parentNode as (Node & Record<string, unknown>) | null;
    }
  } finally {
    Reflect.deleteProperty(event, 'stopPropagation');
    Reflect.deleteProperty(event, 'currentTarget');
  }
}

export interface GuardConfig {
  stop?: boolean;
  prevent?: boolean;
  self?: boolean;
  system?: string[];
  keys?: string[];
}

/** Wrap a handler with the `.stop` / `.prevent` / `.enter` style modifiers. */
export function guard(handler: EventListener, config: GuardConfig): EventListener {
  return function guarded(this: unknown, event: Event) {
    if (config.self && event.target !== event.currentTarget) return;

    if (config.system?.length) {
      const e = event as MouseEvent & KeyboardEvent;
      for (const modifier of config.system) {
        const pressed =
          modifier === 'ctrl'
            ? e.ctrlKey
            : modifier === 'alt'
              ? e.altKey
              : modifier === 'shift'
                ? e.shiftKey
                : e.metaKey;
        if (!pressed) return;
      }
    }

    if (config.keys?.length) {
      const key = (event as KeyboardEvent).key;
      if (!config.keys.includes(key)) return;
    }

    if (config.stop) event.stopPropagation();
    if (config.prevent) event.preventDefault();

    return Reflect.apply(handler, this, [event]);
  };
}

// ---------------------------------------------------------------------------
// Attribute / property bindings
// ---------------------------------------------------------------------------

function bind<T>(accessor: MaybeAccessor<T>, apply: (value: T) => void): void {
  if (typeof accessor !== 'function') {
    apply(accessor as T);
    return;
  }
  // `first` matters because the initial value may legitimately be undefined,
  // which would otherwise be indistinguishable from "unchanged".
  let previous: T | undefined;
  let first = true;
  renderEffect(() => {
    const value = (accessor as Accessor<T>)();
    if (first || !Object.is(value, previous)) {
      first = false;
      previous = value;
      apply(value);
    }
  });
}

export function bindAttr(el: Element, name: string, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => setAttribute(el, name, value));
}

export function bindProp(el: Element, name: string, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    (el as unknown as Record<string, unknown>)[name] = value;
  });
}

/** Prefer the IDL property when the element actually has one. */
export function bindDynamic(el: Element, name: string, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    if (name in el) {
      (el as unknown as Record<string, unknown>)[name] = value;
    } else {
      setAttribute(el, name, value);
    }
  });
}

function setAttribute(el: Element, name: string, value: unknown): void {
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

/**
 * Render content into a different container — `:portal`.
 *
 * With no virtual DOM there is nothing to reconcile across trees: a portal is
 * a node placed somewhere else. Context and disposal both follow the reactive
 * scope rather than the DOM, so content declared inside a provider still sees
 * it, and is still torn down with the component that declared it, wherever it
 * ended up on the page.
 *
 * `target` may be an element, a selector string, or null for `document.body`.
 * It is read once: re-homing live content is not something an overlay needs,
 * and supporting it would cost every portal a move path it never uses.
 */
export function portal(target: unknown, build: () => unknown): void {
  const container = resolvePortalTarget(target);

  // Anchoring to a marker rather than appending means several portals into the
  // same container keep a stable order, and each removes only its own nodes.
  const marker = document.createComment('');
  container.appendChild(marker);

  const current = insertExpression(container, build(), marker, null);

  onCleanup(() => {
    removeNodes(current);
    marker.remove();
  });
}

function resolvePortalTarget(target: unknown): Element {
  let resolved = target;
  while (typeof resolved === 'function') resolved = (resolved as Accessor<unknown>)();

  if (resolved === null || resolved === undefined) return document.body;
  if (resolved instanceof Element) return resolved;

  if (typeof resolved === 'string') {
    const found = document.querySelector(resolved);
    if (found) return found;
    throw new Error(
      `[volt] :portal target "${resolved}" matched no element. ` +
        'It has to exist before the component that portals into it mounts.',
    );
  }

  throw new Error('[volt] :portal expects an element, a selector string, or nothing.');
}

/**
 * Toggle a single class from a boolean.
 *
 * What `:class="{ danger: expr }"` compiles to when every key is written
 * literally, which is the overwhelmingly common shape. The general binding has
 * to allocate an object, normalise it to an array, and ask the element which
 * classes it already has; this compares one boolean and touches the DOM only
 * when the answer changes. In a list where one shared signal drives a class on
 * every row, that is the difference between every row doing DOM work on every
 * update and only the two rows that actually changed doing any.
 */
export function bindClassToggle(
  el: Element,
  name: string,
  accessor: MaybeAccessor<unknown>,
): void {
  // Undefined rather than false, so the first run always writes — the class
  // may be present in the template's own markup.
  let applied: boolean | undefined;

  bind(accessor, (value) => {
    const next = Boolean(value);
    if (next === applied) return;
    applied = next;
    el.classList.toggle(name, next);
  });
}

export function bindClass(el: Element, accessor: MaybeAccessor<unknown>): void {
  // Only the classes this binding added are ever removed, so classes written
  // literally in the template survive every update.
  let applied: string[] = [];

  bind(accessor, (value) => {
    const next = normalizeClass(value);
    for (const cls of applied) if (!next.includes(cls)) el.classList.remove(cls);
    for (const cls of next) if (!el.classList.contains(cls)) el.classList.add(cls);
    applied = next;
  });
}

function normalizeClass(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(normalizeClass);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, on]) => Boolean(on))
      .map(([cls]) => cls);
  }
  return [];
}

export function bindStyle(el: HTMLElement, accessor: MaybeAccessor<unknown>): void {
  let applied: Record<string, string> = {};

  bind(accessor, (value) => {
    const next = normalizeStyle(value);
    for (const key of Object.keys(applied)) {
      if (!(key in next)) el.style.removeProperty(key);
    }
    for (const [key, v] of Object.entries(next)) {
      if (applied[key] !== v) el.style.setProperty(key, v);
    }
    applied = next;
  });
}

function normalizeStyle(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    const out: Record<string, string> = {};
    for (const rule of value.split(';')) {
      const idx = rule.indexOf(':');
      if (idx === -1) continue;
      const key = rule.slice(0, idx).trim();
      if (key) out[key] = rule.slice(idx + 1).trim();
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined || v === false) continue;
      out[hyphenate(key)] = String(v);
    }
    return out;
  }
  return {};
}

function hyphenate(name: string): string {
  return name.replaceAll(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function bindText(el: Element, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    const text = toDisplayString(value);
    const first = el.firstChild;
    // Patch the existing text node when there is exactly one, so a changing
    // value never detaches and recreates DOM.
    if (first !== null && first === el.lastChild && first.nodeType === Node.TEXT_NODE) {
      if ((first as Text).data !== text) (first as Text).data = text;
    } else {
      el.textContent = text;
    }
  });
}

export function bindHtml(el: Element, accessor: MaybeAccessor<unknown>): void {
  bind(accessor, (value) => {
    el.innerHTML = value === null || value === undefined ? '' : String(value);
  });
}

export function spread(el: Element, accessor: MaybeAccessor<Record<string, unknown>>): void {
  let applied: string[] = [];
  bind(accessor, (props) => {
    const next = props ?? {};
    for (const key of applied) if (!(key in next)) setAttribute(el, key, null);
    for (const [key, value] of Object.entries(next)) {
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        continue;
      }
      if (key === 'class') bindClass(el, value);
      else if (key === 'style') bindStyle(el as HTMLElement, value);
      else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
      else setAttribute(el, key, value);
    }
    applied = Object.keys(next);
  });
}

export function setRef(node: unknown, ctx: Record<string, unknown>, name: string): void {
  const existing = ctx[name];
  if (isWritableSignal(existing)) existing.set(node);
  else ctx[name] = node;

  onCleanup(() => {
    const current = ctx[name];
    if (isWritableSignal(current)) current.set(null);
    else if (ctx[name] === node) ctx[name] = null;
  });
}

// ---------------------------------------------------------------------------
// Two-way binding
// ---------------------------------------------------------------------------

export interface ModelModifiers {
  number?: boolean;
  trim?: boolean;
  lazy?: boolean;
}

export function writeModel(target: unknown, value: unknown, assign: () => void): void {
  if (isWritableSignal(target)) target.set(value);
  else assign();
}

export function model(
  el: HTMLElement,
  kind: string,
  accessor: Accessor<unknown>,
  setter: (value: unknown) => void,
  modifiers: ModelModifiers,
): void {
  // `:model="name"` yields the signal itself, not its value, so unwrap it.
  const read = (): unknown => {
    const raw = accessor();
    return isSignal(raw) ? raw.get() : raw;
  };

  if (kind === 'checkbox') {
    const input = el as HTMLInputElement;
    renderEffect(() => {
      input.checked = Boolean(read());
    });
    on(input, 'change', () => setter(input.checked));
    return;
  }

  if (kind === 'radio') {
    const input = el as HTMLInputElement;
    renderEffect(() => {
      input.checked = read() === input.value;
    });
    on(input, 'change', () => {
      if (input.checked) setter(input.value);
    });
    return;
  }

  if (kind === 'select') {
    const select = el as HTMLSelectElement;
    renderEffect(() => {
      select.value = toDisplayString(read());
    });
    on(select, 'change', () => setter(select.value));
    return;
  }

  const input = el as HTMLInputElement;
  renderEffect(() => {
    const value = toDisplayString(read());
    // Skip while the user is mid-edit, or the caret jumps to the end.
    if (input.value !== value) input.value = value;
  });

  on(input, modifiers.lazy ? 'change' : 'input', () => {
    let value: string | number = input.value;
    if (modifiers.trim) value = value.trim();
    if (modifiers.number || kind === 'number') {
      const parsed = Number.parseFloat(value);
      value = Number.isNaN(parsed) ? value : parsed;
    }
    setter(value);
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export { Signal, batch, effect, renderEffect, onCleanup, createRoot, untrack };
