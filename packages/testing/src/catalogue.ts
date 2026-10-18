import { asynchronous, type AsyncCase } from './async.ts';
import { boundary } from './boundary.ts';
import { callbacks, type Callback } from './callbacks.ts';
import type { Category } from './category.ts';
import { hostile } from './hostile.ts';
import { structures } from './structures.ts';
import { unicode } from './unicode.ts';

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
