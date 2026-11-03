# Yaltaan beta: `@yaltaan/temporal`

This kit is for people who will judge a date library hard on performance, security and documentation. It is not on npm, and nothing here is published: you install archives. Every function is `@experimental`: names and shapes may change from one beta to the next.

`@yaltaan/temporal` computes nothing itself: Temporal does, native or through a polyfill. It adds what Temporal lacks: intervals, reading a declared format, a boundary with `Date` that always names its time zone, start and end of a unit, business days. The reasons to leave dayjs, and the lines where dayjs is better, are measured below.

## 1. What you received

| File | What it is |
|---|---|
| `yaltaan-core-*.tgz`, `yaltaan-temporal-*.tgz` | The two packages, installed together. |
| `try.mjs` | A first run that checks one function of each kind on your platform. |
| `dayjs-migration.md` | What to write instead of each dayjs call, with what the comparison found. |
| `dayjs.md`, `dayjs-measures.md` | The whole comparison with dayjs, and what each side costs. |
| `test262.md` | The official Temporal tests on each implementation. |
| `FEEDBACK.md` | What to send back. |
| `SHA256SUMS` | The sum of each file. |

Check them, in the folder of the kit: `sha256sum --check SHA256SUMS`.

## 2. Start

You need Node 22.12 or later. In an empty folder, with `KIT` set to the folder of the kit:

```sh
npm init -y
npm pkg set type=module
npm install "$KIT"/yaltaan-core-*.tgz "$KIT"/yaltaan-temporal-*.tgz
npm install --save-exact temporal-polyfill@1.0.5
cp "$KIT/try.mjs" .
node try.mjs
```

The last command prints which Temporal it found, then `ok: @yaltaan/core and @yaltaan/temporal work together on this platform.` Node 26 has Temporal and does not use the polyfill; on Node 22 and 24, on Safari and on iOS, an application imports it once, at its start:

```js
import 'temporal-polyfill/global';
import { parsePlainDate } from '@yaltaan/temporal';

const read = parsePlainDate('31/02/2024', { format: 'dd/MM/yyyy' });
console.log(read.ok ? String(read.value) : read.error.code); // temporal.invalid_date
```

With TypeScript 6.0 or 7, nothing to configure: the declarations of the package bring the types of Temporal. Each function is described in the JSDoc of its declaration, in `node_modules/@yaltaan/temporal/dist/*.d.ts`, with what it throws and its complexity. A function returns a `Result`, `{ ok: true, value }` or `{ ok: false, error }`, wherever data can make it fail; `error.code` is stable, and holds nothing of the text it refused.

## 3. Moving from dayjs

Open `dayjs-migration.md`: one line per need, the dayjs call, what to write instead, and how many generated cases dayjs got differently. In short:

- **Without the `timezone` plugin, dayjs is right on what was compared**: in UTC mode, and in the local mode of a machine set to the zone of the case (`local-*`, the `Date` of the platform does the work). It differs on months between two dates at the end of a month, a convention, and on a date that does not exist, unless you use its strict mode, which agrees everywhere.
- **With the `timezone` plugin, near a change of clock, it goes wrong**: after `.tz().add(3, 'hour')` the instant is right and the wall clock false; the start of a day with a transition can be an hour off; `dayjs.tz` depends on the day the code runs, `.tz()` on the time zone of the machine.
- Move the readers first (`parsePlainDate`, `parseZonedDateTime`): they turn silent wrong dates into issues you can show. Then what uses `.tz`. Code in local mode or `dayjs.utc`, with strict reading, can wait.

**What dayjs keeps**, measured in `dayjs-measures.md`: it is about three times lighter than the polyfill on Safari, iOS, Node 22 and 24; it does fewer instructions than the polyfill on some operations; `format('DD/MM/YYYY')` is shorter than `Intl.DateTimeFormat`, whose output follows a locale, not a pattern; one chained object is less to learn than six classes. The native Temporal costs 0 bytes and does the fewest instructions on every operation it can do; `parsePlainDate` does more than the native `PlainDate.from` on an ISO date, which reads less strictly, and fewer than dayjs in strict mode.

