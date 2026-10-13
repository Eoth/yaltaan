// The contract tags of ARCHITECTURE.md §5.6: the one list of the JSDoc tags a public export may carry, the exports
// each applies to, the values each accepts, and the rules of presence. The checker judges every export against it and
// the tag table of the generated reference is written from it; nothing else lists the tags.

/**
 * What an export is, as far as the contract cares: whether it runs when called (`callable`, `class`) or never runs
 * (`constant`, `type`). `other` is a kind no tag covers yet (a namespace re-export, an enum, a namespace).
 */
export type ExportKind = 'callable' | 'class' | 'constant' | 'type' | 'other';

/** One JSDoc block tag as the compiler reports it: its name without `@`, its text trimmed (`''` when it has none). */
export interface Tag {
  readonly name: string;
  readonly text: string;
}

/** A public export as the rules see it: plain data, never a compiler object. */
export interface PublicExport {
  /** The name under which the subpath exports it; `default` for a default export. */
  readonly name: string;
  readonly kind: ExportKind;
  /** For `other`: what the declaration is, in words (`namespace re-export`). */
  readonly kindDetail: string;
  /** Whether it exists at run time, i.e. the module namespace loaded by the runtime holds it. */
  readonly value: boolean;
  readonly tags: readonly Tag[];
  /** Parameter names of every call or construct signature, in order of first appearance. */
  readonly parameters: readonly string[];
  /** The JSDoc text before the tags, with its line breaks. */
  readonly documentation: string;
  /** The source text of each declaration, JSDoc left out, line endings normalized to `\n`. */
  readonly declarations: readonly string[];
}

type TagValue =
  | { readonly type: 'none' }
  | { readonly type: 'parameter'; readonly rest: boolean }
  | { readonly type: 'choice'; readonly values: readonly string[] }
  | { readonly type: 'pattern'; readonly pattern: RegExp; readonly shape: string }
  | { readonly type: 'text'; readonly alone?: string };

export interface TagDefinition {
  readonly name: string;
  /** `contract`: part of the promise of §5.6, shown in the contract table; `documentary`: free documentation. */
  readonly role: 'contract' | 'documentary';
  readonly appliesTo: readonly ExportKind[];
  /** `required`: exactly once (at least once when `repeat`); a group: exactly one tag name of the group. */
  readonly presence: 'required' | 'optional' | { readonly group: 'mutation' | 'stability' };
  readonly repeat: boolean;
  readonly value: TagValue;
  /** What the tag states, for the reference. */
  readonly meaning: string;
}

const RUNS: readonly ExportKind[] = ['callable', 'class'];
const EVERY: readonly ExportKind[] = ['callable', 'class', 'constant', 'type'];

const NO_VALUE: TagValue = { type: 'none' };
const TEXT: TagValue = { type: 'text' };

