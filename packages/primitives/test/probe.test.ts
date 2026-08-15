import { describe, expect, it } from 'vitest';

describe('probe3', () => {
  it('focus on tabindexed spans', () => {
    document.body.innerHTML = `
      <div id="g">
        <span id="a" tabindex="0">a</span>
        <span id="b" tabindex="-1">b</span>
      </div>`;
    const a = document.querySelector('#a') as HTMLElement;
    const b = document.querySelector('#b') as HTMLElement;
    a.focus();
    console.log('active', document.activeElement?.id);
    b.focus();
    console.log('active', document.activeElement?.id);
    console.log('focus fn?', typeof a.focus);
    expect(document.activeElement?.id).toBe('b');
  });
});
