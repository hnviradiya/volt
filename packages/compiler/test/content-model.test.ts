/**
 * Markup the HTML parser would rebuild is a compile error.
 *
 * Every path in generated code is a `firstChild`/`nextSibling` chain computed
 * from the authored tree, so a parser that inserts, moves or drops an element
 * leaves every path below it pointing at the wrong node — silently, because
 * bindings write rather than compare. These tests fix the line between markup
 * that is merely invalid (parsed as written, and therefore fine) and markup
 * that comes back a different shape.
 *
 * The rejected templates live in `corpus.ts`, next to the accepted ones,
 * because `template-markup.test.ts` holds this list to a second standard: each
 * entry must be markup a parser demonstrably rebuilds, and dropping the rule
 * that catches it must make a path check fail. Asserting only that these throw
 * would let a rule that outlaws perfectly good markup pass forever.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@voltdev/compiler';
import { AMBIGUOUS } from './corpus.js';

describe('markup a parser would rebuild', () => {
  for (const { why, template, remedy } of AMBIGUOUS) {
    it(`rejects ${why}`, () => {
      expect(() => compile(template)).toThrow(remedy);
    });
  }

  it('names the file and the line the element is on', () => {
    expect(() => compile(`<div>\n  <table>\n    <tr><td>a</td></tr>\n  </table>\n</div>`, {
      filename: 'src/report.html',
    })).toThrow(/src\/report\.html:3:5/);
  });
});

describe('markup that is invalid but parsed as written', () => {
  const accepted: [why: string, template: string][] = [
    ['a full table, written out', `<table><tbody><tr><td>a</td></tr></tbody></table>`],
    ['every section a table can hold', `<table><caption>c</caption><colgroup><col></colgroup><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>`],
    // The block a `:for` row compiles to is cloned inside a `<template>`,
    // whose insertion mode parses a bare row exactly as written.
    ['a row at the root of a block, which is how a row template arrives', `<tr><td>{ label.get() }</td></tr>`],
    ['a cell at the root of a block', `<td>{ label.get() }</td>`],
    ['whitespace between table sections', `<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>`],
    ['a list item outside a list, which every parser inserts as written', `<div><li>a</li></div>`],
    ['a sub-list inside a list item, which is how nesting is really written', `<ul><li>a<ul><li>b</li></ul></li></ul>`],
    ['a list inside a description, whose parent is the list and not the description', `<dl><dd><ul><li>a</li></ul></dd></dl>`],
    ['inline content inside a paragraph', `<p>Hello <em>there</em>, { name.get() }</p>`],
    ['options in a select', `<select :model="pick"><option value="a">A</option></select>`],
    ['an optgroup in a select', `<select><optgroup label="g"><option>a</option></optgroup></select>`],
    ['a script inside a table, which the parser leaves alone', `<table><script>void 0</script><tbody><tr><td>a</td></tr></tbody></table>`],
  ];

  for (const [why, template] of accepted) {
    it(`accepts ${why}`, () => {
      expect(() => compile(template)).not.toThrow();
    });
  }
});

describe('what the check deliberately cannot see', () => {
  it('accepts a component in a table, because its root element is unknowable here', () => {
    // Cross-module shape analysis is not in v1. Rejecting every component in
    // a table would outlaw the one construct tables are written with.
    expect(() =>
      compile(`<table><tbody><v-row :for="r in rows.get()" :key="r.id"></v-row></tbody></table>`),
    ).not.toThrow();
  });

  it('accepts a row inside a component, because the children land in a slot elsewhere', () => {
    expect(() => compile(`<v-card><tr><td>a</td></tr></v-card>`)).not.toThrow();
  });

  it('still checks through a grouping template, which contributes no element', () => {
    expect(() =>
      compile(`<table><tbody><template :for="r in rows.get()" :key="r.id"><tr><td>{ r.a }</td></tr></template></tbody></table>`),
    ).not.toThrow();
    expect(() =>
      compile(`<table><template :for="r in rows.get()" :key="r.id"><tr><td>{ r.a }</td></tr></template></table>`),
    ).toThrow(/Write the `<tbody>` yourself/);
  });

  it('leaves a portalled element to the container it lands in', () => {
    // It reserves no slot in this markup at all, so its tag says nothing
    // about the tree the paths here are resolved against.
    expect(() =>
      compile(`<table><tbody><tr><td><div :portal>modal</div></td></tr></tbody></table>`),
    ).not.toThrow();
  });
});
