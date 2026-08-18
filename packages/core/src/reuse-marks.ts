/**
 * Which of a keyed list's previous rows the reconcile in progress has reused.
 *
 * A `Set` answers the same question, and filling one per reconcile is a large
 * part of what a no-op reconcile of a long list costs — an entry allocated per
 * row, every pass, all of it garbage before the next frame. Stamping a reused
 * row with the pass's number instead reuses one Int32Array for the life of the
 * list and never has to clear it: a stamp left by an earlier pass does not
 * match the current generation, so it already reads as unclaimed.
 */

/**
 * The last generation an `Int32Array` can hold.
 *
 * One past it, `stamps[i] = generation` would store a wrapped negative and no
 * comparison against `generation` would ever match again — every row would
 * read as unclaimed and the whole list would be torn down and rebuilt on every
 * pass from then on. Reaching the top costs one clear and starts over instead.
 * At one reconcile per frame that is once in 414 days.
 */
const LAST_GENERATION = 0x7fffffff;

export interface ReuseMarks {
  /** Begin a pass over `size` previous rows, discarding the last pass's marks. */
  begin(size: number): void;
  /** Record that previous row `index` was reused by this pass. */
  claim(index: number): void;
  /** Was previous row `index` reused by this pass? */
  claimed(index: number): boolean;
}

/**
 * `firstGeneration` is a seam, not a feature: it lets a test start next to the
 * wrap and cross it. Nothing in the runtime passes it.
 */
export function createReuseMarks(firstGeneration = 0): ReuseMarks {
  let stamps = new Int32Array(0);
  let generation = firstGeneration;

  return {
    begin(size: number): void {
      // Grown with headroom, so a list that gains a row at a time does not
      // reallocate per row, and dropped back once a spike is well past, so a
      // list that peaked at 100k and settled at 50 does not hold 400 kB.
      if (stamps.length < size || (stamps.length > 32 && size * 4 < stamps.length)) {
        stamps = new Int32Array(size + (size >> 1) + 8);
      }

      if (generation === LAST_GENERATION) {
        stamps.fill(0);
        generation = 0;
      }
      generation++;
    },

    claim(index: number): void {
      stamps[index] = generation;
    },

    claimed(index: number): boolean {
      return stamps[index] === generation;
    },
  };
}
