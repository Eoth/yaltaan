import assert from 'node:assert/strict';
import test from 'node:test';
import { declareAdversarial, fc } from '@yaltaan/testing';
import { OTHER_IMPLEMENTATION, testOnEach } from '@yaltaan/testing/temporal';
import { isPlausibleName } from './shared.ts';
import { parsePlainDate, parsePlainDateTime, parsePlainTime, parseZonedDateTime, type TemporalIssue } from './index.ts';

const SUBPATH = '@yaltaan/temporal';
const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** What each token writes: the part a law needs of what `Intl` does in an application. */
const WRITERS: Readonly<Record<string, (d: Temporal.PlainDateTime) => string>> = {
  yyyy: (d) => pad(d.year, 4),
  yy: (d) => pad(d.year % 100, 2),
  MM: (d) => pad(d.month, 2),
  M: (d) => String(d.month),
  dd: (d) => pad(d.day, 2),
  d: (d) => String(d.day),
  HH: (d) => pad(d.hour, 2),
  H: (d) => String(d.hour),
  mm: (d) => pad(d.minute, 2),
  ss: (d) => pad(d.second, 2),
  SSS: (d) => pad(d.millisecond, 3),
};

function write(value: Temporal.PlainDateTime, format: string): string {
  return format.replaceAll(/yyyy|yy|MM|M|dd|d|HH|H|mm|ss|SSS/g, (token) =>
    (WRITERS[token] as (d: Temporal.PlainDateTime) => string)(value),
  );
}

const SEPARATORS = ['/', '-', '.', ' ', ':', ' à ', 'T', '年'];
const ORDERED_DATES = [
  ['yyyy', 'MM', 'dd'],
  ['dd', 'MM', 'yyyy'],
  ['MM', 'dd', 'yyyy'],
  ['d', 'M', 'yyyy'],
  ['dd', 'MM', 'yy'],
  ['yy', 'M', 'd'],
  ['yyyyMMdd'],
];
const TIMES = ['HH:mm', 'HH:mm:ss', 'HH:mm:ss.SSS', 'H:mm', 'HHmm'];

const dateFormat = fc
  .tuple(fc.constantFrom(...ORDERED_DATES), fc.constantFrom(...SEPARATORS))
  .map(([tokens, separator]) => tokens.join(separator));
const wallFormat = fc
  .tuple(dateFormat, fc.constantFrom(...SEPARATORS), fc.constantFrom(...TIMES))
  .map(([date, separator, time]) => `${date}${separator}${time}`);

function pieces(T: typeof Temporal) {
  return fc
    .record({
      year: fc.integer({ min: 1000, max: 9999 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 31 }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 0, max: 59 }),
      millisecond: fc.integer({ min: 0, max: 999 }),
    })
    .map((fields) => T.PlainDateTime.from(fields));
}

const pivotFor = (year: number): number => year - (year % 100);

testOnEach('parse(format(x, f), f) is x, for every declared format of a date', (T) => {
  fc.assert(
    fc.property(pieces(T), dateFormat, (value, format) => {
      const text = write(value, format);
      const read = parsePlainDate(text, { format, pivotYear: pivotFor(value.year) });
      assert.ok(read.ok, `${text} in ${format}: ${JSON.stringify(read)}`);
      assert.ok(read.value.equals(value.toPlainDate()));
    }),
    { numRuns: 500 },
  );
});

testOnEach('parse(format(x, f), f) is x, for every declared format of a date and a time', (T) => {
  fc.assert(
    fc.property(pieces(T), wallFormat, (value, format) => {
      const text = write(value, format);
      const read = parsePlainDateTime(text, { format, pivotYear: pivotFor(value.year) });
      assert.ok(read.ok, `${text} in ${format}: ${JSON.stringify(read)}`);
      const expected = value.with({
        second: format.includes('ss') ? value.second : 0,
        millisecond: format.includes('SSS') ? value.millisecond : 0,
        microsecond: 0,
        nanosecond: 0,
      });
      assert.ok(read.value.equals(expected), `${String(read.value)} is not ${String(expected)}`);
    }),
    { numRuns: 500 },
  );
});

