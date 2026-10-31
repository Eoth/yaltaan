// Unicode: strings whose code units, code points and graphemes disagree in number, whose display order differs from
// their memory order, or that are not well formed. Every character that is invisible or directional is written as an
// escape, so that the source shows what the string holds.
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

const loneSurrogate = fc.integer({ min: 0xd800, max: 0xdfff }).map((unit) => String.fromCharCode(unit));
const special = fc.constantFrom('\u200D', '\u200B', '\u2060', '\uFEFF', '\u202E', '\u2066', '\u2069', '\u0301');
const grapheme = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 });

export const unicode: Category<string> = defineCategory<string>(
  'unicode',
  [
    named('combining characters', () => 'e\u0301\u0302'),
    named('precomposed and decomposed forms', () => 'café cafe\u0301'),
    named('ZWJ sequence', () => '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'),
    named('regional indicator flag', () => '\u{1F1EB}\u{1F1F7}'),
    named('emoji with a skin tone modifier', () => '\u{1F44D}\u{1F3FD}'),
    named('astral characters', () => '\u{1D4B3}\u{20000}'),
    named('right-to-left text', () => 'مرحبا'),
    named('mixed directions', () => 'abc שלום 123'),
    named('bidirectional override', () => 'user\u202Egnp.exe\u202C'),
    named('bidirectional isolates', () => 'a\u2067א\u2069b'),
    named('lone high surrogate', () => '\uD83D'),
    named('lone low surrogate', () => '\uDE00'),
    named('reversed surrogate pair', () => '\uDE00\uD83D'),
    named('invisible characters', () => 'a\u200B\u200C\u2060\uFEFFb'),
    named('control characters', () => '\u0000\u0007\u001B\u007F'),
    named('line and paragraph separators', () => 'a\u2028b\u2029c'),
  ],
  fc.string({
    unit: fc.oneof({ arbitrary: grapheme, weight: 4 }, { arbitrary: special, weight: 1 }, loneSurrogate),
    maxLength: 16,
  }),
);
