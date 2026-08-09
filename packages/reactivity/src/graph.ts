/**
 * A conforming implementation of the TC39 Signals proposal.
 *
 *   https://github.com/tc39/proposal-signals
 *
 * Volt's reactivity *is* this API — there is no parallel signal type. The
 * proposal deliberately ships no `effect`, because scheduling belongs to the
 * framework, so Volt layers its effect system on `Signal.subtle.Watcher`
 * in `effect.ts`.
 *
 * The graph is push-pull. A write pushes a colour downstream (direct sinks go
 * DIRTY, transitive sinks go CHECK) and wakes any watchers; recomputation is
 * pulled lazily on `get()`. A CHECK node consults its sources' versions before
 * re-running, so a diamond dependency evaluates once and never observes a
 * half-updated graph.
 */

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

export type NodeState = typeof CLEAN | typeof CHECK | typeof DIRTY;

export const watched = Symbol('Signal.subtle.watched');
export const unwatched = Symbol('Signal.subtle.unwatched');

export interface SignalOptions<T> {
  equals?: (this: AnySignal<T>, a: T, b: T) => boolean;
  [watched]?: (this: AnySignal<T>) => void;
  [unwatched]?: (this: AnySignal<T>) => void;
}

type AnySignal<T = unknown> = StateSignal<T> | ComputedSignal<T>;
type Producer = StateSignal<unknown> | ComputedSignal<unknown>;
type Consumer = ComputedSignal<unknown> | WatcherNode;

/** The computed currently evaluating, or null at the top level. */
let currentConsumer: Consumer | null = null;
/** Set while inside `untrack`, suppressing dependency collection. */
let tracking = true;

function defaultEquals<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/**
 * Effects are implemented as computeds (as the proposal's own example does),
 * so they need an exemption from the no-writes-in-a-computed rule. The
 * framework marks its own nodes; user computeds are never in this set.
 */
const EFFECT_COMPUTEDS = new WeakSet<ComputedSignal<unknown>>();

export function markEffectComputed(node: ComputedSignal<unknown>): void {
  EFFECT_COMPUTEDS.add(node);
}

export function isEffectComputed(node: unknown): boolean {
  return node instanceof ComputedSignal && EFFECT_COMPUTEDS.has(node);
}

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

/**
 * A signal is "live" while a Watcher can reach it. Liveness propagates up
 * through computed sources so that `watched`/`unwatched` fire exactly on the
 * transitions in and out of observation — which is what lets a signal attach
 * and release external resources.
 */
/**
 * Invoke a `watched`/`unwatched` hook with the signal as `this`.
 *
 * The options object is generic in the signal's value type, which does not
 * survive erasure to `Producer`; the hook only ever receives `this`, so the
 * value type is genuinely irrelevant here.
 */
function callLivenessHook(node: Producer, key: typeof watched | typeof unwatched): void {
  const hook = node.options?.[key] as ((this: Producer) => void) | undefined;
  hook?.call(node);
}

function incrementLive(node: Producer): void {
  node.liveCount++;
  if (node.liveCount > 1) return;

  if (node instanceof ComputedSignal) {
    for (const source of node.sources) incrementLive(source);
  }
  callLivenessHook(node, watched);
}

function decrementLive(node: Producer): void {
  node.liveCount--;
  if (node.liveCount > 0) return;

  if (node instanceof ComputedSignal) {
    for (const source of node.sources) decrementLive(source);
  }
  callLivenessHook(node, unwatched);
}

// ---------------------------------------------------------------------------
// Dependency edges
// ---------------------------------------------------------------------------

function track(producer: Producer): void {
  if (!tracking || currentConsumer === null) return;
  const consumer = currentConsumer;

  (producer.sinks ??= new Set()).add(consumer);
  consumer.sources.push(producer);
  consumer.sourceVersions.push(producer.version);

  // A live consumer keeps everything it reads alive too. Liveness is counted
  // per edge — `unlinkSources` walks the same list and releases one each —
  // so a signal read twice in one body stays balanced.
  if (consumer instanceof ComputedSignal && consumer.liveCount > 0) {
    incrementLive(producer);
  }
}

