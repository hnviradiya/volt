/**
 * What one request must not take from another, and what a server must not run.
 *
 * There is no server emitter yet, so a "request" here is the request scope
 * with a component mounted inside it — which is what the emitter will drive.
 * The claims are about isolation and lifecycle, and both are visible from
 * here: the markup a request produced, the styles it collected, the ids it
 * minted, and whether `onMount` ever fired.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Prop,
  createId,
  createRequestScope,
  mount,
  requestStyles,
  resetIds,
  runInRequest,
  settleRequest,
  type OnMount,
} from '@voltdev/core';

/**
 * The build flag, which the test config compiles to a live read of this global
 * so one file can render both sides.
 */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

interface Rendered {
  html: string;
  styles: [string, string][];
}

/** One request, rendered to quiescence, reported as everything it produced. */
async function renderRequest(component: Parameters<typeof mount>[0]): Promise<Rendered> {
  const scope = createRequestScope();
  const host = document.createElement('div');
  await settleRequest(scope, () => {
    mount(component, host);
  });
  return {
    html: host.innerHTML,
    styles: runInRequest(scope, () => [...requestStyles()]),
  };
}

beforeEach(() => {
  serverBuild(true);
  document.head.querySelectorAll('style[data-volt]').forEach((el) => el.remove());
});

afterEach(() => {
  serverBuild(false);
  resetIds();
});

describe('onMount', () => {
  @Component({ selector: 'v-mounts', render: compileTemplate(`<p>body</p>`) })
  class Mounts implements OnMount {
    static calls = 0;
    onMount(): void {
      Mounts.calls++;
    }
  }

  beforeEach(() => {
    Mounts.calls = 0;
  });

  it('is never queued on a server', async () => {
    const { html } = await renderRequest(Mounts);
    expect(html).toBe('<p>body</p>');

    // A whole turn, microtasks included. A queued microtask would have fired
    // at the first `await` inside the render — declining to wait for it is not
    // the same as not queuing it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Mounts.calls).toBe(0);
  });

  it('still runs on a client', async () => {
    serverBuild(false);
    mount(Mounts, document.createElement('div'));
    await Promise.resolve();
    expect(Mounts.calls).toBe(1);
  });
});

describe('styles', () => {
  @Component({
    selector: 'v-styled',
    styles: '.styled { color: red }',
    render: compileTemplate(`<p class="styled">body</p>`),
  })
  class Styled {}

  @Component({
    selector: 'v-blank',
    // What an emptied `styleUrl` file leaves behind: not absent, just nothing.
    styles: '\n  \n',
    render: compileTemplate(`<p>body</p>`),
  })
  class Blank {}

  it('reach every request, not only the first', async () => {
    const first = await renderRequest(Styled);
    const second = await renderRequest(Styled);

    expect(first.styles).toEqual([['v-styled', '.styled { color: red }']]);
    // The process-global "already injected" mark is what makes this the
    // interesting case: it survives the request that set it.
    expect(second.styles).toEqual(first.styles);
  });

  it('are collected rather than injected, since a request has no document', async () => {
    await renderRequest(Styled);
    expect(document.head.querySelectorAll('style[data-volt]')).toHaveLength(0);
  });

  it('are still injected once, and only once, on a client', () => {
    serverBuild(false);
    mount(Styled, document.createElement('div'));
    mount(Styled, document.createElement('div'));

    const injected = document.head.querySelectorAll('style[data-volt="v-styled"]');
    expect(injected).toHaveLength(1);
    expect(injected[0]!.textContent).toBe('.styled { color: red }');
  });

  it('are nothing at all when the component declares only whitespace', async () => {
    const { styles } = await renderRequest(Blank);
    // A request that collected this would hand the emitter `v-blank{}` to
    // print into every page.
    expect(styles).toEqual([]);

    serverBuild(false);
    mount(Blank, document.createElement('div'));
    expect(document.head.querySelectorAll('style[data-volt="v-blank"]')).toHaveLength(0);
  });
});

describe('ids', () => {
  @Component({ selector: 'v-leaf', render: compileTemplate(`<span :id="id">{ label }</span>`) })
  class Leaf {
    @Prop() label = '';
    id = createId('leaf');
  }

  @Component({
    selector: 'v-page',
    imports: [Leaf],
    render: compileTemplate(
      `<div :id="id"><v-leaf label="one"></v-leaf><v-leaf label="two"></v-leaf></div>`,
    ),
  })
  class Page {
    id = createId('page');
  }

  const ids = (html: string): string[] => [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!);

  it('come out of the tree, so two requests agree on them', async () => {
    const first = await renderRequest(Page);
    const second = await renderRequest(Page);

    expect(ids(first.html)).toEqual(ids(second.html));
    // Which is the whole point: a counter would have carried on from where the
    // first request left it, and hydration compares nothing.
    expect(ids(second.html)).toHaveLength(3);
  });

  it('distinguish two instances of the same component by where they sit', async () => {
    const { html } = await renderRequest(Page);
    const minted = ids(html);
    expect(new Set(minted).size).toBe(minted.length);
    expect(minted[1]).not.toBe(minted[2]);
  });
});

describe('the request driver', () => {
  @Component({ selector: 'v-inert', render: compileTemplate(`<p>body</p>`) })
  class Inert {}

  it('is compiled out of a client build, so nothing it drives runs there', async () => {
    serverBuild(false);
    let built = false;
    const scope = createRequestScope();

    await settleRequest(scope, () => {
      built = true;
      mount(Inert, document.createElement('div'));
    });

    expect(built).toBe(false);
  });
});
