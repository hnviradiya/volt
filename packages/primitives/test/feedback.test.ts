import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('reports environment capabilities', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    (el as HTMLElement).inert = true;
    const el2 = document.createElement('div');
    (el2 as unknown as Record<string, unknown>)['role'] = 'alert';
    const el3 = document.createElement('div');
    (el3 as unknown as Record<string, unknown>)['ariaLabel'] = 'hi';
    expect({
      inertInEl: 'inert' in el,
      roleInEl: 'role' in el,
      ariaLabelInEl: 'ariaLabel' in el,
      checkVisibility: typeof el.checkVisibility,
      raf: typeof requestAnimationFrame,
      inertAttr: el.hasAttribute('inert'),
      roleAttr: el2.getAttribute('role'),
      ariaLabelAttr: el3.getAttribute('aria-label'),
    }).toBe('SHOWME');
  });
});
