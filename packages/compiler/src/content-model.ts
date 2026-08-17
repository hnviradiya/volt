/**
 * Markup an HTML parser would not build the way it is written.
 *
 * Volt resolves every dynamic node by a `firstChild`/`nextSibling` path
 * computed from the authored tree. That is sound only while the tree a browser
 * builds from the emitted string matches the tree the compiler read. For a
 * handful of tags it does not: the parser has insertion modes that insert
 * elements the author left out, close elements early, or move content
 * elsewhere. `<table><tr>` gains a `<tbody>`; `<p><div>` ends the paragraph
 * first; `<table><div>` is foster-parented out in front of the table; a
 * `<div>` inside `<select>` is discarded.
 *
 * Every path below such a node is then wrong, and nothing says so — the clone
 * is simply a different shape, and bindings write to whatever they land on.
 * This is already a client bug. Server rendering makes it much worse: the same
 * string is parsed in document context on the way in, where insertion modes a
 * `<template>`'s contents escape do apply, so the page arrives visibly
 * scrambled rather than subtly mis-bound.
 *
 * Most of these are demonstrable in the test environment — happy-dom inserts
 * the `<tbody>`, closes the `<p>`, ends the `<li>` and foster-parents an
 * element — and `template-markup.test.ts` holds each rule to that. Two are
 * not: happy-dom leaves text inside a table where it is written, and has no
 * "in select" insertion mode, so the text rules and the `<select>` rule rest
 * on the specification rather than on a demonstration, and say so where they
 * are listed.
 *
 * So it is prevented rather than repaired, following `:for`-without-`:key`: a
 * compile error naming the remedy, at build time, in the file the template
 * lives in.
 *
 * The rule for what belongs here is narrow on purpose — **the parsed tree
 * differs from the authored tree**, not merely "the content model forbids it".
 * `<div><li>` is invalid HTML that every parser inserts exactly as written, so
 * rejecting it would be inventing a failure. Two further limits are
 * deliberate: a component's root element is unknown here (no cross-module
 * shape analysis in v1), and an element at the root of a block is accepted
 * whatever it is, because that markup is cloned inside a `<template>`, whose
 * "in template" insertion mode parses `<tr>` and `<td>` fragments as written.
 */

import type { ElementNode, RootNode, TemplateChildNode } from './ast.js';
import { CompilerError } from './parser.js';

/** Where the parser insists these live, whatever the author wrote. */
const REQUIRED_PARENTS: Record<string, string[]> = {
  tr: ['thead', 'tbody', 'tfoot'],
  td: ['tr'],
  th: ['tr'],
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  caption: ['table'],
  colgroup: ['table'],
  col: ['colgroup'],
};

/**
 * What these may contain. Anything else is moved out or dropped.
 *
 * `<script>` and `<template>` are allowed everywhere the spec allows them, and
 * `<form>` inside a table, because the parser keeps all three in place.
 */
const ALLOWED_CHILDREN: Record<string, string[]> = {
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'form', 'script', 'style', 'template'],
  thead: ['tr', 'script', 'template'],
  tbody: ['tr', 'script', 'template'],
  tfoot: ['tr', 'script', 'template'],
  tr: ['td', 'th', 'script', 'template'],
  colgroup: ['col', 'template'],
  select: ['option', 'optgroup', 'hr', 'script', 'template'],
  optgroup: ['option', 'script', 'template'],
};

/** Elements whose non-whitespace text the parser moves out in front of them. */
const FOSTERS_TEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);

/**
 * Start tags that close an open `<p>` before being inserted.
 *
 * This is the parser's list, not the content model's: `<p><em>` is fine,
 * `<p><div>` is an empty paragraph followed by a sibling.
 */
const CLOSES_PARAGRAPH = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'dd', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'menu',
  'nav', 'ol', 'p', 'pre', 'search', 'section', 'summary', 'table', 'ul', 'xmp',
]);

/**
 * Start tags that end an element already open, rather than nesting inside it.
 *
 * A sub-list is written `<li><ul><li>`, where the inner item's parent is the
 * list — so looking only at the immediate parent separates the nesting that
 * works from the nesting that silently becomes two siblings.
 */
const CLOSES_OPEN: Record<string, string[]> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  option: ['option'],
};

/** What to write instead, per tag the parser relocates. */
const REMEDIES: Record<string, string> = {
  tr: 'Write the `<tbody>` yourself. The parser inserts one otherwise, and every\n  path underneath it shifts down a level.',
  td: 'Put the cell in a `<tr>`.',
  th: 'Put the cell in a `<tr>`.',
  col: 'Put the column in a `<colgroup>`.',
};

export function validateContentModel(root: RootNode, filename?: string): void {
  walk(root.children, null, filename);
}

