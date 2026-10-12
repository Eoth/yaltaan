import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rollup } from '@rollup/wasm-node';
import { build } from 'esbuild-wasm';

import { readModule } from '../lib/module-rules.ts';

// Module bodies the rule accepts: each only declares. A second method checks each verdict: imported for its effects
// alone, the module must vanish from the output of both bundlers.
const ACCEPTED: Readonly<Record<string, string>> = {
  literals: 'export const a = 1, b = -1, c = `t${1}`, d = -2n, e = /a+/u, f = (1, "x"), g = 1 ? null : "";',
  'call inside a function': 'export function f() { return g(); }\nexport const h = () => console.log(1);',
  'class members that run later': [
    'export class A {',
    '  static x = 1;',
    '  y = make();',
    '  m() { return new Map(); }',
    '  [Symbol.iterator]() {}',
    '}',
  ].join('\n'),
  'object literal': 'export const o = { a: 1, get b() { return f(); }, ["k"]: 2, [Symbol.iterator]: null };',
  'default function': 'export default function () {}',
  'relative re-exports': "export { a as b } from './o.js';\nexport * from './o.js';",
  directive: "'use strict';\nexport {};",
  'local export list': 'const x = 1;\nexport { x };',
  'typeof and conditions': "export const t = typeof window === 'undefined' ? null : 1;",
  'dynamic import in a function': "export const lazy = () => import('./o.js');",
  'operators that never convert': [
    "import { o } from './o.js';",
    'export const same = o === null, other = o !== 1, not = !o, kind = typeof o, either = o ?? o, both = o && o;',
  ].join('\n'),
  'superclass binding': "import { o } from './o.js';\nexport class B extends o {}",
  'mutable bindings': 'export let counter = 0;\nexport var legacy;',
};

// Module bodies the rule refuses, with a fragment of the message each must produce.
const REFUSED: readonly (readonly [string, string])[] = [
  ['f();', 'loads: a call'],
  ['export const a = Object.freeze([]);', 'loads: a call'],
  ['export const a = /*#__PURE__*/ make();', 'loads: a call'],
  ['export const m = new Map();', 'loads: a "new"'],
  ['export const s = tag`x`;', 'loads: a tagged template'],
  ['let n = 0;\nn += 1;', 'loads: an assignment'],
  ['export let a = (b = 1);', 'loads: an assignment'],
  ['let n = 0;\nn++;', 'loads: an update'],
  ['await ready;', 'loads: an "await"'],
  ['export const a = { ...o };', 'a spread'],
  ['export const a = [...o];', 'a spread'],
  ['export const { a } = o;', 'a destructuring declaration'],
  ['export const [a] = o;', 'a destructuring declaration'],
  ['if (x) {}', 'loads: a statement (IfStatement)'],
  ['for (;;) {}', 'loads: a statement (ForStatement)'],
  ['{ let x; }', 'loads: a statement (BlockStatement)'],
  ['export class A { static { init(); } }', 'loads: a static block'],
  ['export class A { static x = make(); }', 'loads: a call'],
  ['export class A extends mixin(B) {}', 'loads: a call'],
  ['export class A { [key()]() {} }', 'loads: a call'],
  ['export class A { [K]() {} }', 'a computed key from a binding'],
  ['export const o = { [K]: 2 };', 'a computed key from a binding'],
  ['export const a = o.b;', 'a property read'],
  ['export const a = o["b"];', 'a property read'],
  ['export const a = o?.b;', 'an optional chain'],
  ['export const u = import.meta.url;', 'a property read'],
  ['export const a = o + 1;', 'a "+", which converts its operands'],
  ['export const a = "x" in o;', 'a "in", which converts its operands or calls a trap'],
  ['export const a = o instanceof C;', 'a "instanceof"'],
  ['export const a = o == null;', 'a "=="'],
  ['export const a = 2 ** 53 - 1;', 'a "**", which converts its operands'],
  ['export const a = "a" + "b";', 'a "+"'],
  ['export const a = -o;', 'a "-", which converts its operand'],
  ['export const a = ~1;', 'a "~"'],
  ['export const a = `x${o}`;', 'an interpolation, which converts'],
  ['export const a = `x${f()}`;', 'loads: a call'],
  ['export const a = -f();', 'loads: a call'],
  ['export const d = delete o.x;', 'loads: a "delete"'],
  ['export default make();', 'loads: a call'],
  ['export const c = class { static v = f(); };', 'loads: a call'],
  ['export const g = function* () {}, y = (yield);', 'cannot be parsed'],
  ["import './polyfill.js';", 'without a binding: such an import exists only to run its code'],
  ["import {} from './polyfill.js';", 'without a binding'],
  ['export const lazy = (name) => import(name);', 'imports a computed specifier'],
  ['export const = ;', 'cannot be parsed'],
  ['using r = res;', 'a "using" declaration disposes of its value'],
];

