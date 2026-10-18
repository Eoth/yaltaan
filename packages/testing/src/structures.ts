// Structures: shapes that break a traversal. Depth that overflows a recursive walk, width that a quadratic one does
// not finish, holes that `in` and iteration see differently, cycles that never end a naive walk, and aliasing, where
// one reference reached twice must be handled once (or twice, on purpose).
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

/** Deeper than the call stack of a recursive walk of a few frames per level, on every supported engine. */
export const DEEP = 10_000;

/** Wider than any object a quadratic walk handles in a test's time budget. */
export const WIDE = 10_000;

function deepObject(): object {
  let node: Record<string, unknown> = { leaf: true };
  for (let depth = 1; depth < DEEP; depth += 1) {
    node = { child: node };
  }
  return node;
}

function deepArray(): unknown[] {
  let node: unknown[] = [];
  for (let depth = 1; depth < DEEP; depth += 1) {
    node = [node];
  }
  return node;
}

function wideObject(): Record<string, number> {
  const node: Record<string, number> = {};
  for (let index = 0; index < WIDE; index += 1) {
    node[`k${index}`] = index;
  }
  return node;
}

function sparseArray(): unknown[] {
  const holes: unknown[] = [];
  holes[0] = 'first';
  holes[999] = 'last';
  return holes;
}

function selfCycle(): object {
  const node: Record<string, unknown> = { name: 'self' };
  node['self'] = node;
  return node;
}

function arrayCycle(): unknown[] {
  const node: unknown[] = [1];
  node.push(node);
  return node;
}

function mutualCycle(): object {
  const a: Record<string, unknown> = { name: 'a' };
  const b: Record<string, unknown> = { name: 'b', a };
  a['b'] = b;
  return a;
}

function mapCycle(): Map<string, unknown> {
  const map = new Map<string, unknown>();
  map.set('self', map);
  return map;
}

function aliasing(): object {
  const shared = { value: 1 };
  return { left: shared, right: shared, list: [shared, shared] };
}

const anything = fc.anything({ maxDepth: 4, withSparseArray: true, withMap: true, withSet: true });

export const structures: Category<object> = defineCategory<object>(
  'structures',
  [
    named('very deep object', deepObject),
    named('very deep array', deepArray),
    named('very wide object', wideObject),
    named('sparse array', sparseArray),
    named('self cycle', selfCycle),
    named('array cycle', arrayCycle),
    named('mutual cycle', mutualCycle),
    named('Map cycle', mapCycle),
    named('aliasing', aliasing),
  ],
  fc.oneof(
    fc.object({ maxDepth: 4 }),
    fc.array(anything, { maxLength: 8 }),
    fc.sparseArray(anything, { maxLength: 16 }),
  ),
);
