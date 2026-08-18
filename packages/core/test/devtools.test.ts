/**
 * The developer-tools instrumentation.
 *
 * Four things have to be true and none of them can be taken on trust: the
 * hooks describe a component that is actually on screen, "why did this update"
 * names the write that really woke the effect rather than the most recent
 * write anywhere, the numbers under "what did it cost" are measurements rather
 * than shapes, and a production build contains none of it. The last one is
 * asserted against built bytes — the claim is about what ships, so reading the
 * source would prove nothing.
 *
 * Where a number is asserted it is asserted exactly, against a stubbed clock
 * where the real one would make that flaky. A bound a constant satisfies —
 * `durationMs >= 0`, `runs >= 2` — is not a measurement of anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Prop,
  Signal,
  createRequestScope,
  effect,
  flushSync,
  measureEffect,
  mount,
  settleRequest,
} from '@voltdev/core';
// Not re-exported by the framework entry, because an application disposes a
// scope by unmounting or by the root that made it. A panel is handed the scope
// itself, which is what the test below is about.
import { disposeScope } from '@voltdev/reactivity';
import {
  devtools,
  type ComponentNode,
  type SignalNode,
  type UpdateRecord,
} from '@voltdev/core/devtools';

const tools = devtools();

@Component({ selector: 'v-badge', render: compileTemplate(`<em>{ text.get() }</em>`) })
class Badge {
  // Aliased deliberately: a prop whose alias equalled its property name could
  // not tell a tree keyed by the template-facing name from one keyed by the
  // field, which is the distinction `props` claims to make.
  @Prop({ alias: 'caption' }) text = new Signal.State('none');
}

@Component({
  selector: 'v-counter',
  imports: [Badge],
  render: compileTemplate(
    `<div><span>{ doubled.get() }</span><v-badge :caption="label.get()"></v-badge></div>`,
  ),
})
class Counter {
  count = new Signal.State(2);
  doubled = new Signal.Computed(() => this.count.get() * 2);
  label = new Signal.State('hi');
}

let host: HTMLElement;
let unmount: (() => void) | null = null;
let counter: Counter;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  tools.stopRecording();
  tools.reset();
});

afterEach(() => {
  unmount?.();
  unmount = null;
});

function mountCounter(): Counter {
  const handle = mount(Counter, host);
  unmount = handle.unmount;
  counter = handle.instance as Counter;
  return counter;
}

function find(nodes: ComponentNode[], name: string): ComponentNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const inner = find(node.children, name);
    if (inner) return inner;
  }
  return undefined;
}

function labelled(nodes: SignalNode[], label: string): SignalNode {
  const node = nodes.find((candidate) => candidate.label === label);
  if (!node) {
    throw new Error(`no signal labelled ${label}, only ${nodes.map((n) => n.label).join(', ')}`);
  }
  return node;
}

/** The writers a record blames, named as a panel would name them. */
function named(update: UpdateRecord): string[] {
  return update.causes.map((cause) => tools.labelOf(cause.signal));
}

describe('the object an extension reaches', () => {
  it('is published under the name the documentation gives', () => {
    expect((globalThis as Record<string, unknown>)['__VOLT_DEVTOOLS__']).toBe(tools);
  });

  it('carries a version an extension can check its assumptions against', () => {
    expect(Number.isInteger(tools.version)).toBe(true);
    expect(tools.version).toBeGreaterThanOrEqual(1);
  });
});

