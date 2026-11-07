// Reads the public exports of declaration files through the compiler of this repository. TypeScript 7 answers
// through `typescript/unstable/sync`, an API that may change in any release: this file is the only one that imports
// it, and it hands out plain data, so that an upgrade that changes the API is repaired here and nowhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SyntaxKind } from 'typescript/unstable/ast';
import type { Node } from 'typescript/unstable/ast';
import { API, SignatureKind, SymbolFlags } from 'typescript/unstable/sync';
import type { Checker, NodeHandle, Project, Symbol as CompilerSymbol, Type } from 'typescript/unstable/sync';

import type { ExportKind, PublicExport, PublicMember } from './contract-tags.ts';
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
      // Strict, as the packages are built and read by users: an optional member's type is its function or
      // `undefined`, never widened to `any`.
      compilerOptions: { noEmit: true, strict: true, module: 'nodenext', target: 'es2023', lib: ['es2023'], types: [] },
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
    // Every export of every file is listed first: a member declared by an exported type is judged there, never again
    // where another export inherits or reaches it. A type alias counts by the type it names, which declares members.
    const listed = new Map<string, readonly CompilerSymbol[]>();
    for (const file of files) {
      const symbols = listExports(project, file);
      if (typeof symbols === 'string') {
        return { ok: false, problem: `${file}: ${symbols}` };
      }
      listed.set(file, symbols);
    }
    const exported = new Set<number>();
    for (const symbol of [...listed.values()].flat()) {
      const target = targetOf(project.checker, symbol);
      exported.add(target.id);
      if ((target.flags & SymbolFlags.TypeAlias) !== 0) {
        const named = project.checker.getDeclaredTypeOfSymbol(target).getSymbol();
        if (named !== undefined) {
          exported.add(named.id);
        }
      }
    }
    const modules = new Map<string, readonly PublicExport[]>();
    for (const [file, symbols] of listed) {
      modules.set(file, symbols.map((symbol) => readExport(project, symbol, exported)).sort(byName));
    }
    return { ok: true, modules };
  } catch (error) {
    return { ok: false, problem: `the compiler could not read the declaration files (${describeError(error)})` };
  } finally {
    api?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function listExports(project: Project, file: string): readonly CompilerSymbol[] | string {
  const { checker, program } = project;
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) {
    return 'the compiler did not load it';
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    return 'is not a module: it has no import or export statement';
  }
  return checker.getExportsOfModule(moduleSymbol);
}

