/**
 * The categories the first robustness pass skipped.
 *
 * Every mature framework's suite has a section for each of these, and they
 * are all places where a template engine can be subtly wrong rather than
 * loudly broken: how falsy values stringify, what an error in a binding does
 * to the rest of the tree, whether a component can render itself, and whether
 * teardown survives being triggered from inside a handler.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal, flushSync, mount, onCleanup } from '@voltdev/core';

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
// How values stringify — the classic source of quiet wrongness
// ---------------------------------------------------------------------------

describe('rendering non-string values', () => {
  function textFor(initial: unknown) {
    @Component({ selector: 'v-val', render: compileTemplate(`<p>[{ v.get() }]</p>`) })
    class Val {
      v = new Signal.State<unknown>(initial);
    }
    const handle = mount(Val, host);
    return {
      text: () => host.querySelector('p')!.textContent,
      set: (next: unknown) => {
        (handle.instance as Val).v.set(next);
        flushSync();
        return host.querySelector('p')!.textContent;
      },
    };
  }

  it('renders 0 rather than nothing', () => {
    // The classic falsy bug: `0` must not disappear.
    expect(textFor(0).text()).toBe('[0]');
  });

  it('renders an empty string for null and undefined', () => {
    expect(textFor(null).text()).toBe('[]');
    expect(textFor(undefined).text()).toBe('[]');
  });

  it('stringifies booleans, the same on every compile path', () => {
    // Only null and undefined render as nothing. An interpolation must not
    // display differently depending on whether the compiler took the
    // text-only path or punched a marker.
    expect(textFor(false).text()).toBe('[false]');
    expect(textFor(true).text()).toBe('[true]');

    @Component({
      selector: 'v-marker-path',
      render: compileTemplate(`<p>[{ v.get() }]<b>x</b></p>`),
    })
    class MarkerPath {
      v = new Signal.State<unknown>(false);
    }
    document.body.innerHTML = '<div id="marker"></div>';
    const other = document.querySelector('#marker') as HTMLElement;
    mount(MarkerPath, other);
    expect(other.querySelector('p')!.textContent).toBe('[false]x');
  });

  it('renders NaN and negative zero', () => {
    expect(textFor(Number.NaN).text()).toBe('[NaN]');
    expect(textFor(-0).text()).toBe('[0]');
  });

  it('serialises objects and arrays', () => {
    expect(textFor({ a: 1 }).text()).toBe('[{"a":1}]');
    expect(textFor([1, 2]).text()).toBe('[[1,2]]');
  });

  it('transitions between value kinds without stale text', () => {
    const v = textFor('start');
    expect(v.text()).toBe('[start]');
    expect(v.set(0)).toBe('[0]');
    expect(v.set(null)).toBe('[]');
    expect(v.set(false)).toBe('[false]');
    expect(v.set('back')).toBe('[back]');
  });

  it('renders adjacent interpolations with no separator', () => {
    @Component({
      selector: 'v-adj',
      render: compileTemplate(`<p>{ a.get() }{ b.get() }</p>`),
    })
    class Adjacent {
      a = new Signal.State('x');
      b = new Signal.State('y');
    }

    const view = render(Adjacent);
    expect(host.querySelector('p')!.textContent).toBe('xy');

    (view.handle.instance as Adjacent).a.set('1');
    flushSync();
    expect(host.querySelector('p')!.textContent).toBe('1y');
  });
});

// ---------------------------------------------------------------------------
// Boolean and nullish attribute values
// ---------------------------------------------------------------------------

describe('attribute value coercion', () => {
  function attrFor(initial: unknown) {
    @Component({
      selector: 'v-attr',
      render: compileTemplate(`<input :disabled="v.get()">`),
    })
    class Attr {
      v = new Signal.State<unknown>(initial);
    }
    const handle = mount(Attr, host);
    return {
      input: host.querySelector('input')!,
      set: (next: unknown) => {
        (handle.instance as Attr).v.set(next);
        flushSync();
      },
    };
  }

  it('treats falsy values as absent', () => {
    const { input, set } = attrFor(true);
    expect(input.disabled).toBe(true);

    for (const falsy of [false, null, undefined, 0, '']) {
      set(falsy);
      expect(input.disabled, `for ${String(falsy)}`).toBe(false);
    }
  });

  it('removes a nullish plain attribute rather than writing "null"', () => {
    @Component({
      selector: 'v-nullattr',
      render: compileTemplate(`<div :attr-data-x="v.get()"></div>`),
    })
    class NullAttr {
      v = new Signal.State<unknown>('here');
    }

    const view = render(NullAttr);
    const div = host.querySelector('div')!;
    expect(div.getAttribute('data-x')).toBe('here');

    (view.handle.instance as NullAttr).v.set(null);
    flushSync();
    expect(div.hasAttribute('data-x')).toBe(false);
  });

  it('drops style properties set to null', () => {
    @Component({
      selector: 'v-nullstyle',
      render: compileTemplate(`<div :style="{ color: c.get(), margin: '1px' }"></div>`),
    })
    class NullStyle {
      c = new Signal.State<string | null>('red');
    }

    const view = render(NullStyle);
    const div = host.querySelector('div')!;
    expect(div.style.color).toBe('red');

    (view.handle.instance as NullStyle).c.set(null);
    flushSync();
    expect(div.style.color).toBe('');
    expect(div.style.margin).toBe('1px');
  });
});

// ---------------------------------------------------------------------------
// Events beyond the happy path
// ---------------------------------------------------------------------------

describe('event edge cases', () => {
  it('honours .once', () => {
    const spy = vi.fn();

    @Component({
      selector: 'v-once',
      render: compileTemplate(`<button :click.once="spy()">go</button>`),
    })
    class Once {
      spy = spy;
    }

    render(Once);
    const button = host.querySelector('button')!;
    button.click();
    button.click();
    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('survives a handler that removes its own element', () => {
    @Component({
      selector: 'v-selfremove',
      render: compileTemplate(`
        <ul>
          <li :for="n in items.get()" :key="n">
            <button :click="drop(n)">{ n }</button>
          </li>
        </ul>
      `),
    })
    class SelfRemove {
      items = new Signal.State([1, 2, 3]);
      drop(n: number) {
        this.items.set(this.items.get().filter((x) => x !== n));
      }
    }

    render(SelfRemove);
    host.querySelectorAll('button')[1]!.click();
    flushSync();

    expect(host.textContent?.replaceAll(/\s+/g, '')).toBe('13');
  });

  it('lets a handler unmount the whole tree', () => {
    let handle: ReturnType<typeof mount>;

    @Component({
      selector: 'v-selfunmount',
      render: compileTemplate(`<button :click="bye()">go</button>`),
    })
    class SelfUnmount {
      bye() {
        handle.unmount();
      }
    }

    handle = mount(SelfUnmount, host);
    expect(() => {
      host.querySelector('button')!.click();
      flushSync();
    }).not.toThrow();
    expect(host.innerHTML).toBe('');
  });

  it('stops at .stop even through delegation', () => {
    const inner = vi.fn();
    const outer = vi.fn();

    @Component({
      selector: 'v-stopdeep',
      render: compileTemplate(`
        <div :click="outer()">
          <section>
            <button :click.stop="inner()">go</button>
          </section>
        </div>
      `),
    })
    class StopDeep {
      inner = inner;
      outer = outer;
    }

    render(StopDeep);
    host.querySelector('button')!.click();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Conditionals under stress
// ---------------------------------------------------------------------------

describe('conditional edge cases', () => {
  it('toggles repeatedly without leaking DOM', () => {
    @Component({
      selector: 'v-toggle',
      render: compileTemplate(`<div><span :if="on.get()">yes</span></div>`),
    })
    class Toggle {
      on = new Signal.State(false);
    }

    const view = render(Toggle);
    const instance = view.handle.instance as Toggle;

    for (let i = 0; i < 10; i++) {
      instance.on.set(true);
      flushSync();
      expect(host.querySelectorAll('span')).toHaveLength(1);
      instance.on.set(false);
      flushSync();
      expect(host.querySelectorAll('span')).toHaveLength(0);
    }
  });

  it('collapses several toggles in one batch to the final state', () => {
    @Component({
      selector: 'v-batchtoggle',
      render: compileTemplate(`<div><span :if="on.get()">yes</span></div>`),
    })
    class BatchToggle {
      on = new Signal.State(false);
    }

    const view = render(BatchToggle);
    const instance = view.handle.instance as BatchToggle;

    instance.on.set(true);
    instance.on.set(false);
    instance.on.set(true);
    flushSync();
    expect(host.querySelectorAll('span')).toHaveLength(1);
  });

  it('nests conditionals', () => {
    @Component({
      selector: 'v-nestedif',
      render: compileTemplate(`
        <div>
          <section :if="outer.get()">
            <b :if="inner.get()">both</b>
            <i :else>outer only</i>
          </section>
          <p :else>neither</p>
        </div>
      `),
    })
    class NestedIf {
      outer = new Signal.State(true);
      inner = new Signal.State(true);
    }

    const view = render(NestedIf);
    const instance = view.handle.instance as NestedIf;
    expect(view.html).toContain('both');

    instance.inner.set(false);
    flushSync();
    expect(view.html).toContain('outer only');

    instance.outer.set(false);
    flushSync();
    expect(view.html).toContain('neither');
  });

  it('disposes nested cleanups when an outer branch closes', () => {
    const cleaned = vi.fn();

    @Component({ selector: 'v-leaf', render: compileTemplate(`<b>leaf</b>`) })
    class Leaf {
      #bye = onCleanup(cleaned);
    }

    @Component({
      selector: 'v-outer',
      imports: [Leaf],
      render: compileTemplate(`
        <div>
          <section :if="outer.get()">
            <v-leaf :if="inner.get()"></v-leaf>
          </section>
        </div>
      `),
    })
    class Outer {
      outer = new Signal.State(true);
      inner = new Signal.State(true);
    }

    const view = render(Outer);
    expect(cleaned).not.toHaveBeenCalled();

    // Closing the outer branch must tear down what the inner one built.
    (view.handle.instance as Outer).outer.set(false);
    flushSync();
    expect(cleaned).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Recursion
// ---------------------------------------------------------------------------

describe('recursive components', () => {
  it('renders a tree that references itself', () => {
    interface Node {
      label: string;
      children: Node[];
    }

    @Component({
      selector: 'v-node',
      render: compileTemplate(`
        <li>
          <span>{ node.label }</span>
          <ul>
            <v-node :for="child in node.children" :key="child.label" :node="child"></v-node>
          </ul>
        </li>
      `),
    })
    class TreeNode {
      @Prop() node: Node = { label: '', children: [] };
    }

    // No self-import needed: a component always resolves its own selector.

    @Component({
      selector: 'v-tree',
      imports: [TreeNode],
      render: compileTemplate(`<ul><v-node :node="root"></v-node></ul>`),
    })
    class Tree {
      root: Node = {
        label: 'a',
        children: [
          { label: 'b', children: [{ label: 'c', children: [] }] },
          { label: 'd', children: [] },
        ],
      };
    }

    const view = render(Tree);
    expect(view.html).toContain('a');
    expect(view.html).toContain('b');
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('errors in user code', () => {
  it('reports a throwing binding without tearing down siblings', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    @Component({
      selector: 'v-throwing',
      render: compileTemplate(`<div><span>{ boom() }</span><b>sibling</b></div>`),
    })
    class Throwing {
      boom(): string {
        throw new Error('binding blew up');
      }
    }

    expect(() => render(Throwing)).not.toThrow();
    // The rest of the template still rendered.
    expect(host.innerHTML).toContain('sibling');
    spy.mockRestore();
  });

  it('keeps the app alive when an event handler throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    @Component({
      selector: 'v-throwhandler',
      render: compileTemplate(`<div><button :click="boom()">go</button><b>{ n.get() }</b></div>`),
    })
    class ThrowHandler {
      n = new Signal.State(1);
      boom() {
        throw new Error('handler blew up');
      }
    }

    const view = render(ThrowHandler);
    try {
      host.querySelector('button')!.click();
    } catch {
      // A handler throwing propagates; what matters is the tree survives it.
    }

    (view.handle.instance as ThrowHandler).n.set(2);
    flushSync();
    expect(view.html).toContain('<b>2</b>');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Degenerate templates
// ---------------------------------------------------------------------------

describe('degenerate templates', () => {
  it('accepts an empty template', () => {
    @Component({ selector: 'v-empty', render: compileTemplate(``) })
    class Empty {}
    expect(render(Empty).html).toBe('');
  });

  it('accepts a whitespace-only template', () => {
    @Component({ selector: 'v-ws', render: compileTemplate(`   \n  `) })
    class Ws {}
    expect(render(Ws).html).toBe('');
  });

  it('accepts a text-only template', () => {
    @Component({ selector: 'v-text', render: compileTemplate(`just text`) })
    class TextOnly {}
    expect(render(TextOnly).html).toBe('just text');
  });

  it('renders an element with no children', () => {
    @Component({ selector: 'v-bare', render: compileTemplate(`<div></div>`) })
    class Bare {}
    expect(render(Bare).html).toBe('<div></div>');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle ordering across a tree
// ---------------------------------------------------------------------------

describe('mount ordering', () => {
  it('mounts children before their parent', async () => {
    const order: string[] = [];

    @Component({ selector: 'v-child', render: compileTemplate(`<span>c</span>`) })
    class Child {
      onMount() {
        order.push('child');
      }
    }

    @Component({
      selector: 'v-parent',
      imports: [Child],
      render: compileTemplate(`<div><v-child></v-child></div>`),
    })
    class Parent {
      onMount() {
        order.push('parent');
      }
    }

    render(Parent);
    await new Promise<void>((r) => queueMicrotask(r));

    // Children are constructed first, so their hooks queue first.
    expect(order).toEqual(['child', 'parent']);
  });
});
