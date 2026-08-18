/**
 * Unique ids for wiring ARIA relationships.
 *
 * The implementation moved to `@voltdev/core`, and with it the definition of
 * unique: an id is now derived from the component's position in the tree
 * rather than from a process-wide counter, because a counter numbers two
 * concurrent server renders out of the same sequence. Re-exported here
 * because every primitive that needs one asks a primitive for it.
 */

export { createId, resetIds } from '@voltdev/core';
