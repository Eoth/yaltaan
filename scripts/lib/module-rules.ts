// Reads one built JavaScript module with Rollup's parser and reports what the dependency graph check needs: every
// specifier the module imports or re-exports, and every breach of the publishing rules that a single module shows on
// its own (a re-export of another package, code that runs when the module loads).
//
// "Runs when the module loads" is read strictly: the body of a module may only declare. Bundlers disagree on what
// they can prove harmless (Rollup drops a call of a local pure function, esbuild keeps it), so a call is refused even
// when one of them would drop it, and even with a `#__PURE__` annotation: the code still runs.
import { parseAst } from '@rollup/wasm-node/parseAst';

import { splitBareSpecifier } from './packages.ts';

type Program = ReturnType<typeof parseAst>;
type TopLevel = Program['body'][number];
type Expression = Extract<TopLevel, { type: 'ExpressionStatement' }>['expression'];
type VariableDeclaration = Extract<TopLevel, { type: 'VariableDeclaration' }>;
type ExportNamed = Extract<TopLevel, { type: 'ExportNamedDeclaration' }>;

/** How a module reaches another one. */
export type EdgeKind = 'import' | 're-export' | 'dynamic import';

export interface ModuleEdge {
  readonly specifier: string;
  readonly kind: EdgeKind;
  readonly line: number;
}

export interface ModuleFacts {
  readonly edges: readonly ModuleEdge[];
  /** Breaches found in the module alone, each as `line N: message`. */
  readonly problems: readonly string[];
}

/** Parses `code` and reads its edges and its breaches; a syntax error is reported as the only problem. */
export function readModule(code: string): ModuleFacts {
  let program: Program;
  try {
    program = parseAst(code);
  } catch (error) {
    return { edges: [], problems: [`cannot be parsed (${error instanceof Error ? error.message : String(error)})`] };
  }
  return new ModuleReader(code).read(program);
}

class ModuleReader {
  /** Offset of every line feed, to turn a node's start offset into a line number. */
  readonly #lineFeeds: number[] = [];
  readonly #edges: ModuleEdge[] = [];
  readonly #problems: string[] = [];
  /** Local names bound by an import of another package, with the specifier that bound them. */
  readonly #foreignBindings = new Map<string, string>();

  constructor(code: string) {
    for (let index = code.indexOf('\n'); index !== -1; index = code.indexOf('\n', index + 1)) {
      this.#lineFeeds.push(index);
    }
  }

  read(program: Program): ModuleFacts {
    // Imports are hoisted: collect every imported binding before reading the exports that may name one.
    for (const statement of program.body) {
      if (statement.type === 'ImportDeclaration') {
        this.#readImport(statement);
      }
    }
    for (const statement of program.body) {
      this.#readStatement(statement);
    }
    this.#collectDynamicImports(program);
    this.#edges.sort((a, b) => a.line - b.line);
    return { edges: this.#edges, problems: this.#problems };
  }

  #readImport(statement: Extract<TopLevel, { type: 'ImportDeclaration' }>): void {
    const specifier = String(statement.source.value);
    this.#edges.push({ specifier, kind: 'import', line: this.#line(statement) });
    if (statement.specifiers.length === 0) {
      this.#fail(statement, `imports ${specifier} without a binding: such an import exists only to run its code`);
    }
    if (splitBareSpecifier(specifier) !== undefined) {
      for (const binding of statement.specifiers) {
        this.#foreignBindings.set(binding.local.name, specifier);
      }
    }
  }

