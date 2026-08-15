# Roadmap — V1

A complete, accessible, production-usable component library on a framework
that is fast and small. Everything here is needed before an application can
be built with Volt at all. Specialist surfaces are in [V2](ROADMAP-V2.md).

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
- [x] **Transitions** — done, and *not* in the runtime. Coordinating removal
      with animation completion turned out to need no framework support at
      all: `:if` already removes a node when its condition turns false, so
      `createPresence` in @voltjs/primitives simply holds that condition true
      until the element reports its exit animation finished. Keeping this out
      of the core is the better outcome — CSS stays the source of truth for
      duration, and a library that never animates pays nothing.
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

**Layout** — resizable, scroll area, separator, aspect ratio, portal *(done)*,
box, flex, stack, grid, container, center, spacer, masonry, sticky, affix

**Application shell** — what a production application needs beyond
components, and the part most libraries leave to the consumer to reinvent:

- app shell — header, sidebar, content, footer, with the content region
  scrolling independently
- sidebar — collapsible, mini-rail, and a responsive drawer below a breakpoint
- app bar, toolbar, command palette (`Cmd`/`Ctrl`+`K`)
- theme provider — light, dark and system colour modes, density scale
- breakpoint utilities — a reactive breakpoint, and show/hide by breakpoint
- **z-index layering** — a managed stack for nested overlays. Every library
  that skips this leaves applications hard-coding magic numbers, and a dialog
  opened from a popover is where it shows.
- skip links and landmark regions, so keyboard and screen-reader users can
  actually navigate an application shell
- error and loading boundaries with real fallback UI
- page templates — dashboard, list-detail, settings, wizard, auth, blank

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

Not components in the usual sense — products, each needing its own package,
timeline and decisions.

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

**Collaborative editing is V2.** That leaves IME composition, cross-browser
selection and undo grouping as the V1 hazards — each hard, none open-ended.

One caveat, and it is the reason this is written down rather than assumed.
Deferring collaboration is safe. Deferring the *shape of the document model*
is not: a model built on mutation and integer offsets cannot be made
collaborative later without rewriting it and everything layered on it.

The way to defer collaboration at no cost is to build the model
operation-based from the start — an immutable document plus explicit steps
that describe a change, rather than mutation in place. That is not a
concession to collaboration. It is what makes the other three V1 problems
tractable:

- **Undo** becomes inverting steps, which is how word-level grouping and
  coalescing by time are expressed at all. A snapshot stack cannot do either
  without storing whole documents.
- **Schema validation** happens on a step before it is applied, rather than
  after the document is already wrong.
- **IME** needs a composition to be one atomic change; a step is exactly that,
  where a sequence of mutations is not.

So: build immutable documents and steps, keep positions as mappable
references rather than raw offsets, and collaboration in V2 becomes adding a
rebase function rather than a rewrite.

Build order: the document model and schema first, then selection, then input,
then the interface — which is much the smallest part.

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

## Server-side rendering

Committed, and it constrains work already underway — a primitive that touches
the DOM while being constructed cannot be rendered on a server, so every
primitive is written to defer DOM access into an effect or guard it.

`@voltjs/server` — `renderToString` and `renderToStream`.

Hydration should suit this architecture unusually well. Codegen already
resolves every dynamic node by a `firstChild`/`nextSibling` path computed at
build time, because there is no virtual DOM to diff against. Hydration is the
same walk against server-rendered markup instead of a cloned template: the
paths are identical, only the source of the nodes differs. There is no tree to
reconcile and no chance of a "hydration mismatch" in the React sense, because
nothing is being compared — bindings simply attach to the nodes that are
already there.

- [ ] `renderToString`, then `renderToStream` for streaming
- [ ] A hydration codegen mode reusing the existing path resolution
- [ ] Serialize initial signal state, and adopt it on the client
- [ ] `onMount` must not run on the server; effects must not either
- [ ] Portals — render inline on the server, relocate on hydration
- [ ] Event delegation attaches once on hydration rather than per element
- [ ] Async boundaries, so streaming can flush a shell before data arrives

## Developer tools

A browser extension plus the hooks in core it needs, all behind `__VOLT_DEV__`
so none of it reaches production.

- [ ] **Component tree** — instances, their props, and their scopes
- [ ] **Signal graph** — nodes, edges, and what is currently live. Volt already
      exposes exactly what this needs: `Signal.subtle.introspectSources`,
      `introspectSinks`, `hasSinks` and `hasSources` are the graph-walking API
      a inspector is built on. They were measured at ~100 B gzipped and nearly
      cut for it; this is what they are for.
- [ ] **Why did this update** — which write woke which effect, which is the
      question fine-grained reactivity makes answerable and virtual DOM does not
- [ ] **Performance** — effect run counts and durations, flush timings, and
      which bindings are re-running most
- [ ] **Time travel** — signal history, step back and forth
- [ ] Highlight the DOM a binding owns, on hover

## Chat

A first-class component, not an afterthought. Most libraries have nothing like
it, and building one out of a list and a textarea misses everything that makes
it hard.

- **Message list** — virtualized with variable heights, grouping of
  consecutive messages from one author, timestamps, avatars
- **Streaming** — appending to the last message token by token without
  re-rendering the list, and without losing the user's scroll position
- **Scroll behaviour** — pinned to the bottom while at the bottom, releasing
  the moment the user scrolls up, with a "jump to latest" affordance. Getting
  this wrong is the single most noticeable defect in a chat interface.
- **Content** — markdown, code blocks with syntax highlighting and copy,
  tables, math, citations and sources, collapsible reasoning
- **Composer** — auto-sizing textarea, Enter to send with Shift+Enter for a
  newline, slash commands, @-mentions, attachments and paste-to-upload,
  draft persistence
- **Per-message actions** — copy, edit and resend, regenerate, react, branch
- **States** — typing indicator, generation in progress with cancel, error
  with retry, offline queueing
- **Accessibility** — new messages announced in a live region without
  interrupting, and full keyboard access to per-message actions

## Modern platform only

No support for old browsers, old JavaScript or old CSS. This is not only a
policy about what to drop — it decides what to build, because several things
libraries hand-roll are now platform features. Using them is smaller, faster
and more correct than reimplementing them.

| use the platform | instead of |
| --- | --- |
| `inert` | manually setting `aria-hidden` on siblings, which hides from assistive technology but leaves the page behind focusable and clickable |
| CSS anchor positioning | Floating UI, ~5 kB, for popover and tooltip placement |
| `popover` attribute and the top layer | a z-index registry, and the stacking-context bugs it exists to work around |
| View Transitions | hand-written FLIP animation for list reordering |
| `field-sizing: content` | measuring a mirror element to auto-size a textarea |
| `content-visibility`, CSS containment | manual occlusion culling for long lists |
| Container queries | JavaScript resize observers driving breakpoint classes |
| `:has()` | parent-state classes toggled from JavaScript |
| `scrollend` | debouncing `scroll` to guess when it stopped |
| `Temporal` | date-fns or luxon, and `Date`'s timezone behaviour |
| `Intl.*` | bundled locale data for dates, numbers, lists and plurals |
| `structuredClone` | a deep-clone utility |
| CSS `@layer` | specificity wars in theming |

Already applied: Dialog uses `inert` for the page behind rather than
`aria-hidden` alone.

## Audit findings

A survey of 991 distinct components across seven library families found these
absent from the plan. The specialist ones it also found are in
[V2](ROADMAP-V2.md).

### Data

- **List / Listbox** — The inventory has 'virtual list' (a rendering strategy) but no list component and no standalone listbox. Two distinct gaps: the display list — rows with leading media, title, description, trailing actions, dividers, sections — which is the most common way applications render non-tabular collections; and the selectable listbox with full ARIA listbox semantics, which is also the collection that select, combobox and multi-select render inside their popups. Building it once as a shared part avoids three private copies.
- **Description list (key/value pairs)** — Absent from the inventory. Every detail page, settings screen, entity summary panel and read-only form view needs label/value pairs with correct dl/dt/dd semantics and formatting identical to the editable field it mirrors. Consumers hand-roll it with flex and get the semantics and alignment wrong.
- **Stat / statistic tile** — The roadmap promises a dashboard page template but no component to put on it. A stat tile is the atom of every dashboard and admin overview: a formatted value with a label, a trend direction and a semantic colour. Small to build, conspicuous when missing.
- **Action bar (bulk selection toolbar)** — The grid and the list both get selection; nothing consumes it. The floating bar that appears when rows are selected, shows the count, offers bulk actions and clears the selection is the standard partner to every selectable collection, and it has real focus-management requirements — it must be keyboard reachable without destroying the selection.
- **Query builder / filter builder** — Appears three times in the survey (Query Builder / Filter Builder, Query Builder, AdvancedFilterBuilder) plus Filter Bar. The grid roadmap lists per-type filters but nothing that composes nested AND/OR/NOT groups, and this is the standard UI for saved views, segments and report parameters. It is also reusable outside the grid, so it should not be built as a grid-private feature.

### Display

- **Icon** — Not in the inventory at all, yet nearly every other component composes one (button, menu item, alert, accordion chevron, tree node, breadcrumb separator, empty state). Without a house Icon the defaults get hard-coded per component and consumers cannot swap an icon set. It also owns an accessibility rule that is otherwise repeated wrongly: decorative icons must be aria-hidden, meaningful ones must be labelled.
- **QR code** — Small and genuinely absent. Needed for TOTP/2FA enrolment, device pairing and share-to-mobile links — flows most production applications acquire eventually, and otherwise a third-party dependency.
- **Barcode and QR code generator** — Small, self-contained, and a standard part of every enterprise suite (tickets, labels, inventory, device pairing, 2FA enrolment). Nothing comparable is planned.

### Editor

