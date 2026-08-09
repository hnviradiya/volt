/**
 * End-to-end: template source -> compiler -> DOM runtime -> real nodes,
 * driven through the public component API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@voltjs/core/jit';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  Signal,
  flushSync,
  mount,
  type OnDestroy,
  type OnInit,
} from '@voltjs/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

/** Mount, returning the host's HTML for convenient assertions. */
function render(component: Parameters<typeof mount>[0]) {
  const handle = mount(component, host);
  return {
    handle,
    get html() {
      return host.innerHTML;
    },
    click(selector: string) {
      host.querySelector<HTMLElement>(selector)!.click();
      flushSync();
    },
  };
}

describe('static templates', () => {
  it('renders plain markup', () => {
    @Component({ selector: 'v-static', template: `<h1 class="title">Hello</h1>` })
    class Static {}

    expect(render(Static).html).toBe('<h1 class="title">Hello</h1>');
  });

  it('renders nested elements and collapses insignificant whitespace', () => {
    @Component({
      selector: 'v-nested',
      template: `
        <div class="card">
          <h2>Title</h2>
          <p>Body</p>
        </div>
      `,
    })
    class Nested {}

    expect(render(Nested).html).toBe('<div class="card"><h2>Title</h2><p>Body</p></div>');
  });
});

describe('interpolation', () => {
  it('renders a signal and updates it in place', () => {
    @Component({ selector: 'v-count', template: `<span>{{ count.get() }}</span>` })
    class Counter {
      count = new Signal.State(1);
    }

    const view = render(Counter);
    expect(view.html).toBe('<span>1</span>');

    const instance = view.handle.instance as Counter;
    const textNode = host.querySelector('span')!.firstChild;

    instance.count.set(2);
    flushSync();
    expect(view.html).toBe('<span>2</span>');
    // The text node is patched, not replaced.
    expect(host.querySelector('span')!.firstChild).toBe(textNode);
  });

  it('folds a constant expression into the markup at build time', () => {
    @Component({ selector: 'v-const', template: `<span>{{ 2 + 3 }}</span>` })
    class Constant {}

    expect(render(Constant).html).toBe('<span>5</span>');
  });

  it('mixes static text with dynamic parts', () => {
    @Component({
      selector: 'v-mixed',
      template: `<p>Hello, {{ name.get() }}! You have {{ count.get() }} messages.</p>`,
    })
    class Mixed {
      name = new Signal.State('Ada');
      count = new Signal.State(3);
    }

    const view = render(Mixed);
    expect(view.html).toBe('<p>Hello, Ada! You have 3 messages.</p>');

    (view.handle.instance as Mixed).count.set(4);
    flushSync();
    expect(view.html).toBe('<p>Hello, Ada! You have 4 messages.</p>');
  });
});

describe('bindings', () => {
  it('binds properties and drops falsy boolean attributes', () => {
    @Component({
      selector: 'v-bind',
      template: `<input :value="text.get()" :disabled="off.get()">`,
    })
    class Bound {
      text = new Signal.State('hi');
      off = new Signal.State(false);
    }

    const view = render(Bound);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('hi');
    expect(input.disabled).toBe(false);

    (view.handle.instance as Bound).off.set(true);
    flushSync();
    expect(input.disabled).toBe(true);
  });

  it('merges a dynamic class without discarding static classes', () => {
    @Component({
      selector: 'v-class',
      template: `<div class="base" :class="{ active: on.get() }"></div>`,
    })
    class Classed {
      on = new Signal.State(false);
    }

    const view = render(Classed);
    const div = host.querySelector('div')!;
    expect(div.className).toBe('base');

    (view.handle.instance as Classed).on.set(true);
    flushSync();
    expect(div.classList.contains('base')).toBe(true);
    expect(div.classList.contains('active')).toBe(true);

    (view.handle.instance as Classed).on.set(false);
    flushSync();
    expect(div.classList.contains('base')).toBe(true);
    expect(div.classList.contains('active')).toBe(false);
  });

  it('binds styles from an object', () => {
    @Component({
      selector: 'v-style',
      template: `<div :style="{ color: color.get(), fontWeight: 'bold' }"></div>`,
    })
    class Styled {
      color = new Signal.State('red');
    }

    const view = render(Styled);
    const div = host.querySelector('div')!;
    expect(div.style.color).toBe('red');
    expect(div.style.fontWeight).toBe('bold');

    (view.handle.instance as Styled).color.set('blue');
    flushSync();
    expect(div.style.color).toBe('blue');
  });

  it('toggles visibility with :show without removing the node', () => {
    @Component({ selector: 'v-show', template: `<div :show="visible.get()">x</div>` })
    class Shown {
      visible = new Signal.State(true);
    }

    const view = render(Shown);
    const div = host.querySelector('div')!;
    expect(div.style.display).toBe('');

    (view.handle.instance as Shown).visible.set(false);
    flushSync();
    expect(div.style.display).toBe('none');
    expect(host.querySelector('div')).toBe(div);
  });
});

