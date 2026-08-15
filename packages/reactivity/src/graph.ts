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
 * Mark a computed as an effect, exempting it from the no-writes-in-a-computed
 * rule. Effects are implemented as computeds, as the proposal's own example
 * does; user computeds are never marked.
 *
 * A flag on the node rather than a side table, because the rule is checked on
 * every write and a keyed list writes two signals per row on every reconcile
 * — a hash lookup here would run thousands of times per update.
 */
export function markEffectComputed(node: ComputedSignal<unknown>): void {
  node.isEffect = true;
}

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

/**
 * Invoke a `watched`/`unwatched` hook with the signal as `this`.
 *
 * A signal is "live" while a Watcher can reach it, and liveness propagates up
 * through computed sources, so these fire exactly on the transitions in and
 * out of observation — which is what lets a signal attach and release an
 * external resource.
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

/**
 * Record that the running computed read `producer`.
 *
 * Dependencies are almost always identical from one run to the next, so this
 * walks a cursor through the previous run's list: a source that matches in
 * position needs no work at all. Only where the sets genuinely diverge is the
 * tail released and rebuilt. Without this, every re-run costs a hash delete
 * and a hash insert per edge — multiplied by a thousand rows for something as
 * ordinary as toggling a selection.
 */
function track(producer: Producer): void {
  if (!tracking || currentConsumer === null) return;
  const consumer = currentConsumer;
  if (!(consumer instanceof ComputedSignal)) return;

  const index = consumer.trackIndex;

  if (consumer.sources[index] === producer) {
    // Same dependency in the same position — the edge is already in place.
    consumer.sourceVersions[index] = producer.version;
    consumer.trackIndex = index + 1;
    return;
  }

  // Diverged from the previous run: release the rest, then append. Liveness
  // is counted per edge, so it travels with the link.
  if (index < consumer.sources.length) releaseSourcesFrom(consumer, index);

  link(producer, consumer as Consumer);
  if (consumer.liveCount > 0) incrementLive(producer);
  consumer.trackIndex = index + 1;
}

/**
 * Record a dependency edge in both directions.
 *
 * Each side stores the other's index, which is what makes removal O(1)
 * without hashing: a set would have to hash the consumer on every unlink, and
 * teardown unlinks every edge in the tree.
 */
function link(producer: Producer, consumer: Consumer): void {
  const sinkIndex = producer.sinks ? producer.sinks.length : 0;
  const sourceIndex = consumer.sources.length;

  (producer.sinks ??= []).push(consumer);
  (producer.sinkSlots ??= []).push(sourceIndex);

  consumer.sources.push(producer);
  consumer.sourceVersions.push(producer.version);
  consumer.sourceSlots.push(sinkIndex);
}

/**
 * Remove one edge by swapping the last sink into the hole it leaves.
 *
 * The moved sink's back-pointer has to be corrected, which is the whole
 * reason both indices are kept.
 */
function unlinkEdge(consumer: Consumer, index: number): void {
  const source = consumer.sources[index]!;
  const sinks = source.sinks;
  if (!sinks) return;

  const slot = consumer.sourceSlots[index]!;
  const slots = source.sinkSlots!;

  const lastSink = sinks.pop()!;
  const lastSlot = slots.pop()!;

  if (slot < sinks.length) {
    sinks[slot] = lastSink;
    slots[slot] = lastSlot;
    // The sink that moved now sits at `slot`; tell it where it went.
    lastSink.sourceSlots[lastSlot] = slot;
  }
}

/** Unlink every source from `index` onward. */
function releaseSourcesFrom(consumer: ComputedSignal<unknown>, index: number): void {
  const wasLive = consumer.liveCount > 0;
  for (let i = index; i < consumer.sources.length; i++) {
    unlinkEdge(consumer, i);
    if (wasLive) decrementLive(consumer.sources[i]!);
  }
  consumer.sources.length = index;
  consumer.sourceVersions.length = index;
  consumer.sourceSlots.length = index;
}

/**
 * Detach a computed from the graph for good.
 *
 * Unwatching an effect stops it being scheduled, but its computed stays in
 * every source's sink set — so a long-lived signal accumulates dead nodes,
 * propagation walks them on every write, and nothing is collectable. Effects
 * must call this when they are disposed.
 */
export function disposeComputed(node: ComputedSignal<unknown>): void {
  unlinkSources(node);
  node.state = CLEAN;
  node.sinks = null;
  node.sinkSlots = null;
}

