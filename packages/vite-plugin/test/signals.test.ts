import { describe, expect, it } from 'vitest';
import { Signal } from '@voltdev/reactivity';
import * as lowered from '@voltdev/reactivity/signals';
import { volt } from '../src/index.js';
import {
  SIGNAL_MEMBERS,
  SIGNAL_SUBTLE_MEMBERS,
  planSignalLowering,
} from '../src/signals.js';
import type { Plugin } from 'vite';

const ID = '/app/src/counter.ts';

function signalPlugin(options?: Parameters<typeof volt>[0]): Plugin {
  return volt(options).find((p) => p.name === 'volt:signals')!;
}

function run(code: string, id = ID, options?: Parameters<typeof volt>[0]): string | null {
  const hook = signalPlugin(options).transform as unknown as (
    code: string,
    id: string,
  ) => { code: string } | null;
  const result = hook.call({}, code, id);
  return result ? result.code : null;
}

/** What a component module reaching the namespace normally looks like. */
const APP = `
import { Component, Signal } from '@voltdev/core';

@Component({ selector: 'v-counter', template: '<b></b>' })
export class Counter {
  count = new Signal.State(0);
  double = new Signal.Computed(() => this.count.get() * 2);
}
`;

describe('lowering the namespace', () => {
  it('rewrites direct member accesses to imports of the members', () => {
    const output = run(APP)!;

    expect(output).toContain(
      'import { State as __volt_Signal_State, Computed as __volt_Signal_Computed }' +
        ' from "@voltdev/core/signals";',
    );
    expect(output).toContain('new __volt_Signal_State(0)');
    expect(output).toContain('new __volt_Signal_Computed(');
    expect(output).not.toContain('Signal.State');
    expect(output).not.toContain('Signal.Computed');
  });

  it('leaves the original import alone, so a bundler drops it and nothing dangles', () => {
    // Rewriting the import list would mean owning comma placement for no gain:
    // the binding is unused afterwards and both packages are `sideEffects: false`.
    expect(run(APP)).toContain(`import { Component, Signal } from '@voltdev/core';`);
  });

  it('reaches through `subtle`, which is a second namespace object', () => {
    const output = run(`
      import { Signal } from '@voltdev/reactivity';
      export const peek = (s) => Signal.subtle.untrack(() => s.get());
    `)!;
    expect(output).toContain(
      'import { untrack as __volt_Signal_subtle_untrack } from "@voltdev/reactivity/signals";',
    );
    expect(output).toContain('__volt_Signal_subtle_untrack(() => s.get())');
  });

  it('follows the local name through an alias on the import', () => {
    const output = run(`
      import { Signal as Sig } from '@voltdev/core';
      export const n = new Sig.State(1);
    `)!;
    expect(output).toContain('new __volt_Signal_State(1)');
  });

  it('imports one member once however many times it is used', () => {
    const output = run(`
      import { Signal } from '@voltdev/core';
      export const a = new Signal.State(1);
      export const b = new Signal.State(2);
    `)!;
    expect(output.match(/State as __volt_Signal_State/g)).toHaveLength(1);
  });

  it('lowers a type annotation too, since the members are classes either way', () => {
    const output = run(`
      import { Signal } from '@voltdev/core';
      export let a: Signal.State<number> = new Signal.State(1);
    `)!;
    expect(output).toContain('let a: __volt_Signal_State<number>');
  });
});

