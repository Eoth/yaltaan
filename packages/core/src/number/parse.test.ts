// parseNumber, bigIntToNumber and numberToBigInt. Their judges come from outside the module: `String` and
// `Intl.NumberFormat` write the declared formats that must read back; `Number` gives the value of every text the
// grammar admits; a regular expression written from the grammar says which texts it admits, and a decimal expansion
// in `bigint` arithmetic says which of them a number holds exactly.
// Blind spots: the locales are the ones listed; the regular expression and the scanner were written from the same
// grammar, so a reading both get wrong passes; texts of more than 100 significant digits are only drawn by example.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertType, declareAdversarial, fc, HostileError, type Equal } from '@yaltaan/testing';

import type { Result } from '../result/index.ts';
import { bigIntToNumber, numberToBigInt, parseNumber, type NumberIssue, type ParseNumberOptions } from './index.ts';

const SUBPATH = '@yaltaan/core/number';
const PROPERTIES = { numRuns: 1000 };

const finite = fc.double({ noNaN: true, noDefaultInfinity: true });

test('parseNumber reads the grammar and nothing around it', () => {
  assertType<Equal<ReturnType<typeof parseNumber>, Result<number, NumberIssue>>>();
  assert.deepEqual(parseNumber('-1234.5'), { ok: true, value: -1234.5 });
  assert.deepEqual(parseNumber('1.5e-7'), { ok: true, value: 1.5e-7 });
  assert.deepEqual(parseNumber('1E+21'), { ok: true, value: 1e21 });
  assert.deepEqual(parseNumber('007'), { ok: true, value: 7 });
  assert.deepEqual(parseNumber('\u22123'), { ok: true, value: -3 });
  assert.ok(Object.is(unwrap(parseNumber('-0')), -0));
  assert.ok(Object.is(unwrap(parseNumber('-0.000e9')), -0));
  const syntax = (text: string, index: number, options?: ParseNumberOptions): void => {
    assert.deepEqual(parseNumber(text, options), {
      ok: false,
      error: { code: 'number.syntax', path: [], params: { index } },
    });
  };
  syntax('', 0);
  syntax('-', 1);
  syntax('+1', 0);
  syntax(' 12', 0);
  syntax('12 ', 2);
  syntax('12abc', 2);
  syntax('0x10', 1);
  syntax('.5', 0);
  syntax('5.', 2);
  syntax('1e', 2);
  syntax('1e+', 3);
  syntax('1e5', 1, { exponent: false });
  syntax('1_000', 1);
  syntax('Infinity', 0);
  syntax('NaN', 0);
  syntax('--1', 1);
  syntax('\u0661\u0662', 0);
  syntax('\uFF11', 0);
  syntax('1,5', 1);
});

test('parseNumber reads groups of three only where they belong', () => {
  const en: ParseNumberOptions = { grouping: ',' };
  const fr: ParseNumberOptions = { decimal: ',', grouping: '\u202F' };
  assert.deepEqual(parseNumber('1,234,567.5', en), { ok: true, value: 1234567.5 });
  assert.deepEqual(parseNumber('1234567.5', en), { ok: true, value: 1234567.5 });
  assert.deepEqual(parseNumber('-1\u202F234,5', fr), { ok: true, value: -1234.5 });
  const syntax = (text: string, index: number, options: ParseNumberOptions): void => {
    assert.deepEqual(parseNumber(text, options), {
      ok: false,
      error: { code: 'number.syntax', path: [], params: { index } },
    });
  };
  // `1,5` with `,` for groups is a decimal written in another locale: refused, never read as 15.
  syntax('1,5', 3, en);
  syntax('1,23', 4, en);
  syntax('1,2345', 5, en);
  syntax('1234,567', 4, en);
  syntax(',123', 0, en);
  syntax('1,,234', 2, en);
  syntax('1,234,', 6, en);
  syntax('1.234,5', 1, fr);
  syntax('1,234.5', 5, { decimal: ',', grouping: '.' });
  syntax('1 234', 1, fr);
  // A first group that starts with 0 is a decimal of another locale, 1,000 times too large if read.
  syntax('0,123', 1, en);
  syntax('000,123', 3, en);
  syntax('-0,123', 2, en);
  assert.deepEqual(parseNumber('0123', en), { ok: true, value: 123 });
});