describe('component tree', () => {
  it('reports instances, their props and their scopes', () => {
    const instance = mountCounter();

    const root = find(tools.componentTree(), 'Counter');
    expect(root).toBeDefined();
    expect(root!.selector).toBe('v-counter');
    expect(root!.instance).toBe(instance);
    expect(root!.scope).not.toBeNull();

    const badge = find([root!], 'Badge');
    expect(badge).toBeDefined();
    // The prop is shown by its template-facing name — `caption`, not the
    // `text` field behind it — and unwrapped: what the parent passed down,
    // not the signal object holding it.
    expect(badge!.props).toEqual({ caption: 'hi' });
  });

  it('hands back the scope that owns the instance, not some other scope', () => {
    mountCounter();
    const span = host.querySelector('span')!;
    expect(span.textContent).toBe('4');

    // The documented use of the field: disposing this is what unmounts the
    // component. So the bindings stop, and the tree forgets it.
    disposeScope(find(tools.componentTree(), 'Counter')!.scope!);
    unmount = null;

    counter.count.set(50);
    flushSync();
    expect(span.textContent).toBe('4');
    expect(find(tools.componentTree(), 'Counter')).toBeUndefined();
  });

  it('follows a prop as it changes', () => {
    mountCounter();
    counter.label.set('bye');
    flushSync();

    expect(find(tools.componentTree(), 'Badge')!.props['caption']).toBe('bye');
  });

  it('finds the node for an instance a panel is holding', () => {
    const instance = mountCounter();
    const node = tools.componentFor(instance);
    expect(node!.name).toBe('Counter');
    expect(node!.instance).toBe(instance);
    expect(tools.componentFor({})).toBeNull();

    unmount!();
    unmount = null;
    expect(tools.componentFor(instance)).toBeNull();
  });

  it('forgets a component once its scope is disposed', () => {
    mountCounter();
    expect(find(tools.componentTree(), 'Counter')).toBeDefined();

    unmount!();
    unmount = null;
    expect(find(tools.componentTree(), 'Counter')).toBeUndefined();
    expect(find(tools.componentTree(), 'Badge')).toBeUndefined();
  });
});

describe('signal graph', () => {
  it('reports the nodes and edges reachable from a component', () => {
    mountCounter();
    const graph = tools.signalGraph(counter);

    const count = labelled(graph, 'Counter.count');
    const doubled = labelled(graph, 'Counter.doubled');

    expect(count.kind).toBe('state');
    expect(count.value).toBe(2);
    expect(doubled.kind).toBe('computed');
    expect(doubled.value).toBe(4);

    // The edge the derivation is made of, in both directions.
    expect(doubled.sources).toContain(count.id);
    expect(count.sinks).toContain(doubled.id);

    // Live, in the sense the roadmap asks for: something is watching.
    expect(count.observed).toBe(true);
    expect(count.observing).toBe(false);
    expect(doubled.observed).toBe(true);
    expect(doubled.observing).toBe(true);

    // The binding that renders it is an effect, not a computed, and it reads
    // the derived value rather than the state.
    const binding = graph.find(
      (node) => node.kind === 'effect' && node.sources.includes(doubled.id),
    );
    expect(binding).toBeDefined();
    expect(binding!.value).toBeUndefined();
    expect(doubled.sinks).toContain(binding!.id);
  });

  it('marks a signal nothing depends on as unobserved, and again once it is dropped', () => {
    const lonely = new Signal.State(1);
    tools.label(lonely, 'lonely');
    const observed = (): boolean => labelled(tools.signalGraph(lonely), 'lonely').observed;

    expect(observed()).toBe(false);
    const dispose = effect(() => {
      lonely.get();
    });
    flushSync();
    expect(observed()).toBe(true);

    // `observed` is what is live now, not what was ever read.
    dispose();
    flushSync();
    expect(observed()).toBe(false);
  });

  it('re-reads values rather than caching them', () => {
    mountCounter();
    counter.count.set(21);
    flushSync();

    const graph = tools.signalGraph(counter);
    expect(labelled(graph, 'Counter.count').value).toBe(21);
    expect(labelled(graph, 'Counter.doubled').value).toBe(42);
  });

  it('crosses a component boundary', () => {
    mountCounter();
    const graph = tools.signalGraph(counter);
    // The child's prop is named after the child that declares it, and is
    // reachable from the parent because a render effect writes it.
    expect(graph.some((node) => node.label === 'Badge.text')).toBe(true);
  });

  it('walks every mounted component when given no seed', () => {
    mountCounter();
    const loose = new Signal.State(1);
    tools.label(loose, 'loose');

    const everything = tools.signalGraph().map((node) => node.label);
    expect(everything).toContain('Counter.count');
    expect(everything).toContain('Badge.text');

    // Every signal a registered component holds, which is not every signal:
    // one nothing has read and no component declares is reachable from
    // nowhere, and is found only by seeding the walk with it.
    expect(everything).not.toContain('loose');
    expect(tools.signalGraph(loose).map((node) => node.label)).toEqual(['loose']);
  });
});

