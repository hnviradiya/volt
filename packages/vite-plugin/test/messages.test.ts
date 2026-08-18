/**
 * The build-time half of messages, from the side a project actually meets it.
 *
 * The compiler's own tests hold the rules; these hold the wiring, which is
 * where a rule quietly stops mattering. A missing key has to reach the build
 * as an error naming the template rather than the module that imported it. An
 * unused message has to reach a person — the accessibility pass learned that
 * the hard way, and warnings go out through the same `this.warn` here. And the
 * catalogue has to arrive as a module the bundler can take apart, not as a
 * file the browser fetches.
 *
 * That last one is the headline claim, and reading the generated source for
 * `export const` cannot check it: a module can be textually perfect and still
 * ship whole, which is what a top-level side effect or a shared lookup table
 * would do. So the end of this file builds two real applications against the
 * plugin and weighs them.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { volt, type VoltPluginOptions } from '../src/index.js';
import { build as viteBuild, type Plugin } from 'vite';
import type { RollupOutput } from 'rollup';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const FIXTURE_ID = join(FIXTURES, 'component.ts');
const CATALOG = join(FIXTURES, 'en.json');

const component = (template: string) => `
import { Component } from '@voltdev/core';

@Component({ selector: 'v-toolbar', templateUrl: './${template}' })
export class Toolbar {}
`;

/** What the plugin reported without refusing the build. */
let warned: string[] = [];

interface Context {
  error(message: string): never;
  warn(message: string): void;
  addWatchFile(file: string): void;
}

const context: Context = {
  error(message): never {
    throw new Error(message);
  },
  warn(message) {
    warned.push(message);
  },
  addWatchFile() {},
};

/** The plugins, with the messages one wired to the fixture catalogue. */
function build(messages: Partial<VoltPluginOptions['messages']> = {}) {
  warned = [];
  const all = volt({ messages: { catalog: CATALOG, ...messages } } as VoltPluginOptions);
  const byName = (name: string) => all.find((p) => p.name === name)!;
  return { messages: byName('volt:messages'), templates: byName('volt:templates') };
}

type Hook = (this: Context, ...args: never[]) => unknown;
const call = <T>(plugin: Plugin, hook: keyof Plugin, ...args: unknown[]): T =>
  ((plugin[hook] as Hook).call(context, ...(args as never[])) as T);

/** Bring a plugin up the way Vite would, for the build or for the dev server. */
async function start(plugin: Plugin, command: 'build' | 'serve' = 'build'): Promise<void> {
  call(plugin, 'configResolved', { root: FIXTURES, command });
  await call<Promise<void>>(plugin, 'buildStart');
}

describe('a message key the catalogue does not have', () => {
  it('fails the build, naming the template and the line', async () => {
    const { templates } = build();
    // The template's own file, not the module that declared it: that is the
    // file with the mistake in it.
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).rejects.toThrow(/mistyped\.html:3:/);
  });

  it('says what the key should have been', async () => {
    const { templates } = build();
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).rejects.toThrow(/Did you mean `t\('close'\)`\?/);
  });

  it('fails a call that leaves out a parameter the message needs', async () => {
    const { templates } = build();
    // Both halves, and in one regex rather than two alternatives: an
    // alternation here passed for a year against an error that named no file
    // at all, because the second branch matched on its own.
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('halfway.html'), FIXTURE_ID),
    ).rejects.toThrow(/is missing `m`[\s\S]*halfway\.html:2:/);
  });

  it('compiles the same template when no catalogue is configured', async () => {
    warned = [];
    const plugins = volt({});
    const templates = plugins.find((p) => p.name === 'volt:templates')!;
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).resolves.toBeTruthy();
  });

  it('accepts a template whose keys are all there', async () => {
    const { templates } = build();
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID),
    ).resolves.toBeTruthy();
  });
});

