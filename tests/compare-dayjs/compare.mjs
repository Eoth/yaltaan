// The comparison with dayjs: generates the cases, asks each side, and writes or checks the report. Run through run.sh,
// which provides Node, dayjs outside the lockfile and the compiled java.time side. The prose is in report-text.md.
//
// Usage: node compare.mjs --dayjs <folder holding node_modules/dayjs> --java <classes folder> [--write]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
// The main entry of the polyfill hands back the native Temporal where there is one: this entry is always the polyfill.
import { Temporal as Polyfill } from 'temporal-polyfill/implementation';
import { FAMILIES, JANUARY, MIGRATION, NOT_APPLICABLE, REFUSED } from './families.mjs';
import { generate } from './generate.mjs';
import * as yaltaan from '../../packages/temporal/dist/index.js';
import { formatReport, reportDifferences, stampDifference, summarize } from './report.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPORT = path.join(here, '..', '..', 'docs', 'comparisons', 'dayjs.md');
const { values } = parseArgs({
  options: {
    dayjs: { type: 'string' },
    java: { type: 'string' },
    write: { type: 'boolean', default: false },
    report: { type: 'string' },
    family: { type: 'string' },
  },
});

const require = createRequire(path.join(path.resolve(values.dayjs), 'index.js'));
const dayjs = require('dayjs');
for (const plugin of ['utc', 'timezone', 'customParseFormat', 'isBetween', 'quarterOfYear', 'isoWeek']) {
  dayjs.extend(require(`dayjs/plugin/${plugin}.js`));
}
const dayjsVersion = require('dayjs/package.json').version;
const polyfillManifest = path.join(here, '..', '..', 'node_modules', 'temporal-polyfill', 'package.json');
const polyfillVersion = JSON.parse(fs.readFileSync(polyfillManifest, 'utf8')).version;

const native = globalThis.Temporal;
if (native === undefined || Polyfill === native || Polyfill.PlainDate === native.PlainDate) {
  throw new Error('the native side and the polyfill side must be two implementations: run on Node 26');
}
const onImplementation = (temporal, ask) => {
  globalThis.Temporal = temporal;
  try {
    return ask();
  } finally {
    globalThis.Temporal = native;
  }
};
const answerOf = (ask) => {
  try {
    return ask();
  } catch {
    return REFUSED;
  }
};
const setHost = (zone) => {
  // Node resets its time zone when this variable is written: a process stands for a machine set to that zone.
  process.env.TZ = zone;
};

// `new Date()` and `Date.now()` for dayjs alone: its answers depend on them, and a report must not depend on the day.
const RealDate = Date;
function setClock(now) {
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
      } else {
        super(...args);
      }
    }
    static now() {
      return now;
    }
  };
}

const { zones, families } = generate();
const baseOf = (name) => name.replace(/:old$/, '');
const names = Object.keys(families)
  .sort()
  .filter((name) => values.family === undefined || baseOf(name) === values.family);
for (const name of Object.keys(families)) {
  if (FAMILIES[baseOf(name)] === undefined) {
    throw new Error(`generated family without sides: ${name}`);
  }
}
for (const name of Object.keys(FAMILIES)) {
  if (families[name] === undefined && families[`${name}:old`] === undefined) {
    throw new Error(`no case generated for family ${name}`);
  }
}

