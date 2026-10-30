# ADR 0026 — Numbers: strict parsing, bounds, tolerance, named rounding, exact bigint conversions

- Date: 2026-10-30
- Status: accepted (design choices delegated by the owner, reported for review)

## Context

ARCHITECTURE.md §7.4 puts in `core/number` a strict `parseNumber` with explicit separators that returns a `Result`, `clamp`, `inRange`, `approxEqual` with explicit tolerances, `round` with named modes, and `number` ↔ `bigint` conversions that are exact or fail; it settles two invariants, no implicit conversion that loses precision, and `parseNumber(format(x))` equal to `x` for the declared formats. Arbitrary-precision decimals stay out (§3). §5.7 allows at most two positional arguments, then an options object, and names a function that returns a `Result` `parse*`.

The nearest implementations are es-toolkit's `clamp`, `inRange` and `round`, the judge of these functions (ADR 0022); es-toolkit has no parser, no tolerance comparison and no bigint conversion. The platform reads numbers with `Number` and `parseFloat`, rounds with `Math.round` and `toFixed`, formats with `Intl.NumberFormat` (whose `roundingMode` and nine named modes are Widely available), and converts with `BigInt` and `Number`.

## Options

1. **Native, or do nothing.** `parseFloat` reads a prefix and `Number` reads too much (below); `Math.round(x * 10 ** d) / 10 ** d` errs in the product and the quotient; `Number(bigint)` rounds without a word. Each project writes its own guard, or none.
2. **es-toolkit's semantics.** `clamp(value, min, max)` and `inRange(value, min, max)` with three positional arguments, against §5.7; `inRange` half-open and throwing an `Error` when `min >= max`; `round` built on the floating-point product, which rounds `1.005` to `1` and `1e21` to `999999999999999900000`; `clamp` with `min` above `max` returns `max` unchecked.
3. **Strict reading and decimal rounding on the shortest decimal, the platform's names.** Kept, with the rules below.

## Measurements

Node 24.21.0, es-toolkit 1.52.0, 2026-10-30:

- `parseFloat('12abc')` → 12, `parseFloat('1,5')` → 1; `Number(' 12 ')` → 12, `Number('')` → 0, `Number('0x10')` → 16, `Number('.5')` → 0.5, `Number('5.')` → 5, `Number('1e400')` → `Infinity`, `Number('1e-400')` → 0, `Number('9007199254740993')` → 9007199254740992.
- `Number(2n ** 53n + 1n)` → 9007199254740992, `Number(2n ** 1024n)` → `Infinity`; `BigInt(1.5)` throws a `RangeError`; `BigInt(-0)` → `0n`.
- `(1.005).toFixed(2)` → `'1.00'`, the exact binary value rounded; `Intl.NumberFormat('en', { maximumFractionDigits: 2 })` writes `'1.01'`, the shortest decimal rounded; es-toolkit's `round(1.005, 2)` → 1, `round(1e21, 2)` → 999999999999999900000.
- On 999 835 random finite numbers, the digits of `toExponential()`, of `String` and of `Intl.NumberFormat(…, { maximumSignificantDigits: 17 })` are the same, and the last reads back to the number: `Intl` at 17 significant digits writes the shortest decimal.
- `Intl.NumberFormat` separators, `formatToParts(-1234567.5)` at 17 significant digits: `,` and `.` (en-US, en-GB, ja-JP), U+202F and `,` (fr-FR), `'` and `,` (fr-CH), `'` and `.` (de-CH), `.` and `,` (de-DE, it-IT, es-ES, pt-BR, nl-NL), U+00A0 and `,` (pl-PL, ru-RU, sv-SE); every minus sign is U+002D but sv-SE's, U+2212; en-IN and hi-IN group by two above the thousands (`12,34,567.5`); ar-EG and fa-IR write other digits.

## Decision

