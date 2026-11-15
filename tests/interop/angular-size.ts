// The size of the Angular bridge (angular-bridge.ts, ADR 0048) as an application ships it, measured as
// scripts/size-report.ts measures a scenario: bundled by esbuild and by Rollup, minified, then brotli-compressed. Two
// figures per bundler: the bridge alone, Angular and the packages of the workspace left out, which the budget
// `yaltaan/angular-adapter` of bench/size/budgets.tsv is about (1,500 B, a hypothesis); and the bridge with what it
// brings of those packages, Angular left out. Fails when the bridge alone passes the budget under either bundler. Run
// by tests/interop/run.sh in its temporary project, where the tarballs of the workspace are installed: outside the
// gate until the bridge is a package of the workspace and its scenario enters bench/size/.
//
// Usage: node tests/interop/angular-size.ts <folder holding angular-bridge.ts and node_modules>
import { stop } from 'esbuild-wasm';
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

import { bundleScenario } from '../../scripts/lib/bundle.ts';
import { PackageIndex } from '../../scripts/lib/packages.ts';
import { BUDGET_FILE, measure } from '../../scripts/size-report.ts';
import { repositoryRoot } from '../../scripts/lib/workspace.ts';

const [folder] = process.argv.slice(2);
if (folder === undefined) {
  console.error('usage: node tests/interop/angular-size.ts <folder>');
  process.exit(2);
}
const budget = readFileSync(path.join(repositoryRoot, BUDGET_FILE), 'utf8')
  .split('\n')
  .map((line) => line.split('\t'))
  .find(([scenario]) => scenario === 'yaltaan/angular-adapter')?.[1];
if (budget === undefined) {
  throw new Error(`no budget yaltaan/angular-adapter in ${BUDGET_FILE}`);
}
const root = path.resolve(folder);
// Rollup reads JavaScript: the types are blanked out, every other character kept where it was.
const entry = path.join(root, 'angular-bridge.js');
writeFileSync(entry, stripTypeScriptTypes(readFileSync(path.join(root, 'angular-bridge.ts'), 'utf8')));
const angular = ['@angular/core', '@angular/forms'];
const packages = new PackageIndex();
let over = false;
try {
  for (const [name, external] of [
    ['bridge alone', [...angular, '@yaltaan/core', '@yaltaan/rules', '@yaltaan/form']],
    ['with the packages', angular],
  ] as const) {
    for (const bundle of await bundleScenario({ root, entry, external, packages })) {
      const { raw, brotli } = measure(bundle.code);
      console.log(`angular-size: ${name}, ${bundle.bundler}: ${raw} B minified, ${brotli} B brotli`);
      over ||= name === 'bridge alone' && brotli > Number(budget);
    }
  }
} finally {
  await stop();
}
if (over) {
  console.error(`angular-size: the bridge alone passes its budget of ${budget} B`);
  process.exitCode = 1;
}