test('parseNumber refuses a text that says more than the number read keeps', () => {
  const issue = (text: string, error: NumberIssue): void => {
    assert.deepEqual(parseNumber(text), { ok: false, error });
  };
  issue('1e400', { code: 'number.out_of_range', path: [] });
  issue('-1e400', { code: 'number.out_of_range', path: [] });
  issue('1e-400', { code: 'number.out_of_range', path: [] });
  issue('2e-324', { code: 'number.out_of_range', path: [] });
  issue('9007199254740993', { code: 'number.inexact', path: [], params: { digits: 16 } });
  issue('0.10000000000000000001', { code: 'number.inexact', path: [], params: { digits: 20 } });
  // A subnormal number holds fewer digits than a normal one.
  issue('1.23e-322', { code: 'number.inexact', path: [], params: { digits: 3 } });
  issue(`1.${'0'.repeat(99)}1`, { code: 'number.inexact', path: [], params: { digits: 101 } });
  // Every digit of an exact expansion is read, past the 100 that toPrecision writes: the 751 digits of 2^-1074.
  const exact = exactDecimal(Number.MIN_VALUE);
  assert.equal(exact.digits.length, 751);
  assert.deepEqual(parseNumber(`${exact.digits}e${String(exact.exponent)}`), { ok: true, value: Number.MIN_VALUE });
  // Exactly halfway between two decimals of 20 digits, each half a unit from 1 + 2^-20: both name it.
  assert.deepEqual(parseNumber('1.0000009536743164062'), { ok: true, value: 1 + 2 ** -20 });
  assert.deepEqual(parseNumber('1.0000009536743164063'), { ok: true, value: 1 + 2 ** -20 });
  issue('1.0000009536743164061', { code: 'number.inexact', path: [], params: { digits: 20 } });
  assert.deepEqual(parseNumber('0e999999'), { ok: true, value: 0 });
  assert.deepEqual(parseNumber('9007199254740992'), { ok: true, value: 2 ** 53 });
  assert.deepEqual(parseNumber('12345678901234567000'), { ok: true, value: 12345678901234567000 });
  assert.deepEqual(parseNumber('0.10000000000000001'), { ok: true, value: 0.1 });
  assert.deepEqual(parseNumber('5e-324'), { ok: true, value: Number.MIN_VALUE });
  assert.deepEqual(parseNumber('1.7976931348623157e308'), { ok: true, value: Number.MAX_VALUE });
  assert.deepEqual(parseNumber('0.5000'), { ok: true, value: 0.5 });
  // Exactly halfway between two decimals of 17 digits: String writes the lower one, toPrecision the upper one.
  assert.deepEqual(parseNumber('1460639742519774.2'), { ok: true, value: 1460639742519774.25 });
  assert.deepEqual(parseNumber('1460639742519774.3'), { ok: true, value: 1460639742519774.25 });
});

test('parseNumber bounds the length before reading, and refuses wrong separators', () => {
  assert.deepEqual(parseNumber('1'.repeat(1001)), {
    ok: false,
    error: { code: 'number.too_long', path: [], params: { length: 1001, maximum: 1000 } },
  });
  assert.deepEqual(parseNumber('12', { maxLength: 1 }), {
    ok: false,
    error: { code: 'number.too_long', path: [], params: { length: 2, maximum: 1 } },
  });
  assert.equal(parseNumber('1'.repeat(400), { maxLength: Number.POSITIVE_INFINITY }).ok, false);
  assert.throws(() => parseNumber('1', { decimal: ',', grouping: ',' }), RangeError);
  assert.throws(() => parseNumber('1', { decimal: '' }), RangeError);
  assert.throws(() => parseNumber('1', { grouping: '\u00A0\u00A0' }), RangeError);
  assert.throws(() => parseNumber('1', { grouping: '0' }), RangeError);
  assert.throws(() => parseNumber('1', { decimal: 'e' }), RangeError);
  assert.throws(() => parseNumber('1', { grouping: '-' }), RangeError);
  assert.throws(() => parseNumber('1', { maxLength: -1 }), RangeError);
  assert.throws(() => parseNumber('1', { maxLength: 1.5 }), RangeError);
  assert.throws(() => parseNumber('1', { decimal: 1 as unknown as string }), TypeError);
  assert.throws(() => parseNumber('1e5', { exponent: 'no' as unknown as boolean }), TypeError);
  assert.throws(() => parseNumber('1e5', { exponent: 0 as unknown as boolean }), TypeError);
  assert.throws(() => parseNumber(1 as unknown as string), TypeError);
});