describe('events', () => {
  it('handles :click as an inline statement', () => {
    @Component({
      selector: 'v-click',
      template: `<button :click="inc()">{{ count.get() }}</button>`,
    })
    class Clicker {
      count = new Signal.State(0);
      inc() {
        this.count.set(this.count.get() + 1);
      }
    }

    const view = render(Clicker);
    expect(view.html).toBe('<button>0</button>');
    view.click('button');
    expect(view.html).toBe('<button>1</button>');
  });

  it('passes $event to inline handlers', () => {
    const seen: string[] = [];

    @Component({
      selector: 'v-event',
      template: `<button :click="record($event.type)"></button>`,
    })
    class Recorder {
      record(type: string) {
        seen.push(type);
      }
    }

    render(Recorder).click('button');
    expect(seen).toEqual(['click']);
  });

  it('applies event modifiers', () => {
    const inner = vi.fn();
    const outer = vi.fn();

    @Component({
      selector: 'v-modifiers',
      template: `
        <div :click="outer()">
          <button :click.stop="inner()"></button>
        </div>
      `,
    })
    class Modified {
      inner = inner;
      outer = outer;
    }

    render(Modified).click('button');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('removes listeners when the component unmounts', () => {
    const spy = vi.fn();

    @Component({ selector: 'v-cleanup', template: `<button :click="spy()"></button>` })
    class Cleanup {
      spy = spy;
    }

    const view = render(Cleanup);
    const button = host.querySelector('button')!;
    view.handle.unmount();

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe(':if', () => {
  it('renders and swaps branches', () => {
    @Component({
      selector: 'v-if',
      template: `
        <div>
          <span :if="value.get() > 5">big</span>
          <span :else-if="value.get() > 0">small</span>
          <span :else>none</span>
        </div>
      `,
    })
    class Conditional {
      value = new Signal.State(10);
    }

    const view = render(Conditional);
    const instance = view.handle.instance as Conditional;
    expect(view.html).toContain('big');

    instance.value.set(3);
    flushSync();
    expect(view.html).toContain('small');
    expect(view.html).not.toContain('big');

    instance.value.set(-1);
    flushSync();
    expect(view.html).toContain('none');
  });

  it('disposes the effects of a branch it leaves', () => {
    const cleanup = vi.fn();

    @Component({ selector: 'v-child', template: `<span>{{ label.get() }}</span>` })
    class Child implements OnDestroy {
      @Input() label = new Signal.State('x');
      onDestroy = cleanup;
    }

    @Component({
      selector: 'v-parent',
      template: `<div><v-child :if="show.get()"></v-child></div>`,
      imports: [Child],
    })
    class Parent {
      show = new Signal.State(true);
    }

    const view = render(Parent);
    expect(cleanup).not.toHaveBeenCalled();

    (view.handle.instance as Parent).show.set(false);
    flushSync();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe(':for', () => {
  it('renders a list and keeps keyed rows on reorder', () => {
    @Component({
      selector: 'v-list',
      template: `
        <ul>
          <li :for="item in items.get()" :key="item.id">{{ item.text }}</li>
        </ul>
      `,
    })
    class List {
      items = new Signal.State([
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
        { id: 3, text: 'c' },
      ]);
    }

    const view = render(List);
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(view.html).toContain('<li>a</li><li>b</li><li>c</li>');

    const [first, second, third] = [...host.querySelectorAll('li')];

    // Reverse: the same three elements must be reused, just reordered.
    (view.handle.instance as List).items.set([
      { id: 3, text: 'c' },
      { id: 2, text: 'b' },
      { id: 1, text: 'a' },
    ]);
    flushSync();

    const reordered = [...host.querySelectorAll('li')];
    expect(reordered).toEqual([third, second, first]);
    expect(view.html).toContain('<li>c</li><li>b</li><li>a</li>');
  });

  it('exposes a reactive index', () => {
    @Component({
      selector: 'v-indexed',
      template: `<ul><li :for="(item, i) in items.get()" :key="item">{{ i }}:{{ item }}</li></ul>`,
    })
    class Indexed {
      items = new Signal.State(['a', 'b']);
    }

    const view = render(Indexed);
    expect(view.html).toContain('<li>0:a</li><li>1:b</li>');

    // 'a' moves to index 1; its row is reused but the index binding updates.
    (view.handle.instance as Indexed).items.set(['b', 'a']);
    flushSync();
    expect(view.html).toContain('<li>0:b</li><li>1:a</li>');
  });

  it('adds and removes rows', () => {
    @Component({
      selector: 'v-grow',
      template: `<ul><li :for="n in items.get()" :key="n">{{ n }}</li></ul>`,
    })
    class Grow {
      items = new Signal.State([1, 2]);
    }

    const view = render(Grow);
    const instance = view.handle.instance as Grow;

    instance.items.set([1, 2, 3]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(3);

    instance.items.set([2]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(view.html).toContain('<li>2</li>');

    instance.items.set([]);
    flushSync();
    expect(host.querySelectorAll('li')).toHaveLength(0);
  });

  it('supports destructuring bindings', () => {
    @Component({
      selector: 'v-destructure',
      template: `<ul><li :for="{ id, name } in rows.get()" :key="id">{{ id }}-{{ name }}</li></ul>`,
    })
    class Destructured {
      rows = new Signal.State([{ id: 1, name: 'one' }]);
    }

    expect(render(Destructured).html).toContain('<li>1-one</li>');
  });
});

describe('components', () => {
  it('passes inputs reactively and emits outputs', () => {
    @Component({
      selector: 'v-child',
      template: `<button :click="bump()">{{ label.get() }}:{{ n.get() }}</button>`,
    })
    class Child {
      @Input() label = new Signal.State('');
      @Input() n = new Signal.State(0);
      @Output() bumped = new EventEmitter<number>();

      bump() {
        this.bumped.emit(this.n.get() + 1);
      }
    }

    @Component({
      selector: 'v-parent',
      template: `
        <div>
          <v-child :label="'count'" :n="value.get()" :on-bumped="onBump($event)"></v-child>
        </div>
      `,
      imports: [Child],
    })
    class Parent {
      value = new Signal.State(1);
      onBump(next: number) {
        this.value.set(next);
      }
    }

    const view = render(Parent);
    expect(view.html).toContain('count:1');

    view.click('button');
    expect(view.html).toContain('count:2');
  });

  it('projects content into slots', () => {
    @Component({
      selector: 'v-card',
      template: `
        <div class="card">
          <header><slot name="title">Untitled</slot></header>
          <main><slot></slot></main>
        </div>
      `,
    })
    class Card {}

    @Component({
      selector: 'v-page',
      template: `
        <v-card>
          <h1 :slot="'title'">Hello</h1>
          <p>Body content</p>
        </v-card>
      `,
      imports: [Card],
    })
    class Page {}

    const html = render(Page).html;
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>Body content</p>');
  });

  it('falls back to slot content when nothing is projected', () => {
    @Component({
      selector: 'v-card',
      template: `<div><slot name="title">Untitled</slot></div>`,
    })
    class Card {}

    @Component({ selector: 'v-page', template: `<v-card></v-card>`, imports: [Card] })
    class Page {}

    expect(render(Page).html).toContain('Untitled');
  });
});

describe('lifecycle', () => {
  it('runs onInit before render and onDestroy on unmount', () => {
    const order: string[] = [];

    @Component({ selector: 'v-life', template: `<span>{{ value.get() }}</span>` })
    class Life implements OnInit, OnDestroy {
      value = new Signal.State('initial');

      onInit() {
        order.push('init');
        this.value.set('from onInit');
      }

      onDestroy() {
        order.push('destroy');
      }
    }

    const view = render(Life);
    expect(order).toEqual(['init']);
    // onInit ran before the template was built, so its write is the first paint.
    expect(view.html).toBe('<span>from onInit</span>');

    view.handle.unmount();
    expect(order).toEqual(['init', 'destroy']);
  });
});

describe('two-way binding', () => {
  it(':model syncs an input with a signal', () => {
    @Component({
      selector: 'v-model',
      template: `<div><input :model="text"><span>{{ text.get() }}</span></div>`,
    })
    class Modelled {
      text = new Signal.State('a');
    }

    const view = render(Modelled);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('a');

    input.value = 'b';
    input.dispatchEvent(new Event('input'));
    flushSync();

    expect((view.handle.instance as Modelled).text.get()).toBe('b');
    expect(view.html).toContain('<span>b</span>');
  });
});