- **Diagram / node canvas (flow, org chart, mind map, whiteboard)** — Around 35 survey entries describe an infinite-canvas node/edge editor (Diagram Canvas, Diagram Edge, Connection Handle, Edge Label, Node Resizer, Node Toolbar, Canvas Minimap, Viewport Controls, Canvas Background, Selection Marquee, Alignment Guides, Group Container, Auto-Layout Engine, Orthogonal Router, Shape Palette, Canvas Rulers, Canvas Export, Interoperability, Sticky Note, Freehand Draw, Canvas Frame, Presence/Follow, Mind Map, Org Chart, DSL Renderer, Hand-Drawn Renderer, Halo Toolbar, Graph Analysis). The roadmap has none of it, and org charts and mind maps are the shallow end of the same engine.
- **Code editor (plus diff view, terminal, log viewer)** — The roadmap plans a rich text editor and a `code` display element, but nothing for editing code. The survey has ~33 entries here (Code Editor, Diff Editor, Three-Way Merge, Minimap, Overview Ruler, Completion Popup, Signature Help, Hover Card, Code Action Menu, Peek View, References Panel, Multi-Cursor, Gutter, Folding, Sticky Scroll, CodeLens, Inlay Hints, Rename Widget, Snippet Engine, Bracket Guides, Inline Color, Problems Panel, Terminal Emulator, Notebook Editor, Split Editor Pane, Keymap Presets, LSP Client, JSON Tree Editor, SQL Editor, Live Playground, Log Viewer, Syntax-Highlighted Viewer). Any developer-facing product needs at least the read-only viewer and a diff.
- **Image editor** — Absent, and the natural other half of file upload: crop-before-upload alone covers most avatar and attachment flows.

### Feedback

- **Tour / coach mark** — Onboarding is absent. Every product that ships a new feature needs a spotlight walkthrough, and the hard parts are not the popover — they are the backdrop cutout, waiting for a target that has not mounted, scrolling it into view and re-measuring on resize. Consumers cannot assemble this from popover alone.
- **Meter** — Progress and circular progress are planned; meter is not. It is a different ARIA role — a measurement in a known range rather than task progress — for storage used, quota, capacity, password strength or budget consumed, and screen readers announce it differently. Small to build and wrong to fake with a progress bar.

### Form

- **Form** — The roadmap has 'form field' (per-control label/description/error wiring) and 'native form integration', but nothing at the form level. Every library ships one and it is where the hard parts live: submit orchestration, validation resolution, mapping server-returned errors onto fields, and moving focus to the first invalid control. Without it each consumer reinvents it and the per-field a11y wiring is never exercised end to end.
- **Inline edit / editable** — Click-to-edit text is absent. The grid gets cell editors, but every list row title, page heading, entity name, tag and settings value outside the grid needs the same preview-to-input swap. It is a real behaviour — activation policy, commit vs cancel semantics, no layout jump — rather than a styling variant.
- **Tree select / cascader** — Select, multi-select, combobox and tree are all planned, but not the combination: a picker whose options are a hierarchy. Category pickers, org and team pickers, folder pickers and permission scopes all need it, and it is not a trivial composition — parent/child check cascading, search that preserves ancestor context, and lazy child loading inside a popup are each their own problem.
- **Transfer list / dual list picker** — Absent. It is the standard control for assigning a subset from a large set — roles and permissions, column pickers, group membership, report fields — and one of the few pickers that stays usable at hundreds of items. It is also the accessible answer to 'drag items between two boxes'.
- **Masked input** — The roadmap mentions masked entry only for dates ('masked text entry alongside the calendar'). A general pattern mask is a separate, frequently needed control — phone numbers, card numbers, postal codes, licence keys, currency — and the hard part is caret management on insert, delete and paste inside the mask, which is exactly what consumers get wrong when they hand-roll it.
- **Button group / split button** — Button is planned; the grouping is not. Attached button sets (collapsed inner borders, shared size/variant, a single tab stop) and the split button (primary action plus its own menu trigger) appear in toolbars, table row actions, editors and form footers. The split button in particular has ARIA requirements that are wrong by default.
- **Dual listbox (transfer / pick list)** — The standard UI for assigning permissions, choosing report columns or building any 'available vs selected' set. Not derivable from multi-select, because it needs two independently filtered panes and ordered targets.
- **Schema-driven form (form layout, field arrays, validation rules)** — `form field` and `fieldset` are planned as single-field wiring, but the survey's Form Layout, Validator, Multi-Text and Property Grid entries describe the level above: generating and laying out a whole form from a model, and validating across fields. Every application form eventually needs cross-field rules, an error summary and repeatable rows, and retrofitting a form-level state container onto per-field primitives is expensive.
- **In-place / inline edit** — Read-only display that swaps to an editor on click. Absent, and it is the interaction pattern behind editable titles, detail panes and settings rows in most modern applications.
- **Property grid / property inspector** — Listed twice (Property Grid, Property Inspector). A two-column name/value editor driven by an object's shape is what any settings screen, style panel or diagram/element inspector is built from — including the roadmap's own devtools.
- **Input mask and key filter** — The date section mentions 'masked text entry' for dates only. General masking (phone, card, currency, licence keys) and character restriction are separate, reusable behaviours the survey lists as Key Filter / Input Restriction, and every form library ships them.
- **Recurrence (RRULE) editor** — Listed twice (Recurrence Editor, Recurrence Rule Editor). Required by anything that schedules — and the roadmap's Temporal commitment makes it a natural fit, since recurrence expansion is where Date-based implementations break on DST.
- **Duration picker** — `time picker` covers time-of-day; a duration (days/hours/minutes) is a different value type with different validation, and it is what timesheets, task estimates, timeouts and media trimming all need.

### Layout

- **Overflow container (responsive collapse into a menu)** — A measuring primitive that moves children that no longer fit into a '+N' menu. The roadmap needs it in at least five places it already plans — toolbar, breadcrumb collapse, tabs overflow, tag/chip rows, app-bar nav — and every one of them is broken at narrow widths without it. Cheaper as one shared component than as five ad-hoc ResizeObservers.
- **Dashboard tile layout (draggable, resizable widget grid)** — The app-shell section lists a 'dashboard' page template, but a static template is not the same as a user-arrangeable tile grid — the survey lists it twice (Tile Layout / Dashboard Layout, Dashboard Layout Grid). Layout persistence and per-breakpoint reflow are architectural, not styling.

### Navigation

- **Link / anchor** — There is no link component anywhere in the inventory. It carries decisions worth making once: underline behaviour, external-link rel/target defaults with a new-tab announcement, disabled and visited semantics that stay accessible, and polymorphic rendering as a router link — the same escape hatch button, menu item, breadcrumb and nav item all need.

### Overlay

- **Imperative overlay service (dialog / confirm / prompt)** — Toast is inherently imperative and is planned; dialogs are not. Application code constantly needs `await confirm(...)` from an event handler, a router guard or a store, with no markup to mount. Every mature library ships this, and it interacts directly with the planned z-index/layer stack, so it should be designed alongside it rather than bolted on.

### Utility

- **Drag and drop** — The roadmap names eight shared behaviours; this is the ninth. It is required by tree (reorder and re-parent), grid (row and column drag — already promised), tabs (reorder), list reorder, file drop and any board layout. It is the behaviour most likely to be discovered late and then re-implemented per component, and keyboard-accessible dragging in particular cannot be retrofitted.
- **Locale / direction provider (i18n)** — The roadmap commits to RTL and to Intl.* but names no provider carrying locale or direction. Two things depend on it: every built-in string a component renders (close-button labels, 'no data', pagination ranges, file-size units, drag announcements), which becomes untranslatable if hard-coded; and locale-derived behaviour the date components already assume (first day of week, 12/24h, calendar system) plus RTL flipping of arrow keys and anchoring. Deciding it after the primitives harden means changing every component's signature.
- **Live region announcer** — The roadmap requires screen-reader announcements in two places (chat messages, date-grid navigation) but has no shared utility. Toast, copy-to-clipboard, sort headers, pagination, form errors, drag and drop, filter changes and loading states all announce events with no visual anchor. Done per component you get duplicate live regions that clip each other's messages.
- **Clipboard / copy button** — Copy affordances appear all over the planned surface — code blocks (named in the chat section), API keys, share links, cell values, error and trace ids, snippets. The behaviour is small but has three details worth writing once: the copied-state timeout, the live-region announcement, and the non-secure-context fallback.
- **Component test harnesses** — The roadmap says feature support is 'enforced by tests rather than asserted in a README' — but only for the library's own tests. Shipping per-component harnesses (semantic actions like 'open the menu, click the item with text X' instead of DOM queries) is what lets the library refactor markup without breaking consumers' suites. Angular Material is the only major library that did this, and it matters more here than elsewhere because the styled layer is generated into the user's repo, so consumers own markup that their tests would otherwise be coupled to.
- **Product tour / onboarding coach marks** — Absent, and deceptively hard: it needs a spotlight cutout, scroll-into-view, anchoring against live elements that may move, and focus management — all behaviours the roadmap is already building for overlays, so it is cheap here and expensive for a consumer to reinvent.

### Enterprise (V1)

- **Query / condition builder** — The grid promises per-type filters and a quick filter but not the advanced-filter surface AG Grid, DevExtreme and Syncfusion all ship beside them: nested AND/OR groups of property-operator-value rows. Any admin or analytics tool eventually needs saved, composable filters, and the serialized tree is what gets pushed to the server-side row model already planned.
- **AI prompt / inline assist** — Chat is already first-class in the roadmap, but the survey's AI Prompt / Assist View, Smart Paste / Smart Text Area, Inline AI Autocomplete, AI Writing Assistant and Speech-to-Text Button describe the non-conversational half — assist anchored to a field or selection — which shares almost nothing with a message list.
- **Media player (video and audio)** — No media component of any kind is planned; `image` is the only media entry. A custom-controls player is a routine requirement and a genuinely hard accessibility surface (captions, keyboard, live regions).

## Cross-cutting systems

Whole categories a component-by-component audit would never surface. These
are architecture rather than components, and each is harder to retrofit than
to design in.