function unwrap(result: Result<number, NumberIssue>): number {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

test('every finite number reads back from String(x)', () => {
  fc.assert(
    fc.property(finite, (x) => {
      // String writes -0 as "0": the format loses the sign, not the reading.
      assert.ok(Object.is(unwrap(parseNumber(String(x))), x === 0 ? 0 : x));
    }),
    PROPERTIES,
  );
});

// The locales whose digits are ASCII and whose groups are of three; their separators and minus signs differ.
const LOCALES = ['en-US', 'fr-FR', 'fr-CH', 'de-DE', 'de-CH', 'es-ES', 'pt-BR', 'sv-SE', 'pl-PL', 'ja-JP'];
const formats = new Map<string, { readonly format: Intl.NumberFormat; readonly options: ParseNumberOptions }>();

function formatOf(locale: string, useGrouping: boolean): { format: Intl.NumberFormat; options: ParseNumberOptions } {
  const name = `${locale} ${String(useGrouping)}`;
  let entry = formats.get(name);
  if (entry === undefined) {
    const format = new Intl.NumberFormat(locale, { maximumSignificantDigits: 17, useGrouping });
    const parts = new Intl.NumberFormat(locale).formatToParts(-1234567.5);
    const part = (type: string): string => parts.find((each) => each.type === type)!.value;
    entry = { format, options: { decimal: part('decimal'), grouping: part('group') } };
    formats.set(name, entry);
  }
  return entry;
}

test('every finite number reads back from Intl.NumberFormat at 17 significant digits, in each declared locale', () => {
  fc.assert(
    fc.property(finite, fc.constantFrom(...LOCALES), fc.boolean(), (x, locale, useGrouping) => {
      const { format, options } = formatOf(locale, useGrouping);
      assert.ok(Object.is(unwrap(parseNumber(format.format(x), options)), x), `${locale}: ${format.format(x)}`);
    }),
    PROPERTIES,
  );
});

// The exact decimal value of a finite number, from its bits: `digits` × 10^`exponent`, `digits` without trailing zeros.
function exactDecimal(value: number): { digits: string; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0);
  const biased = Number(bits >> 52n);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const power = (biased === 0 ? 1 : biased) - 1075;
  let digits: string;
  let exponent: number;
  if (power >= 0) {
    digits = (mantissa << BigInt(power)).toString();
    exponent = 0;
  } else {
    digits = (mantissa * 5n ** BigInt(-power)).toString();
    exponent = power;
  }
  const trimmed = digits.replace(/0+$/, '');
  return { digits: trimmed, exponent: exponent + digits.length - trimmed.length };
}

// The value of a plain text (`-12.50e3`), exactly: `digits` × 10^`exponent`, `digits` without trailing zeros.
function decimalOf(plain: string): { digits: string; exponent: number } {
  const [mantissa = '', power = '0'] = plain.replace(/^-/, '').split(/[eE]/);
  const [integer = '', fraction = ''] = mantissa.split('.');
  const all = `${integer}${fraction}`.replace(/^0+/, '');
  const digits = all.replace(/0+$/, '');
  return { digits, exponent: Number(power) - fraction.length + all.length - digits.length };
}

