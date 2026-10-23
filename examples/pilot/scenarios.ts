// The acceptance scenarios of the pilot form, as data: the values a user submits, the day of the submission, what the
// server answers, and every issue the form must show, with its code and its path. Written before the code that will
// pass them; the same scenarios become executable once a schema and rules exist to run them. Every number in them is
// made up: the SIREN 123456782 only satisfies its checksum, the IBANs are the examples of the IBAN registry.
import type { PilotPath, SupplierApplication } from './model.ts';

/** What the server answers when the form submits valid values. */
export type ServerAnswer = 'accepted' | 'siren-taken' | 'iban-rejected' | 'unavailable';

export interface ExpectedIssue {
  readonly code: string;
  readonly path: PilotPath;
}

export interface Scenario {
  readonly name: string;
  readonly given: string;
  /** The day of the submission, ISO 8601: the rules that compare with today read it, never the machine's clock. */
  readonly today: string;
  /** The submitted values; `unknown` where a scenario sends what no form would. */
  readonly values: SupplierApplication | Readonly<Record<string, unknown>>;
  /** Only consulted when the values pass every check of the form. */
  readonly server: ServerAnswer;
  /** Every issue the form shows, in any order; none for a valid application. */
  readonly issues: readonly ExpectedIssue[];
}

const today = '2026-10-23';

/** A complete and valid application from a French company. */
export const frenchSupplier: SupplierApplication = {
  company: {
    legalName: 'Atelier Durand SAS',
    country: 'FR',
    siren: '123456782',
    vatNumber: 'FR32123456782',
    legalForm: 'SAS',
    foundedOn: '2012-03-01',
  },
  contacts: [
    {
      key: 'c1',
      firstName: 'Claire',
      lastName: 'Durand',
      email: 'claire.durand@atelier-durand.example',
      roles: ['billing', 'sales'],
      primary: true,
    },
    {
      key: 'c2',
      firstName: 'Karim',
      lastName: 'Benali',
      email: 'karim.benali@atelier-durand.example',
      phone: '+33 1 23 45 67 89',
      roles: ['technical'],
      primary: false,
    },
  ],
  bank: { iban: 'FR7630006000011234567890189', accountHolder: 'Atelier Durand SAS' },
  terms: { paymentTerm: 'NET45', validFrom: '2026-11-01', validTo: '2027-10-31' },
  documents: [
    { key: 'd1', kind: 'kbis', fileName: 'kbis.pdf', issuedOn: '2026-09-15' },
    { key: 'd2', kind: 'insurance', fileName: 'assurance-rc.pdf', issuedOn: '2026-01-01', expiresOn: '2027-01-01' },
  ],
  declarations: { accuracy: true, dataProcessing: true },
};

/** A complete and valid application from a German company: no SIREN, a foreign registration, a SEPA account. */
export const germanSupplier: SupplierApplication = {
  ...frenchSupplier,
  company: {
    legalName: 'Müller Präzision GmbH',
    country: 'DE',
    foreignRegistration: 'HRB 123456',
    vatNumber: 'DE123456789',
    legalForm: 'OTHER',
    legalFormOther: 'GmbH',
    foundedOn: '1998-06-15',
  },
  bank: { iban: 'DE89370400440532013000', accountHolder: 'Müller Präzision GmbH' },
  documents: [
    { key: 'd2', kind: 'insurance', fileName: 'versicherung.pdf', issuedOn: '2026-01-01', expiresOn: '2027-01-01' },
  ],
};

type Company = SupplierApplication['company'];
type Terms = SupplierApplication['terms'];

const withCompany = (company: Partial<Company>, drop: readonly (keyof Company)[] = []): SupplierApplication => {
  const merged: Record<string, unknown> = { ...frenchSupplier.company, ...company };
  for (const key of drop) {
    delete merged[key];
  }
  return { ...frenchSupplier, company: merged as unknown as Company };
};

const withTerms = (terms: Partial<Terms>): SupplierApplication => ({
  ...frenchSupplier,
  terms: { ...frenchSupplier.terms, ...terms },
});

const [claire, karim] = frenchSupplier.contacts as readonly [
  SupplierApplication['contacts'][number],
  SupplierApplication['contacts'][number],
];
const [kbis, insurance] = frenchSupplier.documents as readonly [
  SupplierApplication['documents'][number],
  SupplierApplication['documents'][number],
];

