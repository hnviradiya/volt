---
title: Server rendering — design
---

<!--
  Not part of the published site; `srcExclude` keeps it out. This is a design
  record, written before any server code exists, so the decisions behind that
  code and the evidence for them survive being made.

  Three designs were argued independently — compiler-led, runtime-led,
  streaming-led — then scored and merged. What follows is the merge. Claims
  about existing code were checked against the source before this was kept;
  the ones that name a file and line are the load-bearing ones.
-->

# Server rendering for Volt — evaluation and synthesis

Grounded in `ROADMAP-V1.md:333-361`, `packages/compiler/src/codegen.ts`, `packages/core/src/dom.ts`, `packages/core/src/component.ts`, `packages/reactivity/src/effect.ts`, `packages/primitives/src/async.ts`, `docs/guide/design-decisions.md`. Nothing was written to the repository.

## 1. Scorecard

Scores /5. The axes are the ones asked for.

| | D1 compiler-leads | D2 runtime-leads | D3 streaming-leads |
|---|---|---|---|
| Fidelity to no-VDOM | **5** | 3.5 | 2.5 |
| Reuse of existing path resolution | 4 | **5** | 3 |
| Bundle cost for never-SSR clients | 2 | **5** | 3 |
| Streaming / async boundaries | 3.5 | 3 | **5** |
| Failure on server/client disagreement | 4 | 4 | **4.5** |

**D1 — fidelity 5.** The only design where the server allocates no nodes and mutates nothing: cost is proportional to output bytes, not to tree size. It also removes the server HTML parser entirely, which is D2's own self-named liability. Its argument that the server emitter is *less* work than the client emitter (no `resolvePath`, no marker elision, no template dedupe, no delegation) is correct against the code.

**D1 — bundle 2**, its worst axis and it says so. Shipping `_render0` *and* `_hydrate0` per template plus a per-instantiation `_rt.hydrating` read, against generated template code already at ~21% of a small component's bundle, is a cost paid by every user including pure-CSR ones.

**D2 — path reuse 5**, and it earns it by finding the one thing that breaks the roadmap's sentence at the level of emitted code. `genBlock` pushes `rootVar`, then *all* navigation, then effect lines (codegen.ts ≈390-399). So `_el15 = _el14.nextSibling` executes before anything is inserted — true for a clone, false for server markup where a hole is *n* nodes wide. And because `_rt.insert(p, _rt.branch([...]), m)` evaluates `branch` during *argument evaluation*, and `branch` builds synchronously through `buildEffect` → `renderEffect` (immediate, effect.ts:447), the nested `template()` claims nodes before `insert` ever runs. **D1's proposed fix — a module-level flag positioned "while the branch body runs", by analogy with `collecting` — cannot work for that reason.** D2's thunk (`hInsert(parent, open, () => …)`) is the correct repair. D2 also keeps the `Resolver`/`PendingEffect` interface (codegen.ts ≈126-132) untouched, which is the honest version of "reuses the existing path resolution": four call sites change, `Block.addChild`, `pathTo` and the merged-text accounting do not.

**D2 — bundle 5.** A CSR-only build emits byte-identical output to today. Nobody who never server-renders pays anything.

**D3 — fidelity 2.5.** A real mutable node tree with `cloneNode`, `insertBefore`, `classList`, `innerHTML` is the allocation shape the architecture exists to avoid, and it is what forces D3's own unresolved memory question about a 10k-row page. Its rescue — record `[start,end)` into the source template string, mark dirty on mutation, serialize clean subtrees as a verbatim slice — is genuinely good, and (see §3) is better executed at build time than at runtime.

**D3 — streaming 5**, by a wide margin, on four findings the others miss:
- the primitive must be a segment tree with holes; a string API built first gets rewritten;
- the payload must be an append-only instruction queue with an array-then-swap boot, because a boundary resolving after the shell has flushed has nowhere to put a blob;
- ids cannot be counter-allocated, because out-of-order flush makes render order ≠ document order — and Volt *can* do positional ids, because `:key` is mandatory and paths are build-time;
- `$V` must be idempotent and queue on miss (a nested boundary can resolve while its markers are still inside an un-inserted `<template>`), and needs a second path for regions already hydrated.

