/**
 * A block's static markup, recorded as chunks with holes between them.
 *
 * The client clones one string and patches the clone, so it wants the chunks
 * joined. A server writes bytes and values alternately, so it wants the seams.
 * Keeping one structure and deriving both is what makes them agree by
 * construction: `clientMarkup` is the only place the joined form is produced,
 * and a server emitter walks the same chunks and holes in the same order.
 *
 * A hole is a position, not a value. What fills it lives in the block's
 * effects, which already know the accessor and the path — so a hole carries
 * only what identifies it (`path`) and what a serializer needs before it can
 * look anything up (`tag`, which decides void elements and raw-text content).
 *
 * Only one of the three kinds occupies bytes in the client string. That is not
 * a detail: it is why static markup is byte-identical between the two emitters
 * without either of them being told about the other.
 */

/**
 * Dynamic content anchored to a comment marker.
 *
 * `<!>` in the client string, and the node `resolvePath` navigates to. Server
 * output is *n* nodes wide here, which is the whole reason hydration cannot
 * step past a hole with a plain `nextSibling`.
 */
export interface ChildHole {
  kind: 'child';
  /** Build-time child path of the marker within this block. */
  path: number[];
}

/**
 * Dynamic attributes on an element, written onto the clone rather than into
 * it, so the hole is zero-width in the client string.
 *
 * One hole per element, not per binding: they all serialize into the same
 * position, between the last folded attribute and the `>`.
 */
export interface AttributeHole {
  kind: 'attribute';
  /** Build-time child path of the element whose open tag this sits in. */
  path: number[];
  tag: string;
}

/**
 * An element whose entire content is written by one binding — `:text`,
 * `:html`, merged text children, or a single dynamic child.
 *
 * Also zero-width in the client string, because eliding the marker is exactly
 * what those cases buy. The server has no clone to patch afterwards, so the
 * bytes have to come from here.
 */
export interface ContentHole {
  kind: 'content';
  /** Build-time child path of the element whose children these are. */
  path: number[];
  tag: string;
}

export type TemplateHole = ChildHole | AttributeHole | ContentHole;

/** The static markup of one block, and where its dynamic parts go. */
export interface TemplateBlock {
  /** Hoisted cloner this markup was assigned; shared when markup is deduped. */
  id: string;
  /** Static markup between holes. Always `holes.length + 1` entries. */
  chunks: readonly string[];
  holes: readonly TemplateHole[];
  /** Top-level nodes the markup produces — 1 unless the block is a fragment. */
  rootCount: number;
  isSvg: boolean;
}

/** The comment marker a child hole leaves in the cloned markup. */
export const CHILD_MARKER = '<!>';

/**
 * How many top-level nodes this block occupies once built, or null when that
 * is not fixed at build time.
 *
 * `rootCount` counts slots in the static markup, which is the same number only
 * while nothing at the top level can widen: an `insert` keeps its marker *and*
 * adds however many nodes the value resolved to beside it. Everything else —
 * attributes, and content written inside an element — stays within a slot the
 * markup already reserved.
 */
export function rootArity(block: Pick<TemplateBlock, 'rootCount' | 'holes'>): number | null {
  const widens = block.holes.some((h) => h.kind === 'child' && h.path.length === 1);
  return widens ? null : block.rootCount;
}

/** Accumulates chunks and holes in document order. */
export class MarkupBuilder {
  readonly chunks: string[] = [''];
  readonly holes: TemplateHole[] = [];

  push(text: string): void {
    this.chunks[this.chunks.length - 1] += text;
  }

  hole(hole: TemplateHole): void {
    this.holes.push(hole);
    this.chunks.push('');
  }
}

/**
 * Join a block back into the single string the client clones.
 *
 * Only child holes contribute bytes; the other two are filled by effects
 * running against the clone, so they must serialize to nothing at all — a
 * stray byte here would shift every path computed after it.
 */
export function clientMarkup(markup: Pick<MarkupBuilder, 'chunks' | 'holes'>): string {
  let out = markup.chunks[0] ?? '';
  for (let i = 0; i < markup.holes.length; i++) {
    if (markup.holes[i]!.kind === 'child') out += CHILD_MARKER;
    out += markup.chunks[i + 1] ?? '';
  }
  return out;
}
