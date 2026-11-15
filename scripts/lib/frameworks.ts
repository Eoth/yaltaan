// What Node loads before a module of an adapter, so that the module loads as it does in an application. Angular's
// packages are partially compiled: the build of an Angular application links them, and Node, which does not, loads
// them only once Angular's JIT compiler is loaded (`import '@angular/compiler'`, as Angular's own error says). Each
// entry names a peer of an adapter and the module loaded first, resolved from the adapter's folder.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOADED_FIRST: ReadonlyMap<string, string> = new Map([['@angular/core', '@angular/compiler']]);

/** Loads what the peers of the package in `dir` need loaded before its modules; nothing for a package without peers. */
export async function loadFrameworks(dir: string, peers: Iterable<string>): Promise<void> {
  const require = createRequire(path.join(dir, 'package.json'));
  for (const peer of peers) {
    const first = LOADED_FIRST.get(peer);
    if (first !== undefined) {
      await import(pathToFileURL(require.resolve(first)).href);
    }
  }
}
