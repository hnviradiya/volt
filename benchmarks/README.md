# Benchmarks

Two harnesses, because they measure different things.

## `pnpm bench` — update-path overhead (happy-dom)

Runs the js-framework-benchmark operations under happy-dom. Fast, runs in CI,
and catches regressions.

**It cannot measure create or clear.** happy-dom's DOM is JavaScript, and it
dominates those operations. The included control test makes the split
explicit:

| | 10,000 rows |
|---|---|
| Hand-written DOM, no framework | ~384 ms |
| Volt | ~413 ms |

Volt's own overhead on create is roughly **8%** of that total — the remaining
92% is the environment. Optimising against that number would mean optimising
happy-dom.

Where Volt's own work does dominate, the numbers are meaningful:

| Operation | Meaning |
|---|---|
| partial update | 100 of 1,000 rows change |
| select row | one class binding across 1,000 rows |
| swap rows | two rows move |
| remove row | one row leaves |

## `pnpm --filter @voltdev/benchmarks run dev` — real browser

The page for real numbers, with buttons for each operation and coarse
timings. Use DevTools' Performance panel for a breakdown.

For official comparisons, run Volt through the real
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
harness, which drives Chrome via WebDriver and controls for GC, warmup, and
paint. `src/bench-app.ts` is written to match the reference implementations
so it can be dropped in.
