// Writes the reference project of the type-cost harness: application code of a fixed shape, generated, so that its
// type-check cost depends only on its size and on the library types it uses.
//
// Every file declares its own `Model`, which extends the shared model of bench/types/model.ts (copied as base.ts) with
// a field whose literal type is unique to the file (so the compiler can reuse nothing between two files, as between
// the models of a real application) and a link to the model of another file. File `i` imports file `floor(i / 10)`:
// a tree of imports ten wide, as deep as an application's feature folders.
//
// A usage, a file of bench/types/usages/, is application code that exercises the public types of the library on a
// `Model` imported from '../model.ts'. The generator appends its code to each file of the project, where `Model` is
// the file's own: its import of '../model.ts' is dropped, its other imports are merged with those of the other usages.
// Two usages that declare the same name fail the compiler, as they would in one application file.

/** The shared model, as the usages import it. */
export const MODEL_IMPORT = '../model.ts';

export interface Usage {
  /** File name without `.ts`: `path-get`. */
  readonly name: string;
  readonly source: string;
}

export interface SplitUsage {
  /** Import declarations other than the one of the shared model, each one statement, trimmed. */
  readonly imports: readonly string[];
  readonly body: string;
}

/**
 * Splits a usage into its leading import declarations and the rest. Throws on an import of the shared model that
 * imports anything but the type `Model`, which the generated file could not provide.
 */
export function splitUsage(usage: Usage): SplitUsage {
  const lines = usage.source.split('\n');
  const imports: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '' || line.startsWith('//')) {
      index += 1;
      continue;
    }
    if (!line.startsWith('import ')) {
      break;
    }
    // A long import is wrapped over several lines by the formatter; it ends at its first semicolon.
    let statement = line;
    while (!statement.trimEnd().endsWith(';') && index + 1 < lines.length) {
      index += 1;
      statement += `\n${lines[index] ?? ''}`;
    }
    index += 1;
    const compact = statement.replace(/\s+/g, ' ').trim();
    if (compact.endsWith(`from '${MODEL_IMPORT}';`)) {
      if (compact !== `import type { Model } from '${MODEL_IMPORT}';`) {
        throw new Error(`usage ${usage.name}: import only the type Model from '${MODEL_IMPORT}'`);
      }
      continue;
    }
    imports.push(compact);
  }
  return { imports, body: lines.slice(index).join('\n').trim() };
}

function applicationCode(file: number): string {
  const parent = Math.floor(file / 10);
  const lines = [
    file === 0 ? '' : `import type { Model as Parent } from './m${parent}.ts';`,
    "import type { Model as Base } from './base.ts';",
    '',
    'export interface Model extends Base {',
    `  readonly kind: 'm${file}';`,
    file === 0 ? '  readonly parent?: undefined;' : '  readonly parent?: Parent;',
    '}',
    '',
    'export type Draft = { -readonly [K in keyof Model]?: Model[K] };',
    'export type Summary = Pick<Model, "id" | "kind" | "total">;',
    '',
    'export function summarize(model: Model): Summary {',
    '  return { id: model.id, kind: model.kind, total: model.total };',
    '}',
    '',
    'export function lineTotal(model: Model): number {',
    '  return model.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);',
    '}',
    '',
    'export function merge(model: Model, draft: Draft): Model {',
    '  return { ...model, ...draft } as Model;',
    '}',
    '',
    'export function tagsOf(models: readonly Model[]): Map<string, number> {',
    '  const counts = new Map<string, number>();',
    '  for (const model of models) {',
    '    for (const tag of model.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);',
    '  }',
    '  return counts;',
    '}',
  ];
  return `${lines.filter((line, index) => index > 0 || line !== '').join('\n')}\n`;
}

/**
 * The files of a reference project of `files` application files (relative path -> content): `base.ts`, a copy of
 * `model`, then `m0.ts` to `m<files - 1>.ts`, each followed by the code of every usage, in the order given.
 */
export function generateProject(files: number, model: string, usages: readonly Usage[]): Map<string, string> {
  if (!Number.isInteger(files) || files < 1) {
    throw new Error(`a reference project needs at least one file, not ${files}`);
  }
  const split = usages.map((usage) => splitUsage(usage));
  const imports = [...new Set(split.flatMap((usage) => usage.imports))];
  const project = new Map<string, string>([['base.ts', model]]);
  for (let file = 0; file < files; file += 1) {
    const parts = [applicationCode(file)];
    if (split.length > 0) {
      parts.push(`${imports.join('\n')}\n`.trimStart(), ...split.map((usage) => `${usage.body}\n`));
    }
    project.set(`m${file}.ts`, parts.filter((part) => part !== '').join('\n'));
  }
  return project;
}
