import { describe, it } from 'vitest';
import { compile } from '@voltjs/compiler';

/**
 * Not an assertion suite — this prints generated code so failures elsewhere
 * can be read directly instead of inferred. Kept out of the default run.
 */
describe.skip('codegen output', () => {
  const cases: [string, string][] = [
    ['click', `<button :click="inc()">{{ count.get() }}</button>`],
    ['mixed', `<p>Hi, {{ name.get() }}! You have {{ count.get() }} messages.</p>`],
    ['for', `<ul><li :for="(item, i) in items.get()" :key="item">{{ i }}:{{ item }}</li></ul>`],
    ['if', `<div><span :if="a.get()">x</span><span :else>y</span></div>`],
    ['model', `<div><input :model="text"><span>{{ text.get() }}</span></div>`],
  ];

  for (const [name, template] of cases) {
    it(name, () => {
      console.info(`\n===== ${name} =====\n${compile(template).body}\n`);
    });
  }
});
