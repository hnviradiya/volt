/**
 * In-browser template compilation.
 *
 * Components are authored with `templateUrl`, which `@volt/vite-plugin`
 * resolves and compiles at build time. This entry is the escape hatch for the
 * cases where there is no build step — tests, playgrounds, REPLs — and it
 * makes the cost explicit: importing it pulls the compiler in.
 *
 *   import { compileTemplate } from '@volt/core/jit';
 *
 *   @Component({
 *     selector: 'v-greeting',
 *     render: compileTemplate(`<p>Hello, { name.get() }.</p>`),
 *   })
 *   export class Greeting {
 *     name = new Signal.State('world');
 *   }
 */

import { compile } from '@volt/compiler';
import type { RenderFn } from './component.js';
import * as runtime from './runtime.js';

/**
 * Compile template source into a render function.
 *
 * The generated code closes over the runtime namespace and imports nothing,
 * which is what lets the same compiler output run here through `new Function`
 * and as a module at build time.
 */
export function compileTemplate(source: string, filename = 'template'): RenderFn {
  const { body } = compile(source, { filename, runtime: '_rt' });
  const factory = new Function('_rt', body) as (rt: unknown) => RenderFn;
  return factory(runtime);
}

export { compile } from '@volt/compiler';
