# @yaltaan/temporal

What Temporal does not provide: intervals, reading declared formats, a boundary with `Date`, units and business days. Temporal itself comes from the platform or from a polyfill the application installs: this package embeds none, and importing it never needs one.

**Not published yet**: the package is private until its first release. Every export is `@experimental`: it may change in a minor version until it is promoted.

```ts
import 'temporal-polyfill/global';
import { contains, interval } from '@yaltaan/temporal';

const start = Temporal.PlainDate.from('2024-01-01');
const end = Temporal.PlainDate.from('2024-02-01');
const january = interval(start, end);

january.ok && contains(january.value, Temporal.PlainDate.from('2024-01-31')); // → true
january.ok && contains(january.value, end); // → false
```

- [Guide](../../docs/guide/en/temporal.md), with reading a format, a wall clock in a zone, the boundary with `Date`, units and business days.
- [Reference](../../docs/reference/temporal.md) and [issue codes](../../docs/issue-codes/temporal.md).
- [Why it is built this way](../../docs/adr/0037-temporal-package.md), and how it compares with dayjs: [the report](../../docs/comparisons/dayjs.md).

Zero third-party runtime dependencies: `@yaltaan/core`. ESM only, `"sideEffects": false`.
