import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkDocExamples, checkParity, extractBlocks, toRunnable } from '../check-doc-examples.ts';
import { repositoryRoot } from '../lib/workspace.ts';

const FENCE = '```';

test('only ts blocks are read, with the line of their first code line', () => {
  const markdown = ['# Title', '', `${FENCE}ts`, 'const a = 1;', FENCE, '', `${FENCE}text`, 'not code', FENCE].join(
    '\n',
  );
  assert.deepEqual(extractBlocks(markdown, 'a.md'), [{ where: 'a.md:3', line: 4, code: 'const a = 1;' }]);
});

test('an arrow comment becomes an assertion, a declaration keeps its binding', () => {
  const block = { where: 'a.md:1', line: 2, code: 'f(1); // → 2\nconst b = g(); // → { ok: true }\nh(); // a remark' };
  const lines = toRunnable(block, 'a.md').split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '__expectExample(f(1), 2, "a.md:2");');
  assert.equal(lines[2], 'const b = g(); __expectExample(b, { ok: true }, "a.md:3");');
  assert.equal(lines[3], 'h(); // a remark');
});

test('a translation holds the same pages and the same code, comment lines aside', () => {
  const en = `# Result\n\n${FENCE}ts\n// Builds a success.\nok(1); // → 1\n${FENCE}\n`;
  const fr = `# Result\n\n${FENCE}ts\n// Construit un succès.\nok(1); // → 1\n${FENCE}\n`;
  assert.deepEqual(
    checkParity(
      new Map([
        ['en', new Map([['result.md', en]])],
        ['fr', new Map([['result.md', fr]])],
      ]),
    ),
    [],
  );
  const drifted = fr.replace('ok(1)', 'ok(2)');
  const problems = checkParity(
    new Map([
      [
        'en',
        new Map([
          ['result.md', en],
          ['path.md', en],
        ]),
      ],
      [
        'fr',
        new Map([
          ['result.md', drifted],
          ['extra.md', en],
        ]),
      ],
    ]),
  );
  assert.equal(problems.length, 3, problems.join('\n'));
});

// A repository with a guide page per case, sharing the real repository's dependencies and built packages.
async function verdictOf(pages: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-doc-test-'));
  try {
    fs.copyFileSync(path.join(repositoryRoot, 'tsconfig.base.json'), path.join(root, 'tsconfig.base.json'));
    fs.writeFileSync(path.join(root, 'package.json'), '{ "private": true }\n');
    fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    for (const language of ['en', 'fr']) {
      fs.mkdirSync(path.join(root, 'docs', 'guide', language), { recursive: true });
      for (const [name, code] of Object.entries(pages)) {
        fs.writeFileSync(path.join(root, 'docs', 'guide', language, name), `# Page\n\n${FENCE}ts\n${code}\n${FENCE}\n`);
      }
    }
    return (await checkDocExamples(root)).problems;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('an example that compiles, runs and gives what it claims passes; any other fails at its line', async () => {
  const ok = "import { ok } from '@yaltaan/core/result';\nok(1); // → { ok: true, value: 1 }";
  assert.deepEqual(await verdictOf({ 'a.md': ok }), []);
  const wrong = await verdictOf({ 'a.md': ok.replace('value: 1', 'value: 2') });
  assert.equal(wrong.length, 2, wrong.join('\n'));
  assert.match(wrong[0] ?? '', /docs\/guide\/en\/a\.md:3: the example fails: docs\/guide\/en\/a\.md:5: gives/);
  const untyped = await verdictOf({ 'a.md': "import { ok } from '@yaltaan/core/result';\nconst n: string = ok(1);" });
  assert.ok(
    untyped.some((problem) => /docs\/guide\/en\/a\.md:5: error TS2322/.test(problem)),
    untyped.join('\n'),
  );
  const throwing = await verdictOf({ 'a.md': "throw new Error('broken');" });
  assert.match(throwing.join('\n'), /the example fails: broken/);
});
