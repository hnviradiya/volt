import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('custom properties', () => {
    const el = document.createElement('div');
    el.style.setProperty('--x', '120px');
    expect(el.style.getPropertyValue('--x')).toBe('120px');
    expect(el.getAttribute('style')).toBe('--x: 120px;');
  });
  it('scrollHeight stub', () => {
    const proto = Element.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 120 });
    const el = document.createElement('div');
    expect(el.scrollHeight).toBe(120);
    if (original) Object.defineProperty(proto, 'scrollHeight', original);
    expect(el.scrollHeight).toBe(0);
  });
  it('ResizeObserver', () => {
    expect(typeof window.ResizeObserver).toBe('function');
  });
});
