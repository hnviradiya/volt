/**
 * @voltjs/primitives
 *
 * Component behaviour and accessibility, with no styling of any kind.
 *
 * Around fifty components are assembled from a handful of shared behaviours —
 * presence, dismissal, focus scope, roving focus, collection, anchoring, form
 * field, virtualization. Those live here, and the components are largely
 * composition on top of them. Everything is built to the WAI-ARIA Authoring
 * Practices, including the full keyboard interaction map rather than roles
 * alone, because that is the part which cannot be retrofitted.
 */

export const VERSION = '0.1.0';
