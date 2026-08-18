# Developer tools

Volt ships the instrumentation a devtools panel is built on, not the panel.
It answers four questions about a running application:

- **What is mounted?** — the component tree, with props and scopes
- **What depends on what?** — the signal graph, with the live edges marked
- **Why did this update?** — which write woke which effect
- **What did it cost?** — effect run counts, durations and flush timings

All of it lives behind `__VOLT_DEV__`, so a production build contains none of
it: the call sites go, then the module they call, then the listener it
installs. That is asserted on built bytes in
`packages/core/test/devtools.test.ts`, not assumed.

## Reaching it

```ts
import { devtools } from '@voltdev/core/devtools';

const tools = devtools();
```

The tools attach themselves as soon as `@voltdev/core` is loaded, so an
extension with no access to the application's modules can reach the same
object at `globalThis.__VOLT_DEVTOOLS__`. Its `version` field is bumped
whenever a field below changes meaning.

## Component tree

```ts
tools.componentTree(); // ComponentNode[] — the mounted roots
tools.componentFor(instance); // ComponentNode | null
```

| Field | Description |
|---|---|
| `name` | The class name, as written |
| `selector` | The tag it answers to in a template |
| `instance` | The live instance |
| `scope` | The scope that owns it — disposing this is what unmounts it |
| `props` | Declared props by their template-facing name, signals unwrapped |
| `children` | Components rendered inside it |

`props` is read when you ask, not recorded when the component mounted, so it
always shows what the parent is passing now. A component leaves the tree when
the scope that owns it is disposed.

## Signal graph

```ts
tools.signalGraph(); // every signal every mounted component holds
tools.signalGraph(instance); // seeded from one component
tools.signalGraph(signal); // seeded from one signal
```

The walk starts at the seeds and follows `Signal.subtle.introspectSources` and
`introspectSinks` in both directions, so one signal is enough to reach
everything connected to it.

| Field | Description |
|---|---|
| `id` | Stable for the life of the node; `sources` and `sinks` are ids |
| `kind` | `state`, `computed`, `effect` or `watcher` |
| `label` | `Counter.count` where a component holds it, else `state#7` |
| `observed` | Something depends on this — `Signal.subtle.hasSinks` |
| `observing` | This depends on something — `Signal.subtle.hasSources` |
| `value` | Read untracked. Absent for effects, which have no value |
| `node` | The live node |

Signals are named after the fields that hold them, which covers anything a
component declares. Name the rest yourself:

```ts
tools.label(mySignal, 'session.user');
tools.labelOf(mySignal); // 'session.user'
```

`labelOf` is how a write is named too. A `Write` carries the signal, not a
name: naming builds a string, and a write is on the hot path of every
interaction while reading a record is not.

## Why did this update

Recording is off until you ask for it, because a record per effect run is not
something a development build should pay for unasked.

```ts
tools.startRecording(); // optionally { limit, stacks }
// … interact with the application …
tools.updates();
```

Each `UpdateRecord` is one run of one effect:

| Field | Description |
|---|---|
| `effect`, `effectLabel`, `phase` | Which effect ran, and in which lane |
| `component` | The component it was created under, when known |
| `causes` | The writes that woke it, oldest first — `signal`, `previous`, `value`, `time` |
| `through` | Ids from the written signal down to the effect |
| `durationMs` | How long the run took |

```ts
tools.describeUpdate(update);
// "Counter render effect #12 ran because Counter.count 2 → 3"
```

`causes` is empty for an effect's first run, which nothing woke.

`startRecording({ stacks: true })` also captures a short stack per write —
where the `.set()` came from. It is off by default because it is the only
thing here that costs on the write path rather than on the read.

### The same answer, in an error

Attribution is collected whether or not a session is running, because it is
also what makes a crash report actionable. When an effect throws, the message
names the write that woke it:

```
[volt] Uncaught error in effect — woken by Cart.items (Array(2) → Array(3)): TypeError…
```

A reporter can take the structured form instead, as each update happens, for
as long as a session is recording:

```ts
const stop = tools.subscribe((update) => {
  lastUpdates.push(tools.describeUpdate(update));
});
```

This is deliberately one mechanism rather than two. Fine-grained reactivity
has no re-render to fall back on, so "which write woke this effect" is both
the question a panel exists to answer and the context an error report needs.

## Performance

```ts
tools.effectStats(); // per live effect, most-run first
tools.flushes(); // the last 60 flushes
```

| `EffectStat` | Description |
|---|---|
| `label`, `phase`, `component` | Which effect, and where it came from |
| `runs`, `totalMs`, `lastMs`, `maxMs` | How often, and how long |

| `FlushRecord` | Description |
|---|---|
| `passes` | Passes over the lanes. More than one means an effect wrote a signal |
| `forcedLayouts` | Layouts the flush forced. One is healthy |
| `effects` | Effect runs drained |
| `durationMs` | Wall time |

Durations are inclusive: an effect that builds content charges the effects it
creates to itself. Statistics cover effects that are still alive — a disposed
effect is dropped rather than kept as history, because its record would hold
the closure and the DOM it captured.

`tools.reset()` clears the logs and zeroes the counters. It leaves the
component tree alone, which describes what is on screen rather than what has
happened.
