// findHidden and normalizeWhitespace judged on every code point by the tables of the Unicode Character Database
// 17.0, written here from PropList.txt (White_Space, Bidi_Control) and DerivedCoreProperties.txt
// (Default_Ignorable_Code_Point), whose lists are the same from 15.1 to 17.0, the versions of the supported Node
// lines; Cc is U+0000–U+001F and U+007F–U+009F, fixed by the stability policy. The module reads these properties
// through the engine's regular expressions, never through these tables.
// Blind spots: a later version of the standard that changes a property, until these tables are written again.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fc } from '@yaltaan/testing';

import { findHidden, normalizeWhitespace, type HiddenCharacter } from './index.ts';

type Range = readonly [first: number, last: number];

const WHITE_SPACE: readonly Range[] = [
  [0x0009, 0x000d],
  [0x0020, 0x0020],
  [0x0085, 0x0085],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];
const BIDI_CONTROL: readonly Range[] = [
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
const DEFAULT_IGNORABLE: readonly Range[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];
const CONTROL: readonly Range[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
];

const within = (ranges: readonly Range[], codePoint: number): boolean =>
  ranges.some(([first, last]) => codePoint >= first && codePoint <= last);

// What the tables say findHidden reports for one code point.
function expectedKind(codePoint: number): HiddenCharacter['kind'] | undefined {
  if (within(BIDI_CONTROL, codePoint)) {
    return 'bidi';
  }
  if (within(DEFAULT_IGNORABLE, codePoint)) {
    return 'invisible';
  }
  return within(CONTROL, codePoint) && !within(WHITE_SPACE, codePoint) ? 'control' : undefined;
}

// Every scalar value, in order, and where each starts.
function everyCodePoint(): { text: string; starts: number[]; codePoints: number[] } {
  const parts: string[] = [];
  const starts: number[] = [];
  const codePoints: number[] = [];
  let length = 0;
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      continue;
    }
    const character = String.fromCodePoint(codePoint);
    parts.push(character);
    starts.push(length);
    codePoints.push(codePoint);
    length += character.length;
  }
  return { text: parts.join(''), starts, codePoints };
}

test('findHidden reports every code point the tables name, of the kind they name, and no other', () => {
  const { text, starts, codePoints } = everyCodePoint();
  const expected: HiddenCharacter[] = [];
  codePoints.forEach((codePoint, at) => {
    const kind = expectedKind(codePoint);
    if (kind !== undefined) {
      expected.push({ index: starts[at]!, codePoint, kind });
    }
  });
  assert.deepEqual(findHidden(text), expected);
  // Each code point alone too: a match never depends on its neighbours.
  for (const { codePoint, kind } of expected) {
    assert.deepEqual(findHidden(String.fromCodePoint(codePoint)), [{ index: 0, codePoint, kind }]);
  }
});

test('normalizeWhitespace turns each whitespace code point of the tables into a space, and no other', () => {
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      continue;
    }
    const character = String.fromCodePoint(codePoint);
    const expected = within(WHITE_SPACE, codePoint) ? 'a b' : `a${character}b`;
    if (normalizeWhitespace(`a${character}b`) !== expected) {
      assert.fail(`U+${codePoint.toString(16).toUpperCase()}`);
    }
  }
});

// Text where whitespace of every kind, its neighbours in the tables and hidden characters are frequent.
const nearWhitespace = fc.constantFrom(
  ...WHITE_SPACE.flatMap(([first, last]) => [first - 1, first, last, last + 1]),
  0xfeff,
  0x200b,
  0x180e,
);
const text = fc.string({
  unit: fc.oneof(
    { arbitrary: nearWhitespace.map((codePoint) => String.fromCodePoint(codePoint)), weight: 3 },
    { arbitrary: fc.constantFrom('a', 'b', ' ', '\r\n'), weight: 3 },
    { arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }), weight: 1 },
  ),
  maxLength: 20,
});

// The words of `text`: its runs of code points outside the White_Space table.
function words(value: string): string[] {
  const found: string[] = [];
  let word = '';
  for (const character of value) {
    if (within(WHITE_SPACE, character.codePointAt(0)!)) {
      found.push(word);
      word = '';
    } else {
      word += character;
    }
  }
  found.push(word);
  return found.filter((each) => each !== '');
}

test('normalizeWhitespace keeps the words of the text, in order, one space apart, and is idempotent', () => {
  fc.assert(
    fc.property(text, (value) => {
      const normalized = normalizeWhitespace(value);
      assert.equal(normalized, words(value).join(' '));
      assert.equal(normalizeWhitespace(normalized), normalized);
    }),
    { numRuns: 2000 },
  );
});

test('findHidden reports in order, at the index of each code point, and nothing once they are removed', () => {
  fc.assert(
    fc.property(text, (value) => {
      const found = findHidden(value);
      let kept = '';
      let from = 0;
      for (const { index, codePoint } of found) {
        assert.ok(index >= from);
        assert.equal(value.codePointAt(index), codePoint);
        kept += value.slice(from, index);
        from = index + String.fromCodePoint(codePoint).length;
      }
      kept += value.slice(from);
      assert.deepEqual(findHidden(kept), []);
    }),
    { numRuns: 2000 },
  );
});
