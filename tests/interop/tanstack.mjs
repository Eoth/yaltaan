// A schema of @yaltaan/schema read by TanStack Form, which reads Standard Schema natively, with no bridge, through its
// framework-free core. Run by tests/interop/run.sh, from the tarballs an application would install.
import assert from 'node:assert/strict';

import { FieldApi, FormApi } from '@tanstack/form-core';
import { allOrNone, atLeast, refine } from '@yaltaan/rules';
import { number, object, optional, string, withMessages } from '@yaltaan/schema';

const login = object({
  email: string({ pattern: /^[^@]+@[^@]+$/, maxLength: 254 }),
  password: string({ minLength: 8 }),
  age: optional(number({ min: 0 })),
});

const onChange = new FormApi({
  defaultValues: { email: 'nope', password: 'short', age: -1 },
  validators: { onChange: login },
});
onChange.mount();
for (const name of ['email', 'password', 'age']) {
  new FieldApi({ form: onChange, name }).mount();
}
onChange.validateSync('change');
assert.equal(onChange.state.isValid, false);
assert.deepEqual(onChange.getFieldMeta('email')?.errors, [{ message: 'schema.invalid_format', path: ['email'] }]);
assert.deepEqual(onChange.getFieldMeta('password')?.errors, [{ message: 'schema.too_short', path: ['password'] }]);
assert.deepEqual(onChange.getFieldMeta('age')?.errors, [{ message: 'schema.too_small', path: ['age'] }]);
onChange.setFieldValue('email', 'a@b.cd');
onChange.setFieldValue('password', 'analytical');
onChange.setFieldValue('age', 3);
onChange.validateSync('change');
assert.equal(onChange.state.isValid, true);

let submitted;
const onSubmit = new FormApi({
  defaultValues: { email: 'a@b.cd', password: 'analytical' },
  validators: { onSubmit: login },
  onSubmit: ({ value }) => {
    submitted = value;
  },
});
onSubmit.mount();
await onSubmit.handleSubmit();
assert.deepEqual(submitted, { email: 'a@b.cd', password: 'analytical' });

const field = new FieldApi({
  form: onChange,
  name: 'email',
  validators: { onChange: withMessages(string({ minLength: 100 }), (issue) => `Too short: ${issue.code}`) },
});
field.mount();
field.setValue('x');
assert.deepEqual(field.state.meta.errors, [{ message: 'Too short: schema.too_short' }]);
const contract = refine(
  object({
    number: optional(string()),
    signedOn: optional(string()),
    phone: optional(string()),
    email: optional(string()),
  }),
  [allOrNone([['number'], ['signedOn']]), atLeast(1, [['phone'], ['email']])],
);
const signed = new FormApi({ defaultValues: { number: 'C-1' }, validators: { onChange: contract } });
signed.mount();
for (const name of ['number', 'signedOn', 'phone', 'email']) {
  new FieldApi({ form: signed, name }).mount();
}
signed.validateSync('change');
assert.equal(signed.state.isValid, false);
assert.deepEqual(signed.getFieldMeta('signedOn')?.errors, [{ message: 'rules.all_or_none', path: ['signedOn'] }]);
assert.deepEqual(signed.getFieldMeta('phone')?.errors, [{ message: 'rules.at_least', path: ['phone'] }]);
assert.deepEqual(signed.getFieldMeta('email')?.errors, [{ message: 'rules.at_least', path: ['email'] }]);
signed.setFieldValue('signedOn', '2026-11-02');
signed.setFieldValue('phone', '01');
signed.validateSync('change');
assert.equal(signed.state.isValid, true);
console.log('ok: TanStack Form reads the schemas and the rules, each issue on its field');
