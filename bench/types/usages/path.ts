// What an application writes with typed paths on the model every fixture has: paths checked at compile time, values
// read from a path, a function over any path of the model, the recursive `children`, a path used where any is taken.
import { formatPath, type Path, type PathValue } from '@yaltaan/core/path';

import type { Model } from '../model.ts';

export const city: Path<Model> = ['customer', 'address', 'city'];
export const firstSku: Path<Model> = ['lines', 0, 'sku'];
export const keyed: Path<Model> = ['lines', { key: 'a' }, 'quantity'];
export const nested: Path<Model> = ['children', 0, 'children', 1, 'customer', 'email'];

export type City = PathValue<Model, ['customer', 'address', 'city']>;
export type Sku = PathValue<Model, ['lines', 0, 'sku']>;
export type Deep = PathValue<Model, ['children', 0, 'customer', 'address', 'zip']>;

export function at<const P extends Path<Model>>(model: Model, path: P): PathValue<Model, P> {
  void formatPath(path);
  return model as PathValue<Model, P>;
}

export function read(model: Model): string | undefined {
  return at(model, ['customer', 'address', 'city']) ?? at(model, ['lines', 0, 'sku']);
}
