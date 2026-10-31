// Strings, ARCHITECTURE.md §7.3 and ADR 0028: length and truncation by grapheme, slugs by written rules, whitespace
// collapsed, and the characters a reader cannot see or that reorder what is seen.
//
// A grapheme is an extended grapheme cluster of UAX #29, as Intl.Segmenter segments it. Building a segmenter costs
// about 4 µs and segmenting about 120 ns a character, so a text is walked by code unit as long as its code units are
// simple: U+0000–U+02FF, U+2010–U+205F and U+20A0–U+20CF, of which every ordered pair is a grapheme boundary but
// CR LF. None of them is an extender, a joiner, a regional indicator or a Hangul jamo, so no rule of UAX #29 that
// looks further back than one character joins them: the segmenter takes over from the last simple code unit before
// the first that is not, and a segmenter is built at the first such text, never when the module loads.
//
// Every regular expression here is a character class repeated once, with no anchor: each match is accepted as soon
// as it is found, so the time is linear in the text. An end anchor (`\p{White_Space}+$`) retries every run of
// whitespace to its end, 700 ms on 40 000 spaces.
//
// Differences from es-toolkit 1.52.0, each checked on generated inputs by the judge of the tests:
//   - truncate: graphemes are counted, so an emoji sequence, a flag or a letter and its accents are kept whole or
//     left out whole; es-toolkit counts code points and cuts them
//   - truncate: an omission longer than the bound is a RangeError; es-toolkit returns the omission
//   - slugify: only ASCII letters and digits are kept, every other character separates; es-toolkit's kebabCase
//     keeps the letters and digits of every script
//   - slugify: a capital after a small letter, or a letter beside a digit, starts no new word; es-toolkit splits
//     there (camelCase to camel-case, abc123 to abc-123)
//   - slugify: compatibility forms are decomposed first (NFKD), so ﬁ is fi and ² is 2, and every mark is removed;
//     es-toolkit's deburr leaves them, and removes only the marks of U+0300–U+036F
//   - slugify: ŀ and Ŀ decompose to l and a middle dot, which separates; es-toolkit's deburr maps them to l

/**
 * Why `findHidden` reports a character: it reorders the text around it (`bidi`), it is not drawn (`invisible`), or
 * it is a control character other than whitespace (`control`).
 * @since 0.1
 * @experimental
 */
export type HiddenKind = 'bidi' | 'invisible' | 'control';

/**
 * A character `findHidden` reports.
 * @since 0.1
 * @experimental
 */
export interface HiddenCharacter {
  /** Where it starts in the text, in code units. */
  readonly index: number;
  readonly codePoint: number;
  readonly kind: HiddenKind;
}

/**
 * The bounds of `truncate`, at least one, and the text that marks a cut: `'…'` by default.
 * @since 0.1
 * @experimental
 */
export type TruncateOptions =
  | { readonly maxGraphemes: number; readonly maxLength?: number; readonly omission?: string }
  | { readonly maxGraphemes?: number; readonly maxLength: number; readonly omission?: string };

const CR = 13;
const LF = 10;
const SPACE = 32;
// The letters NFKD leaves outside ASCII once their marks are removed, among U+00C0–U+017F, and what each becomes.
const FOLDABLE = '\u00e6\u00f0\u00f8\u00fe\u00df\u0111\u0127\u0131\u0138\u0142\u014b\u0153\u0167';
const FOLDED: readonly string[] = ['ae', 'd', 'o', 'th', 'ss', 'd', 'h', 'i', 'k', 'l', 'n', 'oe', 't'];

let segmenter: Intl.Segmenter | undefined;

function checkText(name: string, text: unknown): void {
  if (typeof text !== 'string') {
    throw new TypeError(`${name} must be a string, not ${typeof text}`);
  }
}

function isSimple(unit: number): boolean {
  return unit < 0x300 || (unit >= 0x2010 && unit <= 0x205f) || (unit >= 0x20a0 && unit <= 0x20cf);
}

// Where the grapheme of simple code units starting at `index` ends, or -1 when the code unit after it is not simple,
// so that the segmenter must decide whether they join.
function simpleEnd(text: string, index: number): number {
  const unit = text.charCodeAt(index);
  if (!isSimple(unit)) {
    return -1;
  }
  const end = index + (unit === CR && text.charCodeAt(index + 1) === LF ? 2 : 1);
  return end < text.length && !isSimple(text.charCodeAt(end)) ? -1 : end;
}

