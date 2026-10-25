// Runs the examples of the documentation a user reads, so that none shows code that no longer compiles, no longer
// runs, or no longer gives the result it claims. Read: every fenced `ts` block of docs/guide/**/*.md and of each
// published packages/*/README.md. Each block is checked by the compiler with the repository's options, as a module of
// its own that imports the packages as an application does (their built output); then it runs. A line that ends in
// `// → <expression>` asserts that what it computes deep-equals the expression:
//   parsePath('a[0]'); // → { ok: true, value: ['a', 0] }
//   const next = mapResult(ok(1), (n) => n + 1); // → { ok: true, value: 2 }
// The guide is written in English and in French (docs/guide/en/, docs/guide/fr/): both hold the same pages, and the
// same code blocks in the same order, comment lines aside, so that a translation never drifts from the code.
//
// Usage: node scripts/check-doc-examples.ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readInternalPackages } from './lib/internal-packages.ts';
import { describeError, repositoryRoot, report } from './lib/workspace.ts';

export const GUIDE_DIR = 'docs/guide';
export const LANGUAGES: readonly string[] = ['en', 'fr'];

export interface CodeBlock {
  /** The document and the line of the opening fence, from the repository root: `docs/guide/en/path.md:12`. */
  readonly where: string;
  /** Line of the block's first code line in its document, 1-based. */
  readonly line: number;
  readonly code: string;
}

/** The fenced `ts` blocks of a Markdown document; `file` names it in each block's location. */
export function extractBlocks(markdown: string, file: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trimEnd() !== '```ts') {
      continue;
    }
    const end = lines.findIndex((line, at) => at > index && line.trimEnd() === '```');
    const stop = end === -1 ? lines.length : end;
    blocks.push({ where: `${file}:${index + 1}`, line: index + 2, code: lines.slice(index + 1, stop).join('\n') });
    index = stop;
  }
  return blocks;
}

const ARROW = /^(\s*)(?:(const|let) ([A-Za-z_$][\w$]*) = )?(.+?);?\s*\/\/ → (.+)$/;
export const EXPECT = '__expectExample';

/**
 * The block as it runs: each `// →` line becomes an assertion that names its document and line. The assertion
 * function is defined on the first line, which the block's own first line follows.
 */
export function toRunnable(block: CodeBlock, file: string): string {
  const lines = block.code.split('\n').map((line, offset) => {
    const match = ARROW.exec(line);
    if (match === null) {
      return line;
    }
    const [, indent = '', keyword, name, expression = '', expected = ''] = match;
    const label = JSON.stringify(`${file}:${block.line + offset}`);
    const declared = keyword === undefined ? '' : `${keyword} ${name} = ${expression}; `;
    const actual = keyword === undefined ? expression : name;
    return `${indent}${declared}${EXPECT}(${actual}, ${expected}, ${label});`;
  });
  // One line, so that the block's lines keep their offset; the message names the line and what it computed.
  const header =
    `import { inspect, isDeepStrictEqual } from 'node:util'; const ${EXPECT} = (actual, expected, where) => { ` +
    'if (!isDeepStrictEqual(actual, expected)) throw new Error(`${where}: gives ${inspect(actual, { depth: 4 })}`); };';
  return [header, ...lines].join('\n');
}

/** Problems of a translated guide: missing or extra pages, and code blocks that differ from the English ones. */
export function checkParity(pages: ReadonlyMap<string, ReadonlyMap<string, string>>): string[] {
  const problems: string[] = [];
  const reference = pages.get('en') ?? new Map<string, string>();
  const codeOf = (markdown: string): string[] =>
    extractBlocks(markdown, '').map((block) =>
      block.code
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n'),
    );
  for (const [language, translated] of pages) {
    if (language === 'en') {
      continue;
    }
    for (const name of reference.keys()) {
      if (!translated.has(name)) {
        problems.push(`${GUIDE_DIR}/${language}/${name} is missing: every English page has its translation`);
      }
    }
    for (const [name, markdown] of translated) {
      const english = reference.get(name);
      if (english === undefined) {
        problems.push(`${GUIDE_DIR}/${language}/${name} has no English page ${GUIDE_DIR}/en/${name}`);
        continue;
      }
      const ours = codeOf(markdown);
      const theirs = codeOf(english);
      if (ours.length !== theirs.length || ours.some((code, index) => code !== theirs[index])) {
        problems.push(
          `${GUIDE_DIR}/${language}/${name}: its code blocks differ from ${GUIDE_DIR}/en/${name} (comment lines aside)`,
        );
      }
    }
  }
  return problems;
}

