// graphemeLength, truncate, slugify, normalizeWhitespace and findHidden. The judge of graphemes is the platform:
// Intl.Segmenter segments every text the laws draw, so the walk by simple code units, and its hand-over to the
// segmenter, are checked against it; the judges of whitespace and hidden characters are the tables of the Unicode
// Character Database (properties.test.ts), and es-toolkit judges truncate and slugify (judge.test.ts).
// Blind spots: a grapheme rule no generator draws, and a segmenter that is itself wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { declareAdversarial, fc, HostileError } from '@yaltaan/testing';

import { findHidden, graphemeLength, normalizeWhitespace, slugify, truncate, type TruncateOptions } from './index.ts';

const SUBPATH = '@yaltaan/core/string';
const PROPERTIES = { numRuns: 1000 };
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
const FLAG = '\u{1F1EB}\u{1F1F7}';
const ACCENTED = 'e\u0301';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// The end of each grapheme of `text`, as the platform segments it.
const endsOf = (text: string): number[] =>
  Array.from(segmenter.segment(text), ({ index, segment }) => index + segment.length);

test('graphemeLength counts what a reader sees', () => {
  assert.equal(graphemeLength(''), 0);
  assert.equal(graphemeLength('abc'), 3);
  assert.equal(graphemeLength('a\r\nb'), 3);
  assert.equal(graphemeLength(ACCENTED), 1);
  assert.equal(graphemeLength(FAMILY), 1);
  assert.equal(graphemeLength(FLAG + FLAG), 2);
  assert.equal(graphemeLength(`ab${FAMILY}c`), 4);
  assert.equal(graphemeLength('\u2019abc\u0301'), 4);
  assert.equal(graphemeLength('\uD800'), 1);
  assert.throws(() => graphemeLength(1 as unknown as string), TypeError);
});

test('truncate keeps whole graphemes within both bounds, the omission included', () => {
  assert.equal(truncate(`ab${FAMILY}cd`, { maxGraphemes: 4 }), `ab${FAMILY}\u2026`);
  assert.equal(truncate(`ab${FAMILY}cd`, { maxGraphemes: 3 }), 'ab\u2026');
  assert.equal(truncate('Cr\u00e8me br\u00fbl\u00e9e', { maxGraphemes: 8 }), 'Cr\u00e8me b\u2026');
  assert.equal(truncate('abcdef', { maxLength: 4, omission: '...' }), 'a...');
  assert.equal(truncate('abcdef', { maxGraphemes: 6 }), 'abcdef');
  assert.equal(truncate('abcdef', { maxGraphemes: 3, omission: '' }), 'abc');
  assert.equal(truncate('a\r\nb', { maxGraphemes: 2, omission: '' }), 'a\r\n');
  assert.equal(truncate('a\r\nb', { maxLength: 2, omission: '' }), 'a');
  // A grapheme of 51 code units cannot pass a bound of 20 code units, however few graphemes it counts.
  assert.equal(truncate(`e${'\u0301'.repeat(50)}xyz`, { maxGraphemes: 3, maxLength: 20 }), '\u2026');
  assert.equal(truncate('', { maxGraphemes: 0, omission: '' }), '');
  assert.throws(() => truncate('abc', { maxGraphemes: 0 }), RangeError);
  assert.throws(() => truncate('a', { maxLength: 2, omission: '...' }), RangeError);
  assert.throws(() => truncate('abc', { maxGraphemes: 1.5 }), RangeError);
  assert.throws(() => truncate('abc', { maxGraphemes: -1, omission: '' }), {
    name: 'RangeError',
    message: /non-negative integer/,
  });
  assert.throws(() => truncate('abc', { maxLength: -1, omission: '' }), {
    name: 'RangeError',
    message: /non-negative integer/,
  });
  assert.throws(() => truncate('abc', { maxGraphemes: Number.NaN }), RangeError);
  assert.throws(() => truncate('abc', {} as TruncateOptions), TypeError);
  assert.throws(() => truncate('abc', { maxLength: '2' as unknown as number }), TypeError);
  assert.throws(() => truncate('abc', { maxLength: 2, omission: 1 as unknown as string }), TypeError);
  assert.equal(truncate('abc', { maxGraphemes: Number.POSITIVE_INFINITY }), 'abc');
});

