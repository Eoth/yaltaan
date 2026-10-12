# ADR 0008 — Unknown keys in object schemas: strip by default

- Date: 2026-10-12
- Status: accepted (decision delegated by the owner to the recommendation, 2026-10-12)

## Context

An object schema meets keys it does not declare: a field added by a newer server, a typo, or an attacker's extra property. `@yaltaan/schema` offers three behaviours, `'strip'` (drop them from the output), `'reject'` (an issue per unknown key) and `'passthrough'` (keep them unchecked); the question is which one applies when the caller names none. A default is a visible behaviour of the public API: changing it later is a breaking change.

## Options

1. **Do nothing: no default, the option is mandatory.** Explicit, but every object schema repeats the same word, and the common case pays for the rare one.
2. **`strip`.** The output holds only declared, checked keys; a field added on the server does not break clients already deployed; an undeclared key cannot travel unchecked into the application. The behaviour of the default object schema of Zod 4 and of Valibot's `object`.
3. **`reject`.** Safest against untrusted input and typos, but one field added by a server breaks every deployed client at once.
4. **`passthrough`.** Never loses data, but lets unchecked values through a function whose purpose is to check them, including keys such as `__proto__` that the rest of the library refuses on write.

## Measurements

Not measured: behaviour of the reference libraries read from their documentation on 2026-10-12 (Zod 4: `z.object` strips, `z.strictObject` rejects, `z.looseObject` passes through; Valibot: `object` removes unknown entries, `strictObject` rejects, `looseObject` keeps them).

## Decision

Option 2, `strip`. `reject` is documented and recommended for untrusted input (request bodies, files, messages from other systems); `passthrough` exists, and even then the keys that the `Path` contract refuses on write (`__proto__`, `constructor`, `prototype`) are never copied into the output.

## Consequences

- Users coming from Zod or Valibot meet the behaviour they expect.
- A typo in a client's payload disappears silently under the default: the documentation of `reject` says when to prefer it.

## Review condition

Users of the vertical slice or of a pilot project showing that silently dropped keys hid real defects more often than added server fields broke clients.
