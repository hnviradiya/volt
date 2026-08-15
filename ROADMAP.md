# Roadmap

Two tracks. The framework has to be finished enough to build on before the
component library starts, and the component library is what the framework is
ultimately for.

## Track 1 — Volt core

### Performance

Measured against SolidJS and hand-written JavaScript in
js-framework-benchmark, throttled 4x, eight iterations.

The current gap is concentrated in one place. `select row` re-runs a `:class`
binding on every row when the shared `selected` signal changes — O(n) — while
hand-written JavaScript keeps a direct reference to the selected element and
does two DOM writes. Solid has the same O(n) structure, so the target there is
Solid's number, not native's.

- [x] Fix quadratic list teardown (`Watcher.unwatch`, scope detach)
- [x] Effect fast path — skip value/equality bookkeeping nothing reads
- [ ] `select row`: close the remaining per-effect gap
- [ ] `create`: 1.15–1.19x, the next largest gap after select

### Bundle size

Measured minified and gzipped, as the app bundle rather than the published
package.

- [x] Resolve `@Component`/`@Prop` at build time — no decorator runtime ships
- [x] Keep developer diagnostics out of production builds
- [ ] Component + DOM runtime — 41% of the bundle, not yet examined
- [ ] Generated template code — 21% of the bundle for one small component,
      the most promising untouched lead
- [ ] `Signal` is a TypeScript `namespace`, so it compiles to a runtime object
      and nothing reachable from it can tree-shake. Lowering `Signal.State` to
      a direct import at build time would let unused `subtle` members drop.

The reactive core is *not* where the remaining size is. Two attempts at
leaning it found nothing: removing a per-write allocation made writes slower
(V8 already elided it), and replacing a `WeakSet` with a field was neutral.

### Runtime gaps blocking the component library

- [ ] **Portal** — hard blocker. Dialog, dropdown, tooltip, popover, select,
      combobox and toast all have to escape `overflow: hidden` and stacking
      contexts. Nothing overlay-shaped can be built without it.
- [ ] **Transitions** — enter/leave. Requires coordinating node removal with
      animation completion; the runtime removes immediately today.
- [ ] **`:show`** — removed as redundant with `:class`. A component library
      wants DOM kept alive while hidden, to preserve state and allow CSS to
      animate. Worth reopening as a decision, not reintroducing silently.
- [ ] **SSR** — not needed for v1, but it constrains API shape, so decide
      before the primitives harden.
- [ ] **Error boundaries** — no equivalent feature today.

## Track 2 — the component library

### Shape

Headless core plus a styled layer, which is where every library that got this
right has converged.

```
@voltjs/primitives   behaviour and accessibility, zero styles
@voltjs/ui           a default styled set built on those primitives
```

The primitives are the hard, durable part. Styling is replaceable and must not
be able to trap the behaviour — the failure mode of Material UI and Vuetify,
where theming is something you fight rather than use.

### Distribution

Both models, each where it fits:

- **Primitives** ship as a versioned npm package. Accessibility fixes have to
  be patchable centrally.
- **Styled components** are generated into the user's repository by a CLI, so
  they own and can edit the markup — shadcn/ui's ownership model, without its
  missing upgrade path.

### Prior art worth reading

| source | what to take |
| --- | --- |
| Kobalte (Solid) | closest analogue — accessible primitives for a fine-grained, non-VDOM framework. Read first. |
| Radix, Ark | composition API shape (`Dialog.Root` / `.Trigger` / `.Content`) and the accessibility bar |
| shadcn/ui | source-ownership distribution, CSS-variable theming |
| Mantine | DX, and which components people actually reach for |
| Material, Vuetify | mostly what to avoid |

### v1 scope

The six hard components, because they exercise every primitive. Breadth is
mechanical once these are right.

- [ ] Dialog — portal, focus trap, escape, scroll lock
- [ ] Dropdown Menu — portal, positioning, roving focus, typeahead
- [ ] Select / Combobox — the above plus form integration
- [ ] Tooltip — portal, positioning, delay, pointer and keyboard
- [ ] Tabs — roving tabindex, ARIA
- [ ] Accordion — transitions, height animation

The bar is WAI-ARIA Authoring Practices conformance, with automated `axe`
checks in CI. Accessibility is where nearly every component library quietly
fails, and it is the part that cannot be retrofitted.

### Open question

Everyone ships Floating UI (~5 kB) for anchor positioning. Native CSS anchor
positioning may remove that dependency entirely, which fits this project's
no-legacy stance. Verify current browser support before committing.