test('slugify follows its written rules', () => {
  assert.equal(slugify('Cr\u00e8me br\u00fbl\u00e9e : 2 \u0153ufs'), 'creme-brulee-2-oeufs');
  assert.equal(slugify('\ufb01\u00b2 Stra\u00dfe \u0141\u00f3d\u017a'), 'fi2-strasse-lodz');
  assert.equal(slugify('\u00c6\u00d0\u00d8\u00de\u0110\u0126\u0141\u014a\u0152\u0166\u1e9e'), 'aedothdhlnoetss');
  assert.equal(slugify('\u0131\u0138'), 'ik');
  assert.equal(slugify('camelCase abc123'), 'camelcase-abc123');
  assert.equal(slugify('--a__b..'), 'a-b');
  assert.equal(slugify('\u041f\u0440\u0438\u0432\u0435\u0442'), '');
  assert.equal(slugify(`${FAMILY} a ${FLAG}`), 'a');
  assert.equal(slugify('col\u0140lecci\u00f3'), 'coll-leccio');
  assert.equal(slugify(''), '');
  assert.throws(() => slugify(null as unknown as string), TypeError);
});

test('normalizeWhitespace collapses runs of whitespace and trims both ends', () => {
  assert.equal(normalizeWhitespace('  Jean \t\n Dupont '), 'Jean Dupont');
  assert.equal(normalizeWhitespace(' '), '');
  assert.equal(normalizeWhitespace(''), '');
  assert.equal(normalizeWhitespace('\u0085a\u00a0\u3000b\u2029'), 'a b');
  assert.equal(normalizeWhitespace('a\uFEFF'), 'a\uFEFF');
  assert.throws(() => normalizeWhitespace(undefined as unknown as string), TypeError);
});

test('findHidden names bidirectional controls, invisible characters and controls', () => {
  assert.deepEqual(findHidden('user\u202Egnp.exe'), [{ index: 4, codePoint: 0x202e, kind: 'bidi' }]);
  assert.deepEqual(findHidden('a\u200Bb\u0000c\td\r\n'), [
    { index: 1, codePoint: 0x200b, kind: 'invisible' },
    { index: 3, codePoint: 0, kind: 'control' },
  ]);
  assert.deepEqual(findHidden('\u{E0041}'), [{ index: 0, codePoint: 0xe0041, kind: 'invisible' }]);
  assert.deepEqual(
    findHidden(FAMILY).map(({ codePoint }) => codePoint),
    [0x200d, 0x200d],
  );
  assert.deepEqual(findHidden('\uD800'), []);
  assert.throws(() => findHidden(0 as unknown as string), TypeError);
});

// Pieces of text where the grapheme rules disagree with code units and code points: each side of the simple ranges,
// extenders, joiners, emoji, regional indicators, Hangul jamo, prepended marks, Indic conjuncts, CR and LF, lone
// surrogates.
const piece = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      'a',
      'Z',
      ' ',
      '\r',
      '\n',
      '\r\n',
      '\u00e9',
      '\u02ff',
      '\u0300',
      '\u0301',
      '\u200c',
      '\u200d',
      '\u200f',
      '\u2010',
      '\u2019',
      '\u203c',
      '\u205f',
      '\u2060',
      '\u20ac',
      '\u20cf',
      '\u20d0',
      '\ufe0f',
      '\u{1F468}',
      '\u{1F3FD}',
      '\u{1F1EB}',
      '\u{1F1F7}',
      '\u1100',
      '\u1161',
      '\u11a8',
      '\u0600',
      '\u0915',
      '\u094d',
      '\ud800',
      '\udc00',
    ),
    weight: 6,
  },
  { arbitrary: fc.string({ unit: 'grapheme', maxLength: 3 }), weight: 2 },
  { arbitrary: fc.string({ unit: 'binary', maxLength: 2 }), weight: 1 },
  { arbitrary: fc.string({ unit: 'grapheme-ascii', maxLength: 6 }), weight: 2 },
);
const text = fc.array(piece, { maxLength: 12 }).map((pieces) => pieces.join(''));

test('graphemeLength counts the graphemes Intl.Segmenter finds', () => {
  fc.assert(
    fc.property(text, (value) => {
      assert.equal(graphemeLength(value), endsOf(value).length);
    }),
    { numRuns: 3000 },
  );
});