  #readStatement(statement: TopLevel): void {
    switch (statement.type) {
      case 'ImportDeclaration':
      case 'FunctionDeclaration':
      case 'EmptyStatement':
        return;
      case 'ExportAllDeclaration':
        this.#readReExport(statement, String(statement.source.value));
        return;
      case 'ExportNamedDeclaration':
        this.#readExportNamed(statement);
        return;
      case 'ExportDefaultDeclaration': {
        const declaration = statement.declaration;
        if (declaration.type === 'ClassDeclaration') {
          this.#checkClass(declaration);
        } else if (declaration.type !== 'FunctionDeclaration') {
          this.#checkForeignAlias(statement, declaration);
          this.#checkInitialiser(declaration);
        }
        return;
      }
      case 'ClassDeclaration':
        this.#checkClass(statement);
        return;
      case 'VariableDeclaration':
        this.#checkVariables(statement, false);
        return;
      case 'ExpressionStatement':
        // A directive ("use strict") is a string literal: it declares a mode and runs nothing.
        if ('directive' in statement && typeof statement.directive === 'string') {
          return;
        }
        this.#fail(
          statement,
          `runs code when the module loads: ${firstExecuted(statement.expression)?.what ?? 'an expression'}`,
        );
        return;
      default:
        // Every other statement (if, for, try, a block, a label…) is executed, never declared.
        this.#fail(statement, `runs code when the module loads: a statement (${statement.type})`);
    }
  }

  #readExportNamed(statement: ExportNamed): void {
    if (statement.source) {
      this.#readReExport(statement, String(statement.source.value));
      return;
    }
    for (const exported of statement.specifiers) {
      if (exported.local.type === 'Identifier') {
        const from = this.#foreignBindings.get(exported.local.name);
        if (from !== undefined) {
          this.#fail(
            statement,
            `re-exports ${exported.local.name}, imported from ${from}: no barrel of another package`,
          );
        }
      }
    }
    const declaration = statement.declaration;
    if (declaration?.type === 'ClassDeclaration') {
      this.#checkClass(declaration);
    } else if (declaration?.type === 'VariableDeclaration') {
      this.#checkVariables(declaration, true);
    }
  }

  #readReExport(statement: TopLevel, specifier: string): void {
    this.#edges.push({ specifier, kind: 're-export', line: this.#line(statement) });
    if (splitBareSpecifier(specifier) !== undefined) {
      this.#fail(statement, `re-exports ${specifier}: no barrel of another package`);
    }
  }

  #checkVariables(declaration: VariableDeclaration, exported: boolean): void {
    if (declaration.kind !== 'const' && declaration.kind !== 'let' && declaration.kind !== 'var') {
      this.#fail(declaration, `a "${declaration.kind}" declaration disposes of its value when the module ends`);
      return;
    }
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier') {
        this.#fail(declarator, 'a destructuring declaration reads properties or iterates when the module loads');
      }
      if (declarator.init) {
        if (exported) {
          this.#checkForeignAlias(declarator, declarator.init);
        }
        this.#checkInitialiser(declarator.init);
      }
    }
  }

  // `export const y = x` and `export default x`, with `x` imported from another package, re-export it under the
  // package's own name, as a barrel would.
  #checkForeignAlias(at: object, value: Expression): void {
    if (value.type === 'Identifier') {
      const from = this.#foreignBindings.get(value.name);
      if (from !== undefined) {
        this.#fail(at, `re-exports ${value.name}, imported from ${from}: no barrel of another package`);
      }
    }
  }

  #checkInitialiser(value: Expression): void {
    const breach = firstExecuted(value);
    if (breach !== undefined) {
      this.#fail(breach.node, `runs code when the module loads: ${breach.what}`);
    }
  }

  #checkClass(node: object): void {
    const breach = firstExecutedInClass(node);
    if (breach !== undefined) {
      this.#fail(breach.node, `runs code when the module loads: ${breach.what}`);
    }
  }

  // `import()` can sit inside a function that never runs at load, but it is an edge all the same: every node of the
  // tree is visited.
  #collectDynamicImports(program: Program): void {
    for (const node of descendants(program)) {
      if (Reflect.get(node, 'type') !== 'ImportExpression') {
        continue;
      }
      const source: unknown = Reflect.get(node, 'source');
      const value = isNode(source) && Reflect.get(source, 'type') === 'Literal' ? Reflect.get(source, 'value') : null;
      if (typeof value === 'string') {
        this.#edges.push({ specifier: value, kind: 'dynamic import', line: this.#line(node) });
      } else {
        this.#fail(node, 'imports a computed specifier: every edge of the graph must be readable');
      }
    }
  }

  #fail(node: object, message: string): void {
    this.#problems.push(`line ${this.#line(node)}: ${message}`);
  }

  #line(node: object): number {
    const start: unknown = Reflect.get(node, 'start');
    const offset = typeof start === 'number' ? start : 0;
    const before = this.#lineFeeds.findIndex((lineFeed) => lineFeed >= offset);
    return (before === -1 ? this.#lineFeeds.length : before) + 1;
  }
}

