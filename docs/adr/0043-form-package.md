# ADR 0043 — `@yaltaan/form`: fields and groups on the reactive graph, every state derived but three

- Date: 2026-11-09
- Status: accepted (design choices delegated by the owner, reported for review; the first form API, `@experimental` until the go/no-go decision of T2.7 and the frozen contracts)

## Context

ARCHITECTURE.md §6 and §7.11 place the form in a package of its own, above `rules`, conditional on the go/no-go decision that closes the vertical slice (T2.7): a tree of reactive nodes, a raw value and a parsed value, derived states, local and server issues. A new package and its public API need a record. T2.4 a asks for the first step: `field`, `group`, the raw and the parsed value, and the states `dirty`, `touched`, `pending`, `submitted` and `disabled`, on the graph of ADR 0041, judged by laws against a naive model, with its size budget (ADR 0010) and its type cost measured. Lists (T2.4 b) and validators of the application's own, with their signal (T2.4 c), come next.

§7.11 leaves open what every later step inherits: how a tree is described and built; what each state means, since the two engines the form must beat disagree on most of them; where an issue of a schema goes; what `pending` and the parsed value are while a schema has not answered; and what `disabled` does.

The references, read in their shipped code and run (Angular Signal Forms 22.2.4, TanStack Form 1.33.5, on 2026-11-09):

- **dirty**: both keep a flag that a change by the user sets and only a reset clears; a value set back to the initial one stays dirty. Angular sets it from its control directive only, not from a write to the model; TanStack from any `setValue`. TanStack also derives `isDefaultValue`, the current value compared with the default one by its own deep comparison.
- **touched**: Angular, by `markAsTouched`, which its directive calls on blur, a group touched when a child is; TanStack, by any change or blur, per field name, with no groups.
- **pending**: Angular holds a node pending while an asynchronous validator of its own, of an ancestor or of a descendant runs, and drops a stale answer; TanStack holds only fields, its form-level `isValidating` is always false, and a late answer of a form-level validator overwrites a newer one.
- **submitted**: Angular keeps none, only `submitting` during the action; TanStack counts the attempts and keeps `isSubmitted` after a success. Both mark every field touched on submission.
- **disabled**: Angular only, declared by a condition, inherited by the descendants; a disabled node's errors are left out of validity, and its dirty and touched masked, its value kept.
- **issues**: Angular places an issue of a Standard Schema on the field its path names, or on the schema's own field when the last key is missing, and throws when a key on the way is; TanStack places it at the name the path spells, mounted or not. A node's own errors hold none of its descendants'.

## Options

1. **Native, or do nothing.** The platform has form controls and constraint validation, per input, with no tree, no derived state of a group, no schema and no asynchronous answer; or no package, and the product is `schema`, `rules` and bridges to the engines, which T2.7 may still decide. T2.4 exists to measure the difference: rejected for this step.
2. **Wrap Angular Signal Forms or TanStack Form.** The form would take a framework's timing, or another engine's store, and their defects (above), and a bridge to the other framework would carry the first. Rejected: §7.11 builds on the core's node.
3. **A tree of nodes on the reactive graph, described by `field` and `group`, built by `createForm` (kept)**, with the choices below.

How a tree is described:

1. **Read from the initial value**, as all three references do. An array cannot then say whether it is one field holding a list (a multiple choice) or a list of rows (T2.4 b), and a schema of another engine cannot be walked. Rejected.
2. **Read from the schema.** Only a schema of ours could be walked; §5.4 promises any Standard Schema. Rejected.
3. **Descriptions, `field(initial, options)` and `group(children, options)`, built by `createForm(spec)` (kept).** Plain objects, so that one description builds many forms, and a row of a list (T2.4 b) can be built again from its description; the types of the raw and of the parsed value follow the description.

What each state means:

