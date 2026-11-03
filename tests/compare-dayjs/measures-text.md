# What each side costs

Written by `bash tests/compare-dayjs/measure.sh`. Sides and versions: [the comparison](dayjs.md); method: [ADR 0036](../adr/0036-comparison-with-dayjs.md). Lower is better in both tables, and this page is where dayjs wins lines.

## Bytes of import

Minified and brotli-compressed, through `scripts/lib/bundle.ts`, esbuild then Rollup. The harness's Rollup has no CommonJS plugin: dayjs is measured by its ESM build under both, and its main UMD files, what a plain `import dayjs from 'dayjs'` bundles, are read as they are.

<!-- table -->

What a platform adds to it:

| Platform | Temporal costs | Lighter than dayjs and its plugins? |
|---|---:|---|
| Chrome and Edge 144+, Firefox 139+, Node 26 | 0 bytes: native | Yes |
| Safari, iOS, Node 22, Node 24 | {polyfillBytes} bytes: the polyfill, once for the whole application | **No: dayjs is about three times lighter** |

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