/** The node that runs code, and what it runs, in words. */
interface Breach {
  readonly node: object;
  readonly what: string;
}

// The first node of `value` that runs code when it is evaluated, or undefined if evaluating it only builds values
// from literals, functions, classes and bindings. A property read can run a getter, and a conversion (`o + 1`,
// `${o}`, a computed key `[o]`) can run `valueOf` or `toString`: esbuild keeps both in a bundle that never uses the
// value, so both are refused, except on constants and on the well-known symbols. A node type not listed runs code: a
// syntax this list does not know is refused, never assumed harmless.
function firstExecuted(value: object): Breach | undefined {
  const type: unknown = Reflect.get(value, 'type');
  const child = (key: string): Breach | undefined => firstOf(nodesOf(value, key));
  switch (type) {
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
    case 'MetaProperty':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return undefined;
    case 'ClassExpression':
      return firstExecutedInClass(value);
    case 'TemplateLiteral':
      return (
        child('expressions') ?? firstNotConstant(nodesOf(value, 'expressions'), 'an interpolation, which converts')
      );
    case 'ArrayExpression':
      return child('elements');
    case 'ObjectExpression':
      return child('properties');
    case 'SequenceExpression':
      return child('expressions');
    case 'Property':
      return checkKey(value) ?? child('value');
    case 'UnaryExpression': {
      const operator: unknown = Reflect.get(value, 'operator');
      if (operator === 'delete') {
        return { node: value, what: 'a "delete"' };
      }
      // `!`, `typeof` and `void` never call code of the operand; `-`, `+` and `~` convert it.
      if (operator === '!' || operator === 'typeof' || operator === 'void' || isConstant(value)) {
        return child('argument');
      }
      return child('argument') ?? { node: value, what: `a "${String(operator)}", which converts its operand` };
    }
    case 'BinaryExpression': {
      // Only the strict equalities never convert an operand nor call a trap.
      const operator: unknown = Reflect.get(value, 'operator');
      const breach = child('left') ?? child('right');
      return operator === '===' || operator === '!=='
        ? breach
        : (breach ?? { node: value, what: `a "${String(operator)}", which converts its operands or calls a trap` });
    }
    case 'LogicalExpression':
      return child('left') ?? child('right');
    case 'ConditionalExpression':
      return child('test') ?? child('consequent') ?? child('alternate');
    case 'MemberExpression':
      return isWellKnownSymbol(value) ? undefined : { node: value, what: 'a property read, which may run a getter' };
    default:
      return { node: value, what: describe(value) };
  }
}

// What a class evaluates when its declaration runs: decorators, the superclass, computed keys, static field values and
// static blocks. Instance field values and method bodies run later, on construction or call.
function firstExecutedInClass(node: object): Breach | undefined {
  if (hasDecorators(node)) {
    return { node, what: 'a decorator' };
  }
  const inSuper = firstOf(nodesOf(node, 'superClass'));
  if (inSuper !== undefined) {
    return inSuper;
  }
  for (const body of nodesOf(node, 'body')) {
    for (const member of nodesOf(body, 'body')) {
      const type: unknown = Reflect.get(member, 'type');
      if (type === 'StaticBlock') {
        return { node: member, what: 'a static block' };
      }
      if (hasDecorators(member)) {
        return { node: member, what: 'a decorator' };
      }
      const isStaticField =
        (type === 'PropertyDefinition' || type === 'AccessorProperty') && Reflect.get(member, 'static') === true;
      const breach = checkKey(member) ?? (isStaticField ? firstOf(nodesOf(member, 'value')) : undefined);
      if (breach !== undefined) {
        return breach;
      }
    }
  }
  return undefined;
}

