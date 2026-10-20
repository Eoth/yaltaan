// Counts the instructions of one call of every variant of bench/perf/scenarios/ at two commits, under Callgrind, and
// prints for each one the instructions per call at A and at B and the change. A count, not a clock, decides between
// two versions of a hot path: with V8 made deterministic it repeats to a few thousand instructions per process, where
// a clock on a shared machine moves by percents.
//
// Usage (through scripts/perf-count.sh):
//   perf-count.sh <A> <B> [variant regex]           compare two commits: B against A, its exact parent for one commit
//   perf-count.sh <A> --worktree [variant regex]    compare A with the working tree, not yet committed
//   perf-count.sh --repeat <commit>|--worktree <runs> [regex]   count one tree several times: the noise
//   perf-count.sh --clean                           remove the work directory and every result
//
// What is counted. Each commit's tree is extracted once (a tree counted before is reused, so a commit replayed at
// another hour costs nothing), its packages are built as the commit has them, and each variant runs in two processes
// of the runner (scripts/lib/perf-runner.ts, taken from the working tree for both sides): one that makes N calls and
// one that makes 2N. The difference, divided by N, is the work of one warmed-up call: Node's start, the loading of the
// modules and the building of the input cancel out. N is the scenario's `calls` for the dataset. The runner and the
// scenarios run as JavaScript, their types stripped beforehand (see toJavaScript in scripts/lib/perf-count.ts).
//
// Determinism. V8 runs with --predictable --random-seed=1 --hash-seed=1 --single-threaded --v8-pool-size=0 (no
// background compilation or collection, fixed seeds), every process with the same environment, the same runner path
// and the same arguments; both commits run under the same Node, the one that runs this script.
//
// Dependencies. A commit whose package-lock.json is the working tree's links the working tree's node_modules, its own
// packages in place of the workspace links; another runs `npm ci --ignore-scripts` in its extracted tree.
//
// Verdict. A variant does more or less work when its instructions per call move by more than PERF_COUNT_THRESHOLD
// percent (default 0.10). Exit status 3 when some variant does more work in B, 0 otherwise, 1 on an error, 2 on a
// usage error.
//
// Results go to PERF_COUNT_ROOT/results/<A>-<B>/ (summary.txt, the Markdown table for the commit message, and
// summary.tsv). PERF_COUNT_ROOT (default ~/.cache/yaltaan-perf-count, outside node_modules, where Node refuses to
// strip types) also holds the extracted trees until --clean. PERF_COUNT_JOBS (default 8, at most the processors)
// processes run side by side. Needs git, tar and valgrind.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callgrindTotal,
  formatTable,
  formatTsv,
  judge,
  spreadPercent,
  toJavaScript,
  workPerCall,
} from './lib/perf-count.ts';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = process.env['PERF_COUNT_ROOT'] ?? path.join(os.homedir(), '.cache', 'yaltaan-perf-count');
const threshold = Number(process.env['PERF_COUNT_THRESHOLD'] ?? '0.10');
const jobs = Math.max(1, Math.min(Number(process.env['PERF_COUNT_JOBS'] ?? '8'), os.availableParallelism()));
const v8Flags = ['--predictable', '--random-seed=1', '--hash-seed=1', '--single-threaded', '--v8-pool-size=0'];
const runner = path.join(root, 'perf-runner.js');

class UsageError extends Error {}

interface Side {
  readonly label: string;
  readonly tree: string;
}

interface Job {
  readonly dir: string;
  readonly key: string;
  readonly file: string;
  readonly variant: string;
  readonly calls: number;
}

function git(args: readonly string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: env ?? process.env }).trim();
}

function side(ref: string): Side {
  return ref === '--worktree' ? worktreeSide() : commitSide(ref);
}

function commitSide(ref: string): Side {
  let commit: string;
  try {
    commit = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new UsageError(`not a commit: ${ref}`);
  }
  return { label: commit.slice(0, 10), tree: git(['rev-parse', `${commit}^{tree}`]) };
}

