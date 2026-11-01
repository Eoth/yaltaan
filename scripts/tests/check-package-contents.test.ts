import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
  checkRepositoryPackageContents,
  followJavaScript,
  inspectFiles,
  inspectTarball,
  listEntryTargets,
  listPublishedPackages,
  packPackage,
  unpackFiles,
} from '../check-package-contents.ts';
import { readModule } from '../lib/module-rules.ts';
import { repositoryRoot } from '../lib/workspace.ts';
import { writeTarball } from './tarball-fixtures.ts';

const folders: string[] = [];
const licence = fs.readFileSync(path.join(repositoryRoot, 'LICENSE'));
/** The files of the real tarball of each published package, packed once from the built packages. */
const packed = new Map<string, ReadonlyMap<string, Buffer>>();

function temporaryFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
  folders.push(folder);
  return folder;
}

before(() => {
  const destination = temporaryFolder();
  for (const workspacePackage of listPublishedPackages(repositoryRoot).packages) {
    const result = packPackage(workspacePackage.path, workspacePackage.dir, destination);
    assert.ok(result.ok, result.ok ? '' : result.problem);
    packed.set(workspacePackage.dir, unpackFiles(fs.readFileSync(result.file), workspacePackage.dir).files);
  }
});

after(() => {
  for (const folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the tarballs of this repository hold exactly what their exports reach, and publint is satisfied', async () => {
  const verdict = await checkRepositoryPackageContents(repositoryRoot);
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.packages.includes('packages/core'), String(verdict.packages));
  // The internal test package is never packed.
  assert.ok(!verdict.packages.includes('packages/testing'), String(verdict.packages));
});

test('every file git tracks in a package and its exports do not reach, slipped into "files", is refused', async () => {
  for (const workspacePackage of listPublishedPackages(repositoryRoot).packages) {
    const { dir } = workspacePackage;
    // The candidates come from git, not from a list of names: every tracked file of the package that its tarball
    // does not already hold (sources, tests, build settings), plus a built test and a note dropped into dist/.
    const tracked = spawnSync('git', ['ls-files', '--', dir], { cwd: repositoryRoot, encoding: 'utf8' })
      .stdout.split('\n')
      .filter((file) => file !== '')
      .map((file) => file.slice(dir.length + 1));
    const shipped = packed.get(dir) ?? new Map();
    const slipped = tracked.filter((file) => !shipped.has(file));
    assert.ok(
      slipped.some((file) => file.endsWith('.test.ts')),
      `no test file among ${slipped.join(', ')}`,
    );
    const copy = temporaryFolder();
    for (const [file, bytes] of shipped) {
      fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
      fs.writeFileSync(path.join(copy, file), bytes);
    }
    // A source beside its declarations: the compiler would load it in their place, through their `./x.ts` imports.
    const fabricated = {
      'dist/result/index.test.js': 'export {};\n',
      'dist/notes.js': 'export const note = 1;\n',
      'dist/result/index.ts': fs.readFileSync(path.join(workspacePackage.path, 'src/result/index.ts'), 'utf8'),
    };
    for (const file of slipped) {
      fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
      fs.copyFileSync(path.join(workspacePackage.path, file), path.join(copy, file));
    }
    for (const [file, content] of Object.entries(fabricated)) {
      fs.writeFileSync(path.join(copy, file), content);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
    manifest.files = [...manifest.files, ...slipped, ...Object.keys(fabricated)];
    fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(manifest));
    const result = packPackage(copy, dir, temporaryFolder());
    assert.ok(result.ok, result.ok ? '' : result.problem);
    const problems = await inspectTarball(fs.readFileSync(result.file), dir, licence);
    const refused = problems.filter((problem) => problem.includes('which nothing reachable from "exports" imports'));
    for (const file of [...slipped, ...Object.keys(fabricated)]) {
      assert.ok(
        refused.some((problem) => problem.includes(` holds ${file},`)),
        `${file} was not refused: ${problems.join('\n')}`,
      );
    }
    assert.equal(refused.length, slipped.length + Object.keys(fabricated).length, problems.join('\n'));
  }
});

