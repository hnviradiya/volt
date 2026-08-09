/**
 * Spike: what do TC39 standard decorators actually give us under the
 * toolchain Volt targets (esbuild, via Vite/Vitest)?
 *
 * The component layer's design depends on the answers, so they are pinned as
 * tests rather than assumed.
 */
import { describe, expect, it } from 'vitest';

// `Symbol.metadata` is stage-3 and absent from every current engine. Without
// it the decorator transform silently skips attaching metadata to the class,
// so Volt installs it before any decorated class is evaluated.
(Symbol as { metadata?: symbol }).metadata ??= Symbol('Symbol.metadata');

describe('standard decorator capabilities', () => {
  it('runs class decorators and can return the class', () => {
    const seen: string[] = [];

    function Marker(value: unknown, context: ClassDecoratorContext) {
      seen.push(`class:${String(context.name)}:${context.kind}`);
      return value as never;
    }

    @Marker
    class Target {}

    expect(new Target()).toBeInstanceOf(Target);
    expect(seen).toEqual(['class:Target:class']);
  });

  it('runs field decorators at class definition time, before any instance', () => {
    const order: string[] = [];

    function Field(_value: undefined, context: ClassFieldDecoratorContext) {
      order.push(`decorate:${String(context.name)}`);
      return (initial: unknown) => {
        order.push(`init:${String(context.name)}`);
        return initial;
      };
    }

    class Target {
      @Field accessor1 = 1;
      @Field accessor2 = 2;
    }

    // Decoration happens once, up front.
    expect(order).toEqual(['decorate:accessor1', 'decorate:accessor2']);

    new Target();
    expect(order).toEqual([
      'decorate:accessor1',
      'decorate:accessor2',
      'init:accessor1',
      'init:accessor2',
    ]);
  });

  it('supports context.metadata, shared across a class and readable by the class decorator', () => {
    const FIELDS = Symbol('fields');
    let seenByClassDecorator: unknown = 'unset';

    function Field(_value: undefined, context: ClassFieldDecoratorContext) {
      const metadata = context.metadata as Record<symbol, string[]>;
      (metadata[FIELDS] ??= []).push(String(context.name));
      return undefined;
    }

    function Collect(value: unknown, context: ClassDecoratorContext) {
      // Class decorators run after every member decorator, so the metadata
      // object is fully populated here.
      seenByClassDecorator = (context.metadata as Record<symbol, string[]>)[FIELDS];
      return value as never;
    }

    @Collect
    class Target {
      @Field first = 1;
      @Field second = 2;
    }

    expect(seenByClassDecorator).toEqual(['first', 'second']);
    // And it is reachable from the class itself at runtime.
    expect((Target as never as Record<symbol, unknown>)[Symbol.metadata]).toBeDefined();
  });

  it('supports accessor fields with get/set replacement', () => {
    function Doubling(
      target: ClassAccessorDecoratorTarget<unknown, number>,
      _context: ClassAccessorDecoratorContext,
    ): ClassAccessorDecoratorResult<unknown, number> {
      return {
        get() {
          return target.get.call(this) * 2;
        },
        set(value: number) {
          target.set.call(this, value);
        },
        init(initial: number) {
          return initial;
        },
      };
    }

    class Target {
      @Doubling accessor value = 5;
    }

    const instance = new Target();
    expect(instance.value).toBe(10);
    instance.value = 10;
    expect(instance.value).toBe(20);
  });

  it('exposes addInitializer with the instance as `this`', () => {
    const seen: unknown[] = [];

    function Track(_value: undefined, context: ClassFieldDecoratorContext) {
      context.addInitializer(function (this: unknown) {
        seen.push((this as { constructor: { name: string } }).constructor.name);
      });
      return undefined;
    }

    class Target {
      @Track field = 1;
    }

    new Target();
    new Target();
    expect(seen).toEqual(['Target', 'Target']);
  });

  it('leaks into the base class if inherited metadata is mutated in place', () => {
    const FIELDS = Symbol('fields');

    // The naive version: `??=` finds the base's array through the prototype
    // chain and pushes into it, corrupting the base class's metadata.
    function NaiveField(_value: undefined, context: ClassFieldDecoratorContext) {
      const metadata = context.metadata as Record<symbol, string[]>;
      (metadata[FIELDS] ??= []).push(String(context.name));
      return undefined;
    }

    class Base {
      @NaiveField fromBase = 1;
    }
    class Derived extends Base {
      @NaiveField fromDerived = 2;
    }

    const baseMeta = (Base as never as Record<symbol, Record<symbol, string[]>>)[
      Symbol.metadata
    ];
    void Derived;

    // Base has been polluted by its subclass — this is the bug to avoid.
    expect(baseMeta[FIELDS]).toEqual(['fromBase', 'fromDerived']);
  });

  it('inherits metadata correctly when the subclass copies on write', () => {
    const FIELDS = Symbol('fields');

    /** Give the metadata object its own array before appending to it. */
    function append(metadata: Record<symbol, string[]>, key: symbol, value: string) {
      if (!Object.hasOwn(metadata, key)) {
        const inherited = metadata[key];
        metadata[key] = inherited ? [...inherited] : [];
      }
      metadata[key]!.push(value);
    }

    function Field(_value: undefined, context: ClassFieldDecoratorContext) {
      append(context.metadata as Record<symbol, string[]>, FIELDS, String(context.name));
      return undefined;
    }

    class Base {
      @Field fromBase = 1;
    }
    class Derived extends Base {
      @Field fromDerived = 2;
    }

    const baseMeta = (Base as never as Record<symbol, Record<symbol, string[]>>)[
      Symbol.metadata
    ];
    const derivedMeta = (Derived as never as Record<symbol, Record<symbol, string[]>>)[
      Symbol.metadata
    ];

    expect(baseMeta[FIELDS]).toEqual(['fromBase']);
    expect(derivedMeta[FIELDS]).toEqual(['fromBase', 'fromDerived']);
  });
});
