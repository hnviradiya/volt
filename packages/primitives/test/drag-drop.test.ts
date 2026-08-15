import { describe, expect, it } from 'vitest';

describe('happy-dom capabilities', () => {
  it('reports what exists', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const caps = {
      PointerEvent: typeof PointerEvent,
      setPointerCapture: typeof el.setPointerCapture,
      releasePointerCapture: typeof el.releasePointerCapture,
      hasPointerCapture: typeof el.hasPointerCapture,
      checkVisibility: typeof (el as unknown as { checkVisibility?: unknown }).checkVisibility,
      ResizeObserver: typeof ResizeObserver,
      IntersectionObserver: typeof IntersectionObserver,
      elementFromPoint: typeof document.elementFromPoint,
      getBoundingClientRect: JSON.stringify(el.getBoundingClientRect()),
      scrollTo: typeof el.scrollTo,
      scrollBy: typeof el.scrollBy,
      requestAnimationFrame: typeof requestAnimationFrame,
      overflowY: getComputedStyle(el).overflowY,
      matchMedia: typeof matchMedia,
      scrollHeight: el.scrollHeight,
    };
    console.log(caps);
    expect(true).toBe(true);
  });

  it('pointer event props', () => {
    const ev = new PointerEvent('pointerdown', {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 5,
      clientY: 6,
      bubbles: true,
      button: 0,
    });
    console.log({
      id: ev.pointerId,
      type: ev.pointerType,
      x: ev.clientX,
      y: ev.clientY,
      button: ev.button,
      isPrimary: ev.isPrimary,
    });
    expect(ev.pointerId).toBe(3);
  });

  it('scroll props are writable', () => {
    const el = document.createElement('div');
    document.body.append(el);
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    el.scrollTop = 40;
    console.log({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    expect(el.scrollTop).toBe(40);
  });
});