function unlinkSources(consumer: ComputedSignal<unknown>): void {
  releaseSourcesFrom(consumer, 0);
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
/**
 * Colour the graph downstream of a write, collecting watchers to notify.
 *
 * The set is allocated per write and deliberately so. Hoisting it to module
 * scope to avoid the allocation measured *slower*: it never escapes `set`, so
 * V8 already elides it, and the bookkeeping needed to make a shared buffer
 * re-entrant cost more than the allocation it saved.
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
  /** @internal */ sinks: Consumer[] | null = null;
  /** @internal Index of this producer inside each sink's `sources`. */
  /** @internal */ sinkSlots: number[] | null = null;
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
    if (currentConsumer instanceof ComputedSignal && !currentConsumer.isEffect) {
      throw new Error('[volt] A Signal.Computed must not write to a Signal.State.');
    }
    if (this.equals(this.value, value)) return;

    this.value = value;
    this.version++;

    if (this.sinks === null || this.sinks.length === 0) return;

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
  /** @internal */ sinks: Consumer[] | null = null;
  /** @internal */ sinkSlots: number[] | null = null;
  /** @internal */ sources: Producer[] = [];
  /** @internal */ sourceVersions: number[] = [];
  /** @internal Index of this consumer inside each source's `sinks`. */
  /** @internal */ sourceSlots: number[] = [];
  /** @internal */ trackIndex = 0;
  /** @internal */ liveCount = 0;
  /** @internal */ options: SignalOptions<T> | undefined;
  /** @internal */ computing = false;
  /** @internal Exempt from the "a computed must not write" rule. */
  /** @internal */ isEffect = false;
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
    // Edges are kept and re-walked by `track`, which only does work where the
    // dependency set actually differs from the previous run.
    this.trackIndex = 0;

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

    // An effect produces no value: it is compared with `equals: () => false`,
    // and the only thing linked to it is the watcher that schedules it, which
    // never reads a value or a version. Running the comparison and storing the
    // result is pure overhead on the framework's hottest path — one write to a
    // shared signal re-runs an effect per row.
    if (this.isEffect) {
      this.version++;
      if (this.trackIndex < this.sources.length) {
        releaseSourcesFrom(this as ComputedSignal<unknown>, this.trackIndex);
      }
      this.error = nextError;
      this.state = CLEAN;
      return;
    }

    const changed =
      nextError !== UNSET ||
      this.error !== UNSET ||
      this.value === UNSET ||
      !this.equals(this.value as T, nextValue as T);

    if (changed) this.version++;

    // Anything the previous run read and this one did not is now stale.
    if (this.trackIndex < this.sources.length) {
      releaseSourcesFrom(this as ComputedSignal<unknown>, this.trackIndex);
    }

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
  /** @internal */ sourceSlots: number[] = [];
  /** @internal */ liveCount = 1;
  /** @internal */ notified = false;
  /**
   * Watched producers, mapped to their index in `sources`.
   *
   * A set would do for membership, but `unwatch` also has to find the source
   * to unlink. Searching for it made dropping N watched signals one at a time
   * quadratic — which is what a keyed list does every time it clears, since
   * every render effect in the app is watched by one shared watcher.
   *
   * @internal
   */
  watching = new Map<Producer, number>();
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
      // `link` appends, so the index it will land at is the current length.
      this.watching.set(producer, this.sources.length);
      link(producer, this as Consumer);
      incrementLive(producer);
    }
    this.notified = false;
  }

  unwatch(...signals: (StateSignal<unknown> | ComputedSignal<unknown>)[]): void {
    for (const signal of signals) {
      const producer = signal as Producer;
      const index = this.watching.get(producer);
      if (index === undefined) continue;
      this.watching.delete(producer);
      this.pending.delete(producer);

      unlinkEdge(this as Consumer, index);

      // Order among sources carries no meaning, so the last one fills the hole
      // rather than shifting everything after it. It has to be told where it
      // landed, both here and in the back-reference its producer holds.
      const last = this.sources.length - 1;
      if (index < last) {
        const moved = this.sources[last]!;
        const movedSlot = this.sourceSlots[last]!;
        this.sources[index] = moved;
        this.sourceVersions[index] = this.sourceVersions[last]!;
        this.sourceSlots[index] = movedSlot;
        moved.sinkSlots![movedSlot] = index;
        this.watching.set(moved, index);
      }
      this.sources.pop();
      this.sourceVersions.pop();
      this.sourceSlots.pop();

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
  return (node.sinks?.length ?? 0) > 0;
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
