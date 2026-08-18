/**
 * Build-time flag separating developer diagnostics from shipped code.
 *
 * `@voltdev/vite-plugin` defines this in every Volt build — `true` while
 * developing and testing, `false` for a production bundle — so a minifier
 * removes each `if (__VOLT_DEV__)` block outright. That is what keeps Volt's
 * long, explanatory error messages out of production bundles without giving
 * them up during development.
 *
 * Anything inside such a block must be a diagnostic only. Behaviour a correct
 * program depends on has to sit outside it, because in production the block
 * does not exist.
 */
declare const __VOLT_DEV__: boolean;

/**
 * Build-time flag separating a server build from a client one.
 *
 * `@voltdev/vite-plugin` defines this in every Volt build — `true` for an SSR
 * build, `false` otherwise — so a client bundle drops the server's flushing,
 * request scoping and lifecycle gating outright rather than shipping code no
 * browser will ever reach.
 *
 * Unlike `__VOLT_DEV__`, behaviour depends on this: on the server a queued
 * microtask fires at the first `await`, with whatever request happens to be
 * current, so the gates guarded here are what keep one render out of
 * another's output.
 */
declare const __VOLT_SERVER__: boolean;
