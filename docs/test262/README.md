# Temporal under test262

Written by `bash scripts/test262.sh --write`, compared by the gate. Each table of this folder lists the tests that did not pass on one implementation, with their error; [ADR 0035](../adr/0035-test262-judge.md) says how they are run and what they mean for `@yaltaan/temporal`.

test262 commit `0b4e0812022b18236b5276d2804948fdd9f71603`; node 26.12.1, v8 14.6.202.34-node.40, icu 78.3, tz 2026e.

| Area | Tests | native: not passed | polyfill: not passed | polyfill-full: not passed |
|---|---:|---:|---:|---:|
| built-ins/Temporal/Duration | 540 | 2 | 3 | 3 |
| built-ins/Temporal/Instant | 467 | 0 | 1 | 1 |
| built-ins/Temporal/Now | 66 | 0 | 0 | 0 |
| built-ins/Temporal/PlainDate | 652 | 2 | 1 | 1 |
| built-ins/Temporal/PlainDateTime | 773 | 2 | 1 | 1 |
| built-ins/Temporal/PlainMonthDay | 199 | 0 | 0 | 0 |
| built-ins/Temporal/PlainTime | 493 | 0 | 0 | 0 |
| built-ins/Temporal/PlainYearMonth | 509 | 2 | 2 | 2 |
| built-ins/Temporal/ZonedDateTime | 901 | 2 | 0 | 0 |
| built-ins/Temporal/getOwnPropertyNames | 1 | 0 | 0 | 0 |
| built-ins/Temporal/keys | 1 | 0 | 0 | 0 |
| built-ins/Temporal/prop-desc | 1 | 0 | 0 | 0 |
| built-ins/Temporal/toStringTag | 2 | 0 | 0 | 0 |
| intl402/Temporal/Duration | 21 | 0 | 0 | 0 |
| intl402/Temporal/Instant | 17 | 4 | 0 | 0 |
| intl402/Temporal/Now | 3 | 0 | 0 | 0 |
| intl402/Temporal/PlainDate | 493 | 3 | 415 | 3 |
| intl402/Temporal/PlainDateTime | 483 | 4 | 400 | 3 |
| intl402/Temporal/PlainMonthDay | 90 | 0 | 40 | 1 |
| intl402/Temporal/PlainTime | 12 | 1 | 0 | 0 |
| intl402/Temporal/PlainYearMonth | 327 | 1 | 265 | 3 |
| intl402/Temporal/ZonedDateTime | 583 | 4 | 407 | 4 |

Tests that fail on all 3 implementations: 0.