export const TAG_DEFINITIONS: readonly TagDefinition[] = [
  {
    name: 'pure',
    role: 'contract',
    appliesTo: RUNS,
    presence: { group: 'mutation' },
    repeat: false,
    value: NO_VALUE,
    meaning: 'Mutates none of its arguments.',
  },
  {
    name: 'mutates',
    role: 'contract',
    appliesTo: RUNS,
    presence: { group: 'mutation' },
    repeat: true,
    value: { type: 'parameter', rest: false },
    meaning: 'Mutates the parameter it names; one tag per mutated parameter.',
  },
  {
    name: 'sharing',
    role: 'contract',
    appliesTo: RUNS,
    presence: 'required',
    repeat: false,
    value: { type: 'choice', values: ['none', 'structural', 'identity-preserving'] },
    meaning:
      'What the result shares with the arguments: nothing, unchanged parts (structural), or the argument itself ' +
      'when nothing changes (identity-preserving).',
  },
  {
    name: 'complexity',
    role: 'contract',
    appliesTo: RUNS,
    presence: 'required',
    repeat: false,
    value: { type: 'pattern', pattern: /^O\(.+\)/, shape: 'starts with `O(`' },
    meaning: 'Time complexity, with what `n` counts.',
  },
  {
    name: 'throws',
    role: 'contract',
    appliesTo: RUNS,
    presence: 'required',
    repeat: true,
    value: { type: 'text', alone: 'never' },
    meaning: '`never`, or one tag per condition under which it throws (a violated precondition: a bug of the caller).',
  },
  {
    name: 'since',
    role: 'contract',
    appliesTo: EVERY,
    presence: 'required',
    repeat: false,
    value: { type: 'pattern', pattern: /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, shape: 'MAJOR.MINOR' },
    meaning: 'The minor version that added the export.',
  },
  {
    name: 'experimental',
    role: 'contract',
    appliesTo: EVERY,
    presence: { group: 'stability' },
    repeat: false,
    value: NO_VALUE,
    meaning: 'May change in a minor version.',
  },
  {
    name: 'stable',
    role: 'contract',
    appliesTo: EVERY,
    presence: { group: 'stability' },
    repeat: false,
    value: NO_VALUE,
    meaning: 'Follows SemVer strictly: changes incompatibly only in a major version.',
  },
  {
    name: 'param',
    role: 'documentary',
    appliesTo: RUNS,
    presence: 'optional',
    repeat: true,
    value: { type: 'parameter', rest: true },
    meaning: 'Describes the parameter it names first.',
  },
  {
    name: 'returns',
    role: 'documentary',
    appliesTo: ['callable'],
    presence: 'optional',
    repeat: false,
    value: TEXT,
    meaning: 'Describes the result.',
  },
  {
    name: 'typeParam',
    role: 'documentary',
    appliesTo: EVERY,
    presence: 'optional',
    repeat: true,
    value: TEXT,
    meaning: 'Describes a type parameter.',
  },
  {
    name: 'example',
    role: 'documentary',
    appliesTo: EVERY,
    presence: 'optional',
    repeat: true,
    value: TEXT,
    meaning: 'An example of use.',
  },
  {
    name: 'see',
    role: 'documentary',
    appliesTo: EVERY,
    presence: 'optional',
    repeat: true,
    value: TEXT,
    meaning: 'A related export or document.',
  },
  {
    name: 'deprecated',
    role: 'documentary',
    appliesTo: EVERY,
    presence: 'optional',
    repeat: false,
    value: TEXT,
    meaning: 'What to use instead.',
  },
];

const DEFINITIONS = new Map(TAG_DEFINITIONS.map((definition) => [definition.name, definition]));

const KIND_NAMES: Readonly<Record<ExportKind, readonly [string, string]>> = {
  callable: ['function', 'functions'],
  class: ['class', 'classes'],
  constant: ['constant', 'constants'],
  type: ['type', 'types'],
  other: ['declaration', 'declarations'],
};

/** The word the messages and the reference use for one export of a kind. */
export function kindName(kind: ExportKind): string {
  return KIND_NAMES[kind][0];
}

/** The word for several exports of a kind. */
export function kindNamePlural(kind: ExportKind): string {
  return KIND_NAMES[kind][1];
}

