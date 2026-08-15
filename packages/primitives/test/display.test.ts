import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';

describe('probe', () => {
  it('property reflection in happy-dom', () => {
    const out: Record<string, unknown> = {};
    const d = document.createElement('div');
    (d as unknown as Record<string, unknown>).role = 'progressbar';
    out.roleAttr = d.getAttribute('role');
    const img = document.createElement('img');
    (img as unknown as Record<string, unknown>).alt = 'Ada Lovelace';
    out.altAttr = img.getAttribute('alt');
    (img as unknown as Record<string, unknown>).alt = '';
    out.altEmpty = img.getAttribute('alt');
    out.hasAlt = img.hasAttribute('alt');
    writeFileSync(
      '/tmp/claude-1000/-home-meera-volt/95557108-e7f2-428f-a2ce-45846292a411/scratchpad/probe.json',
      JSON.stringify(out, null, 2),
    );
    expect(out).toBeTruthy();
  });
});