**D3's async finding is the single most valuable item in all three documents.** `createResource` starts its first fetch from a *user* `effect` (async.ts:558), whose first run is deferred by design (`watcher.pending.add` + `schedule()`, effect.ts ≈399-406, so a resource in a class field observes props assigned after construction). So the roadmap bullet "effects must not run on the server" and "the server awaits data" are contradictory as written: no effects ⇒ no fetch ⇒ nothing for a boundary to await. D1 and D2 both assert both halves without noticing. D3's third lane — `dataEffect`, ordered render → data → user, server flushes render and data only — is the fix, and it is a one-word change per call site *now* and a fifty-file argument once the primitives harden.

**Disagreement handling.** All three correctly invert the roadmap's claim: nothing is compared, so nothing can *mismatch* — and nothing can be *caught*. Each contributes something the others lack.
- D1 has the best per-binding forensics, and one finding that is a hard bug in any design: `replaceContent` with `marker === null` does `(parent as Element).textContent = ''` (dom.ts ≈183). That is exactly the `trySingleDynamicChild` path — the `<ul>` wrapping a single `:for` — so without seeding `current` with the claimed nodes, **hydration wipes every server-rendered row before inserting fresh ones.** Also correct: `bindClass`/`bindStyle` start `applied = []` and only remove what they added, so a class the *server* wrote is never removed; the compiler knows the folded literal classes and can pass them.
- D2 has the only whole-page recovery: an O(1) root checksum → discard and client-render. It is the only mitigation for a CDN minifier stripping comments, which destroys every marker with no other symptom.
- D3 has the right *shape* for local recovery: a `firstName` string compare per block, falling back to cloning, after which `insertExpression` sees `resolved !== previous` and `replaceContent` removes the wrongly-claimed nodes. Damage bounded to the hole, plus a mismatch hook.

These are complementary, not competing.

## 2. Winner

**Design 1's compiler-led server emit wins**, because the string-vs-tree question decides everything else and D1 is right about it:

- It is the only choice under which streaming is native rather than retrofitted. D3's own thesis is that the primitive must be a segment tree with holes — and *a writer with holes is that segment tree*. A mutable tree fights it: you cannot emit bytes until the tree is built, which is why D3 has an unresolved memory question and D2 has none of D3's streaming quality.
- It deletes the server HTML parser. Asking a runtime to re-parse the string the compiler just printed is doing the same work twice and creating a third parser that must agree with two others.
- It is the only one that can plausibly hit the roadmap's "cheaper than Fastify" target (ROADMAP-V1 ≈419-423).

D1 loses on hydration mechanics and on streaming design, and badly on bundle. All three are fixable by graft.

## 3. The synthesis

### 3.1 One markup printer, not two (resolves D1's biggest risk)

D1's named risk is emitter divergence — escaping, void elements, attribute serialization, whitespace. Mostly dissolve it: `Block.html` is already a `string[]` built by one code path. Make it **chunks plus hole records** (child holes where `<!>` is pushed today, and attribute-position holes, which are zero-width in the client string). Client mode joins the chunks exactly as now; server mode walks the same structure emitting `_o.raw(chunk)` between holes.

Static markup is then **byte-identical by construction**, not by test. This is D3's clean-subtree substring idea moved to build time, where it costs nothing and needs no dirty-tracking bookkeeping — the place D3 itself expected its first bugs. What remains genuinely server-specific is only *dynamic value* serialization: text escaping, attribute serialization, and property→attribute reflection. That is a real but small surface, and it needs the `PROP_TO_ATTR` table D3 proposes in `dom-info.ts` (inverse of the existing `ATTR_TO_PROP`) in *every* design, because `input.value = x` produces no markup.

One escaping rule, from all three: do **not** reuse `escapeHtmlText` (codegen.ts ≈1561). It deliberately leaves an existing entity alone, which is right for authored template text and wrong for a runtime value — `Smith &amp; Co` must become `Smith &amp;amp; Co`.

