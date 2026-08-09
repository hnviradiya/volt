import { describe, expect, it } from 'vitest';
import { volt } from '../src/index.js';
import type { Plugin } from 'vite';

type TransformHook = (
  this: { error(message: string): never },
  code: string,
  id: string,
) => Promise<{ code: string } | null> | { code: string } | null;

/** Invoke a plugin's transform hook with a minimal Rollup-ish context. */
async function runTransform(
  plugin: Plugin,
  code: string,
  id = '/src/app.ts',
): Promise<string | null> {
  const hook = plugin.transform as unknown as TransformHook;
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  const result = await hook.call(context, code, id);
  return result ? result.code : null;
}

function plugins(options?: Parameters<typeof volt>[0]) {
  const [templates, decorators] = volt(options);
  return { templates: templates!, decorators: decorators! };
}

const COMPONENT = `
import { Component, Signal } from '@voltjs/core';

@Component({
  selector: 'v-counter',
  template: \`<button :click="inc()">{{ count.get() }}</button>\`,
})
export class Counter {
  count = new Signal.State(0);
  inc() { this.count.set(this.count.get() + 1); }
}
`;

describe('template precompilation', () => {
  it('replaces a template with a compiled render function', async () => {
    const { templates } = plugins();
    const output = await runTransform(templates, COMPONENT);

    expect(output).not.toBeNull();
    expect(output).toContain('render: __volt_render_0');
    expect(output).not.toContain('template: `');
    // The static markup is hoisted to module scope, parsed once per module.
    expect(output).toContain('__volt_rt.template("<button></button>")');
    expect(output).toContain("import * as __volt_rt from \"@voltjs/core/runtime\"");
  });

  it('leaves files without a @Component alone', async () => {
    const { templates } = plugins();
    const output = await runTransform(templates, `export const x = 1;`);
    expect(output).toBeNull();
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

  it('ignores `template:` occurrences outside a @Component call', async () => {
    const source = `
      const config = { template: \`<div>{{ nope }}</div>\` };
      export { config };
    `;
    const { templates } = plugins();
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('is not fooled by the word template inside a string or comment', async () => {
    const source = `
      // template: \`<div></div>\`
      const s = "template: not a real one";
      export { s };
    `;
    const { templates } = plugins();
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('leaves interpolated template literals to the runtime compiler', async () => {
    const source = `
      @Component({ selector: 'v-x', template: \`<div>\${SHARED}</div>\` })
      export class X {}
    `;
    const { templates } = plugins();
    // Host-language interpolation is not a Volt template; it cannot be
    // resolved at build time, so it must be left intact.
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('compiles several components in one module', async () => {
    const source = `
      @Component({ selector: 'v-a', template: \`<a>{{ x.get() }}</a>\` })
      export class A {}
      @Component({ selector: 'v-b', template: \`<b>{{ y.get() }}</b>\` })
      export class B {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);
    expect(output).toContain('render: __volt_render_0');
    expect(output).toContain('render: __volt_render_1');
  });

  it('reports template syntax errors against the source file', async () => {
    const source = `
      @Component({ selector: 'v-bad', template: \`<div><span></div>\` })
      export class Bad {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(/volt:compiler/);
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
