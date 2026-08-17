/**
 * Query keys — structural, not concatenated.
 *
 * A key is an array naming a question: `['users']`, `['users', id]`,
 * `['users', id, 'posts', { page: 2 }]`. Two keys are the same entry when
 * their parts are equal *by value*, so the object literal a component rebuilds
 * on every read still hits the cache, and `{ page, filter }` finds what
 * `{ filter, page }` stored — property order is not information.
 *
 * The implementation every cache reaches for first is `key.join('/')`, and it
 * is wrong twice over. `['a/b']` and `['a', 'b']` collide, so two unrelated
 * queries share one entry. And prefix invalidation becomes `startsWith`, where
 * invalidating `['user']` also invalidates `['users', 1]` — the wrong half of
 * the application refetched, silently, from a typo. Here each part is hashed
 * on its own and a prefix is compared part by part, so neither is expressible.
 *
 * The cost is that a part has to be something comparable by value. A `Map`, a
 * `Set` or a class instance is rejected rather than hashed to `{}`, which is
 * what `JSON.stringify` would do — and two different keys hashing to the same
 * `{}` is a cache that serves one query's data to another.
 */

/** Everything that names an entry, outermost first. */
export type QueryKey = readonly unknown[];

function describe(value: unknown): string {
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return 'a symbol';
  const name = (value as object).constructor?.name;
  return name ? `a ${name}` : 'that value';
}

function unsupported(value: unknown): never {
  throw new TypeError(
    `[volt] A query key part must be comparable by value, and ${describe(value)} is not. ` +
      'Use whatever identifies it — an id, a plain object of the fields you filtered by.',
  );
}

/**
 * One key part, as a string that is equal exactly when the part is.
 *
 * Every branch here exists because the obvious `JSON.stringify` collapses two
 * distinct values onto one string somewhere.
 */
function hashPart(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      // Quoted, so the string 'null' cannot be read back as the value null.
      return JSON.stringify(value);
    case 'boolean':
      return String(value);
    case 'number':
      // `JSON.stringify` writes NaN and both infinities as `null`, which would
      // stack three more values on top of the one for null.
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value}n`;
    case 'object':
      break;
    default:
      unsupported(value);
  }

  if (Array.isArray(value)) return `[${value.map(hashPart).join(',')}]`;
  // Tagged rather than left as its ISO string, which a string part could equal.
  if (value instanceof Date) return `Date(${value.getTime()})`;

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== null && prototype !== Object.prototype) unsupported(value);

  const record = value as Record<string, unknown>;
  // `Object.keys` cannot see a symbol key, so `{ [sym]: 1 }`, `{ [other]: 2 }`
  // and `{}` would be one string — the `{}` collision this module exists to
  // make unexpressible, reached from inside a part rather than as one. A symbol
  // is already refused as a part; refusing it here is the same rule.
  const symbols = Object.getOwnPropertySymbols(record);
  if (symbols.length > 0) unsupported(symbols[0]);

  const fields = Object.keys(record)
    .sort()
    // A field set to undefined is dropped, because `{ page, filter: undefined }`
    // and `{ page }` are the same question asked by two call sites — one of
    // which happened to have nothing to filter by.
    .filter((name) => record[name] !== undefined)
    .map((name) => `${JSON.stringify(name)}:${hashPart(record[name])}`);
  return `{${fields.join(',')}}`;
}

/**
 * Each part hashed on its own — which is what makes prefix matching a
 * comparison between parts rather than between strings.
 */
export function queryKeyParts(key: QueryKey): string[] {
  return key.map(hashPart);
}

/** The map key. Injective: this is the JSON encoding of the parts array. */
export function hashParts(parts: readonly string[]): string {
  return `[${parts.join(',')}]`;
}

/** What identifies a key in the cache. Equal strings mean equal keys. */
export function hashQueryKey(key: QueryKey): string {
  return hashParts(queryKeyParts(key));
}

/**
 * Whether `parts` names something at or under `prefix`.
 *
 * `['users']` covers `['users', 1]` and `['users', 1, 'posts']`, and covers
 * nothing else — not `['user']`, and not `['usergroups']`.
 */
export function isKeyPrefix(prefix: readonly string[], parts: readonly string[]): boolean {
  if (prefix.length > parts.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== parts[i]) return false;
  }
  return true;
}
