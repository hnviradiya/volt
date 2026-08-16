import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('environment 2', async () => {
    const el = document.createElement('div');
    document.body.append(el);

    const ev = new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 2 });
    console.log('isPrimary settable', ev.isPrimary);

    el.style.setProperty('--volt-thumb-size', 'max(20px, 25%)');
    console.log('custom prop', el.style.getPropertyValue('--volt-thumb-size'));

    let fired = 0;
    const ro = new ResizeObserver(() => fired++);
    ro.observe(el);
    await new Promise((r) => setTimeout(r, 10));
    console.log('RO fired', fired);
    ro.disconnect();

    console.log('checkVisibility', el.checkVisibility());

    const target = document.createElement('div');
    document.body.append(target);
    let captured = 'no';
    try {
      target.setPointerCapture(3);
      captured = 'yes';
    } catch (error) {
      captured = String(error);
    }
    console.log('setPointerCapture', captured);

    expect(true).toBe(true);
  });
});
