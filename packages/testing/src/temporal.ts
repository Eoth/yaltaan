/// <reference lib="esnext.temporal" preserve="true" />
// The Temporal implementations a law of `@yaltaan/temporal` runs on: the polyfill always, through its implementation
// entry, as its main entry hands back the native Temporal where there is one; the native one where the runtime has it.
// A separate subpath, so that a test of another package does not load the polyfill.
import { Temporal as Polyfill } from 'temporal-polyfill/implementation';
import { test } from 'node:test';

const native = (globalThis as { Temporal?: typeof Temporal }).Temporal;

/** The implementations of this runtime, by name. */
export const IMPLEMENTATIONS: readonly (readonly [string, typeof Temporal])[] = [
  ['polyfill', Polyfill as unknown as typeof Temporal],
  ...(native === undefined ? [] : [['native', native] as const]),
];

/** Declares a test per implementation, with `globalThis.Temporal` set to it: what the package reads when called. */
export function testOnEach(name: string, check: (temporal: typeof Temporal) => void): void {
  for (const [implementation, temporal] of IMPLEMENTATIONS) {
    test(`${name} (${implementation})`, () => {
      (globalThis as { Temporal?: typeof Temporal }).Temporal = temporal;
      check(temporal);
    });
  }
}

/** The other implementation of this runtime, for a test of mixing them; undefined under a Node without Temporal. */
export const OTHER_IMPLEMENTATION: readonly [typeof Temporal, typeof Temporal] | undefined =
  native === undefined ? undefined : [native, Polyfill as unknown as typeof Temporal];
