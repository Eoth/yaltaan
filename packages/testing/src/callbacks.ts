// Callbacks: functions handed to the code under test that throw, change what they are given, change the collection
// being walked, or answer with a promise where a value is expected. Each takes the arguments of an array callback,
// `(value, index, collection)`, and works on any of them.
//
// A callback that grows the collection stops after `GROWTH_LIMIT` calls: a walk that rereads the length then ends,
// late, and its test fails on the result instead of never returning.
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

export type Callback = (...args: readonly unknown[]) => unknown;

/** The error every throwing case of this category throws, so a test can tell it from its own failures. */
export class CallbackError extends Error {
  override readonly name = 'CallbackError';
}

export const GROWTH_LIMIT = 3;

// Reflect.set and Reflect.deleteProperty report a refused write with `false` instead of throwing in strict code: the
// callback tries to mutate, and a frozen input stays the code under test's concern.
function mutate(target: unknown): void {
  if (Array.isArray(target)) {
    Reflect.set(target, target.length, 'added by the callback');
  } else if (target instanceof Map) {
    target.set('added by the callback', true);
  } else if (target instanceof Set) {
    target.add('added by the callback');
  } else if (typeof target === 'object' && target !== null) {
    Reflect.set(target, 'addedByTheCallback', true);
  }
}

function shrink(target: unknown): void {
  if (Array.isArray(target)) {
    Reflect.deleteProperty(target, target.length - 1);
    Reflect.set(target, 'length', Math.max(0, target.length - 1));
  } else if (target instanceof Map || target instanceof Set) {
    const first: unknown = target.keys().next().value;
    target.delete(first);
  } else if (typeof target === 'object' && target !== null) {
    const [first] = Reflect.ownKeys(target);
    if (first !== undefined) {
      Reflect.deleteProperty(target, first);
    }
  }
}

function throwsOnSecondCall(): Callback {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 2) {
      throw new CallbackError('second call');
    }
    return calls;
  };
}

function growsTheCollection(): Callback {
  let calls = 0;
  return (_value, _index, collection) => {
    calls += 1;
    if (calls <= GROWTH_LIMIT) {
      mutate(collection);
    }
    return true;
  };
}

export const callbacks: Category<Callback> = defineCategory<Callback>(
  'callbacks',
  [
    named('throws an Error', () => () => {
      throw new CallbackError('callback failure');
    }),
    named('throws a value that is not an Error', () => () => {
      // JavaScript lets a callback throw any value; the code under test must still clean up and pass it on.
      throw 'callback failure';
    }),
    named('throws on its second call', throwsOnSecondCall),
    named('returns a promise', () => () => Promise.resolve(true)),
    named('mutates its value', () => (value) => {
      mutate(value);
      return true;
    }),
    named('grows the collection during iteration', growsTheCollection),
    named('shrinks the collection during iteration', () => (_value, _index, collection) => {
      shrink(collection);
      return true;
    }),
  ],
  // fc.func returns a pure function of its arguments: the same inputs give the same output, which replays.
  fc.func(fc.anything({ maxDepth: 1 })).map(
    (callback): Callback =>
      (...args) =>
        callback(...args),
  ),
);
