# Server rendering

There is no `renderToString` yet. What exists is the layer underneath it: the
lane a server flushes, and the scope that keeps one request's state out of the
next one's page. Both are shipped API — `@voltdev/reactivity` re-exported
through `@voltdev/core` — because the primitives already depend on them, and a
resource that fetches on a server has to be reachable before the emitter that
writes the bytes is.

## The build flag

```ts
declare const __VOLT_SERVER__: boolean;
```

Which side of the render this build is, and it decides behaviour rather than
diagnostics:

| When it is `true` | When it is `false` |
|---|---|
| `onMount` is never queued | `onMount` runs after the DOM is in the document |
| A flush stops after the data phase | Measure and user effects run too |
| Nothing self-flushes on a microtask | Updates coalesce onto one, as always |
| `settleRequest` drives the render | `settleRequest` does nothing and says so |

`@voltdev/vite-plugin` defines it per environment: `true` for anything an
environment consumes on the server, `false` for the client, on a dev server as
much as on a build. Without the plugin, define it yourself — a bundler that
leaves the identifier undefined crashes on the first read.

## One request

```ts
import { createRequestScope, mount, requestStyles, runInRequest, settleRequest }
  from '@voltdev/core';

const scope = createRequestScope();
const host = document.createElement('div');

await settleRequest(scope, () => {
  mount(App, host);
});
```

| Function | Description |
|---|---|
| `createRequestScope()` | A `RequestScope`: its own effect queues, state and pending data |
| `settleRequest(scope, build)` | Build and flush inside `scope` until no data is outstanding |
| `runInRequest(scope, fn)` | Run `fn` with `scope` current, and return what it returns |
| `currentRequest()` | The scope a call is running under, or `null` |
| `requestState(key, create)` | A symbol-keyed slot belonging to the current request |
| `clearRequestState(key)` | Forget a slot, so the next read builds it again |
| `trackRequestData(promise)` | Data the request must wait for before it is written out |
| `requestStyles()` | What this request's components declared, by selector |

### `settleRequest`

Enters the scope, runs `build`, and flushes to quiescence; then awaits the data
that flush started and does it again, until a flush asks for nothing. The loop
is not a formality — a resource whose source is another resource's data does
not exist until the first answer lands.

Two things follow from how it waits:

- **Nothing observes a request across an `await`.** The rule is to flush to
  quiescence *before* every await, which holds because Volt's render is
  synchronous by construction. There is no `AsyncLocalStorage` underneath this
  — it is a `node:` builtin, and Volt runs on edge runtimes that have none.
  So `currentRequest()` is null inside a `.then`, and anything that needs to
  know which request it belongs to must read it on the way in.
- **A rejection is the resource's business.** Data is awaited settled, not
  resolved: a fetch that fails has already written its own error state, and
  the page that state renders is still a page.

The loop is bounded at 20 rounds and throws past it. A tree that asks for one
more fetch every time the last one lands would otherwise be a request that
never answers at all.

In a client build the whole body is compiled out, and calling it in
development warns rather than silently rendering nothing.

### `runInRequest`

Synchronous by contract. Handing it a function that awaits puts the request
back where it started while the work carries on inside it, which is the failure
the scope exists to prevent.

It is also how you read what a settled request collected:

```ts
const styles = runInRequest(scope, () =>
  [...requestStyles()]
    .map(([selector, css]) => `<style data-volt="${selector}">${css}</style>`)
    .join(''),
);

return `<!doctype html><html><head>${styles}</head><body>${host.innerHTML}</body></html>`;
```

Styles are collected rather than injected under a request, for two reasons: a
server has no `document` to append to, and the process-global "already
injected" mark a browser relies on would give the first request every
component's styles and every request after it none.

### `requestState`

The mechanism the rest of this is built out of. The key is a symbol, so a slot
belongs to whoever declares it rather than to this module:

```ts
const LOCALE = Symbol('app.locale');

function useRequestLocale(): Signal.State<string> {
  return requestState(LOCALE, () => new Signal.State('en'));
}
```

Created once per request, including when what it holds is `undefined`. With
no request current — a browser — the same call reads a process-wide slot
instead, so nothing in a component has to know which side it is running on.

### `trackRequestData`

What `createResource` calls with the promise it just started, so
`settleRequest` knows to wait for it. Reach for it directly when a component
fetches without a resource. Compiled out of a client build, where a request is
nobody's to wait for: the page renders without the data and updates when it
lands.

## What a server does not run

Measure effects and user effects are not drained on a server, and `onMount` is
never queued — not merely never awaited, since a queued microtask fires at the
first `await` inside the render. Anything that reads geometry or touches a live
document therefore belongs in one of those two, and anything that has to happen
on both sides belongs in a field initializer, a `renderEffect` or a
`dataEffect`.

Module-scope state is per process, not per request. A `Signal.State` at module
scope is shared by every response the process is assembling at once; keep
read-mostly configuration there and nothing else, and put request-derived state
in a component or a `requestState` slot.
