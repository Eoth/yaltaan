// What an application writes with the arrays of the form on the model every fixture has: lines kept by their
// reference, each with a schema of its own and a field disabled through its item, a schema of the whole list; the raw
// and parsed types read back; an item reached through `items`, inserted, moved and removed; a generic function over
// any array; and the submission.
import { array, createForm, field, group, type ArrayNode, type ItemOf, type RawOf, type Spec } from '@yaltaan/form';
import { array as list, number, object, string } from '@yaltaan/schema';

import type { Model } from '../model.ts';

const lineSchema = object({
  sku: string({ minLength: 1 }),
  quantity: number({ min: 1 }),
  unitPrice: number({ min: 0 }),
});

const line = group(
  {
    sku: field(''),
    quantity: field(1, { disabled: { reads: [['lines', { key: undefined }, 'sku']], when: (sku) => sku === '' } }),
    unitPrice: field(0),
  },
  { schema: lineSchema },
);

const invoice = group({
  id: field(''),
  lines: array(line, { identity: ['sku'], schema: list(lineSchema) }),
});

export type InvoiceRaw = RawOf<typeof invoice>;

const form = createForm(invoice);

export function readLines(): Pick<Model, 'id' | 'lines'> | undefined {
  const parsed = form.submit();
  return parsed.ok ? parsed.value : undefined;
}

export const first: ItemOf<typeof line> | undefined = form.children.lines.items.get()[0];

export function keys<E extends Spec>(node: ArrayNode<E, unknown>): readonly unknown[] {
  return node.items.get().map((item) => item.key);
}

export const added = form.children.lines.insert(0, { sku: 'A-1', quantity: 2, unitPrice: 10 });
export const moved = form.children.lines.move(added, 0) && form.children.lines.remove(added);
export const shown = [keys(form.children.lines), first?.children.quantity.issues.get()] as const;
export const raw: InvoiceRaw = form.raw.get();