- **dirty: the raw value differs from the initial one (kept)**, TanStack's `isDefaultValue` negated: a state derived from values, which a value set back clears, as an "unsaved changes" warning needs; the sticky flag of both references is an event, not a state. Compared by `equal` of `@yaltaan/core/equal`, which compares a list, a date and a Temporal object by content; a field's `equals` replaces it.
- **touched: a field marked by `touch()` (kept)**, called by the application on blur, as Angular's directive does; a group touched when a field below is. A change does not touch, unlike TanStack.
- **submitted: whether `submit()` was called since the last reset of the form (kept)**, TanStack's attempts above zero: what an application reads to show every error after a first attempt. `submit()` also touches every field, as both references do.
- **pending: a schema that may still place issues on the node, its own, an ancestor's or a descendant's, has not answered for the value it read (kept)**, as Angular holds it: the issues of such a node may still change. Pending only from below would leave a field ready while the schema of its group has not answered.
- **disabled: a condition `{ reads, when }`, the type of `@yaltaan/rules`, on raw values, inherited by every node below (kept)**, as Angular declares it. What it does to issues, to the parsed value and to dirty and touched, where only Angular has an answer, is decided on the pilot, whose billing address and parent company are the cases (T2.4 e): here it changes nothing else.

Where an issue goes, and what is read:

- **A schema on any node**, any Standard Schema; one of ours, told by its vendor `yaltaan` and its `~run`, through `parse`, so that its issues keep their code and their data; another's through `fromStandardIssue` (`issue.external`). Valibot's schemas also carry a `~run`, with another meaning: the first version took them for ours, and read an invalid value as valid. It reads the node's raw value, as both references read the model.
- **An issue goes to the deepest node its path names, from the schema's node down (kept)**: on a field holding a list for a path into the list, on a group for a key that names no child. Angular sends a missing key to the schema's own node, however deep the path got, and throws on one missing on the way.
- **`issues` are those placed on the node, outermost schema first; `parsed` is an error with the issues of the node and of its descendants while there is one or the node is pending, the parsed value otherwise (kept)**: Angular's `errors()` and `errorSummary()`. The parsed value is what the node's schema gave, or with none, a field's raw value and the object of its children's parsed values.

What a promise of a schema does:

- **The promise that one read gave is the generation (kept).** A schema is asked again only when the raw value its node reads has changed: a group's raw value is a new object each time one of its fields holds another value (`Object.is`), so that each answer belongs to one read; a settled answer counts only while its read is the node's last. It is never delivered for a value since replaced, which TanStack 1.33.5 does at form level. A thenable is wrapped in a promise, so that an answer that comes at once still settles outside the computation that asked (ADR 0042).
- **A promise that rejects, or a failure without an issue, places `form.validation_failed` on the schema's node (kept)**, the reason as `cause`. A rejection is mostly a server out of reach, an expected failure: thrown again by `pending`, `issues` and `parsed` of the node, its ancestors and its descendants, as the first version did, it broke every view that reads them. A schema that throws at once stays thrown: that is a bug. What listeners throw when an answer settles is thrown in the promise's callback, where nothing awaits it: the platform reports an unhandled rejection.
- **No signal yet.** The Standard Schema interface takes none. Validators of the application's own with an `AbortSignal`, the abort when a node is removed, and the interleavings of `fc.scheduler()` are T2.4 c's.

## Measurements

On 2026-11-09, Ubuntu 26.04 x64, Node 24.21.0, TypeScript 7.0.2 and 6.0.3, on cores shared with another project's load:

