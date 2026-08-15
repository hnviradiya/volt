/**
 * Unique ids for wiring ARIA relationships.
 *
 * `aria-labelledby` and friends refer to elements by id, so a component that
 * renders twice on a page needs two distinct ids without the author supplying
 * them. A counter is enough: these never leave the document they are created
 * in, and are not expected to be stable across a reload.
 */

let counter = 0;

export function createId(prefix = 'volt'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Test seam: make ids predictable within a test. */
export function resetIdCounter(): void {
  counter = 0;
}