### 3.2 One client emit, not two (fixes D1's bundle score)

Take D2's per-build selection over D1's per-instantiation flag: the CSR build emits today's code, the SSR client build emits the hydrate variant. D1's objection — a `:if` that turns true *after* hydration must take the fast path — is answered without a second function: the claim helpers consult a cursor that is null once hydration finishes, so `hClaim` clones, and `hClose`/`hInsert` degrade to today's behaviour.

D1's cost objection survives only in one place, and there it is real: a row body created post-hydration pays a call where a property read is today, forever, in exactly the `create` benchmark that is 1.15–1.19x off. So: **dual emit only for `:for` row bodies**, switched by `_rt.hydrating` — D1's mechanism, scoped by D2's cost argument, using an analysis the compiler already runs. Everything else gets one emit.

### 3.3 Hydration walk (D1's mechanism, D2's correction)

D1 is right that the change is in the *seeding*, not the algorithm: `resolvePath` already prefers stepping from a resolved previous sibling (codegen.ts ≈432-437), so forcing holes into `resolved` routes every later sibling through them for free. D2 is right that the seed must be a runtime call, because hole width is unknown at build time. Combine:

- server emits `<!--[-->` … `<!--]-->` where the client template has `<!>`;
- hydrate emit materialises `const _h = _rt.hClose(_open)` and seeds `resolved` for the *following* index with `_h`;
- every sibling step that does not cross a hole stays a raw `.nextSibling`. **One call per hole, not per node** — strictly better than D2's blanket `hNext`.
- `insert` is thunked: `_rt.hInsert(parent, open, () => _rt.branch([...]))`, per D2's argument-evaluation finding.
- `hInsert` **seeds `current` with the claimed range** (D1). Non-negotiable: without it the markerless path wipes the server's children.
- Marker elision remains a hydration *win*: `tryTextOnlyChildren` hydrates with zero markers and zero DOM writes (`bindText` compares `.data` first, dom.ts ≈917), and `trySingleDynamicChild` needs no delimiters at all. `emitDetachedChild` (codegen.ts ≈514) reserves no slot, so portal declaration sites are already identical on both sides (D2's catch).
- `:for` rows: pass the row body's `rootCount` to `each` (D3 — it is computed and discarded today); fixed arity ⇒ no per-row delimiters, which is the 10k-row case. Variable arity, or a component row root, ⇒ server emits per-row delimiters. D1's uncertainty about component row roots is resolved conservatively: no cross-module shape analysis in v1.
- `bindHtml` skips its first write and adopts the server's markup; `model` inverts on its first hydration run, reading the DOM into the signal, because bfcache and autofill restore values *before* hydration (D1 and D3 both).

### 3.4 Failure handling — four tiers, all O(1)

1. **Build-time prevention (D1):** invalid nesting is a compile error, not a hydration bug — the `:for`-without-`:key` precedent.
2. **Build skew (D3):** `__VOLT_BUILD__` hash of effective `CodegenOptions` + compiler version in the boot record; on mismatch, client-render the whole tree.
3. **Whole-page (D2):** root checksum over template ids and hole counts; catches comment-stripping intermediaries, which nothing else can.
4. **Per-hole (D3):** `firstName` compare per block, fall back to cloning, let `replaceContent` remove the mis-claimed nodes, report through `onHydrationMismatch`.

The roadmap sentence should be replaced with: *value mismatches are impossible because bindings write rather than compare; structural mismatches are undetectable by construction, so the design's job is to bound them to the hole and report them.*

### 3.5 Streaming, identity, state (D3's spine)

- Segment tree is the primitive; `renderToStaticMarkup` its first consumer; `renderToString` a walk over the finished tree, not the base. Ship order differs from build order: `renderToString` ships before streaming, because it can still turn a throw into a 500 (D1) — streaming has a hard dependency on error boundaries, which the roadmap lists as an undesigned gap.
- **Positional ids** (D3) replace the `createId` counter (id.ts:10). One mechanism serving three problems: ARIA id stability, hydration-state keys, and boundary/portal ids under out-of-order flush. This touches ~8 primitives, so it must land before they harden.
- Payload: reconcile D1 and D3 rather than picking. The shell's bulk state is one `<script type="application/json">` (D1 — `JSON.parse` beats evaluating an object literal at size, and cannot execute); post-shell increments are `__VOLT__.push([op,…])` records with array-then-swap boot (D3 — the only shape that composes with out-of-order flush). `\u003C`, U+2028/2029 escaping, `nonce` first-class on every emitter.
- `@voltjs/serialize`: devalue-style flat array with reference dedup (D3's 1000-rows-one-author case decides the format), and it is the same artifact server functions will need (ROADMAP-V1 ≈405).
- Portals, decided by target kind: **body target** → buffer and flush before `</body>`, claimed in place, zero relocation (D1/D2 — the client's `portal` appends to body anyway, so the orders match); **selector target** → `<template data-volt-portal>` relocated by the same `$V` as boundaries (D3's unification), accepting that portalled content is invisible without JS and to crawlers.
- `dataEffect` lane, `__VOLT_SERVER__` gating the `onMount` microtask at its *scheduling* site (component.ts:501 — a queued microtask fires at the first `await`, so "don't await it" is not enough).
- Concurrency: D3's "flush to quiescence before every await" as the rule, with D2's interleaved-render isolation test as the gate and D2's one-render-per-isolate as the fallback. `AsyncLocalStorage` stays out — `node:async_hooks` fails the edge constraint.
- The DI collision, flagged by all three, needs an amendment to `design-decisions.md`: module-scope `Signal.State` as the sanctioned state-sharing mechanism (docs ≈32-47) does not survive a server. Read-mostly configuration only; request-derived state lives in a component or scoped context; a build check flags the rest. This is the API-shaping constraint ROADMAP-V1:57 says to decide before the primitives harden.

## 4. First three things to build

**1. Compiler prerequisites and the differential harness. No server code.**
Chunks-plus-holes in `Block.html`; the content-model compile error for parser-ambiguous markup (`<tr>` outside a section, block-in-`<p>`, list contexts); `delegatedEventNames`, per-`each` row `rootCount`, `__VOLT_BUILD__`.
*Must prove:* over the full template corpus, server-emitted static bytes are byte-identical to the client template string, and document-parse and fragment-parse produce structurally identical trees for every template that compiles — or compilation fails with a named remedy. This is a pre-existing CSR bug (`<table>` gets an implied `<tbody>` in a browser; happy-dom, which the tests run on, does not insert one — ROADMAP-V1 already flags the browser-matrix gap). Until this holds, every measurement downstream is untrustworthy, because SSR converts a latent wrong-node binding into a scrambled page.

**2. Reactivity lanes and request isolation.**
`dataEffect`, with `createResource`'s trigger moved onto it; `__VOLT_SERVER__` gating the `onMount` schedule; positional ids replacing the counter; request-scoped `stylesInjected` (component.ts:368 — today request 2..N get no styles) and the i18n `ambient` locale (i18n.ts:818 — request A's locale leaks into B and is the *default* path without a provider); the quiescence rule.
*Must prove:* two concurrent renders with deliberately staggered promise resolution produce output byte-identical to rendering them serially; and a resource declared as a class field fetches exactly once on the server and zero times in a client-only build. If isolation cannot hold under the quiescence rule, the scheduler must be made scope-reachable before any streaming work — out-of-order flush multiplies the interleaving, so discovering this later is much more expensive.

**3. Server emitter plus segment writer, with `renderToStaticMarkup` as the only consumer.**
No hydration, no ids, no markers, no payload — it proves the walk.
*Must prove:* (a) output parses to a tree structurally identical to the cloned client template across the corpus, now with values; (b) allocation on a 10k-row page is proportional to dynamic content, and the request is measurably cheaper than the tree-building alternative. (b) is the number that would reopen the string-vs-tree decision, and it is the only place where reopening it is cheap. Hydration — `hClaim`/`hClose`/`hInsert`, `current` seeding — starts only after this passes, because hydration's correctness is defined against markup this stage produces.