/**
 * In-browser template compilation.
 *
 * Importing this module lets components carry a raw `template` string with no
 * build step — convenient for prototyping, playgrounds, and tests.
 *
 * Production apps should use `@voltjs/vite-plugin` instead, which compiles
 * templates at build time and keeps the compiler out of the bundle entirely.
 * This module exists as a separate entry precisely so that choice is explicit.
 */

import { compile } from '@voltjs/compiler';
import { setTemplateCompiler, type RenderFn } from './component.js';
import * as runtime from './runtime.js';

setTemplateCompiler((template: string, filename: string): RenderFn => {
  const { body } = compile(template, { filename, runtime: '_rt' });
  // The generated body closes over `_rt` and returns the render function.
  const factory = new Function('_rt', body) as (rt: unknown) => RenderFn;
  return factory(runtime);
});

export { compile } from '@voltjs/compiler';