describe('why did this update', () => {
  it('names the write that woke each effect, not the last write anywhere', () => {
    mountCounter();
    tools.startRecording();

    // Two writes, one flush. If the cause were global state rather than
    // per-effect, both effects would name whichever was written last.
    counter.count.set(3);
    counter.label.set('bye');
    flushSync();

    const updates = tools.updates();
    const fromCount = updates.filter((u) => named(u).includes('Counter.count'));
    const fromLabel = updates.filter((u) => named(u).includes('Counter.label'));

    expect(fromCount).toHaveLength(1);
    expect(fromLabel).toHaveLength(1);
    expect(named(fromCount[0]!)).toEqual(['Counter.count']);
    expect(named(fromLabel[0]!)).toEqual(['Counter.label']);

    const cause = fromCount[0]!.causes[0]!;
    expect(cause.previous).toBe(2);
    expect(cause.value).toBe(3);
    expect(tools.describeUpdate(fromCount[0]!)).toContain('Counter.count 2 → 3');
    expect(fromCount[0]!.phase).toBe('render');
  });

  it('collects every write that woke a run, and starts the next run empty', () => {
    const first = new Signal.State(0);
    const second = new Signal.State(0);
    tools.label(first, 'first');
    tools.label(second, 'second');
    const dispose = effect(() => {
      first.get();
      second.get();
    });
    flushSync();
    tools.startRecording();

    // Both writes land before the effect runs. The second one reaches an
    // effect that is already dirty, which is precisely the case a wake
    // recorded after the colour check would drop.
    first.set(1);
    second.set(1);
    flushSync();
    expect(named(tools.updates().at(-1)!)).toEqual(['first', 'second']);

    // The run has accounted for them; they must not be blamed again.
    second.set(2);
    flushSync();
    expect(named(tools.updates().at(-1)!)).toEqual(['second']);
    dispose();
  });

  it('keeps the newest causes rather than every cause', () => {
    const signals = Array.from({ length: 12 }, () => new Signal.State(0));
    signals.forEach((signal, index) => tools.label(signal, `s${index}`));
    const dispose = effect(() => {
      for (const signal of signals) signal.get();
    });
    flushSync();
    tools.startRecording();

    for (const signal of signals) signal.set(1);
    flushSync();

    // Bounded, because the list is kept whether or not a session is running:
    // an effect nothing has re-run yet would otherwise hold every value ever
    // aimed at it alive.
    expect(named(tools.updates().at(-1)!)).toEqual(['s4', 's5', 's6', 's7', 's8', 's9', 's10', 's11']);
    dispose();
  });

  it('reports how the write reached the effect', () => {
    mountCounter();
    tools.startRecording();
    counter.count.set(4);
    flushSync();

    const graph = tools.signalGraph(counter);
    const update = tools.updates().find((u) => named(u).includes('Counter.count'))!;

    // Written signal first, then what relayed it: the computed in between.
    expect(update.through).toEqual([
      labelled(graph, 'Counter.count').id,
      labelled(graph, 'Counter.doubled').id,
    ]);
  });

  it('reports the written signal alone when the effect read it directly', () => {
    mountCounter();
    tools.startRecording();
    counter.label.set('bye');
    flushSync();

    const graph = tools.signalGraph(counter);
    const update = tools.updates().find((u) => named(u).includes('Counter.label'))!;
    expect(update.through).toEqual([labelled(graph, 'Counter.label').id]);
  });

  it('follows a write across a component boundary', () => {
    mountCounter();
    tools.startRecording();
    counter.label.set('done');
    flushSync();

    // The parent's binding writes the child's prop, which wakes the child's
    // own binding — a second update naming a different writer.
    const causes = tools.updates().map((u) => named(u).join());
    expect(causes).toContain('Counter.label');
    expect(causes).toContain('Badge.text');
  });

  it('says so when nothing woke the effect', () => {
    tools.startRecording();
    const dispose = effect(() => {});
    flushSync();

    const first = tools.updates().at(-1)!;
    expect(first.causes).toEqual([]);
    expect(first.through).toEqual([]);
    expect(tools.describeUpdate(first)).toContain('ran for the first time');
    dispose();
  });

  it('hands each record to a subscriber as it happens', () => {
    mountCounter();
    const seen: string[] = [];
    const stop = tools.subscribe((update) => {
      const cause = update.causes[0];
      seen.push(cause ? tools.labelOf(cause.signal) : 'none');
    });
    tools.startRecording();

    counter.count.set(9);
    flushSync();
    stop();
    const after = seen.length;
    counter.count.set(10);
    flushSync();

    expect(seen).toContain('Counter.count');
    expect(seen).toHaveLength(after);
  });

  it('keeps only the last records a session asked for', () => {
    const value = new Signal.State(0);
    const dispose = effect(() => {
      value.get();
    });
    flushSync();
    tools.startRecording({ limit: 2 });

    for (let i = 1; i <= 4; i++) {
      value.set(i);
      flushSync();
    }

    const updates = tools.updates();
    expect(updates).toHaveLength(2);
    expect(updates.map((update) => update.causes[0]!.value)).toEqual([3, 4]);
    dispose();
  });

  it('captures where a write came from only when a session asks for stacks', () => {
    const value = new Signal.State(0);
    const dispose = effect(() => {
      value.get();
    });
    flushSync();

    tools.startRecording();
    value.set(1);
    flushSync();
    expect(tools.updates().at(-1)!.causes[0]!.stack).toBeUndefined();

    tools.startRecording({ stacks: true });
    value.set(2);
    flushSync();
    const stack = tools.updates().at(-1)!.causes[0]!.stack;
    expect(stack).toBeTypeOf('string');
    expect(stack!.length).toBeGreaterThan(0);
    // The caller's frames, with the framework's own removed from the top.
    expect(stack).not.toContain('graph.');
    dispose();
  });

  it('does not blame a write from an earlier turn', () => {
    const first = new Signal.State(0);
    const second = new Signal.State(0);
    tools.label(first, 'first');
    tools.label(second, 'second');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dispose = effect(() => {
      first.get();
      if (second.get() > 0) throw new Error('boom');
    });
    flushSync();
    first.set(1);
    flushSync();
    second.set(1);
    flushSync();

    const message = String(spy.mock.calls[0]?.[0]);
    expect(message).toContain('woken by second (0 → 1)');
    expect(message).not.toContain('first');
    spy.mockRestore();
    dispose();
  });

  it('names the writer in the message when an effect throws', () => {
    const trigger = new Signal.State(false);
    tools.label(trigger, 'trigger');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dispose = effect(() => {
      if (trigger.get()) throw new Error('boom');
    });
    flushSync();
    trigger.set(true);
    flushSync();

    expect(spy.mock.calls[0]?.[0]).toContain('woken by trigger (false → true)');
    spy.mockRestore();
    dispose();
  });

  it('blames only the write that woke the effect that threw', () => {
    const quiet = new Signal.State(0);
    const loud = new Signal.State(0);
    tools.label(quiet, 'quiet');
    tools.label(loud, 'loud');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bystander = effect(() => {
      quiet.get();
    });
    const thrower = effect(() => {
      if (loud.get() > 0) throw new Error('boom');
    });
    flushSync();

    // One turn, two effects, two writes. Attribution that was per-turn rather
    // than per-effect would name the bystander's write here too.
    loud.set(1);
    quiet.set(1);
    flushSync();

    const message = String(spy.mock.calls[0]?.[0]);
    expect(message).toContain('woken by loud (0 → 1)');
    expect(message).not.toContain('quiet');
    spy.mockRestore();
    bystander();
    thrower();
  });
});

