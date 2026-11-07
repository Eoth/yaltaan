# ADR 0040 — Contract tags of the callable members of exports

- Date: 2026-11-07
- Status: accepted (design choices delegated by the owner, reported for review)

## Context

ADR 0012 checks the contract tags of every public export and stops there: "members of exported classes and interfaces (the methods of an instance returned by a `create*` function) carry no checked tag yet". The promise of ARCHITECTURE.md §5.6, "every function documents its mutation", then holds for `parse` and not for the `validate` a schema carries, nor for the `subscribe` of the reactive node to come (§5.5), whose purpose is to change state.

Reading the published declarations of the four packages with the compiler (the adapter of ADR 0012), on 2026-11-07, finds 185 exports and 17 callable members, none tagged:

- 12 are functions the caller writes and the library calls: the `key` and `compare` of the sort criteria, the `keyOf` of `AccessOptions`, the `format` and `resolveKey` of `ToStandardIssueOptions` and `RefineOptions`, the `when` of a condition, the `where` of a list source, the `compare` of `ordered`, the `by` of `unique`;
- 5 are code of the library: `Rule.check` and `Rule.required` (the rules of `@yaltaan/rules`, which an application may also write), `StandardProps.validate`, `Schema['~run']`, which adds its issues to the `reading` it is given, and `Schema['~standard'].validate`, declared by an interface no subpath exports (`SynchronousProps`).

A member raises three questions an export does not: what `@mutates` names when the state changed is the object the member is called on; what a function supplied by the caller can promise, when the library does not write it; and whether a member repeats the `@since` and the stability of the type that holds it.

## Options

1. **Do nothing.** The members stay free comments; the first `create*` of lot 3 (`createCache`, `createLimiter`) and the reactive node ship methods that change state without a checked word.
2. **Members carry exactly the tags of an export that runs**, `@since` and stability included, callbacks included. Rejected: a `@complexity` or a `@pure` on the `key` of a sort criterion is a promise about code the library does not write, made up for form, which ADR 0012 refuses ("a tag that means nothing would be refused rather than written for form"); and `@since 0.1` repeated on every member of a `@since 0.1` interface says nothing.
3. **Tell callbacks from library code by their position**: a member of a type used only as a parameter is a callback. Rejected: `Rule` and `StandardProps` are both returned by the library and accepted from the caller; the rule would be a guess the next type defeats.
4. **Explicit on each member.** A callable member is code of the library and carries the contract of a function, unless it carries `@supplied`; `@mutates this` names the object it is called on; `@since` and the stability are inherited from the owner unless the member states its own. Kept.

For the object a member changes, `@mutates this` was kept over `@mutates self`, `@mutates instance` or `@mutates owner`: `this` is the name JavaScript gives that object when the member is called, for an instance as for an exported object, and it cannot be the name of a parameter.

## Measurements

On 2026-11-07, Ubuntu 26.04 x64, Node 26.12.1, TypeScript 7.0.2:

- **Found**: 17 callable members on 185 exports (above). Reading members through a property whose type no subpath exports found `Schema['~standard'].validate`, the method every engine calls on our schemas, which a reading of declared members alone would have missed.
- **Gate step**: `checkContractTags` on the repository, five runs each, 91 to 98 ms before (median 92), 137 to 140 ms after (median 139): +47 ms per run of the gate.
- **The tests judge the checker**: 17 hand mutations of the reader, the rules and the reference (a member never read, `this` refused, inherited tags required, a hidden type not entered, a supplied member that owes no description, members of the standard library read, an exported type's member read again, an optional function seen as `undefined`, a computed key named by its compiler number, a constant's or a class's own members skipped, `@supplied` ignored, the stability of a member required, a member left out of the reference, members not judged by the checker, a type alias that judges nothing or judges twice), 17 caught; one guard against cycles was removed instead, no test being able to tell it apart, each property being read once.

## Decision

Option 4.

- **What is read**: the callable members of every export that runs or that never runs, other than an `other` kind: methods, and properties whose type is a function, `undefined` aside for an optional one. A class has two sets, its own members and its instance's, shown under `prototype` (`Box.prototype.grow`); an interface or a type alias, those of its type; a constant or a function, those of its value. Members declared by the standard library or by a dependency are not read. A getter is a property: a member only when its value is a function.
- **Where a member is judged**: where the type that declares it is exported. A member declared by the export itself is judged with it; one declared by another exported type is left to that type, even when inherited or reached here; one declared by a type no subpath exports is judged with every export that reaches it, inherited or through a property whose type holds it (`Schema.~standard.validate`), once per export, under its shortest name.
- **A member of the library** carries `@pure` or `@mutates`, `@sharing`, `@complexity` and `@throws`, with the values of ADR 0012. `@mutates` names a parameter of one of its signatures, or `this`, the object it is called on; `this` is refused on an export. For a member that several implementations fulfil (`Rule.check`, `StandardProps.validate`), the tags state what the library's implementations do, and what any other must do is in its description.
- **A supplied member** carries `@supplied` and a description that says when it is called and what it must do; a tag of the library's promise (`@pure`, `@mutates`, `@sharing`, `@complexity`, `@throws`) is refused on it. `@supplied` is refused on an export.
- **Inherited tags**: on a member, `@since` and `@experimental` or `@stable` are optional; absent, they are the owner's; present, they state the member's own (a member added later, a member less stable than its type), and the two stability levels still exclude each other.
- **The reference** shows each member under its export (`#### \`Rule.check\``), in code-unit order of its name, with its kind (member or supplied member), description, declaration and contract table; the tag table says which tags each kind carries.
- **One source of the tags** stays `scripts/lib/contract-tags.ts`; the reader stays `scripts/lib/declarations.ts`, the only file that imports the compiler.

## Consequences

- The 17 members of the repository carry their tags; `docs/reference/` grows by 17 entries.
- Writers of an options interface write `@supplied` and a sentence on each callback; writers of a method write the four tags of a function.
- What the check does not see: the truth of a tag (`@pure` on a member that mutates passes, as for an export); whether the description of a supplied member says enough (only its presence is checked); call and construct signatures of an interface itself, index signatures, and getters with effects; members reached only through a union or an intersection of hidden types; members that a hidden type declares and an exported type inherits are judged twice, with that type and with the export that reaches it through the exported one, which costs a line of the reference and never a miss.
- A TypeScript upgrade that changes `getPropertiesOfType`, `Symbol.getParent` or `Type.getSymbol` fails the tests of the checker, as ADR 0012 planned.

## Review condition

The reactive node (§5.5) or a `create*` of lot 3 needing a tag the rules above cannot express (a member that mutates a value it returns, a member whose effect depends on the instance's options); a callback whose contract the library must enforce rather than describe (then a tag of what the library requires of it, by a new record); or a stable compiler API that answers which members a type declares without walking properties.
