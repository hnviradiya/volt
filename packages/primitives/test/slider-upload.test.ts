import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('reports what happy-dom has', () => {
    const info = {
      File: typeof File,
      Blob: typeof Blob,
      DataTransfer: typeof DataTransfer,
      DragEvent: typeof DragEvent,
      ClipboardEvent: typeof ClipboardEvent,
      FormData: typeof FormData,
      XHR: typeof XMLHttpRequest,
      checkVisibility: typeof document.createElement('div').checkVisibility,
      setPointerCapture: typeof document.createElement('div').setPointerCapture,
      PointerEvent: typeof PointerEvent,
      getBoundingClientRect: typeof document.createElement('div').getBoundingClientRect,
    };
    console.log(JSON.stringify(info, null, 2));

    const f = new File(['hello'], 'a.txt', { type: 'text/plain' });
    console.log('file', f.name, f.size, f.type, typeof f.slice, typeof f.arrayBuffer);

    const dt = new DataTransfer();
    console.log('dt items', typeof dt.items?.add, dt.files?.length);
    try {
      dt.items.add(f);
      console.log('after add', dt.files.length, dt.types);
    } catch (e) {
      console.log('add failed', String(e));
    }

    const ev = new DragEvent('drop', { bubbles: true });
    console.log('dragevent dataTransfer', ev.dataTransfer);

    const ce = new ClipboardEvent('paste');
    console.log('clipboardevent clipboardData', ce.clipboardData);

    const pe = new PointerEvent('pointerdown', { clientX: 5, clientY: 6, pointerId: 1 });
    console.log('pointerevent', pe.clientX, pe.clientY, pe.pointerId);

    expect(true).toBe(true);
  });
});
