// Loading one variant of a scenario file, for the timed process and the allocation process. Both run the JavaScript
// twin of this folder (scripts/perf-time.ts writes it), never a TypeScript file: stripping types in the measured
// process compiles a WebAssembly module on a delayed task, which lands in the measurement or not.
import { pathToFileURL } from 'node:url';

/** The call one variant measures, its input built (the building is never measured). */
export async function loadVariant(file: string, variant: string): Promise<(index: number) => unknown> {
  const module = (await import(pathToFileURL(file).href)) as {
    default?: { readonly variants: Readonly<Record<string, () => (index: number) => unknown>> };
  };
  const prepare = module.default?.variants[variant];
  if (prepare === undefined) {
    throw new Error(`no variant ${variant} in ${file}`);
  }
  return prepare();
}

/** The positive integer an option gives, or an error that names it. */
export function positiveInteger(name: string, text: string | undefined): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${text}`);
  }
  return value;
}
