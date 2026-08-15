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

- [x] **Portal** — `:portal`. Dialog, dropdown, tooltip, popover, select,
      combobox and toast all have to escape `overflow: hidden` and stacking
      contexts. Context and disposal follow the reactive scope, so portalled
      content still sees its providers and is still torn down with the
      component that declared it.
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

### Shared behaviours

Roughly fifty components are assembled from about eight behaviours. These are
the real work; the components are mostly composition once these exist and are
correct.

| behaviour | used by |
| --- | --- |
| Presence — mount/unmount coordinated with a transition | every overlay, collapsible, toast |
| Dismissal — outside pointer, escape, focus leaving | dialog, popover, menu, tooltip, combobox |
| Focus scope — trap, restore, sentinels | dialog, drawer, menu, popover |
| Roving focus — arrow keys over a collection, typeahead | menu, tabs, radio group, toolbar, tree |
| Collection — registration and DOM-order traversal of parts | menu, select, combobox, tabs, accordion |
| Anchoring — position against a trigger, flip, collide | popover, tooltip, menu, select, combobox |
| Form field — label, description, error wiring, native submission | every input |
| Virtualization — windowed rendering of long collections | select, combobox, table, tree, list |

### Component inventory

**Overlays** — dialog, alert dialog, drawer, popover, tooltip, hover card,
dropdown menu, context menu, menubar, toast

**Forms** — button, input, textarea, number input, password input, checkbox,
checkbox group, radio group, switch, select, multi-select, combobox, slider,
range slider, date picker, date range picker, time picker, color picker, file
upload, pin/OTP input, tags input, rating, form field, fieldset

**Navigation** — tabs, accordion, collapsible, breadcrumb, pagination,
stepper, navigation menu, scroll spy

**Data** — table, data table, tree, virtual list, calendar, carousel, timeline

**Feedback** — alert, progress, circular progress, skeleton, spinner, empty
state

**Layout** — resizable, scroll area, separator, aspect ratio, portal *(done)*

**Display** — avatar, badge, card, chip, image, kbd, code, typography

**Utility** — visually hidden, focus scope, presence, toggle, toggle group,
slot

### What "full feature support" means

Per component, and enforced by tests rather than asserted in a README:

- **Controlled and uncontrolled.** Every stateful component works both with an
  external signal and on its own.
- **WAI-ARIA Authoring Practices conformance** — roles, states, and the full
  keyboard interaction map, not just `role=`.
- **Composable parts.** `Root` / `Trigger` / `Content`, so consumers can
  restructure markup without forking the behaviour.
- **RTL.** Arrow-key direction and anchoring both flip.
- **Native form integration.** Inputs submit in a plain `<form>` and
  participate in constraint validation.
- **Theming via CSS custom properties**, never inline styles that cannot be
  overridden.
- **Virtualization** wherever a collection can be long.
- **SSR-safe** once SSR exists — no DOM access during construction.

### Sequencing

The six that force every shared behaviour into existence, in order:

- [ ] **Dialog** — presence, focus scope, dismissal
- [ ] **Dropdown Menu** — collection, roving focus, anchoring, typeahead
- [ ] **Combobox** — all of the above, plus form field and virtualization
- [ ] **Tooltip** — anchoring under pointer *and* keyboard, delay grouping
- [ ] **Tabs** — roving focus, automatic vs manual activation
- [ ] **Accordion** — presence with height animation

After those, the remaining components are grouped by the behaviour they reuse
and built in batches rather than one at a time.

## Flagship components

Three of the components on that list are not components in the usual sense —
they are products, and each needs its own package, timeline and decisions.
Naming their real feature surface here so it is not discovered later.

### Data grid — the AG Grid bar

The single largest thing on this roadmap. Its own package, `@voltjs/grid`.

**Decided: started in parallel**, rather than after the six behaviour-forming
components. The cost to watch is that the grid needs virtualization,
collection and roving focus before `@voltjs/primitives` defines them, so those
must be written in the shared package from the start even though only the grid
uses them at first — otherwise the grid grows a private copy that combobox and
tree later have to reconcile with.

- **Rendering** — row and column virtualization, variable row height, pinned
  top/bottom rows, pinned left/right columns, auto-height, RTL
- **Columns** — resize, reorder, hide, pin, auto-size, column groups,
  multi-row headers
- **Data** — multi-column sort with custom comparators, per-type filters
  (text, number, date, set), quick filter, external filter, row grouping with
  aggregation, pivoting, tree data, master/detail
- **Editing** — cell editors per type, full-row editing, validation, undo and
  redo, fill handle, copy and paste against the system clipboard
- **Selection** — cell, range, row, header-driven; keyboard extension
- **Data sources** — client-side, infinite scroll, server-side with grouping
  and sorting pushed to the server
- **Interaction** — full keyboard navigation across cells, accessible grid
  semantics, drag and drop of rows and columns
- **Export** — CSV and Excel, with styling
- **State** — save and restore column, sort, filter and group state

Volt's fine-grained reactivity should suit this unusually well: a cell can own
its own binding, so a value change writes one text node without the grid
re-rendering anything around it.

### Rich text editor

Robustness here means schema-constrained documents, collaborative editing,
input-method support for non-Latin scripts, undo grouping, paste sanitisation,
and tables *inside* content. That is a specialist engine, not a component.

**Decided: write our own engine.** No dependency on ProseMirror or Lexical,
consistent with the rest of the project owning its stack.

The risks are recorded here because they are the ones that stay invisible
until production, and each needs deliberate work rather than discovery:

- **Input-method composition.** `compositionstart`/`compositionend` around
  Chinese, Japanese and Korean input. Naive models corrupt text mid-composition.
- **Selection across browsers.** `Selection` and `Range` disagree between
  engines, especially around contenteditable boundaries and zero-width nodes.
- **Undo grouping.** Users expect word-level grouping and coalescing by time,
  not per keystroke; and undo has to survive collaborative remote edits.
- **Schema.** A constrained document model is what stops paste from injecting
  arbitrary markup, and what makes tables-inside-content tractable.
- **Collaboration.** If it is ever wanted, the document model has to be
  designed for it up front — CRDT or OT cannot be retrofitted cheaply.

Build the document model and schema first, then selection, then input, then
the UI. The UI is the smallest part.

### Date and time

- Range, multi-month, presets, min/max, disabled and highlighted dates
- Locale-aware month and weekday names, configurable first day of week
- Time selection, timezone handling
- Keyboard grid navigation per APG, screen-reader announcements
- Masked text entry alongside the calendar

Dates need a library decision. **`Temporal`** is the modern answer and fits the
no-legacy stance — real timezone and calendar support, no `Date` foot-guns, no
`date-fns`/`luxon` dependency.

### Splitter

- Horizontal and vertical, arbitrarily nested
- Min, max and collapsible panels, collapse to a handle
- Keyboard resize with arrow keys, `separator` role per APG
- Persisted layout, percentage and pixel constraints
