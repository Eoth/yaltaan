// The form of ARCHITECTURE.md §7.11 and ADR 0043 and 0044: a tree of fields, groups and arrays described by `field`,
// `group` and `array`, built by `createForm` on one reactive graph (ADR 0041), every state a node of that graph. A
// field holds its raw value, what its input shows, and its initial value; whether it was touched; an array, its items
// and its initial raw value; the form, whether it was submitted. Everything else is derived, computed when read and
// again only once what it reads has changed:
//   - a group's raw value is the object of its children's raw values, by key, in the order of the description, and an
//     array's the list of its items' raw values: a new one each time one of them is another value (`Object.is`), or
//     the items change, never an older one kept for being equal;
//   - an item is a node built from the array's element, holding a key for as long as it lives: its path ends with
//     `{ key }`, so that its states, and the issues placed on it, follow it when it moves;
//   - dirty: a field whose raw value differs from its initial value, by `equal` of @yaltaan/core/equal unless its
//     `equals` says otherwise; a group with a dirty child; an array whose raw value differs from its initial one, its
//     length or an item, by the comparisons of its fields. Touched: a field touched since its last reset; a group or
//     an array holding a touched field. Submitted: the form's, on every node;
//   - disabled: a node whose `disabled` condition holds on the raw values it reads, or whose parent is disabled;
//   - a node with a schema reads its raw value through it, any Standard Schema; a schema of @yaltaan/schema through
//     `parse`, so that its issues keep their code and their data. Each issue is placed on the deepest node its path
//     names below the schema's node, through the children's own keys and, in the raw value the schema read, the
//     items' indexes or `{ key }` segments: an index is then replaced by the item's `{ key }`, so that the path of an
//     issue starts with the path of its node. `issues` of a node are those placed on it, from the outermost schema to
//     its own. A schema whose promise rejects, or that fails without an issue, places `form.validation_failed` on its
//     node: the form has nothing else to show;
//   - a node with a validator of the application checks its raw value as only the application can, once no schema of
//     the node, of a node below or of an ancestor has placed an issue on it or below, or has yet to answer; the run
//     counts until its raw value or the lives of its items change, a schema places such an issue, or the node leaves
//     the form, and is handed a signal of its own, aborted when it stops counting before it answered. Its issues are
//     placed as a schema's; a node shows those of its schema while there are any, those of its validator otherwise;
//   - pending: a node that a schema or a validator may still place issues on, its own, an ancestor's or a
//     descendant's, because it has not yet answered for the raw value it reads. An answer is the promise that one read,
//     or one run, gave: settled, it counts only while that read is the node's last one, and the node is in the form, so
//     that the answer for a value since replaced, or for a removed item, is never delivered;
//   - parsed, the read value: an error with the issues of the node and of its descendants, in that order, while there
//     is one or the node is pending; otherwise the value its schema gave, or with none, its raw value for a field, the
//     object of its children's parsed values for a group and the list of its items' for an array.
// A computation never reads the graph (ADR 0042): every state names what it reads when it is built, the nodes a
// condition reads included, whatever branch its `when` takes; the states of an array that follow its items are rewired
// to the new items each time they change (ADR 0044). A write reads its whole value, and checks it, before it writes
// anything. An answer that settles after its read is delivered from the promise's callback, where nothing awaits what
// the listeners throw. Validators are ADR 0045's.
export { createForm, field, group } from './node.ts';
export type {
  ArrayNode,
  ArrayOptions,
  ArraySpec,
  Children,
  FieldNode,
  FieldOptions,
  FieldSpec,
  Form,
  FormIssue,
  FormNode,
  FormOptions,
  GroupNode,
  GroupOptions,
  GroupSpec,
  ItemOf,
  NodeOf,
  NodeSpecOptions,
  OutputOf,
  RawOf,
  Spec,
  Validation,
} from './types.ts';
export { array } from './array.ts';
