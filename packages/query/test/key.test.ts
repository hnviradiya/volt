/**
 * Query keys.
 *
 * Two properties matter and both are about collisions. Keys that name the same
 * question must hash the same however the array was built — that is what makes
 * a cache hit rather than a second request. Keys that name different questions
 * must never hash the same, because one query's data served under another
 * query's key is a wrong screen that looks like a backend bug.
 *
 * So most of what is here is pairs that a naive `key.join('/')` or a
 * `JSON.stringify` would collapse onto one string.
 */
import { describe, expect, it } from 'vitest';
import { hashQueryKey, isKeyPrefix, queryKeyParts } from '../src/key.js';

/** The two keys name the same entry. */
const same = (a: unknown[], b: unknown[]): boolean => hashQueryKey(a) === hashQueryKey(b);

describe('keys that name the same question', () => {
  it('does not care how the array was constructed', () => {
    const id = 1;
    expect(same(['users', 1], ['users', id])).toBe(true);
    expect(same(['users', 1], ['users'].concat([1] as never))).toBe(true);
    expect(same(['users', 1], [...['users'], ...[1]])).toBe(true);
  });

  it('reads an object part by value, not by identity', () => {
    // The case that actually happens: a component rebuilds `{ page }` on every
    // read, and identity would make every read a fresh entry.
    expect(same(['list', { page: 2 }], ['list', { page: 2 }])).toBe(true);
  });

  it('ignores property order, which is not information', () => {
    expect(same(['list', { page: 2, filter: 'open' }], ['list', { filter: 'open', page: 2 }])).toBe(
      true,
    );
  });

  it('treats a field set to undefined as a field that is not there', () => {
    // Two call sites asking the same question, one of which had nothing to
    // filter by.
    expect(same(['list', { page: 2, filter: undefined }], ['list', { page: 2 }])).toBe(true);
  });

  it('compares nested arrays and objects the same way', () => {
    expect(same(['x', { tags: ['a', 'b'], at: { page: 1 } }], ['x', { at: { page: 1 }, tags: ['a', 'b'] }])).toBe(
      true,
    );
  });

  it('compares dates by instant', () => {
    expect(same(['at', new Date(1700000000000)], ['at', new Date(1700000000000)])).toBe(true);
    expect(same(['at', new Date(1700000000000)], ['at', new Date(1700000000001)])).toBe(false);
  });
});

describe('keys that name different questions', () => {
  it('does not run parts together the way a join would', () => {
    // `['a/b']` and `['a', 'b']` are one string under `key.join('/')`.
    expect(same(['a/b'], ['a', 'b'])).toBe(false);
    expect(same(['a', 'b'], ['ab'])).toBe(false);
  });

  it('separates a string from the value it spells', () => {
    expect(same(['x', 'null'], ['x', null])).toBe(false);
    expect(same(['x', 'undefined'], ['x', undefined])).toBe(false);
    expect(same(['x', '1'], ['x', 1])).toBe(false);
    expect(same(['x', 'true'], ['x', true])).toBe(false);
    expect(same(['x', '1n'], ['x', 1n])).toBe(false);
  });

  it('separates a string from the object it spells', () => {
    expect(same(['x', '{"page":1}'], ['x', { page: 1 }])).toBe(false);
    expect(same(['x', '[1,2]'], ['x', [1, 2]])).toBe(false);
  });

  it('keeps the numbers JSON writes as null apart', () => {
    // `JSON.stringify` renders all four of these as `null`, which would stack
    // NaN, both infinities and a genuine null onto one entry.
    const values = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const hashes = new Set(values.map((value) => hashQueryKey(['n', value])));
    expect(hashes.size).toBe(4);
  });

  it('keeps -0 apart from 0', () => {
    expect(same(['n', -0], ['n', 0])).toBe(false);
  });

  it('separates a date from the number of its instant', () => {
    expect(same(['at', new Date(5)], ['at', 5])).toBe(false);
  });

  it('separates an array part from the parts it contains', () => {
    expect(same([['a', 'b']], ['a', 'b'])).toBe(false);
  });

  it('separates an empty object from an empty array', () => {
    expect(same(['x', {}], ['x', []])).toBe(false);
  });

  it('separates a key from its own prefix', () => {
    expect(same(['users'], ['users', undefined])).toBe(false);
  });
});

describe('parts that cannot be compared by value', () => {
  it('rejects a Map rather than hashing it to nothing', () => {
    // `JSON.stringify(new Map([['a', 1]]))` is `{}`, and so is every other
    // Map — one entry shared by every query that filtered by anything.
    expect(() => hashQueryKey(['x', new Map([['a', 1]])])).toThrow(/comparable by value/);
    expect(() => hashQueryKey(['x', new Map()])).toThrow(/a Map/);
  });

  it('rejects a Set, a function and a symbol', () => {
    expect(() => hashQueryKey(['x', new Set([1])])).toThrow(/a Set/);
    expect(() => hashQueryKey(['x', () => 1])).toThrow(/a function/);
    expect(() => hashQueryKey(['x', Symbol('s')])).toThrow(/a symbol/);
  });

  it('rejects a class instance and names the class', () => {
    class Filter {
      constructor(readonly page: number) {}
    }
    expect(() => hashQueryKey(['x', new Filter(1)])).toThrow(/a Filter/);
  });

  it('rejects one nested inside a plain object', () => {
    expect(() => hashQueryKey(['x', { where: new Map() }])).toThrow(/a Map/);
  });

  it('accepts a null-prototype object, which is a record', () => {
    const record = Object.assign(Object.create(null) as Record<string, unknown>, { page: 1 });
    expect(hashQueryKey(['x', record])).toBe(hashQueryKey(['x', { page: 1 }]));
  });
});

describe('prefix matching', () => {
  const parts = (key: unknown[]) => queryKeyParts(key);

  it('covers everything under the prefix', () => {
    expect(isKeyPrefix(parts(['users']), parts(['users']))).toBe(true);
    expect(isKeyPrefix(parts(['users']), parts(['users', 1]))).toBe(true);
    expect(isKeyPrefix(parts(['users']), parts(['users', 1, 'posts']))).toBe(true);
  });

  it('compares part by part, so a typo cannot reach the wrong half of the app', () => {
    // The `startsWith` implementation matches both of these.
    expect(isKeyPrefix(parts(['user']), parts(['users', 1]))).toBe(false);
    expect(isKeyPrefix(parts(['users']), parts(['usergroups', 1]))).toBe(false);
  });

  it('does not match a number against one that merely starts with it', () => {
    // The same failure as `['user']` against `['users', 1]`, and far easier to
    // hit: ids are sequential, so user 1 is a prefix of a tenth of the table.
    expect(isKeyPrefix(parts(['users', 1]), parts(['users', 12]))).toBe(false);
    expect(isKeyPrefix(parts(['users', 1]), parts(['users', 1, 'posts']))).toBe(true);
  });

  it('does not match a longer prefix against a shorter key', () => {
    expect(isKeyPrefix(parts(['users', 1]), parts(['users']))).toBe(false);
  });

  it('matches everything when the prefix is empty', () => {
    expect(isKeyPrefix(parts([]), parts(['users', 1]))).toBe(true);
  });
});