describe('a message nothing asks for', () => {
  it('reaches a person, through the warning channel the build already has', async () => {
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([
      expect.stringContaining('Message `checkoutTotal`'),
      expect.stringContaining('Message `abandoned`'),
    ]);
    // Clickable, or nobody clicks it.
    expect(warned[1]).toContain('en.json:5:');
  });

  it('says nothing about a message a template asks for', async () => {
    // Not `toolbar.html`: both of its keys are ones the component library
    // speaks for itself, so they are spared whatever the call sites say — and
    // a report that stopped hearing templates altogether would still look
    // right. `checkoutTotal` is the application's own, so only the wiring
    // from the template compiler's call sites can account for it.
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);
  });

  it('says nothing about a message a module mentions', async () => {
    // A key used from TypeScript is used, and reporting it would be a warning
    // about correct code — which is how a project ends up with none.
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID);
    call(messages, 'transform', `export const total = t('checkoutTotal', { amount });`, FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);
  });

  it('stays quiet on the dev server, which has only seen what changed', async () => {
    const { messages } = build();
    await start(messages, 'serve');
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([]);
  });

  it('stays quiet when a project turns it off', async () => {
    const { messages } = build({ unused: 'off' });
    await start(messages);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([]);
  });

  it('says nothing at all when the build already failed', async () => {
    // A build that stopped has walked part of the graph, so every message it
    // has not reached yet looks unused.
    const { messages } = build();
    await start(messages);
    await call<Promise<void>>(messages, 'buildEnd', new Error('something else broke'));
    expect(warned).toEqual([]);
  });
});

describe('a second build from the same plugin object', () => {
  // `used` and the catalogue are one closure per `volt()` call, and Vite brings
  // the same plugin object up more than once: `build --watch` on every change,
  // and a build with a client environment and a server one runs `buildStart`
  // and `buildEnd` once for each. Both cycles report on themselves alone,
  // which is what a rebuild needs and what a multi-environment build has to be
  // read as — the client half has not seen the server's modules.
  const temporary: string[] = [];
  afterAll(() => Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('reports what this build saw, not what the one before it did', async () => {
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);

    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    // Nothing in this cycle asked for `checkoutTotal`, so it is unaccounted
    // for again. Carrying the set over would report the previous run's graph.
    expect(warned).toEqual([
      expect.stringContaining('Message `checkoutTotal`'),
      expect.stringContaining('Message `abandoned`'),
    ]);
  });

  it('reads the catalogue again, so a message added to it is seen', async () => {
    // The catalogue is a watched file: a rebuild is exactly what an edit to it
    // triggers, and answering from the read the first build did would report
    // on a file that no longer exists.
    const dir = await mkdtemp(join(tmpdir(), 'volt-messages-'));
    temporary.push(dir);
    const file = join(dir, 'en.json');
    await writeFile(file, JSON.stringify({ greeting: 'Hello' }), 'utf8');

    const { messages } = build({ catalog: file });
    await start(messages);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `greeting`')]);

    await writeFile(file, JSON.stringify({ greeting: 'Hello', farewell: 'Bye' }), 'utf8');
    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([
      expect.stringContaining('Message `greeting`'),
      expect.stringContaining('Message `farewell`'),
    ]);
  });
});

