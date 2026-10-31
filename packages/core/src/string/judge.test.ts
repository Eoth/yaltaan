// truncate and slugify against their es-toolkit equivalents: es-toolkit/compat's truncate, lodash's, with our
// `maxGraphemes` as its `length`, and `kebabCase(deburr(text))` for slugify, on texts drawn among the ones that tell
// them apart: graphemes of several code points, omissions longer than the bound, capitals inside words, letters beside
// digits, compatibility forms, marks, letters of other scripts and emoji.
// Blind spots: es-toolkit has no grapheme count, no bound in code units, no whitespace collapse and no detection of
// hidden characters: their judges are Intl.Segmenter and the Unicode tables, in the other test files.
import { deburr, kebabCase } from 'es-toolkit';
import { truncate as theirTruncate } from 'es-toolkit/compat';

import { createJudge, fc } from '@yaltaan/testing';

import { slugify, truncate } from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'es-toolkit');

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string): number => Array.from(segmenter.segment(text)).length;
const codePoints = (text: string): number => Array.from(text).length;

type Truncation = readonly [text: string, maxGraphemes: number, omission: string];

const ascii = fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 4 });
const composite = fc.constantFrom(
  '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
  '\u{1F1EB}\u{1F1F7}',
  'e\u0301',
  '\r\n',
  '\u{1F44D}\u{1F3FD}',
);

judge.compare('truncate', {
  input: fc.tuple(
    fc
      .array(fc.oneof({ arbitrary: ascii, weight: 6 }, { arbitrary: composite, weight: 1 }), { maxLength: 6 })
      .map((pieces) => pieces.join('')),
    fc.nat(16),
    fc.constantFrom('\u2026', '...', '', '->'),
  ) as fc.Arbitrary<Truncation>,
  ours: ([text, maxGraphemes, omission]) => truncate(text, { maxGraphemes, omission }),
  theirs: ([text, maxGraphemes, omission]) => theirTruncate(text, { length: maxGraphemes, omission }),
  differences: [
    {
      text: 'an omission longer than the bound is a RangeError; es-toolkit returns the omission',
      applies: ([, maxGraphemes, omission]) => graphemes(omission) > maxGraphemes,
    },
    {
      text:
        'graphemes are counted, so an emoji sequence, a flag or a letter and its accents are kept whole or left ' +
        'out whole; es-toolkit counts code points and cuts them',
      applies: ([text]) => graphemes(text) !== codePoints(text),
    },
  ],
});

// Accented Latin letters, which both decompose, and the letters without a decomposition that both spell out.
const LETTERS =
  '\u00e9\u00e8\u00e0\u00e7\u00f1\u00fc\u00c9\u00c7' +
  '\u00e6\u00c6\u0153\u00df\u00f8\u0142\u0111\u00fe\u00f0\u0127\u0131\u0138\u014b\u0167';

const slugText = fc.string({
  unit: fc.oneof(
    { arbitrary: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), weight: 30 },
    { arbitrary: fc.constantFrom(' ', '-', '_', "'", '.', '/', ', ', ' & '), weight: 8 },
    { arbitrary: fc.constantFrom(...LETTERS), weight: 6 },
    { arbitrary: fc.constantFrom('A', 'Z', '7', '0', 'e\u0301', '\u00ab'), weight: 2 },
    {
      arbitrary: fc.constantFrom(
        '\ufb01',
        '\u00b2',
        '\uff21',
        '\u20d7',
        '\u0140',
        '\u013f',
        '\u0436',
        '\u03b1',
        '\u05e9',
        '\u6f22',
        '\u{1F680}',
        '\u00a9',
      ),
      weight: 1,
    },
  ),
  maxLength: 14,
});

judge.compare('slugify', {
  input: slugText,
  ours: (text) => slugify(text),
  theirs: (text) => kebabCase(deburr(text)),
  differences: [
    {
      text: "ŀ and Ŀ decompose to l and a middle dot, which separates; es-toolkit's deburr maps them to l",
      applies: (text) => /[\u013f\u0140]/.test(text),
    },
    {
      text:
        'compatibility forms are decomposed first (NFKD), so ﬁ is fi and ² is 2, and every mark is removed; ' +
        "es-toolkit's deburr leaves them, and removes only the marks of U+0300–U+036F",
      applies: (text) =>
        text.normalize('NFKD') !== text.normalize('NFD') ||
        /\p{M}/u.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
    },
    {
      text:
        "only ASCII letters and digits are kept, every other character separates; es-toolkit's kebabCase keeps the " +
        'letters and digits of every script',
      applies: (text) => /(?![\x00-\x7f])[\p{L}\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(deburr(text)),
    },
    {
      text:
        'a capital after a small letter, or a letter beside a digit, starts no new word; es-toolkit splits there ' +
        '(camelCase to camel-case, abc123 to abc-123)',
      applies: (text) => /[a-z][A-Z]|[A-Za-z][0-9]|[0-9][A-Za-z]|[A-Z]{2}[a-z]/.test(deburr(text)),
    },
  ],
});
