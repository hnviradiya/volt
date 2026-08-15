/**
 * Robustness suite.
 *
 * The cases here are drawn from the areas Vue, Svelte, React, Solid and
 * Angular all keep dedicated tests for — list reconciliation, slots, forms,
 * SVG, nesting, and expression edge cases — because those are where template
 * engines break in ways unit tests of the happy path never reach.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Prop, Signal, flushSync, mount, onCleanup } from '@voltjs/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

function render(component: Parameters<typeof mount>[0]) {
  const handle = mount(component, host);
  return {
    handle,
    get html() {
      return host.innerHTML;
    },
  };
}

// ---------------------------------------------------------------------------
// Markup the parser has to survive
// ---------------------------------------------------------------------------

describe('markup edge cases', () => {
  it('renders void and self-closing elements', () => {
    @Component({
      selector: 'v-void',
      render: compileTemplate(`<div><br><hr /><img src="x.png"><input></div>`),
    })
    class Voids {}

    const html = render(Voids).html;
    expect(html).toContain('<br>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<img src="x.png">');
  });

  it('accepts single-quoted, double-quoted, and unquoted attributes', () => {
    @Component({
      selector: 'v-quotes',
      render: compileTemplate(`<div id=plain class="double" data-x='single'></div>`),
    })
    class Quotes {}

    const div = render(Quotes).handle && host.querySelector('div')!;
    expect(div.id).toBe('plain');
    expect(div.className).toBe('double');
    expect(div.getAttribute('data-x')).toBe('single');
  });

  it('preserves HTML entities', () => {
    @Component({
      selector: 'v-entities',
      render: compileTemplate(`<p>a &amp; b &lt; c &gt; d &nbsp;e</p>`),
    })
    class Entities {}

    const text = (render(Entities), host.querySelector('p')!.textContent!);
    expect(text).toContain('a & b < c > d');
  });

  it('keeps whitespace inside <pre>', () => {
    @Component({
      selector: 'v-pre',
      render: compileTemplate(`<pre>line1\n  line2</pre>`),
    })
    class Pre {}

    render(Pre);
    expect(host.querySelector('pre')!.textContent).toBe('line1\n  line2');
  });

  it('strips comments', () => {
    @Component({
      selector: 'v-comment',
      render: compileTemplate(`<div><!-- hidden -->visible</div>`),
    })
    class Commented {}

    expect(render(Commented).html).toBe('<div>visible</div>');
  });

  it('renders nested SVG with correct namespacing', () => {
    @Component({
      selector: 'v-svg',
      render: compileTemplate(
        `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>`,
      ),
    })
    class Svg {}

    render(Svg);
    const svg = host.querySelector('svg')!;
    const circle = host.querySelector('circle')!;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(circle.getAttribute('r')).toBe('4');
  });

  it('renders a multi-root template', () => {
    @Component({
      selector: 'v-multi',
      render: compileTemplate(`<h1>{ a.get() }</h1><p>{ b.get() }</p>`),
    })
    class Multi {
      a = new Signal.State('one');
      b = new Signal.State('two');
    }

    const view = render(Multi);
    expect(view.html).toBe('<h1>one</h1><p>two</p>');

    (view.handle.instance as Multi).b.set('changed');
    flushSync();
    expect(view.html).toBe('<h1>one</h1><p>changed</p>');
  });
});

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

describe('expression coverage', () => {
  it('handles ternaries, optional chaining, and nullish coalescing', () => {
    @Component({
      selector: 'v-expr',
      render: compileTemplate(
        `<p>{ user.get()?.name ?? 'anonymous' }|{ n.get() > 2 ? 'big' : 'small' }</p>`,
      ),
    })
    class Expr {
      user = new Signal.State<{ name: string } | null>(null);
      n = new Signal.State(1);
    }

    const view = render(Expr);
    expect(view.html).toContain('anonymous|small');

    (view.handle.instance as Expr).user.set({ name: 'Ada' });
    (view.handle.instance as Expr).n.set(5);
    flushSync();
    expect(view.html).toContain('Ada|big');
  });

  it('handles template literals and method calls in an expression', () => {
    @Component({
      selector: 'v-tpl',
      render: compileTemplate(`<p>{ \`\${name.get().toUpperCase()} (\${count.get()})\` }</p>`),
    })
    class Tpl {
      name = new Signal.State('ada');
      count = new Signal.State(2);
    }

    expect(render(Tpl).html).toContain('ADA (2)');
  });

  it('resolves globals without prefixing them to the component', () => {
    @Component({
      selector: 'v-globals',
      render: compileTemplate(`<p>{ Math.max(1, n.get()) }|{ JSON.stringify(o.get()) }</p>`),
    })
    class Globals {
      n = new Signal.State(7);
      o = new Signal.State({ a: 1 });
    }

    expect(render(Globals).html).toContain('7|{"a":1}');
  });

  it('supports an arrow function as an event handler', () => {
    const seen: number[] = [];

    @Component({
      selector: 'v-arrow',
      render: compileTemplate(`<button :click="() => record(3)">go</button>`),
    })
    class Arrow {
      record(n: number) {
        seen.push(n);
      }
    }

    render(Arrow);
    host.querySelector('button')!.click();
    flushSync();
    expect(seen).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// Lists — where reconciliation actually breaks
// ---------------------------------------------------------------------------

describe('list reconciliation', () => {
  @Component({
    selector: 'v-list',
    render: compileTemplate(`<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>`),
  })
  class List {
    items = new Signal.State<number[]>([1, 2, 3]);
  }

  const mutate = (next: number[]) => {
    const handle = mount(List, host);
    (handle.instance as List).items.set(next);
    flushSync();
    return host.textContent;
  };

  it('prepends', () => expect(mutate([0, 1, 2, 3])).toBe('0123'));
  it('appends', () => expect(mutate([1, 2, 3, 4])).toBe('1234'));
  it('removes from the middle', () => expect(mutate([1, 3])).toBe('13'));
  it('reverses', () => expect(mutate([3, 2, 1])).toBe('321'));
  it('swaps ends', () => expect(mutate([3, 2, 1])).toBe('321'));
  it('clears', () => expect(mutate([])).toBe(''));
  it('replaces wholesale', () => expect(mutate([7, 8, 9])).toBe('789'));
  it('shuffles', () => expect(mutate([2, 3, 1])).toBe('231'));

  it('goes empty and back again', () => {
    const handle = mount(List, host);
    const instance = handle.instance as List;

    instance.items.set([]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(0);

    instance.items.set([9, 8]);
    flushSync();
    expect(host.textContent).toBe('98');
  });

  it('renders a nested list', () => {
    @Component({
      selector: 'v-nested-list',
      render: compileTemplate(`
        <ul>
          <li :for="group in groups.get()" :key="group.id">
            <span>{ group.id }</span>
            <em :for="child in group.children" :key="child">{ child }</em>
          </li>
        </ul>
      `),
    })
    class Nested {
      groups = new Signal.State([
        { id: 'a', children: ['a1', 'a2'] },
        { id: 'b', children: ['b1'] },
      ]);
    }

    const view = render(Nested);
    expect(host.querySelectorAll('em')).toHaveLength(3);

    (view.handle.instance as Nested).groups.set([{ id: 'b', children: ['b1', 'b2'] }]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.querySelectorAll('em')).toHaveLength(2);
  });

  it('iterates a Set as well as an array', () => {
    @Component({
      selector: 'v-set',
      render: compileTemplate(`<ul><li :for="v in items.get()" :key="v">{ v }</li></ul>`),
    })
    class FromSet {
      items = new Signal.State<Set<string>>(new Set(['x', 'y']));
    }

    expect(render(FromSet).html).toContain('<li>x</li><li>y</li>');
  });

  it('survives a null list', () => {
    @Component({
      selector: 'v-null-list',
      render: compileTemplate(`<ul><li :for="v in items.get()" :key="v">{ v }</li></ul>`),
    })
    class NullList {
      items = new Signal.State<string[] | null>(null);
    }

    expect(render(NullList).html).toBe('<ul></ul>');
  });

  it('combines :if inside :for', () => {
    @Component({
      selector: 'v-mixed-list',
      render: compileTemplate(`
        <ul>
          <li :for="n in items.get()" :key="n">
            <b :if="n % 2 === 0">{ n } even</b>
            <i :else>{ n } odd</i>
          </li>
        </ul>
      `),
    })
    class Mixed {
      items = new Signal.State([1, 2, 3]);
    }

    const html = render(Mixed).html;
    expect(html).toContain('1 odd');
    expect(html).toContain('2 even');
    expect(html).toContain('3 odd');
  });
});

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

describe('slots', () => {
  it('projects into a slot rendered inside a loop', () => {
    @Component({
      selector: 'v-item',
      render: compileTemplate(`<li><slot></slot></li>`),
    })
    class Item {}

    @Component({
      selector: 'v-loop-slots',
      imports: [Item],
      render: compileTemplate(
        `<ul><v-item :for="n in items.get()" :key="n">n = { n }</v-item></ul>`,
      ),
    })
    class LoopSlots {
      items = new Signal.State([1, 2]);
    }

    const html = render(LoopSlots).html;
    expect(html).toContain('n = 1');
    expect(html).toContain('n = 2');
    expect(host.querySelectorAll('li')).toHaveLength(2);
  });

  it('keeps slot content reactive in the parent scope', () => {
    @Component({ selector: 'v-box', render: compileTemplate(`<div><slot></slot></div>`) })
    class Box {}

    @Component({
      selector: 'v-owner',
      imports: [Box],
      render: compileTemplate(`<v-box>{ label.get() }</v-box>`),
    })
    class Owner {
      label = new Signal.State('before');
    }

    const view = render(Owner);
    expect(view.html).toContain('before');

    (view.handle.instance as Owner).label.set('after');
    flushSync();
    expect(view.html).toContain('after');
  });
});

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

describe('props', () => {
  it('throws when a required prop is missing', () => {
    @Component({ selector: 'v-req', render: compileTemplate(`<p>{ id.get() }</p>`) })
    class Req {
      @Prop({ required: true }) id = new Signal.State('');
    }

    @Component({
      selector: 'v-req-host',
      imports: [Req],
      render: compileTemplate(`<div><v-req></v-req></div>`),
    })
    class Host {}

    expect(() => render(Host)).toThrow(/requires the prop "id"/);
  });

  it('honours an alias', () => {
    @Component({ selector: 'v-alias', render: compileTemplate(`<p>{ target.get() }</p>`) })
    class Aliased {
      @Prop({ alias: 'labelledBy' }) target = new Signal.State('none');
    }

    @Component({
      selector: 'v-alias-host',
      imports: [Aliased],
      render: compileTemplate(`<div><v-alias :labelledBy="'field'"></v-alias></div>`),
    })
    class Host {}

    expect(render(Host).html).toContain('field');
  });

  it('cannot alias to a structural directive name', () => {
    // `:for` always means a loop, so it can never reach a prop. The template
    // fails to compile rather than silently binding nothing.
    expect(() =>
      compileTemplate(`<div><v-alias :for="'field'"></v-alias></div>`),
    ).toThrow(/is not a loop/);
  });

  it('keeps a prop live across parent updates', () => {
    @Component({ selector: 'v-echo', render: compileTemplate(`<p>{ value.get() }</p>`) })
    class Echo {
      @Prop() value = new Signal.State(0);
    }

    @Component({
      selector: 'v-echo-host',
      imports: [Echo],
      render: compileTemplate(`<div><v-echo :value="n.get()"></v-echo></div>`),
    })
    class Host {
      n = new Signal.State(1);
    }

    const view = render(Host);
    expect(view.html).toContain('<p>1</p>');

    (view.handle.instance as Host).n.set(42);
    flushSync();
    expect(view.html).toContain('<p>42</p>');
  });
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

describe(':model', () => {
  function typeInto(selector: string, value: string) {
    const el = host.querySelector<HTMLInputElement>(selector)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    flushSync();
  }

  it('binds a checkbox', () => {
    @Component({
      selector: 'v-check',
      render: compileTemplate(`<input type="checkbox" :model="on">`),
    })
    class Check {
      on = new Signal.State(false);
    }

    const view = render(Check);
    const input = host.querySelector('input')!;
    expect(input.checked).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    flushSync();
    expect((view.handle.instance as Check).on.get()).toBe(true);
  });

  it('coerces a number input', () => {
    @Component({
      selector: 'v-num',
      render: compileTemplate(`<input type="number" :model="n">`),
    })
    class Num {
      n = new Signal.State<number | string>(0);
    }

    const view = render(Num);
    typeInto('input', '42');
    expect((view.handle.instance as Num).n.get()).toBe(42);
  });

  it('trims with the .trim modifier', () => {
    @Component({
      selector: 'v-trim',
      render: compileTemplate(`<input :model.trim="text">`),
    })
    class Trim {
      text = new Signal.State('');
    }

    const view = render(Trim);
    typeInto('input', '  padded  ');
    expect((view.handle.instance as Trim).text.get()).toBe('padded');
  });

  it('binds a select', () => {
    @Component({
      selector: 'v-select',
      render: compileTemplate(
        `<select :model="choice"><option value="a">A</option><option value="b">B</option></select>`,
      ),
    })
    class Sel {
      choice = new Signal.State('a');
    }

    const view = render(Sel);
    const select = host.querySelector('select')!;
    expect(select.value).toBe('a');

    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    flushSync();
    expect((view.handle.instance as Sel).choice.get()).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// Structure and nesting
// ---------------------------------------------------------------------------

describe('nesting and teardown', () => {
  it('renders deeply nested components', () => {
    @Component({ selector: 'v-leaf', render: compileTemplate(`<span>{ n.get() }</span>`) })
    class Leaf {
      @Prop() n = new Signal.State(0);
    }

    @Component({
      selector: 'v-branch',
      imports: [Leaf],
      render: compileTemplate(`<div><v-leaf :n="n.get()"></v-leaf></div>`),
    })
    class Branch {
      @Prop() n = new Signal.State(0);
    }

    @Component({
      selector: 'v-trunk',
      imports: [Branch],
      render: compileTemplate(`<main><v-branch :n="n.get()"></v-branch></main>`),
    })
    class Trunk {
      n = new Signal.State(5);
    }

    const view = render(Trunk);
    expect(view.html).toContain('<span>5</span>');

    (view.handle.instance as Trunk).n.set(6);
    flushSync();
    expect(view.html).toContain('<span>6</span>');
  });

  it('tears a whole subtree down on unmount', () => {
    const cleaned = vi.fn();

    @Component({ selector: 'v-leaf', render: compileTemplate(`<span>leaf</span>`) })
    class Leaf {
      #bye = onCleanup(cleaned);
    }

    @Component({
      selector: 'v-root',
      imports: [Leaf],
      render: compileTemplate(`<div><v-leaf :for="n in items.get()" :key="n"></v-leaf></div>`),
    })
    class Root {
      items = new Signal.State([1, 2, 3]);
    }

    const view = render(Root);
    expect(cleaned).toHaveBeenCalledTimes(0);

    view.handle.unmount();
    expect(cleaned).toHaveBeenCalledTimes(3);
  });

  it('swaps components through :if', () => {
    @Component({ selector: 'v-a', render: compileTemplate(`<span>A</span>`) })
    class A {}
    @Component({ selector: 'v-b', render: compileTemplate(`<span>B</span>`) })
    class B {}

    @Component({
      selector: 'v-switch',
      imports: [A, B],
      render: compileTemplate(`<div><v-a :if="first.get()"></v-a><v-b :else></v-b></div>`),
    })
    class Switcher {
      first = new Signal.State(true);
    }

    const view = render(Switcher);
    expect(view.html).toContain('A');

    (view.handle.instance as Switcher).first.set(false);
    flushSync();
    expect(view.html).toContain('B');
    expect(view.html).not.toContain('A');
  });
});