// A computed key is converted to a property key when the object or the class is built.
function checkKey(member: object): Breach | undefined {
  if (Reflect.get(member, 'computed') !== true) {
    return undefined;
  }
  const keys = nodesOf(member, 'key').filter((key) => !isWellKnownSymbol(key));
  return firstOf(keys) ?? firstNotConstant(keys, 'a computed key from a binding, which converts it');
}

// A literal, or a signed number literal (`-1`). Even between literals, esbuild keeps an arithmetic or bitwise operation
// (`2 ** 53 - 1`, `~1`) in a bundle that never uses its result: a module writes the resulting literal instead.
function isConstant(node: object): boolean {
  const type: unknown = Reflect.get(node, 'type');
  if (type === 'Literal') {
    return true;
  }
  const operator: unknown = Reflect.get(node, 'operator');
  const [argument] = nodesOf(node, 'argument');
  const value: unknown = argument === undefined ? undefined : Reflect.get(argument, 'value');
  return (
    type === 'UnaryExpression' &&
    (operator === '-' || operator === '+') &&
    Reflect.get(argument ?? {}, 'type') === 'Literal' &&
    (typeof value === 'number' || typeof value === 'bigint')
  );
}

function firstNotConstant(nodes: readonly object[], what: string): Breach | undefined {
  const node = nodes.find((candidate) => !isConstant(candidate));
  return node === undefined ? undefined : { node, what };
}

function firstOf(nodes: readonly object[]): Breach | undefined {
  for (const node of nodes) {
    const breach = firstExecuted(node);
    if (breach !== undefined) {
      return breach;
    }
  }
  return undefined;
}

// `Symbol.iterator` and its siblings are non-writable, non-configurable data properties of the global `Symbol`:
// reading one runs no code, and both bundlers drop it.
function isWellKnownSymbol(node: object): boolean {
  const [object] = nodesOf(node, 'object');
  const [property] = nodesOf(node, 'property');
  return (
    Reflect.get(node, 'type') === 'MemberExpression' &&
    Reflect.get(node, 'computed') === false &&
    object !== undefined &&
    Reflect.get(object, 'type') === 'Identifier' &&
    Reflect.get(object, 'name') === 'Symbol' &&
    property !== undefined &&
    Reflect.get(property, 'type') === 'Identifier'
  );
}

/** The child nodes under `key`, whether it holds one node, an array of nodes (holes skipped) or nothing. */
function nodesOf(node: object, key: string): object[] {
  const value: unknown = Reflect.get(node, key);
  return (Array.isArray(value) ? value : [value]).filter(isNode);
}

function hasDecorators(node: object): boolean {
  const decorators: unknown = Reflect.get(node, 'decorators');
  return Array.isArray(decorators) && decorators.length > 0;
}

function isNode(value: unknown): value is object {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';
}

function* descendants(node: object): Generator<object> {
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isNode(item)) {
        yield item;
        yield* descendants(item);
      }
    }
  }
}

function describe(node: object): string {
  const type: unknown = Reflect.get(node, 'type');
  switch (type) {
    case 'CallExpression':
      return 'a call';
    case 'NewExpression':
      return 'a "new"';
    case 'TaggedTemplateExpression':
      return 'a tagged template';
    case 'AssignmentExpression':
      return 'an assignment';
    case 'UpdateExpression':
      return 'an update';
    case 'AwaitExpression':
      return 'an "await"';
    case 'SpreadElement':
      return 'a spread, which iterates or reads every property';
    case 'ImportExpression':
      return 'an "import()"';
    case 'ChainExpression':
      return 'an optional chain, which reads a property';
    default:
      return `a ${String(type)}`;
  }
}
