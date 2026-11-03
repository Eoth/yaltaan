# What each side costs

Written by `bash tests/compare-dayjs/measure.sh`. Sides and versions: [the comparison](dayjs.md); method: [ADR 0036](../adr/0036-comparison-with-dayjs.md). Lower is better in both tables, and this page is where dayjs wins lines.

## Bytes of import

Minified and brotli-compressed, through `scripts/lib/bundle.ts`, esbuild then Rollup. The harness's Rollup has no CommonJS plugin: dayjs is measured by its ESM build under both, and its main UMD files, what a plain `import dayjs from 'dayjs'` bundles, are read as they are.

| What an application imports | esbuild | Rollup |
|---|---:|---:|
| dayjs alone, ESM build | 2809 | 2788 |
| dayjs and the six plugins of the comparison, ESM build | 6131 | 6112 |
| temporal-polyfill, imported | 17851 | 17876 |
| temporal-polyfill, installed as a global | 18499 | 18573 |
| dayjs alone, main UMD file | 2772 | not bundled |
| dayjs and the six plugins, main UMD files | 6018 | not bundled |

What a platform adds to it:

| Platform | Temporal costs | Lighter than dayjs and its plugins? |
|---|---:|---|
| Chrome and Edge 144+, Firefox 139+, Node 26 | 0 bytes: native | Yes |
| Safari, iOS, Node 22, Node 24 | 17851 / 17876 bytes: the polyfill, once for the whole application | **No: dayjs is about three times lighter** |

Platform support as ADR 0005 recorded it; only Node 24 and 26 are run on this machine.

## Where convenience goes to dayjs

No number here, and no referee: what an application writes.

| Need | dayjs | Temporal |
|---|---|---|
| Show a date | `d.format('DD/MM/YYYY')` | `Intl.DateTimeFormat`, whose output follows the locale, not a pattern: **dayjs is shorter** |
| Read `31/12/2024` | `dayjs(text, 'DD/MM/YYYY', true)` | Nothing but ISO 8601: `parsePlainDate` of `@yaltaan/temporal`, an import more |
| "3 days ago" | `relativeTime` plugin | `Intl.RelativeTimeFormat`, the difference computed by hand: **dayjs is shorter** |
| One way to do everything | One object, chained calls | Six classes to choose from: **more to learn** |
| Runs everywhere today, without a polyfill | Yes | No: Safari, iOS, Node 22 and 24 need the polyfill |

## Instructions per call

Callgrind, valgrind-3.26.0, Node 26.12.1 with --predictable --random-seed=1 --hash-seed=1 --single-threaded --v8-pool-size=0: two processes, 2000 and 4000 calls after 2,000 calls of warm-up, the difference divided by 2000. Same operation and same inputs for each side (`tests/compare-dayjs/ops.mjs`), three digits.

| Operation | dayjs | native | polyfill | Fewest | Fewer of dayjs and polyfill |
|---|---:|---:|---:|---|---|
| add one month to a date | 73,100 | 14,500 | 58,600 | native | polyfill |
| months between two dates | 165,000 | 14,700 | 405,000 | native | dayjs |
| read a wall clock in a zone | 159,000 | 13,700 | 200,000 | native | dayjs |
| add one day in a zone | 197,000 | 31,600 | 327,000 | native | dayjs |
| start of the month in a zone | 607,000 | 32,900 | 353,000 | native | polyfill |
| an instant in a zone | 431,000 | 13,000 | 139,000 | native | polyfill |
| read and check an ISO date | 55,600 | 3,940 | 32,100 | native | polyfill |
| compare two instants | 25,800 | 16,600 | 60,800 | native | dayjs |

dayjs does fewer instructions than the polyfill on 4 operations out of 8.
