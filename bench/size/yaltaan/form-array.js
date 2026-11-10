// The catalogue step of the pilot on the form package: a list of products kept by their reference, each holding its
// list of volume discounts; a schema of each product and one of the list; a VAT rate disabled while its product is
// not taxable; every state of an item read; an item inserted, moved and removed; the submission.
import { array, createForm, field, group } from '@yaltaan/form';
import { array as list, boolean, number, object, string } from '@yaltaan/schema';

const discount = () => group({ fromQuantity: field(1), percent: field(0) });
const product = object({
  reference: string({ minLength: 1, maxLength: 40 }),
  label: string({ minLength: 1, maxLength: 120 }),
  unitPrice: number({ min: 0 }),
  taxable: boolean(),
  vatRate: number({ min: 0, max: 100 }),
  discounts: list(object({ fromQuantity: number({ min: 1 }), percent: number({ min: 0, max: 100 }) })),
});

export const form = createForm(
  group({
    currency: field('EUR'),
    products: array(
      group(
        {
          reference: field(''),
          label: field(''),
          unitPrice: field(0),
          taxable: field(true),
          vatRate: field(20, {
            disabled: { reads: [['products', { key: undefined }, 'taxable']], when: (taxable) => taxable !== true },
          }),
          discounts: array(discount(), { maxLength: 10 }),
        },
        { schema: product },
      ),
      { identity: ['reference'], maxLength: 200, schema: list(product, { maxLength: 200 }) },
    ),
  }),
);

export const view = (node) => ({
  value: node.raw.get(),
  issues: node.issues.get(),
  dirty: node.dirty.get(),
  touched: node.touched.get(),
  pending: node.pending.get(),
  submitted: node.submitted.get(),
  disabled: node.disabled.get(),
});

export const edit = () => {
  const products = form.children.products;
  const added = products.insert(0, {
    reference: 'P-1',
    label: 'Pallet',
    unitPrice: 12,
    taxable: true,
    vatRate: 20,
    discounts: [{ fromQuantity: 10, percent: 5 }],
  });
  added.children.discounts.insert(1);
  products.move(added, products.items.get().length - 1);
  products.remove(added);
  return products.items.get().map((item) => item.key);
};

export const submit = () => form.submit();
