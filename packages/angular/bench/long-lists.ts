// What a keystroke costs in a long list of Angular Signal Forms, by rows: one email written, then the errors of every
// row read, as a view that shows each row's errors reads them. Three forms of the same list, each emails unique: the
// rule `unique` of @yaltaan/rules through `validateRules`; Signal Forms alone, its validator written by hand as an
// application writes it (tests/interop/form-rules.mjs), every row reading the list; and no validator at all, what
// Angular costs by itself. One row in ten in error (pairs of rows sharing an email), none, or every row (one email
// shared by all), where a rule stops at 1,000 issues as `checkRules` does, so that the bridge then shows fewer errors
// than the validators written by hand. Each size measured `rounds` times
// in turn with the others, the fastest kept: the round least disturbed by the rest of the machine; the CPU time of the
// process, not the clock, so that another process running beside it costs less than a whole slice.
//
// Usage: node packages/angular/bench/long-lists.ts [n] [rounds]   (after bash scripts/build.sh; n = 1000, rounds = 7)
// Prints one line per form and case: the milliseconds of a keystroke at n, 2n and 4n rows, and the ratio of 4n to n,
// 4 when the cost is proportional to the rows.
import '@angular/compiler';

import { createEnvironmentInjector, EnvironmentInjector, RendererFactory2, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { applyEach, form, validate, type FieldTree } from '@angular/forms/signals';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { unique } from '@yaltaan/rules';

import { validateRules } from '../src/index.ts';

interface Row {
  name: string;
  email: string;
}
interface Model {
  rows: Row[];
}

const KINDS = ['bridge', 'by hand', 'no rule'] as const;
type Kind = (typeof KINDS)[number];
const CASES = ['one row in ten in error', 'no row in error', 'every row in error'] as const;
type Case = (typeof CASES)[number];

/** The email of a row: shared by the two first rows of every twenty, by none, or by all. */
const emailOf = (errors: Case, index: number): string =>
  errors === 'every row in error'
    ? 'same@example.org'
    : errors === 'one row in ten in error' && index % 20 < 2
      ? `pair${Math.floor(index / 20)}@example.org`
      : `row${index}@example.org`;

/** The rows in error a form shows: those with a duplicate, up to the 1,000 issues of a rule for the bridge. */
const inError = (kind: Kind, errors: Case, n: number): number =>
  kind === 'no rule' || errors === 'no row in error'
    ? 0
    : errors === 'every row in error'
      ? kind === 'bridge'
        ? Math.min(n, 1000)
        : n
      : 2 * Math.ceil(Math.floor(n / 2) / 10);

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
TestBed.configureTestingModule({ providers: [{ provide: RendererFactory2, useValue: null }] });
const environment = TestBed.inject(EnvironmentInjector);

/** A form of `n` rows, their emails as `errors` says. */
function build(kind: Kind, n: number, errors: Case, injector: EnvironmentInjector): FieldTree<Model> {
  const model = signal<Model>({
    rows: Array.from({ length: n }, (_, index) => ({
      name: `row ${index}`,
      email: emailOf(errors, index),
    })),
  });
  return form(
    model,
    (path) => {
      if (kind === 'bridge') {
        validateRules(path, [unique(['rows'], ['email'])]);
      } else if (kind === 'by hand') {
        applyEach(path.rows, (row) =>
          validate(row.email, ({ value, valueOf }) =>
            valueOf(path.rows).filter((other) => other.email === value()).length > 1
              ? { kind: 'rules.unique' }
              : undefined,
          ),
        );
      }
    },
    { injector },
  );
}

/** The errors every row shows: what a view of the list reads after each keystroke. */
function render(tree: FieldTree<Model>, n: number): number {
  let shown = 0;
  for (let index = 0; index < n; index++) {
    shown += tree.rows[index]!.email().errors().length;
  }
  return shown;
}

/**
 * The CPU milliseconds of one keystroke: a space added to the email of the middle row, or taken away, then every row
 * read; the fastest of `strokes`, after one stroke that builds what Angular builds lazily.
 */
function keystroke(kind: Kind, n: number, errors: Case, strokes: number): number {
  // An injector of its own, destroyed at the end, so that the forms measured before hold nothing.
  const injector = createEnvironmentInjector([], environment);
  try {
    return measure(build(kind, n, errors, injector), kind, n, errors, strokes);
  } finally {
    injector.destroy();
  }
}

function measure(tree: FieldTree<Model>, kind: Kind, n: number, errors: Case, strokes: number): number {
  const expected = inError(kind, errors, n);
  const shown = render(tree, n);
  if (shown !== expected) {
    throw new Error(`${kind}: ${shown} rows in error, not ${expected}`);
  }
  const field = tree.rows[n >> 1]!.email;
  let best = Number.POSITIVE_INFINITY;
  for (let stroke = 0; stroke <= strokes; stroke++) {
    const before = process.cpuUsage();
    field().value.set(emailOf(errors, n >> 1) + ' '.repeat(stroke % 2 === 0 ? 1 : 0));
    render(tree, n);
    const spent = process.cpuUsage(before);
    if (stroke > 0) {
      best = Math.min(best, (spent.user + spent.system) / 1000);
    }
  }
  return best;
}

const n = Number(process.argv[2] ?? 1000);
const rounds = Number(process.argv[3] ?? 7);
const sizes = [n, 2 * n, 4 * n];
const best = new Map<string, number>();
for (let round = 0; round < rounds; round++) {
  for (const errors of CASES) {
    for (const kind of KINDS) {
      for (const size of sizes) {
        const key = `${kind}|${errors}|${size}`;
        best.set(key, Math.min(best.get(key) ?? Number.POSITIVE_INFINITY, keystroke(kind, size, errors, 3)));
      }
    }
  }
}
for (const errors of CASES) {
  for (const kind of KINDS) {
    const times = sizes.map((size) => best.get(`${kind}|${errors}|${size}`)!);
    console.log(
      [
        kind.padEnd(8),
        errors.padEnd(23),
        ...times.map((time, index) => `${sizes[index]}: ${time.toFixed(2)} ms`),
        `4n/n ${(times[2]! / times[0]!).toFixed(2)}`,
      ].join('  '),
    );
  }
}