- **Internationalization and localization as a system (not per-component `Intl` calls)** — A locale provider that flows through the reactive scope (like the existing `createContext` in packages/reactivity/src/effect.ts:181), plus a message catalog for every string the library itself emits. Roughly fifty components each ship built-in accessible names and announcements: 'Close', 'Previous month', 'Page 2 of 10', 'Sorted ascending', '3 rows selected', 'Remove tag', combobox result counts, file-upload size errors, toast dismiss labels. Also needed: a plural-rule policy (`Intl.PluralRules`) for every count string, `Intl.Collator` as the default comparator for typeahead in roving-focus, grid text filters and set filters — `localeCompare` defaults are wrong for Turkish, German and Swedish; locale-aware *parsing*, not just formatting, for number input and masked/segmented date entry ('1.234,56' vs '1,234.56'); IME composition handling on every filter/typeahead input, not only in the rich text editor where the roadmap names it; and `lang` attribute propagation so screen readers switch voice.
  *Why:* The roadmap's `Intl.*` row in the platform table covers formatting only, and the date section covers month names. Neither covers the library's own strings. Without a catalog, a French or Japanese application must pass a label prop to every instance of every component, and gets none of the internal `aria-live` announcements translated at all — which means the accessibility work the roadmap treats as its differentiator only works in English. This is architectural: retrofitting a locale parameter into fifty already-shipped primitive APIs is a breaking change to all of them.
- **Bidirectionality as an architecture, not a per-component checkbox** — A direction provider primitive with per-subtree override, resolved once and read by anchoring, roving focus, slider, splitter, carousel, drawer and grid rather than each of them reading `getComputedStyle(el).direction` independently. A logical-properties discipline for `@voltjs/ui` (inline-start/inline-end, never left/right) enforced by lint. Bidi isolation (`<bdi>`, `unicode-bidi: isolate`) wherever user-generated text lands inside chrome — breadcrumbs, tabs, tags, table headers, file names — because an Arabic filename in an LTR breadcrumb reorders the separators visually. RTL-specific behaviour rules: horizontal slider increments leftward, grid column pinning and resize handles mirror, drawer swipe direction flips, `scrollLeft` sign differences. And a mirrored test run so every APG keyboard test executes in both directions.
  *Why:* The roadmap states 'RTL. Arrow-key direction and anchoring both flip' as a per-component requirement. That framing produces fifty independent direction detections that disagree, and it misses mixed-direction content entirely — an Arabic app with an English code block, or an English app rendering Hebrew user names, which is the common case, not the exotic one. Direction also has to be decided on the server for SSR, so it is coupled to the provider design and cannot be deferred.
- **Design token system and theme architecture** — A defined, versioned token taxonomy — primitive (raw palette, type scale, spacing) → semantic (surface, on-surface, border, focus-ring, danger) → per-component tokens — with a naming contract that is part of the public API, and a build pipeline emitting it to CSS custom properties, a TypeScript object, and a design-tool format. On top of that: multi-brand/theme composition; `forced-colors: active` (Windows High Contrast) support, which breaks any component conveying state through background-color alone — selected rows, checked switches, focus rings, chart series; `prefers-contrast` and `prefers-reduced-transparency`; `color-scheme` so native form controls and scrollbars match; guaranteed contrast ratios on generated foreground colors; and an elevation scale.
  *Why:* The roadmap has one line — 'theme provider — light, dark and system colour modes, density scale' — and 'theming via CSS custom properties'. That is a mechanism, not a system. Without a token contract, the CLI-generated styled components in the consumer's repo hard-code values, and the promise that 'styling is replaceable and must not be able to trap the behaviour' is unenforceable because nothing defines what the replaceable surface *is*. Forced-colors in particular is a legal accessibility requirement in enterprise and public-sector procurement and is invisible to every component-by-component audit.
- **CSS delivery, scoping and cascade architecture** — A decision and implementation for how styles actually ship. Today `packages/core/src/component.ts:367-381` creates a `<style>` element and injects it into the document once per component, keyed by a module-level `stylesInjected` boolean. That means: no scoping despite the 'component-scoped CSS' comment; no `nonce`, so it dies under a `style-src 'self'` CSP; nondeterministic injection order, so which component's rule wins depends on mount order; a per-module flag that is wrong in a second document (iframe, popup) and wrong across concurrent SSR requests; and no story for extracting CSS at build time. Needed: scoping strategy (attribute rewriting vs shadow DOM vs CSS Modules), a documented `@layer` ordering contract so a consumer's Tailwind or app CSS can predictably override without `!important`, `adoptedStyleSheets` for multi-document, SSR critical-CSS extraction with nonce propagation, and a stated position on whether `v-counter`-style selectors are real custom elements (which changes slotting, styling and hydration entirely).
  *Why:* `@voltjs/ui` is currently a single file exporting a version constant, so this is undecided rather than decided-and-unbuilt. Style delivery is the hardest thing to change later — it is baked into every generated component the CLI writes into user repositories, and into the SSR output format. Injection order nondeterminism produces the class of bug where a component styles correctly in dev and incorrectly in a production build with different chunking.
- **Testing utilities for consumers** — A `@voltjs/testing` package: mount a component into a container with automatic scope disposal, a deterministic `await flush()` that drains the two-phase microtask scheduler in packages/reactivity/src/effect.ts:219-224 (`flushSync` currently early-returns while flushing or batching, so consumers cannot reliably await settlement), event helpers that fire real trusted-ish sequences (pointerdown/pointerup/click ordering matters to `dismiss.ts`), and — the piece almost nobody ships — per-component test harnesses in the Angular CDK sense: `DialogHarness.close()`, `SelectHarness.selectOption('x')`, `GridHarness.getCellText(2, 'name')`, usable identically in unit tests and Playwright.
  *Why:* The roadmap says full feature support is 'enforced by tests rather than asserted in a README' — but that is the library testing itself. Consumers building on the library have nothing. Without a flush primitive, every consumer test of an async-scheduled framework is flaky by construction. Without harnesses, consumer tests bind to the library's DOM structure, which means the roadmap's own promise that accessibility fixes ship centrally as patches becomes false: any markup change to fix an ARIA bug breaks downstream test suites, and the library gets frozen by its consumers' tests.
- **The library's own verification infrastructure** — Tests currently run only in happy-dom (vitest.config.ts). Needed: a real-browser matrix across Chromium/Firefox/WebKit, because focus behaviour, `inert`, top-layer, CSS anchor positioning, `Selection`/`Range` and pointer capture — the exact substrate the roadmap builds on — differ per engine and happy-dom simulates none of them faithfully. Plus automated axe runs per component in CI; visual-regression snapshots for the styled layer; a documented manual AT verification pass (NVDA/JAWS/VoiceOver) since automated tooling catches roughly a third of issues and none of announcement behaviour; per-package bundle-size budgets enforced in CI with tree-shaking assertions (importing Dialog must not pull in the grid); runtime performance tests for the flagship components (10k-row grid scroll, virtualized chat with streaming); and automated disposal/memory-leak detection.
  *Why:* The framework has js-framework-benchmark discipline; the component library has none of the equivalent. The last commit fixed a disposal leak by hand — that is precisely the failure a leak harness catches automatically, and every overlay, portal and virtualized list is a place it recurs. Shipping WAI-ARIA conformance claims verified only in a simulated DOM is a claim that will not survive contact with Safari.
- **Documentation and playground infrastructure** — The docs are VitePress markdown with static code fences and no live examples. A component library needs: an editable live example per component with a rendered result; API/props tables generated from source types so they cannot drift; a per-component accessibility section documenting the full keyboard map, ARIA structure and known AT caveats; a design-token reference; a component gallery for visual review; versioned docs with migration guides; and a shareable REPL so bug reports arrive as reproductions. Equally missing: a development workbench — there is no way to build and inspect a headless primitive in isolation while working on it.
  *Why:* For a framework, prose docs suffice. For a component library, the documentation site *is* the evaluation surface — nobody adopts a headless primitive they cannot poke at. And the accessibility documentation is not optional polish: consumers assembling `Root`/`Trigger`/`Content` themselves can silently break the ARIA wiring, so the contract they must not violate has to be written down per component.
- **Form state and validation as a layer above the field** — The roadmap has a 'Form field' behaviour (label/description/error wiring, native submission) and 'native form integration ... constraint validation'. Missing is everything above the individual field: a form model with values, dirty/touched/pristine per field, submit lifecycle with in-flight state and double-submit prevention, async validation with cancellation, cross-field validation (confirm-password, date ranges), field arrays with add/remove/reorder, nested paths, typed schema adapters (Standard Schema / Zod), server-error injection mapped back onto fields after a failed POST, an error-summary region with focus moved to it on invalid submit and links to each bad field, scroll-to-first-error, and an unsaved-changes navigation guard.
  *Why:* Constraint Validation API alone cannot express 'this field is required only when that one is checked', cannot handle 'this username is taken' returned from a server, and cannot express arrays of repeated fieldsets. Every real application has all three. The choice is architectural — Vuetify/Quasar put validation inside components, the React ecosystem delegates to react-hook-form — and Volt must pick one before the twenty-plus form components in the inventory harden their APIs, because the field-level contract differs completely between the two.
- **Async data and resource primitives** — A resource/async primitive integrated with the reactive scope: loading/error/success state as signals, refetch, an `AbortSignal` tied to scope disposal so a navigated-away request cancels, last-write-wins ordering so an out-of-order response cannot overwrite a newer one, request deduplication, stale-while-revalidate, and a way for SSR to await it and serialize the result into the client's initial signal state.
  *Why:* The roadmap lists 'async boundaries, so streaming can flush a shell before data arrives' under SSR and 'error and loading boundaries' under the app shell, but nothing produces the async state those boundaries observe. Meanwhile at least six inventory items need identical machinery: combobox async search (debounce + cancel + race ordering — the out-of-order-response bug is the single most common combobox defect), grid server-side row model, tree lazy children, infinite scroll, file upload, and chat streaming. Without one primitive they become six incompatible implementations, and the grid's — being written first and in parallel per the roadmap's own decision — becomes the de facto one that the others must later reconcile against, which is exactly the failure mode the roadmap already flags for virtualization and collection.
- **A collection / data-source abstraction distinct from DOM part registration** — A shared data model for collections: item identity/keying, a pipeline of sort → filter → group → aggregate → paginate with pluggable client and server implementations, a selection model (single, multi, range, and cross-page 'select all 1,243 matching' versus 'all on this page'), expansion state for trees and grouped rows, and async page loading. The roadmap's 'Collection' behaviour is registration and DOM-order traversal of parts — a different thing.
  *Why:* Grid, tree, table, select, multi-select, combobox, virtual list, transfer list and the chat message list all need the same model. If it does not exist as a named layer, `@voltjs/grid` will contain a private one, and the combobox will get a second, and selection semantics will differ between them in ways users notice (shift-click meaning one thing in the grid and another in the list). Selection in particular is where this bites: the roadmap's 'action bar on selected rows' shell pattern requires a selection model that outlives the virtualized rows rendering it.
