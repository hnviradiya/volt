# Vite plugin

```ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [volt()],
});
```

## Why it is required

The plugin is not a convenience. It does three things nothing else in a
current Vite toolchain does.

**It lowers TC39 standard decorators.** They are stage 3 and implemented by
no JavaScript engine. Vite 8 transforms with oxc, which parses decorators but
emits them untouched, and TypeScript 7 is the native Go port with no
JavaScript transform API. Without this pass, `@Component` reaches the browser
as a syntax error.

Rather than ship a decorator runtime to evaluate them, the plugin *resolves*
them. It already knows every selector and prop name, and `@Component` only
ever ends in a registration call, so it emits that call and deletes the
syntax:

```ts
// what you write
@Component({ selector: 'v-counter', templateUrl: './counter.html' })
export class Counter {
  @Prop() start = new Signal.State(0);
}

// what ships
export class Counter {
  start = new Signal.State(0);
}
defineComponent(Counter, { selector: 'v-counter', render: __volt_render_0 },
  [{ property: 'start' }]);
```

Nothing about authoring changes — the decorators stay in your source, keep
their types, and still work at runtime for anyone without a build step. This
only means the bundle never carries the ~4.6 kB of helpers needed to run them.

A file using decorators Volt does not own falls back to esbuild, which lowers
the whole file the ordinary way. That is always correct, only larger.

**It compiles templates at build time.** `templateUrl` inside a `@Component`
is resolved, read, and compiled into a `render` function with hoisted static
markup, so no compiler ships to the browser and no template is parsed at
runtime. `styleUrl` and `styleUrls` are compiled from Sass the same way. Every file it
reads is registered with the watcher, so editing markup or CSS hot-reloads.

**It lowers the `Signal` namespace to direct imports.** `Signal` is the
spelling the TC39 proposal defines, and `export namespace` compiles to a
runtime object. An object is opaque to a bundler — reaching one property keeps
all of them — so an app that only ever writes `new Signal.State(0)` still
ships `Signal.subtle.Watcher`, `untrack` and the six introspection functions,
with no line of the app able to reach any of them.

```ts
// what you write
import { Signal } from '@voltdev/core';
const count = new Signal.State(0);

// what ships
import { State as __volt_Signal_State } from '@voltdev/core/signals';
const count = new __volt_Signal_State(0);
```

Measured on a Vite production build: an app using only `Signal.State` goes
from 1,898 to 1,665 bytes gzipped (−233 B, −12.3%), and the counter example
from 5,321 to 5,125 (−196 B, −3.7%). The lowered output is byte-for-byte
identical to writing that import by hand.

Nothing about authoring changes here either. `@voltdev/core/signals` holds the
same bindings the namespace does — not copies — so `instanceof` and every
identity check give the same answer whichever spelling produced the signal,
and the namespace keeps working with no build step at all.

The pass only rewrites `Signal.State`, `Signal.Computed` and
`Signal.subtle.<member>` read directly off the imported binding. Anything else
the name is used for needs the object as an object, so the file is left
exactly as written:

```ts
const S = Signal;          // aliased
const { State } = Signal;  // destructured
register(Signal);          // passed on
new Signal[name](0);       // computed key
```

That costs bytes and nothing else. `debug: true` names the file and the reason
whenever it happens.

## Options

```ts
interface VoltPluginOptions {
  include?: RegExp;              // default: /\.m?ts$/
  exclude?: RegExp;              // default: /[\\/]node_modules[\\/]/
  precompileTemplates?: boolean; // default: true
  lowerSignals?: boolean;        // default: true
  runtimeModule?: string;        // default: '@voltdev/core/runtime'
  debug?: boolean;               // default: false
}
```

`debug: true` logs what the compiler folded away per file:

```
[volt] src/counter.ts: 2 template(s), 3 effect(s), 4 binding(s) folded, 1 markup dedupe(s)
```

## What it will not touch

Precompilation locates `templateUrl:` by scanning tokens, not by matching
source patterns, so it correctly ignores:

- `templateUrl:` inside a comment or a string
- `templateUrl:` in an object literal that is not a `@Component` argument

A missing file, or a syntax error inside one, fails the build with the
**html file's** path and position — not the `.ts` file that referenced it.

## Without a build step

`templateUrl` is read from disk, which a browser cannot do. Where there is no
build step — a test, a playground — supply `render` directly:

```ts
import { compileTemplate } from '@voltdev/core/jit';

@Component({
  selector: 'v-greeting',
  render: compileTemplate(`<p>Hello, { name.get() }.</p>`),
})
export class Greeting {}
```

That entry pulls the compiler into the bundle, which is why it is a separate
import rather than a config option. A component declaring `templateUrl` with
no build-time pass throws with a message pointing at both options.
