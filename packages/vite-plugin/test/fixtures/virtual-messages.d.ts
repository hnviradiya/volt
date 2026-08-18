/**
 * A stand-in for what `messages.typesFile` generates, so the fixtures below
 * resolve in an editor. The build serves the real module; this only types it.
 */
declare module 'virtual:volt-messages' {
  export const checkoutTotal: (params: { amount: string | number }) => string;
  export const t: (key: string, params?: Record<string, string | number>) => string;
}
