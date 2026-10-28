// Test support shared by every package: the adversarial catalogue of ARCHITECTURE.md §10.1, the declaration that
// ties an export to it, the differential judge against a reference library, fast-check, which the property and race
// tests use directly, and the assertions of type tests. Never published; test files import it through the workspace.
export { default as fc } from 'fast-check';
export type { AsyncCase } from './async.ts';
export { LONG_LENGTH } from './boundary.ts';
export { CallbackError, GROWTH_LIMIT, type Callback } from './callbacks.ts';
export { adversarial, type Catalogue, type CategoryValues } from './catalogue.ts';
export { CATEGORY_NAMES, type Category, type CategoryName, type Drawn, type NamedCase } from './category.ts';
export { declareAdversarial, type Check, type Coverage, type Declaration, type DeclareOptions } from './declare.ts';
export { HostileError } from './hostile.ts';
export { createJudge, type Comparison, type Difference, type Judge } from './judge.ts';
export { DEEP, WIDE } from './structures.ts';
export { assertType, type Equal } from './types.ts';
