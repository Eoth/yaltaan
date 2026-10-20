import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parseVariant, perfDatasets } from '../../scripts/lib/perf-count.ts';
import type { PerfScenario } from './scenario.ts';

const folder = fileURLToPath(new URL('scenarios/', import.meta.url));
const runner = fileURLToPath(new URL('../../scripts/lib/perf-runner.ts', import.meta.url));
const files = fs
  .readdirSync(folder)
  .filter((name) => name.endsWith('.ts'))
  .sort();

async function load(name: string): Promise<PerfScenario> {
  return ((await import(new URL(`scenarios/${name}`, import.meta.url).href)) as { default: PerfScenario }).default;
}

test('the scenarios folder holds scenarios', () => {
  assert.ok(files.length >= 2, files.join(', '));
});

for (const name of files) {
  test(`${name}: every dataset has a call count, and native and another side`, async () => {
    const scenario = await load(name);
    for (const dataset of perfDatasets) {
      const calls = scenario.calls[dataset as keyof PerfScenario['calls']];
      assert.ok(Number.isInteger(calls) && calls > 0, `${dataset}: ${calls}`);
      const sides = Object.keys(scenario.variants)
        .map(parseVariant)
        .filter((parsed) => parsed?.dataset === dataset)
        .map((parsed) => parsed?.side);
      assert.ok(sides.includes('native') && sides.length >= 2, `${dataset}: ${sides.join(', ')}`);
    }
    for (const variant of Object.keys(scenario.variants)) {
      assert.notEqual(parseVariant(variant), undefined, `${variant} is not <side>/<dataset>`);
    }
  });

  test(`${name}: every side of a dataset returns the same value, on every call`, async () => {
    const scenario = await load(name);
    for (const dataset of perfDatasets) {
      const results = Object.entries(scenario.variants)
        .filter(([variant]) => parseVariant(variant)?.dataset === dataset)
        .map(([variant, prepare]) => {
          const call = prepare();
          const first = call();
          assert.ok(isDeepStrictEqual(call(), first), `${variant}: a second call returns another value`);
          return [variant, first] as const;
        });
      const [reference] = results;
      for (const [variant, value] of results) {
        assert.ok(isDeepStrictEqual(value, reference?.[1]), `${variant} differs from ${reference?.[0]}`);
      }
    }
  });

  test(`${name}: builds the same input on every run, from its seeds`, async () => {
    const scenario = await load(name);
    for (const [variant, prepare] of Object.entries(scenario.variants)) {
      assert.ok(isDeepStrictEqual(prepare()(), prepare()()), variant);
    }
  });
}

test('the runner lists the variants with their calls, makes the calls, and refuses an unknown variant', () => {
  const file = path.join(folder, 'omit.ts');
  const listed = spawnSync(process.execPath, [runner, '--list', file], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const variants = JSON.parse(listed.stdout) as { name: string; calls: number }[];
  assert.ok(
    variants.some((variant) => variant.name === 'native/micro' && variant.calls > 0),
    listed.stdout,
  );
  const ran = spawnSync(process.execPath, [runner, file, 'native/micro', '3'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  const unknown = spawnSync(process.execPath, [runner, file, 'native/huge', '3'], { encoding: 'utf8' });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no variant native\/huge/);
});