describe('performance', () => {
  it('counts each effect run and attributes it to the component that declared it', () => {
    // Mounted first, recording second — the order an extension opened after
    // the page loaded is stuck with, and the one that used to report `null`
    // for every effect that already existed.
    mountCounter();
    tools.startRecording();

    counter.count.set(5);
    flushSync();
    counter.count.set(6);
    flushSync();
    counter.label.set('bye');
    flushSync();

    const stats = tools.effectStats();
    expect(stats.filter((stat) => stat.component === 'Counter').map((stat) => stat.runs)).toEqual([
      2,
    ]);
    // Two, because the binding that writes the prop is built while the child
    // is being constructed: the `:caption` binding and the child's own text.
    expect(stats.filter((stat) => stat.component === 'Badge').map((stat) => stat.runs)).toEqual([
      1, 1,
    ]);
    expect(stats.every((stat) => stat.phase === 'render')).toBe(true);
  });

  it('lists the busiest effect first', () => {
    mountCounter();
    tools.startRecording();

    counter.count.set(5);
    flushSync();
    counter.count.set(6);
    flushSync();
    counter.label.set('bye');
    flushSync();

    const runs = tools.effectStats().map((stat) => stat.runs);
    expect(runs).toEqual([2, 1, 1]);
  });

  it('times each run, and remembers the worst one', () => {
    // A stubbed clock, because the claim is that these are measurements: a
    // real one can only be asserted against a bound, and a bound is what a
    // hard-coded zero satisfies.
    let clock = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const cost = new Signal.State(0);
    const dispose = effect(() => {
      clock += cost.get();
    });
    flushSync();
    tools.startRecording();

    cost.set(5);
    flushSync();
    cost.set(3);
    flushSync();

    const stats = tools.effectStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.runs).toBe(2);
    expect(stats[0]!.lastMs).toBe(3);
    expect(stats[0]!.maxMs).toBe(5);
    expect(stats[0]!.totalMs).toBe(8);

    // A flush is timed the same way, over the runs it drained.
    expect(tools.flushes().map((flush) => flush.durationMs)).toEqual([5, 3]);
    spy.mockRestore();
    dispose();
  });

  it('records what each flush cost', () => {
    mountCounter();
    const measured: number[] = [];
    const dispose = measureEffect(() => {
      measured.push(counter.count.get());
    });
    flushSync();
    tools.startRecording();

    counter.count.set(6);
    flushSync();

    const flushes = tools.flushes();
    expect(flushes).toHaveLength(1);
    // One pass over the render lane and one over the measure lane, and the
    // single layout the measure lane exists to force exactly once.
    expect(flushes[0]!.passes).toBe(2);
    expect(flushes[0]!.forcedLayouts).toBe(1);
    // The binding that renders the count, and the measure effect reading it.
    expect(flushes[0]!.effects).toBe(2);
    dispose();
  });

  it('collects nothing until asked', () => {
    mountCounter();
    counter.count.set(7);
    flushSync();

    expect(tools.updates()).toEqual([]);
    expect(tools.flushes()).toEqual([]);
    expect(tools.effectStats()).toEqual([]);
  });
});