/** The working tree as a tree object: tracked and untracked files as they stand, ignored ones left out. */
function worktreeSide(): Side {
  const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-perf-index-')), 'index');
  try {
    fs.copyFileSync(path.resolve(repo, git(['rev-parse', '--git-path', 'index'])), index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(['add', '-A'], env);
    return { label: 'worktree', tree: git(['write-tree'], env) };
  } finally {
    fs.rmSync(path.dirname(index), { recursive: true, force: true });
  }
}

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${result.stdout}${result.stderr}`);
  }
}

/** Extracts a tree, gives it its dependencies and builds its packages, once: a tree already prepared is reused. */
function prepare(side: Side): string {
  const dir = path.join(root, 'trees', side.tree);
  if (fs.existsSync(path.join(dir, '.prepared'))) {
    return dir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  run('bash', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', '_', repo, side.tree, dir], repo);
  const lockHere = git(['hash-object', 'package-lock.json']);
  let lockThere = '';
  try {
    lockThere = git(['rev-parse', `${side.tree}:package-lock.json`]);
  } catch {
    // A tree without a lock file cannot be installed as locked; npm ci reports it below.
  }
  if (lockThere === lockHere) {
    linkDependencies(dir);
  } else {
    process.stderr.write(`${side.label}: its package-lock.json differs from the working tree's, running npm ci\n`);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], dir);
  }
  const packages = path.join(dir, 'packages');
  for (const name of fs.existsSync(packages) ? fs.readdirSync(packages).sort() : []) {
    const config = path.join('packages', name, 'tsconfig.build.json');
    if (fs.existsSync(path.join(dir, config))) {
      run('npx', ['--no-install', 'tsc', '-b', config], dir);
    }
  }
  convertScenarios(path.join(dir, 'bench', 'perf'));
  fs.writeFileSync(path.join(dir, '.prepared'), '');
  return dir;
}

/** Writes the JavaScript twin of every TypeScript module of the scenarios folder, tests left out. */
function convertScenarios(folder: string): void {
  if (!fs.existsSync(folder)) {
    return;
  }
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      convertScenarios(file);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      fs.writeFileSync(file.replace(/\.ts$/, '.js'), toJavaScript(fs.readFileSync(file, 'utf8')));
    }
  }
}

/** The working tree's node_modules, entry by entry, with the workspace links pointing to the extracted packages. */
function linkDependencies(dir: string): void {
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(path.join(modules, '@yaltaan'), { recursive: true });
  for (const entry of fs.readdirSync(path.join(repo, 'node_modules'))) {
    if (entry !== '@yaltaan' && entry !== '.cache') {
      fs.symlinkSync(path.join(repo, 'node_modules', entry), path.join(modules, entry));
    }
  }
  const packages = path.join(dir, 'packages');
  for (const name of fs.existsSync(packages) ? fs.readdirSync(packages) : []) {
    const manifest = path.join(packages, name, 'package.json');
    if (!fs.existsSync(manifest)) {
      continue;
    }
    const packageName = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string }).name ?? '';
    if (packageName.startsWith('@yaltaan/')) {
      fs.symlinkSync(path.join('..', '..', 'packages', name), path.join(modules, packageName));
    }
  }
}

/** Every variant of the tree's scenarios that matches the filter, with its call count. */
function listJobs(dir: string, filter: RegExp): Job[] {
  const scenarios = path.join(dir, 'bench', 'perf', 'scenarios');
  const files = fs.existsSync(scenarios) ? fs.readdirSync(scenarios).filter((name) => name.endsWith('.ts')) : [];
  const found: Job[] = [];
  for (const name of files.sort()) {
    const file = path.join('bench', 'perf', 'scenarios', name.replace(/\.ts$/, '.js'));
    const listed = execFileSync(process.execPath, [runner, '--list', file], { cwd: dir, encoding: 'utf8' });
    for (const { name: variant, calls } of JSON.parse(listed) as { name: string; calls: number }[]) {
      const key = `${name.replace(/\.ts$/, '')} ${variant}`;
      if (filter.test(key)) {
        found.push({ dir, key, file, variant, calls });
      }
    }
  }
  return found;
}

const environment = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: os.homedir(),
  TZ: 'UTC',
  LANG: 'C',
  LC_ALL: 'C',
};

/** The instructions of one process of the runner making `calls` calls. */
function countProcess(job: Job, calls: number): Promise<number> {
  const profile = path.join(root, 'profiles', `${process.pid}-${Math.random().toString(36).slice(2)}.out`);
  const args = [
    '--tool=callgrind',
    `--callgrind-out-file=${profile}`,
    process.execPath,
    ...v8Flags,
    runner,
    job.file,
    job.variant,
    String(calls),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('valgrind', args, { cwd: job.dir, env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        if (status !== 0) {
          throw new Error(`${job.key} (${calls} calls) exited with ${status}:\n${errors.slice(-2000)}`);
        }
        resolve(callgrindTotal(fs.readFileSync(profile, 'utf8')));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        fs.rmSync(profile, { force: true });
      }
    });
  });
}

