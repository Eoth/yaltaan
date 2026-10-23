# Pilot form: supplier onboarding

The form Yaltaan's schema, rules and form layers are judged on: an application a purchasing team fills in to open an account for a new supplier. It has what makes business forms costly to write: fields of every kind, several steps, lists whose elements carry their own errors, lists inside lists, checkboxes that open a sub-form, fields required only under conditions, rules across fields, list elements and nesting levels, values derived from other fields, and checks only the server can make.

| Step | Fields | What makes it hard |
|---|---|---|
| 1. Company | legal name, country, SIREN or foreign registration, VAT number, legal form, founding date, head office address; checkbox "billing address same as head office" and the billing address; checkbox "has a parent company" and its sub-form (name, country, SIREN, ownership, address) | SIREN in France, foreign registration elsewhere, never both; VAT in the EU; postal code format by country, down to the parent's address (four levels); the billing address copied from the head office while the box is checked, required once unchecked; the parent required once checked, dropped from the submission once unchecked |
| 2. Contacts | one to five contacts: name, email, phone, roles (multiple choice), primary flag | emails unique ignoring case, exactly one primary, at least one billing contact; errors follow a contact when the list is reordered |
| 3. Bank | IBAN, BIC, account holder | mod-97 checksum; BIC required outside the SEPA area |
| 4. Terms | payment term, deposit percentage, contract number and date, validity period | deposit percentage required for payment by deposit, 1 to 50; contract number and date together or not at all; end on or after start |
| 5. Catalogue | currency; products (reference, label, category, unit price, taxable, VAT rate, minimum quantity) and, inside each product, its volume discounts (from quantity, discount) | references unique; VAT rate required when taxable; price with tax derived per product and rounded to the cent; at most three discounts, increasing quantities and discounts, the first at or above the product's minimum quantity; product count and highest discount derived over the whole list |
| 6. Documents | supporting documents (kind, file, issue and expiry dates), two declarations | Kbis extract required in France and at most 90 days old; insurance expiry required; expiry after issue; declarations accepted |
| Submission | — | server answers: SIREN already registered, account refused, server unreachable |

- [model.ts](model.ts): the values; 72 fields with their step and kind (text, number, whole number, boolean, choice, multiple choice, date, object, list); 43 rules with the code of their issue and the fields they read and mark; 5 derived values with their inputs.
- [scenarios.ts](scenarios.ts): 42 acceptance scenarios as data: entered values, day of submission, server answer, every expected issue (rule and path) and the derived values the form must hold. Every number in them is made up.
- [scenarios.test.ts](scenarios.test.ts): checks that the form has a field of every kind, a list inside a list and derived fields; that every issue and derived value names a field, an existing list element and a rule or derivation of the catalogue; and that every rule and derivation appears in a scenario.

The scenarios run against the library once `@yaltaan/schema` and `@yaltaan/rules` exist; until then they fix what the form must do.
