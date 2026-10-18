// Unicode: strings whose code units, code points and graphemes disagree in number, whose display order differs from
// their memory order, or that are not well formed. Every character that is invisible or directional is written as an
// escape, so that the source shows what the string holds.
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

const loneSurrogate = fc.integer({ min: 0xd800, max: 0xdfff }).map((unit) => String.fromCharCode(unit));
const special = fc.constantFrom('‍', '​', '⁠', '﻿', '‮', '⁦', '⁩', '́');
const grapheme = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 });

export const unicode: Category<string> = defineCategory<string>(
  'unicode',
  [
    named('combining characters', () => 'é̂'),
    named('precomposed and decomposed forms', () => 'café café'),
    named('ZWJ sequence', () => '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'),
    named('regional indicator flag', () => '\u{1F1EB}\u{1F1F7}'),
    named('emoji with a skin tone modifier', () => '\u{1F44D}\u{1F3FD}'),
    named('astral characters', () => '\u{1D4B3}\u{20000}'),
    named('right-to-left text', () => 'مرحبا'),
    named('mixed directions', () => 'abc שלום 123'),
    named('bidirectional override', () => 'user‮gnp.exe‬'),
    named('bidirectional isolates', () => 'a⁧א⁩b'),
    named('lone high surrogate', () => '\uD83D'),
    named('lone low surrogate', () => '\uDE00'),
    named('reversed surrogate pair', () => '\uDE00\uD83D'),
    named('invisible characters', () => 'a​‌⁠﻿b'),
    named('control characters', () => '\u0000\u0007\u001B\u007F'),
    named('line and paragraph separators', () => 'a b c'),
  ],
  fc.string({
    unit: fc.oneof({ arbitrary: grapheme, weight: 4 }, { arbitrary: special, weight: 1 }, loneSurrogate),
    maxLength: 16,
  }),
);
