// One process of the count: warms a side's operation up, then makes the asked calls. Two runs of it, N and 2N calls,
// give the work of one call as their difference.
//
// Usage: node count-runner.mjs <dayjs folder> <side> <operation> <calls>
import { createRequire } from 'node:module';
import path from 'node:path';
import { Temporal as Polyfill } from 'temporal-polyfill/implementation';
import { OPS } from './ops.mjs';
import * as yaltaan from '../../packages/temporal/dist/index.js';

const [folder, side, op, calls] = process.argv.slice(2);
const operation = OPS[op];
let call;
if (side === 'dayjs') {
  const require = createRequire(path.join(path.resolve(folder), 'index.js'));
  const dayjs = require('dayjs');
  for (const plugin of ['utc', 'timezone', 'customParseFormat', 'isBetween', 'quarterOfYear', 'isoWeek']) {
    dayjs.extend(require(`dayjs/plugin/${plugin}.js`));
  }
  call = operation.dayjs(dayjs);
} else if (side === 'yaltaan') {
  call = operation.yaltaan(yaltaan, globalThis.Temporal);
} else {
  call = operation.temporal(side === 'native' ? globalThis.Temporal : Polyfill);
}
let sink = 0;
for (let i = 0; i < 2000; i += 1) {
  sink += Number(call(i)) || 0;
}
const total = Number(calls);
for (let i = 0; i < total; i += 1) {
  sink += Number(call(i)) || 0;
}
if (Number.isNaN(sink)) {
  throw new Error('the sink is not a number');
}