// Whether the text lies within half a unit of its last significant digit from the exact value of `value`: then the
// text says nothing the number does not hold. Exact arithmetic on bigints, apart from the scanner's toPrecision.
function withinHalfUnit(plain: string, value: number): boolean {
  const text = decimalOf(plain);
  const exact = exactDecimal(value);
  const low = Math.min(text.exponent, exact.exponent);
  const scaled = (digits: string, exponent: number): bigint => BigInt(digits || '0') * 10n ** BigInt(exponent - low);
  const difference = scaled(text.digits, text.exponent) - scaled(exact.digits, exact.exponent);
  const unit = 10n ** BigInt(text.exponent - low);
  return 2n * (difference < 0n ? -difference : difference) <= unit;
}

function significantOf(text: string): string {
  const mantissa = text.replace(/[eE].*$/, '').replace(/[^0-9]/g, '');
  return mantissa.replace(/^0+/, '').replace(/0+$/, '');
}

// What a text of the grammar must give: the value of `Number` on its plain form, unless it is out of the finite
// numbers or holds digits the value does not keep.
function expected(text: string, plain: string): Result<number, NumberIssue> {
  const value = Number(plain);
  const significant = significantOf(text);
  if (!Number.isFinite(value) || (value === 0 && significant !== '')) {
    return { ok: false, error: { code: 'number.out_of_range', path: [] } };
  }
  if (significant === '') {
    return { ok: true, value };
  }
  const digits = significant.length;
  return withinHalfUnit(plain, value)
    ? { ok: true, value }
    : { ok: false, error: { code: 'number.inexact', path: [], params: { digits } } };
}

const run = (alphabet: string, maxLength: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength }).map((units) => units.join(''));
const grammarText = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('', '-', '\u2212'),
      run('0001234567899', 25),
      fc.option(run('0001234567899', 25), { nil: undefined }),
      fc.option(fc.tuple(fc.constantFrom('e', 'E'), fc.constantFrom('', '+', '-'), fc.integer({ min: 0, max: 340 })), {
        nil: undefined,
      }),
    )
    .map(
      ([sign, integer, fraction, exponent]) =>
        `${sign}${integer}${fraction === undefined ? '' : `.${fraction}`}` +
        (exponent === undefined ? '' : `${exponent[0]}${exponent[1]}${String(exponent[2])}`),
    ),
  // Near a number: its exact value cut to 1 to 25 significant digits, which it may or may not keep.
  fc.tuple(finite, fc.integer({ min: 1, max: 25 })).map(([x, digits]) => x.toPrecision(digits)),
  // On a tie: a number of few bits, whose exact expansion ends in 5, written one digit shorter, rounded down or up,
  // or one unit further.
  fc
    .tuple(fc.integer({ min: 1, max: 2 ** 40 }), fc.integer({ min: 1, max: 60 }), fc.integer({ min: -1, max: 2 }))
    .map(([odd, power, step]) => {
      const { digits, exponent } = exactDecimal((2 * odd + 1) / 2 ** power);
      const kept = BigInt(digits.slice(0, -1) || '0') + BigInt(step);
      return `${kept.toString()}e${String(exponent + 1)}`;
    }),
);

test('a text of the grammar reads as Number reads it, when the number keeps every digit of it', () => {
  fc.assert(
    fc.property(grammarText, (text) => {
      const plain = text.replace('\u2212', '-');
      assert.deepEqual(parseNumber(text), expected(text, plain));
    }),
    PROPERTIES,
  );
});