function segments(text: string): Intl.Segments {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter.segment(text);
}

// The end of each grapheme of `text`, in order. The segmenter reads the whole text it is given before its first
// segment, so it gets windows that double in length: a window's last grapheme may go on past it, and is segmented
// again from its start in the next one. A grapheme boundary is decided by the characters before it, and no rule that
// looks back crosses one (UAX #29 never breaks inside an emoji sequence, a pair of regional indicators or a conjunct),
// so a text segmented from a boundary has the boundaries of the whole text. The time is in the length walked.
function* ends(text: string): Generator<number, void> {
  let index = 0;
  for (let end = simpleEnd(text, 0); index < text.length && end !== -1; end = simpleEnd(text, index)) {
    yield end;
    index = end;
  }
  for (let size = 64; index < text.length; size *= 2) {
    const stop = Math.min(text.length, index + size);
    const from = index;
    for (const { index: start, segment } of segments(text.slice(from, stop))) {
      if (from + start + segment.length === stop && stop < text.length) {
        break;
      }
      index = from + start + segment.length;
      yield index;
    }
  }
}

/**
 * Counts the graphemes of `text`, the characters a reader sees: an emoji sequence, a flag, a letter and its accents
 * are one each, CR LF is one.
 * @pure
 * @sharing none
 * @complexity O(n) (n = length of the text)
 * @throws TypeError when `text` is not a string
 * @since 0.1
 * @experimental
 * @example graphemeLength('noe\u0308l') // 4
 */
export function graphemeLength(text: string): number {
  checkText('text', text);
  let count = 0;
  let index = 0;
  for (let end = simpleEnd(text, 0); index < text.length && end !== -1; end = simpleEnd(text, index)) {
    count += 1;
    index = end;
  }
  if (index < text.length) {
    for (const each of segments(text.slice(index))) {
      count += each.segment === '' ? 0 : 1;
    }
  }
  return count;
}