export const scenarios: readonly Scenario[] = [
  {
    name: 'valid French supplier',
    given: 'every field filled as the rules ask, the server accepts',
    today,
    values: frenchSupplier,
    server: 'accepted',
    issues: [],
  },
  {
    name: 'valid German supplier',
    given: 'a company outside France with its registration number, a SEPA account without BIC, no Kbis',
    today,
    values: germanSupplier,
    server: 'accepted',
    issues: [],
  },
  {
    name: 'German company without registration number',
    given: 'country DE, the foreign registration number left empty',
    today,
    values: {
      ...germanSupplier,
      company: {
        legalName: germanSupplier.company.legalName,
        country: 'DE',
        vatNumber: 'DE123456789',
        legalForm: 'OTHER',
        legalFormOther: 'GmbH',
        foundedOn: germanSupplier.company.foundedOn,
      },
    },
    server: 'accepted',
    issues: [{ code: 'rules.required_if', path: ['company', 'foreignRegistration'] }],
  },
  {
    name: 'French company without SIREN',
    given: 'country FR, the SIREN left empty',
    today,
    values: withCompany({}, ['siren']),
    server: 'accepted',
    issues: [{ code: 'rules.required_if', path: ['company', 'siren'] }],
  },
  {
    name: 'two registration numbers',
    given: 'a French company that also fills the foreign registration number',
    today,
    values: withCompany({ foreignRegistration: 'HRB 123456' }),
    server: 'accepted',
    issues: [
      { code: 'rules.mutually_exclusive', path: ['company', 'siren'] },
      { code: 'rules.mutually_exclusive', path: ['company', 'foreignRegistration'] },
    ],
  },
  {
    name: 'SIREN with a wrong checksum',
    given: 'nine digits whose Luhn checksum fails',
    today,
    values: withCompany({ siren: '123456789', vatNumber: 'FR32123456789' }),
    server: 'accepted',
    issues: [{ code: 'pilot.siren_checksum', path: ['company', 'siren'] }],
  },
  {
    name: 'European company without VAT number',
    given: 'country FR, the VAT number left empty',
    today,
    values: withCompany({}, ['vatNumber']),
    server: 'accepted',
    issues: [{ code: 'rules.required_if', path: ['company', 'vatNumber'] }],
  },
  {
    name: 'legal form OTHER left unexplained',
    given: 'legal form OTHER, its description empty, and a legal name of one character',
    today,
    values: withCompany({ legalForm: 'OTHER', legalName: 'A' }),
    server: 'accepted',
    issues: [
      { code: 'rules.required_if', path: ['company', 'legalFormOther'] },
      { code: 'schema.too_short', path: ['company', 'legalName'] },
    ],
  },
  {
    name: 'company founded tomorrow',
    given: 'a founding date after the day of submission',
    today,
    values: withCompany({ foundedOn: '2026-10-24' }),
    server: 'accepted',
    issues: [{ code: 'schema.too_large', path: ['company', 'foundedOn'] }],
  },
  {
    name: 'two contacts with the same email',
    given: 'the second contact copies the first email in upper case; both are marked, by key',
    today,
    values: { ...frenchSupplier, contacts: [claire, { ...karim, email: 'CLAIRE.DURAND@atelier-durand.example' }] },
    server: 'accepted',
    issues: [
      { code: 'rules.unique', path: ['contacts', { key: 'c1' }, 'email'] },
      { code: 'rules.unique', path: ['contacts', { key: 'c2' }, 'email'] },
    ],
  },
  {
    name: 'duplicate emails after reordering',
    given: 'the same two contacts, the list reordered: the issues stay on the same contacts',
    today,
    values: { ...frenchSupplier, contacts: [{ ...karim, email: 'CLAIRE.DURAND@atelier-durand.example' }, claire] },
    server: 'accepted',
    issues: [
      { code: 'rules.unique', path: ['contacts', { key: 'c1' }, 'email'] },
      { code: 'rules.unique', path: ['contacts', { key: 'c2' }, 'email'] },
    ],
  },
  {
    name: 'two primary contacts and no billing contact',
    given: 'both contacts primary, neither with the billing role, one email malformed, one contact without role',
    today,
    values: {
      ...frenchSupplier,
      contacts: [
        { ...claire, roles: ['sales'], email: 'claire.durand-at-atelier' },
        { ...karim, primary: true, roles: [] },
      ],
    },
    server: 'accepted',
    issues: [
      { code: 'rules.exactly', path: ['contacts'] },
      { code: 'rules.at_least', path: ['contacts'] },
      { code: 'schema.invalid_format', path: ['contacts', { key: 'c1' }, 'email'] },
      { code: 'schema.too_small', path: ['contacts', { key: 'c2' }, 'roles'] },
    ],
  },
  {
    name: 'no contact at all',
    given: 'the contact list emptied',
    today,
    values: { ...frenchSupplier, contacts: [] },
    server: 'accepted',
    issues: [
      { code: 'schema.too_small', path: ['contacts'] },
      { code: 'rules.exactly', path: ['contacts'] },
      { code: 'rules.at_least', path: ['contacts'] },
    ],
  },
  {
    name: 'IBAN with a wrong checksum',
    given: 'the last digit of the IBAN changed',
    today,
    values: { ...frenchSupplier, bank: { ...frenchSupplier.bank, iban: 'FR7630006000011234567890188' } },
    server: 'accepted',
    issues: [{ code: 'pilot.iban_checksum', path: ['bank', 'iban'] }],
  },
  {
    name: 'account outside SEPA without BIC',
    given: 'a Brazilian IBAN, the BIC left empty',
    today,
    values: { ...frenchSupplier, bank: { ...frenchSupplier.bank, iban: 'BR1800360305000010009795493C1' } },
    server: 'accepted',
    issues: [{ code: 'rules.required_if', path: ['bank', 'bic'] }],
  },
  {
    name: 'deposit without percentage',
    given: 'payment by deposit, the percentage left empty',
    today,
    values: withTerms({ paymentTerm: 'DEPOSIT' }),
    server: 'accepted',
    issues: [{ code: 'rules.required_if', path: ['terms', 'depositPercent'] }],
  },
  {
    name: 'deposit above the limit',
    given: 'payment by deposit of 60 %',
    today,
    values: withTerms({ paymentTerm: 'DEPOSIT', depositPercent: 60 }),
    server: 'accepted',
    issues: [{ code: 'schema.too_large', path: ['terms', 'depositPercent'] }],
  },
  {
    name: 'contract number without its date',
    given: 'a contract number, no signing date; and terms that end before they start',
    today,
    values: withTerms({ contractNumber: 'CT-2026-0042', validTo: '2026-10-31' }),
    server: 'accepted',
    issues: [
      { code: 'rules.all_or_none', path: ['terms', 'contractSignedOn'] },
      { code: 'rules.ordered', path: ['terms', 'validTo'] },
    ],
  },
  {
    name: 'documents out of order',
    given: 'an insurance certificate without expiry, and a Kbis extract that expires before it was issued',
    today,
    values: {
      ...frenchSupplier,
      documents: [
        { ...kbis, expiresOn: '2026-09-01' },
        { key: insurance.key, kind: insurance.kind, fileName: insurance.fileName, issuedOn: insurance.issuedOn },
      ],
    },
    server: 'accepted',
    issues: [
      { code: 'rules.ordered', path: ['documents', { key: 'd1' }, 'expiresOn'] },
      { code: 'rules.required_if', path: ['documents', { key: 'd2' }, 'expiresOn'] },
    ],
  },
  {
    name: 'French company without a recent Kbis',
    given: 'the only Kbis extract issued 120 days before the submission',
    today,
    values: { ...frenchSupplier, documents: [{ ...kbis, issuedOn: '2026-06-25' }, insurance] },
    server: 'accepted',
    issues: [{ code: 'pilot.document_too_old', path: ['documents', { key: 'd1' }, 'issuedOn'] }],
  },
  {
    name: 'French company without Kbis',
    given: 'only the insurance certificate attached',
    today,
    values: { ...frenchSupplier, documents: [insurance] },
    server: 'accepted',
    issues: [{ code: 'rules.at_least', path: ['documents'] }],
  },
  {
    name: 'declarations not accepted',
    given: 'the data processing declaration left unchecked',
    today,
    values: { ...frenchSupplier, declarations: { accuracy: true, dataProcessing: false } },
    server: 'accepted',
    issues: [{ code: 'schema.invalid_value', path: ['declarations', 'dataProcessing'] }],
  },
  {
    name: 'SIREN already registered',
    given: 'valid values; the server already holds a supplier with this SIREN',
    today,
    values: frenchSupplier,
    server: 'siren-taken',
    issues: [{ code: 'pilot.siren_taken', path: ['company', 'siren'] }],
  },
  {
    name: 'account refused by the server',
    given: 'valid values; the sanctions screening refuses the account',
    today,
    values: frenchSupplier,
    server: 'iban-rejected',
    issues: [{ code: 'pilot.iban_rejected', path: ['bank', 'iban'] }],
  },
  {
    name: 'server unreachable',
    given: 'valid values; the server does not answer: the form as a whole is marked, nothing is lost',
    today,
    values: frenchSupplier,
    server: 'unavailable',
    issues: [{ code: 'pilot.server_unavailable', path: [] }],
  },
  {
    name: 'hostile keys are dropped',
    given: 'valid values plus "__proto__" and "constructor" keys in the company: stripped, no prototype changes',
    today,
    values: {
      ...frenchSupplier,
      company: JSON.parse(
        '{"legalName":"Atelier Durand SAS","country":"FR","siren":"123456782","vatNumber":"FR32123456782",' +
          '"legalForm":"SAS","foundedOn":"2012-03-01","__proto__":{"polluted":true},"constructor":{"prototype":{}}}',
      ) as Readonly<Record<string, unknown>>,
    },
    server: 'accepted',
    issues: [],
  },
];