describe('declining rather than mis-rewriting', () => {
  /** Each of these needs the namespace as an object; none can be lowered. */
  const aliased: Record<string, string> = {
    'assigned to a local': `const S = Signal; export const n = new S.State(0);`,
    'destructured': `const { State } = Signal; export const n = new State(0);`,
    'passed as an argument': `export const n = register(Signal);`,
    'read with a computed key': `export const n = new Signal[key](0);`,
    'read as a whole': `export const all = { ...Signal };`,
    're-exported': `export { Signal };`,
  };

  for (const [what, body] of Object.entries(aliased)) {
    it(`declines the file when the namespace is ${what}`, () => {
      const code = `import { Signal } from '@voltdev/core';\n${body}\n`;
      expect(run(code)).toBeNull();
      expect(planSignalLowering(code).kind).toBe('declined');
    });
  }

  it('declines a file where only one of several uses is an alias', () => {
    // The direct uses are lowerable on their own; leaving them rewritten while
    // the aliased one still needs the object is the wrong half of the file.
    const code = `
      import { Signal } from '@voltdev/core';
      export const a = new Signal.State(0);
      export const S = Signal;
    `;
    expect(run(code)).toBeNull();
  });

  it('declines a member this pass does not know, rather than importing nothing', () => {
    // A member added to the namespace and not to the table here has to fail
    // loudly-by-omission, not resolve to an export that does not exist.
    for (const read of ['Signal.Future', 'Signal.subtle.rewind()']) {
      const code = `import { Signal } from '@voltdev/core';\nexport const x = ${read};\n`;
      expect(run(code)).toBeNull();
    }
  });

  it('declines `subtle` reached without a member', () => {
    const code = `
      import { Signal } from '@voltdev/core';
      export const s = Signal.subtle;
    `;
    expect(run(code)).toBeNull();
  });

  it('declines an assignment, which would lower to writing an import binding', () => {
    for (const write of ['Signal.State = X', 'Signal.State ??= X', 'delete Signal.State']) {
      const code = `import { Signal } from '@voltdev/core';\n${write};\n`;
      expect(run(code)).toBeNull();
    }
  });

  it('still lowers around comparisons, which only look like assignment', () => {
    const output = run(`
      import { Signal } from '@voltdev/core';
      export const same = (x) => x.constructor === Signal.State && x >= Signal.State.length;
    `)!;
    expect(output).not.toContain('Signal.State');
  });

  it('leaves a namespace it does not own alone', () => {
    expect(run(`import { Signal } from 'some-other-lib';\nnew Signal.State(0);\n`)).toBeNull();
  });

  it('leaves a type-only import alone, since it binds nothing at runtime', () => {
    for (const declaration of [
      `import type { Signal } from '@voltdev/core';`,
      `import { type Signal, effect } from '@voltdev/core';`,
    ]) {
      const code = `${declaration}\nexport function r(s: Signal.State<number>) { return s.get(); }\n`;
      expect(run(code)).toBeNull();
      expect(planSignalLowering(code).kind).toBe('none');
    }
  });

  it('declines nothing and imports nothing when the binding is never read', () => {
    const code = `import { Signal } from '@voltdev/core';\nexport const x = 1;\n`;
    expect(run(code)).toBeNull();
  });

  it('is not fooled by the namespace named in a comment or a string', () => {
    const output = run(`
      import { Signal } from '@voltdev/core';
      // was: new Signal.State(0)
      export const label = "new Signal.State(0)";
      export const also = \`new Signal.State(0)\`;
      export const n = new Signal.State(0);
    `)!;
    expect(output).toContain('// was: new Signal.State(0)');
    expect(output).toContain('"new Signal.State(0)"');
    expect(output).toContain('`new Signal.State(0)`');
    expect(output).toContain('export const n = new __volt_Signal_State(0)');
  });

  it('leaves a member read off somebody else’s object alone', () => {
    // `volt.Signal.State` is a different expression that happens to end in the
    // same words; rewriting it would produce `volt.__volt_Signal_State`.
    const output = run(`
      import { Signal } from '@voltdev/core';
      import * as volt from '@voltdev/core';
      export const a = new Signal.State(0);
      export const b = new volt.Signal.State(0);
    `)!;
    expect(output).toContain('export const a = new __volt_Signal_State(0)');
    expect(output).toContain('export const b = new volt.Signal.State(0)');
  });

  it('leaves a private field that happens to share the name alone', () => {
    const output = run(`
      import { Signal } from '@voltdev/core';
      export class Box {
        #Signal = new Signal.State(0);
        read() { return this.#Signal.get(); }
      }
    `)!;
    expect(output).toContain('#Signal = new __volt_Signal_State(0)');
    expect(output).toContain('this.#Signal.get()');
  });

  it('skips node_modules and files the include pattern excludes', () => {
    expect(run(APP, '/app/node_modules/@voltdev/ui/dist/index.ts')).toBeNull();
    expect(run(APP, '/app/src/counter.js')).toBeNull();
  });

  it('declines when the namespace arrives from two modules at once', () => {
    // One alias per member, so two lowered modules would collide on the name.
    const code = `
      import { Signal } from '@voltdev/core';
      import { Signal as S } from '@voltdev/reactivity';
      export const a = new Signal.State(0);
      export const b = new S.State(1);
    `;
    expect(run(code)).toBeNull();
    expect(planSignalLowering(code).kind).toBe('declined');
  });

  it('says why it declined, since declining leaves no trace in the output', () => {
    const said: string[] = [];
    const info = console.info;
    console.info = (message: string) => said.push(message);
    try {
      run(`import { Signal } from '@voltdev/core';\nexport const S = Signal;\n`, ID, {
        debug: true,
      });
    } finally {
      console.info = info;
    }
    expect(said).toEqual([expect.stringContaining('Signal namespace kept — `Signal` is used')]);
  });

  it('does nothing at all when the caller turns the pass off', () => {
    expect(run(APP, ID, { lowerSignals: false })).toBeNull();
  });
});

describe('the two spellings are the same bindings', () => {
  // The namespace has to stay valid at runtime for JIT mode, tests and the
  // REPL, so a build that lowers and a build that does not must not be able to
  // disagree. They cannot if the members are identical values.
  it('exposes exactly the namespace, member for member', () => {
    expect(Object.keys(Signal).sort()).toEqual([...SIGNAL_MEMBERS, 'subtle'].sort());
    expect(Object.keys(Signal.subtle).sort()).toEqual([...SIGNAL_SUBTLE_MEMBERS].sort());
  });

  it('hands out the same value under either spelling', () => {
    for (const name of SIGNAL_MEMBERS) {
      expect(lowered[name]).toBe(Signal[name]);
    }
    for (const name of SIGNAL_SUBTLE_MEMBERS) {
      expect(lowered[name]).toBe(Signal.subtle[name]);
    }
  });

  it('behaves identically whichever spelling built the signal', () => {
    const viaNamespace = new Signal.State(1);
    const viaImport = new lowered.State(1);
    const derived = new lowered.Computed(() => viaNamespace.get() + viaImport.get());

    expect(viaImport).toBeInstanceOf(Signal.State);
    expect(viaNamespace).toBeInstanceOf(lowered.State);
    expect(derived.get()).toBe(2);

    viaImport.set(5);
    expect(derived.get()).toBe(6);
    expect(Signal.subtle.hasSources(derived)).toBe(true);
    expect(lowered.introspectSources(derived as never)).toContain(viaNamespace);
  });
});