testOnEach('parse(format(x, f), f) is x, for a time', (T) => {
  fc.assert(
    fc.property(pieces(T), fc.constantFrom(...TIMES), (value, format) => {
      const read = parsePlainTime(write(value, format), { format });
      assert.ok(read.ok);
      assert.equal(read.value.hour, value.hour);
      assert.equal(read.value.minute, value.minute);
      assert.equal(read.value.second, format.includes('ss') ? value.second : 0);
      assert.equal(read.value.millisecond, format.includes('SSS') ? value.millisecond : 0);
    }),
    { numRuns: 300 },
  );
});

testOnEach('a date that does not exist is refused, on the same days as the calendar', (T) => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 9999 }),
      fc.integer({ min: 0, max: 14 }),
      fc.integer({ min: 0, max: 33 }),
      (year, month, day) => {
        const text = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
        const exists = month >= 1 && month <= 12 && day >= 1 && day <= new T.PlainDate(year, month, 1).daysInMonth;
        const read = parsePlainDate(text);
        if (exists) {
          assert.ok(read.ok);
          assert.equal(String(read.value), text);
        } else {
          assert.deepEqual(read, { ok: false, error: { code: 'temporal.invalid_date', path: [] } });
        }
      },
    ),
    { numRuns: 2000 },
  );
  for (const text of [
    '2024-02-30',
    '2023-02-29',
    '2100-02-29',
    '2024-04-31',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
  ]) {
    assert.deepEqual(parsePlainDate(text), { ok: false, error: { code: 'temporal.invalid_date', path: [] } });
  }
  assert.ok(parsePlainDate('2024-02-29').ok);
  assert.ok(parsePlainDate('2000-02-29').ok);
});

const errorCode = (result: { ok: true } | { ok: false; error: TemporalIssue }): string | undefined =>
  result.ok ? undefined : result.error.code;

testOnEach('without a format, only the ISO form is read; anything else is never a guess', (T) => {
  assert.ok(T.PlainDate !== undefined);
  for (const text of [
    '01/02/03',
    '2024-3-4',
    '20240304',
    '2024/03/04',
    'March 4 2024',
    '12',
    '',
    ' 2024-03-04',
    '2024-03-04 ',
    '2024-03-04T10:30',
    '٢٠٢٤-٠٣-٠٤',
  ]) {
    assert.equal(errorCode(parsePlainDate(text)), 'temporal.ambiguous_format', text);
  }
  assert.equal(errorCode(parsePlainDateTime('2024-03-04 10:30')), 'temporal.ambiguous_format');
  assert.equal(errorCode(parsePlainTime('10:30')), 'temporal.ambiguous_format');
  assert.ok(parsePlainDateTime('2024-03-04T10:30:00').ok);
  assert.ok(parsePlainTime('10:30:00').ok);
});

testOnEach('a format is judged whatever the text', (T) => {
  assert.ok(T.PlainDate !== undefined);
  const invalid = [
    '',
    'yyyy',
    'yyyy-MM',
    'MM-dd',
    'yyyy-MM-dd-dd',
    'yyyy-yy-MM-dd',
    'YYYY-MM-DD',
    'yyy-MM-dd',
    'yyyy-MM-ddd',
    'yyyyMd',
    'dMyyyy',
    'd1/M/yyyy',
    'yyyy-MM-dd HH',
    'yyyy-mM-dd',
    'x'.repeat(65),
  ];
  for (const format of invalid) {
    for (const text of ['2024-03-04', '', 'x']) {
      assert.equal(errorCode(parsePlainDate(text, { format })), 'temporal.invalid_format', format);
    }
  }
  assert.equal(errorCode(parsePlainDate('2024-03-04', { format: 5 as unknown as string })), 'temporal.invalid_format');
  assert.equal(errorCode(parsePlainTime('10:00', { format: 'HH' })), 'temporal.invalid_format');
  assert.equal(errorCode(parsePlainTime('10:00', { format: 'dd:mm' })), 'temporal.invalid_format');
  assert.equal(errorCode(parsePlainDateTime('2024-03-04', { format: 'yyyy-MM-dd' })), 'temporal.invalid_format');
});

