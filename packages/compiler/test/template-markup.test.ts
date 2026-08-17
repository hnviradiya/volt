/**
 * The gate for server rendering: static markup must not move.
 *
 * A server emitter prints the same bytes the client clones, which is only true
 * for free if the two come from one structure. `Block` therefore holds chunks
 * and holes rather than a flat string list, and the client string is that
 * structure joined. Everything downstream — hydration paths, streaming
 * segments, mismatch reporting — is defined against these bytes, so a silent
 * change to any of them invalidates measurements taken after it.
 *
 * The baseline file was captured from the compiler as it stood before the
 * chunks-and-holes split and is not regenerated: it is the "today" the
 * refactor promised not to change. Update it only alongside a deliberate,
 * explained change to what the compiler emits.
 */

import { describe, expect, it } from 'vitest';
import {
  CHILD_MARKER,
  clientMarkup,
  compile,
  parse,
  rootArity,
  type CompileOptions,
  type TemplateBlock,
  type TemplateChildNode,
} from '@voltdev/compiler';
import { AMBIGUOUS, CORPUS } from './corpus.js';

/** Option sets that change emitted markup, so each needs its own baseline. */
const MODES: [name: string, options: CompileOptions][] = [
  ['default', {}],
  ['preserve-whitespace', { whitespace: 'preserve' }],
  ['keep-comments', { comments: true }],
];

function report(): string {
  const lines: string[] = [];
  for (const [mode, options] of MODES) {
    lines.push(`## ${mode}`, '');
    for (const { name, template } of CORPUS) {
      const result = compile(template, options);
      lines.push(`### ${name}`);
      for (const html of result.templates) lines.push(`  ${JSON.stringify(html)}`);
      if (result.templates.length === 0) lines.push('  (no markup)');
      const { stats } = result;
      lines.push(
        `  stats: templates=${stats.templates} deduped=${stats.dedupedTemplates} ` +
          `effects=${stats.effects} folded=${stats.foldedBindings} ` +
          `delegated=${stats.delegatedEvents} static=${stats.staticNodes} ` +
          `classToggles=${stats.classToggles}`,
        '',
      );
    }
  }
  return lines.join('\n');
}

describe('static markup across the corpus', () => {
  it('emits the same bytes it did before holes were recorded', async () => {
    await expect(report()).toMatchFileSnapshot('./__snapshots__/template-markup.txt');
  });
});

/** Every block the corpus produces, in every mode, with its origin. */
function everyBlock(): [where: string, block: TemplateBlock][] {
  const out: [string, TemplateBlock][] = [];
  for (const [mode, options] of MODES) {
    for (const { name, template } of CORPUS) {
      for (const block of compile(template, options).blocks) {
        out.push([`${mode}/${name}`, block]);
      }
    }
  }
  return out;
}

describe('chunks and holes describe the same markup the client clones', () => {
  it('joins back to exactly the hoisted templates, in the same order', () => {
    for (const [mode, options] of MODES) {
      for (const { name, template } of CORPUS) {
        const { blocks, templates } = compile(template, options);
        // First sight of an id is where its template was hoisted, so the
        // distinct joins are the hoisted list — same strings, same order.
        const joined = new Map(blocks.map((b) => [b.id, clientMarkup(b)]));
        expect([...joined.values()], `${mode}/${name}`).toEqual(templates);
      }
    }
  });

  it('leaves the markers to the holes rather than writing them into a chunk', () => {
    // The failure this catches is a `<!>` pushed as text: the bytes still
    // match, and the hole record a server needs is silently missing.
    for (const [where, block] of everyBlock()) {
      const markers = clientMarkup(block).split(CHILD_MARKER).length - 1;
      const childHoles = block.holes.filter((h) => h.kind === 'child').length;
      expect(markers, where).toBe(childHoles);
      for (const chunk of block.chunks) expect(chunk, where).not.toContain(CHILD_MARKER);
    }
  });

  it('keeps one chunk on each side of every hole', () => {
    for (const [where, block] of everyBlock()) {
      expect(block.chunks.length, where).toBe(block.holes.length + 1);
    }
  });

  it('costs nothing in bytes for attribute and content holes', () => {
    // They are what the client sets on the clone after cloning it. A byte
    // written for one would shift every path computed after it.
    for (const [where, block] of everyBlock()) {
      const childHoles = block.holes.filter((h) => h.kind === 'child').length;
      const bytes = block.chunks.join('').length + CHILD_MARKER.length * childHoles;
      expect(bytes, where).toBe(clientMarkup(block).length);
    }
  });
});

