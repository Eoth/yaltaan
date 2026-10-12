// Bundles one import scenario as an application build would, once with esbuild and once with Rollup, and lists the
// files that put code into each output. Both bundlers run as WebAssembly: the same bytes run on every machine, so the
// output does not depend on the operating system.
//
// Rollup's output is minified by esbuild with the settings of the esbuild bundle: the Rollup column measures Rollup's
// tree-shaking, not a second minifier.
import { rollup, type Plugin } from '@rollup/wasm-node';
import { build, transform } from 'esbuild-wasm';
import path from 'node:path';

import { PackageIndex, relativePosix } from './packages.ts';

export type BundlerName = 'esbuild' | 'rollup';

export const BUNDLERS: readonly BundlerName[] = ['esbuild', 'rollup'];

export interface Bundle {
  readonly bundler: BundlerName;
  /** The minified output. */
  readonly code: string;
  /** Files whose code ends up in the output, from the root, with forward slashes, sorted. */
  readonly modules: readonly string[];
  /** Every file the bundler read, in the same form: a file read but shaken out is not in `modules`. */
  readonly loaded: readonly string[];
}

export interface BundleRequest {
  /** Folder that paths are reported from, and where esbuild runs. */
  readonly root: string;
  /** Absolute path of the scenario's entry file. */
  readonly entry: string;
  /** Packages left out of the bundle, as an application leaves out its framework: imports of them stay imports. */
  readonly external: readonly string[];
  readonly packages: PackageIndex;
}

// Output settings shared by both bundlers. Each is written out, defaults included, so that a new esbuild release that
// changes a default changes no measurement.
const OUTPUT = { format: 'esm', target: 'esnext', minify: true, legalComments: 'eof', charset: 'ascii' } as const;

/**
 * Bundles the request with each bundler of `BUNDLERS`, in that order. Callers make one call at a time: esbuild-wasm
 * fails the calls that start while its first one is still running (it then reports an absolute working directory as
 * not absolute).
 */
export async function bundleScenario(request: BundleRequest): Promise<Bundle[]> {
  const esbuildBundle = await bundleWithEsbuild(request);
  return [esbuildBundle, await bundleWithRollup(request)];
}

/** The bare specifiers the entry file imports, each once, in the order of first appearance. */
export async function directImports(root: string, entry: string): Promise<string[]> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    packages: 'external',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const input = result.metafile.inputs[relativePosix(root, entry)];
  if (input === undefined) {
    throw new Error(`esbuild did not report the imports of ${entry}`);
  }
  const local = input.imports.filter((item) => item.external !== true);
  if (local.length > 0) {
    throw new Error(`a scenario imports packages only, not ${local.map((item) => item.path).join(', ')}`);
  }
  return [...new Set(input.imports.map((item) => item.original ?? item.path))];
}

async function bundleWithEsbuild(request: BundleRequest): Promise<Bundle> {
  const result = await build({
    ...OUTPUT,
    absWorkingDir: request.root,
    entryPoints: [request.entry],
    outfile: 'bundle.js',
    bundle: true,
    platform: 'browser',
    treeShaking: true,
    external: request.external.flatMap((name) => [name, `${name}/*`]),
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const [file, ...others] = result.outputFiles;
  const outputs = Object.values(result.metafile.outputs);
  if (file === undefined || others.length > 0 || outputs.length !== 1 || outputs[0] === undefined) {
    throw new Error(`esbuild wrote ${result.outputFiles.length} files: a scenario is measured as one file`);
  }
  return {
    bundler: 'esbuild',
    code: file.text,
    modules: Object.entries(outputs[0].inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([input]) => input)
      .sort(),
    loaded: Object.keys(result.metafile.inputs).sort(),
  };
}

async function bundleWithRollup(request: BundleRequest): Promise<Bundle> {
  const { root, entry, external, packages } = request;
  const unresolved: string[] = [];
  const bundle = await rollup({
    input: entry,
    external: (id) => external.some((name) => id === name || id.startsWith(`${name}/`)),
    plugins: [resolvePackages(packages)],
    treeshake: { moduleSideEffects: (id, isExternal) => isExternal || packages.hasSideEffects(id) },
    // Rollup keeps an import it cannot resolve as an external one, with a mere warning: the bundle would look smaller.
    onLog: (_level, log) => {
      if (log.code === 'UNRESOLVED_IMPORT') {
        unresolved.push(log.message);
      }
    },
  });
  try {
    if (unresolved.length > 0) {
      throw new Error(`Rollup could not resolve: ${unresolved.join('; ')}`);
    }
    const { output } = await bundle.generate({ format: 'es' });
    const [chunk, ...others] = output;
    if (chunk === undefined || others.length > 0) {
      throw new Error(`Rollup wrote ${output.length} files: a scenario is measured as one file`);
    }
    const minified = await transform(chunk.code, { ...OUTPUT, loader: 'js' });
    const fromRoot = (id: string): string => relativePosix(root, path.resolve(id));
    return {
      bundler: 'rollup',
      code: minified.code,
      modules: Object.entries(chunk.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id]) => fromRoot(id))
        .sort(),
      loaded: bundle.watchFiles.map(fromRoot).sort(),
    };
  } finally {
    await bundle.close();
  }
}

// Rollup resolves relative imports by itself; bare ones are resolved here, as esbuild would for a browser build.
function resolvePackages(packages: PackageIndex): Plugin {
  return {
    name: 'size-report-resolve',
    resolveId(source, importer) {
      if (importer === undefined || source.startsWith('\0') || source.startsWith('.') || path.isAbsolute(source)) {
        return null;
      }
      return packages.resolve(source, importer);
    },
  };
}