- **Size**, `node scripts/size-report.ts`, scenario `yaltaan/form-realistic`: the first step of the pilot, nested groups, a schema of the whole step and one of a field, a field disabled while a box is checked, every state of a field read, the submission: 5,347 / 5,372 B brotli (esbuild / Rollup), of which the package and the modules it imports weigh 4,053 / 4,078 B, `equal` 1,288 / 1,303 of them, and the schemas the scenario builds about 1,400. The first version weighed 5,290 / 5,323 B; the fixes of the review below cost 57 / 49 B. Budget: the hypothesis of ADR 0010, 7,000 B, kept until the pilot is measured against Angular Signal Forms alone (T2.6). No reference library is measured: neither engine is installed in the workspace.
- **Type cost**, `node scripts/type-cost.ts`, usage `form` (a description of nested groups with a schema of the whole value, a field reading text into a number, a condition, the raw and parsed types read back, a node through `children`, a generic function over any field, the submission): 16,058 instantiations under TypeScript 7 and 11,114 under 6.0 above the fixture, ceilings 17,700 and 12,300 (the measure plus a tenth, rounded up to the hundred, as ADR 0033 and 0038 set theirs); check time +578.5 % with the usage in each of the 2,000 files, budget +900 %. The first version counted 15,366 and 10,461, with `any` in `Spec`; without it, the parsed type of a field described inside a group was inferred `unknown` from the expected type, until `NoInfer` closed that inference.
- **Heap**, 20,000 fields of one group, `--expose-gc`: 1,653 B per field built, 1,862 B once every state is read, 2,277 B with three states watched; a source of the graph alone 120 B, a derived node with its closure 282 B. A field holds three sources (raw, initial, touched), two derived nodes (dirty, parsed) and its own object; the states of a field without a schema, condition or children share their parent's nodes.
- **Depth**: a comb of groups, each holding a field and the next group, builds and reads at 2,000 levels and throws a `RangeError` at 2,500, on Node's default stack.
- **Laws** (`properties.test.ts`): 400 random programs, trees of up to three levels, schemas answering at once, with a promise, or either by value, whose output differs from what they read, conditions hashing every value they read, values that are small integers or lists built anew, and sets, touches, resets, submissions, batches, settlements and rejections in any order, late ones included, half of them with every state of every node watched; after each step, every state of every node equals the naive model's with the keys of every object in order, each schema was asked once per value its node took, and each listener was called exactly when its state changed by the documented equality. One run: 3,978 validations, 263 answers settled after their value was replaced, 231 rejections, 1,526 looks at a `form.validation_failed`, 9,975 notifications, 103 writes refused, in about 2 s.
- **Mutations by hand**, each restored by copy, against an unmutated control that stays green: 13 on the first version against the laws alone, 13 caught; 44 on the final version against laws and examples, 44 caught: among them every mutation the reviewer below saw survive, the stale answer delivered, pending from below only, each order of issues, each batch broken, a reset that keeps `submitted` or `touched`, `reset(undefined)` by the number of arguments, placement and condition paths through `in` or numeric keys, a group's raw value kept by `equal`, a schema's output ignored, valibot taken for ours, a rejection left pending, a failure without an issue read as success.
- **References** (`tests/interop/form-states.mjs`, outside the gate): the same steps on Angular Signal Forms 22.2.4, TanStack Form 1.33.5 and the form, each state asserted on each engine, where they agree (touched by group, issues on their field, submission that touches, reset with a value) and where the form departs on purpose (dirty by value, `submitted`, disabled that leaves issues): a reference that changes its behaviour fails it.
- **Contradictor**: a fresh reviewer, given only the question and the code (183,323 tokens), ran its own probes and 62 mutations of its own, 15 of which survived; verdict: accept with fixes, all applied before this record was committed:
  - valibot's schemas carry a `~run` of their own: the form called `parse` on them, read an invalid value as valid and wrote two keys into its raw value. Ours are now told by their vendor too, and an example reads valibot;
  - the type-cost step had no ceiling for the new usage: written above;
  - placing k issues on one node copied the list each time: 40,000 issues took 7.2 s. They are pushed now, and a test compares 4,000 and 32,000;
  - a group's raw value, kept by `equal`, held an older `Date`, `-0` or list than its field: it now holds the very values, and so do the parsed value and its notifications;
  - `set` read a group's getter once per field below it, mixing several reads in one write, and an empty group accepted anything: each group is read once and refused when it is not an object;
  - `reset(undefined)` made `undefined` the initial value of a `string` field: it now gives the initial value back;
  - a rejected promise was thrown by every state that read it, which broke every view reading `pending`: see the options above;
  - an unhandled rejection when a listener throws during a late answer, the cost of a write over wide groups, the depth and the `O(n × d)` of building were not written: the documentation now says them;
  - 15 mutations survived: each now has its test, and the final campaign above holds them.

## Decision

Option 3.

