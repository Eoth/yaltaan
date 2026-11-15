# @yaltaan/angular

The bridge between Yaltaan and Angular Signal Forms, Angular 22 and later. `validateRules` puts the rules of `@yaltaan/rules` into the schema function of Signal Forms' `form`: each rule is checked again only once a value it declares changes, its issues become errors whose kind is their code, on the field their path names, and the fields a rule requires are marked as required, the native attribute included, without an error of Angular's beside the rule's own. `fromNode` turns a node of the reactive graph of `@yaltaan/core` into an Angular signal, and `signalsOf` every state of a node of `@yaltaan/form` into one, each subscribed on its first read and let go with its component. The bridge holds no state of its own and imposes no markup.

**Not published yet**: the package is private until its first release. Every export is `@experimental`: it may change in a minor version until the contracts are frozen.

```ts angular
import { Component, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { validateRules } from '@yaltaan/angular';
import { allOrNone, requiredIf } from '@yaltaan/rules';

@Component({
  selector: 'app-supplier',
  imports: [FormField],
  template: `
    <label for="siren">SIREN</label>
    <input
      id="siren"
      [formField]="supplier.siren"
      [attr.aria-invalid]="supplier.siren().invalid()"
      aria-describedby="siren-errors"
    />
    <ul id="siren-errors" aria-live="polite">
      @for (error of supplier.siren().errors(); track $index) {
        <li>{{ error.message }}</li>
      }
    </ul>
  `,
})
export class Supplier {
  readonly model = signal({ country: 'FR', siren: '', contract: { number: 'C-1', signedOn: '' } });
  readonly supplier = form(this.model, (path) =>
    validateRules(path, [
      requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']]),
      allOrNone([
        ['contract', 'number'],
        ['contract', 'signedOn'],
      ]),
    ]),
  );
}
```

Here the SIREN input is required, marked invalid and shows `rules.required_if`, announced to a screen reader, and the date of signature shows `rules.all_or_none`; typing a SIREN clears the first, and only the rule that reads the SIREN is checked again. Pass `format` to build each message from its issue, with the application's words; pass `resolveKey` when a rule names list elements by a business key (`unique` with `identity`), so that each error lands on its element as the list moves.

- [Reference](../../docs/reference/angular.md).
- Why it is built this way: [the bridge, and Angular installed to build and test it](../../docs/adr/0048-angular-bridge.md).

Peer dependencies: `@angular/core` and `@angular/forms` 22. No other third-party runtime dependency: `@yaltaan/core`, `@yaltaan/rules`, `@yaltaan/form`, and the types of `@yaltaan/schema`. ESM only, `"sideEffects": false`.
