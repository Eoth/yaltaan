// Times every variant of bench/perf/scenarios/ on this machine and prints the publication: where and how the figures
// were taken, then for each variant and pass its batch, samples, loop floor, p50, p99, minimum, maximum, mean and
// margin, the bytes one call allocates, and the spread of p50 across passes. The figures are read, not judged: between
// two commits, the instruction count decides (scripts/perf-count.sh).
//
// Usage (through scripts/perf-time.sh):
//   perf-time.sh [--warmup <ms>] [--budget <ms>] [--passes <n>] [--cpu <n>] [--folder <dir>] [--no-alloc] [--json]
//                [regex]
//
// --warmup (default 100) and --budget (default 500) are per variant and pass; --passes (default 3) times every
// variant that many times; --cpu pins every measured process to one logical processor (Linux, through taskset), so
// that on a hybrid processor no variant runs on a slower core than another; --folder reads the scenarios of another
// folder under bench/perf/ (the harness's tests time bench/perf/fixtures/); --no-alloc skips the allocation reading;
// --json prints the environment and the rows as JSON in place of the Markdown. The regex filters
// `<scenario> <variant>`.
//
// Each variant runs alone in a fresh process, one after the other. A pass times every variant once
// (bench/perf/time.ts), and the passes follow each other, so that a change of the machine's state (a frequency, a
// process landing on a slower core of a hybrid processor) shows as a spread across passes instead of shifting one
// variant against another. The allocations of each variant are read once, in a process of their own
// (bench/perf/alloc.ts), and checked in another, where collections run and the collector's accounting reads them.
// The measured processes load the JavaScript twin of bench/perf/, written to a work directory under
// node_modules/.cache, where the scenarios still resolve the workspace's dependencies, and removed at the end.
// Nothing else should run on the machine meanwhile: unlike the count, a clock feels the load and the power source,
// which the publication reports.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AllocResult } from '../bench/perf/alloc.ts';
import type { TimeResult } from '../bench/perf/time.ts';
import { toJavaScript } from './lib/perf-count.ts';
import { formatHeader, formatPasses, formatTable, type TimeEnvironment, type TimeRow } from './lib/perf-time.ts';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const allocFlags = ['--expose-gc', '--single-threaded', '--min-semi-space-size=64', '--max-semi-space-size=64'];
const checkFlags = ['--expose-gc', '--single-threaded', '--max-semi-space-size=1'];
const usage =
  'usage: perf-time.sh [--warmup <ms>] [--budget <ms>] [--passes <n>] [--cpu <n>] [--folder <dir>] [--no-alloc] ' +
  '[--json] [regex]';

class UsageError extends Error {}

interface Options {
  readonly warmupMs: number;
  readonly budgetMs: number;
  readonly passes: number;
  readonly cpu: number | null;
  readonly folder: string;
  readonly alloc: boolean;
  readonly json: boolean;
  readonly filter: RegExp;
}

function positive(name: string, text: string | undefined): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    throw new UsageError(`${name} needs a positive integer, got ${text}`);
  }
  return value;
}

function parseOptions(args: readonly string[]): Options {
  let warmupMs = 100;
  let budgetMs = 500;
  let passes = 3;
  let cpu: number | null = null;
  let folder = path.join('bench', 'perf', 'scenarios');
  let alloc = true;
  let json = false;
  let filter = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--warmup') {
      warmupMs = positive(arg, args[++i]);
    } else if (arg === '--budget') {
      budgetMs = positive(arg, args[++i]);
    } else if (arg === '--passes') {
      passes = positive(arg, args[++i]);
    } else if (arg === '--cpu') {
      cpu = Number(args[++i]);
      if (!Number.isInteger(cpu) || cpu < 0 || cpu >= os.availableParallelism()) {
        throw new UsageError(`--cpu needs a logical processor of this machine, 0 to ${os.availableParallelism() - 1}`);
      }
    } else if (arg === '--folder') {
      folder = path.normalize(args[++i] ?? '');
      if (!folder.startsWith(path.join('bench', 'perf') + path.sep) || folder.split(path.sep).includes('..')) {
        throw new UsageError(`--folder must be a folder under bench/perf/, got ${folder}`);
      }
    } else if (arg === '--no-alloc') {
      alloc = false;
    } else if (arg === '--json') {
      json = true;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      filter = arg;
    } else {
      throw new UsageError(`unknown option ${arg}; ${usage}`);
    }
  }
  return { warmupMs, budgetMs, passes, cpu, folder, alloc, json, filter: new RegExp(filter) };
}

/** Writes the JavaScript twin of every TypeScript module under `from`, tests left out, into `to`. */
function convert(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (entry.isDirectory()) {
      convert(source, path.join(to, entry.name));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      fs.writeFileSync(
        path.join(to, entry.name.replace(/\.ts$/, '.js')),
        toJavaScript(fs.readFileSync(source, 'utf8')),
      );
    }
  }
}