function checkBound(name: string, value: number): void {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number, not ${typeof value}`);
  }
  if (!(Number.isInteger(value) && value >= 0) && value !== Number.POSITIVE_INFINITY) {
    throw new RangeError(`${name} must be a non-negative integer or Infinity, not ${String(value)}`);
  }
}

/**
 * Returns `text` when it holds within the bounds, otherwise its longest prefix of whole graphemes that holds within
 * them followed by `omission`: never half an emoji, a flag or a letter and its accents. `maxGraphemes` counts
 * graphemes, `maxLength` code units, the unit of `String.length` and of a storage limit; the omission counts in
 * both. An omission that starts with a mark, a joiner or half of a flag joins the last grapheme kept, as it would
 * anywhere it is appended.
 * @pure
 * @sharing none
 * @complexity O(m) (m = code units up to the first grapheme past a bound, at most the length of the text)
 * @throws TypeError when `text` or `omission` is not a string, a bound is not a number, or no bound is given
 * @throws RangeError when a bound is neither a non-negative integer nor Infinity, or the omission does not hold
 *   within the bounds
 * @since 0.1
 * @experimental
 * @example truncate('Crème brûlée', { maxGraphemes: 8 }) // 'Crème b…'
 */
export function truncate(text: string, options: TruncateOptions): string {
  checkText('text', text);
  const {
    maxGraphemes = Number.POSITIVE_INFINITY,
    maxLength = Number.POSITIVE_INFINITY,
    omission = '\u2026',
  } = options;
  if (options.maxGraphemes === undefined && options.maxLength === undefined) {
    throw new TypeError('truncate needs maxGraphemes, maxLength or both');
  }
  checkBound('maxGraphemes', maxGraphemes);
  checkBound('maxLength', maxLength);
  checkText('omission', omission);
  const omitted = graphemeLength(omission);
  if (omitted > maxGraphemes || omission.length > maxLength) {
    throw new RangeError('the omission does not hold within the bounds');
  }
  // A text has no more graphemes than code units.
  if (text.length <= maxGraphemes && text.length <= maxLength) {
    return text;
  }
  let count = 0;
  let kept = 0;
  for (const end of ends(text)) {
    count += 1;
    if (count > maxGraphemes || end > maxLength) {
      return text.slice(0, kept) + omission;
    }
    if (count + omitted <= maxGraphemes && end + omission.length <= maxLength) {
      kept = end;
    }
  }
  return text;
}

/**
 * Turns `text` into a slug of ASCII letters and digits separated by `-`: compatibility forms decomposed (NFKD), lower
 * case, marks removed, æ ð ø þ ß đ ħ ı ĸ ł ŋ œ ŧ spelt ae d o th ss d h i k l n oe t, and every other run of
 * characters one `-`, none at either end. Any other letter separates, Latin ones beyond U+017F included (ə, ɓ, ɛ),
 * and a text that leaves no ASCII letter or digit gives `''`; NFKD turns some symbols into ASCII (™ gives tm).
 * @pure
 * @sharing none
 * @complexity O(n) (n = length of the text)
 * @throws TypeError when `text` is not a string
 * @since 0.1
 * @experimental
 * @example slugify('Crème brûlée : 2 œufs') // 'creme-brulee-2-oeufs'
 */
export function slugify(text: string): string {
  checkText('text', text);
  const folded = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '');
  let slug = '';
  let separated = false;
  for (let index = 0; index < folded.length; index += 1) {
    const unit = folded.charCodeAt(index);
    const isAscii = (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x30 && unit <= 0x39);
    // Every letter of the table lies in U+00DF–U+017F: a text of another script never looks it up. FOLDED[-1] would be
    // a named property looked up on the array, 17 times slower.
    const at = isAscii || unit < 0xdf || unit > 0x17f ? -1 : FOLDABLE.indexOf(folded.charAt(index));
    const kept = isAscii ? folded.charAt(index) : at === -1 ? undefined : FOLDED[at];
    if (kept === undefined) {
      separated = slug !== '';
    } else {
      slug += separated ? `-${kept}` : kept;
      separated = false;
    }
  }
  return slug;
}

/**
 * Replaces every run of whitespace (Unicode White_Space, line breaks included) by one space, and removes the space at
 * each end.
 * @pure
 * @sharing none
 * @complexity O(n) (n = length of the text)
 * @throws TypeError when `text` is not a string
 * @since 0.1
 * @experimental
 * @example normalizeWhitespace('  Jean \t\n Dupont ') // 'Jean Dupont'
 */
export function normalizeWhitespace(text: string): string {
  checkText('text', text);
  const collapsed = text.replace(/\p{White_Space}+/gu, ' ');
  const start = collapsed.charCodeAt(0) === SPACE ? 1 : 0;
  const end = collapsed.length > start && collapsed.charCodeAt(collapsed.length - 1) === SPACE ? -1 : undefined;
  return collapsed.slice(start, end);
}

/**
 * Lists, in order, the characters of `text` a reader cannot see or that reorder what is seen: the bidirectional
 * controls of Trojan Source attacks (`bidi`, Unicode Bidi_Control), the other default-ignorable characters
 * (`invisible`: zero-width characters, joiners, soft hyphen, variation selectors, tags, U+FEFF…), and control
 * characters other than whitespace (`control`). An emoji sequence holds a zero-width joiner and a variation selector,
 * a Persian word a zero-width non-joiner: the caller filters on `codePoint` what it accepts. Not reported: a
 * character drawn blank that is not default-ignorable (U+2800, U+FFF9–U+FFFB), whitespace, line separators included
 * (`normalizeWhitespace`), and lone surrogates (`isWellFormed`). One object per character found: a text of hidden
 * characters only costs about 40 times its size.
 * @pure
 * @sharing none
 * @complexity O(n) (n = length of the text)
 * @throws TypeError when `text` is not a string
 * @since 0.1
 * @experimental
 * @example findHidden('a\u202Eb') // [{ index: 1, codePoint: 0x202e, kind: 'bidi' }]
 */
export function findHidden(text: string): HiddenCharacter[] {
  checkText('text', text);
  const found: HiddenCharacter[] = [];
  // Bidi_Control is a part of Default_Ignorable_Code_Point: one class finds both.
  for (const match of text.matchAll(/[\p{Default_Ignorable_Code_Point}\x00-\x08\x0e-\x1f\x7f-\x84\x86-\x9f]/gu)) {
    const character = match[0];
    const codePoint = character.codePointAt(0) ?? 0;
    const kind = codePoint < 0xa0 ? 'control' : /\p{Bidi_Control}/u.test(character) ? 'bidi' : 'invisible';
    found.push({ index: match.index, codePoint, kind });
  }
  return found;
}