/** The documents whose examples run, from the repository root, in a stable order. */
export function listDocuments(root: string): string[] {
  const documents: string[] = [];
  const guide = path.join(root, GUIDE_DIR);
  if (fs.existsSync(guide)) {
    for (const file of fs.readdirSync(guide, { recursive: true, encoding: 'utf8' })) {
      if (file.endsWith('.md')) {
        documents.push(`${GUIDE_DIR}/${file.split(path.sep).join('/')}`);
      }
    }
  }
  // The README of an internal package documents test support for this repository, not something a user imports.
  const internal = readInternalPackages(root);
  const packages = path.join(root, 'packages');
  for (const name of fs.existsSync(packages) ? fs.readdirSync(packages) : []) {
    if ((!internal.ok || !internal.names.has(name)) && fs.existsSync(path.join(packages, name, 'README.md'))) {
      documents.push(`packages/${name}/README.md`);
    }
  }
  return documents.sort();
}

function readGuidePages(root: string): Map<string, Map<string, string>> {
  const pages = new Map<string, Map<string, string>>();
  for (const language of LANGUAGES) {
    const folder = path.join(root, GUIDE_DIR, language);
    const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => file.endsWith('.md')) : [];
    pages.set(language, new Map(files.map((file) => [file, fs.readFileSync(path.join(folder, file), 'utf8')])));
  }
  return pages;
}

export interface DocExamplesVerdict {
  readonly problems: readonly string[];
  readonly blocks: number;
  readonly assertions: number;
  readonly documents: number;
}

/** Compiles and runs every example of the documents of `root`, whose packages are built. */
export async function checkDocExamples(root: string): Promise<DocExamplesVerdict> {
  const problems = checkParity(readGuidePages(root));
  const documents = listDocuments(root);
  const blocks = documents.flatMap((file) => extractBlocks(fs.readFileSync(path.join(root, file), 'utf8'), file));
  if (blocks.length === 0) {
    return { problems, blocks: 0, assertions: 0, documents: documents.length };
  }
  // The examples import the packages by name, as an application does: a node_modules of their own links the
  // workspace's scope, outside the repository, so that neither the repository's sources nor its settings leak in.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-doc-examples-'));
  let assertions = 0;
  try {
    fs.mkdirSync(path.join(folder, 'node_modules'));
    fs.writeFileSync(path.join(folder, 'package.json'), '{ "type": "module" }\n');
    fs.symlinkSync(
      path.join(root, 'node_modules', '@yaltaan'),
      path.join(folder, 'node_modules', '@yaltaan'),
      'junction',
    );
    const names = blocks.map((_, index) => `example-${index}.ts`);
    blocks.forEach((block, index) => {
      fs.writeFileSync(path.join(folder, names[index] ?? ''), `${block.code}\n`);
    });
    fs.writeFileSync(
      path.join(folder, 'tsconfig.json'),
      JSON.stringify({
        extends: path.join(root, 'tsconfig.base.json'),
        // An example shows a binding without always using it; each block is a module, never a global script.
        compilerOptions: { noEmit: true, noUnusedLocals: false, moduleDetection: 'force', types: [] },
        files: names,
      }),
    );
    const require = createRequire(path.join(root, 'package.json'));
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], {
      cwd: folder,
      encoding: 'utf8',
    });
    for (const line of `${compiled.stdout}${compiled.stderr}`.split('\n').filter((text) => text.includes('error TS'))) {
      // `example-3.ts(2,7): error TS2322: …` names the block and its line: written back as the document's line.
      const match = /^example-(\d+)\.ts\((\d+),\d+\): (.*)$/.exec(line);
      const block = match === null ? undefined : blocks[Number(match[1])];
      problems.push(
        block === undefined || match === null
          ? line
          : `${block.where.replace(/:\d+$/, '')}:${block.line + Number(match[2]) - 1}: ${match[3]}`,
      );
    }
    if (compiled.status !== 0 && problems.length === 0) {
      problems.push(`the compiler exited with ${String(compiled.status)}: ${compiled.stderr.trim()}`);
    }
    for (const [index, block] of blocks.entries()) {
      const file = block.where.replace(/:\d+$/, '');
      const runnable = toRunnable(block, file);
      assertions += block.code.split('\n').filter((line) => ARROW.test(line)).length;
      const target = path.join(folder, `run-${index}.ts`);
      fs.writeFileSync(target, `${runnable}\n`);
      try {
        await import(pathToFileURL(target).href);
      } catch (error) {
        problems.push(`${block.where}: the example fails: ${describeError(error).split('\n')[0] ?? ''}`);
      }
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  return { problems, blocks: blocks.length, assertions, documents: documents.length };
}

if (import.meta.main) {
  const verdict = await checkDocExamples(repositoryRoot);
  const counts = `${verdict.blocks} example(s) of ${verdict.documents} document(s)`;
  report(
    verdict.problems,
    `${counts} compile and run; ${verdict.assertions} result(s) asserted; the guide in each language matches.`,
  );
}