function askJava(name, cases) {
  const input = cases.map((args) => [baseOf(name), ...args].join('\t')).join('\n');
  const output = execFileSync('java', ['-cp', values.java, 'Oracle'], {
    input: `${input}\n`,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  const lines = output.split('\n');
  if (lines.length !== cases.length + 1) {
    throw new Error(`java.time answered ${lines.length - 1} lines for ${cases.length} cases of ${name}`);
  }
  return lines;
}

const zoneSet = new Set(zones);
const polyfillApart = new Set();
const polyfillApartOld = new Set();
const temporalApart = new Set();
const summaries = [];
const started = Date.now();
for (const name of names) {
  const family = FAMILIES[baseOf(name)];
  const cases = families[name];
  const java = askJava(name, cases);
  const order = cases.map((_, i) => i);
  const host = family.host;
  if (host !== undefined) {
    // Grouped by host: writing the variable costs far more than an answer.
    order.sort((a, b) => (host(cases[a]) < host(cases[b]) ? -1 : host(cases[a]) > host(cases[b]) ? 1 : a - b));
  }
  const answered = new Array(cases.length);
  let current = 'UTC';
  setHost(current);
  setClock(family.clock ?? JANUARY);
  for (const i of order) {
    const args = cases[i];
    if (host !== undefined && host(args) !== current) {
      current = host(args);
      setHost(current);
    }
    answered[i] = answerOf(() => family.dayjs(args, dayjs));
  }
  setHost('UTC');
  globalThis.Date = RealDate;
  const results = cases.map((args, i) => {
    const answers = {
      dayjs: answered[i],
      native: answerOf(() => family.temporal(args, native)),
      polyfill: answerOf(() => family.temporal(args, Polyfill)),
      'java.time': java[i],
    };
    if (family.yaltaan !== undefined) {
      answers.yaltaan = answerOf(() => onImplementation(native, () => family.yaltaan(args, yaltaan, native)));
      answers['yaltaan on polyfill'] = answerOf(() =>
        onImplementation(Polyfill, () => family.yaltaan(args, yaltaan, Polyfill)),
      );
    }
    for (const side of Object.keys(answers)) {
      if (answers[side] === NOT_APPLICABLE) {
        delete answers[side];
      }
    }
    return { args, answers };
  });
  for (const { args, answers } of results) {
    const zone = args.find((value) => typeof value === 'string' && zoneSet.has(value));
    if (zone === undefined) {
      continue;
    }
    if (answers.native !== undefined && answers.polyfill !== undefined && answers.native !== answers.polyfill) {
      (name.endsWith(':old') ? polyfillApartOld : polyfillApart).add(zone);
    }
    const java = answers['java.time'];
    if (java !== undefined && answers.native !== java && answers.dayjs === java) {
      if (stampDifference(answers.native, java) !== 'instant') {
        temporalApart.add(zone);
      }
    }
  }
  const summary = summarize(name, results);
  summaries.push(summary);
  console.error(
    `${name}: ${summary.cases} cases, ${summary.agree} agree, dayjs differs ${summary.dayjsWrong}, ` +
      `Temporal differs ${summary.temporalWrong}, java.time alone ${summary.javaAlone}, ` +
      `undecided ${summary.undecided}, polyfill apart ${summary.sidesApart}`,
  );
}
console.error(`${((Date.now() - started) / 1000).toFixed(1)} s`);

const javaVersion = execFileSync('java', ['-cp', values.java, 'Oracle', '--version'], { encoding: 'utf8' }).trim();
const { node, icu, tz } = process.versions;
const listed = (set) => [...set].sort().join(', ') || 'none';
const text = fs
  .readFileSync(path.join(here, 'report-text.md'), 'utf8')
  .replaceAll('{dayjs}', dayjsVersion)
  .replaceAll('{node}', node)
  .replaceAll('{icu}', icu)
  .replaceAll('{tz}', tz)
  .replaceAll('{polyfill}', polyfillVersion)
  .replaceAll('{java}', javaVersion)
  .replaceAll('{zones}', String(zones.length))
  .replaceAll('{polyfillApart}', listed(polyfillApart))
  .replaceAll('{polyfillApartOld}', listed(polyfillApartOld))
  .replaceAll('{temporalApart}', listed(temporalApart));
const [preamble = '', notes = ''] = text.split('\n<!-- notes -->\n');
const report = formatReport([preamble.trimEnd()], summaries, [notes.trim()]);
const file = values.report ?? REPORT;
const bySummary = new Map(summaries.map((summary) => [summary.family, summary]));
const code = (text) => `\`${text.replaceAll('|', '\\|')}\``;
const migrationTable = (lang, header) => {
  const rows = MIGRATION.map((step) => {
    const summary = bySummary.get(step.family);
    if (summary === undefined) {
      throw new Error(`no results for the family ${step.family}`);
    }
    const count = `${summary.dayjsWrong + summary.undecided} / ${summary.cases}`;
    return `| ${step[lang]} | ${code(step.dayjs)} | ${code(step.instead)} | ${count} |`;
  });
  return [header, '|---|---|---|---:|', ...rows];
};
const migration = [
  '# Moving from dayjs to Temporal',
  '',
  'Written by `bash tests/compare-dayjs/run.sh --write`, from the same results as [the comparison](dayjs.md), whose ' +
    'notes say which of these lines are conventions. The last column counts generated cases on transitions since ' +
    '2000, chosen where dates go wrong, not an average of what an application meets.',
  '',
  ...migrationTable('en', '| Need | dayjs | Temporal or `@yaltaan/temporal` | dayjs differs / cases |'),
  '',
  '## Le même tableau, en français',
  '',
  'Écrit par `bash tests/compare-dayjs/run.sh --write`, à partir des mêmes résultats que la comparaison, dont les ' +
    'notes disent quelles lignes sont des conventions. La dernière colonne compte des cas générés sur les ' +
    'changements ' +
    "d'heure depuis 2000, choisis là où les dates se trompent : ce n'est pas une moyenne de ce que rencontre une " +
    'application.',
  '',
  ...migrationTable('fr', '| Besoin | dayjs | Temporal ou `@yaltaan/temporal` | dayjs diffère / cas |'),
  '',
].join('\n');
const migrationFile = path.join(path.dirname(file), 'dayjs-migration.md');
if (values.write) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, report);
  fs.writeFileSync(migrationFile, migration);
  console.log(`ok: ${file} written`);
} else if (values.family === undefined) {
  const differences = fs.existsSync(file) ? reportDifferences(fs.readFileSync(file, 'utf8'), report) : [`+ ${file}`];
  if (!fs.existsSync(migrationFile) || fs.readFileSync(migrationFile, 'utf8') !== migration) {
    differences.push(`+ ${migrationFile} differs`);
  }
  if (differences.length > 0) {
    console.error(`error: the comparison differs from ${file}:`);
    console.error(differences.slice(0, 30).join('\n').slice(0, 6000));
    process.exitCode = 1;
  } else {
    console.log('ok: the comparison gives the recorded report, to the byte.');
  }
}
