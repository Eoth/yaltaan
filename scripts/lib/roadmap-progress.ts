// The progress column of the roadmap's execution order, derived from its closed table: for each lot, the steps closed
// out of the steps listed, and the next one; above the table, the same count for the whole roadmap. The closed table
// is the only record of what is closed, so the column is computed from it, never kept by hand.

/** The steps of a cell of the execution order: `T0.4 a, b` lists `T0.4 a` and `T0.4 b`. */
export function parseSteps(cell: string): string[] {
  const steps: string[] = [];
  let ticket = '';
  for (const token of cell.split(',').map((part) => part.trim())) {
    const full = /^(T\d+\.\d+)(?: ([a-z]))?$/.exec(token);
    if (full !== null) {
      ticket = full[1] ?? '';
      steps.push(full[2] === undefined ? ticket : `${ticket} ${full[2]}`);
    } else if (/^[a-z]$/.test(token) && ticket !== '') {
      steps.push(`${ticket} ${token}`);
    } else {
      throw new Error(`not a ticket or a step of the previous ticket: "${token}" in "${cell}"`);
    }
  }
  return steps;
}

/** What the closed table closes: whole tickets (`T0.1`) and single steps (`T0.4 a`). */
export function closedSteps(roadmap: string): Set<string> {
  const closed = new Set<string>();
  const section = roadmap.slice(roadmap.indexOf('\n## 9.'));
  for (const match of section.matchAll(/^\| (T\d+\.\d+(?: [a-z])?) \|/gm)) {
    closed.add(match[1] ?? '');
  }
  return closed;
}

function isClosed(step: string, closed: ReadonlySet<string>): boolean {
  return closed.has(step) || closed.has(step.split(' ')[0] ?? '');
}

/** The progress cell of a lot. */
export function progressCell(steps: readonly string[], closed: ReadonlySet<string>): string {
  const done = steps.filter((step) => isClosed(step, closed)).length;
  const next = steps.find((step) => !isClosed(step, closed));
  return next === undefined
    ? `${done} / ${steps.length} clos, terminé`
    : `${done} / ${steps.length} clos ; prochain : ${next}`;
}

/**
 * The roadmap with its progress recomputed: the `Avancement` column of the execution order (§2) and the
 * `**Avancement** :` line above it. Throws when the table or the line is missing.
 */
export function withProgress(roadmap: string): string {
  const start = roadmap.indexOf('\n## 2.');
  const end = roadmap.indexOf('\n## 3.');
  if (start < 0 || end < start) {
    throw new Error('the roadmap has no execution order (§2) followed by §3');
  }
  const closed = closedSteps(roadmap);
  const lines = roadmap.slice(start, end).split('\n');
  const header = lines.findIndex((line) => line.startsWith('| # |'));
  const columns = (lines[header] ?? '').split(' | ');
  const ticketsColumn = columns.findIndex((column) => column.startsWith('Tickets'));
  const progressColumn = columns.indexOf('Avancement');
  if (header < 0 || ticketsColumn < 0 || progressColumn < 0) {
    throw new Error('the execution order needs a header row with a Tickets and an Avancement column');
  }
  const all: string[] = [];
  for (let i = header + 2; i < lines.length && lines[i]?.startsWith('| ') === true; i++) {
    const cells = (lines[i] ?? '').split(' | ');
    const steps = parseSteps(cells[ticketsColumn] ?? '');
    all.push(...steps);
    cells[progressColumn] = progressCell(steps, closed);
    lines[i] = cells.join(' | ');
  }
  const summary = lines.findIndex((line) => line.startsWith('**Avancement** :'));
  if (summary < 0) {
    throw new Error('the execution order needs an "**Avancement** :" line');
  }
  const done = all.filter((step) => isClosed(step, closed)).length;
  const next = all.find((step) => !isClosed(step, closed));
  lines[summary] =
    `**Avancement** : ${done} étapes closes sur ${all.length}` + (next === undefined ? '.' : ` ; prochaine : ${next}.`);
  return roadmap.slice(0, start) + lines.join('\n') + roadmap.slice(end);
}
