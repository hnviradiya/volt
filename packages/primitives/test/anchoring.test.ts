import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';

describe('probe', () => {
  it('reports what the environment can do', async () => {
    const outer = document.createElement('div');
    outer.setAttribute('dir', 'ltr');
    const inner = document.createElement('div');
    outer.append(inner);
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

    const probe = document.createElement('div');
    document.body.append(probe);
    probe.style.setProperty('anchor-name', '--x');
    probe.style.setProperty('position-area', 'bottom span-right');
    probe.style.setProperty('position-try-fallbacks', 'flip-block, flip-inline');
    probe.style.setProperty('--volt-anchor-offset', '8px');
    probe.style.setProperty('margin-top', '8px');
    probe.style.setProperty('position-visibility', 'anchors-visible');

    writeFileSync(
      '/tmp/claude-1000/-home-meera-volt/95557108-e7f2-428f-a2ce-45846292a411/scratchpad/probe.json',
      JSON.stringify(
        {
          nonsense: CSS.supports('flibberty', 'gibbet'),
          nonsenseValue: CSS.supports('color', 'not-a-colour'),
          anchorName: CSS.supports('anchor-name', '--volt'),
          oneArg: CSS.supports('display: grid'),
          mutationsSeen: seen,
          closestDir: inner.closest('[dir]')?.getAttribute('dir'),
          computedDirection: window.getComputedStyle(inner).direction,
          style: {
            anchorName: probe.style.getPropertyValue('anchor-name'),
            positionArea: probe.style.getPropertyValue('position-area'),
            fallbacks: probe.style.getPropertyValue('position-try-fallbacks'),
            custom: probe.style.getPropertyValue('--volt-anchor-offset'),
            marginTop: probe.style.getPropertyValue('margin-top'),
            visibility: probe.style.getPropertyValue('position-visibility'),
            cssText: probe.style.cssText,
          },
          checkVisibility: typeof probe.checkVisibility,
        },
        null,
        2,
      ),
    );
    observer.disconnect();
    expect(true).toBe(true);
  });
});