testOnEach('a two-digit year needs its pivot, and falls in the hundred years from it', (T) => {
  assert.ok(T.PlainDate !== undefined);
  assert.equal(errorCode(parsePlainDate('01/02/03', { format: 'dd/MM/yy' })), 'temporal.ambiguous_format');
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 9900 }), (year, pivotYear) => {
      const read = parsePlainDate(`01/02/${pad(year, 2)}`, { format: 'dd/MM/yy', pivotYear });
      assert.ok(read.ok);
      assert.ok(read.value.year >= pivotYear && read.value.year <= pivotYear + 99);
      assert.equal(read.value.year % 100, year);
    }),
    { numRuns: 300 },
  );
  for (const pivotYear of [-1, 9901, 1970.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(errorCode(parsePlainDate('01/02/03', { format: 'dd/MM/yy', pivotYear })), 'temporal.invalid_format');
  }
  const read = parsePlainDate('01/02/2003', { format: 'dd/MM/yyyy', pivotYear: 1970 });
  assert.ok(read.ok);
  assert.equal(read.value.year, 2003);
});

testOnEach('a mismatch says where, and the issue holds no part of the text', (T) => {
  assert.ok(T.PlainDate !== undefined);
  const format = 'dd/MM/yyyy';
  assert.deepEqual(parsePlainDate('1/02/2024', { format }), {
    ok: false,
    error: { code: 'temporal.format_mismatch', path: [], params: { at: 1 } },
  });
  assert.deepEqual(parsePlainDate('01-02-2024', { format }), {
    ok: false,
    error: { code: 'temporal.format_mismatch', path: [], params: { at: 2 } },
  });
  assert.deepEqual(parsePlainDate('01/02/2024x', { format }), {
    ok: false,
    error: { code: 'temporal.format_mismatch', path: [], params: { at: 10 } },
  });
  fc.assert(
    fc.property(fc.string({ maxLength: 64 }), (text) => {
      const read = parsePlainDate(`ZZ${text}`, { format });
      assert.ok(!read.ok);
      assert.ok(!JSON.stringify(read).includes('ZZ'));
    }),
    { numRuns: 200 },
  );
});

testOnEach('limits: text and format over 64 code units, a text that is no string, a name from outside', (T) => {
  assert.ok(T.PlainDate !== undefined);
  assert.deepEqual(parsePlainDate('1'.repeat(65), { format: 'yyyy-MM-dd' }), {
    ok: false,
    error: { code: 'temporal.too_long', path: [], params: { maximum: 64 } },
  });
  assert.equal(errorCode(parsePlainDate('1'.repeat(10_000_000))), 'temporal.too_long');
  for (const text of [
    undefined,
    null,
    5,
    {},
    [],
    Symbol('x'),
    1n,
    () => '2024-03-04',
    { toString: () => '2024-03-04' },
  ]) {
    assert.equal(errorCode(parsePlainDate(text as unknown as string)), 'temporal.ambiguous_format');
    assert.equal(
      errorCode(parsePlainDate(text as unknown as string, { format: 'yyyy-MM-dd' })),
      'temporal.format_mismatch',
    );
  }
  const options = { timeZone: 'A'.repeat(100_000) };
  assert.equal(errorCode(parseZonedDateTime('2024-03-04T10:00:00', options)), 'temporal.invalid_time_zone');
  for (const timeZone of ['Mars/Olympus', '', 'UTC\u0000', '../../etc/passwd', '__proto__', 5, null, undefined, {}]) {
    assert.equal(
      errorCode(parseZonedDateTime('2024-03-04T10:00:00', { timeZone: timeZone as string })),
      'temporal.invalid_time_zone',
    );
  }
  assert.equal(
    errorCode(parseZonedDateTime('nope', undefined as unknown as { timeZone: string })),
    'temporal.ambiguous_format',
  );
});