- **Package**: `@yaltaan/form`, one entry point, declaring `@yaltaan/core` (`equal`, `fromStandardIssue`, `Path`, the graph, `Result`), `@yaltaan/schema` (`parse` and the Standard Schema types) and `@yaltaan/rules` (the type `Condition` only), at the exact version of the workspace, and nothing else.
- **API**: `field(initial, { schema, disabled, equals })`, `group(children, { schema, disabled })`, `createForm(spec, { graph })`. Every node has `path`, `raw`, `parsed`, `issues`, `dirty`, `touched`, `pending`, `submitted`, `disabled`, each a `ReadableNode` of the form's graph, and `set(raw)`, `touch()`, `reset(raw?)`; a group, `children`; the root, `graph` and `submit()`.
- **Writes**: `set` of a group reads the own property of each child's key, once, `undefined` when absent, every value before any write, in one batch; a group given anything else than an object at any level, an empty one included, throws a `TypeError`, nothing written. `reset(raw)` makes `raw` the initial value; `reset()` and `reset(undefined)` give the initial value back, as Angular's `reset(value?)` reads an absent value (deciding by the number of arguments let `reset(undefined)` type-check and make `undefined` the initial value of a `string` field); both mark untouched, and the root's also clears `submitted`. A child named `__proto__`, `constructor` or `prototype` is refused.
- **Computation**: every state is a node that computes when read and again only when what it reads has changed; a schema is asked only when a state that needs its answer is read, once per raw value. A condition names what it reads at construction, as every computation of the graph must (ADR 0042), and a path that names no node is refused then.
- **Values**: a group's raw value, and its parsed value without a schema, hold the very values of its children, never an older one kept for being equal; a read value changes when it turns ok or not, when its issues change by content, or when its value is another.
- **Errors**: what a schema, a condition or `equals` throws at once is thrown by every state that depends on it, and by nothing else; a rejected promise, or a failure without an issue, is the issue `form.validation_failed` on the schema's node, registered in `docs/issue-codes/form.md`.
- **Budgets**: `yaltaan/form-realistic` keeps its hypothesis of 7,000 B; the usage `form` gets the ceilings above, 17,700 and 12,300.

## Consequences

- `@yaltaan/form` is a fourth published package: the release, the graph and the rehearsal pick it up.
- A Standard Schema of `refine` from `@yaltaan/rules` reaches the form through its interface, so its issues arrive as `issue.external` with the code as message. Rules read by the form itself, revalidated only when what they read changes (§7.11), keep their codes: T2.4 d, with `requiredPaths` as a derived state.
- Angular departs where its flags are events; the form's states are derived from values, and a bridge (T2.5) shows them as they are. A component that wants Angular's sticky `dirty` reads `touched` or keeps its own.
- What the judges do not see: values beyond small integers and lists built anew (`equals`, `NaN`, `-0` are in the examples), schemas and conditions that throw (examples), listeners that read other nodes during a write (examples), laziness (examples), the cost of a step (one test counts the comparisons a write makes, one compares the time to place 4,000 and 32,000 issues), and the issues of rules, which no step has yet.
- Costs that remain: a write recomposes the raw value of each ancestor read or watched, O(c) per ancestor (c = its children), so that writing each field of a flat group of n fields once costs O(n²) (the reviewer measured 0.5 ms per write at 1,000 fields, 6.5 ms at 8,000, `parsed` watched); every node holds its path, so a tree of depth d costs O(n × d); building is recursive, and nesting deeper than the stack allows throws a `RangeError`.
- Nodes carry their internal states as own properties; a field's `raw` and `touched` are its sources, whose `set` does what `set` and `touch` do. The types show none of it.
- Every field costs about 1.65 kB of heap. Rows of a list (T2.4 b) multiply it: that step measures it on a thousand rows, and building the states of a node only when first read is the lever, at the price of bytes.
- A whole-form schema reads the whole value on every change of any field, as both references do; targeted revalidation comes with rules (T2.4 d).

## Review condition

The pilot (T2.6) needing a state these do not give, or a reference's meaning (Angular's sticky `dirty`) where this one gives another; T2.4 e deciding that disabled nodes drop their issues; the heap of a row measured significant by T2.4 b; the size of `form-realistic` over 7,000 B; the go/no-go decision of T2.7.
