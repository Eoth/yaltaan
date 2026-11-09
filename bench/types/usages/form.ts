// What an application writes with the form on the model every fixture has: a description of nested groups, fields
// holding a list and a nullable value, a schema of the whole value that types the parsed value, a field whose schema
// reads text into a number, and a disabled condition; the raw and parsed types read back; a node of the tree reached
// through `children`; what an adapter declares, a generic function over any field and any node; and the submission.
import { createForm, field, group, type FieldNode, type FormNode, type RawOf } from '@yaltaan/form';
import { array, nullable, number, object, string } from '@yaltaan/schema';

import type { Model } from '../model.ts';

const invoice = group(
  {
    id: field(''),
    total: field('', { schema: number({ min: 0 }) }),
    tags: field<string[]>([]),
    customer: group({
      name: field(''),
      email: field(''),
      address: group({
        street: field(''),
        city: field('', { disabled: { reads: [['customer', 'name']], when: (name) => name === '' } }),
        zip: field<string | null>(null),
      }),
    }),
  },
  {
    schema: object({
      id: string({ minLength: 1 }),
      total: number(),
      tags: array(string()),
      customer: object({
        name: string(),
        email: string(),
        address: object({ street: string(), city: string(), zip: nullable(string()) }),
      }),
    }),
  },
);

export type InvoiceRaw = RawOf<typeof invoice>;

const form = createForm(invoice);

export function readInvoice(): Pick<Model, 'id' | 'total' | 'tags' | 'customer'> | undefined {
  const parsed = form.submit();
  return parsed.ok ? parsed.value : undefined;
}

export const city: FieldNode<string> = form.children.customer.children.address.children.city;

export function bind<R>(node: FieldNode<R, unknown>, write: (raw: R) => void): () => void {
  return node.raw.subscribe(() => write(node.raw.get()));
}

export function errorsOf(node: FormNode<unknown, unknown>): readonly string[] {
  return node.touched.get() || node.submitted.get() ? node.issues.get().map((issue) => issue.code) : [];
}

export const shown = [errorsOf(city), errorsOf(form), bind(form.children.id, () => undefined)] as const;
export const raw: InvoiceRaw = form.raw.get();
