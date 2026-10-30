// A minimal English formatter for the issues of Yaltaan: copy it into the application and change the words, or write
// one per language. The library writes no message itself: the words, the language and the tone belong to the
// application. Its test fails when a registry of docs/issue-codes/ lists a code this table has no message for.
import type { Issue, IssueFormatter } from '@yaltaan/core/issue';

type Params = Readonly<Record<string, unknown>>;

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
  'issue.external': (params) => String(params['message']),
};

/** The message of an issue in English; a code this table does not know gets a generic message, never an error. */
export const formatIssueEn: IssueFormatter = (issue: Issue): string => {
  const message = Object.hasOwn(MESSAGES, issue.code) ? MESSAGES[issue.code] : undefined;
  return message === undefined ? 'This value is not valid.' : message(issue.params ?? {});
};

/** The codes this formatter has a message for, for its test. */
export const formattedCodes: readonly string[] = Object.keys(MESSAGES);