testOnEach('a wall clock that does not exist, or exists twice, is refused unless the application decides', (T) => {
  const timeZone = 'America/New_York';
  assert.equal(errorCode(parseZonedDateTime('2024-03-10T02:30:00', { timeZone })), 'temporal.nonexistent_time');
  assert.equal(errorCode(parseZonedDateTime('2024-11-03T01:30:00', { timeZone })), 'temporal.ambiguous_time');
  const fine = parseZonedDateTime('2024-07-01T12:00:00', { timeZone });
  assert.ok(fine.ok);
  assert.equal(fine.value.offset, '-04:00');
  const compatible = parseZonedDateTime('2024-03-10T02:30:00', { timeZone, disambiguation: 'compatible' });
  assert.ok(compatible.ok);
  assert.equal(compatible.value.hour, 3);
  const earlier = parseZonedDateTime('2024-11-03T01:30:00', { timeZone, disambiguation: 'earlier' });
  const later = parseZonedDateTime('2024-11-03T01:30:00', { timeZone, disambiguation: 'later' });
  assert.ok(earlier.ok && later.ok);
  assert.equal(later.value.epochMilliseconds - earlier.value.epochMilliseconds, 3_600_000);
  assert.ok(T.Instant.compare(earlier.value.toInstant(), later.value.toInstant()) < 0);
  assert.equal(errorCode(parseZonedDateTime('2024-02-31T10:00:00', { timeZone })), 'temporal.invalid_date');
  assert.equal(errorCode(parseZonedDateTime('nope', { timeZone })), 'temporal.ambiguous_format');
  const custom = parseZonedDateTime('10/03/2024 03:30', { timeZone, format: 'dd/MM/yyyy HH:mm' });
  assert.ok(custom.ok);
  assert.equal(custom.value.hour, 3);
});

testOnEach(
  'each token reads exactly its digits: one fewer or one more is a mismatch, from the table of tokens',
  (T) => {
    const value = T.PlainDateTime.from('2024-03-04T05:06:07.008');
    const fixed = { yyyy: 'y', yy: 'y', MM: 'M', dd: 'd', HH: 'H', mm: 'm', ss: 's', SSS: 'S' } as const;
    for (const token of Object.keys(fixed)) {
      const format = `yyyy-MM-dd HH:mm:ss.SSS`.replace(token === 'yy' ? 'yyyy' : token, `<${token}>`);
      const options = { format, pivotYear: 2000 };
      const whole = write(value, format);
      assert.ok(parsePlainDateTime(whole, options).ok, whole);
      const inside = /<(\d+)>/.exec(whole)?.[1] ?? '';
      for (const digits of [inside.slice(1), `0${inside}`]) {
        const text = whole.replace(`<${inside}>`, `<${digits}>`);
        assert.equal(errorCode(parsePlainDateTime(text, options)), 'temporal.format_mismatch', `${token}: ${text}`);
      }
    }
    for (const token of ['M', 'd', 'H']) {
      const format = `yyyy-MM-dd HH:mm`.replace(token === 'M' ? 'MM' : token === 'd' ? 'dd' : 'HH', `<${token}>`);
      const read = (digits: string): string | undefined => {
        const text = `2024-03-04 05:06`.replace(token === 'M' ? '03' : token === 'd' ? '04' : '05', `<${digits}>`);
        return errorCode(parsePlainDateTime(text, { format }));
      };
      assert.equal(read('1'), undefined, token);
      assert.equal(read('01'), undefined, token);
      assert.equal(read(''), 'temporal.format_mismatch', token);
      assert.equal(read('001'), 'temporal.format_mismatch', token);
    }
  },
);