// U+0000–U+02FF, U+2010–U+205F and U+20A0–U+20CF, written here from the measurement, not read from the module.
const SIMPLE: readonly (readonly [number, number])[] = [
  [0x0000, 0x02ff],
  [0x2010, 0x205f],
  [0x20a0, 0x20cf],
];

test('each ordered pair of simple code units is a grapheme boundary for Intl.Segmenter, but CR LF', () => {
  const units = SIMPLE.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, at) => first + at));
  const parts: string[] = [];
  for (const first of units) {
    for (const second of units) {
      parts.push(String.fromCharCode(first, second));
    }
  }
  // Every two adjacent code units of the text are such a pair, so each is a boundary but inside CR LF.
  const all = parts.join('');
  const crLf = all.split('\r\n').length - 1;
  assert.equal(endsOf(all).length, all.length - crLf);
  assert.equal(graphemeLength(all), all.length - crLf);
});

const omissions = fc.oneof(
  // Omissions that join what comes before them too: a mark, half of a flag, a joiner, a lone low surrogate.
  fc.constantFrom(
    undefined,
    '',
    '...',
    '\u2026',
    FAMILY,
    ACCENTED,
    '\r\n',
    '\u0301.',
    '\u{1F1F7}',
    '\u200D\u{1F469}',
    '\uDC00',
  ),
  fc.string({ maxLength: 3 }),
);

// Checks what truncate(value, options) returns against the platform's segments of `value`.
function checkTruncation(value: string, options: TruncateOptions): void {
  const omission = options.omission ?? '\u2026';
  const maxGraphemes = options.maxGraphemes ?? Number.POSITIVE_INFINITY;
  const maxLength = options.maxLength ?? Number.POSITIVE_INFINITY;
  const omitted = endsOf(omission).length;
  if (omitted > maxGraphemes || omission.length > maxLength) {
    assert.throws(() => truncate(value, options), RangeError);
    return;
  }
  const result = truncate(value, options);
  const ends = endsOf(value);
  if (ends.length <= maxGraphemes && value.length <= maxLength) {
    assert.equal(result, value);
    return;
  }
  assert.ok(result.endsWith(omission));
  const kept = result.slice(0, result.length - omission.length);
  // Whole graphemes: the kept part ends where one of the text's graphemes ends.
  const count = kept === '' ? 0 : ends.indexOf(kept.length) + 1;
  assert.ok(value.startsWith(kept) && (kept === '' || count > 0), `cut inside a grapheme: ${JSON.stringify(kept)}`);
  assert.ok(count + omitted <= maxGraphemes && kept.length + omission.length <= maxLength);
  // The longest such prefix: the next grapheme would not hold.
  const next = ends[count]!;
  assert.ok(count + 1 + omitted > maxGraphemes || next + omission.length > maxLength, 'a grapheme more would hold');
  assert.ok(endsOf(result).length <= maxGraphemes && result.length <= maxLength);
  assert.equal(truncate(result, options), result);
}

test('truncate never cuts a grapheme, holds within its bounds and keeps the longest prefix', () => {
  fc.assert(
    fc.property(text, omissions, fc.nat(12), (value, omission, drawn) => {
      const ends = endsOf(value);
      const marker = omission === undefined ? {} : { omission };
      const omitted = endsOf(omission ?? '\u2026').length;
      const omissionLength = (omission ?? '\u2026').length;
      // Each trial tries the bounds at the edges: the omission alone, the whole text, and one grapheme off each.
      const graphemeBounds = [omitted, omitted + 1, ends.length - 1, ends.length, ends.length + 1, drawn];
      const lengthBounds = [omissionLength, value.length - 1, value.length, ...ends.map((end) => end + omissionLength)];
      for (const maxGraphemes of graphemeBounds.filter((bound) => bound >= 0)) {
        checkTruncation(value, { maxGraphemes, ...marker });
        checkTruncation(value, { maxGraphemes, maxLength: Math.max(0, value.length - 2), ...marker });
      }
      for (const maxLength of lengthBounds.flatMap((bound) => [bound - 1, bound]).filter((bound) => bound >= 0)) {
        checkTruncation(value, { maxLength, ...marker });
      }
    }),
    PROPERTIES,
  );
});

const SLUG = /^([a-z0-9]+(-[a-z0-9]+)*)?$/;

