import { describe, expect, it } from 'vitest';
import { compile } from '@voltjs/compiler';

/** Compile and return just the generated body, for readable snapshots. */
function gen(template: string): string {
  return compile(template).body;
}

describe('generated code shape', () => {
  it('emits a hoisted template and navigates to the marker', () => {
    expect(gen(`<span>{{ count.get() }}</span>`)).toMatchInlineSnapshot(`
      "const _tmpl0 = _rt.template("<span></span>");

      return function render(_ctx) {
        return (() => {
        const _el1 = _tmpl0();
        _rt.bindText(_el1, () => (_rt.toDisplayString(_ctx.count.get())));
        return _el1;
      })();
      };"
    `);
  });

  it('bakes fully static markup with no effects at all', () => {
    const result = compile(`<div class="a"><span>hi</span></div>`);
    expect(result.stats.effects).toBe(0);
    expect(result.templates).toEqual(['<div class="a"><span>hi</span></div>']);
  });

  it('folds constant bindings into the markup', () => {
    const result = compile(`<div :class="'btn'" :disabled="1 > 0">{{ 2 + 3 }}</div>`);
    expect(result.templates[0]).toBe('<div class="btn" disabled="">5</div>');
    expect(result.stats.effects).toBe(0);
    expect(result.stats.foldedBindings).toBe(3);
  });

  it('reuses one hoisted template for identical markup', () => {
    const result = compile(`
      <div>
        <p :if="a.get()"><b>same</b></p>
        <p :else><b>same</b></p>
      </div>
    `);
    expect(result.stats.dedupedTemplates).toBeGreaterThan(0);
  });

  it('walks siblings instead of restarting from the root', () => {
    const code = gen(`<div><a>{{ x.get() }}</a><b>{{ y.get() }}</b></div>`);
    // The second element is reached from the first, not from the root again.
    expect(code).toContain('.nextSibling');
    expect(code.match(/firstChild/g)?.length).toBeLessThanOrEqual(3);
  });

  it('prefixes free identifiers but leaves loop bindings and globals alone', () => {
    const code = gen(`<ul><li :for="item in items.get()" :key="item.id">{{ Math.max(item.n, 0) }}</li></ul>`);
    expect(code).toContain('_ctx.items.get()');
    expect(code).toContain('Math.max(');
    expect(code).not.toContain('_ctx.Math');
    // The loop binding resolves to its accessor, never to component scope.
    expect(code).toContain('item().n');
    expect(code).not.toMatch(/_ctx\.item\b/);
  });
});

describe(':class object literals compile to per-class toggles', () => {
  it('splits static keys into independent toggles', () => {
    const code = gen(`<div :class="{ danger: sel.get() === id, bold: on.get() }"></div>`);
    expect(code).toContain('_rt.bindClassToggle(_el1, "danger", () => (_ctx.sel.get() === _ctx.id))');
    expect(code).toContain('_rt.bindClassToggle(_el1, "bold", () => (_ctx.on.get()))');
    // No object is built, so nothing has to be normalised at runtime.
    expect(code).not.toContain('bindClass(');
  });

  it('accepts string-literal keys, including ones needing quoting', () => {
    const code = gen(`<div :class="{ 'is-open': open.get() }"></div>`);
    expect(code).toContain('_rt.bindClassToggle(_el1, "is-open", () => (_ctx.open.get()))');
  });

  it('counts the split in compile stats', () => {
    const { stats } = compile(`<div :class="{ a: x.get(), b: y.get() }"></div>`);
    expect(stats.classToggles).toBe(2);
  });

  for (const [why, expression] of [
    ['a plain string', `cls.get()`],
    ['an array', `[a.get(), b.get()]`],
    ['a spread', `{ ...base.get(), a: x.get() }`],
    ['a computed key', `{ [name.get()]: true }`],
    ['a key holding two classes', `{ 'a b': x.get() }`],
    ['duplicate keys', `{ a: x.get(), a: y.get() }`],
  ] as const) {
    it(`keeps the general binding for ${why}`, () => {
      const code = gen(`<div :class="${expression}"></div>`);
      expect(code).toContain('_rt.bindClass(');
      expect(code).not.toContain('bindClassToggle');
    });
  }
});