/** The variants of the folder's scenarios that match the filter, in file then declaration order. */
async function listVariants(folder: string, filter: RegExp): Promise<{ scenario: string; variant: string }[]> {
  const found: { scenario: string; variant: string }[] = [];
  const names = fs
    .readdirSync(path.join(repo, folder))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  for (const name of names) {
    const href = pathToFileURL(path.join(repo, folder, name)).href;
    const scenario = ((await import(href)) as { default: { variants: Record<string, unknown> } }).default;
    for (const variant of Object.keys(scenario.variants)) {
      const entry = { scenario: name.replace(/\.ts$/, ''), variant };
      if (filter.test(`${entry.scenario} ${variant}`)) {
        found.push(entry);
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

function runJson<T>(args: readonly string[], cwd: string, cpu: number | null): T {
  const [command, commandArgs] =
    cpu === null ? [process.execPath, args] : ['taskset', ['-c', String(cpu), process.execPath, ...args]];
  const result = spawnSync(command, commandArgs, { cwd, env: environment, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} exited with ${result.status}:\n${result.stderr.slice(-2000)}`);
  }
  return JSON.parse(result.stdout) as T;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function operatingSystem(): string {
  const release = readText('/etc/os-release');
  const name = release === undefined ? os.type() : (/^PRETTY_NAME="?([^"\n]*)"?$/m.exec(release)?.[1] ?? os.type());
  return `${name}, kernel ${os.release()}, ${os.arch()}`;
}

/** Mains or battery, and the frequency governor: both move a clock, so both are published. Linux only. */
function power(): string {
  const supplies = '/sys/class/power_supply';
  let names: string[] = [];
  try {
    names = fs.readdirSync(supplies);
  } catch {
    return 'unknown';
  }
  const mains = names
    .map((name) => readText(path.join(supplies, name, 'online')))
    .filter((value) => value !== undefined);
  const battery = names
    .map((name) => readText(path.join(supplies, name, 'status')))
    .find((value) => value !== undefined);
  const source = mains.includes('1') ? 'mains' : mains.length > 0 ? `battery (${battery ?? 'unknown'})` : 'mains';
  const governor = readText('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor');
  return governor === undefined ? source : `${source}, governor ${governor}`;
}

async function main(args: readonly string[]): Promise<number> {
  const options = parseOptions(args);
  const variants = await listVariants(options.folder, options.filter);
  if (variants.length === 0) {
    throw new UsageError(`no variant of ${options.folder} matches ${options.filter.source}`);
  }
  const work = path.join(repo, 'node_modules', '.cache', 'yaltaan-perf-time', String(process.pid));
  const loadBefore = os.loadavg();
  const rows: TimeRow[] = [];
  try {
    convert(path.join(repo, 'bench', 'perf'), path.join(work, 'bench', 'perf'));
    fs.writeFileSync(path.join(work, 'package.json'), '{ "type": "module" }\n');
    const harness = path.join(work, 'bench', 'perf');
    const total = options.passes * variants.length;
    for (let pass = 1; pass <= options.passes; pass++) {
      for (const [index, { scenario, variant }] of variants.entries()) {
        const step = (pass - 1) * variants.length + index + 1;
        process.stderr.write(`\rtiming ${step}/${total}: pass ${pass}, ${scenario} ${variant}`.padEnd(78));
        const file = path.join(work, options.folder, `${scenario}.js`);
        const time = runJson<TimeResult>(
          [path.join(harness, 'time.js'), file, variant, String(options.warmupMs), String(options.budgetMs)],
          work,
          options.cpu,
        );
        const allocArgs = [path.join(harness, 'alloc.js'), file, variant, String(options.warmupMs)];
        const alloc =
          options.alloc && pass === 1
            ? {
                heap: runJson<AllocResult>([...allocFlags, ...allocArgs], work, options.cpu),
                check: runJson<AllocResult>([...checkFlags, ...allocArgs, '--accounted'], work, options.cpu),
              }
            : null;
        rows.push({ scenario, variant, pass, time, alloc });
      }
    }
    process.stderr.write('\n');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const timed: TimeEnvironment = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0]?.model.trim() ?? 'unknown',
    processors: os.availableParallelism(),
    pinned: options.cpu,
    os: operatingSystem(),
    power: power(),
    runtime: `Node ${process.version}, V8 ${process.versions.v8}`,
    command: ['scripts/perf-time.sh', ...args].join(' '),
    warmupMs: options.warmupMs,
    budgetMs: options.budgetMs,
    passes: options.passes,
    loadBefore,
    loadAfter: os.loadavg(),
  };
  process.stdout.write(
    options.json
      ? `${JSON.stringify({ environment: timed, rows })}\n`
      : `${[...formatHeader(timed), '', formatTable(rows), '', formatPasses(rows), ''].join('\n')}\n`,
  );
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`perf-time: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
