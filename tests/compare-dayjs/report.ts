// What a comparison says, from what each side answered: per family, the number of cases, how many agree, and for each
// way of disagreeing how many cases and the smallest one. A pure function of its input, so that the report of two runs
// compares by its bytes, and a changed verdict shows as a changed line.

export interface Case {
  readonly args: readonly (string | number)[];
  /** One answer per side; a side that does not apply to a case is absent. */
  readonly answers: Readonly<Record<string, string>>;
}

export interface Example {
  readonly signature: string;
  readonly count: number;
  readonly args: readonly (string | number)[];
  readonly answers: Readonly<Record<string, string>>;
}

export interface FamilySummary {
  readonly family: string;
  readonly cases: number;
  readonly agree: number;
  readonly dayjsWrong: number;
  readonly temporalWrong: number;
  readonly javaAlone: number;
  readonly undecided: number;
  readonly sidesApart: number;
  /** Among the cases where dayjs differs and answers a stamp: only the wall clock, only the instant, both. */
  readonly stamps: { readonly wall: number; readonly instant: number; readonly both: number };
  /** Among the cases where Temporal differs and answers a stamp: those where only the instant differs. */
  readonly temporalSameWall: number;
  readonly examples: readonly Example[];
}

const REFEREE = 'java.time';
const NATIVE = 'native';
const POLYFILL = 'polyfill';
const DAYJS = 'dayjs';

/** The sides grouped by answer: `dayjs | java.time=native=polyfill`, stable whatever the order of the sides. */
export function signatureOf(answers: Readonly<Record<string, string>>): string {
  const groups = new Map<string, string[]>();
  for (const side of Object.keys(answers).sort()) {
    const answer = answers[side] ?? '';
    groups.set(answer, [...(groups.get(answer) ?? []), side]);
  }
  return [...groups.values()]
    .map((sides) => sides.join('='))
    .sort()
    .join(' | ');
}

const STAMP = /^(-?\d+-\d+-\d+T\d+:\d+:\d+\.\d+) (-?\d+)$/;

/** How a stamp differs from another: 'wall', 'instant' or 'both'; undefined unless both are stamps and they differ. */
export function stampDifference(a: string, b: string): 'wall' | 'instant' | 'both' | undefined {
  const left = STAMP.exec(a);
  const right = STAMP.exec(b);
  if (left === null || right === null || a === b) {
    return undefined;
  }
  if (left[1] === right[1]) {
    return 'instant';
  }
  return left[2] === right[2] ? 'wall' : 'both';
}

const sizeKey = (args: readonly (string | number)[]): string => JSON.stringify(args);

/** Shorter first, then by text: the smallest example of a disagreement is a fact of the cases, not of their order. */
export function smaller(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  const left = sizeKey(a);
  const right = sizeKey(b);
  return left.length < right.length || (left.length === right.length && left < right);
}

export function summarize(family: string, cases: readonly Case[]): FamilySummary {
  let agree = 0;
  let dayjsWrong = 0;
  let temporalWrong = 0;
  let javaAlone = 0;
  let undecided = 0;
  let sidesApart = 0;
  const stamps = { wall: 0, instant: 0, both: 0 };
  let temporalSameWall = 0;
  const examples = new Map<string, Case & { count: number }>();
  for (const one of cases) {
    const { answers } = one;
    const distinct = new Set(Object.values(answers));
    if (distinct.size <= 1) {
      agree += 1;
      continue;
    }
    const java = answers[REFEREE];
    const native = answers[NATIVE];
    const dayjs = answers[DAYJS];
    if (native !== undefined && answers[POLYFILL] !== undefined && native !== answers[POLYFILL]) {
      sidesApart += 1;
    }
    if (java === undefined || native === undefined || dayjs === undefined) {
      undecided += 1;
    } else if (dayjs !== java && native === java) {
      dayjsWrong += 1;
      const difference = stampDifference(dayjs, java);
      if (difference !== undefined) {
        stamps[difference] += 1;
      }
    } else if (native !== java && dayjs === java) {
      temporalWrong += 1;
      if (stampDifference(native, java) === 'instant') {
        temporalSameWall += 1;
      }
    } else if (native === dayjs && java !== native) {
      javaAlone += 1;
    } else {
      undecided += 1;
    }
    const signature = signatureOf(answers);
    const held = examples.get(signature);
    if (held === undefined) {
      examples.set(signature, { ...one, count: 1 });
    } else {
      held.count += 1;
      if (smaller(one.args, held.args)) {
        examples.set(signature, { ...one, count: held.count });
      }
    }
  }
  return {
    family,
    cases: cases.length,
    agree,
    dayjsWrong,
    temporalWrong,
    javaAlone,
    undecided,
    sidesApart,
    stamps,
    temporalSameWall,
    examples: [...examples]
      .map(([signature, held]) => ({ signature, count: held.count, args: held.args, answers: held.answers }))
      .sort((a, b) => b.count - a.count || (a.signature < b.signature ? -1 : 1)),
  };
}

