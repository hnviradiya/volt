---
title: Components held back, and why
---

<!--
  Not part of the published site; `srcExclude` keeps it out.

  Three components are written, tested and NOT exported. Each went through
  repeated rounds of fixing and independent adversarial review, and each still
  has a defect a reviewer reproduced with a probe. This records what those are
  so the next pass starts from evidence rather than rediscovering them, and so
  nobody exports one on a green suite alone — the suites are green.

  The shared shape of the problem: every round fixed the finding it was given
  and broke a neighbour, because these three each have one model whose
  invariants are spread across many call sites. They need that model redesigned
  once, not another finding-by-finding pass.
-->

# Components held back, and why

## combobox

Genuinely fixed and independently confirmed: the "No results" flash during a
debounced search, deselection closing a `multiple` on one route but not the
other, a late search answer clobbering the input, and the dismissal case.

Still wrong:

- **An initial value shows the identifier.** With `{ name, defaultValue: 'ba' }`
  and nothing else, the textbox reads `ba` where `Banana` belongs, until the
  popup is opened. Four opt-in cures exist (`labelFor`, a server-rendered
  prefill, a self-heal on first render, opening the list); none covers the bare
  case, and `multiple` is not covered at all — `rememberLabel` is guarded
  `!core.multiple`.

Introduced while fixing the above, each reproduced with a probe:

- **`minLength: 0` preload is aborted whenever a `defaultValue` is present.**
  `showInputValue` sets `searchable` false for text the component writes, the
  resource is gated on it, and `enabled` going true→false aborts. The request
  goes out, the seeding effect writes the value a beat later, and the answer is
  discarded — leaving the popup permanently empty and announcing "No results"
  for a search that was cancelled.
- **`toggleValue` cannot remove on a single-value Select or Combobox.** Its
  first line returns after `select` when not `multiple`, so a method documented
  as "add or remove" only ever adds.
- **The seeding effect rewrites text the user typed.** It depends on the list
  revision, and a plain click to reposition the caret sets `filtering` false,
  which is enough to overwrite the query under the caret.
- **`readOnly` no longer returns early from `select`.** A read-only Select's
  popup collapses on every option press, so the list cannot be browsed.

## inputs

Went from one unfixed finding to two across three rounds — the only one of the
four that got further from shipping each time. Focus handling after removal is
the coupled part: `removeAt` was fixed and `clear()` was not, and the fix for
one kept moving the problem into the other.

## slider-upload

Closest of the three: every named defect fixed, one neighbour broken each
round. The last round left dirtiness correct for the slider's own writes and
wrong for a value written by anything else — session restore, bfcache,
autofill — where the form submits a restored value while `isDirty()` is false.

The dirty model is the thing to redesign: it currently infers dirtiness from
who wrote the value, and it needs to compare state instead.

## query — the write that did not land, resolved

Kept as a record of how it was found, because the shape recurs: a defect that
only appeared with the other test files in the room.

The symptom was `client.setData(key, 'Grace')` on an entry holding `'Ada'`
leaving `client.getData(key)` reading `'Ada'`, but only when the query test
files ran together. It was attributed to the process-wide `queryClient` the
module exported as `createQuery`'s fallback, shared by every test in a run and
by every request on a server.

That export is gone. The cache is reached through `provideQueryClient` and a
scoped context, which `docs/design/ssr.md` requires of request-derived state,
and four tests in `query.test.ts` hold the boundary — including one asserting
that a scope with no cache throws rather than inventing one. The symptom no
longer reproduces: `lets a subscriber that outlived a clear go on working` is
un-skipped and passes across repeated, shuffled and isolated runs.

Attribution is the one loose end. Restoring the singleton on its own does not
bring the symptom back — it reddens the four scope tests first, and those now
pass a client explicitly — so the singleton is established as a design defect
and only inferred as the cause of the write. Nothing here is waiting on it.

Two things established while finding it, both still true and now each covered
by a test that fails without them:

- Restarting the collection clock when an unobserved entry is written to is a
  real fix, proven under both real and fake timers. Without it an entry's age,
  not its last write, decides when data written a moment ago is collected.
- `evict`'s identity guard is correct: an orphan's collection does not take a
  replacement filed under the same key. The test that appeared to prove
  otherwise could not distinguish that from the replacement's own legitimate
  collection, because it left the replacement unobserved. It now holds it.

Still landed unfinished on purpose: two `it.skip`s in `infinite.test.ts` —
superseding an append with an invalidation, and two infinite queries sharing
one key. Twelve of the fourteen cases pass; these two are the remaining work.