describe('what a hole records, per kind of dynamic part', () => {
  /**
   * Holes of the outermost block, which is the last one recorded: a block is
   * recorded when it finishes, and anything nested in it finishes first.
   */
  const holes = (template: string) => compile(template).blocks.at(-1)?.holes;

  it('opens one attribute hole per element, wherever the values are written', () => {
    for (const [tag, template] of [
      ['div', `<div :class="c.get()"></div>`],
      ['div', `<div :style="s.get()"></div>`],
      ['div', `<div :attr-data-x="v.get()"></div>`],
      ['input', `<input :value="v.get()">`],
      ['input', `<input :model="text">`],
      ['div', `<div :spread="p()"></div>`],
      // Four bindings, still one position: between the folded attributes and
      // the `>`.
      ['div', `<div class="a" :class="c.get()" :style="s.get()" :title="t.get()"></div>`],
    ] as const) {
      expect(holes(template), template).toEqual([{ kind: 'attribute', path: [0], tag }]);
    }
  });

  it('opens none for bindings that print nothing', () => {
    // A listener and a ref attach behaviour to the clone. Server markup is the
    // same bytes with or without them.
    expect(holes(`<div :click="go()" :keydown="k()" :ref="el"></div>`)).toEqual([]);
    expect(holes(`<div><span :portal>x</span></div>`)).toEqual([]);
  });

  it('opens a content hole where a binding owns everything between the tags', () => {
    for (const template of [
      `<div :text="t.get()"></div>`,
      `<div :html="h.get()"></div>`,
      `<div>Hi, { name.get() }</div>`,
      `<div><b :if="on.get()">x</b></div>`,
      `<div><v-child></v-child></div>`,
    ]) {
      expect(holes(template), template).toEqual([{ kind: 'content', path: [0], tag: 'div' }]);
    }
  });

  it('opens a child hole only where a marker is written', () => {
    expect(holes(`<div><b :if="on.get()">x</b><i>y</i></div>`)).toEqual([
      { kind: 'child', path: [0, 0] },
    ]);
    expect(holes(`<p>[{ v.get() }]<b>x</b></p>`)).toEqual([{ kind: 'child', path: [0, 1] }]);
  });

  it('opens both, in the order they are written, when an element has each', () => {
    expect(holes(`<div :class="c.get()">{ n.get() }</div>`)).toEqual([
      { kind: 'attribute', path: [0], tag: 'div' },
      { kind: 'content', path: [0], tag: 'div' },
    ]);
  });
});

/**
 * Walk a path the way generated code does, over the markup parsed the way
 * `template()` parses it.
 *
 * With one root the clone is the root element, which is path `[0]`; with
 * several it is the fragment holding them, which is path `[]`. Both make the
 * container the thing whose children index level 0.
 */
function container(block: TemplateBlock): Node {
  const el = document.createElement('template');
  const html = clientMarkup(block);
  el.innerHTML = block.isSvg ? `<svg>${html}</svg>` : html;
  return block.isSvg ? el.content.firstChild! : el.content;
}

function nodeAt(root: Node, path: readonly number[]): Node | null {
  let node: Node = root;
  for (const step of path) {
    const child = node.childNodes[step];
    if (!child) return null;
    node = child;
  }
  return node;
}

/**
 * Hold one block's markup to the tree its paths were computed against.
 *
 * Extracted because two callers need it for opposite reasons: over the corpus
 * every one of these must hold, and over `AMBIGUOUS` they are precisely what
 * breaks when a content-model rule is removed.
 */
function checkPaths(where: string, block: TemplateBlock): void {
  const root = container(block);
  // `rootCount` decides whether generated code takes the clone as an element
  // or as a fragment, and it is the number `:for` row arity is built on.
  expect(root.childNodes.length, `${where} root count`).toBe(block.rootCount);
  for (const hole of block.holes) {
    const node = nodeAt(root, hole.path);
    const at = `${where} at [${hole.path}]`;
    if (hole.kind === 'child') {
      expect(node?.nodeType, at).toBe(8 /* Comment */);
    } else {
      expect(node?.nodeType, at).toBe(1 /* Element */);
      expect((node as Element | null)?.localName.toLowerCase(), at).toBe(hole.tag.toLowerCase());
    }
  }
}

