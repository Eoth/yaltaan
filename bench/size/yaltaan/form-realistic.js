// The first step of the pilot form on the form package: nested groups, a schema of the whole step and one of a field, a
// field disabled while a box is checked, every state of a field read, and the submission.
import { createForm, field, group } from '@yaltaan/form';
import { boolean, object, optional, string } from '@yaltaan/schema';

const address = () => group({ street: field(''), postalCode: field(''), city: field(''), country: field('FR') });
const text = string({ minLength: 1, maxLength: 120 });
const addressSchema = object({ street: text, postalCode: string({ maxLength: 12 }), city: text, country: string() });

export const form = createForm(
  group(
    {
      legalName: field('', { schema: string({ minLength: 2, maxLength: 120 }) }),
      siren: field(''),
      headOffice: address(),
      billingSameAsHeadOffice: field(true),
      billingAddress: group(address().children, {
        disabled: { reads: [['billingSameAsHeadOffice']], when: (same) => same === true },
      }),
    },
    {
      schema: object({
        legalName: string(),
        siren: optional(string({ pattern: /^\d{9}$/ })),
        headOffice: addressSchema,
        billingSameAsHeadOffice: boolean(),
        billingAddress: object({ street: string(), postalCode: string(), city: string(), country: string() }),
      }),
    },
  ),
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

export const submit = () => form.submit();
