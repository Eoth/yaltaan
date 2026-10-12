# ADR 0002 — Licence

- Date: 2026-10-12
- Status: accepted (the owner's choice, 2026-10-12)

## Context

The library is imported into application code (Angular and React front ends, Node services). Its success is measured by adoption: the application code, dependencies and bytes it lets its users remove. A licence that reaches the importing application's own code, or that legal departments review case by case, prevents that adoption.

## Options

1. **Do nothing: no licence.** All rights reserved by default; nobody may legally use the code. Not an option for a library meant to be adopted.
2. **MIT.** The most common licence of the TypeScript ecosystem (the libraries this one is compared with use it or a sibling permissive licence); a short text, no notice file to propagate. No express patent grant.
3. **Apache-2.0.** Permissive, with an express patent grant and a patent-retaliation clause; a longer text and a `NOTICE` mechanism that users must propagate when present. The grant matters for patent-heavy domains, which a standard library is not.
4. **AGPL-3.0 with a separate commercial licence.** Funds the work through commercial licences, but reaches the code of every application that imports the library: adoption by the target users (companies shipping applications) stops at the legal review.
5. **MPL-2.0.** File-level copyleft: modified library files stay open while applications stay free; uncommon in the npm ecosystem, and still a review item for many companies.

## Measurements

Not measured: this is a policy decision. Facts used: the third-party licences already accepted in the development tree are MIT and Apache-2.0 (`package-lock.json`, 2026-10-12).

## Decision

Option 2, MIT, with the copyright line "Copyright (c) 2026 Pak nguni". Contributions are accepted under the same licence (inbound = outbound), without a contributor licence agreement. Each published package carries a copy of the licence text.

## Consequences

- Anyone may use, modify and redistribute the library, including in proprietary applications, provided the notice is kept.
- No commercial edition can be sold later under different terms without the agreement of every contributor, since no contributor licence agreement collects that right.

## Review condition

The owner planning a commercial edition or a dual licence (a contributor licence agreement must then exist before the first external contribution is merged); or a patent concern raised by a user, which would favour Apache-2.0.