testOnEach('every ASCII character in a format is a token, a refused letter, or a literal that must be there', (T) => {
  const date = T.PlainDate.from('2024-03-04');
  for (let code = 0; code < 128; code += 1) {
    const character = String.fromCharCode(code);
    const format = `yyyy${character}MM-dd`;
    const isLetter = /^[A-Za-z]$/.test(character);
    if (isLetter && character !== 'T') {
      assert.equal(errorCode(parsePlainDate('2024-03-04', { format })), 'temporal.invalid_format', format);
    } else if (/^[0-9]$/.test(character) || !isLetter) {
      const read = parsePlainDate(`2024${character}03-04`, { format });
      assert.ok(read.ok && read.value.equals(date), JSON.stringify(format));
      const other = character === '#' ? '%' : '#';
      assert.equal(errorCode(parsePlainDate(`2024${other}03-04`, { format })), 'temporal.format_mismatch');
    }
  }
  const withT = parsePlainDate('2024T03T04', { format: 'yyyyTMMTdd' });
  assert.ok(withT.ok && withT.value.equals(date));
});

testOnEach('64 code units are read and 65 are not, for a text and for a format', (T) => {
  const date = T.PlainDate.from('2024-03-04');
  const padding = '-'.repeat(54);
  const format = `${padding}yyyy-MM-dd`;
  const text = `${padding}2024-03-04`;
  assert.equal(format.length, 64);
  assert.equal(text.length, 64);
  const read = parsePlainDate(text, { format });
  assert.ok(read.ok && read.value.equals(date));
  assert.equal(errorCode(parsePlainDate(`-${text}`, { format: `-${format}` })), 'temporal.invalid_format');
  assert.equal(errorCode(parsePlainDate(`-${text}`, { format })), 'temporal.too_long');
  assert.equal(errorCode(parsePlainDate(text.padEnd(64, ' '))), 'temporal.ambiguous_format');
  assert.equal(isPlausibleName('a'.repeat(64)), true);
  assert.equal(isPlausibleName('a'.repeat(65)), false);
  assert.equal(isPlausibleName(5), false);
});

testOnEach('a mismatch at the first code unit says 0, as a text that is no string does', (T) => {
  assert.ok(T.PlainDate !== undefined);
  const format = 'dd/MM/yyyy';
  const at0 = { ok: false, error: { code: 'temporal.format_mismatch', path: [], params: { at: 0 } } };
  assert.deepEqual(parsePlainDate('x1/02/2024', { format }), at0);
  assert.deepEqual(parsePlainDate(5 as unknown as string, { format }), at0);
});

testOnEach('a date and a time out of their ranges are refused, never moved to the nearest', (T) => {
  assert.ok(T.PlainDate !== undefined);
  for (const text of ['25:00', '24:00', '10:60']) {
    assert.equal(errorCode(parsePlainTime(text, { format: 'HH:mm' })), 'temporal.invalid_date', text);
  }
  assert.equal(errorCode(parsePlainTime('10:00:60', { format: 'HH:mm:ss' })), 'temporal.invalid_date');
  for (const text of ['2024-03-04T25:00:00', '2024-03-04T10:61:00', '2024-03-04T10:00:61', '2024-03-04T25:61:61']) {
    assert.equal(errorCode(parsePlainDateTime(text)), 'temporal.invalid_date', text);
    assert.equal(errorCode(parseZonedDateTime(text, { timeZone: 'UTC' })), 'temporal.invalid_date', text);
  }
  const midnight = parsePlainDate('0000-01-01');
  assert.ok(midnight.ok);
  assert.equal(midnight.value.year, 0);
});

