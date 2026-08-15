import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { volt } from '../src/index.js';
import type { Plugin } from 'vite';

type TransformHook = (
  this: { error(message: string): never; addWatchFile(file: string): void },
  code: string,
  id: string,
) => Promise<{ code: string } | null> | { code: string } | null;

/** Files the plugin asked Vite to watch, so template edits hot-reload. */
let watched: string[] = [];

/** A module living beside the fixtures, so relative paths resolve. */
const FIXTURE_ID = resolve(import.meta.dirname, 'fixtures/component.ts');

/** Invoke a plugin's transform hook with a minimal Rollup-ish context. */
async function runTransform(
  plugin: Plugin,
  code: string,
  id = FIXTURE_ID,
): Promise<string | null> {
  const hook = plugin.transform as unknown as TransformHook;
  watched = [];
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
    addWatchFile(file: string) {
      watched.push(file);
    },
  };
  const result = await hook.call(context, code, id);
  return result ? result.code : null;
}

function plugins(options?: Parameters<typeof volt>[0]) {
  const all = volt(options);
  const byName = (name: string) => all.find((p) => p.name === name)!;
  return { templates: byName('volt:templates'), decorators: byName('volt:decorators') };
}

const COMPONENT = `
import { Component, Signal } from '@voltjs/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
})
export class Counter {
  count = new Signal.State(0);
  inc() { this.count.set(this.count.get() + 1); }
}
`;

describe('template precompilation', () => {
  it('reads the html file and replaces templateUrl with a render function', async () => {
    const { templates } = plugins();
    const output = await runTransform(templates, COMPONENT);

    expect(output).not.toBeNull();
    expect(output).toContain('render: __volt_render_0');
    expect(output).not.toContain('templateUrl');
    // Static markup hoisted to module scope, parsed once per module.
    expect(output).toContain('__volt_rt.template("<button></button>")');
    expect(output).toContain('import * as __volt_rt from "@voltjs/core/runtime"');
    // The handler is delegated rather than bound per element.
    expect(output).toContain('__volt_rt.delegate');
  });

  it('registers the html file so edits hot-reload', async () => {
    const { templates } = plugins();
    await runTransform(templates, COMPONENT);
    expect(watched.some((f) => f.endsWith('counter.html'))).toBe(true);
  });

  it('leaves files without a @Component alone', async () => {
    const { templates } = plugins();
    expect(await runTransform(templates, `export const x = 1;`)).toBeNull();
  });

  it('does nothing when precompilation is disabled', async () => {
    const { templates } = plugins({ precompileTemplates: false });
    expect(await runTransform(templates, COMPONENT)).toBeNull();
  });

  it('skips node_modules', async () => {
    const { templates } = plugins();
    const output = await runTransform(templates, COMPONENT, '/x/node_modules/pkg/index.ts');
    expect(output).toBeNull();
  });

  it('ignores templateUrl outside a @Component call', async () => {
    const source = `
      const config = { templateUrl: './counter.html' };
      export { config };
    `;
    const { templates } = plugins();
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('is not fooled by the word templateUrl in a string or comment', async () => {
    const source = `
      // templateUrl: './counter.html'
      const s = "templateUrl: './counter.html'";
      export { s };
    `;
    const { templates } = plugins();
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('compiles several components in one module', async () => {
    const source = `
      @Component({ selector: 'v-a', templateUrl: './a.html' })
      export class A {}
      @Component({ selector: 'v-b', templateUrl: './b.html' })
      export class B {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);
    expect(output).toContain('render: __volt_render_0');
    expect(output).toContain('render: __volt_render_1');
  });

  it('fails with a useful message when the file is missing', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './nope.html' })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /templateUrl "\.\/nope\.html" could not be read/,
    );
  });

  it('reports template syntax errors against the html file, not the component', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './broken.html' })
      export class X {}
    `;
    const { templates } = plugins();
    // broken.html exists but has an unclosed tag, so this is a compiler error
    // rather than a missing-file error — and it must name the html file.
    await expect(runTransform(templates, source)).rejects.toThrow(
      /volt:compiler[\s\S]*broken\.html/,
    );
  });
});

describe('styleUrl / styleUrls', () => {
  it('compiles a stylesheet from Sass and flattens nesting', async () => {
    const source = `
      @Component({
        selector: 'v-greeting',
        templateUrl: './greeting.html',
        styleUrl: './greeting.scss',
      })
      export class Greeting {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);

    expect(output).not.toContain('styleUrl');
    // Nesting is resolved at build time, not shipped.
    expect(output).toContain('.greeting strong{font-weight:700}');
    // Compressed output, so the colour keyword is emitted as its short hex.
    expect(output).toContain('#639');
  });

  it('concatenates several stylesheets in order', async () => {
    const source = `
      @Component({
        selector: 'v-greeting',
        templateUrl: './greeting.html',
        styleUrls: ['./greeting.scss', './extra.scss'],
      })
      export class Greeting {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);

    expect(output).toContain('#639');
    // Pulled in from the partial that extra.scss @uses.
    expect(output).toContain('#fafafa');
  });

  it('watches partials pulled in with @use, not just the entry file', async () => {
    const source = `
      @Component({
        selector: 'v-greeting',
        templateUrl: './greeting.html',
        styleUrl: './extra.scss',
      })
      export class Greeting {}
    `;
    const { templates } = plugins();
    await runTransform(templates, source);

    // Editing the partial has to invalidate the component too.
    expect(watched.some((f) => f.endsWith('extra.scss'))).toBe(true);
    expect(watched.some((f) => f.endsWith('_tokens.scss'))).toBe(true);
  });

  it('rejects a plain .css file', async () => {
    const source = `
      @Component({
        selector: 'v-x',
        templateUrl: './greeting.html',
        styleUrl: './greeting.css',
      })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /must be a \.scss file/,
    );
  });

  it('fails with a useful message when a stylesheet is missing', async () => {
    const source = `
      @Component({
        selector: 'v-x',
        templateUrl: './greeting.html',
        styleUrl: './nope.scss',
      })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /styleUrl "\.\/nope\.scss" could not be read/,
    );
  });

  it('reports Sass errors against the stylesheet', async () => {
    const source = `
      @Component({
        selector: 'v-x',
        templateUrl: './greeting.html',
        styleUrl: './broken.scss',
      })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /Failed to compile[\s\S]*broken\.scss/,
    );
  });
});

describe('decorator lowering', () => {
  it('removes standard decorator syntax', async () => {
    const { decorators } = plugins();
    const output = await runTransform(decorators, COMPONENT);

    expect(output).not.toBeNull();
    // No engine implements decorators yet, so none may survive the transform.
    expect(output).not.toMatch(/^\s*@Component/m);
  });

  it('leaves files with no decorators untouched', async () => {
    const { decorators } = plugins();
    expect(await runTransform(decorators, `export const x = 1;`)).toBeNull();
  });
});