// Text with Latin letters of every kind, digits, compatibility forms, other scripts, marks and separators.
const words = fc.string({
  unit: fc.oneof(
    { arbitrary: fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 1 }), weight: 6 },
    {
      arbitrary: fc.integer({ min: 0xc0, max: 0x24f }).map((codePoint) => String.fromCodePoint(codePoint)),
      weight: 3,
    },
    {
      arbitrary: fc.constantFrom('\u0301', '\u20d7', '\ufb01', '\u00b2', '\uff21', '\u1e9e', '\u0130', '\u212a'),
      weight: 2,
    },
    { arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }), weight: 2 },
    { arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }), weight: 1 },
  ),
  maxLength: 16,
});

test('slugify is idempotent and gives a slug of ASCII letters and digits', () => {
  fc.assert(
    fc.property(words, (value) => {
      const slug = slugify(value);
      assert.match(slug, SLUG);
      assert.equal(slugify(slug), slug);
    }),
    PROPERTIES,
  );
});

test('slugify keeps every ASCII letter and digit of the text, in order and in lower case', () => {
  fc.assert(
    fc.property(words, (value) => {
      const slug = slugify(value);
      let from = 0;
      for (const character of value.replace(/[^A-Za-z0-9]/g, '').toLowerCase()) {
        from = slug.indexOf(character, from) + 1;
        assert.ok(from > 0, `${character} lost from ${JSON.stringify(value)}`);
      }
    }),
    PROPERTIES,
  );
});

// Marks of every kind: nonspacing, of symbols, spacing and enclosing.
const MARKS = ['\u0301', '\u0327', '\u20d7', '\u093f', '\u0f71', '\u20dd', '\ufe20', '\u{1D167}'];

test('slugify removes every mark, wherever it is', () => {
  fc.assert(
    fc.property(words, fc.nat(), fc.constantFrom(...MARKS), (value, at, mark) => {
      // Between two code points, never inside a surrogate pair.
      const characters = Array.from(value);
      characters.splice(at % (characters.length + 1), 0, mark);
      assert.equal(slugify(characters.join('')), slugify(value));
    }),
    PROPERTIES,
  );
});

test('slugify of two texts a space apart joins their slugs', () => {
  fc.assert(
    fc.property(words, words, (first, second) => {
      const expected = [slugify(first), slugify(second)].filter((slug) => slug !== '').join('-');
      assert.equal(slugify(`${first} ${second}`), expected);
    }),
    PROPERTIES,
  );
});

test('slugify spells every letter of U+00C0 to U+017F in ASCII letters', () => {
  for (let codePoint = 0xc0; codePoint <= 0x17f; codePoint += 1) {
    const letter = String.fromCodePoint(codePoint);
    if (/\p{L}/u.test(letter)) {
      assert.match(slugify(letter), /^[a-z]+$/, `U+${codePoint.toString(16)}`);
    }
  }
});

// The time of `run` on `make(n)`, the fastest of three.
function fastest(run: (value: string) => unknown, value: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const start = process.hrtime.bigint();
    run(value);
    best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
  }
  return best;
}

test('every function takes a time proportional to the text, on the texts that would make it backtrack', () => {
  const cases: readonly [string, (value: string) => unknown, (n: number) => string][] = [
    ['normalizeWhitespace', normalizeWhitespace, (n) => ' '.repeat(n) + 'x'],
    ['normalizeWhitespace', normalizeWhitespace, (n) => ' x'.repeat(n / 2)],
    ['slugify', slugify, (n) => '-'.repeat(n) + 'x'],
    ['slugify', slugify, (n) => '\u0301'.repeat(n)],
    ['graphemeLength', graphemeLength, (n) => `e${'\u0301'.repeat(n)}`],
    ['graphemeLength', graphemeLength, (n) => 'a'.repeat(n) + '\u0301'],
    ['truncate', (value) => truncate(value, { maxLength: value.length - 1 }), (n) => 'a'.repeat(n) + '\u0301'],
    ['findHidden', findHidden, (n) => '\u200b'.repeat(n)],
  ];
  for (const [name, run, make] of cases) {
    const times = [20_000, 40_000, 80_000].map((n) => fastest(run, make(n)));
    // Four times the text, at most eight times the time, with a millisecond of noise; backtracking squares it.
    assert.ok(times[2]! <= 8 * times[0]! + 1, `${name}: ${times.map((time) => time.toFixed(2)).join(', ')} ms`);
  }
});