testOnEach('each reader says what it needs: a missing field, or a field of another kind, is an invalid format', (T) => {
  assert.ok(T.PlainDate !== undefined);
  for (const [read, format, text] of [
    [parsePlainDateTime, 'yyyy-MM-dd HH', '2024-03-04 10'],
    [parsePlainDateTime, 'yyyy-MM-dd mm', '2024-03-04 10'],
    [parsePlainDateTime, 'yyyy-MM HH:mm', '2024-03 10:00'],
    [parsePlainTime, 'HH:mm dd', '10:00 04'],
    [parsePlainTime, 'yyyy HH:mm', '2024 10:00'],
    [parsePlainTime, 'mm', '10'],
    [parsePlainTime, 'HH:mm:SSS', '12:30:045'],
    [parsePlainDateTime, 'yyyy-MM-dd HH:mm:SSS', '2024-03-04 12:30:045'],
    [parsePlainDate, 'yyyy-MM-dd HH', '2024-03-04 10'],
  ] as const) {
    assert.equal(errorCode(read(text, { format })), 'temporal.invalid_format', format);
  }
  for (const format of [null, 5, {}, { length: 10 }, ['yyyy-MM-dd'], true]) {
    assert.equal(
      errorCode(parsePlainDate('2024-03-04', { format: format as unknown as string })),
      'temporal.invalid_format',
    );
  }
  assert.equal(
    errorCode(parsePlainDate('01/02/03', { format: 'dd/MM/yy', pivotYear: null as unknown as number })),
    'temporal.invalid_format',
  );
});

testOnEach('a bad format is said before a text too long, and a text too long is not read', (T) => {
  assert.ok(T.PlainDate !== undefined);
  const long = 'x'.repeat(65);
  assert.equal(errorCode(parsePlainDate(long, { format: 'nope' })), 'temporal.invalid_format');
  assert.equal(errorCode(parsePlainDate(long, { format: 'dd/MM/yy' })), 'temporal.ambiguous_format');
  assert.equal(errorCode(parsePlainDate(long, { format: 'dd/MM/yy', pivotYear: -1 })), 'temporal.invalid_format');
  assert.equal(errorCode(parsePlainDate(long, { format: 'dd/MM/yy', pivotYear: 1970 })), 'temporal.too_long');
  const firstCall = (): number => {
    let rope = 'x'.repeat(1024);
    while (rope.length < 2 ** 27) {
      rope += rope;
    }
    rope += 'y';
    const started = performance.now();
    assert.equal(errorCode(parsePlainDate(rope)), 'temporal.too_long');
    return performance.now() - started;
  };
  // Flattening 128 MiB takes tens of milliseconds, and a first call on the rope would pay it: a clock can see this
  // because the rope is new each time, and the best of three removes the load of the machine.
  assert.ok(Math.min(firstCall(), firstCall(), firstCall()) < 10, 'a text too long was read');
});

testOnEach('options of any shape: no throw from data, and only what a program can cause is a TypeError', (T) => {
  const text = '2024-07-01T12:00:00';
  const noOptions = undefined as unknown as { timeZone: string };
  assert.equal(errorCode(parseZonedDateTime(text, noOptions)), 'temporal.invalid_time_zone');
  assert.equal(
    errorCode(parseZonedDateTime(text, null as unknown as { timeZone: string })),
    'temporal.invalid_time_zone',
  );
  assert.ok(parsePlainDate('2024-07-01', null as unknown as undefined).ok);
  for (const disambiguation of ['foo', null, 5, Symbol('x'), {}]) {
    assert.throws(
      () => parseZonedDateTime(text, { timeZone: 'UTC', disambiguation: disambiguation as 'reject' }),
      TypeError,
    );
  }
  const hostile = {
    get format(): string {
      throw new RangeError('from a getter');
    },
  };
  assert.throws(() => parsePlainDate('2024-07-01', hostile), /from a getter/);
  assert.ok(T.PlainDate !== undefined);
});

testOnEach('a time zone is a name or an offset, never a date to read a zone out of', (T) => {
  for (const zone of Intl.supportedValuesOf('timeZone')) {
    assert.ok(isPlausibleName(zone), zone);
  }
  for (const offset of ['+01:00', '-05:30', '+0100', '+01', 'UTC', 'Etc/GMT+5', 'America/Port-au-Prince']) {
    assert.ok(isPlausibleName(offset), offset);
  }
  for (const timeZone of [
    '2024-01-01T00:00:00+01:00',
    '10:00Z',
    '2024-13-01T00:00Z',
    '+1',
    '+01:00:00',
    ' UTC',
    'UTC ',
    'a b',
    'UTC\n',
  ]) {
    assert.equal(isPlausibleName(timeZone), false, timeZone);
    assert.equal(
      errorCode(parseZonedDateTime('2024-07-01T12:00:00', { timeZone })),
      'temporal.invalid_time_zone',
      timeZone,
    );
  }
  assert.ok(parseZonedDateTime('2024-07-01T12:00:00', { timeZone: '+01:00' }).ok);
  assert.ok(T.PlainDate !== undefined);
});