function walk(
  nodes: TemplateChildNode[],
  parent: ElementNode | null,
  filename?: string,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'comment':
        // Comments are inserted where they are written in every mode.
        continue;

      case 'text': {
        if (parent && node.content.trim() && FOSTERS_TEXT.has(tagOf(parent))) {
          fail(
            `Text inside \`<${parent.tag}>\` is moved out in front of the table by the HTML\n` +
              '  parser, so it renders above the table and shifts every path below it.\n' +
              '  Put it in a `<td>` or `<th>`.',
            node,
            filename,
          );
        }
        continue;
      }

      case 'interpolation': {
        if (parent && FOSTERS_TEXT.has(tagOf(parent))) {
          fail(
            `An interpolation inside \`<${parent.tag}>\` renders text the HTML parser moves out\n` +
              '  in front of the table.\n' +
              '  Put it in a `<td>` or `<th>`.',
            node,
            filename,
          );
        }
        continue;
      }

      // A slot's fallback renders where the slot is, so it keeps this context.
      case 'slot-outlet':
        walk(node.children, parent, filename);
        continue;

      case 'element': {
        // A `<template>` groups children without contributing an element, and
        // a portalled element lands in a container this template knows nothing
        // about — both leave their children with someone else's context.
        if (node.isTemplate) {
          walk(node.children, parent, filename);
          continue;
        }
        if (node.directives.some((d) => d.kind === 'portal')) {
          walk(node.children, null, filename);
          continue;
        }

        if (!node.isComponent) check(node, parent, filename);
        // A component's children are projected into a slot elsewhere, so its
        // tag says nothing about where they end up.
        walk(node.children, node.isComponent ? null : node, filename);
        continue;
      }
    }
  }
}

function check(node: ElementNode, parent: ElementNode | null, filename?: string): void {
  const tag = tagOf(node);

  // At the root of a block there is no parent to disagree with, and a
  // component parent is unknowable.
  if (!parent || parent.isComponent) return;

  const parentTag = tagOf(parent);

  const required = REQUIRED_PARENTS[tag];
  if (required && !required.includes(parentTag)) {
    const wanted = list(required);
    fail(
      `\`<${tag}>\` must be inside ${wanted}, not \`<${parent.tag}>\`.\n` +
        '  A browser rebuilds this: the element is wrapped, moved or dropped, so the\n' +
        '  tree paths were resolved against is not the tree that renders.\n' +
        `  ${REMEDIES[tag] ?? `Put it inside ${wanted}.`}`,
      node,
      filename,
    );
  }

  const allowed = ALLOWED_CHILDREN[parentTag];
  if (allowed && !allowed.includes(tag)) {
    fail(
      `\`<${tag}>\` cannot be a child of \`<${parent.tag}>\`.\n` +
        (parentTag === 'select' || parentTag === 'optgroup'
          ? '  The HTML parser discards it entirely — the element never reaches the DOM,\n' +
            `  on the server or in the browser.\n` +
            `  A \`<select>\` holds ${list(allowed)}; style those instead of wrapping them.`
          : '  The HTML parser moves it out in front of the table, so it renders above\n' +
            '  the table and every path below it shifts.\n' +
            `  A \`<${parent.tag}>\` holds ${list(allowed)}.`),
      node,
      filename,
    );
  }

  if (CLOSES_OPEN[tag]?.includes(parentTag)) {
    fail(
      `\`<${tag}>\` inside \`<${parent.tag}>\` ends it rather than nesting in it.\n` +
        '  A browser closes the outer one at this tag and makes the two siblings, which\n' +
        '  is not the tree written here.\n' +
        `  Close the \`<${parent.tag}>\` first` +
        (tag === 'li' ? ', or wrap the sub-list in its own `<ul>` or `<ol>`.' : '.'),
      node,
      filename,
    );
  }

  if (parentTag === 'p' && CLOSES_PARAGRAPH.has(tag)) {
    fail(
      `\`<${tag}>\` inside \`<p>\` ends the paragraph before it starts.\n` +
        '  A browser closes the `<p>` at this tag and makes the two siblings, which is\n' +
        '  not the tree written here.\n' +
        `  Close the \`<p>\` before the \`<${tag}>\`, or use a \`<div>\` if it was meant to\n` +
        '  wrap it.',
      node,
      filename,
    );
  }
}

function tagOf(node: ElementNode): string {
  return node.tag.toLowerCase();
}

function list(tags: string[]): string {
  const quoted = tags.map((t) => `\`<${t}>\``);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

function fail(
  message: string,
  node: { loc: { line: number; column: number } },
  filename?: string,
): never {
  throw new CompilerError(message, node.loc, undefined, filename);
}
