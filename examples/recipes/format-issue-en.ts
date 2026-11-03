// A minimal English formatter for the issues of Yaltaan: copy it into the application and change the words, or write
// one per language. The library writes no message itself: the words, the language and the tone belong to the
// application. Its test fails when a registry of docs/issue-codes/ lists a code this table has no message for.
import type { Issue, IssueFormatter } from '@yaltaan/core/issue';

type Params = Readonly<Record<string, unknown>>;

const EXPECTED: Readonly<Record<string, string>> = {
  string: 'text',
  number: 'a number',
  array: 'a list',
  object: 'a group of fields',
};

// One function per code. An own-property lookup (Object.hasOwn) keeps a code such as `toString` or `__proto__`
// from reaching a function of Object.prototype.
const MESSAGES: Readonly<Record<string, (params: Params) => string>> = {
  'path.syntax': (params) => `This path cannot be read at character ${String(params['index'])}.`,
  'path.too_long': (params) => `This path is too long: at most ${String(params['maximum'])} characters.`,
  'path.too_deep': (params) => `This path is too deep: at most ${String(params['maximum'])} steps.`,
  'path.not_textual': () => 'This path cannot be written as text.',
  'path.forbidden_segment': (params) => `"${String(params['segment'])}" cannot be written to.`,
  'path.missing': (params) => `Nothing is there, from step ${String(params['index'])} of this path on.`,
  'path.not_traversable': (params) =>
    `Step ${String(params['index'])} of this path leads through a value it cannot enter.`,
  'collection.duplicate_key': (params) =>
    `This item repeats the key of item ${String(params['first'])}: each key may appear only once.`,
  'number.syntax': (params) => `This is not a number: it cannot be read at character ${String(params['index'])}.`,
  'number.too_long': (params) => `This number is too long: at most ${String(params['maximum'])} characters.`,
  'number.out_of_range': () => 'This number is too large or too small.',
  'number.inexact': (params) =>
    `This number has ${String(params['digits'])} significant digits, more than can be kept: shorten it.`,
  'number.not_integer': () => 'This must be a whole number.',
  'schema.invalid_type': (params) => `This must be ${EXPECTED[String(params['expected'])] ?? 'something else'}.`,
  'schema.invalid_value': () => 'This value is not one of the choices.',
  'schema.missing': () => 'This is required.',
  'schema.unknown_key': () => 'This field is not expected.',
  'schema.too_short': (params) => `This is too short: at least ${String(params['minimum'])} characters.`,
  'schema.too_long': (params) => `This is too long: at most ${String(params['maximum'])} characters.`,
  'schema.too_small': (params) => `This is too small: at least ${String(params['minimum'])}.`,
  'schema.too_large': (params) => `This is too large: at most ${String(params['maximum'])}.`,
  'schema.not_integer': () => 'This must be a whole number.',
  'schema.invalid_format': () => 'This does not have the expected format.',
  'schema.too_many_issues': () => 'This has too many errors to list them all.',
  'temporal.inverted_interval': () => 'The end comes before the start.',
  'temporal.too_large': (params) => `This is too many: at most ${String(params['maximum'])}.`,
  'temporal.ambiguous_format': () => 'This date can be read in several ways: use the expected format.',
  'temporal.invalid_format': () => 'The expected format of this date is not valid.',
  'temporal.format_mismatch': () => 'This does not follow the expected format.',
  'temporal.too_long': (params) => `This is too long: at most ${String(params['maximum'])} characters.`,
  'temporal.invalid_date': () => 'This date does not exist.',
  'temporal.invalid_time_zone': () => 'This time zone is not known.',
  'temporal.invalid_calendar': () => 'This calendar is not known.',
  'temporal.nonexistent_time': () => 'This time does not exist on that day: the clocks jump over it.',
  'temporal.ambiguous_time': () => 'This time happens twice on that day: the clocks go back over it.',
  'temporal.out_of_range': () => 'This date is too far away.',
  'temporal.no_business_day': () => 'No day of the week is a working day.',
  'rules.required_if': () => 'This is required.',
  'rules.all_or_none': () => 'This goes with the fields around it: fill it in too, or empty them.',
  'rules.at_least': (params) =>
    `At least ${String(params['minimum'])} needed here, and only ${String(params['count'])} given.`,
  'rules.exactly': (params) =>
    `Exactly ${String(params['expected'])} needed here, and ${String(params['count'])} given.`,
  'rules.mutually_exclusive': () => 'Give this or the field beside it, not both.',
  'rules.unique': () => 'This value is already used in this list.',
  'rules.ordered': () => 'This comes before the value it must follow.',
  'rules.too_large': (params) => `This list is too long: at most ${String(params['maximum'])} items.`,
  'rules.too_many_issues': () => 'This has too many errors to list them all.',
  'issue.external': (params) => String(params['message']),
};

/** The message of an issue in English; a code this table does not know gets a generic message, never an error. */
export const formatIssueEn: IssueFormatter = (issue: Issue): string => {
  const message = Object.hasOwn(MESSAGES, issue.code) ? MESSAGES[issue.code] : undefined;
  return message === undefined ? 'This value is not valid.' : message(issue.params ?? {});
};

/** The codes this formatter has a message for, for its test. */
export const formattedCodes: readonly string[] = Object.keys(MESSAGES);
