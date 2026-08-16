import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('capture ordering and styles', () => {
    document.body.innerHTML = '<div id="a"><button id="b">x</button></div>';
    const a = document.querySelector('#a') as HTMLElement;
    const b = document.querySelector('#b') as HTMLElement;

    const order: string[] = [];
    const onWin = () => order.push('window');
    const onDoc = () => order.push('document');
    document.addEventListener('keydown', onDoc, true);
    window.addEventListener('keydown', onWin, true);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    console.log('capture order', order);

    order.length = 0;
    const onWin2 = (e: Event) => {
      order.push('window');
      e.stopPropagation();
    };
    window.removeEventListener('keydown', onWin, true);
    window.addEventListener('keydown', onWin2, true);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    console.log('after stopPropagation at window', order);
    window.removeEventListener('keydown', onWin2, true);
    document.removeEventListener('keydown', onDoc, true);

    a.style.overflowY = 'auto';
    console.log('computed overflowY', getComputedStyle(a).overflowY, '|', getComputedStyle(a).overflow);
    console.log('checkVisibility opts', a.checkVisibility({ visibilityProperty: true }));
    console.log('scrollIntoView', typeof a.scrollIntoView);
    console.log('body userSelect', typeof document.body.style.userSelect);

    // pointer events to window capture
    const pointerSeen: string[] = [];
    const onPtr = () => pointerSeen.push('doc');
    document.addEventListener('pointermove', onPtr, true);
    b.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 2 }));
    console.log('pointermove to document capture', pointerSeen);
    document.removeEventListener('pointermove', onPtr, true);

    console.log('setPointerCapture throws?', (() => {
      try {
        b.setPointerCapture(1);
        return 'no';
      } catch (error) {
        return String(error);
      }
    })());

    const stub = document.createElement('div');
    stub.getBoundingClientRect = () => new DOMRect(0, 10, 100, 20);
    console.log('stubbed rect', JSON.stringify(stub.getBoundingClientRect()));
    expect(true).toBe(true);
  });

  it('raf timing', async () => {
    let frames = 0;
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        frames++;
        if (frames >= 3) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    console.log('frames', frames, 'ms', Date.now() - start);
    expect(frames).toBe(3);
  });
});
