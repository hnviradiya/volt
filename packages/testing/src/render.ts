/**
 * Mount a component the way an application does, and take it away again with
 * nothing left behind.
 *
 * The interesting half is the second one. A component that forgets to release
 * a listener, a timer or an effect looks perfectly correct in a test suite:
 * the assertions pass, the elements are gone from the DOM, and the effect goes
 * on observing a tree nobody can see. `leakedEffects()` is the whole reason
 * this returns a handle rather than an element — it asks the scheduler what it
 * is still watching, so "unmounts cleanly" is something a test asserts rather
 * than something a README claims.
 *
 *   const view = render(Counter);
 *   click(view.getByRole('button', { name: 'Add' }));
 *   expect(view.getByRole('status')).toHaveTextContent('1');
 *
 *   view.unmount();
 *   expect(view.leakedEffects()).toBe(0);
 */

import { flushSync, mount, type ComponentType } from '@voltdev/core';
import {
  getAllByRole,
  getByRole,
  queryAllByRole,
  queryByRole,
  type RoleQueryOptions,
} from './queries.js';
import { liveEffectCount } from './scheduler.js';

export interface RenderResult<T> {
  /**
   * The element the component was mounted into.
   *
   * For the cases that genuinely are about markup — a snapshot, a class a
   * stylesheet depends on. The queries below deliberately do not use it.
   */
  container: HTMLElement;

  /** The component instance, for driving it from outside its own markup. */
  instance: T;

  /**
   * Find by role, over the whole document rather than over `container`.
   *
   * A portalled dialog, popover or toast renders outside the component that
   * declared it — that is what `:portal` is for — so a query scoped to the
   * container would fail to find precisely the parts most worth testing. The
   * user sees one page; so does this. Pass `container` to the free functions
   * in `queries.ts` to narrow deliberately.
   */
  getByRole(role: string, options?: RoleQueryOptions): HTMLElement;
  getAllByRole(role: string, options?: RoleQueryOptions): HTMLElement[];
  queryByRole(role: string, options?: RoleQueryOptions): HTMLElement | null;
  queryAllByRole(role: string, options?: RoleQueryOptions): HTMLElement[];

  /** Tear the component down and remove its container. Safe to call twice. */
  unmount(): void;

  /**
   * Effects created since this component mounted that the scheduler is still
   * watching. Call it after `unmount()`, where anything but zero is a leak.
   *
   * It is a difference rather than a total, because effects created by the
   * suite around this one are none of this component's business.
   */
  leakedEffects(): number;
}

/**
 * Every render that has not been unmounted, so `cleanup()` can find them.
 *
 * A test that fails part way through never reaches its own `unmount()`, and
 * the component it left behind would otherwise keep answering queries in the
 * next test — which is how one broken test becomes a broken file.
 */
const live = new Set<{ unmount(): void }>();

/**
 * Mount a component into a fresh element in the document body.
 *
 * In the document rather than detached, because Volt delegates bubbling events
 * to the document: a handler on a detached tree is never called, so a
 * component tested outside the document would appear not to respond to
 * anything.
 */
export function render<T>(component: ComponentType<T>): RenderResult<T> {
  const before = liveEffectCount();

  const container = document.createElement('div');
  document.body.append(container);

  const handle = mount(component, container);
  const body = container.ownerDocument.body;

  let unmounted = false;
  const result: RenderResult<T> = {
    container,
    instance: handle.instance as T,

    getByRole: (role, options) => getByRole(body, role, options),
    getAllByRole: (role, options) => getAllByRole(body, role, options),
    queryByRole: (role, options) => queryByRole(body, role, options),
    queryAllByRole: (role, options) => queryAllByRole(body, role, options),

    unmount() {
      if (unmounted) return;
      unmounted = true;
      live.delete(result);
      handle.unmount();
      container.remove();
      // Teardown can dirty signals a cleanup wrote to, so the count below is
      // only honest once those have run.
      flushSync();
    },

    leakedEffects: () => liveEffectCount() - before,
  };

  live.add(result);
  return result;
}

/**
 * Unmount everything still mounted. Wire it up once per file:
 *
 *   afterEach(cleanup);
 *
 * It deliberately does not assert that nothing leaked. A failure raised from
 * `afterEach` reports against the test that happened to run last rather than
 * the component at fault, and it would fire on effects the test itself created
 * on purpose. Leaks are asserted where they can be attributed, with
 * `leakedEffects()`.
 */
export function cleanup(): void {
  // Newest first, so a component mounted inside another's lifetime goes first.
  for (const result of [...live].reverse()) result.unmount();
  live.clear();
}
