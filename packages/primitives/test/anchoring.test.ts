import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('reports what the environment can do', async () => {
    const outer = document.createElement('div');
    outer.setAttribute('dir', 'ltr');
    document.body.append(outer);

    let seen = 0;
    const observer = new MutationObserver(() => {
      seen += 1;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir'],
      subtree: true,
    });
    outer.setAttribute('dir', 'rtl');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    console.log(
      JSON.stringify(
        {
          nonsense: CSS.supports('flibberty', 'gibbet'),
          nonsenseValue: CSS.supports('color', 'not-a-colour'),
          oneArg: CSS.supports('display: grid'),
          mutationsSeen: seen,
        },
        null,
        2,
      ),
    );
    observer.disconnect();
    expect(true).toBe(true);
  });
});
