# Pilot form: supplier onboarding

The form Yaltaan's schema, rules and form layers are judged on: an application a purchasing team fills in to open an account for a new supplier. It has what makes business forms costly to write: several steps, dynamic lists whose elements carry their own errors, fields required only under conditions, rules that read several fields, and checks only the server can make.

| Step | Fields | What makes it hard |
|---|---|---|
| 1. Company | legal name, country, SIREN or foreign registration, VAT number, legal form, founding date | SIREN required in France, a foreign registration elsewhere, never both; VAT required in the EU; "other" legal form spelled out; checksum; no date after today |
| 2. Contacts | one to five contacts: name, email, phone, roles, primary flag | emails unique ignoring case, exactly one primary, at least one billing contact; errors follow a contact when the list is reordered |
| 3. Bank | IBAN, BIC, account holder | mod-97 checksum; BIC required outside the SEPA area |
| 4. Terms | payment term, deposit percentage, contract number and date, validity period | deposit percentage required for payment by deposit, 1 to 50; contract number and date together or not at all; end on or after start |
| 5. Documents | supporting documents (kind, file, issue and expiry dates), two declarations | Kbis extract required in France and at most 90 days old; insurance expiry required; expiry after issue; declarations accepted |
| Submission | — | server answers: SIREN already registered, account refused, server unreachable |

- [model.ts](model.ts): the values, every field with its step, and every rule with the code of its issue, the fields it reads and the fields it marks.
- [scenarios.ts](scenarios.ts): 26 acceptance scenarios as data: submitted values, day of submission, server answer, and every expected issue with its code and path. Every number in them is made up.
- [scenarios.test.ts](scenarios.test.ts): checks that every expected issue names a field, an existing list element and a rule of the catalogue, and that every rule appears in a scenario.

The scenarios run against the library once `@yaltaan/schema` and `@yaltaan/rules` exist; until then they fix what the form must do.
