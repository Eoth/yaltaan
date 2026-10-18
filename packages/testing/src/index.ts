// Test support shared by every package: the adversarial catalogue of ARCHITECTURE.md §10.1 and fast-check, which the
// property and race tests use directly. Never published; test files import it through the workspace.
import { asynchronous, type AsyncCase } from './async.ts';
import { boundary } from './boundary.ts';
import { callbacks, type Callback } from './callbacks.ts';
import type { Category } from './category.ts';
import { hostile } from './hostile.ts';
import { structures } from './structures.ts';
import { unicode } from './unicode.ts';

export { default as fc } from 'fast-check';
export type { AsyncCase } from './async.ts';
export { LONG_LENGTH } from './boundary.ts';
export { CallbackError, GROWTH_LIMIT, type Callback } from './callbacks.ts';
export { CATEGORY_NAMES, type Category, type CategoryName, type Drawn, type NamedCase } from './category.ts';
export { HostileError } from './hostile.ts';
export { DEEP, WIDE } from './structures.ts';

/** The value each category hands to a check. */
export interface CategoryValues {
  readonly boundary: unknown;
  readonly structures: object;
  readonly hostile: object;
  readonly unicode: string;
  readonly callbacks: Callback;
  readonly async: AsyncCase;
}

export type Catalogue = { readonly [Name in keyof CategoryValues]: Category<CategoryValues[Name]> };

/** The shared adversarial generators, one per category of ARCHITECTURE.md §10.1. */
export const adversarial: Catalogue = { boundary, structures, hostile, unicode, callbacks, async: asynchronous };
