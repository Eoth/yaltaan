// Async: the cancellation and concurrency inputs of an asynchronous API. A signal that is already aborted, one that
// aborts once the call has started (on the next microtask, before most work settles; on the next macrotask, after
// work that settled at once), and concurrency limits at and beyond their bounds.
//
// The change of a domain's own configuration while it runs needs that domain's configuration: its tests drive it with
// fc.scheduler(), which this package re-exports with fast-check.
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

export interface AsyncCase {
  readonly signal: AbortSignal;
  /** A concurrency limit; 1 where the case is about the signal. */
  readonly concurrency: number;
}

type AbortTiming = 'never' | 'before' | 'microtask' | 'macrotask';

function build(timing: AbortTiming, concurrency: number, reason: unknown = new Error('aborted')): AsyncCase {
  if (timing === 'before') {
    return { signal: AbortSignal.abort(reason), concurrency };
  }
  const controller = new AbortController();
  if (timing === 'microtask') {
    queueMicrotask(() => controller.abort(reason));
  } else if (timing === 'macrotask') {
    setTimeout(() => controller.abort(reason), 0);
  }
  return { signal: controller.signal, concurrency };
}

export const asynchronous: Category<AsyncCase> = defineCategory<AsyncCase>(
  'async',
  [
    named('already aborted signal', () => build('before', 1)),
    named('signal aborted with a reason that is not an Error', () => build('before', 1, 'aborted')),
    named('signal that aborts on the next microtask', () => build('microtask', 1)),
    named('signal that aborts on the next macrotask', () => build('macrotask', 1)),
    named('concurrency 0', () => build('never', 0)),
    named('concurrency 1', () => build('never', 1)),
    named('very high concurrency', () => build('never', Number.MAX_SAFE_INTEGER)),
    named('infinite concurrency', () => build('never', Number.POSITIVE_INFINITY)),
    named('negative concurrency', () => build('never', -1)),
  ],
  fc
    .tuple(
      fc.constantFrom<AbortTiming>('never', 'before', 'microtask', 'macrotask'),
      fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 64 }), fc.constant(Number.MAX_SAFE_INTEGER)),
    )
    .map(([timing, concurrency]) => build(timing, concurrency)),
);
