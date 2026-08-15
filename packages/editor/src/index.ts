/**
 * @voltjs/editor
 *
 * A rich text editor, engine included.
 *
 * Built in dependency order: document model and schema, then selection, then
 * input, then the interface — the interface being much the smallest part. The
 * hazards are recorded in ROADMAP.md; the ones that decide the design are
 * input-method composition, cross-browser selection, and whether collaborative
 * editing is ever wanted, since that cannot be added to a document model
 * afterwards.
 */

export const VERSION = '0.1.0';