const escape = (unit: string): string => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`;

// The grammar, as a regular expression written apart from the scanner.
function grammarOf(options: ParseNumberOptions): RegExp {
  const decimal = escape(options.decimal ?? '.');
  const integer =
    options.grouping === undefined ? '[0-9]+' : `(?:[1-9][0-9]{0,2}(?:${escape(options.grouping)}[0-9]{3})+|[0-9]+)`;
  const exponent = options.exponent === false ? '' : '(?:[eE][+-]?[0-9]+)?';
  return new RegExp(`^[-\\u2212]?${integer}(?:${decimal}[0-9]+)?${exponent}$`);
}

const OPTION_SETS: readonly ParseNumberOptions[] = [
  {},
  { grouping: ',' },
  { decimal: ',', grouping: '.' },
  { decimal: ',', grouping: ' ' },
  { decimal: ',', grouping: "'" },
  { exponent: false },
];
const anyText = run("0123456789.,' -\u2212+eE_x", 14);

test('parseNumber admits exactly the texts of the grammar, and reads each as Number reads its plain form', () => {
  fc.assert(
    fc.property(anyText, fc.constantFrom(...OPTION_SETS), (text, options) => {
      const result = parseNumber(text, options);
      const admitted = grammarOf(options).test(text);
      assert.equal(result.ok || result.error.code !== 'number.syntax', admitted, JSON.stringify(result));
      if (admitted) {
        let plain = text.replace('\u2212', '-');
        if (options.grouping !== undefined) {
          plain = plain.replaceAll(options.grouping, '');
        }
        plain = plain.replace(options.decimal ?? '.', '.');
        assert.deepEqual(result, expected(text, plain));
      }
    }),
    PROPERTIES,
  );
});

// A text that the grammar can still complete: three zeros at most finish any part of it.
function isPrefix(text: string, options: ParseNumberOptions): boolean {
  const grammar = grammarOf(options);
  return ['', '0', '00', '000'].some((end) => grammar.test(text + end));
}

test('a syntax issue names the first code unit after which no text of the grammar can follow', () => {
  fc.assert(
    fc.property(anyText, fc.constantFrom(...OPTION_SETS), (text, options) => {
      const result = parseNumber(text, options);
      fc.pre(!result.ok && result.error.code === 'number.syntax');
      const { index } = (result.error as Extract<NumberIssue, { code: 'number.syntax' }>).params;
      assert.ok(isPrefix(text.slice(0, index), options), `${text}: before ${String(index)}`);
      assert.ok(index === text.length || !isPrefix(text.slice(0, index + 1), options), `${text}: at ${String(index)}`);
    }),
    PROPERTIES,
  );
});

test('a text longer than maxLength is refused whatever it holds', () => {
  fc.assert(
    fc.property(anyText, fc.nat(16), (text, maxLength) => {
      const result = parseNumber(text, { maxLength });
      assert.equal(!result.ok && result.error.code === 'number.too_long', text.length > maxLength);
    }),
    PROPERTIES,
  );
});

test('bigIntToNumber and numberToBigInt convert exactly, or say why not', () => {
  assertType<Equal<ReturnType<typeof bigIntToNumber>, Result<number, NumberIssue>>>();
  assertType<Equal<ReturnType<typeof numberToBigInt>, Result<bigint, NumberIssue>>>();
  assert.deepEqual(bigIntToNumber(42n), { ok: true, value: 42 });
  assert.deepEqual(bigIntToNumber(2n ** 60n), { ok: true, value: 2 ** 60 });
  assert.deepEqual(bigIntToNumber(-(2n ** 53n)), { ok: true, value: -(2 ** 53) });
  assert.deepEqual(bigIntToNumber(2n ** 53n + 1n), {
    ok: false,
    error: { code: 'number.inexact', path: [], params: { digits: 16 } },
  });
  assert.deepEqual(bigIntToNumber(2n ** 1024n), { ok: false, error: { code: 'number.out_of_range', path: [] } });
  assert.deepEqual(bigIntToNumber(BigInt(Number.MAX_VALUE)), { ok: true, value: Number.MAX_VALUE });
  assert.deepEqual(numberToBigInt(2 ** 60), { ok: true, value: 2n ** 60n });
  assert.deepEqual(numberToBigInt(-0), { ok: true, value: 0n });
  for (const value of [1.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE]) {
    assert.deepEqual(numberToBigInt(value), { ok: false, error: { code: 'number.not_integer', path: [] } });
  }
  assert.throws(() => bigIntToNumber(1 as unknown as bigint), TypeError);
  assert.throws(() => numberToBigInt(1n as unknown as number), TypeError);
});

const bitLength = (value: bigint): number => (value === 0n ? 0 : value.toString(2).length);
// Half a unit of the last place above the largest finite number: from there, a value rounds to infinity.
const OVERFLOW = 2n ** 1024n - 2n ** 970n;
const nearPowers = fc
  .tuple(fc.integer({ min: 0, max: 1100 }), fc.bigInt({ min: -4n, max: 4n }), fc.boolean())
  .map(([power, offset, negative]) => (negative ? -1n : 1n) * (2n ** BigInt(power) + offset));
const bigints = fc.oneof(fc.bigInt({ min: -(2n ** 1100n), max: 2n ** 1100n }), nearPowers, fc.bigInt());

test('bigIntToNumber holds a bigint exactly when its bits without trailing zeros fit in 53', () => {
  fc.assert(
    fc.property(bigints, (value) => {
      const magnitude = value < 0n ? -value : value;
      const odd = magnitude === 0n ? 0n : magnitude >> BigInt(bitLength(magnitude & -magnitude) - 1);
      const result = bigIntToNumber(value);
      if (magnitude >= OVERFLOW) {
        assert.deepEqual(result, { ok: false, error: { code: 'number.out_of_range', path: [] } });
      } else if (bitLength(odd) <= 53) {
        assert.ok(result.ok);
        assert.equal(BigInt(result.value), value);
      } else {
        const digits = magnitude.toString().replace(/0+$/, '').length;
        assert.deepEqual(result, { ok: false, error: { code: 'number.inexact', path: [], params: { digits } } });
      }
    }),
    PROPERTIES,
  );
});

test('numberToBigInt converts every integer and only them, and bigIntToNumber gives it back', () => {
  fc.assert(
    fc.property(fc.oneof(fc.double(), fc.integer(), fc.maxSafeInteger()), (value) => {
      const result = numberToBigInt(value);
      assert.equal(result.ok, Number.isInteger(value));
      if (result.ok) {
        assert.deepEqual(bigIntToNumber(result.value), { ok: true, value: value === 0 ? 0 : value });
      }
    }),
    PROPERTIES,
  );
});

// What may come out of these functions for an adversarial value: a result, a TypeError or a RangeError (an argument
// of the wrong type, an option out of its range), or the error of the hostile value itself.
function survives(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
      String(error),
    );
  }
}

const parsedFrom = (value: unknown): void => {
  if (typeof value === 'string') {
    // A string never throws: it reads, or it is an issue.
    parseNumber(value);
  } else {
    assert.throws(() => parseNumber(value as string), TypeError);
  }
};

declareAdversarial(SUBPATH, 'parseNumber', {
  boundary: (value) => {
    parsedFrom(value);
    survives(() => parseNumber('1', { decimal: value as string }));
    survives(() => parseNumber('1', { grouping: value as string }));
    survives(() => parseNumber('1', { maxLength: value as number }));
    survives(() => parseNumber('1', value as ParseNumberOptions));
  },
  structures: (value) => {
    parsedFrom(value);
    survives(() => parseNumber('1', value as ParseNumberOptions));
  },
  hostile: (value) => {
    parsedFrom(value);
    survives(() => parseNumber('1', value as ParseNumberOptions));
  },
  unicode: (text) => {
    // Only ASCII digits, signs, separators and exponent marks are read: other digits, controls and invisible
    // characters are issues, wherever they stand.
    for (const options of OPTION_SETS) {
      const result = parseNumber(text, options);
      assert.ok(!result.ok || /^[-\u22120-9.,' eE+]+$/.test(text), text);
      const after = parseNumber(`1${text}`, options);
      assert.equal(after.ok || after.error.code !== 'number.syntax', grammarOf(options).test(`1${text}`));
    }
  },
  callbacks: { na: 'parseNumber takes no callback' },
  async: { na: 'parseNumber is synchronous and takes no signal' },
});

for (const name of ['bigIntToNumber', 'numberToBigInt'] as const) {
  const convert = (value: unknown): unknown =>
    name === 'bigIntToNumber' ? bigIntToNumber(value as bigint) : numberToBigInt(value as number);
  const converted = (value: unknown): void => {
    if (typeof value === (name === 'bigIntToNumber' ? 'bigint' : 'number')) {
      convert(value);
    } else {
      assert.throws(() => convert(value), TypeError);
    }
  };
  declareAdversarial(SUBPATH, name, {
    boundary: converted,
    structures: converted,
    hostile: converted,
    unicode: { na: `${name} takes no text` },
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}