test('a polluted Object.prototype fills no field and adds no token', () => {
  // A stand-in for Temporal: the polyfill itself reads polluted fields, and this is about the reader.
  const prototype = Object.prototype as unknown as Record<string, unknown>;
  const pollute = (values: Readonly<Record<string, unknown>>, check: () => void): void => {
    Object.assign(prototype, values);
    try {
      check();
    } finally {
      for (const name of Object.keys(values)) {
        delete prototype[name];
      }
    }
  };
  const seen: number[] = [];
  const held = (globalThis as { Temporal?: unknown }).Temporal;
  (globalThis as { Temporal?: unknown }).Temporal = {
    PlainTime: class {
      constructor(...fields: number[]) {
        seen.push(...fields);
      }
    },
  };
  try {
    pollute({ S: 5, s: 7 }, () => {
      assert.ok(parsePlainTime('10:30', { format: 'HH:mm' }).ok);
    });
    assert.deepEqual(seen, [10, 30, 0, 0]);
    pollute({ y: 2024, q: ['y', 4] }, () => {
      assert.equal(errorCode(parsePlainDate('03-04', { format: 'MM-dd' })), 'temporal.invalid_format');
      assert.equal(errorCode(parsePlainDate('2024-03-04', { format: 'q-MM-dd' })), 'temporal.invalid_format');
    });
  } finally {
    (globalThis as { Temporal?: unknown }).Temporal = held;
  }
});

test(
  'the polyfill misses a change of clock whose two ends share an offset: the native Temporal is the reference',
  { skip: OTHER_IMPLEMENTATION === undefined },
  () => {
    const [Native, Other] = OTHER_IMPLEMENTATION as readonly [typeof Temporal, typeof Temporal];
    const read = (temporal: typeof Temporal, text: string, timeZone: string): string | undefined => {
      (globalThis as { Temporal?: typeof Temporal }).Temporal = temporal;
      return errorCode(parseZonedDateTime(text, { timeZone }));
    };
    // Written for the guide, and to be seen when a version of the polyfill changes this: a difference ADR 0037
    // documents.
    assert.equal(read(Native, '2021-05-16T02:30:00', 'Africa/Casablanca'), 'temporal.nonexistent_time');
    assert.equal(read(Other, '2021-05-16T02:30:00', 'Africa/Casablanca'), undefined);
    assert.equal(read(Native, '2010-08-10T23:30:00', 'Africa/Cairo'), 'temporal.ambiguous_time');
    assert.equal(read(Other, '2010-08-10T23:30:00', 'Africa/Cairo'), undefined);
  },
);

/** Texts near a valid one: what a reader meets, and what no list of examples holds. */
const nearText = fc
  .tuple(fc.string({ maxLength: 12 }), fc.string({ unit: 'binary', maxLength: 8 }), fc.nat(10), fc.nat(10))
  .map(([a, b, x, y]) => {
    const base = '2024-02-29';
    return base.slice(0, x) + a + base.slice(x + y) + b;
  });
const anyText = fc.oneof(fc.string({ maxLength: 70 }), fc.string({ unit: 'binary', maxLength: 70 }), nearText);
const anyFormat = fc.oneof(
  fc.string({ unit: fc.constantFrom('y', 'M', 'd', 'H', 'm', 's', 'S', 'T', '-', '/', ' ', '1', 'x'), maxLength: 16 }),
  dateFormat,
  wallFormat,
);