async function pool<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
      done++;
      process.stderr.write(`\rcounted ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  process.stderr.write('\n');
  return results;
}

/** Instructions per call of every job, keyed by `<scenario> <variant>`. */
async function count(list: readonly Job[]): Promise<Map<string, number>> {
  const processes = list.flatMap((job) => [
    { job, calls: job.calls },
    { job, calls: 2 * job.calls },
  ]);
  const totals = await pool(processes, ({ job, calls }) => countProcess(job, calls));
  const result = new Map<string, number>();
  list.forEach((job, i) => {
    result.set(job.key, workPerCall(totals[2 * i] ?? 0, totals[2 * i + 1] ?? 0, job.calls));
  });
  return result;
}

function header(lines: readonly string[]): string {
  const valgrind = execFileSync('valgrind', ['--version'], { encoding: 'utf8' }).trim();
  return [...lines, `Node ${process.version}, ${valgrind}, V8 flags ${v8Flags.join(' ')}`].join('\n');
}

function setUp(): void {
  if (spawnSync('valgrind', ['--version']).status !== 0) {
    throw new Error('valgrind is not installed: it counts the instructions');
  }
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  fs.writeFileSync(runner, toJavaScript(fs.readFileSync(path.join(repo, 'scripts', 'lib', 'perf-runner.ts'), 'utf8')));
}

async function compare(a: Side, b: Side, filter: RegExp): Promise<number> {
  setUp();
  const listA = listJobs(prepare(a), filter);
  const listB = listJobs(prepare(b), filter);
  process.stderr.write(
    `${a.label}: ${listA.length} variants, ${b.label}: ${listB.length}, ${jobs} processes at a time\n`,
  );
  const [countsA, countsB] = [await count(listA), await count(listB)];
  const rows = judge(countsA, countsB, threshold);
  const summary = [
    header([`A ${a.label}, B ${b.label}; more or less work past ${threshold} % of the instructions per call`]),
    '',
    formatTable(rows),
    '',
  ].join('\n');
  const out = path.join(root, 'results', `${a.label}-${b.label}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'summary.txt'), summary);
  fs.writeFileSync(path.join(out, 'summary.tsv'), formatTsv(rows));
  process.stdout.write(`${summary}\nwritten to ${out}\n`);
  return rows.some((row) => row.verdict === 'MORE work') ? 3 : 0;
}

async function repeat(side: Side, runs: number, filter: RegExp): Promise<number> {
  setUp();
  const list = listJobs(prepare(side), filter);
  const counts: Map<string, number>[] = [];
  for (let i = 0; i < runs; i++) {
    process.stderr.write(`run ${i + 1} of ${runs}\n`);
    counts.push(await count(list));
  }
  const lines = ['| Scenario | Variant | Min, instructions per call | Max | Spread |', '|---|---|---:|---:|---:|'];
  let widest = 0;
  for (const job of list) {
    const values = counts.map((map) => map.get(job.key) ?? 0);
    const spread = spreadPercent(values);
    widest = Math.max(widest, spread);
    const [scenario, variant] = job.key.split(' ');
    lines.push(
      `| ${scenario} | ${variant} | ${Math.min(...values).toFixed(1)} | ${Math.max(...values).toFixed(1)} ` +
        `| ${spread.toFixed(4)} % |`,
    );
  }
  process.stdout.write(
    [
      header([`${side.label}, ${runs} counts of each variant`]),
      '',
      ...lines,
      '',
      `widest spread ${widest.toFixed(4)} %`,
      '',
    ].join('\n'),
  );
  return 0;
}

async function main(args: readonly string[]): Promise<number> {
  if (args[0] === '--clean') {
    fs.rmSync(root, { recursive: true, force: true });
    process.stdout.write(`removed ${root}\n`);
    return 0;
  }
  if (args[0] === '--repeat') {
    const runs = Number(args[2]);
    if (args[1] === undefined || !Number.isInteger(runs) || runs < 2) {
      throw new UsageError('--repeat needs a commit and a number of runs of at least 2');
    }
    return repeat(side(args[1]), runs, new RegExp(args[3] ?? ''));
  }
  if (args[0] === undefined || args[1] === undefined || args[0].startsWith('-')) {
    throw new UsageError(
      'usage: perf-count.sh <A> <B>|--worktree [variant regex] | --repeat <commit> <runs> | --clean',
    );
  }
  return compare(commitSide(args[0]), side(args[1]), new RegExp(args[2] ?? ''));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`perf-count: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