/**
 * A server renders many pages in one process, and nothing disposes a request's
 * scopes: the request is dropped whole. Instrumentation kept in module scope
 * would therefore hand every request the last one's instances, props and
 * scopes — alive, and readable.
 */
describe('server rendering', () => {
  function serverBuild(on: boolean): void {
    (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
  }

  beforeEach(() => {
    serverBuild(true);
  });

  afterEach(() => {
    serverBuild(false);
  });

  it('keeps one request out of the next', async () => {
    const perRequest: number[] = [];

    for (let i = 0; i < 3; i++) {
      const scope = createRequestScope();
      const into = document.createElement('div');
      await settleRequest(scope, () => {
        mount(Counter, into);
        perRequest.push(find(tools.componentTree(), 'Counter') ? 1 : 0);
        perRequest.push(tools.componentTree().length);
      });
    }

    // Each request saw its own component, and only its own.
    expect(perRequest).toEqual([1, 1, 1, 1, 1, 1]);
    expect(find(tools.componentTree(), 'Counter')).toBeUndefined();
    expect(tools.signalGraph().filter((node) => node.label.startsWith('Counter.'))).toEqual([]);
  });
});

/**
 * The whole point of `__VOLT_DEV__`: none of the above reaches an application.
 *
 * Bundled the way an application is — the plugin defines the flag false for a
 * production build, and a minifier drops the branches — then read back. The
 * dev bundle is built the same way as a control, so a marker that stopped
 * meaning anything fails the test rather than passing it silently.
 */
describe('production build', () => {
  const root = resolve(import.meta.dirname, '../../..');

  const fromSource = {
    '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/src/signals.ts'),
    '@voltdev/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
    '@voltdev/compiler': resolve(root, 'packages/compiler/src/index.ts'),
    '@voltdev/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
    '@voltdev/core': resolve(root, 'packages/core/src/index.ts'),
  };

  /** What an installed dependency resolves to: the built package, not `src`. */
  const fromPackage = {
    '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/dist/signals.js'),
    '@voltdev/reactivity': resolve(root, 'packages/reactivity/dist/index.js'),
    '@voltdev/core': resolve(root, 'packages/core/dist/index.js'),
  };

  /** An application entry, bundled and minified the way one is shipped. */
  async function bundle(dev: boolean, alias: Record<string, string>): Promise<string> {
    const result = await build({
      stdin: {
        contents:
          "import { mount, effect, renderEffect, Signal, flushSync } from '@voltdev/core';\n" +
          'globalThis.app = { mount, effect, renderEffect, Signal, flushSync };',
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'esnext',
      minify: true,
      alias,
      define: { __VOLT_DEV__: String(dev), __VOLT_SERVER__: 'false' },
    });
    return result.outputFiles[0]!.text;
  }

  // Property names and string literals, which minification keeps. Local names
  // are mangled, so asserting on those would pass for the wrong reason.
  const markers = [
    // The tools themselves.
    '__VOLT_DEVTOOLS__',
    'componentTree',
    'signalGraph',
    'effectStats',
    'describeUpdate',
    'startRecording',
    'woken by',
    // The seam in the reactive core they attach to.
    'flushStarted',
    'flushEnded',
    'runStarted',
    'runEnded',
    'effectCreated',
    'effectDisposed',
    'explain',
  ];

  it('carries none of the instrumentation', async () => {
    const [production, development] = await Promise.all([
      bundle(false, fromSource),
      bundle(true, fromSource),
    ]);

    expect(markers.filter((marker) => development.includes(marker))).toEqual(markers);
    expect(markers.filter((marker) => production.includes(marker))).toEqual([]);
    expect(production.length).toBeLessThan(development.length);
  }, 30_000);

  /**
   * The same claim about the bytes an application installs rather than the
   * source it never sees. The published bundle keeps `if (__VOLT_DEV__)
   * install()` and a real import of the module beside it, so dropping both
   * rests on the consumer's define plus `sideEffects: false` in the manifest —
   * a path the assertion above does not travel.
   */
  it('carries none of it out of the published package either', async () => {
    const entry = resolve(root, 'packages/core/dist/index.js');
    if (!existsSync(entry)) {
      // `pnpm build` has not run; nothing to read rather than a failure.
      expect(existsSync(entry)).toBe(false);
      return;
    }

    const [production, development] = await Promise.all([
      bundle(false, fromPackage),
      bundle(true, fromPackage),
    ]);

    expect(markers.filter((marker) => development.includes(marker))).toEqual(markers);
    expect(markers.filter((marker) => production.includes(marker))).toEqual([]);
  }, 30_000);
});
