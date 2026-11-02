// The shapes a form's schema takes: nested objects, an array, optional and nullable fields, a discriminated union; its
// two inferred types; a read of unknown data given to the application's own `Model`, the assignment a caller makes; a
// narrowing on the union; the schema with its messages, the one an engine reads; and what an engine declares, a generic
// function over any schema with a callback given its output. It holds no `children`: this version of the schemas has
// no recursion.
import {
  array,
  discriminatedUnion,
  literal,
  nullable,
  number,
  object,
  optional,
  parse,
  string,
  withMessages,
  type InferInput,
  type InferOutput,
  type StandardSchema,
} from '@yaltaan/schema';

import type { Model } from '../model.ts';

const invoice = object({
  id: string({ minLength: 1 }),
  total: number({ min: 0 }),
  tags: array(string()),
  customer: object({
    name: string(),
    email: optional(string(), { exactOptional: true }),
    address: object({ street: string(), city: string(), zip: nullable(string()) }),
  }),
  lines: array(object({ sku: string(), quantity: number({ integer: true }), unitPrice: number() })),
  payment: discriminatedUnion('by', [
    object({ by: literal('card'), last4: string({ maxLength: 4 }) }),
    object({ by: literal('transfer'), iban: string() }),
  ]),
});

export type InvoiceInput = InferInput<typeof invoice>;
export type InvoiceOutput = InferOutput<typeof invoice>;

export function readInvoice(data: unknown): Pick<Model, 'id' | 'total' | 'tags' | 'customer' | 'lines'> | undefined {
  const read = parse(invoice, data);
  return read.ok ? read.value : undefined;
}

export function paymentOf(value: InvoiceOutput): string {
  return value.payment.by === 'card' ? value.payment.last4 : value.payment.iban;
}

export const worded = withMessages(invoice, (issue) => issue.code);

declare function useForm<S extends StandardSchema>(schema: S, submit: (value: InferOutput<S>) => void): void;

useForm(worded, (value) => value.customer.address.city.length);
