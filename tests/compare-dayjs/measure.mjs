// What each side costs, the half of the comparison a report of answers cannot say: instructions per call under
// Callgrind, by the method of scripts/perf-count.ts, and bytes of import through the size harness. Writes
// docs/comparisons/dayjs-measures.md. Instructions repeat to about 0.03 %; figures are kept to three digits.
//
// Usage: node measure.mjs --dayjs <folder holding node_modules/dayjs>
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { stop } from 'esbuild-wasm';
import { bundleScenario } from '../../scripts/lib/bundle.ts';
import { PackageIndex } from '../../scripts/lib/packages.ts';
import { callgrindTotal } from '../../scripts/lib/perf-count.ts';
import { measure } from '../../scripts/size-report.ts';
import { OPS } from './ops.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { dayjs: { type: 'string' }, 'skip-count': { type: 'boolean', default: false } },
});
const folder = path.resolve(values.dayjs);
const target = path.join(here, '..', '..', 'docs', 'comparisons', 'dayjs-measures.md');
const V8 = ['--predictable', '--random-seed=1', '--hash-seed=1', '--single-threaded', '--v8-pool-size=0'];
const CALLS = 2000;
const JOBS = Math.min(6, os.availableParallelism());
const SIDES = ['dayjs', 'native', 'polyfill', 'yaltaan'];
const HAS = {
  dayjs: (op) => op.dayjs !== undefined,
  native: (op) => op.temporal !== undefined,
  polyfill: (op) => op.temporal !== undefined,
  yaltaan: (op) => op.yaltaan !== undefined,
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-dayjs-'));

function countOnce(side, op, calls) {
  return new Promise((resolve, reject) => {
    const profile = path.join(scratch, `p-${side}-${Object.keys(OPS).indexOf(op)}-${calls}.out`);
    const args = [
      '--tool=callgrind',
      `--callgrind-out-file=${profile}`,
      process.execPath,
      ...V8,
      path.join(here, 'count-runner.mjs'),
      folder,
      side,
      op,
      String(calls),
    ];
    const child = spawn('valgrind', args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TZ: 'UTC' } });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${side} / ${op}: exit ${code}\n${stderr.slice(-800)}`));
        return;
      }
      resolve(callgrindTotal(fs.readFileSync(profile, 'utf8')));
    });
  });
}

async function countAll() {
  const jobs = [];
  for (const op of Object.keys(OPS)) {
    for (const side of SIDES.filter((one) => HAS[one](OPS[op]))) {
      jobs.push({ op, side, calls: CALLS }, { op, side, calls: 2 * CALLS });
    }
  }
  const results = new Map();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      results.set(`${job.op}|${job.side}|${job.calls}`, await countOnce(job.side, job.op, job.calls));
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  const table = {};
  for (const op of Object.keys(OPS)) {
    table[op] = {};
    for (const side of SIDES.filter((one) => HAS[one](OPS[op]))) {
      table[op][side] = (results.get(`${op}|${side}|${2 * CALLS}`) - results.get(`${op}|${side}|${CALLS}`)) / CALLS;
    }
  }
  return table;
}

const threeDigits = (n) => Number(n.toPrecision(3)).toLocaleString('en-US');

const PLUGINS = ['utc', 'timezone', 'customParseFormat', 'isBetween', 'quarterOfYear', 'isoWeek'];
// The harness's Rollup has no CommonJS plugin: dayjs is measured by its ESM build under both bundlers, its smallest
// form, and its main UMD files, what a plain `import dayjs from 'dayjs'` bundles, read as they are.
const SCENARIOS = {
  'dayjs alone, ESM build': `export { default } from 'dayjs/esm/index.js';\n`,
  'dayjs and the six plugins of the comparison, ESM build': [
    `import dayjs from 'dayjs/esm/index.js';`,
    ...PLUGINS.map((plugin, i) => `import p${i} from 'dayjs/esm/plugin/${plugin}/index.js';\ndayjs.extend(p${i});`),
    `export { dayjs };\n`,
  ].join('\n'),
  'temporal-polyfill, imported': `export { Temporal } from 'temporal-polyfill';\n`,
  'temporal-polyfill, installed as a global': `import 'temporal-polyfill/global';\n`,
  '@yaltaan/temporal, every function': `export * from '@yaltaan/temporal';\n`,
};

async function sizes() {
  const root = folder;
  // The polyfill and esbuild are the repository's; the scenario folder holds dayjs. Linking the polyfill keeps the one
  // resolver of the harness.
  const modules = path.join(here, '..', '..', 'node_modules');
  fs.symlinkSync(path.join(modules, 'temporal-polyfill'), path.join(root, 'node_modules', 'temporal-polyfill'));
  fs.symlinkSync(path.join(modules, '@yaltaan'), path.join(root, 'node_modules', '@yaltaan'));
  const packages = new PackageIndex(root);
  const rows = {};
  for (const [name, code] of Object.entries(SCENARIOS)) {
    const entry = path.join(root, `scenario-${Object.keys(SCENARIOS).indexOf(name)}.js`);
    fs.writeFileSync(entry, code);
    const bundles = await bundleScenario({ root, entry, external: [], packages });
    rows[name] = bundles.map((bundle) => measure(bundle.code).brotli);
  }
  await stop();
  const umd = ['dayjs.min.js', ...PLUGINS.map((plugin) => `plugin/${plugin}.js`)]
    .map((file) => fs.readFileSync(path.join(root, 'node_modules', 'dayjs', file), 'utf8'))
    .join('\n');
  const alone = fs.readFileSync(path.join(root, 'node_modules', 'dayjs', 'dayjs.min.js'), 'utf8');
  rows['dayjs alone, main UMD file'] = [measure(alone).brotli, undefined];
  rows['dayjs and the six plugins, main UMD files'] = [measure(umd).brotli, undefined];
  return rows;
}

const size = await sizes();
const [head = '', tail = ''] = fs.readFileSync(path.join(here, 'measures-text.md'), 'utf8').split('\n<!-- table -->\n');
const lines = [head.trimEnd(), '', '| What an application imports | esbuild | Rollup |', '|---|---:|---:|'];
for (const [name, [esbuild, rollup]] of Object.entries(size)) {
  lines.push(`| ${name} | ${esbuild} | ${rollup ?? 'not bundled'} |`);
}
const polyfillBytes = size['temporal-polyfill, imported'].join(' / ');
lines.push('', tail.trim().replaceAll('{polyfillBytes}', polyfillBytes));
if (!values['skip-count']) {
  const table = await countAll();
  const node = process.versions.node;
  const valgrind = execFileSync('valgrind', ['--version'], { encoding: 'utf8' }).trim();
  lines.push(
    '',
    '## Instructions per call',
    '',
    `Callgrind, ${valgrind}, Node ${node} with ${V8.join(' ')}: two processes, ${CALLS} and ${2 * CALLS} calls after ` +
      `2,000 calls of warm-up, the difference divided by ${CALLS}. Same operation and same inputs for each side ` +
      '(`tests/compare-dayjs/ops.mjs`), three digits.',
    '',
    `| Operation | ${SIDES.join(' | ')} | Fewest | Fewer of dayjs and polyfill |`,
    `|---|${SIDES.map(() => '---:').join('|')}|---|---|`,
  );
  let dayjsWins = 0;
  let compared = 0;
  for (const [op, row] of Object.entries(table)) {
    const fewest = Object.keys(row).reduce((best, side) => (row[side] < row[best] ? side : best));
    let lighter = 'no equivalent';
    if (row.dayjs !== undefined && row.polyfill !== undefined) {
      lighter = row.dayjs < row.polyfill ? 'dayjs' : 'polyfill';
      dayjsWins += lighter === 'dayjs' ? 1 : 0;
      compared += 1;
    }
    const cells = SIDES.map((side) => (row[side] === undefined ? 'none' : threeDigits(row[side])));
    lines.push(`| ${op} | ${cells.join(' | ')} | ${fewest} | ${lighter} |`);
  }
  lines.push('', `dayjs does fewer instructions than the polyfill on ${dayjsWins} operations out of ${compared}.`);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${lines.join('\n')}\n`);
fs.rmSync(scratch, { recursive: true, force: true });
console.log(`ok: ${target} written`);
