// Reads the public exports of declaration files through the compiler of this repository. TypeScript 7 answers
// through `typescript/unstable/sync`, an API that may change in any release: this file is the only one that imports
// it, and it hands out plain data, so that an upgrade that changes the API is repaired here and nowhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SyntaxKind } from 'typescript/unstable/ast';
import { API, SignatureKind, SymbolFlags } from 'typescript/unstable/sync';
import type { Checker, Project, Symbol as CompilerSymbol } from 'typescript/unstable/sync';

import type { ExportKind, PublicExport } from './contract-tags.ts';
import { describeError } from './workspace.ts';

/** The exports of each file read, in code-unit order of their names, or the problem that kept the file unread. */
export type DeclarationsRead =
  | { readonly ok: true; readonly modules: ReadonlyMap<string, readonly PublicExport[]> }
  | { readonly ok: false; readonly problem: string };

/**
 * Reads the exports of every file of `files` (absolute paths of `.d.ts` files) in one compiler process. A file the
 * compiler does not load, or that is not a module, is a problem: nothing passes unread.
 */
export function readDeclarations(files: readonly string[]): DeclarationsRead {
  if (files.length === 0) {
    return { ok: true, modules: new Map() };
  }
  // The program is described by a configuration of its own, written outside the checked repository, so that the
  // packages' build configurations, which compile sources, play no part in reading what they emitted.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-declarations-'));
  const config = path.join(folder, 'tsconfig.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: { noEmit: true, module: 'nodenext', target: 'es2023', lib: ['es2023'], types: [] },
      files,
    }),
  );
  let api: API | undefined;
  try {
    api = new API({ cwd: folder });
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProjects()[0];
    if (project === undefined) {
      return { ok: false, problem: 'the compiler opened no project for the declaration files' };
    }
    const modules = new Map<string, readonly PublicExport[]>();
    for (const file of files) {
      const read = readModule(project, file);
      if (typeof read === 'string') {
        return { ok: false, problem: `${file}: ${read}` };
      }
      modules.set(file, read);
    }
    return { ok: true, modules };
  } catch (error) {
    return { ok: false, problem: `the compiler could not read the declaration files (${describeError(error)})` };
  } finally {
    api?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function readModule(project: Project, file: string): PublicExport[] | string {
  const { checker, program } = project;
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) {
    return 'the compiler did not load it';
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    return 'is not a module: it has no import or export statement';
  }
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => readExport(project, checker, symbol))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function readExport(project: Project, checker: Checker, symbol: CompilerSymbol): PublicExport {
  const target = (symbol.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const type = checker.getTypeOfSymbol(target);
  const calls = type === undefined ? [] : checker.getSignaturesOfType(type, SignatureKind.Call);
  const constructs = type === undefined ? [] : checker.getSignaturesOfType(type, SignatureKind.Construct);
  const parameters = new Set<string>();
  for (const signature of [...calls, ...constructs]) {
    for (const parameter of signature.getParameters()) {
      parameters.add(parameter.name);
    }
  }
  const { kind, detail } = kindOf(checker, target, calls.length > 0, constructs.length > 0);
  return {
    name: symbol.name,
    kind,
    kindDetail: detail,
    value: (target.flags & SymbolFlags.Value) !== 0,
    tags: checker.getJsDocTagsOfSymbol(target).map((tag) => ({ name: tag.name, text: (tag.text ?? '').trim() })),
    parameters: [...parameters],
    documentation: normalize(checker.getDocumentationCommentOfSymbol(target)).trim(),
    declarations: target.declarations.flatMap((handle) => {
      const node = handle.resolve(project);
      if (node === undefined) {
        return [];
      }
      // A variable's declaration is one declarator of its statement: the statement shows `export declare const`.
      const statement = node.parent?.parent;
      const shown = node.kind === SyntaxKind.VariableDeclaration && statement !== undefined ? statement : node;
      return [normalize(shown.getText())];
    }),
  };
}

function kindOf(
  checker: Checker,
  target: CompilerSymbol,
  callable: boolean,
  constructible: boolean,
): { readonly kind: ExportKind; readonly detail: string } {
  const flags = target.flags;
  if (checker.isUnknownSymbol(target)) {
    return { kind: 'other', detail: 're-export the compiler cannot resolve' };
  }
  if ((flags & SymbolFlags.Class) !== 0) {
    return { kind: 'class', detail: 'class' };
  }
  if ((flags & SymbolFlags.Function) !== 0) {
    return { kind: 'callable', detail: 'function' };
  }
  if ((flags & SymbolFlags.Variable) !== 0) {
    if (callable) {
      return { kind: 'callable', detail: 'function' };
    }
    return constructible ? { kind: 'class', detail: 'class' } : { kind: 'constant', detail: 'constant' };
  }
  if ((flags & (SymbolFlags.Interface | SymbolFlags.TypeAlias)) !== 0) {
    return { kind: 'type', detail: 'type' };
  }
  if ((flags & SymbolFlags.Enum) !== 0) {
    return { kind: 'other', detail: 'enum' };
  }
  if ((flags & (SymbolFlags.ValueModule | SymbolFlags.NamespaceModule)) !== 0) {
    return { kind: 'other', detail: 'namespace or namespace re-export' };
  }
  return { kind: 'other', detail: 'declaration of an unknown kind' };
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
