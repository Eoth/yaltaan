import assert from 'node:assert/strict';
import test from 'node:test';
import { fc } from '@yaltaan/testing';
import {
  formatReport,
  reportDifferences,
  signatureOf,
  smaller,
  stampDifference,
  summarize,
  type Case,
} from './report.ts';

const answers = (dayjs: string, native: string, polyfill: string, java: string): Record<string, string> => ({
  dayjs,
  native,
  polyfill,
  'java.time': java,
});

test('a signature groups the sides by answer, whatever their order', () => {
  assert.equal(signatureOf(answers('a', 'b', 'b', 'b')), 'dayjs | java.time=native=polyfill');
  assert.equal(signatureOf({ polyfill: 'x', dayjs: 'x' }), signatureOf({ dayjs: 'x', polyfill: 'x' }));
  assert.equal(signatureOf(answers('a', 'a', 'a', 'a')), 'dayjs=java.time=native=polyfill');
});

test('each case counts once, in the column java.time decides', () => {
  const cases: Case[] = [
    { args: ['all'], answers: answers('a', 'a', 'a', 'a') },
    { args: ['dayjs'], answers: answers('x', 'a', 'a', 'a') },
    { args: ['temporal'], answers: answers('a', 'x', 'x', 'a') },
    { args: ['java'], answers: answers('a', 'a', 'a', 'x') },
    { args: ['three'], answers: answers('x', 'y', 'y', 'z') },
    { args: ['apart'], answers: answers('a', 'a', 'x', 'a') },
    { args: ['no-java'], answers: { dayjs: 'x', native: 'a', polyfill: 'a' } },
  ];
  const summary = summarize('f', cases);
  assert.equal(summary.cases, 7);
  assert.equal(summary.agree, 1);
  assert.equal(summary.dayjsWrong, 1);
  assert.equal(summary.temporalWrong, 1);
  assert.equal(summary.javaAlone, 1);
  assert.equal(summary.undecided, 3);
  assert.equal(summary.sidesApart, 1);
  assert.equal(summary.agree + summary.dayjsWrong + summary.temporalWrong + summary.javaAlone + summary.undecided, 7);
});

test('the smallest example does not depend on the order of the cases', () => {
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 6 }), { minLength: 1, maxLength: 20 }), fc.nat(), (texts, seed) => {
      const cases: Case[] = texts.map((text) => ({ args: [text], answers: answers('x', 'a', 'a', 'a') }));
      const turned = [...cases.slice(seed % cases.length), ...cases.slice(0, seed % cases.length)];
      assert.deepEqual(summarize('f', cases).examples, summarize('f', turned).examples);
      const best = summarize('f', cases).examples[0]?.args ?? [];
      assert.ok(cases.every((one) => !smaller(one.args, best)));
      assert.equal(summarize('f', cases).examples[0]?.count, cases.length);
    }),
  );
});

test('a changed verdict changes the report, and the difference names the line', () => {
  const base = summarize('f', [{ args: ['a'], answers: answers('x', 'a', 'a', 'a') }]);
  const changed = summarize('f', [{ args: ['a'], answers: answers('a', 'a', 'a', 'a') }]);
  const one = formatReport(['# t'], [base]);
  assert.deepEqual(reportDifferences(one, formatReport(['# t'], [base])), []);
  const differences = reportDifferences(one, formatReport(['# t'], [changed]));
  assert.ok(differences.some((line) => line.startsWith('- | f | 1 | 0 | 1 |')));
  assert.ok(differences.some((line) => line.startsWith('+ | f | 1 | 1 | 0 |')));
});

test('a stamp differs by its wall clock, its instant or both', () => {
  const stamp = '2024-3-10T3:0:0.0 1710054000000';
  assert.equal(stampDifference(stamp, stamp), undefined);
  assert.equal(stampDifference('2024-3-10T4:0:0.0 1710054000000', stamp), 'wall');
  assert.equal(stampDifference('2024-3-10T3:0:0.0 1710057600000', stamp), 'instant');
  assert.equal(stampDifference('2024-3-10T4:0:0.0 1710057600000', stamp), 'both');
  assert.equal(stampDifference('refused', stamp), undefined);
  assert.equal(stampDifference('-1-1-1T0:0:0.0 -62198755200000', '-1-1-1T0:0:0.0 -1'), 'instant');
  const counted = summarize('f', [
    {
      args: ['a'],
      answers: answers('2024-3-10T4:0:0.0 1', '2024-3-10T3:0:0.0 1', '2024-3-10T3:0:0.0 1', '2024-3-10T3:0:0.0 1'),
    },
    {
      args: ['b'],
      answers: answers('2024-3-10T3:0:0.0 2', '2024-3-10T3:0:0.0 1', '2024-3-10T3:0:0.0 1', '2024-3-10T3:0:0.0 1'),
    },
  ]);
  assert.deepEqual(counted.stamps, { wall: 1, instant: 1, both: 0 });
});

test('a pipe in an answer does not break a table row', () => {
  const report = formatReport(['# t'], [summarize('f', [{ args: ['a|b'], answers: answers('x|y', 'a', 'a', 'a') }])]);
  assert.ok(report.includes('x\\|y'));
});