test('every file a package needs, taken out of its tarball, is reported', () => {
  for (const [dir, files] of packed) {
    assert.deepEqual(inspectFiles(files, dir, licence), []);
    const manifest = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}');
    const targets = new Set(listEntryTargets(manifest).targets);
    // What imports what, read apart from the inspection: Rollup's parser for the JavaScript, and for the declarations
    // a plain scan of their `from "..."` and `import("...")` specifiers instead of the compiler the inspection runs.
    // The compiler keeps the `.ts` extension of the sources in the declarations it emits, and resolves it to `.d.ts`.
    const imported = new Set<string>();
    for (const [file, bytes] of files) {
      const text = bytes.toString('utf8');
      const specifiers = file.endsWith('.d.ts')
        ? [...text.matchAll(/(?:from|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)].map((match) =>
            (match[1] ?? '').replace(/\.[jt]s$/, '.d.ts'),
          )
        : file.endsWith('.js')
          ? readModule(text).edges.map((edge) => edge.specifier)
          : [];
      for (const specifier of specifiers) {
        imported.add(path.posix.join(path.posix.dirname(file), specifier));
      }
    }
    const documentation = ['package.json', 'README.md', 'LICENSE'];
    const needed = [...files.keys()].filter(
      (file) => documentation.includes(file) || targets.has(file) || imported.has(file),
    );
    // What no one needs is the declaration file of an internal module, which travels with the module it declares.
    for (const file of [...files.keys()].filter((name) => !needed.includes(name))) {
      assert.ok(file.endsWith('.d.ts') && needed.includes(file.replace(/\.d\.ts$/, '.js')), `${file} is not needed`);
    }
    assert.ok(
      needed.some((file) => file.endsWith('.d.ts') && !targets.has(file)),
      'no declaration imported by another',
    );
    for (const file of needed) {
      const without = new Map(files);
      without.delete(file);
      const problems = inspectFiles(without, dir, licence);
      const stem = path.posix.basename(file).replace(/\.(?:d\.ts|js|json|md)$/, '');
      assert.ok(
        problems.some((problem) => problem.includes(stem)),
        `${file} taken out: ${problems.join('\n') || 'nothing reported'}`,
      );
    }
  }
});

test('the targets of every condition of "exports" and of the other entry fields are followed', () => {
  const manifest = {
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' }, './blocked': null, './a': './a.js' },
    main: 'dist/main.js',
    bin: { tool: './bin/tool.js' },
  };
  assert.deepEqual(listEntryTargets(manifest), {
    targets: ['dist/index.d.ts', 'dist/index.js', 'a.js', 'dist/main.js', 'bin/tool.js'],
    problems: [],
  });
  for (const exports of [{ './*': './dist/*.js' }, { '.': '../outside.js' }, { '.': 'dist/index.js' }, { '.': 1 }]) {
    assert.equal(listEntryTargets({ exports }).problems.length, 1, JSON.stringify(exports));
  }
});

test('a relative import is followed to its file, and an import of a missing file is reported', () => {
  const files = new Map([
    ['a.js', Buffer.from("import { b } from './dir/b.js';\nexport const a = b;\n")],
    ['dir/b.js', Buffer.from("export { c as b } from '../c.js';\nexport const d = () => import('./d.js');\n")],
    ['c.js', Buffer.from("import { x } from 'other-package';\nexport const c = x;\n")],
  ]);
  const followed = followJavaScript(files, ['a.js']);
  assert.deepEqual([...followed.reached].sort(), ['a.js', 'c.js', 'dir/b.js']);
  assert.deepEqual(followed.problems, ['dir/b.js line 2 imports ./d.js, which the tarball lacks']);
});

test('an entry outside package/, a path held twice and a licence copied wrong are refused', () => {
  const tarball = writeTarball([
    { path: 'package/package.json', bytes: '{"exports":{}}' },
    { path: 'elsewhere/a.js' },
    { path: 'package/README.md' },
    { path: 'package/README.md' },
  ]);
  const unpacked = unpackFiles(tarball, 'packages/x');
  assert.equal(unpacked.problems.length, 2, unpacked.problems.join('\n'));
  const files = new Map(unpacked.files);
  files.set('LICENSE', Buffer.from('another licence'));
  assert.deepEqual(inspectFiles(files, 'packages/x', licence), [
    "packages/x: the LICENSE of the tarball differs from the repository's LICENSE: copy it again",
  ]);
});

test('publint judges the bytes of the tarball', async () => {
  const manifest = { name: '@yaltaan/x', version: '1.0.0', type: 'module', exports: { '.': './missing.js' } };
  const tarball = writeTarball([
    { path: 'package/package.json', bytes: JSON.stringify(manifest) },
    { path: 'package/README.md' },
    { path: 'package/LICENSE', bytes: licence },
  ]);
  const problems = await inspectTarball(tarball, 'packages/x', licence);
  assert.ok(
    problems.some((problem) => problem.includes('publint FILE_DOES_NOT_EXIST')),
    problems.join('\n'),
  );
});