describe('every hole names a node the parser really builds', () => {
  it('finds the node each hole claims, and no more roots than it counted', () => {
    for (const [where, block] of everyBlock()) checkPaths(where, block);
  });
});

describe('the SVG flag, which is the context a block is parsed in', () => {
  /** The root element the same bytes produce, in each of the two contexts. */
  const namespaceOfRoot = (block: TemplateBlock, isSvg: boolean): string | null =>
    (container({ ...block, isSvg }).firstChild as Element).namespaceURI;

  it('is set on the block holding the `<svg>`, and not on a block below it', () => {
    // Pinned rather than repaired. A `:for` row or an `:if` branch inside an
    // `<svg>` compiles to a block of its own, and that block has been cloned in
    // HTML context since long before markup was recorded as chunks — the same
    // `template()` call, with the same argument missing — so correcting it
    // would move emitted code in a pass whose whole claim is that nothing
    // moved. It is asserted here because the helpers above read this flag to
    // choose a parse context: left unstated, the two corpus entries that
    // produce such blocks would be measured in a context nobody chose.
    const [row, host] = compile(
      `<svg><circle :for="p in ps.get()" :key="p" :attr-r="p"></circle></svg>`,
    ).blocks;
    expect(host!.isSvg).toBe(true);
    expect(row!.isSvg).toBe(false);

    // What the flag costs, stated rather than implied: one string, two elements.
    expect(namespaceOfRoot(row!, false)).toBe('http://www.w3.org/1999/xhtml');
    expect(namespaceOfRoot(row!, true)).toBe('http://www.w3.org/2000/svg');
  });
});

/**
 * The ancestors the document parser insists on before it will keep a tag.
 *
 * A `:for` row compiles to a block of its own, so a row of a table is a bare
 * `<tr>` — legal where it is written and dropped anywhere else. Supplying the
 * context on both sides is what makes the comparison about the markup rather
 * than about where a stray row landed.
 */
const CONTEXT: Record<string, readonly string[]> = {
  tr: ['table', 'tbody'],
  td: ['table', 'tbody', 'tr'],
  th: ['table', 'tbody', 'tr'],
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  caption: ['table'],
  colgroup: ['table'],
  col: ['table', 'colgroup'],
  option: ['select'],
  optgroup: ['select'],
};

/** Elements, text and comments, in order — everything a path can step through. */
function shape(node: Node): string {
  return [...node.childNodes]
    .map((n) => {
      if (n.nodeType === 8) return '<!---->';
      if (n.nodeType !== 1) return JSON.stringify(n.textContent);
      const tag = (n as Element).localName.toLowerCase();
      return `<${tag}>${shape(n)}</${tag}>`;
    })
    .join('');
}

/**
 * Parse a block's markup both ways it will really be parsed.
 *
 * The client sets it as a `<template>`'s contents, which has an insertion mode
 * of its own; a server writes the same bytes into a document, which does not.
 * Markup whose tree depends on which of the two happened has paths that are
 * right on one side and wrong on the other, and a page that renders correctly
 * until it is server-rendered is the worst version of this bug to find.
 */
function bothParses(block: TemplateBlock): [inDocument: string, inTemplate: string] {
  const chain = block.isSvg
    ? ['svg']
    : (CONTEXT[container(block).firstChild?.nodeName.toLowerCase() ?? ''] ?? []);
  const html =
    chain.map((t) => `<${t}>`).join('') +
    clientMarkup(block) +
    [...chain].reverse().map((t) => `</${t}>`).join('');

  const host = document.createElement('div');
  host.innerHTML = html;
  const tmpl = document.createElement('template');
  tmpl.innerHTML = html;
  return [shape(host), shape(tmpl.content)];
}

describe('the same bytes build the same tree in a document and in a template', () => {
  it('holds for every block the corpus produces', () => {
    for (const [where, block] of everyBlock()) {
      const [inDocument, inTemplate] = bothParses(block);
      expect(inDocument, where).toBe(inTemplate);
    }
  });
});