const escapeCell = (text: string): string => text.replaceAll('|', '\\|');

/** The report: one table, then the smallest example of each way of disagreeing. */
export function formatReport(
  preamble: readonly string[],
  summaries: readonly FamilySummary[],
  notes: readonly string[] = [],
): string {
  const lines = [...preamble, ''];
  lines.push(
    '| Family | Cases | All agree | dayjs differs | Temporal differs | java.time alone | Undecided ' +
      '| Native and polyfill differ |',
  );
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  const total = { cases: 0, agree: 0, dayjsWrong: 0, temporalWrong: 0, javaAlone: 0, undecided: 0, sidesApart: 0 };
  for (const s of summaries) {
    const row = [s.cases, s.agree, s.dayjsWrong, s.temporalWrong, s.javaAlone, s.undecided, s.sidesApart];
    lines.push(`| ${s.family} | ${row.join(' | ')} |`);
    total.cases += s.cases;
    total.agree += s.agree;
    total.dayjsWrong += s.dayjsWrong;
    total.temporalWrong += s.temporalWrong;
    total.javaAlone += s.javaAlone;
    total.undecided += s.undecided;
    total.sidesApart += s.sidesApart;
  }
  lines.push(`| **All** | ${Object.values(total).join(' | ')} |`, '');
  if (notes.length > 0) {
    lines.push('## How to read it', '', ...notes, '');
  }
  const stamped = summaries.filter(
    ({ stamps, temporalSameWall }) => stamps.wall + stamps.instant + stamps.both + temporalSameWall > 0,
  );
  if (stamped.length > 0) {
    lines.push('## How the stamps differ', '');
    lines.push(
      '| Family | dayjs: only the wall clock | dayjs: only the instant | dayjs: both | Temporal: only the instant |',
      '|---|---:|---:|---:|---:|',
    );
    for (const { family, stamps, temporalSameWall } of stamped) {
      lines.push(`| ${family} | ${stamps.wall} | ${stamps.instant} | ${stamps.both} | ${temporalSameWall} |`);
    }
    lines.push('');
  }
  lines.push('## The smallest example of each disagreement');
  for (const s of summaries) {
    if (s.examples.length === 0) {
      continue;
    }
    lines.push('', `### ${s.family}`, '');
    for (const example of s.examples) {
      const sides = Object.keys(example.answers)
        .sort()
        .map((side) => `${side}: \`${escapeCell(example.answers[side] ?? '')}\``)
        .join('; ');
      const args = escapeCell(JSON.stringify(example.args));
      lines.push(`- \`${escapeCell(example.signature)}\`, ${example.count} cases. \`${args}\` → ${sides}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The lines of a recorded report that a new run no longer gives, and those it adds; empty when identical. */
export function reportDifferences(recorded: string, current: string): string[] {
  const old = recorded.split('\n');
  const now = current.split('\n');
  const known = new Set(old);
  const fresh = new Set(now);
  return [
    ...old.filter((line) => !fresh.has(line)).map((line) => `- ${line}`),
    ...now.filter((line) => !known.has(line)).map((line) => `+ ${line}`),
  ];
}
