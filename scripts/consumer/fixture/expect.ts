// Tiny type-assertion helpers for the consumer fixture (no dependencies).

export type IsAny<T> = 0 extends 1 & T ? true : false;

/** Strict type equality: distinguishes `any`, `readonly` and optional members. */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Mutual assignability that rejects `any`. Used where validators spell the same
 * type differently (e.g. `void` vs `undefined`, intersections vs flat objects).
 */
export type Same<A, B> =
  IsAny<A> extends true
    ? IsAny<B>
    : IsAny<B> extends true
      ? false
      : [A] extends [B]
        ? [B] extends [A]
          ? true
          : false
        : false;

/** Compile-time assertion: `assert<Same<typeof x, string>>()`. */
export function assert<T extends true>(value?: T): void {
  void value;
}

/** Checks that `value` is assignable to `T` without widening it. */
export function expectType<T>(value: T): T {
  return value;
}
