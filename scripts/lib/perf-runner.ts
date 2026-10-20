// The process the instruction count measures: loads one scenario of bench/perf/scenarios/, builds one variant's input
// and calls it a given number of times, and nothing else. The count copies this file from the working tree into each
// commit it compares, so that A and B run the same loop and differ only by their scenarios and their packages.
//
// Usage:
//   node perf-runner.ts <scenario file> <variant> <calls>   make the calls
//   node perf-runner.ts --list <scenario file>              print the variants and their calls, as JSON
import { pathToFileURL } from 'node:url';

interface LoadedScenario {
  readonly calls: Readonly<Record<string, number>>;
  readonly variants: Readonly<Record<string, () => () => unknown>>;
}

async function load(file: string): Promise<LoadedScenario> {
  const module = (await import(pathToFileURL(file).href)) as { default?: LoadedScenario };
  if (module.default === undefined) {
    throw new Error(`${file} has no default export`);
  }
  return module.default;
}

const args = process.argv.slice(2);
if (args[0] === '--list' && args[1] !== undefined) {
  const scenario = await load(args[1]);
  const variants = Object.keys(scenario.variants).map((name) => {
    const dataset = name.slice(name.indexOf('/') + 1);
    return { name, calls: scenario.calls[dataset] };
  });
  process.stdout.write(`${JSON.stringify(variants)}\n`);
} else if (args.length === 3) {
  const [file = '', variant = '', callsText = ''] = args;
  const scenario = await load(file);
  const prepare = scenario.variants[variant];
  const calls = Number(callsText);
  if (prepare === undefined || !Number.isInteger(calls) || calls < 0) {
    process.stderr.write(`no variant ${variant} in ${file}, or a call count that is not an integer: ${callsText}\n`);
    process.exit(2);
  }
  const call = prepare();
  // Results are kept in a small ring, so that the optimizing compiler cannot prove a call useless and drop it.
  const kept: unknown[] = new Array<unknown>(16);
  for (let i = 0; i < calls; i++) {
    kept[i & 15] = call();
  }
} else {
  process.stderr.write('usage: perf-runner.ts <scenario file> <variant> <calls> | --list <scenario file>\n');
  process.exit(2);
}
