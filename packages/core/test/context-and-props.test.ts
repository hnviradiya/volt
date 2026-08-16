/**
 * Context propagation and prop-name handling.
 *
 * The context cases follow Solid's suite, which covers providers behind
 * conditionals and inside loops rather than only the straight-line case — a
 * scope-based lookup can be right at the top level and wrong once a branch
 * or a row sits between provider and consumer.
 *
 * The prop-name cases follow Vue's, which pins how a template spelling maps
 * onto a declared property.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@volt/core/jit';
import {
  Component,
  Prop,
  Signal,
  createContext,
  flushSync,
  mount,
  provideContext,
  useContext,
} from '@volt/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

const Theme = createContext('light');

@Component({ selector: 'v-reader', render: compileTemplate(`<span>{ theme }</span>`) })
class Reader {
  theme = useContext(Theme);
}

describe('context', () => {
  it('falls back to the default with no provider', () => {
    @Component({
      selector: 'v-plain',
      imports: [Reader],
      render: compileTemplate(`<div><v-reader></v-reader></div>`),
    })
    class Plain {}

    mount(Plain, host);
    expect(host.textContent).toBe('light');
  });

  it('reaches a child through a provider', () => {
    @Component({
      selector: 'v-provider',
      imports: [Reader],
      render: compileTemplate(`<div><v-reader></v-reader></div>`),
    })
    class Provider {
      #ctx = provideContext(Theme, 'dark');
    }

    mount(Provider, host);
    expect(host.textContent).toBe('dark');
  });

  it('reaches a child behind a conditional', () => {
    @Component({
      selector: 'v-cond-provider',
      imports: [Reader],
      render: compileTemplate(`<div><v-reader :if="on.get()"></v-reader></div>`),
    })
    class CondProvider {
      on = new Signal.State(false);
      #ctx = provideContext(Theme, 'dark');
    }

    const handle = mount(CondProvider, host);
    expect(host.textContent).toBe('');

    // The branch is built later — the provider must still be found.
    (handle.instance as CondProvider).on.set(true);
    flushSync();
    expect(host.textContent).toBe('dark');
  });

  it('reaches children created inside a loop', () => {
    @Component({
      selector: 'v-loop-provider',
      imports: [Reader],
      render: compileTemplate(
        `<div><v-reader :for="n in items.get()" :key="n"></v-reader></div>`,
      ),
    })
    class LoopProvider {
      items = new Signal.State([1, 2]);
      #ctx = provideContext(Theme, 'dark');
    }

    const handle = mount(LoopProvider, host);
    expect(host.textContent).toBe('darkdark');

    // Rows added after the fact resolve the provider too.
    (handle.instance as LoopProvider).items.set([1, 2, 3]);
    flushSync();
    expect(host.textContent).toBe('darkdarkdark');
  });

  it('lets a nearer provider shadow an outer one', () => {
    @Component({
      selector: 'v-inner',
      imports: [Reader],
      render: compileTemplate(`<b><v-reader></v-reader></b>`),
    })
    class Inner {
      #ctx = provideContext(Theme, 'inner');
    }

    @Component({
      selector: 'v-outer',
      imports: [Inner, Reader],
      render: compileTemplate(`<div><v-reader></v-reader><v-inner></v-inner></div>`),
    })
    class Outer {
      #ctx = provideContext(Theme, 'outer');
    }

    mount(Outer, host);
    expect(host.textContent).toBe('outerinner');
  });

  it('carries a signal through context so consumers stay reactive', () => {
    const Live = createContext(new Signal.State('a'));

    @Component({ selector: 'v-live', render: compileTemplate(`<span>{ v.get() }</span>`) })
    class LiveReader {
      v = useContext(Live);
    }

    @Component({
      selector: 'v-live-provider',
      imports: [LiveReader],
      render: compileTemplate(`<div><v-live></v-live></div>`),
    })
    class LiveProvider {
      value = new Signal.State('a');
      #ctx = provideContext(Live, this.value);
    }

    const handle = mount(LiveProvider, host);
    expect(host.textContent).toBe('a');

    (handle.instance as LiveProvider).value.set('b');
    flushSync();
    expect(host.textContent).toBe('b');
  });
});

describe('prop names', () => {
  it('matches a camelCase prop written as camelCase', () => {
    @Component({ selector: 'v-camel', render: compileTemplate(`<span>{ maxCount.get() }</span>`) })
    class Camel {
      @Prop() maxCount = new Signal.State(0);
    }

    @Component({
      selector: 'v-camel-host',
      imports: [Camel],
      render: compileTemplate(`<div><v-camel :maxCount="5"></v-camel></div>`),
    })
    class Host {}

    mount(Host, host);
    expect(host.textContent).toBe('5');
  });

  it('rejects a kebab-cased spelling and names the prop meant', () => {
    @Component({ selector: 'v-kebab', render: compileTemplate(`<span>{ maxCount.get() }</span>`) })
    class Kebab {
      @Prop() maxCount = new Signal.State(0);
    }

    @Component({
      selector: 'v-kebab-host',
      imports: [Kebab],
      render: compileTemplate(`<div><v-kebab :max-count="7"></v-kebab></div>`),
    })
    class Host {}

    // There is one spelling — the declared one. A near miss is reported
    // rather than silently ignored, which is how it used to behave.
    expect(() => mount(Host, host)).toThrow(
      /has no prop "max-count"\. Did you mean "maxCount"\?/,
    );
  });

  it('rejects an outright unknown prop and lists what is declared', () => {
    @Component({ selector: 'v-known', render: compileTemplate(`<span>{ a.get() }</span>`) })
    class Known {
      @Prop() a = new Signal.State(0);
    }

    @Component({
      selector: 'v-known-host',
      imports: [Known],
      render: compileTemplate(`<div><v-known :nope="1"></v-known></div>`),
    })
    class Host {}

    expect(() => mount(Host, host)).toThrow(/has no prop "nope"[\s\S]*Declared props: a\./);
  });

  it('passes a valueless attribute as true', () => {
    @Component({
      selector: 'v-flag',
      render: compileTemplate(`<span>{ String(active) }</span>`),
    })
    class Flag {
      @Prop() active = false;
    }

    @Component({
      selector: 'v-flag-host',
      imports: [Flag],
      render: compileTemplate(`<div><v-flag active></v-flag></div>`),
    })
    class Host {}

    mount(Host, host);
    expect(host.textContent).toBe('true');
  });

  it('leaves a declared prop at its default when not passed', () => {
    @Component({ selector: 'v-dflt', render: compileTemplate(`<span>{ label.get() }</span>`) })
    class Dflt {
      @Prop() label = new Signal.State('fallback');
    }

    @Component({
      selector: 'v-dflt-host',
      imports: [Dflt],
      render: compileTemplate(`<div><v-dflt></v-dflt></div>`),
    })
    class Host {}

    mount(Host, host);
    expect(host.textContent).toBe('fallback');
  });
});
