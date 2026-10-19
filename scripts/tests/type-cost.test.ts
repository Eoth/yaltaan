import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { repositoryRoot } from '../lib/workspace.ts';
import {
  CEILING_FILE,
  MODEL_FILE,
  USAGE_DIR,
  checkCeilings,
  describeChanges,
  findCompilers,
  formatBaseline,
  judgeCheckTime,
  parseBaseline,
  parseCeilings,
  parseDiagnostics,
  runTypeCost,
  type CountRow,
} from '../type-cost.ts';

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const CEILING_HEADER = '# ceilings\nusage\tcompiler\tinstantiations\tbasis\n';

/** A fixture root holding the repository's shared model and the given files. */
function fixtureRoot(files: Readonly<Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-type-cost-'));
  temporaryRoots.push(root);
  const all = { [MODEL_FILE]: fs.readFileSync(path.join(repositoryRoot, MODEL_FILE), 'utf8'), ...files };
  for (const [relative, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

// A type of paths through a model, recursive to the depth given: the shape of `Path<T>`.
function pathsUsage(prefix: string, depth: number | undefined): string {
  const bounded = depth !== undefined;
  const recurse = (type: string): string => `${prefix}Paths<${type}${bounded ? `, ${prefix}Prev[D]` : ''}>`;
  return [
    "import type { Model } from '../model.ts';",
    '',
    `type ${prefix}Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];`,
    `type ${prefix}Paths<T${bounded ? `, D extends number = ${depth}` : ''}> = ` +
      `${bounded ? '[D] extends [never] ? never : ' : ''}` +
      `T extends readonly (infer E)[] ? \`\${number}\` | \`\${number}.\${${recurse('E')}}\` : T extends object ` +
      `? { [K in keyof T & string]-?: K | \`\${K}.\${${recurse('NonNullable<T[K]>')}}\` }[keyof T & string] : never;`,
    `export const ${prefix.toLowerCase()}: readonly ${prefix}Paths<Model>[] = ` +
      "['customer.address.city', 'lines.0.sku'];",
    '',
  ].join('\n');
}

test('the figures of an --extendedDiagnostics output are read from both compilers', () => {
  const ts7 = 'Files:             2076\nInstantiations: 1779120\nMemory used:    315145K\nCheck time:     0.419s\n';
  const ts6 =
    'Instantiations:            1596054\nMemory used:               595425K\nCheck time:                  2.49s\n';
  assert.deepEqual(parseDiagnostics(ts7), { instantiations: 1779120, checkTime: 0.419, memory: 315145 });
  assert.deepEqual(parseDiagnostics(ts6), { instantiations: 1596054, checkTime: 2.49, memory: 595425 });
  assert.equal(parseDiagnostics('Instantiations: 12\nCheck time: 0.1s\n'), undefined);
});

test('check time fails over the budget only when the difference also exceeds the spread of the passes', () => {
  const slower = judgeCheckTime([1.0, 1.01, 1.02], [1.2, 1.21, 1.22]);
  assert.equal(slower.ok, false);
  assert.ok(Math.abs(slower.ratio - 0.198) < 0.001);
  assert.deepEqual(slower.without, { median: 1.01, min: 1.0, max: 1.02 });
  assert.equal(judgeCheckTime([0.8, 1.0, 1.3], [1.2, 1.21, 1.22]).ok, true, 'within the spread: noise');
  assert.equal(judgeCheckTime([1.0, 1.0], [1.05, 1.05]).ok, true, 'within the budget');
  assert.equal(judgeCheckTime([1.0, 1.0, 1.0, 1.0], [1.0, 1.2, 1.3, 9]).with.median, 1.25);
});

test('the baseline is written in a fixed order, read back, and compared row by row', () => {
  const rows: CountRow[] = [
    { subject: 'reference', compiler: 'ts7', options: 'exact', instantiations: 100 },
    { subject: 'reference', compiler: 'ts6', options: 'loose', instantiations: 90 },
  ];
  const text = formatBaseline(rows);
  assert.ok(
    text.endsWith(
      'subject\tcompiler\toptions\tinstantiations\nreference\tts7\texact\t100\nreference\tts6\tloose\t90\n',
    ),
  );
  const recorded = parseBaseline(text);
  assert.deepEqual(
    [...recorded],
    [
      ['reference ts7 exact', 100],
      ['reference ts6 loose', 90],
    ],
  );
  assert.deepEqual(describeChanges(recorded, rows), []);
  const moved = [
    { ...rows[0]!, instantiations: 120 },
    { ...rows[1]!, subject: 'fixture' },
  ];
  assert.deepEqual(describeChanges(recorded, moved), [
    'reference ts7 exact: 100 -> 120 (+20)',
    'fixture ts6 loose: new, 90 instantiations',
    'reference ts6 loose: removed',
  ]);
});

test('ceilings are one per usage and compiler, with a basis', () => {
  const parsed = parseCeilings(`${CEILING_HEADER}path\tts7\t5000\tmeasured\npath\tts6\t4800\tmeasured\n`);
  assert.deepEqual(parsed, {
    ceilings: new Map([
      ['path ts7', 5000],
      ['path ts6', 4800],
    ]),
    problems: [],
  });
  for (const line of ['path\tts5\t1\tx', 'path\tts7\t0\tx', 'path\tts7\t10', 'path\tts7\t10\tx\textra']) {
    assert.equal(parseCeilings(`${CEILING_HEADER}${line}\n`).problems.length, 1, line);
  }
  const twice = parseCeilings(`${CEILING_HEADER}path\tts7\t1\tx\npath\tts7\t2\tx\n`);
  assert.deepEqual(twice.problems, [`${CEILING_FILE}:4: a second ceiling for path ts7`]);
});

test('a usage is judged by what it adds to the fixture, under every compiler and option set', () => {
  const rows: CountRow[] = [];
  for (const compiler of ['ts7', 'ts6'] as const) {
    for (const options of ['exact', 'loose'] as const) {
      rows.push({ subject: 'fixture', compiler, options, instantiations: 100 });
      rows.push({ subject: 'usage/path', compiler, options, instantiations: options === 'loose' ? 700 : 600 });
    }
  }
  const ceilings = new Map([
    ['path ts7', 600],
    ['path ts6', 500],
    ['schema ts7', 10],
  ]);
  const verdict = checkCeilings(ceilings, ['path'], rows);
  assert.deepEqual(verdict.problems, ['usage path adds 600 instantiations under ts6 (loose), over its ceiling of 500']);
  assert.deepEqual(verdict.awaiting, ['schema']);
  assert.deepEqual(checkCeilings(new Map(), ['path'], rows).problems, [
    `usage path has no ceiling under ts7 in ${CEILING_FILE}`,
    `usage path has no ceiling under ts6 in ${CEILING_FILE}`,
  ]);
});

test('the two compilers are TypeScript 7 and 6.0, found from the repository', () => {
  const compilers = findCompilers();
  assert.deepEqual(
    compilers.map((compiler) => [compiler.name, compiler.version.split('.')[0]]),
    [
      ['ts7', '7'],
      ['ts6', '6'],
    ],
  );
});

test('too deep a recursion fails its ceiling, an unbounded one fails the check, under both compilers', () => {
  const root = fixtureRoot({
    [`${USAGE_DIR}/bounded.ts`]: pathsUsage('Bounded', 4),
    [`${USAGE_DIR}/deep.ts`]: pathsUsage('Deep', 9),
    [`${USAGE_DIR}/unbounded.ts`]: pathsUsage('Unbounded', undefined),
    [CEILING_FILE]: `${CEILING_HEADER}${['bounded', 'deep', 'unbounded']
      .flatMap((usage) => ['ts7', 'ts6'].map((compiler) => `${usage}\t${compiler}\t6000\ttest`))
      .join('\n')}\n`,
  });
  const report = runTypeCost(root, { referenceFiles: 10, fixtureFiles: 3, passes: 1 });
  const problems = report.problems.join('\n');
  for (const compiler of ['ts7', 'ts6']) {
    for (const options of ['exact', 'loose']) {
      assert.match(
        problems,
        new RegExp(
          `usage deep adds [0-9]+ instantiations under ${compiler} \\(${options}\\), over its ceiling of 6000`,
        ),
      );
      assert.match(
        problems,
        new RegExp(
          `usage/unbounded under ${compiler} [0-9.]+ \\(${options}\\): the compiler exited with [12]: ` +
            'm0\\.ts\\([0-9]+,[0-9]+\\): error TS2615',
        ),
      );
    }
  }
  assert.ok(!problems.includes('usage bounded adds'), problems);
  assert.match(problems, /docs\/type-cost-baseline\.tsv differs from this measurement/);
  assert.ok(
    report.changes.includes(
      'usage/bounded ts6 loose: new, ' +
        String(
          report.rows.find(
            (row) => row.subject === 'usage/bounded' && row.compiler === 'ts6' && row.options === 'loose',
          )?.instantiations,
        ) +
        ' instantiations',
    ),
  );
  assert.equal(report.written, false);
  assert.ok(!fs.existsSync(path.join(root, 'node_modules', '.cache', 'yaltaan-type-cost')), 'the projects are removed');
});

test('two runs count the same instantiations: the first records them, the second finds nothing changed', () => {
  const root = fixtureRoot({ [CEILING_FILE]: CEILING_HEADER });
  const first = runTypeCost(root, { referenceFiles: 10, compilers: ['ts7'], update: true });
  assert.deepEqual(first.problems, []);
  assert.equal(first.written, true);
  assert.deepEqual(
    first.rows.map((row) => `${row.subject} ${row.compiler} ${row.options}`),
    ['reference ts7 exact', 'reference ts7 loose'],
  );
  assert.equal(first.time, undefined, 'without a usage, no time is judged');
  const second = runTypeCost(root, { referenceFiles: 10, compilers: ['ts7'] });
  assert.deepEqual(second.problems, []);
  assert.deepEqual(second.rows, first.rows);
  assert.deepEqual(second.changes, []);
});

test('with usages, the check time of the reference project is judged on interleaved passes', () => {
  const root = fixtureRoot({
    [`${USAGE_DIR}/bounded.ts`]: pathsUsage('Bounded', 4),
    [CEILING_FILE]: `${CEILING_HEADER}bounded\tts7\t6000\ttest\nbounded\tts6\t6000\ttest\n`,
  });
  const report = runTypeCost(root, { referenceFiles: 10, fixtureFiles: 3, passes: 3, compilers: ['ts7'] });
  assert.ok(report.time !== undefined);
  assert.ok(
    report.time.without.min <= report.time.without.median && report.time.without.median <= report.time.without.max,
  );
  // Times of a few milliseconds may land on either side of the budget: the only problem allowed is that verdict.
  const timeProblems = report.problems.filter((problem) =>
    /^with every usage the reference project checks [0-9.]+ % slower under ts7/.test(problem),
  );
  assert.equal(timeProblems.length, report.time.ok ? 0 : 1);
  // No baseline in the fixture: that difference is the only other problem.
  assert.equal(report.problems.length, timeProblems.length + 1);
  assert.deepEqual(
    report.rows.map((row) => row.subject).filter((subject, index, all) => all.indexOf(subject) === index),
    ['reference', 'reference+usages', 'fixture', 'usage/bounded'],
  );
});