function unlinkSources(consumer: ComputedSignal<unknown>): void {
  const wasLive = consumer.liveCount > 0;
  for (const source of consumer.sources) {
    source.sinks?.delete(consumer as Consumer);
    if (wasLive) decrementLive(source);
  }
  consumer.sources.length = 0;
  consumer.sourceVersions.length = 0;
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * Colour the graph downstream of a changed signal and collect the watchers
 * that need waking. Direct sinks are DIRTY (a known-changed input); anything
 * further downstream is only CHECK, because whether it truly changed depends
 * on what the intermediate computeds produce.
 */
function propagate(node: Producer, direct: boolean, pending: Set<WatcherNode>): void {
  if (node.sinks === null) return;
  for (const sink of node.sinks) {
    if (sink instanceof WatcherNode) {
      // Record which watched signal went dirty as we colour, so `getPending`
      // is proportional to what actually changed rather than to everything
      // being watched. With thousands of live effects that difference is the
      // whole cost of an update.
      sink.pending.add(node);
      if (!sink.notified) pending.add(sink);
      continue;
    }

    const next: NodeState = direct ? DIRTY : CHECK;
    if (sink.state === CLEAN) {
      sink.state = next;
      propagate(sink, false, pending);
    } else if (sink.state === CHECK && next === DIRTY) {
      // Downstream is already CHECK, so no further propagation is needed.
      sink.state = DIRTY;
    }
  }
}

// ---------------------------------------------------------------------------
// Signal.State
// ---------------------------------------------------------------------------

export class StateSignal<T> {
  /** @internal */ value: T;
  /** @internal */ version = 0;
  /** @internal */ sinks: Set<Consumer> | null = null;
  /** @internal */ liveCount = 0;
  /** @internal */ options: SignalOptions<T> | undefined;
  /** @internal */ readonly equals: (a: T, b: T) => boolean;

  constructor(value: T, options?: SignalOptions<T>) {
    this.value = value;
    this.options = options;
    this.equals = options?.equals
      ? (a, b) => options.equals!.call(this as AnySignal<T>, a, b)
      : defaultEquals;
  }

  get(): T {
    track(this as Producer);
    return this.value;
  }

  set(value: T): void {
    // A pure computed must stay pure. Effects are computeds too, so they are
    // exempted explicitly rather than by accident.
    if (currentConsumer instanceof ComputedSignal && !EFFECT_COMPUTEDS.has(currentConsumer)) {
      throw new Error('[volt] A Signal.Computed must not write to a Signal.State.');
    }
    if (this.equals(this.value, value)) return;

    this.value = value;
    this.version++;

    if (this.sinks === null || this.sinks.size === 0) return;

    const pending = new Set<WatcherNode>();
    propagate(this as Producer, true, pending);

    // Notify runs after colouring is complete, so a watcher never observes a
    // partially-coloured graph.
    for (const watcher of pending) {
      watcher.notified = true;
      watcher.notifyCallback.call(watcher);
    }
  }
}

// ---------------------------------------------------------------------------
// Signal.Computed
// ---------------------------------------------------------------------------

const UNSET = Symbol('unset');

export class ComputedSignal<T> {
  /** @internal */ value: T | typeof UNSET = UNSET;
  /** @internal */ error: unknown = UNSET;
  /** @internal */ version = 0;
  /** @internal */ state: NodeState = DIRTY;
  /** @internal */ sinks: Set<Consumer> | null = null;
  /** @internal */ sources: Producer[] = [];
  /** @internal */ sourceVersions: number[] = [];
  /** @internal */ liveCount = 0;
  /** @internal */ options: SignalOptions<T> | undefined;
  /** @internal */ computing = false;
  /** @internal */ readonly fn: (this: ComputedSignal<T>) => T;
  /** @internal */ readonly equals: (a: T, b: T) => boolean;

  constructor(fn: (this: ComputedSignal<T>) => T, options?: SignalOptions<T>) {
    this.fn = fn;
    this.options = options;
    this.equals = options?.equals
      ? (a, b) => options.equals!.call(this as AnySignal<T>, a, b)
      : defaultEquals;
  }

  get(): T {
    if (this.computing) {
      throw new Error('[volt] Cycle detected: a Signal.Computed read itself.');
    }

    this.settle();
    track(this as Producer);

    if (this.error !== UNSET) throw this.error;
    return this.value as T;
  }

  /** @internal Bring this node up to date without subscribing the reader. */
  settle(): void {
    if (this.state === CLEAN) return;

    if (this.state === CHECK) {
      // Only recompute if a source genuinely produced a new value.
      for (let i = 0; i < this.sources.length; i++) {
        const source = this.sources[i]!;
        if (source instanceof ComputedSignal) source.settle();
        if (source.version !== this.sourceVersions[i]) {
          this.state = DIRTY;
          break;
        }
      }
      if (this.state === CHECK) {
        this.state = CLEAN;
        return;
      }
    }

    this.recompute();
  }

  private recompute(): void {
    // Releases liveness held on the old dependency set; `track` re-acquires it
    // for whatever this run actually reads.
    unlinkSources(this as ComputedSignal<unknown>);

    const prevConsumer = currentConsumer;
    const prevTracking = tracking;
    currentConsumer = this as Consumer;
    tracking = true;
    this.computing = true;

    let nextValue: T | typeof UNSET = UNSET;
    let nextError: unknown = UNSET;
    try {
      nextValue = this.fn.call(this);
    } catch (err) {
      // The proposal caches thrown errors exactly like values.
      nextError = err;
    } finally {
      this.computing = false;
      currentConsumer = prevConsumer;
      tracking = prevTracking;
    }

    const changed =
      nextError !== UNSET ||
      this.error !== UNSET ||
      this.value === UNSET ||
      !this.equals(this.value as T, nextValue as T);

    if (changed) this.version++;

    this.value = nextValue;
    this.error = nextError;
    this.state = CLEAN;
  }
}

// ---------------------------------------------------------------------------
// Signal.subtle.Watcher
// ---------------------------------------------------------------------------

export class WatcherNode {
  /** @internal */ readonly notifyCallback: (this: WatcherNode) => void;
  /** @internal */ sources: Producer[] = [];
  /** @internal */ sourceVersions: number[] = [];
  /** @internal */ liveCount = 1;
  /** @internal */ notified = false;
  /** @internal */ watching = new Set<Producer>();
  /** @internal */ pending = new Set<Producer>();

  constructor(notify: (this: WatcherNode) => void) {
    this.notifyCallback = notify;
  }

  /**
   * Observe signals. Calling with no arguments re-arms the watcher so its
   * notify callback can fire again — the pattern the proposal's own scheduler
   * example uses after draining `getPending()`.
   */
  watch(...signals: (StateSignal<unknown> | ComputedSignal<unknown>)[]): void {
    for (const signal of signals) {
      const producer = signal as Producer;
      if (this.watching.has(producer)) continue;
      this.watching.add(producer);
      (producer.sinks ??= new Set()).add(this as Consumer);
      this.sources.push(producer);
      incrementLive(producer);
    }
    this.notified = false;
  }

  unwatch(...signals: (StateSignal<unknown> | ComputedSignal<unknown>)[]): void {
    for (const signal of signals) {
      const producer = signal as Producer;
      if (!this.watching.has(producer)) continue;
      this.watching.delete(producer);
      this.pending.delete(producer);
      producer.sinks?.delete(this as Consumer);
      const index = this.sources.indexOf(producer);
      if (index !== -1) this.sources.splice(index, 1);
      decrementLive(producer);
    }
  }

  /**
   * The watched signals that are currently out of date.
   *
   * Reads from the set maintained during propagation, and drops entries that
   * have since settled — so this costs what changed, not what is watched.
   */
  getPending(): ComputedSignal<unknown>[] {
    if (this.pending.size === 0) return [];

    const out: ComputedSignal<unknown>[] = [];
    for (const source of this.pending) {
      if (source instanceof ComputedSignal && source.state !== CLEAN) out.push(source);
      else this.pending.delete(source);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Signal.subtle helpers
// ---------------------------------------------------------------------------

export function untrack<T>(cb: () => T): T {
  const prevConsumer = currentConsumer;
  const prevTracking = tracking;
  currentConsumer = null;
  tracking = false;
  try {
    return cb();
  } finally {
    currentConsumer = prevConsumer;
    tracking = prevTracking;
  }
}

export function currentComputed(): ComputedSignal<unknown> | null {
  return currentConsumer instanceof ComputedSignal ? currentConsumer : null;
}

export function introspectSources(
  node: ComputedSignal<unknown> | WatcherNode,
): (StateSignal<unknown> | ComputedSignal<unknown>)[] {
  return [...node.sources];
}

export function introspectSinks(
  node: StateSignal<unknown> | ComputedSignal<unknown>,
): (ComputedSignal<unknown> | WatcherNode)[] {
  return node.sinks ? [...node.sinks] : [];
}

export function hasSinks(node: StateSignal<unknown> | ComputedSignal<unknown>): boolean {
  return (node.sinks?.size ?? 0) > 0;
}

export function hasSources(node: ComputedSignal<unknown> | WatcherNode): boolean {
  return node.sources.length > 0;
}

export function isSignal(value: unknown): value is StateSignal<unknown> | ComputedSignal<unknown> {
  return value instanceof StateSignal || value instanceof ComputedSignal;
}

export function isWritableSignal(value: unknown): value is StateSignal<unknown> {
  return value instanceof StateSignal;
}

export { CLEAN, CHECK, DIRTY };