testOnEach('fuzz: whatever the text and the format, a Result, and an accepted date reads back as itself', (T) => {
  fc.assert(
    fc.property(anyText, anyFormat, fc.option(fc.integer({ min: -10, max: 9910 })), (text, format, pivot) => {
      const options = { format, ...(pivot === null ? {} : { pivotYear: pivot }) };
      for (const read of [
        parsePlainDate(text, options),
        parsePlainTime(text, options),
        parsePlainDateTime(text, options),
        parseZonedDateTime(text, { ...options, timeZone: 'Europe/Paris' }),
        parsePlainDate(text),
        parsePlainDateTime(text),
        parsePlainTime(text),
      ]) {
        assert.equal(typeof read.ok, 'boolean');
        if (!read.ok) {
          assert.match(read.error.code, /^temporal\./);
          assert.deepEqual(read.error.path, []);
        }
      }
      const iso = parsePlainDate(text);
      if (iso.ok) {
        assert.equal(String(iso.value), text);
        assert.ok(T.PlainDate.from(text).equals(iso.value));
      }
    }),
    { numRuns: 1500 },
  );
});

testOnEach('oracle: the ISO reader accepts what a regular expression of the form and Temporal together accept', (T) => {
  fc.assert(
    fc.property(nearText, (text) => {
      let oracle = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text);
      if (oracle) {
        try {
          T.PlainDate.from(text);
        } catch {
          oracle = false;
        }
      }
      assert.equal(parsePlainDate(text).ok, oracle, JSON.stringify(text));
    }),
    { numRuns: 1500 },
  );
});

testOnEach('the reader grows with nothing: 64 code units, and 16 million, cost the same order', (T) => {
  assert.ok(T.PlainDate !== undefined);
  const timeOf = (text: string, format: string): number => {
    let best = Infinity;
    for (let pass = 0; pass < 5; pass += 1) {
      const started = performance.now();
      for (let i = 0; i < 2000; i += 1) {
        parsePlainDate(text, { format });
      }
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  timeOf('2024-03-04', 'yyyy-MM-dd');
  const base = timeOf('2024-03-04', 'yyyy-MM-dd');
  for (const [text, format] of [
    ['1'.repeat(4_000_000), 'yyyy-MM-dd'],
    ['1'.repeat(16_000_000), 'yyyy-MM-dd'],
    ['2024-03-04', 'y'.repeat(16_000_000)],
    ['2'.repeat(64), `${'-'.repeat(54)}yyyy-MM-dd`],
  ] as const) {
    const time = timeOf(text, format);
    assert.ok(
      time < base * 4 + 20,
      `${String(text.length)} and ${String(format.length)}: ${String(time)} ms, base ${String(base)}`,
    );
  }
});

test('the platform without Temporal: an error that names the polyfill, only when called', () => {
  const held = (globalThis as { Temporal?: unknown }).Temporal;
  delete (globalThis as { Temporal?: unknown }).Temporal;
  try {
    assert.throws(() => parsePlainDate('2024-03-04'), /temporal-polyfill/);
    (globalThis as { Temporal?: unknown }).Temporal = null;
    assert.throws(() => parsePlainDate('2024-03-04'), /temporal-polyfill/);
    delete (globalThis as { Temporal?: unknown }).Temporal;
  } finally {
    if (held !== undefined) {
      (globalThis as { Temporal?: unknown }).Temporal = held;
    }
  }
});

function declareReader(name: string, read: (text: string) => { ok: boolean }): void {
  const total = (value: unknown): void => {
    assert.equal(typeof read(value as string).ok, 'boolean');
  };
  const declaration = {
    boundary: total,
    structures: total,
    hostile: total,
    unicode: total,
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  };
  declareAdversarial(SUBPATH, name, declaration);
}

declareReader('parsePlainDate', (text) => parsePlainDate(text, { format: 'yyyy-MM-dd' }));
declareReader('parsePlainTime', (text) => parsePlainTime(text, { format: 'HH:mm' }));
declareReader('parsePlainDateTime', (text) => parsePlainDateTime(text, { format: 'yyyy-MM-dd HH:mm' }));
declareReader('parseZonedDateTime', (text) => parseZonedDateTime(text, { timeZone: 'UTC' }));
