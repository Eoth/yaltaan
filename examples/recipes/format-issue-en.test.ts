import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { fromStandardIssue, toStandardIssue } from '@yaltaan/core/issue';
import { parsePath } from '@yaltaan/core/path';

import { liveCodes, REGISTRY_DIR } from '../../scripts/check-issue-codes.ts';
import { repositoryRoot } from '../../scripts/lib/workspace.ts';
import { formatIssueEn, formattedCodes } from './format-issue-en.ts';

test('the recipe has a message for every live code of every registry', () => {
  const registries = fs.readdirSync(path.join(repositoryRoot, REGISTRY_DIR)).filter((file) => file.endsWith('.md'));
  assert.ok(registries.length > 0);
  for (const file of registries) {
    for (const code of liveCodes(path.basename(file, '.md'))) {
      assert.ok(formattedCodes.includes(code), `${file}: no message for ${code}`);
    }
  }
});

test('the recipe builds a message from the parameters', () => {
  const read = parsePath('items[3]name');
  assert.ok(!read.ok);
  assert.equal(formatIssueEn(read.error), 'This path cannot be read at character 8.');
  assert.equal(formatIssueEn(fromStandardIssue({ message: 'Too short' })), 'Too short');
});

test('an unknown code, an inherited name included, gets the generic message', () => {
  for (const code of ['shop.out_of_stock', 'toString', '__proto__', 'constructor']) {
    assert.equal(formatIssueEn({ code, path: [] }), 'This value is not valid.', code);
  }
});

test('the recipe is a formatter the Standard Schema boundary accepts', () => {
  const standard = toStandardIssue(
    { code: 'path.too_deep', path: ['a'], params: { maximum: 64 } },
    {
      format: formatIssueEn,
    },
  );
  assert.deepEqual(standard, { message: 'This path is too deep: at most 64 steps.', path: ['a'] });
});