const BARRELS: readonly string[] = [
  "export * from '@yaltaan/core';",
  "export * as core from '@yaltaan/core';",
  "export { ok } from '@yaltaan/core/result';",
  "import { ok } from '@yaltaan/core/result';\nexport { ok };",
  "import { ok } from '@yaltaan/core/result';\nexport { ok as success };",
  "import * as core from '@yaltaan/core';\nexport { core };",
  "import { ok } from '@yaltaan/core/result';\nexport const success = ok;",
  "import ok from '@yaltaan/core/result';\nexport default ok;",
  "export { useState } from 'react';",
];

async function rollupOutput(code: string): Promise<string> {
  const files: Record<string, string> = { 'entry.js': "import './m.js';", 'm.js': code, 'o.js': O_MODULE };
  const bundle = await rollup({
    input: 'entry.js',
    treeshake: { moduleSideEffects: true },
    onwarn: () => {},
    plugins: [{ name: 'virtual', resolveId: (id) => id.replace('./', ''), load: (id) => files[id] ?? null }],
  });
  const { output } = await bundle.generate({ format: 'es' });
  return output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('');
}

async function esbuildOutput(code: string): Promise<string> {
  const files: Record<string, string> = { 'm.js': code, 'o.js': O_MODULE };
  const result = await build({
    stdin: { contents: "import './m.js';", resolveDir: '/', loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [
      {
        name: 'virtual',
        setup(context): void {
          context.onResolve({ filter: /.*/ }, (args) => ({ path: args.path.replace('./', ''), namespace: 'virtual' }));
          context.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => ({
            contents: files[args.path] ?? '',
            loader: 'js',
          }));
        },
      },
    ],
  });
  // esbuild names each module it includes in a comment; only code counts.
  return result.outputFiles.map((file) => file.text.replace(/^\/\/ .*$/gm, '')).join('');
}

const O_MODULE = 'export const o = {};\nexport const a = 1;';

test('a module that only declares has no problem, and both bundlers drop it when nothing of it is used', async () => {
  for (const [name, code] of Object.entries(ACCEPTED)) {
    assert.deepEqual(readModule(code).problems, [], name);
    assert.equal((await rollupOutput(code)).trim(), '', `Rollup keeps "${name}"`);
    assert.equal((await esbuildOutput(code)).trim(), '', `esbuild keeps "${name}"`);
  }
});

test('code that runs when the module loads is refused, each case with its reason', () => {
  for (const [code, fragment] of REFUSED) {
    const { problems } = readModule(code);
    assert.ok(problems.length > 0, `accepted: ${code}`);
    assert.ok(
      problems.some((problem) => problem.includes(fragment)),
      `${code}: ${JSON.stringify(problems)} lacks "${fragment}"`,
    );
  }
});

test('a decorator is refused, on a class or on a member', () => {
  for (const code of ['@sealed export class A {}', 'export @sealed class A {}', 'export class A { @logged m() {} }']) {
    const { problems } = readModule(code);
    assert.equal(problems.length, 1, code);
    assert.match(problems[0] ?? '', /^line 1: runs code when the module loads: a decorator$/, code);
  }
});

test('a re-export of another package is refused, under every form', () => {
  for (const code of BARRELS) {
    const { problems } = readModule(code);
    assert.equal(problems.length, 1, `${code}: ${JSON.stringify(problems)}`);
    assert.match(problems[0] ?? '', /re-exports .*: no barrel of another package/, code);
  }
});

test('every import, re-export and dynamic import is an edge, with its line', () => {
  const facts = readModule(
    [
      "import { ok } from '@yaltaan/core/result';",
      "export { helper } from './helper.js';",
      "export * from './more.js';",
      'export function load() {',
      "  return import('./heavy.js');",
      '}',
      'export const check = (value) => ok(value);',
    ].join('\n'),
  );
  assert.deepEqual(facts.problems, []);
  assert.deepEqual(facts.edges, [
    { specifier: '@yaltaan/core/result', kind: 'import', line: 1 },
    { specifier: './helper.js', kind: 're-export', line: 2 },
    { specifier: './more.js', kind: 're-export', line: 3 },
    { specifier: './heavy.js', kind: 'dynamic import', line: 5 },
  ]);
});

test('a problem names the line of the node that runs', () => {
  const { problems } = readModule('export const a = 1;\n\nexport const b = {\n  c: make(),\n};\n');
  assert.deepEqual(problems, ['line 4: runs code when the module loads: a call']);
});
