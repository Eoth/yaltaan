import assert from 'node:assert/strict';
import { test } from 'node:test';

import { closedSteps, parseSteps, progressCell, withProgress } from '../lib/roadmap-progress.ts';

const roadmap = (progress: string, cells: readonly string[], closed: readonly string[]): string =>
  [
    '# Roadmap',
    '',
    "## 2. Ordre d'exécution",
    '',
    progress,
    '',
    "| # | Lot | Tickets, dans l'ordre | Avancement | Sortie |",
    '|---|---|---|---|---|',
    `| 1 | 0 — Outillage | T0.1, T0.4 a, b, T0.8 | ${cells[0] ?? ''} | Paquet vide. |`,
    `| 2 | 1 — Colonne | T1.1, T1.2 a, T1.2 b | ${cells[1] ?? ''} | Contrats. |`,
    '',
    '## 3. Décisions',
    '',
    '## 9. Clos',
    '',
    '| Ticket | Commit | Résultat | Itérations |',
    '|---|---|---|---|',
    ...closed.map((ticket) => `| ${ticket} | \`abc\` | fait | 1 (S) |`),
    '',
  ].join('\n');

test('a cell lists tickets and the steps that follow a ticket', () => {
  assert.deepEqual(parseSteps('T0.1, T0.4 a, b, T0.8'), ['T0.1', 'T0.4 a', 'T0.4 b', 'T0.8']);
  assert.deepEqual(parseSteps('T1.6 a, T1.6 b'), ['T1.6 a', 'T1.6 b']);
  assert.throws(() => parseSteps('b, T0.1'), /not a ticket/);
  assert.throws(() => parseSteps('T0.1, later'), /not a ticket/);
});

test('the closed table closes whole tickets and single steps, and nothing outside it counts', () => {
  const text = roadmap('**Avancement** :', [], ['T0.1', 'T0.4 a']).replace(
    '## 3. Décisions',
    '## 3. Décisions\n\n| T9.9 | x |',
  );
  assert.deepEqual([...closedSteps(text)], ['T0.1', 'T0.4 a']);
  assert.equal(
    progressCell(['T0.1', 'T0.4 a', 'T0.4 b'], new Set(['T0.1', 'T0.4 a'])),
    '2 / 3 clos ; prochain : T0.4 b',
  );
  assert.equal(progressCell(['T0.4 a', 'T0.4 b'], new Set(['T0.4'])), '2 / 2 clos, terminé');
});

test('the progress column and line are recomputed from the closed table', () => {
  const stale = roadmap('**Avancement** : 0', ['old', 'old'], ['T0.1', 'T0.4 a', 'T0.4 b', 'T0.8', 'T1.1']);
  const expected = roadmap(
    '**Avancement** : 5 étapes closes sur 7 ; prochaine : T1.2 a.',
    ['4 / 4 clos, terminé', '1 / 3 clos ; prochain : T1.2 a'],
    ['T0.1', 'T0.4 a', 'T0.4 b', 'T0.8', 'T1.1'],
  );
  assert.equal(withProgress(stale), expected);
  assert.equal(withProgress(expected), expected);
  const done = roadmap('**Avancement** :', [], ['T0.1', 'T0.4', 'T0.8', 'T1.1', 'T1.2']);
  assert.match(withProgress(done), /^\*\*Avancement\*\* : 7 étapes closes sur 7\.$/m);
});

test('a roadmap without the column or the line is refused', () => {
  assert.throws(() => withProgress(roadmap('', [], []).replace(' Avancement |', ' Sortie |')), /Avancement column/);
  assert.throws(() => withProgress(roadmap('Progress', [], [])), /"\*\*Avancement\*\* :" line/);
  assert.throws(() => withProgress('# Roadmap\n'), /no execution order/);
});
