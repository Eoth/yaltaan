// `parsePath` against `toPath` of es-toolkit's compat entry, the reader of lodash's path texts, on generated texts
// (see the judge in @yaltaan/testing). Segments are compared as strings, which is how es-toolkit gives every one of
// them, index or key. Half the texts are written by `formatPath` from generated paths, so that most are in the
// grammar; the other half are drawn from the characters the grammar gives a meaning to. `formatPath` and
// `checkWritablePath` have no equivalent there.
import { toPath } from 'es-toolkit/compat';

import { createJudge, fc } from '@yaltaan/testing';

import { formatPath, parsePath } from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'es-toolkit');

const UNITS = ['a', 'b', '_', '$', '0', '1', '9', '.', '[', ']', '"', '\\', 'n', 'u', ' ', 'é', '\u0001'];
const unit = fc.constantFrom(...UNITS);
const segment = fc.oneof(fc.string({ unit, maxLength: 4 }), fc.nat({ max: 20 }), fc.maxSafeNat());
const formatted = fc.array(segment, { maxLength: 4 }).map((path) => {
  const text = formatPath(path);
  if (!text.ok) {
    throw new Error(`a path of strings and indexes has a text form: ${String(path)}`);
  }
  return text.value;
});
const texts = fc.oneof(formatted, fc.string({ unit, maxLength: 12 }));

const REFUSED = 'a text outside the grammar is an issue; es-toolkit reads every text, as lodash does';

const ESCAPES =
  'a quoted key is a JSON string, whose escapes (`\\n`, `\\u0041`) are decoded; es-toolkit only drops their backslash';

judge.compare('parsePath', {
  input: texts,
  ours: (text) => {
    const path = parsePath(text);
    return path.ok ? path.value.map(String) : path.error.code;
  },
  theirs: (text) => toPath(text),
  differences: [
    { text: REFUSED, applies: (text) => !parsePath(text).ok },
    { text: ESCAPES, applies: (text) => /\\[bfnrtu]/.test(text.replaceAll('\\\\', '')) },
  ],
});