- **`parseNumber(text, { decimal, grouping, exponent, maxLength })`** reads `[sign] integer [decimal fraction] [exponent]`: the sign `-` (U+002D) or `−` (U+2212), no `+`; ASCII digits on both sides of the decimal separator (`'.'` by default); the exponent `e` or `E`, an optional `+` or `-` and digits, accepted unless `exponent: false`, so that `String(x)` reads back for every finite `x`. No whitespace, no prefix, no `Infinity` nor `NaN`. With `grouping` (none by default), the integer part is either ungrouped or grouped by three from the decimal separator, a first group of one to three digits that does not start with 0: a misplaced separator (`1,5` read with `,` as grouping) and a decimal of another locale (`0,123`, which would read 1 000 times too large) are syntax issues, never a guess. `exponent` is a boolean, otherwise a `TypeError`. Each separator is one code unit, neither a digit, a sign nor `e`/`E`, and they differ; otherwise a `RangeError`. The text is untrusted: 1 000 code units at most by default (`number.too_long`), one pass, no regular expression.
- **Precision**: the number read is the nearest to the text (`Number` on the text without its separators). The text is refused when it says more than that number keeps: `number.out_of_range` when it is beyond the largest finite number, or not zero and nearer to zero than the smallest, and `number.inexact` when the text lies more than half a unit of its last significant digit (leading and trailing zeros apart) from the exact value of the number: `9007199254740993` and `0.10000000000000000001` are refused, `0.1`, `12345678901234567000`, every shortest decimal and every exact expansion are read. A text exactly halfway between two decimals of its length names the number either way (`1.0000009536743164062` and `…063` both read 1 + 2^-20). `toPrecision` decides the common case; a tie, or a text of more than the 100 digits it writes, is decided in exact `bigint` arithmetic.
- **Declared formats**, whose round trip the tests check: `String(x)` read with the defaults (which writes `-0` as `0`), and `Intl.NumberFormat(locale, { maximumSignificantDigits: 17 })` read with the separators of its `formatToParts`, with or without grouping, for the Latin-digit locales that group by three. The grouping of en-IN and other digits are a ticket, not a refusal written here.
- **`clamp(value, { min, max })`** and **`inRange(value, { min, max, exclusive })`**: either bound may be left out; a bound that is `NaN` or a `min` above `max` is a `RangeError`, a `value` that is not a number a `TypeError`. The range is closed unless `exclusive` names `'min'`, `'max'` or `'both'`. `clamp` returns `value` itself when it is within the bounds (so `-0` stays `-0`), the bound it crosses otherwise, and `NaN` for `NaN`; so `inRange(clamp(x, b), b)` holds for every `x` but `NaN`.
- **`approxEqual(a, b, { absolute, relative })`**: at least one tolerance, each non-negative (`TypeError` and `RangeError` otherwise), no default, since a default absolute tolerance is wrong at every scale but one. Equal numbers are approximately equal (`-0` and `0`, an infinity and itself); `NaN` is equal to nothing; otherwise `|a − b| ≤ max(absolute, relative × max(|a|, |b|))`, as Python's `math.isclose` decides, with an infinity equal only to itself. `relative` is at most 1: above, it means nothing, and `relative × max` could overflow to a false `true` (`1.7e308` and `-1.7e308` within 1.1).
- **`round(value, { digits, mode })`** rounds the shortest decimal of `value` (the one `String` writes) to `digits` fractional digits (0 by default, negative for tens, hundreds…), then reads the nearest number back: `1.005` rounds to `1.01` and `0.15` to `0.2` half to even, as `Intl.NumberFormat` rounds. `mode` is required, one of the nine names of `Intl.NumberFormat`'s `roundingMode`: `ceil`, `floor`, `expand`, `trunc`, `halfCeil`, `halfFloor`, `halfExpand`, `halfTrunc`, `halfEven`. `NaN`, the infinities and zeros come back as they are; a negative value rounded to zero gives `-0`, as `Math.round` and `Intl` give. `digits` is a safe integer; a result past the largest finite number is a `RangeError`, never an infinity: only a `digits` the caller chose at −308 or below reaches it, so it is treated as a wrong argument, not as an expected failure that would make every call return a `Result`.
- **`bigIntToNumber(value)`** returns the number that equals `value` exactly, or `number.out_of_range` (beyond the largest finite number) or `number.inexact` (between two numbers); **`numberToBigInt(value)`** returns the `bigint` of an integer, `-0` giving `0n`, or `number.not_integer` for a fraction, `NaN` or an infinity. Both return a `Result`: the failure depends on the data.
- **Issues**: `number.syntax` (`index`, the code unit where the grammar breaks), `number.too_long` (`length`, `maximum`), `number.out_of_range`, `number.inexact` (`digits`, the significant digits of the text or of the `bigint`), `number.not_integer`; empty path.
- **Not here**: formatting (`Intl.NumberFormat`), decimals of arbitrary precision, locale resolution (a recipe reads the separators from `formatToParts`), integers parsed straight to `bigint`.

## Review

A contradictor, given the question and the code without this record, checked the module: `round` against `Intl.NumberFormat` on 200 000 inputs, 0 differences; time linear from 10 000 to 80 000 code units. It found five defects, fixed before the record was accepted: the overflow of `approxEqual` with `relative` above 1, the lower of two halfway texts refused, `0,123` read as 123, `exponent` read by truthiness, a text of more than 100 exact digits refused; and three hand mutations that no test caught, now caught. It holds `round`'s `RangeError` on overflow for a judgement call; kept, as written above. Measured cost, one noisy run: `round` about 474 ns against 20 ns for `Math.round(x * 100) / 100`, `parseNumber` of a 17-digit text about 731 ns against 43 ns for `Number`, `clamp`, `inRange` and `approxEqual` 18 to 21 ns.

## Consequences

- A form field read by `parseNumber` refuses `12abc`, ` 12`, an empty text and a misplaced group separator, and says where; an identifier of 17 digits is refused instead of being rounded.
- `round` and `Intl.NumberFormat` give the same decimal for the same mode; `toFixed` may differ, since it rounds the binary value.
- Unlike es-toolkit, bounds are named, `inRange` is closed by default, `min` equal to `max` is an empty or a one-point range instead of an error, `-0` within the bounds stays `-0`, and `round` is never off by a floating-point product.
- A rounded value is the nearest number to a decimal, not that decimal: the module rounds for display and comparison, a dedicated library computes money.

## Review condition

A need, measured in the pilot, for grouping by two (en-IN) or for other digits; a native strict number parser or decimal type reaching Widely available; an engine whose `toExponential()` does not write the shortest decimal.
