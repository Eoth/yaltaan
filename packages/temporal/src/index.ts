// What Temporal does not provide, on whichever Temporal the platform has (ARCHITECTURE.md §7.8). Nothing runs on
// import, and a bundler drops every function nobody calls.
export {
  contains,
  emptyInterval,
  gaps,
  intersect,
  interval,
  mergeAll,
  overlaps,
  union,
  type EmptyInterval,
  type Interval,
  type IntervalBound,
  type Span,
} from './interval.ts';
export type { TemporalIssue } from './shared.ts';
