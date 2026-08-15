import { describe, expect, it } from 'vitest';
import { compile } from '@voltjs/compiler';

/** Compile and return just the generated body, for readable snapshots. */
function gen(template: string): string {
  return compile(template).body;
}

describe('generated code shape', () => {
  it('emits a hoisted template and navigates to the marker', () => {
    expect(gen(`<span>{ count.get() }</span>`)).toMatchInlineSnapshot(`
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
    const result = compile(`<div :class="'btn'" :disabled="1 > 0">{ 2 + 3 }</div>`);
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
    const code = gen(`<div><a>{ x.get() }</a><b>{ y.get() }</b></div>`);
    // The second element is reached from the first, not from the root again.
    expect(code).toContain('.nextSibling');
    expect(code.match(/firstChild/g)?.length).toBeLessThanOrEqual(3);
  });

  it('prefixes free identifiers but leaves loop bindings and globals alone', () => {
    const code = gen(`<ul><li :for="item in items.get()" :key="item.id">{ Math.max(item.n, 0) }</li></ul>`);
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

describe('event delegation is limited to events it suits', () => {
  it('delegates a click, which many elements have and which fires once', () => {
    expect(gen(`<button :click="go()"></button>`)).toContain('_rt.delegate(');
  });

  for (const [why, event] of [
    ['browsers force document wheel listeners to be passive', 'wheel'],
    ['and document touch listeners too', 'touchstart'],
    ['and touchmove', 'touchmove'],
  ] as const) {
    it(`uses a direct listener for :${event}, because ${why}`, () => {
      const code = gen(`<div :${event}.prevent="go()"></div>`);
      // Delegated, this would compile to a listener whose preventDefault is
      // discarded — the bug is silent apart from a console warning.
      expect(code).toContain('_rt.on(');
      expect(code).not.toContain('_rt.delegate(');
    });
  }

  for (const event of ['pointermove', 'mousemove', 'dragover', 'mouseover'] as const) {
    it(`uses a direct listener for :${event}, which fires too often to walk the tree`, () => {
      const code = gen(`<div :${event}="go()"></div>`);
      expect(code).toContain('_rt.on(');
      expect(code).not.toContain('_rt.delegate(');
    });
  }

  it('still lets an explicit listener option force a direct listener', () => {
    expect(gen(`<button :click.once="go()"></button>`)).toContain('_rt.on(');
  });
});

describe('components that cannot render on first paint', () => {
  const deferrable = (template: string) => compile(template).deferrable.sort();

  it('finds a component reachable only behind a condition', () => {
    expect(deferrable(`<div><v-chart :if="open.get()"></v-chart></div>`)).toEqual(['v-chart']);
  });

  it('finds one reachable only through a portal', () => {
    expect(deferrable(`<div><v-dialog :portal></v-dialog></div>`)).toEqual(['v-dialog']);
  });

  it('leaves out a component rendered directly', () => {
    expect(deferrable(`<div><v-header></v-header></div>`)).toEqual([]);
  });

  it('leaves out one used both ways', () => {
    // A single direct occurrence puts it on the first-paint path, so splitting
    // it would add a round trip to the critical path.
    expect(
      deferrable(`<div><v-icon></v-icon><v-icon :if="x.get()"></v-icon></div>`),
    ).toEqual([]);
  });

  it('sees through nesting to the component inside', () => {
    expect(
      deferrable(`<div><section :if="open.get()"><v-chart></v-chart></section></div>`),
    ).toEqual(['v-chart']);
  });

  it('counts an else branch as conditional too', () => {
    expect(
      deferrable(`<div><b :if="x.get()">a</b><v-fallback :else></v-fallback></div>`),
    ).toEqual(['v-fallback']);
  });

  it('does not treat a list as deferrable', () => {
    // A list is very often non-empty on first render. Being wrong about a
    // dialog costs nothing; being wrong here costs a round trip.
    expect(
      deferrable(`<ul><v-row :for="r in rows.get()" :key="r.id"></v-row></ul>`),
    ).toEqual([]);
  });

  it('reports several independent ones', () => {
    expect(
      deferrable(
        `<div><v-a :if="x.get()"></v-a><v-b :portal></v-b><v-c></v-c></div>`,
      ),
    ).toEqual(['v-a', 'v-b']);
  });
});