test('truncate keeps whole graphemes across the windows the segmenter reads, however long a grapheme', () => {
  // A padding of Cyrillic hands the text to the segmenter at once, and puts the following graphemes across the edges
  // of its windows, at 64, 192 and 448 code units; a grapheme of 300 marks is longer than the first two windows.
  const long = fc
    .tuple(fc.nat(460), fc.array(fc.oneof(piece, fc.constant(`e${'\u0301'.repeat(300)}`)), { maxLength: 24 }))
    .map(([padding, pieces]) => '\u0436'.repeat(padding) + pieces.join(''));
  fc.assert(
    fc.property(long, fc.nat(30), (value, drawn) => {
      const count = endsOf(value).length;
      for (const maxGraphemes of [count - 1, count - drawn, Math.ceil(count / 2), 1]) {
        if (maxGraphemes >= 1) {
          checkTruncation(value, { maxGraphemes });
          checkTruncation(value, { maxGraphemes, omission: '' });
        }
      }
    }),
    { numRuns: 300 },
  );
});

test('truncate walks the graphemes it keeps, not the rest of the text', () => {
  // Cyrillic leaves the walk by code unit at once: the segmenter takes over from the first grapheme.
  for (const unit of ['a', '\u0436', '\u{1F600}']) {
    const value = unit.repeat(8_000_000);
    const time = fastest((text) => truncate(text, { maxGraphemes: 5 }), value);
    // Segmenting the 8 million code units would take about 10 ms.
    assert.ok(time < 2, `${JSON.stringify(unit)}: ${time.toFixed(3)} ms`);
    assert.equal(truncate(value, { maxGraphemes: 5 }), unit.repeat(4) + '\u2026');
  }
});

// What may come out for an adversarial value: a result, a TypeError or a RangeError, or the error of the hostile
// value itself.
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

// A text that is not a string is a TypeError, never read as one: an object has no `length` a count could trust.
function readsText(run: () => unknown, value: unknown): void {
  if (typeof value === 'string') {
    survives(run);
  } else {
    assert.throws(run, TypeError);
  }
}

const CALLS = {
  graphemeLength: (value: unknown) => {
    readsText(() => graphemeLength(value as string), value);
  },
  truncate: (value: unknown) => {
    readsText(() => truncate(value as string, { maxGraphemes: 3 }), value);
    survives(() => truncate('abcdef', { maxGraphemes: value as number }));
    // An omission left undefined is the default one.
    readsText(() => truncate('abcdef', { maxLength: 3, omission: value as string }), value ?? '');
    survives(() => truncate('abcdef', value as TruncateOptions));
  },
  slugify: (value: unknown) => {
    readsText(() => slugify(value as string), value);
  },
  normalizeWhitespace: (value: unknown) => {
    readsText(() => normalizeWhitespace(value as string), value);
  },
  findHidden: (value: unknown) => {
    readsText(() => findHidden(value as string), value);
  },
} as const;

// The law of each function on one text of the Unicode catalogue.
const UNICODE_LAWS = {
  graphemeLength: (value: string) => {
    assert.equal(graphemeLength(value), endsOf(value).length);
  },
  truncate: (value: string) => {
    for (let maxGraphemes = 1; maxGraphemes <= 4; maxGraphemes += 1) {
      checkTruncation(value, { maxGraphemes });
      checkTruncation(value, { maxLength: maxGraphemes });
    }
  },
  slugify: (value: string) => {
    assert.match(slugify(value), SLUG);
    assert.equal(slugify(slugify(value)), slugify(value));
  },
  normalizeWhitespace: (value: string) => {
    const normalized = normalizeWhitespace(value);
    assert.equal(normalizeWhitespace(normalized), normalized);
    assert.doesNotMatch(normalized, /^ | $|\p{White_Space}(?<! )|  /u);
  },
  findHidden: (value: string) => {
    for (const { index, codePoint } of findHidden(value)) {
      assert.equal(value.codePointAt(index), codePoint);
    }
  },
} as const;

for (const [name, call] of Object.entries(CALLS)) {
  declareAdversarial(SUBPATH, name, {
    boundary: (value) => {
      call(value);
      if (typeof value === 'string') {
        UNICODE_LAWS[name as keyof typeof UNICODE_LAWS](value);
      }
    },
    structures: call,
    hostile: call,
    unicode: UNICODE_LAWS[name as keyof typeof UNICODE_LAWS],
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}
