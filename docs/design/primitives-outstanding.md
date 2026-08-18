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

Redesigned once rather than fixed again. Every defect below came out of a
single model — what the textbox displays for a value — being spread across a
label cache, four opt-in cures, and a seeding effect that inferred from
`filtering` who had last written the box.

The model is two sentences. A value's name lives in one registry that every
source files into as it appears — a rendered option, a select's native
`<select>`, the text the page was rendered with, `labelFor` — and a value
nothing has named has no name, rather than being named after its own
identifier. The textbox says exactly one of two things and one signal says
which: the question the user is asking, or the name of the value held; a
question is retired only by being answered, and answering is choosing.

What the old mechanisms became:

- `labelCache`, `rememberLabels`, `rememberLabel` and the five-branch `labelOf`
  chain → `names` plus `nameValue`/`nameOf`. `labelOf` is one line over
  `nameOf`, for the surfaces that must say something; the textbox reads `nameOf`
  and shows nothing when it answers nothing.
- The self-heal on first render, and the list-revision dependency it rode on →
  a counter beside the registry. Learning a name is the only event, so it is
  the only thing subscribed to.
- `filtering`, `searchable`, `showInputValue`/`setInputValue`, `settledText` and
  `openFiltered` → one `asked` signal. The list is narrowed by it, `search` is
  asked for it, and the element is written from it, so those three cannot come
  apart. Opening no longer says anything about the box, which is what the click
  that repositioned a caret was tripping.
- The seeding effect's `setup`/`changed`/`stale` guesswork → one effect that
  writes only its own last write, and reports an input change for everything
  except a name being learned.
- The `!core.multiple` guard → `shownValue`, one definition of which value the
  box is showing. A multiple shows none, so the naming code has no branch for
  it, and its chips get names from the same registry as everything else.

Decided along the way, and defended in `defaultValue`: a bare
`{ name, defaultValue: 'ba' }` leaves the box empty rather than showing `ba`. A
textbox holds text somebody could have typed — it is filtered on, searched for,
completed from, and committed with `allowCustomValue` — so an identifier there
is not a label that reads oddly, it is the component answering for the user.
That is what aborted the `minLength: 0` preload: the seed wrote a query nobody
asked. The value is held, submitted and reported by `value()` throughout, and
the box fills in by itself the moment anything can name it.

The four defects introduced by the earlier rounds are gone with it, each with a
test that fails without the change: the aborted preload, `toggleValue` refusing
to remove on a single-value widget, the seeding effect rewriting typed text, and
`readOnly` no longer returning early from `select`. A press on an option now
takes rather than toggles when only one value is held, which is the neighbour
that fix would otherwise have broken.

Not exported yet. What it is waiting on is a round of adversarial review that
finds nothing, rather than a named defect.

## inputs

Went from one unfixed finding to two across three rounds — the only one of the
four that got further from shipping each time. Focus after a removal was the
coupled part: `removeAt` was fixed and `clear()` was not, and the fix for one
kept moving the problem into the other. It is now one rule in one place rather
than a guard at each call site.

The rule: when the tag holding focus is destroyed, focus goes to the tag that
took its place — the row closes up leftwards, so that is the one the eye is
already on — to the last tag when the row is now shorter than that, to the text
box when no tag is left, and to the row itself when even the box refuses it, as
a disabled field's does. `<body>` is the one answer never given, because it is
the top of the document and the next Tab would start again from there.

It is applied where every removal meets. The row is rendered from the value, so
`removeAt`, `clear()` and a write to a value signal the consumer owns all
arrive as a change to it; a guard on the two methods answers for the two of
them alone, and the third has no call site to put one on. `list` is required
now for the same reason: focus is placed from the row, and a field that cannot
see its row has nowhere to put it back.

The row's single tab stop is the same question asked about the *next* Tab, so
it follows the same rule. It is read back clamped to the row rather than
written at each removal — `clear()` used to hand it back to the first tag and
`removeAt` did not, so a removal that shortened the row under the stop left
every tag at `tabindex="-1"` and the whole row unreachable by Tab.

Covered by tests that fail without the model: the stop after `removeAt` takes
the tag holding it, and after a consumer write shortens the row; and the
hand-off landing on the row when a disabled field's box will not take focus.
The three the rule exists for — `removeAt` on the focused tag, `clear()` while
one holds focus, and the last tag going — were already covered and still are.

Two things found while redesigning it, neither about where focus goes, and both
left as found:

- `clear()` removes while `disabled` or `readOnly`, where `removeAt` refuses.
  That is a question about whether a removal is allowed at all. Focus is placed
  either way now, so nothing lands on `<body>` because of it.
- `clear()` writes nothing to the live region, where `removeAt` announces
  "ada removed". Emptying the row is the largest change the field makes and the
  only one it makes silently.

## slider-upload

Closest of the three: every named defect fixed, one neighbour broken each
round, until the dirty model was redesigned rather than patched again.

It used to infer dirtiness from who wrote the value — a boolean set from the
`input` and `change` events the mirrors fired — so a write nothing announced
did not count, and a restored session submitted a value while `isDirty()` read
false and `data-dirty` was absent.

It now compares two states and asks nothing about their authors: what a submit
would send, against what a reset would restore. The value a submit would send
is read from the mirrors on every call, because assigning to `value` announces
nothing and a sampled answer never sees it. The one record kept is the state
the value and the mirrors last agreed on, which is what says which of the two
moved: a mirror still holding it is a render behind and the value is newer,
and a mirror holding anything else was written from outside. That record is
what the same-tick tests are about — an `onValueChange` handler must not be
told the slider is back at its default while the form is not — and removing it
reddens seven of them.

Covered by tests that fail without the model: a keyboard change and the way
back to the default; a value written straight to a mirror with no event at
all, on the first thumb and on the one the field never validates; every thumb
of a range; and `field.reset()`, which now puts the mirrors back in step
rather than clearing a flag over a value the form would still send.

Two honest limits, neither of them the defect above:

- A silent write makes the slider dirty but does not move the thumb. `values()`
  is still the slider's own state, so a restored form reports itself unsaved
  while showing a value it will not submit. Adopting the mirror is the next
  question to settle, and it is a question about what the value *is*, not about
  what dirty means.
- A rendered `data-dirty` can only follow something that invalidates. `input`,
  `change` and `pageshow` cover autofill, session restore and the bfcache; a
  script that assigns `value` and fires nothing shows up on the next render for
  any reason. `isDirty()` itself is right the moment it is asked.

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
