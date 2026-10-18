// The test reporter of the repository: Node's `spec` report, plus one record per adversarial category test that the
// run finished, for the verification gate. A record is read from the event of the test itself, so that a declaration
// in a file the runner never loaded leaves none. Records are written only when the gate asks for them, so that a run
// by hand shows the usual report alone.
//
// One reporter rather than two: two reporters each need a destination flag, and the test command would no longer fit
// on one line of package.json.
import { Transform, type TransformCallback } from 'node:stream';
import { spec, type TestEvent } from 'node:test/reporters';

import { DEFERRED_PREFIX, NOT_APPLICABLE_PREFIX, parseTestName, RECORD_PREFIX, RECORDS_VARIABLE } from './record.ts';
import type { AdversarialRecord, Outcome } from './record.ts';

function outcomeOf(passed: boolean, skip: unknown, todo: unknown): Outcome {
  if (typeof todo === 'string' && todo.startsWith(DEFERRED_PREFIX)) {
    return 'deferred';
  }
  if (skip !== undefined && skip !== false) {
    return typeof skip === 'string' && skip.startsWith(NOT_APPLICABLE_PREFIX) ? 'n/a' : 'skipped';
  }
  if (todo !== undefined && todo !== false) {
    return 'skipped';
  }
  return passed ? 'tested' : 'failed';
}

/** The record of one finished test, or `undefined` for a test that is not an adversarial category. */
export function recordOf(event: TestEvent): AdversarialRecord | undefined {
  if (event.type !== 'test:pass' && event.type !== 'test:fail') {
    return undefined;
  }
  const identity = parseTestName(event.data.name);
  if (identity === undefined) {
    return undefined;
  }
  const { skip, todo } = event.data;
  return { ...identity, outcome: outcomeOf(event.type === 'test:pass', skip, todo) };
}

export default class Reporter extends Transform {
  readonly #human: Transform = new spec();
  readonly #records: boolean = process.env[RECORDS_VARIABLE] === '1';

  constructor() {
    super({ writableObjectMode: true });
    this.#human.on('data', (chunk: string | Buffer) => this.push(chunk));
  }

  override _transform(event: TestEvent, _encoding: BufferEncoding, callback: TransformCallback): void {
    const record = this.#records ? recordOf(event) : undefined;
    if (record !== undefined) {
      this.push(`${RECORD_PREFIX}${JSON.stringify(record)}\n`);
    }
    this.#human.write(event, (error) => callback(error ?? null));
  }

  // The spec report prints its summary when it ends: this stream ends after it.
  override _flush(callback: TransformCallback): void {
    this.#human.once('end', () => callback());
    this.#human.end();
  }
}
