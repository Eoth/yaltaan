// The first run of the beta: says which Temporal this platform gives, and exercises one function of each kind. Each
// line holds or the script stops with what it found: `node try.mjs`.
import assert from 'node:assert/strict';

if (typeof globalThis.Temporal === 'undefined') {
  await import('temporal-polyfill/global');
  console.log(`Temporal: temporal-polyfill, on Node ${process.versions.node}`);
} else {
  console.log(`Temporal: native, on Node ${process.versions.node}`);
}

const {
  addBusinessDays,
  contains,
  endOf,
  fromDate,
  gaps,
  interval,
  mergeAll,
  parsePlainDate,
  parseZonedDateTime,
  startOf,
  toDate,
} = await import('@yaltaan/temporal');
const { ok } = await import('@yaltaan/core/result');

const day = (text) => Temporal.PlainDate.from(text);

const january = interval(day('2024-01-01'), day('2024-02-01'));
assert.ok(january.ok && contains(january.value, day('2024-01-31')) && !contains(january.value, day('2024-02-01')));

assert.equal(parsePlainDate('31/02/2024', { format: 'dd/MM/yyyy' }).error.code, 'temporal.invalid_date');
assert.equal(parsePlainDate('01/02/03').error.code, 'temporal.ambiguous_format');
assert.equal(String(parsePlainDate('31/12/2024', { format: 'dd/MM/yyyy' }).value), '2024-12-31');

const newYork = { timeZone: 'America/New_York' };
assert.equal(parseZonedDateTime('2024-03-10T02:30:00', newYork).error.code, 'temporal.nonexistent_time');
assert.equal(parseZonedDateTime('2024-11-03T01:30:00', newYork).error.code, 'temporal.ambiguous_time');

assert.equal(fromDate(new Date(0), { timeZone: 'Asia/Tokyo' }).value.hour, 9);
assert.equal(toDate(day('2024-03-10'), { timeZone: 'UTC' }).value.toISOString(), '2024-03-10T00:00:00.000Z');

assert.equal(String(startOf(day('2024-05-15'), 'quarter')), '2024-04-01');
assert.equal(String(endOf(day('2024-02-10'), 'month')), '2024-02-29');
const workdays = { weekend: [6, 7], holidays: [day('2024-05-01')] };
assert.equal(String(addBusinessDays(day('2024-04-30'), { ...workdays, days: 1 }).value), '2024-05-02');

assert.deepEqual(ok(1), { ok: true, value: 1 });

const span = (from, to) => {
  const made = interval(day(from), day(to));
  if (!made.ok) throw new Error(made.error.code);
  return made.value;
};
const busy = [span('2024-03-01', '2024-04-01'), span('2024-01-01', '2024-02-01'), span('2024-01-15', '2024-02-15')];
assert.equal(mergeAll(busy).value.length, 2);
const holes = gaps(busy, { within: span('2024-01-01', '2025-01-01') }).value;
assert.deepEqual(
  holes.map(({ start, end }) => `${start} to ${end}`),
  ['2024-02-15 to 2024-03-01', '2024-04-01 to 2025-01-01'],
);
const read = parseZonedDateTime('2024-03-09T23:00:00', newYork);
assert.ok(read.ok);
assert.equal(
  read.value.add({ hours: 3 }).toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' '),
  '2024-03-10 03:00',
);
assert.equal(typeof String(Temporal.Now.plainDateISO('Europe/Paris')), 'string');
console.log('ok: @yaltaan/core and @yaltaan/temporal work together on this platform.');