function byName<T extends { readonly name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function targetOf(checker: Checker, symbol: CompilerSymbol): CompilerSymbol {
  return (symbol.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

function readExport(project: Project, symbol: CompilerSymbol, exported: ReadonlySet<number>): PublicExport {
  const { checker } = project;
  const target = targetOf(checker, symbol);
  const type = checker.getTypeOfSymbol(target);
  const calls = type === undefined ? [] : checker.getSignaturesOfType(type, SignatureKind.Call);
  const constructs = type === undefined ? [] : checker.getSignaturesOfType(type, SignatureKind.Construct);
  const { kind, detail } = kindOf(checker, target, calls.length > 0, constructs.length > 0);
  const members = kind === 'other' ? [] : readMembers(project, target, exported);
  return {
    name: symbol.name,
    kind,
    kindDetail: detail,
    value: (target.flags & SymbolFlags.Value) !== 0,
    tags: tagsOf(checker, target),
    parameters: parameterNames([...calls, ...constructs]),
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
    members,
  };
}

function tagsOf(checker: Checker, symbol: CompilerSymbol): PublicExport['tags'] {
  return checker.getJsDocTagsOfSymbol(symbol).map((tag) => ({ name: tag.name, text: (tag.text ?? '').trim() }));
}

function parameterNames(signatures: readonly { getParameters(): readonly CompilerSymbol[] }[]): string[] {
  const parameters = new Set<string>();
  for (const signature of signatures) {
    for (const parameter of signature.getParameters()) {
      parameters.add(parameter.name);
    }
  }
  return [...parameters];
}

// The members of an export that a caller can call: methods, and properties whose type is a function (`undefined`
// aside, for an optional one). A class has two sets, its instance's (shown under `prototype`) and its own; any other
// export has those of its type, or of its value for a constant or a function. Members of the standard library and of
// dependencies are left out. A member is judged where the type that declares it is exported: one declared by the
// export itself, or by a type no file exports, is read here, inherited or reached through a property whose type holds
// it (`.~standard.validate`); one declared by another exported type is left to that export.
function readMembers(project: Project, owner: CompilerSymbol, exported: ReadonlySet<number>): PublicMember[] {
  const { checker } = project;
  const sets: { readonly prefix: string; readonly type: Type | undefined }[] = [];
  if ((owner.flags & SymbolFlags.Class) !== 0) {
    sets.push({ prefix: '.prototype', type: checker.getDeclaredTypeOfSymbol(owner) });
  } else if ((owner.flags & (SymbolFlags.Interface | SymbolFlags.TypeAlias)) !== 0) {
    sets.push({ prefix: '', type: checker.getDeclaredTypeOfSymbol(owner) });
  }
  if ((owner.flags & (SymbolFlags.Class | SymbolFlags.Variable | SymbolFlags.Function)) !== 0) {
    sets.push({ prefix: '', type: checker.getTypeOfSymbol(owner) });
  }
  // The export itself, and for a type alias the type it names, which declares the members.
  const own = new Set([owner.id]);
  const named =
    (owner.flags & SymbolFlags.TypeAlias) !== 0 ? checker.getDeclaredTypeOfSymbol(owner).getSymbol() : undefined;
  if (named !== undefined) {
    own.add(named.id);
  }
  // Breadth first, so that a member reached twice is read once, under its shortest name; each property being read
  // once, a type that holds itself ends the walk.
  const queue = [...sets];
  const read = new Set<number>();
  const members: PublicMember[] = [];
  // An array iterator reads the length at each step: what the loop pushes is visited after what was there.
  for (const { prefix, type } of queue) {
    for (const property of type === undefined ? [] : checker.getPropertiesOfType(type)) {
      const parent = property.getParent();
      if (
        read.has(property.id) ||
        !property.declarations.some((handle) => !isLibrary(handle)) ||
        (parent !== undefined && !own.has(parent.id) && exported.has(parent.id))
      ) {
        continue;
      }
      read.add(property.id);
      const nodes = property.declarations.flatMap((handle) => handle.resolve(project) ?? []);
      const name = `${prefix}${memberName(property, nodes[0])}`;
      const propertyType = checker.getTypeOfSymbol(property);
      const value = propertyType === undefined ? undefined : checker.getNonNullableType(propertyType);
      const calls = value === undefined ? [] : checker.getSignaturesOfType(value, SignatureKind.Call);
      if (calls.length > 0 || (property.flags & SymbolFlags.Method) !== 0) {
        members.push({
          name,
          tags: tagsOf(checker, property),
          parameters: parameterNames(calls),
          documentation: normalize(checker.getDocumentationCommentOfSymbol(property)).trim(),
          declarations: nodes.map((node) => normalize(node.getText())),
        });
        continue;
      }
      const held = value?.isObjectType() === true ? value.getSymbol() : undefined;
      if (held !== undefined && held.declarations.some((handle) => !isLibrary(handle))) {
        queue.push({ prefix: name, type: value });
      }
    }
  }
  return members.sort(byName);
}

function isLibrary(handle: NodeHandle): boolean {
  return handle.path.includes('/node_modules/');
}

// `.name`, or the written key of a computed one: `[Symbol.iterator]`, whose symbol name the compiler numbers.
function memberName(property: CompilerSymbol, node: Node | undefined): string {
  const key = (node as { readonly name?: { readonly kind: SyntaxKind; getText(): string } } | undefined)?.name;
  return key?.kind === SyntaxKind.ComputedPropertyName ? key.getText() : `.${property.name}`;
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