/** Judges the tags of one export; each problem reads after the export's name (`lacks @since`). */
export function judgeExport(entry: PublicExport): string[] {
  if (entry.kind === 'other') {
    return [`is a ${entry.kindDetail}, which no contract tag covers: export functions, classes, constants and types`];
  }
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const tag of entry.tags) {
    const definition = DEFINITIONS.get(tag.name);
    if (definition === undefined) {
      problems.push(`carries @${tag.name}, which is not a known tag (${describeKnownTags()})`);
      continue;
    }
    if (!definition.appliesTo.includes(entry.kind)) {
      problems.push(`carries @${tag.name}, which does not apply to a ${kindName(entry.kind)}`);
      continue;
    }
    counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    const problem = judgeValue(definition, tag.text, entry.parameters);
    if (problem !== undefined) {
      problems.push(`@${tag.name}: ${problem}`);
    }
  }
  const groups = new Map<string, string[]>();
  for (const definition of TAG_DEFINITIONS) {
    if (!definition.appliesTo.includes(entry.kind)) {
      continue;
    }
    const count = counts.get(definition.name) ?? 0;
    if (!definition.repeat && count > 1) {
      problems.push(`carries @${definition.name} ${count} times: it is written once`);
    }
    if (definition.presence === 'required' && count === 0) {
      problems.push(`lacks @${definition.name}`);
    } else if (typeof definition.presence === 'object') {
      const members = groups.get(definition.presence.group) ?? [];
      members.push(definition.name);
      groups.set(definition.presence.group, members);
    }
  }
  for (const members of groups.values()) {
    const present = members.filter((name) => counts.has(name));
    const listed = members.map((name) => `@${name}`).join(' or ');
    if (present.length === 0) {
      problems.push(`lacks ${listed}`);
    } else if (present.length > 1) {
      problems.push(`carries ${present.map((name) => `@${name}`).join(' and ')}, which exclude each other`);
    }
  }
  problems.push(...judgeRepeats(entry.tags));
  return problems;
}

function judgeValue(definition: TagDefinition, text: string, parameters: readonly string[]): string | undefined {
  const value = definition.value;
  switch (value.type) {
    case 'none':
      return text === '' ? undefined : `takes no value, found ${JSON.stringify(text)}`;
    case 'parameter': {
      const name = value.rest ? (text.split(/\s/, 1)[0] ?? '') : text;
      if (name === '') {
        return 'names no parameter';
      }
      if (!parameters.includes(name)) {
        const known = parameters.length === 0 ? 'it has none' : `its parameters are ${parameters.join(', ')}`;
        return `names ${JSON.stringify(name)}, which is not a parameter (${known})`;
      }
      return undefined;
    }
    case 'choice':
      return value.values.includes(text) ? undefined : `is ${JSON.stringify(text)}, not ${value.values.join(', ')}`;
    case 'pattern':
      return value.pattern.test(text) ? undefined : `is ${JSON.stringify(text)}, which is not ${value.shape}`;
    case 'text':
      return text === '' ? 'has no text' : undefined;
    default:
      return unreachable(value);
  }
}

// Repeatable tags have their own rules: a parameter is mutated once, and `@throws never` excludes any condition.
function judgeRepeats(tags: readonly Tag[]): string[] {
  const problems: string[] = [];
  const mutated = tags.filter((tag) => tag.name === 'mutates').map((tag) => tag.text);
  for (const name of new Set(mutated)) {
    if (mutated.filter((other) => other === name).length > 1) {
      problems.push(`@mutates names ${JSON.stringify(name)} more than once`);
    }
  }
  for (const definition of TAG_DEFINITIONS) {
    if (definition.value.type !== 'text' || definition.value.alone === undefined) {
      continue;
    }
    const texts = tags.filter((tag) => tag.name === definition.name).map((tag) => tag.text);
    if (texts.length > 1 && texts.includes(definition.value.alone)) {
      problems.push(`@${definition.name} ${definition.value.alone} excludes every other @${definition.name}`);
    }
  }
  return problems;
}

function describeKnownTags(): string {
  return `known: ${TAG_DEFINITIONS.map((definition) => `@${definition.name}`).join(', ')}`;
}

/** Describes in words the value a tag accepts, for the reference. */
export function describeValue(definition: TagDefinition): string {
  const value = definition.value;
  switch (value.type) {
    case 'none':
      return 'none';
    case 'parameter':
      return value.rest ? 'a parameter name, then text' : 'a parameter name';
    case 'choice':
      return value.values.map((choice) => `\`${choice}\``).join(', ');
    case 'pattern':
      return value.shape;
    case 'text':
      return value.alone === undefined ? 'text' : `\`${value.alone}\` alone, or text`;
    default:
      return unreachable(value);
  }
}

function unreachable(value: never): never {
  throw new Error(`unhandled tag value ${JSON.stringify(value)}`);
}