describe('the catalogue as a module', () => {
  it('answers to the virtual id', async () => {
    const { messages } = build();
    await start(messages);
    expect(call<string>(messages, 'resolveId', 'virtual:volt-messages')).toBe(
      '\0virtual:volt-messages',
    );
    expect(call<string | null>(messages, 'resolveId', './somewhere.ts')).toBeNull();
  });

  it('serves one function per message', async () => {
    const { messages } = build();
    await start(messages);
    const code = await call<Promise<string>>(messages, 'load', '\0virtual:volt-messages');
    expect(code).toContain('export const close = () => "Close";');
    expect(code).toContain('export const pageOf = (params = {}) =>');
    expect(code).not.toMatch(/^\s*import\b/m);
  });

  it('takes the locale from the catalogue’s own name', async () => {
    const { messages } = build();
    await start(messages);
    const code = await call<Promise<string>>(messages, 'load', '\0virtual:volt-messages');
    expect(code).toContain('export const locale = "en";');
  });

  it('refuses a catalogue whose name is not a language tag', async () => {
    // `messages.json` would derive the tag `messages`, which `Intl` accepts
    // and then formats nothing the way the catalogue meant.
    const all = volt({ messages: { catalog: join(FIXTURES, 'strings.json') } });
    const messages = all.find((p) => p.name === 'volt:messages')!;
    await expect(start(messages)).rejects.toThrow(/set `messages\.locale`/);
  });

  it('takes the locale it is told, whatever the file is called', async () => {
    const { messages } = build({ locale: 'de-DE' });
    await start(messages);
    const code = await call<Promise<string>>(messages, 'load', '\0virtual:volt-messages');
    expect(code).toContain('export const locale = "de-DE";');
  });

  it('leaves every other module alone', async () => {
    const { messages } = build();
    await start(messages);
    expect(await call<Promise<string | null>>(messages, 'load', 'some/other/module.ts')).toBeNull();
  });
});

describe('the declarations a project type-checks against', () => {
  const TYPES = join(FIXTURES, 'messages.d.ts');
  afterEach(() => rm(TYPES, { force: true }));

  it('are written only when asked for, and name the module the build serves', async () => {
    const { messages } = build({ typesFile: 'messages.d.ts' });
    await start(messages);
    const written = await readFile(TYPES, 'utf8');
    expect(written).toContain(`declare module "virtual:volt-messages" {`);
    expect(written).toContain('pageOf: (params: { n: string | number; m: string | number })');
  });

  it('are not written when nothing asked', async () => {
    const { messages } = build();
    await start(messages);
    await expect(readFile(TYPES, 'utf8')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// What a bundler does with it
// ---------------------------------------------------------------------------

describe('a message nobody imported', { timeout: 120_000 }, () => {
  /** The fixture app, bundled against the plugin the way a project would be. */
  async function bundle(entry: string): Promise<string> {
    const result = (await viteBuild({
      root: resolve(import.meta.dirname, '..'),
      configFile: false,
      logLevel: 'silent',
      plugins: [volt({ messages: { catalog: CATALOG, unused: 'off' } })],
      build: {
        write: false,
        target: 'esnext',
        // The assertions below say which strings are gone, so they have to
        // survive as themselves; the byte comparison is between two
        // unminified builds.
        minify: false,
        lib: { entry: join(FIXTURES, entry), formats: ['es'], fileName: 'app' },
      },
    })) as RollupOutput[];
    return result[0]!.output[0].code;
  }

  const both = Promise.all([bundle('one-message.ts'), bundle('every-message.ts')]);

  it('is not in the bundle, and the one that was imported is', async () => {
    const [one] = await both;
    expect(one).toContain('Total:');
    expect(one).not.toContain('Close');
    expect(one).not.toContain('Page ');
    expect(one).not.toContain('Nothing asks for this');
  });

  it('is only absent because the bundler dropped it', async () => {
    // The control. Three strings missing from a bundle proves nothing on its
    // own — the same assertions pass against a module that never held them.
    const [, every] = await both;
    expect(every).toContain('Total:');
    expect(every).toContain('Close');
    expect(every).toContain('Page ');
    expect(every).toContain('Nothing asks for this');
  });

  it('costs an application nothing, so size stops tracking the catalogue', async () => {
    const [one, every] = await both;
    // Roughly 460 B against 1,170 B unminified: the difference is the three
    // messages this application never named and the lookup table that names
    // them all. A generated module with a top-level side effect would collapse
    // it, which is exactly the regression reading the source cannot see.
    expect(one.length).toBeLessThan(every.length / 2);
    expect(one).not.toContain('_all');
  });
});