## 4. What is tested, and on what

| Judge | On what | Result |
|---|---|---|
| test262, the official Temporal tests, 6,634 tests | Native on Node 26.12.1; `temporal-polyfill` 1.0.5, default and `full` entries | `test262.md` |
| Comparison with dayjs and java.time, generated cases on 418 time zones | Node 26.12.1, native and polyfill; `java.time` of JDK 17 as referee | `dayjs.md`, replayed to the byte |
| Laws and fuzzing of each function, on generated inputs | Native on Node 26; polyfill on Node 22, 24 and 26 | In the repository's gate |
| Limits: text, format, time zone, calendar, a million intervals, huge numbers of days, calendars of holidays only | Same | In the repository's gate |
| Generated mutations of the code, a witness first; and a fresh reader asked to refuse it, who refused it twice before accepting the readers | Intervals, readers, calendar functions | In the commit messages, at the commit below |

The date of the data matters: a time zone answer is a statement about the data of the runtime, and those of Node and of Java differ.

## 5. What is not covered

- **Firefox, Safari, iOS and every other browser were not run.** Nor were Deno and Bun. `@mdn/browser-compat-data` 8.1.5 reported Temporal native on Chrome 144+, Edge 144+ and Firefox 139+, and missing on Safari and iOS when this was checked (ADR 0005 of the repository), but neither this package nor its laws have run in a browser. If you use one, your first run is the first.
- **No codecs for `@yaltaan/schema`.** A form cannot carry Temporal values through a schema without your own conversion to and from text: that waits for the codec of the schema package.
- **Calendars other than ISO** are carried, not tested by these laws beyond Gregorian; the default entry of the polyfill has only ISO and Gregorian, and `temporal-polyfill/full` the others.
- **No formatting and no month names**: `Intl.DateTimeFormat` writes, and nothing reads `4 March 2024`.
- **dayjs plugins other than** `utc`, `timezone`, `customParseFormat`, `isBetween`, `quarterOfYear` and `isoWeek` were not compared, nor its locales.
- **No real project has run this.** The comparison's cases are generated, and the project that started this work was not available to it. Your project is the missing judge.
- **The polyfill is not the native Temporal.** It samples each zone's offset by period, and misses a short daylight saving whose two ends share an offset: on transitions since 2000, nine zones differ from native, among them `Africa/Casablanca` and `Africa/Cairo`, where it answers as if the clock had not changed (the list is in `dayjs.md`), and it accepts four old zone names the native Temporal refuses, such as `US/Pacific-New`. It also keeps what it learned of each zone in memory: a service on Node 22 or 24 that reads dates and zones from outside grows with them. On a server, prefer Node 26.

## 6. Measures, and how to replay them

The repository is public: `https://github.com/Eoth/yaltaan`, at the commit `{commit}`. You need Node 24, and for the last two commands a JDK and valgrind on the `PATH`.

```sh
git clone https://github.com/Eoth/yaltaan.git && cd yaltaan && git checkout {commit}
npm ci --ignore-scripts
bash scripts/test262.sh              # test262 on each implementation; fetches a pinned Node and test262, each by its sum
bash scripts/verify.sh               # the whole gate: laws, limits, sizes
bash tests/compare-dayjs/run.sh      # the comparison, replayed to the byte; fetches dayjs into a temporary folder
bash tests/compare-dayjs/measure.sh  # rewrites docs/comparisons/dayjs-measures.md: compare it with git diff
```

Instructions come from Callgrind, not a clock: they repeat to about 0.03 %, on a shared machine too. Bytes come from esbuild and Rollup, minified and brotli-compressed.

## 7. What to send back

Fill in `FEEDBACK.md` and send it to the person who gave you this kit. A security problem goes there too, never in a public issue. What helps most: the step where you stopped, a real date from your project that goes wrong, an input that makes a `Result` function throw or take long, and a sentence of this guide that you could not check.
