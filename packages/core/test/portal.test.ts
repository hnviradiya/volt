/**
 * `:portal` — rendering into a different container.
 *
 * The two properties that make a portal usable for a dialog are not about
 * where the nodes land. They are that context still resolves from where the
 * content was *declared*, and that disposing the declaring component disposes
 * the portalled content wherever it went. Both follow from context and
 * ownership living on the reactive scope rather than on the DOM tree, and both
 * are what a portal built on a virtual DOM has to work to preserve.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@volt/core/jit';
import {
  Component,
  Signal,
  createContext,
  flushSync,
  mount,
  provideContext,
  useContext,
} from '@volt/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="elsewhere"></div>';
  host = document.querySelector('#app')!;
});

describe('where the content lands', () => {
  it('defaults to the document body', () => {
    @Component({
      selector: 'v-p',
      render: compileTemplate(`<div><span :portal>hello</span></div>`),
    })
    class P {}

    mount(P, host);
    expect(host.querySelector('span')).toBeNull();
    expect(document.body.querySelector('span')?.textContent).toBe('hello');
  });

  it('accepts a selector string', () => {
    @Component({
      selector: 'v-p2',
      render: compileTemplate(`<div><span :portal="'#elsewhere'">hi</span></div>`),
    })
    class P {}

    mount(P, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('hi');
    expect(host.textContent).toBe('');
  });

  it('accepts an element', () => {
    @Component({
      selector: 'v-p3',
      render: compileTemplate(`<div><span :portal="target">hi</span></div>`),
    })
    class P {
      target = document.querySelector('#elsewhere')!;
    }

    mount(P, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('hi');
  });

  it('leaves no marker at the declaration site', () => {
    @Component({
      selector: 'v-p4',
      render: compileTemplate(`<div><b>a</b><span :portal>x</span><b>c</b></div>`),
    })
    class P {}

    mount(P, host);
    // The surrounding markup must come out as if the portal were not written.
    expect(host.querySelector('div')!.innerHTML).toBe('<b>a</b><b>c</b>');
  });

  it('keeps several portals into one container in declaration order', () => {
    @Component({
      selector: 'v-p5',
      render: compileTemplate(
        `<div><i :portal="'#elsewhere'">1</i><i :portal="'#elsewhere'">2</i></div>`,
      ),
    })
    class P {}

    mount(P, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('12');
  });

  it('reports a target that matches nothing', () => {
    @Component({
      selector: 'v-p6',
      render: compileTemplate(`<div><span :portal="'#missing'">x</span></div>`),
    })
    class P {}

    expect(() => mount(P, host)).toThrow(/matched no element/);
  });
});

describe('the properties a dialog depends on', () => {
  it('resolves context from where the content was declared, not where it lands', () => {
    const Theme = createContext('light');

    @Component({ selector: 'v-reader', render: compileTemplate(`<span>{ theme }</span>`) })
    class Reader {
      theme = useContext(Theme);
    }

    @Component({
      selector: 'v-provider',
      imports: [Reader],
      render: compileTemplate(`<div><v-reader :portal></v-reader></div>`),
    })
    class Provider {
      #ctx = provideContext(Theme, 'dark');
    }

    mount(Provider, host);
    // The span is under <body>, nowhere near the provider in the DOM.
    expect(document.body.querySelector('span')!.textContent).toBe('dark');
  });

  it('stays reactive after being moved', () => {
    @Component({
      selector: 'v-live',
      render: compileTemplate(`<div><span :portal>{ n.get() }</span></div>`),
    })
    class Live {
      n = new Signal.State(1);
    }

    const handle = mount(Live, host);
    expect(document.body.querySelector('span')!.textContent).toBe('1');

    (handle.instance as Live).n.set(2);
    flushSync();
    expect(document.body.querySelector('span')!.textContent).toBe('2');
  });

  it('removes portalled content when the declaring component unmounts', () => {
    @Component({
      selector: 'v-gone',
      render: compileTemplate(`<div><span :portal="'#elsewhere'">x</span></div>`),
    })
    class Gone {}

    const handle = mount(Gone, host);
    expect(document.querySelector('#elsewhere')!.textContent).toBe('x');

    handle.unmount();
    // Nothing may be left behind — this is the leak a portal makes easy.
    expect(document.querySelector('#elsewhere')!.textContent).toBe('');
    expect(document.querySelector('#elsewhere')!.childNodes).toHaveLength(0);
  });

  it('is created and destroyed by a surrounding :if', () => {
    @Component({
      selector: 'v-cond',
      render: compileTemplate(
        `<div><span :if="open.get()" :portal="'#elsewhere'">modal</span></div>`,
      ),
    })
    class Cond {
      open = new Signal.State(false);
    }

    const handle = mount(Cond, host);
    const target = document.querySelector('#elsewhere')!;
    expect(target.textContent).toBe('');

    (handle.instance as Cond).open.set(true);
    flushSync();
    expect(target.textContent).toBe('modal');

    (handle.instance as Cond).open.set(false);
    flushSync();
    expect(target.textContent).toBe('');
    expect(target.childNodes).toHaveLength(0);
  });
});

describe('portalling a component', () => {
  it('moves a component, not just an element', () => {
    @Component({ selector: 'v-inner', render: compileTemplate(`<b>inner</b>`) })
    class Inner {}

    @Component({
      selector: 'v-outer',
      imports: [Inner],
      render: compileTemplate(`<div><v-inner :portal="'#elsewhere'"></v-inner></div>`),
    })
    class Outer {}

    mount(Outer, host);
    // Silently dropped before: a lone component child took a fast path that
    // never looked for `:portal`.
    expect(document.querySelector('#elsewhere')!.textContent).toBe('inner');
    expect(host.querySelector('b')).toBeNull();
  });

  it('portals a component that is also conditional', () => {
    @Component({ selector: 'v-inner2', render: compileTemplate(`<b>x</b>`) })
    class Inner {}

    @Component({
      selector: 'v-outer2',
      imports: [Inner],
      render: compileTemplate(
        `<div><v-inner2 :if="open.get()" :portal="'#elsewhere'"></v-inner2></div>`,
      ),
    })
    class Outer {
      open = new Signal.State(false);
    }

    const handle = mount(Outer, host);
    const target = document.querySelector('#elsewhere')!;
    expect(target.textContent).toBe('');

    (handle.instance as Outer).open.set(true);
    flushSync();
    expect(target.textContent).toBe('x');
  });
});
