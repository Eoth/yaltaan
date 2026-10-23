// Type tests: assertions the compiler checks and the runtime ignores. `Equal` compares by the compiler's own identity
// of two types, not by assignability both ways, which would take `any` for any type and `{ a: 1 } & { b: 2 }` for
// `{ a: 1; b: 2 }` alike only by accident.

/** `true` when `A` and `B` are the same type, `false` otherwise. */
export type Equal<A, B> = (<V>() => V extends A ? 1 : 2) extends <V>() => V extends B ? 1 : 2 ? true : false;

/** Compiles only when its type argument is `true`: `assertType<Equal<typeof x, number>>()`. Does nothing when run. */
export function assertType<_Assertion extends true>(): void {}
