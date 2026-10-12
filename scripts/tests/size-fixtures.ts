// Throwaway package trees for the size report's tests: a root folder holding scenarios, a budget file and a
// node_modules folder of fabricated packages, so that a test decides exactly what each bundler sees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Files = Readonly<Record<string, string>>;

const roots: string[] = [];

/** Writes `files` (path from the root -> content) into a new folder and returns its absolute path. */
export function fixture(files: Files): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-size-'));
  roots.push(root);
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: Files): void {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

/** Removes every folder `fixture` made; call it from `after`. */
export function removeFixtures(): void {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A package.json and its modules, under node_modules/<name>/. */
export function fabricatedPackage(
  name: string,
  manifest: Readonly<Record<string, unknown>>,
  modules: Files,
): Record<string, string> {
  const files: Record<string, string> = {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', type: 'module', ...manifest }),
  };
  for (const [relative, content] of Object.entries(modules)) {
    files[`node_modules/${name}/${relative}`] = content;
  }
  return files;
}

export const BUDGET_HEADER = 'scenario\tbrotli\tbasis\n';