- **Animation and gesture beyond CSS transitions** — The roadmap decided transitions need no framework support: `createPresence` holds a condition true until CSS reports the exit animation done, and 'CSS stays the source of truth for duration'. That covers enter/exit only. Missing: motion tokens (a duration and easing scale so the library feels coherent rather than per-component); an explicit `prefers-reduced-motion` policy and where it is enforced, since CSS-as-source-of-truth means the *consumer's* CSS must remember it on every component; interruptible animation (a dialog closed and reopened mid-exit); gesture-driven motion where progress is bound to a pointer rather than a clock — drawer snap points, swipe-to-dismiss toast, carousel drag, sheet velocity handoff to inner scroll containers, splitter drag — none of which CSS transitions can express; velocity/spring physics; scroll-driven animation; and an owner for View Transitions, which the platform table adopts for list reordering but which are document-scoped and serialize, so two concurrent ones (a route change during a list update) conflict.
  *Why:* Several components already on the inventory — drawer, carousel, toast, splitter, resizable — are gesture-driven by definition and cannot be built on the current answer. Deciding this after the primitives harden means either bolting a second animation system alongside `createPresence` or breaking its API.
- **Accessibility tooling, services and formal conformance** — Beyond per-component APG conformance: a shipped live-region announcer service (a managed polite/assertive region with queueing and clear-timing, which chat, toasts, grid sort/filter, combobox result counts and form errors all need and which must not be five separate regions fighting each other); focus-origin tracking (keyboard vs pointer vs programmatic) as the correct basis for focus rings; a stated WCAG 2.2 position, specifically 2.5.7 Dragging Movements — every drag in the grid (row/column reorder), splitter, slider and any sortable list needs a documented non-drag alternative — plus 2.4.11 focus-not-obscured (a sticky app-bar hiding a focused element is the default failure of the roadmap's own app shell), and 2.5.8 target size in the styled layer; reflow at 320px/400% zoom; and an accessibility conformance report (VPAT/ACR) with a public issue-disclosure path.
  *Why:* The roadmap treats accessibility as a per-component property. The cross-cutting pieces are what make it hold together in an assembled application: three components each announcing into their own live region interrupt each other, and a keyboard-only user cannot reorder a grid column no matter how conformant the column header's ARIA is. The conformance report is not paperwork — it is the artifact enterprise and government buyers require before they will evaluate the library at all.
- **Keyboard shortcut management and layer arbitration** — An application-level shortcut registry: register/unregister bindings from anywhere with scopes and contexts, conflict detection, platform-aware display (⌘ vs Ctrl) for rendering into menus and a help sheet, chord sequences, an auto-generated discoverable shortcut overlay, and — the part that is always wrong — a guard so shortcuts do not fire while focus is in an input, textarea or contenteditable. Alongside it, an explicit layer stack that arbitrates Escape and outside-pointer dismissal ordering across nested overlays, and reconciles with the roadmap's adoption of the `popover` attribute and top layer, whose own light-dismiss and Escape handling will compete with `dismiss.ts` (packages/primitives/src/dismiss.ts:71-73 attaches capture-phase document listeners with no stack awareness).
  *Why:* The roadmap names Cmd+K for the command palette and per-component key maps, and lists Dismissal as a shared behaviour, but a stack of document-level capture listeners is not arbitration: a dialog opened from a popover containing a combobox has three Escape handlers and no defined winner, and the roadmap itself flags 'a dialog opened from a popover is where it shows' about z-index while leaving the keyboard equivalent unaddressed. Applications additionally need their own shortcuts to coexist with the library's, which requires a registry the library also uses.
- **Routing and navigation integration** — There is no router in the workspace and no routing story on the roadmap, yet app shell, sidebar, navigation menu, breadcrumb, tabs, pagination, stepper, command palette and 'page templates — dashboard, list-detail, settings, wizard, auth' all presuppose one. Minimum needed even if routing stays out of scope: an `asChild`/polymorphic render escape hatch so a nav item can *be* a router link without a wrapper element that breaks the layout and the ARIA; an active/current-route contract (`aria-current`) that nav components consume from a provider rather than a prop; focus management on navigation (moving focus to the main heading, the single most common SPA accessibility defect); route announcement into the live region; scroll restoration; navigation blocking for unsaved forms; and View Transitions between routes.
  *Why:* Without the polymorphism primitive, every navigation component in the inventory hard-codes an `<a href>` and is unusable with any client-side router — which is every real application. The decision also constrains SSR: route-level streaming boundaries and the shell/content split have to agree with whatever routing eventually exists.
- **Security: sanitization, Trusted Types, CSP and URL safety** — `:html` compiles to a raw `innerHTML` assignment (packages/core/src/dom.ts:44 and :845) with no sanitizer, no opt-in ceremony and no documented contract. Needed: a sanitization policy (a default sanitizer, or a deliberately unsafe API named so, plus a pluggable hook), Trusted Types support — `require-trusted-types-for 'script'` makes those two assignments throw outright, and large enterprises deploy it; CSP compatibility end to end, which includes a `nonce` channel for the `<style>` injection at component.ts:376 and for SSR-inlined styles, and a stated position on inline `style` attribute bindings under `style-src` without `unsafe-inline`; URL-scheme validation on `href`/`src`/`action` bindings so `javascript:` and `data:` from user data cannot execute; DOM-clobbering resistance for the id-based ARIA wiring, since `createId` values are looked up by id and a user-controlled `name`/`id` can shadow them; sandboxing rules for any iframe/preview primitive; paste sanitization in the editor (named as a risk, not as a mechanism); and supply-chain policy — signed publishes, provenance, SBOM, and integrity for the CLI registry that writes executable source into consumers' repositories.
  *Why:* Every one of these is a shipped-and-exploitable default rather than a missing feature. The CLI distribution model raises the stakes specifically: a compromised or unpinned registry is arbitrary code committed into customer repositories, and no component audit would ever surface it.
- **Print and export** — A print mode that disables virtualization so the full data set renders (a virtualized grid or chat prints one screen of rows and nothing else), page-break control, repeated table headers across pages, a print stylesheet layer for the styled components, a PDF strategy, and a generic export capability — component-to-PNG/SVG for charts and diagrams, plus a shared download primitive that owns object-URL lifecycle and a clipboard primitive that handles permissions and dual HTML+TSV payloads for Excel interop.
  *Why:* The roadmap has CSV and Excel export scoped to the grid alone. But printing is how a large class of business application delivers output, and virtualization silently destroys it — this is a defect that only appears in production, on a user's printer, in a workflow nobody tested. Clipboard and download are also shared infrastructure: the grid's copy/paste, the chat's copy-message, a code block's copy button and any export all need the same permission and lifecycle handling.
- **Offline, persistence and cross-tab state** — A network-status primitive; an optimistic-update-with-rollback pattern; a persistence layer over localStorage/IndexedDB that is SSR-safe (reads deferred past hydration so the server and client agree) and versioned/migratable; cross-tab synchronization via BroadcastChannel or storage events; and a statement on service workers/PWA and what happens to in-flight mutations across a reload.
  *Why:* The roadmap already assumes persistence in several places without naming the mechanism — 'persisted layout' for the splitter, 'save and restore column, sort, filter and group state' for the grid, 'draft persistence' and 'offline queueing' for chat, and the theme provider's colour mode. Each will otherwise grow its own storage key and its own hydration flash. Cross-tab is the visible one: a theme toggled in one tab, or a grid layout saved in another, must not diverge, and two tabs writing the same key without coordination silently lose data.
- **Environment injection: multi-document, shadow DOM, and request isolation** — An explicit document/window injection point that every primitive resolves through, instead of the direct globals currently in packages/primitives/src/dialog.ts:192-234, dismiss.ts:71-81, focus-scope.ts:51-76 and the portal default of `document.body` at packages/core/src/dom.ts:719. Alongside it, elimination of module-global mutable state: `createId`'s counter (packages/primitives/src/id.ts), the scheduler's `scheduled`/`flushing`/`batchDepth` (packages/reactivity/src/effect.ts:205-221), and `stylesInjected` per component config are all process-wide singletons.
  *Why:* Two distinct failures with one fix. First, embeds: any primitive using bare `document` is broken inside an iframe, a shadow root or a popped-out window — which is required for previews, design-tool canvases and widget embedding, and is also how micro-frontends compose. Second, SSR, which the roadmap has committed to: process-global state means concurrent requests share an id counter and a flush queue, so request A's ARIA ids collide with request B's under load. This also breaks the hydration contract directly — `id.ts` documents that ids 'are not expected to be stable across a reload', but hydration requires the server's `aria-labelledby="volt-3"` to match the client's exactly, which the roadmap's hydration section does not address.
- **Developer tooling beyond the devtools extension** — The roadmap's developer-tools section is entirely a runtime inspector. Missing is authoring tooling for the `:`-prefixed template dialect, which is a bespoke language with no editor support: a TypeScript language-service plugin or LSP giving completion, go-to-definition from a template expression to the class member, rename refactoring, and — most importantly — type-checking of template expressions, since `{{ count.get() }}` in an external `.html` file is currently unchecked text; a TextMate grammar for syntax highlighting; source maps from generated code back to template line/column so a runtime error points at the `.html`, not at codegen output; an ESLint plugin encoding both reactivity foot-guns and jsx-a11y-equivalent rules for templates; a Prettier plugin; `create-volt` scaffolding; and a build-integration matrix beyond Vite 8 — the plugin is mandatory (it lowers stage-3 decorators), so today the framework is unusable with webpack, rspack, Rollup alone, or any meta-framework.
  *Why:* A custom template syntax without editor support is a permanent tax on every consumer, and unchecked template expressions discard the main reason to choose a TypeScript framework — a renamed field silently produces a blank UI instead of a compile error. The single-bundler constraint is an adoption ceiling independent of how good the components are.
- **API stability, versioning, and the upgrade path for generated source** — The roadmap promises 'shadcn/ui's ownership model, without its missing upgrade path' and then never says what the upgrade path is. It needs to be specified and built: registry versioning, a diff-and-merge mechanism for components the user has edited, codemods for breaking changes, and a semver contract stating what is public — is the DOM structure public? are `data-*` state attributes public? are the CSS custom property names public? Also a deprecation policy with an overlap window, a browser-support matrix statement, and a TypeScript version support policy (the workspace is on a TS 7 pre-release).
  *Why:* This is the roadmap's stated differentiator against the most successful current distribution model, and it is the one item on the roadmap asserted without a mechanism. It also interacts with the central architectural promise: 'accessibility fixes have to be patchable centrally' only holds if a primitive can change its markup, and a primitive can only change its markup if the generated components and consumer tests that depend on that markup have a migration path. Without a public/private line, every DOM detail becomes accidentally load-bearing at version 1.0.
- **Production error handling, observability and diagnostics** — Error boundaries are listed as a runtime gap with no design. What is missing around them: how an error inside an effect propagates — the scheduler currently catches per-effect (packages/reactivity/src/effect.ts:113-115, 286-288, 349-393) with no channel to a boundary, so a throwing binding leaves the UI in a half-updated state with a console message; a global error-reporting hook so applications can wire component errors to Sentry with component/scope context attached; recovery semantics (does a boundary re-run the subtree, and what happens to the disposed scopes below it); SSR/streaming error handling once a shell has already been flushed and headers are sent; a stable selector/test-id contract for consumer E2E suites; and a production diagnostics story, given that `__VOLT_DEV__` strips all developer messages from the build where the hard bugs actually occur.
  *Why:* Fine-grained reactivity makes this harder than virtual DOM, not easier: there is no re-render to fall back to, so a mid-flush failure leaves specific nodes stale with no reconciliation to repair them. 'Which write woke which effect' is on the roadmap as a devtools feature — the same information is what a production error report needs to be actionable, and the hooks should be designed once for both.

## Already planned, but under-specified

The audit judged these entries thinner than the standard set by the
libraries they are meant to match:

- **Data grid (@voltjs/grid)** — Loading, empty and error states — the three states a grid spends much of its life in, and the ones AG Grid clones routinely omit; Integrated chrome: toolbar with quick search, column-chooser panel, density selector — the capabilities (hide, resize) are listed but not the UI that drives them; Status/footer bar with aggregates over the selection and the filtered set; Conditional row and cell styling, plus cell/header/detail templates as a first-class API; Context menu integration (copy, copy with headers, export, column operations) — context menu is currently listed only as a standalone overlay; Row spanning / cell merging, and sticky group rows
- **Rich text editor** — Toolbar surfaces: static toolbar, bubble/selection toolbar, slash menu, per-node-type context toolbars — 'the UI is the smallest part' but none of it is named; Table UI operations (insert/delete row and column, merge/split cells, resize) as distinct from tables existing in the schema; Images and media: upload, resize, caption, drag-drop and paste-to-upload; Markdown input rules and clipboard serialization to HTML/Markdown; paste-from-Word/Docs cleanup (paste sanitisation is named only as a schema consequence); A read-only renderer sharing the same document format — needed by chat, comments and any published view; Mentions, emoji and inline chips/links (the chat composer promises @-mentions; they should share this)
- **Date and time** — Combined date-time picker (calendar + time in one popover with a staged confirm), and a date-time range variant; Month, year and decade pickers as selectable modes, not only as navigation levels; Time-slot grid (fixed-interval selectable slots) for booking flows, distinct from a time input; Distinction between disabled and unavailable dates, via an isDateUnavailable predicate rather than min/max alone; Range specifics: hover preview of the pending range, min/max range length, re-picking either end, non-contiguous ranges; Non-Gregorian calendar systems and week numbers — Temporal makes these cheap, and the roadmap says only 'locale-aware month and weekday names'
- **Chat** — Conversation history list — grouped by date, rename/pin/delete, search, infinite scroll: the sidebar half of every chat product; Prompt suggestion cards (starter prompts, nested sub-prompts) for the empty state; Agent reasoning / tool-call step chain with per-step status (pending, running, success, error), collapsible details and streaming append — 'collapsible reasoning' is named but the multi-step tool-call structure is not; Emoji picker behind the 'react' action, and a reaction bar with counts and self-reacted state; Composer header/footer slots for model pickers, token counters and disclaimers; voice input with recording state; Message search and jump-to-message inside a virtualized list with variable heights
- **Application shell** — Global header contents: product/app switcher, global search, notifications bell with badge and a notifications panel, help and profile menus — 'app bar' names the region but not what goes in it; Page header: title with breadcrumbs, status tags, action cluster, embedded tabs row, and collapse-on-scroll into a condensed sticky bar; Responsive nav overflow — top-level items collapsing into a menu (needs the Overflow container reported as missing); Mobile bottom navigation as a shell region below the breakpoint, alongside the responsive sidebar drawer; Error/result page templates (403, 404, 500, success) — the template list has dashboard/list-detail/settings/wizard/auth/blank but no error surface; Locale and direction providers as shell-level concerns (see the missing i18n entry)
- **Theme provider** — Per-component default props (a config provider) — the most requested escape from prop repetition, and it interacts with the CLI-generated styled layer; Portal container target and z-index base as configuration; CSP nonce for injected styles; Reduced-motion configuration surfaced as tokens, not only a density scale; Nested/scoped theming for embedded widgets and preview panes; a high-contrast scheme alongside light/dark/system; Hand-off to the localized string table (belongs with the locale provider)
- **Toast** — Queue with a max-visible limit, stacking/collapse of older toasts and expand-on-hover; Promise toasts (loading → success/error) and update/dismiss by id; Timers that pause on hover, on focus and on window blur, resuming with the remaining duration; Swipe-to-dismiss with a velocity threshold; action and cancel affordances; Multiple placement regions with a per-toast override; aria-live routing — role=status vs role=alert by severity — and a hotkey to focus the region
- **Drawer** — Snap points, with gesture-driven and programmatic snapping; Drag/swipe to dismiss with velocity and momentum thresholds, and a grabber/handle part; Scrollable content that hands the gesture back to the drag only at scroll top; Non-modal mode where the page stays interactive, and push/squeeze-content mode with layout offset bookkeeping; Nested drawers with stacked offsets and background scale/inset; Sticky header/footer with a scrollable body; resizable width via a drag handle
- **Tree** — Async lazy loading of children with a per-node loading indicator; Tri-state checkbox selection cascading to parents and children, plus a strict (independent) mode; Drag and drop to reorder and re-parent, with before/after/on drop indicators and auto-expand on hover; Filter/search that retains ancestors, auto-expands matches and highlights them; Inline rename, multi-select with shift-range, and '*' to expand siblings; aria-level / aria-setsize / aria-posinset on every node — these break by construction once virtualization windows the tree
- **Combobox / select** — Async/remote filtering with debounce, loading state, empty state and infinite (paged) option loading; allow-custom-value and a create-new-option affordance; Grouped sections with sticky headings, and per-item icon/description/shortcut slots; Match highlighting of the query within options; Multi-select token overflow ('+N') and responsive single-line vs wrapped display; A highlighted-item model kept separate from the selected value; open-on-focus / open-on-click / min-characters policies
- **File upload** — The upload lifecycle at all — the entry reads as a picker: queue, per-file progress, cancel, retry and aggregate progress; Chunked/resumable upload with concurrency limits, and auto vs manual upload; Pluggable transport (XHR/fetch/presigned S3) with headers and form-field hooks; Per-file validation with reason codes (type, size, count) and per-file error messages; Image thumbnail previews and file-type icons; remove-uploaded (server delete); Directory upload, paste-to-upload and a full-page drop target
- **Button** — Icon-only variant with an enforced accessible name and a square hit target independent of icon size; Loading/pending state that swaps in a spinner, preserves width, blocks activation and announces via a live region; Polymorphic rendering as an anchor or router link while keeping button key handling; Focusable-disabled (aria-disabled) so a disabled button can still take focus and carry a tooltip explaining why; Full-width/block, shape (pill, circle) and the size × density matrix; Loading/pending state with a spinner and disabled semantics, and an inline determinate progress variant for async actions
- **Avatar** — Group/stacking with configurable overlap, max count and a '+N' overflow that opens a list of the rest; Image load state machine (idle/loading/loaded/error) with a fallback delay so fast connections do not flash initials; Fallback chain image → initials → generic icon, with a deterministic colour derived from the name; Presence/status badge that is shape-coded as well as colour-coded; Clickable and link variants with correct semantics
- **Image** — Preview/lightbox with zoom, rotate, reset and download, and gallery grouping with next/prev — otherwise every consumer pulls in a lightbox dependency; Lazy loading with a blur/low-quality placeholder and an aspect-ratio box that prevents layout shift; Error fallback element and load/error status callbacks for skeleton coordination; srcset/sizes responsive sources, object-fit and decoding hints
- **Pagination** — Page-size selector with configurable options; '1–10 of 243' range summary with i18n plurals, including unknown/estimated totals for server-side data; Ellipsis windowing computed from sibling and boundary counts, with ellipsis present in the item model rather than only visually; Jump-to-page input with validation; compact/simple and prev-next-only modes; Per-page aria-labels and aria-current, and link-mode items for routed pagination
- **Typography** — Semantic heading level decoupled from visual size; Single-line and multi-line (line-clamp) truncation, with a tooltip shown only when the text is actually clipped; Expandable show-more/less toggle for clamped blocks (the survey's Spoiler / Truncated Text); Start/middle/end truncation for file paths and ids; text-wrap balance/pretty and font-variant-numeric helpers — tabular figures matter for the grid and stat tiles
- **data table / data grid (@voltjs/grid)** — Cell renderer library — the roadmap names 'cell editors per type' but no renderers: text/number/date/link/checkbox, image, avatar, tag/chip with +N overflow, progress bar, rating, sparkline, button, icon, markdown, tree cell, redacted/protected cell, per-cell spinner; Column menu and column chooser — resize/reorder/hide/pin are listed as capabilities with no UI to invoke them (menu with pin/autosize/group-by, chooser popup with search, drag reorder, tri-state group nodes); Tool panels — columns panel with row-group/values/labels drop zones, and a filters panel listing every column filter as an accordion; Floating filter row docked under the header, with type-appropriate widgets and sync to the parent filter; Multi-filter (two filter types stacked on one column) and set-filter values sourced/refreshed from the server, filtered by other columns' filters; Row-group drop zone above the header (drag a column here to group) — otherwise grouping has no discoverable UI
- **tabs** — Closable tabs with a dirty indicator, and add-tab affordance; Drag to reorder tabs, and drag-to-split in editor-style layouts; Overflow handling: scroll buttons or an overflow menu when tabs exceed the width; Lazy and deferred rendering of inactive panels, plus keep-alive of panel state once mounted; Vertical orientation and swipe/animated transition between panels
- **virtual list** — Infinite scroll: append the next page on reaching the end, plus a load-more button mode and an inline loader/skeleton; Dynamic/measured item heights rather than fixed, with scroll-anchoring on resize; Grouped rendering with sticky group headers and a jump-to-group index; Horizontal and grid (multi-column) virtualization, not just vertical lists; Programmatic scrollToIndex/scrollTo with alignment, and scroll-position restoration; Pull-to-refresh and reach-bottom events for touch
- **select / multi-select / combobox** — Async remote options with paging/infinite scroll and loading/empty/error states; Option groups with sticky group headers, and disabled options; Adaptive rendering — dropdown on desktop, full-screen or bottom-sheet picker with a search field on touch (the survey's 'Lookup'); Arbitrary popup content (grid, tree, calendar) behind one editor input, with value/display-text decoupling — the basis of grid-lookup and tree-lookup pickers without new components; Multi-select token display with overflow (+N), max selections, duplicate prevention and per-token removal; Create-new-option ('tag') support and apply/cancel button modes
- **carousel** — Thumbnail strip (any side), indicators and captions; Autoplay with interval, loop and pause-on-hover; Fullscreen/lightbox mode with keyboard and swipe navigation, and zoom; Responsive items-per-view breakpoints; A before/after comparison variant with a draggable divider

## Techniques to adopt

From a survey of Vue, Svelte, Angular, web-component and mobile libraries,
and of how the leanest and fastest of them achieve it. Ordered by value.

### 1. Stop delegating high-frequency and cancelable events — remove wheel and the touch family from DELEGATED_EVENTS, and de-delegate pointermove/mousemove/pointerover/mouseover/dragover

**Buys:** Fixes a correctness bug, not a micro-optimisation. `delegate()` (packages/core/src/dom.ts:549) installs document-level listeners with no options, and Chrome forces touchstart/touchmove/wheel listeners on document to be passive — so `:wheel.prevent` compiles to a delegated listener (`.prevent` is a guard modifier, not an option modifier, so codegen.ts:734 still takes the delegation path) whose preventDefault is silently dropped. That is the class of component the roadmap depends on: slider wheel-adjust, number input, carousel, drag-reorder, custom scroller, splitter, canvas panes. De-delegating also removes a full ancestor walk per pointermove on every element in the document — in a grid that is 10-15 parentNode hops plus a failed expando lookup per frame.

**Costs:** Elements that genuinely need move handlers carry real listeners and cleanup closures — but the listener-count argument never applied here (a drag handler is on one splitter, not a thousand rows), and gestures should attach to the document only for the duration of the gesture. Needs a compiler test asserting `:wheel.prevent` produces a cancellable listener, and a documented rule that hover state belongs in CSS.

### 2. Add a measure lane to the scheduler: render effects → measure (read-only) → user effects (write)

**Buys:** The single defence against the stall that actually defines how a component library feels. `flushSync` (packages/reactivity/src/effect.ts:235) drains render effects to fixed point then user effects, all in one microtask; the moment any user effect reads geometry (popover positioning, scroll sync, overflow measurement, autosize) it forces a synchronous layout over everything just written, and with N such components the flush becomes write→layout→write→layout N times. A measure phase collapses all reads in a flush to one forced layout. It is ~20 lines next to the existing two-watcher loop now, and unretrofittable once twenty components each own a measuring effect. Pair it with a tracked forced-layout-per-flush metric.

**Costs:** A third phase is public API surface and another ordering rule to document and test. A measure callback that writes silently reinstates the thrash, so it needs a `__VOLT_DEV__` guard that traps write paths during the measure drain. Code that measures runs one phase later than naive expectation.

### 3. Grid: one painter effect per row, no per-cell signals, and cell renderers flyweighted per column

**Buys:** The largest memory decision in @voltjs/grid, and it cuts against the roadmap's stated plan that 'a cell can own its own binding'. Measured on Volt's own reactivity: a renderEffect with one dependency costs ~1,470 B; a 5,000x20 grid is 180.7 MB with an effect per cell versus 10.0 MB with one painter per row writing cells imperatively — 18x. A per-cell signal is ~475 B all-in once observed (link() lazily allocates sinks/sinkSlots on both ends), so 200k cell signals is ~95 MB before a single DOM node. One `render(value, node)` per column definition, closed over format/align/comparator, means zero per-cell closure allocation and makes column reorder/hide an array swap rather than a binding rebuild.

**Costs:** Loses per-cell dependency tracking: a change re-runs the row painter, so the painter must diff against a cached previous-value array. Cells that genuinely need independent reactivity (open editor, live status pill) must opt back into their own effect, and the cell-renderer contract has to anticipate that from day one. Column renderers become imperative `(value, node) => void` functions, so structural cell content needs an explicit escape hatch back to a real Volt block — two authoring models in one API. The compiler cannot produce this shape from a nested `:for`; @voltjs/grid emits the painter by hand.

### 4. Virtualize by pool slot, not item identity — key the window by index so `each` becomes a recycler

**Buys:** Measured on a 60x15 window over 100k rows: id-keyed full-window scroll 2.206 ms, destroying and rebuilding 60 row scopes every frame (12,120 row builds over 200 scrolls); slot-keyed 0.309 ms with row builds never leaving 60. `each` (dom.ts:379-394) already does exactly `row.item.set(items[i])` on a key hit and leaves the DOM in place, so slot-keying converts it into the fixed-size object pool a virtualizer wants, with zero new runtime code and zero GC churn. A React virtualizer cannot do this even with stable keys. Bounded worst-case per frame is the right trade against an unbounded scroll velocity.

**Costs:** Higher floor for small deltas (a 1-row scroll is 0.042 ms id-keyed vs 0.238 ms slot-keyed), and it discards the guarantee `each` is built around: focus, in-flight input, open editors, text selection and running transitions stay with the slot, not the row. The grid must reconcile focus, selection and edit state against recycled rows on every window change, and `:key` semantics differ between the grid window and ordinary Volt lists — a documentation burden. Offer identity-keying as an opt-out for animated lists. It also makes identity-stable row objects a public contract: sort/filter must emit the same objects (`slice().sort()`, never `map(r => ({...r}))`), and server refetches must merge into existing rows by business id.

### 5. Virtualizer mechanics: transform-offset the window container, `overflow-anchor: none` on the scroller, `contain: content` on rows, one shared ResizeObserver read from entry geometry, separate fixed and variable height paths

**Buys:** Each is small and they compose into the difference between a smooth and a janky scroller. One transform per frame instead of N absolute-position writes, on a property that skips layout entirely. `overflow-anchor: none` stops the browser's scroll anchoring from fighting every spacer change (the infinite-correction-loop bug). `contain: content` on rows and cells stops a cell text write from invalidating layout up to the document root — reported ~10x on grid scroll — and is what makes Volt's fine-grained writes actually reach the layout engine. A single ResizeObserver reading `entry.borderBoxSize` costs nothing, where `getBoundingClientRect()` in the callback re-forces layout for a number the engine just handed you. The fixed-height path is pure arithmetic with no measurement at all, which is the common case (select, combobox, menu, listbox, most lists); the measured path wants a Fenwick tree over row heights so offset↔index stays O(log n) at 100k rows.

**Costs:** `overflow-anchor: none` means you own scroll stability — every legitimate size change above the viewport needs explicit scrollTop compensation, with real test coverage. `contain: paint` clips overflow, so focus rings, hover popovers and cell dropdowns must be portalled out. The transformed container becomes a containing block, so `position: fixed` descendants resolve against it. ResizeObserver reports zero sizes for a hidden list and will wipe the measurement cache unless zero entries are ignored. Two virtualization code paths to maintain.

### 6. Virtualize columns as a first-class constraint, not a symmetric nicety

**Buys:** Every cost scales with rows x columns. At ~1,470 B per binding a 60-row window is 1.3 MB at 15 columns and 17.6 MB at 200; the 2.206 ms full-window scroll at 15 columns becomes 12,000 cells at 200 and fits no frame under any keying strategy. Wide grids are exactly where AG Grid users live, so the painter must iterate only the visible column slice and recycle cell nodes horizontally, or horizontal scroll reintroduces the create/destroy churn that slot-keying eliminated vertically.

**Costs:** Row DOM structure becomes mutable, so anything holding a cell node reference — open editor, focused cell, range-selection anchor — must be re-resolved on horizontal scroll rather than held as a pointer. Breaks naive colspan, sibling selectors across a row and native table layout, forcing explicit width management for every column. Pinned left/right columns must be excluded from the recycled range and painted separately.

### 7. Lower the `Signal` TypeScript namespace to direct imports at build time

**Buys:** The highest-confidence kB win available, and it compounds across every app. Measured: an app using only `Signal.State` ships 1,957 B gzip from @voltjs/reactivity; importing `StateSignal` directly ships 1,395 B. That is 562 B gzip of pure dead weight in every single application — ~10% of the 5.8 kB budget — because `export namespace` compiles to a runtime object and `introspectSources`, `introspectSinks`, `hasSinks`, `hasSources`, `unwatched`, `Watcher` and `untrack` all stay reachable. The vite-plugin already rewrites `@Component`/`@Prop`, so the machinery exists.

**Costs:** The public API is the TC39 spelling, so the namespace must remain valid at runtime for JIT mode, tests and the REPL — a build-time path and a runtime path that must stay behaviourally identical. `const S = Signal; new S.State()` defeats the lowering, so the transform must bail out rather than mis-rewrite.

### 8. Resolve component variants at compile time — never ship cva + clsx + tailwind-merge

**Buys:** Forecloses ~8.5 kB gzip of runtime (1.5x the entire framework) before it arrives, and removes work that otherwise executes on every variant evaluation. The compiler already folds provably-constant bindings into markup and emits no effect; a variant map called with literal arguments is exactly that transform, compiling `variants({variant:'primary', size:'sm'})` to a static class string in the hoisted template with zero runtime. Because the styled layer is generated source in the user's repo, the compiler sees the literal call sites directly. SCSS with real `@layer` resolves precedence in the stylesheet, so tailwind-merge is not needed at all.

**Costs:** New compiler surface, and the variant map must be statically analysable — object literal, no computed keys, no spread from an imported const unless the compiler follows it. A runtime fallback for genuinely dynamic variants must stay correct when analysis bails out, so two paths exist.

### 9. Emit compiled CSS as real .css assets in build mode, with a declared `@layer` order, nonce support and `adoptedStyleSheets`

**Buys:** Fixes four things at once. Bytes are the smallest: 768 B gzip as a .css file versus 931 B (+21%) as JS string literals. The real wins are that CSS in JS is invisible to the preload scanner, cannot be preloaded or cached separately, and is parsed twice — and that today `injectStyles` (packages/core/src/component.ts:366-382) appends a `<style>` lazily on first component instantiation, so styles arrive after the component's JS has begun instantiating: a guaranteed FOUC for above-the-fold components, one `<style>` per component, nondeterministic cascade order by mount order, and instant death under `style-src 'self'` CSP. The vite-plugin can emit via `this.emitFile` and let Vite's CSS code-splitting associate assets with chunks, keeping runtime injection for JIT/dev only.

**Costs:** A component module stops being fully self-contained, which is convenient for JIT and tests. Per-component assets fragment unless merged per chunk. The plugin becomes responsible for cascade order, which is why `@layer volt.base, volt.components, volt.overrides` must be established now rather than retrofitted. `sideEffects: false` must become `["**/*.css"]` the moment emitted CSS imports exist — and that field is a load-bearing promise, not a hint: a violated one deletes behaviour silently, so it needs a CI test that bundles each package with a single export imported and asserts the result.

### 10. Icons: a build-time-collected SVG sprite, and a hard ban on namespace barrels and string→component maps

**Buys:** Measured: per-icon JS modules cost ~1 kB fixed wrapper plus ~70 B gzip per icon (4,521 B at 50); an SVG `<symbol>` sprite is ~46 B per icon with no wrapper (2,159 B at 50) in a separately cacheable file with no JS parse. And the footgun that dwarfs everything else in the survey: `import * as L from 'lucide-react'` with `L[name]` ships 176,270 B gzip — a 39x blowup — which is what any 'icon by name' API produces by default. Volt's compile-time templates make the sprite unusually clean: `<v-icon name="check">` with a literal name is statically analysable, so the plugin collects the referenced set across the app, emits only those symbols, and each use compiles to `<svg><use href="#i-check">` with zero runtime — sprite economics with per-icon precision, automatically.

**Costs:** `<use>` against an external sprite cannot be styled beyond currentColor/fill/stroke inheritance, so multi-colour or per-part-styled icons must inline; cross-origin sprites need CORS headers. A build-collected set is not runtime-extensible, so the per-icon module path must remain available for consumers bringing their own icons, and dynamic names require an explicit registration list so the namespace blowup is structurally impossible.

### 11. Dates: own the civil-date arithmetic, use Intl for all naming and formatting with cached formatter instances, and do not take a bare Temporal dependency yet

**Buys:** A direct correction to the roadmap, which states Temporal fits the no-legacy stance. Temporal reached Stage 4 in March 2026 and ships in Firefox 139+ and Chrome 144+, but Safari still has no stable support — a date picker on bare Temporal is broken on Safari today, and temporal-polyfill is 19,766 B gzip (3.4x the whole framework) and does not tree-shake at all: importing only `Temporal.PlainDate` measures the same as the whole namespace. Meanwhile a hand-written calendar core covering everything a picker grid needs — month grid, addMonths with clamping, localized month/weekday names, first-day-of-week via `Intl.Locale.getWeekInfo()` — is 482 B gzip for every locale, ~7x smaller than the nearest library and ~25x smaller than date-fns with five locales, because Intl data lives in the engine. Expose Temporal types at the API boundary as optional so consumers who already have it can pass PlainDate in without the primitive importing it. Cache `Intl.DateTimeFormat`/`NumberFormat` instances by locale+options key — construction is orders of magnitude more expensive than formatting.

**Costs:** You own correctness: month-end clamping, DST if times are ever touched, and non-Gregorian calendars, which Intl can format but not do arithmetic in. So scope it explicitly — hand-rolled for the picker grid, consumer-supplied Temporal for anything timezone-aware or non-Gregorian. Revisit a hard dependency once Safari ships stable.

### 12. CSS anchor positioning as the primary path, with a minimal `@supports`-gated JS fallback — and if floating-ui is used, import middleware individually

**Buys:** Anchoring is used by six-plus components and is the library's worst hot path if done in JS: a Popper-style implementation attaches scroll/resize listeners to every scrollable ancestor and reads three rects per floating element per scroll frame — a forced layout storm with a menu, three tooltips and a select open inside a scrolling grid. Native anchoring moves all of it into the layout engine for zero bytes and zero JS. The bytes avoided are real: floating-ui's whole namespace is 8,583 B gzip, and even computePosition+flip+shift+offset is 5,685 B — about the size of the entire framework, and 1.8x the current primitives barrel. Coverage as of 2026 is ~83% and rising; core anchoring is in Safari 18.2, `position-try-fallbacks` needs Safari 26+.

**Costs:** A JS fallback must exist for the Safari 18.2–25 window, so the code is not deleted yet — only stopped for most users — and the `@supports` split is a maintenance item for another year or two. Anchor positioning is less expressive for arrow placement, virtual/cursor-following references and precise collision padding, so a few components still measure. If you write your own instead, budget it as a real project: flip/shift against scrolling containers, transforms, iframes and RTL is where floating-ui's bytes are actually earned.

### 13. Make the delegated dispatch path allocation-free until a handler is found, namespace the expandos, and stop the walk at the mount root

**Buys:** `dispatchDelegated` (dom.ts:559) currently performs, on every dispatched event of a delegated type and before knowing whether any handler exists: a `Function.prototype.bind`, a closure allocation, two `Object.defineProperty` calls that push the freshly allocated Event object into dictionary mode, and two `Reflect.deleteProperty` calls in a finally. With one delegated keydown anywhere on the page, every keystroke in every input pays it. Walking first with a plain loop and installing the stopPropagation/currentTarget overrides only on the first hit makes handler-free chains cost pointer chasing alone. Replacing per-type `$$click`/`$$keydown` expandos with one `node.$$v` object gives an element with four handlers one hidden-class transition instead of four — meaningful for grid cells, the most numerous elements in the heaviest component.

**Costs:** One extra property load per walk step for elements that do have handlers, negligible against the transition savings. Lazy override installation complicates the stopPropagation interception: the flag must be scoped so a handler calling it before later handlers run still halts the walk. Namespaced expandos also make the pooled-node hygiene rule concrete — a grid that parks DOM nodes outside `each` must clear them on release (assign undefined, not delete), because `delegate()` deliberately registers no cleanup and a stale handler retains the previous row's item signal.

### 14. Remove `each`'s per-reconcile allocations: reuse the keys/rows/nodes buffers and drop the bucket-array-per-key

**Buys:** A no-op reconcile of 10,000 rows costs 2.38 ms and ~2.1 MB of transient garbage — ~210 B per row per pass — from `keys`, `rows`, a `reused` Set, a fresh `nodes` array, and an `available` Map that allocates a single-element bucket array for every distinct key. A grid re-deriving its row array on sort, filter or scroll at 60fps produces ~126 MB/s of garbage from bookkeeping alone. Storing the first index directly in the Map and promoting to an array only when a duplicate key is actually seen means unique-keyed lists allocate zero buckets; hoisting the buffers into the `each` closure and replacing `reused` with a generation-stamped Int32Array removes the rest. Contained change to one function that benefits every list, not only the grid.

**Costs:** Reused buffers size to the high-water mark, so a list that spikes to 100k and settles at 50 retains the large arrays unless shrunk. Generation stamping needs an overflow story. The duplicate-key promotion adds a branch to the hot loop and a second path that needs its own tests — `each` handles duplicate keys correctly today and must not regress.

### 15. Cache collection queries, precompute typeahead labels, and use virtual focus (aria-activedescendant) for long or virtualized collections

**Buys:** packages/primitives/src/collection.ts re-runs `querySelectorAll` plus a spread plus a filter on every `enabled()` call, and one arrow-key press runs it three times (`next` → `enabled`, then `indexOf` → `enabled`, then `at` → `enabled`) with three array allocations. `match()` then re-reads `textContent` for up to n items per keystroke. Invisible at 20 items; the dominant cost of every keypress in a 5,000-item listbox, and it lands directly in the input-latency path. Memoize the item array against a version signal the framework already knows when to bump, thread one `enabled()` result through next/at/indexOf, and keep lowercased labels alongside. Separately, DOM focus cannot move to a row that virtualization has not rendered — so composite widgets over long collections need aria-activedescendant rather than roving tabindex, which is a design constraint on the roving-focus behaviour, not an afterthought.

**Costs:** A cache needs an invalidation story; a MutationObserver delivers on a microtask so a query right after a synchronous DOM change reads stale — the version-signal approach is more deterministic and is the one to take. Virtual focus is a second focus model in the roving-focus primitive, with its own APG rules and its own AT verification burden, and it must coexist with real roving tabindex for short collections.

### 16. Replace `getComputedStyle`-per-candidate focusability checks with `Element.checkVisibility()`

**Buys:** `isVisible()` in packages/primitives/src/focus-scope.ts:85 calls `getComputedStyle` for every candidate returned by `focusableWithin`, which runs on mount and again on every focusin that escapes the scope — a style recalc per candidate per event in a dialog with a long form. `checkVisibility({visibilityProperty:true, opacityProperty:true, contentVisibilityAuto:true})` is one engine-side call and additionally answers the thing getComputedStyle cannot: whether the element sits in a subtree skipped by `content-visibility: auto`. That is not hypothetical — the moment the library adopts content-visibility for medium lists, the current check reports skipped elements as visible and focus jumps into content the user cannot see. Baseline since March 2024.

**Costs:** Near zero. The option flags need a deliberate decision rather than copying: `opacityProperty: true` treats opacity 0 as invisible, which is right for focus trapping but wrong for an element mid-fade-in.

### 17. Lazy overlay mounting as an enforced rule: closed overlays render nothing, and positioning/observation runs only while open

**Buys:** A table with 1,000 tooltip cells creates zero popup DOM at rest, and no anchoring loop, ResizeObserver or dismissal listener exists for a closed surface. This is the difference between an application that scales to a dense page and one that does not, and it is uniform across the ecosystems surveyed (LazyTeleport, `:if` + Presence, show-on-demand portals). It composes exactly with `createPresence` as already built, and pairs with a single shared portal container and one layer stack so only the topmost surface responds to Escape and outside-pointer — which the roadmap already wants for z-index but has not stated for keyboard.

**Costs:** First open is slower than a pre-mounted surface (one template clone plus binding setup), which is visible for tooltips with no delay unless the content is trivial. Consumers occasionally want a closed-but-mounted overlay for measurement or animation, so an opt-in keep-alive is needed. Deferred content also means anything a consumer expects to exist while closed (a form field inside a closed dialog participating in submission) must be explicitly documented as absent.

### 18. `content-visibility: auto` with `contain-intrinsic-size: auto <len>` as the zero-JS tier for medium collections

**Buys:** web.dev's reference case measures 232ms → 30ms rendering time from adding it. It is the right default for the 50–500 item range the library will hit constantly — accordion panels, inactive tab panels, comment threads, log views, message groups, card grids — where full virtualization is not worth its complexity or its accessibility cost. The `auto <length>` form makes the scrollbar converge after one pass. Volt's SCSS-only, modern-browsers-only stance means it can be applied unconditionally in component stylesheets with zero runtime bytes and no feature detection. Layer it: content-visibility for medium, pool-keyed virtualization for unbounded.

**Costs:** Anything that forces layout on an off-screen subtree (`getBoundingClientRect`, `offsetHeight`, `scrollIntoView`) un-skips it and destroys the benefit — a focus-management routine measuring across the whole list negates it entirely, which is why the checkVisibility change is a prerequisite. Find-in-page behaviour is inconsistent in Safari, and a badly wrong intrinsic size makes the scrollbar jump. Content stays in the accessibility tree, so it is no substitute for virtualization when DOM node count is the actual problem.

### 19. Leak defence: warn on effects created outside any scope, run consumer callbacks through `runWithScope`, and tear listeners down with an AbortController signal

**Buys:** `createEffect` ends with `if (parent) ...push(dispose)`. When `currentScope` is null the effect is still constructed, still watched, and has no reachable disposer — at ~1,470 B plus everything the closure captures, retained forever by a module-level watcher. `onCleanup` already warns in dev for exactly this; `effect` and `renderEffect` do not. The grid is the prime source of scope-less effects because much of it is imperative code outside compiled templates (scroll observers wired in onMount, resize effects created from event handlers, data-source subscriptions started in promise continuations after teardown). Passing an AbortController signal to every `addEventListener` lets disposal be one `abort()` with no bookkeeping arrays. Worth auditing alongside: `instantiate` schedules `queueMicrotask(() => instance.onMount!())` unconditionally, so a component disposed in the same tick still fires onMount on a dead instance.

**Costs:** The dev warning produces false positives for genuinely app-lifetime effects created at module scope, a pattern the framework currently permits silently. Threading a scope through the grid's imperative API surface is real work, and callbacks intended to outlive the grid need an explicit opt-out.

### 20. Cheap codegen hoists: static event-guard config objects and loop-invariant handler closures

**Buys:** Free, and one of them is a promise the code already makes and does not keep. codegen.ts:882 emits `guard(handler, {"stop":true,...})` as an inline object literal inside a body that runs once per element instance — so `:click.stop` on a row allocates a fresh config object per row when the config is fully static and dedupes well as a module const. Separately, codegen's own header claims 'event handlers that close over nothing local are hoisted out of loops' and `CompileStats.hoistedHandlers` is declared and initialized but never incremented: compiling `<li :for="row of rows" :on-click="onPing()">` still emits a fresh closure per row for a handler closing over nothing but `_ctx`. The compiler already computes the loop's bound names, so the analysis is a scope-membership test it is positioned to make.

**Costs:** Only handlers referencing neither item nor index qualify, which in a real grid is the minority — most cell handlers legitimately close over row and col — so the ceiling is modest. Adds an analysis pass and a second emission path, and the hoisted binding must be placed so it is not evaluated before `_ctx` exists.

### 21. Build the component library's own benchmark and budget harness before building the components

**Buys:** js-framework-benchmark measures none of the costs above — no scrolling, no measurement, no popover positioning, no focus management, no observers, no hover — so 1.18x of hand-written JS will not move regardless of what the library does, and a library on a 1.18x framework can still stutter badly. Track instead: scroll frame time on a 100k-row grid at fast fling, keystroke-to-paint in a 5,000-item combobox with typeahead, open/close latency for a 500-item menu, hover-to-highlight in a grid, and forced-layout count per flush — the last is the number that best predicts whether the library feels fast and the one the architecture has no defence against until the measure lane exists. Alongside it, per-package size budgets with tree-shake assertions (importing Dialog must not pull the grid; each package bundled with one export imported, size asserted) — which is also the only thing that catches a `sideEffects: false` violation, since a broken one deletes behaviour with no error and no warning.

**Costs:** A second harness to build and maintain, and interaction-latency benchmarks are noisier and harder to keep stable in CI than throughput numbers. Worth it: these are the numbers the library's reputation rests on.

## Further components from the Vue, Svelte, Angular and mobile ecosystems

- **Attachable behaviour layer (directives / actions)** *(Framework authoring primitive)* — Volt's `:` directives are a closed compiler set (STRUCTURAL_DIRECTIVES in packages/compiler/src/ast.ts:130 plus events); there is no way for a behaviour to attach to an element the consumer already has. The roadmap expresses everything as a component, so loading overlay, ripple, lazy-load, infinite-scroll sentinel, click-outside, long-press/touch-pan, intersection/resize/mutation observation and drag each become a wrapper element with its own instance, scope and DOM node. Every Vue/Svelte kit in the survey ships this layer and the survey singles it out as having no React analogue — it is precisely the thing a compile-time, no-VDOM framework can do for near-zero cost, and it is absent from the plan. Deciding it late is expensive because it changes how a dozen already-planned behaviours are packaged.
- **Client-only / NoSSR boundary** *(Utility (SSR))* — SSR is committed and the roadmap enumerates portals, onMount and hydration, but nothing lets a consumer declare a subtree browser-only. Every heavy or measuring surface the roadmap plans — rich text editor, grid, charts (if adopted), maps, anything reading geometry in a measure phase — needs a declarative skip-on-server escape, and so does any third-party widget a consumer embeds. Appears as QNoSsr / ClientOnly / No SSR across three ecosystems.
- **Relative time, countdown and formatted-value display components** *(Display)* — The roadmap commits to `Intl.*` for formatting inside the date components, but ships no component that renders a value: live relative timestamps ('3 min ago'), absolute/relative switching, countdown with a deadline, and formatted number/bytes/date cells. Chat message timestamps, grid cell renderers, activity feeds, session-expiry and OTP-resend timers all need it, and doing it per component produces one interval timer per element instead of one shared ticker plus cached Intl instances. Named repeatedly in the survey (Time, Relative Time, Format Date/Number/Bytes, Countdown, Statistic).
- **Watermark** *(Display / compliance)* — Tiled canvas or SVG overlay with a MutationObserver that reinstates itself when removed. Absent from the roadmap and near-universally absent from React kits, but standard in enterprise Vue/Ant-family kits because it is a procurement-driven requirement for document preview, PDF viewing, screen-capture deterrence and internal dashboards. Small, self-contained, and it belongs next to the PDF/file-preview surfaces the roadmap's own audit already flags as missing.
- **Signature pad** *(Form)* — Canvas stroke capture exposed as a form control (value, clear, undo, pen width, export to PNG/SVG, touch and stylus pressure). Appears three times across the survey. Consent, delivery confirmation, contracts and onboarding flows all need it, it participates in native form submission and constraint validation like any other field, and it is the kind of thing consumers otherwise pull a random dependency in for.
- **Floating action button and speed dial** *(Action)* — There is no FAB anywhere in the inventory, and no speed dial. It is the primary-action affordance for the responsive/mobile half of the app shell the roadmap does plan (bottom navigation is also absent), and speed dial is not just a styled button — it is anchoring plus roving focus plus dismissal plus labelled actions, i.e. behaviours already being built. Listed in Quasar, Material, PrimeVue, Ionic and Onsen.
- **Wheel picker (picker column / picker group)** *(Form (touch))* — Momentum-scrolled cylinder columns. The roadmap's only adaptive-rendering note is a bottom-sheet select; but on touch the expected presentation of date, time and duration selection is a wheel, not a calendar grid or a dropdown, and it is the shared engine behind date/time/duration/area pickers in every mobile kit surveyed. It also has real physics (momentum, snap, haptic-free deceleration) that cannot be retrofitted onto the desktop picker's markup.
- **Swipe-to-reveal row actions (swipe cell)** *(Data / touch)* — Drag-to-reveal row actions with drag-past-threshold auto-execute, and one-open-at-a-time coordination across a list. It is the touch counterpart of the row action menu the roadmap assumes everywhere (list, grid, chat message actions), it must work inside a virtualized/recycled row pool, and it carries a WCAG 2.5.7 obligation for a non-drag alternative that the roadmap's accessibility section raises for the grid but not for lists.