describe('root arity, which is what a server needs to decide row delimiters', () => {
  /** Arity of the outermost block — the last one recorded, as above. */
  const arity = (template: string) => rootArity(compile(template).blocks.at(-1)!);

  it('is the root count when nothing at the top level can widen', () => {
    expect(arity(`<div><b>{ a.get() }</b></div>`)).toBe(1);
    expect(arity(`<h1>a</h1><p>{ b.get() }</p>`)).toBe(2);
  });

  it('is unknown when a marker at the top level can hold any number of nodes', () => {
    // The marker stays and the value is inserted beside it, so the block is
    // one node wide plus however many the value resolved to.
    expect(arity(`{ a.get() }<b>x</b>`)).toBeNull();
  });

  it('is unaffected by a hole nested inside a root, which cannot widen it', () => {
    expect(arity(`<h1>a</h1><div><b :if="on.get()">x</b></div>`)).toBe(2);
  });
});

/**
 * The other half of the gate: what the corpus is allowed to leave out.
 *
 * Every measurement above is taken over templates that compile, so the
 * rejections are load-bearing — a rule that is too narrow lets a scrambled
 * tree into the corpus, and a rule that is too wide outlaws markup that was
 * never a problem. Both directions are checked here rather than assumed,
 * because `content-model.test.ts` on its own only says these throw, which a
 * rule rejecting `<div>` would also satisfy.
 *
 * For the entries marked `parserGap` only one direction is available: this
 * environment builds their authored tree, so nothing downstream can observe
 * what a browser would have done with them. They are held to their rejection
 * in a test of their own rather than folded in with the rest, so the file does
 * not claim evidence it has not got.
 */
describe('markup the corpus excludes, and why it has to', () => {
  /** Elements only: relocation moves elements, and paths are counted in nodes. */
  const authoredShape = (nodes: readonly TemplateChildNode[]): string =>
    nodes
      .filter((n) => n.type === 'element')
      .map((n) => `${n.tag.toLowerCase()}(${authoredShape(n.children)})`)
      .join('');

  const parsedShape = (el: Element): string =>
    [...el.children].map((c) => `${c.localName.toLowerCase()}(${parsedShape(c)})`).join('');

  for (const { why, template, parserGap } of AMBIGUOUS) {
    it(`${parserGap ? 'cannot show here that ' : 'is rebuilt by the parser: '}${why}`, () => {
      const host = document.createElement('div');
      host.innerHTML = template;
      const authored = authoredShape(parse(template).children);
      if (parserGap) expect(parsedShape(host), parserGap).toBe(authored);
      else expect(parsedShape(host), 'parsed as written, so the rule guards nothing').not.toBe(authored);
    });
  }

  it('would put a wrong node under every hole if any of it compiled', () => {
    // The one check that makes removing a rule expensive. With the rule gone
    // the template compiles, and what comes back is a block whose paths were
    // resolved against a tree no parser builds — so the corpus's own checks,
    // run here on markup that is supposed to be unreachable, fail.
    for (const { why, template, remedy } of AMBIGUOUS.filter((e) => !e.parserGap)) {
      let result;
      try {
        result = compile(template);
      } catch (error) {
        expect(String(error), why).toMatch(remedy);
        continue;
      }
      for (const block of result.blocks) {
        checkPaths(why, block);
        const [inDocument, inTemplate] = bothParses(block);
        expect(inDocument, why).toBe(inTemplate);
      }
    }
  });

  it('is held to the rejection alone where this parser cannot show the cost', () => {
    // The entries above are caught by their own damage; the rest are the ones
    // whose insertion modes happy-dom does not implement, and the check that
    // would catch their rules going missing is precisely the check this
    // environment cannot run — with the rule dropped they compile, and every
    // assertion above passes on them, because the tree here *is* the authored
    // one. So the rejection is what is left to hold them to, and it is held
    // beside the entries that carry their own evidence rather than only in
    // `content-model.test.ts`, so that a rule dropped from this half fails
    // where a reader is looking for the teeth.
    const excused = AMBIGUOUS.filter((e) => e.parserGap);
    expect(excused.length, 'the split above is empty and proves nothing').toBeGreaterThan(0);
    for (const { why, template, remedy } of excused) {
      expect(() => compile(template), why).toThrow(remedy);
    }
  });
});
