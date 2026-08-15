import { describe, expect, it, vi } from 'vitest';

describe('happy-dom probes', () => {
  it('pointerenter dispatch', () => {
    document.body.innerHTML = '<div id="r"><button id="b">x</button></div>';
    const r = document.querySelector('#r')!;
    let entered = 0;
    r.addEventListener('pointerenter', () => entered++);
    r.dispatchEvent(new Event('pointerenter'));
    expect(entered).toBe(1);
  });

  it('focus fires focusin on ancestor and focusout has relatedTarget', () => {
    document.body.innerHTML = '<div id="r"><button id="b">x</button><button id="c">y</button></div>';
    const r = document.querySelector('#r') as HTMLElement;
    const b = document.querySelector('#b') as HTMLElement;
    const c = document.querySelector('#c') as HTMLElement;
    const seen: string[] = [];
    r.addEventListener('focusin', () => seen.push('in'));
    r.addEventListener('focusout', (e) => {
      seen.push(`out:${(e as FocusEvent).relatedTarget ? 'rel' : 'null'}`);
    });
    b.focus();
    c.focus();
    console.log('focus events', seen, document.activeElement?.id);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('document.hidden is definable', () => {
    console.log('initial hidden', document.hidden, document.visibilityState);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(document.hidden).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
  });

  it('fake timers mock Date.now', () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.advanceTimersByTime(1000);
    console.log('delta', Date.now() - start);
    vi.useRealTimers();
  });

  it('region tabindex focus', () => {
    document.body.innerHTML = '<div id="r" tabindex="-1">x</div>';
    const r = document.querySelector('#r') as HTMLElement;
    r.focus();
    console.log('active', document.activeElement?.id);
    expect(document.activeElement).toBe(r);
  });

  it('getElementById works and Element.role reflects', () => {
    document.body.innerHTML = '<div id="toast-1">x</div>';
    const el = document.getElementById('toast-1');
    expect(el).not.toBeNull();
    (el as HTMLElement & { role?: string }).role = 'status';
    console.log('role attr', el!.getAttribute('role'), 'role in el', 'role' in el!);
  });
});
