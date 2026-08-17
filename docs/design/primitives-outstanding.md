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

## query — a write that does not land, under load

Not a primitive, but the same shape of problem and worth recording next to the
others.

`@voltdev/query` is new and unreviewed-into-green. One defect is reproducible
and precisely characterised:

`client.setData(key, 'Grace')` on an entry currently holding `'Ada'` leaves
`client.getData(key)` reading `'Ada'` — the write does not land — but only when
the query test files run together. The identical sequence in a file on its own
writes correctly. Asserting immediately after the write, with no timer advance
in between, still reads the old value, so it is the write itself and not
collection or scheduling.

This is very likely the process-wide `queryClient` the review already flagged:
the module exports a mutable default that `createQuery` falls back to when no
client is given, so anything reaching it is shared by every test in a run — and
would be shared by every request on a server.

Two things were established while finding it, and both stand:

- Restarting the collection clock when an unobserved entry is written to is a
  real fix, proven under both real and fake timers. Without it an entry's age,
  not its last write, decides when data written a moment ago is collected.
- `evict`'s identity guard is correct: an orphan's collection does not take a
  replacement filed under the same key. The test that appeared to prove
  otherwise could not distinguish that from the replacement's own legitimate
  collection, because it left the replacement unobserved. It now holds it.
