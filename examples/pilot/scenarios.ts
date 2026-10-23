// The acceptance scenarios of the pilot form, as data: the values a user enters, the day of the submission, what the
// server answers, every issue the form must show (by rule and path) and every value it must derive. Written before the
// code that will pass them; the same scenarios become executable once a schema and rules exist to run them. Every
// number in them is made up: the SIRENs 123456782 and 222222226 only satisfy their checksum, the IBANs are the examples
// of the IBAN registry.
import type { Address, PilotPath, Product, SupplierApplication } from './model.ts';

/** What the server answers when the form submits valid values. */
export type ServerAnswer = 'accepted' | 'siren-taken' | 'iban-rejected' | 'unavailable';

/** An issue the form shows: the rule that raises it (its code is in the catalogue) and the field it marks. */
export interface ExpectedIssue {
  readonly rule: string;
  readonly path: PilotPath;
}

/** A value the form derives; `undefined` means the field is absent from the submitted values. */
export interface ExpectedValue {
  readonly derivation: string;
  readonly path: PilotPath;
  readonly value: unknown;
}

export interface Scenario {
  readonly name: string;
  readonly given: string;
  /** The day of the submission, ISO 8601: the rules that compare with today read it, never the machine's clock. */
  readonly today: string;
  /** The values as entered, derived fields left out; loosely typed where a scenario sends what no form would. */
  readonly values: SupplierApplication | Readonly<Record<string, unknown>>;
  /** Only consulted when the values pass every check of the form. */
  readonly server: ServerAnswer;
  /** Every issue the form shows, in any order; none for a valid application. */
  readonly issues: readonly ExpectedIssue[];
  /** Derived values the form must hold; the ones not listed are not checked by the scenario. */
  readonly derived: readonly ExpectedValue[];
}

const today = '2026-10-23';

const parisOffice: Address = { street: '12 rue des Artisans', postalCode: '75011', city: 'Paris', country: 'FR' };

const chairs: Product = {
  key: 'p1',
  reference: 'CH-100',
  label: 'Workshop chair',
  category: 'goods',
  unitPrice: 12.5,
  taxable: true,
  vatRate: 20,
  minimumQuantity: 10,
  volumeDiscounts: [
    { key: 't1', fromQuantity: 50, discountPercent: 5 },
    { key: 't2', fromQuantity: 200, discountPercent: 10 },
  ],
};

const assembly: Product = {
  key: 'p2',
  reference: 'SV-200',
  label: 'On-site assembly, per hour',
  category: 'services',
  unitPrice: 80,
  taxable: false,
  minimumQuantity: 1,
  volumeDiscounts: [],
};

/** A complete and valid application from a French company, as entered: no derived field. */
export const frenchSupplier: SupplierApplication = {
  company: {
    legalName: 'Atelier Durand SAS',
    country: 'FR',
    siren: '123456782',
    vatNumber: 'FR32123456782',
    legalForm: 'SAS',
    foundedOn: '2012-03-01',
    headOffice: parisOffice,
    billingSameAsHeadOffice: true,
    hasParentCompany: false,
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
  catalogue: { currency: 'EUR', products: [chairs, assembly] },
  documents: [
    { key: 'd1', kind: 'kbis', fileName: 'kbis.pdf', issuedOn: '2026-09-15' },
    { key: 'd2', kind: 'insurance', fileName: 'assurance-rc.pdf', issuedOn: '2026-01-01', expiresOn: '2027-01-01' },
  ],
  declarations: { accuracy: true, dataProcessing: true },
};

/**
 * A complete and valid application from a German company owned by a French one: a foreign registration, a billing
 * address of its own, the parent company sub-form opened and filled, a SEPA account, one software product.
 */
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
    headOffice: { street: 'Industriestraße 4', postalCode: '70565', city: 'Stuttgart', country: 'DE' },
    billingSameAsHeadOffice: false,
    billingAddress: { street: 'Postfach 1120', postalCode: '10115', city: 'Berlin', country: 'DE' },
    hasParentCompany: true,
    parent: {
      legalName: 'Groupe Durand Holding',
      country: 'FR',
      siren: '222222226',
      ownershipPercent: 100,
      address: parisOffice,
    },
  },
  bank: { iban: 'DE89370400440532013000', accountHolder: 'Müller Präzision GmbH' },
  catalogue: {
    currency: 'EUR',
    products: [
      {
        key: 'p3',
        reference: 'SW-CAD',
        label: 'Measuring software, yearly licence',
        category: 'software',
        unitPrice: 199.99,
        taxable: true,
        vatRate: 20,
        minimumQuantity: 1,
        volumeDiscounts: [
          { key: 't1', fromQuantity: 10, discountPercent: 5 },
          { key: 't2', fromQuantity: 50, discountPercent: 12.5 },
        ],
      },
    ],
  },
  documents: [
    { key: 'd2', kind: 'insurance', fileName: 'versicherung.pdf', issuedOn: '2026-01-01', expiresOn: '2027-01-01' },
  ],
};

type Company = SupplierApplication['company'];

/** The French supplier with some company fields replaced and others removed. */
const withCompany = (company: Partial<Company>, drop: readonly (keyof Company)[] = []): SupplierApplication => {
  const merged: Record<string, unknown> = { ...frenchSupplier.company, ...company };
  for (const key of drop) {
    delete merged[key];
  }
  return { ...frenchSupplier, company: merged as unknown as Company };
};

const withTerms = (terms: Partial<SupplierApplication['terms']>): SupplierApplication => ({
  ...frenchSupplier,
  terms: { ...frenchSupplier.terms, ...terms },
});

const withProducts = (products: readonly Product[]): SupplierApplication => ({
  ...frenchSupplier,
  catalogue: { ...frenchSupplier.catalogue, products },
});

const [claire, karim] = frenchSupplier.contacts as readonly [
  SupplierApplication['contacts'][number],
  SupplierApplication['contacts'][number],
];
const [kbis, insurance] = frenchSupplier.documents as readonly [
  SupplierApplication['documents'][number],
  SupplierApplication['documents'][number],
];

const price = (key: string, value: number): ExpectedValue => ({
  derivation: 'price-including-vat',
  path: ['catalogue', 'products', { key }, 'priceIncludingVat'],
  value,
});

const summary = (productCount: number, highestDiscount: number): ExpectedValue[] => [
  { derivation: 'product-count', path: ['catalogue', 'summary', 'productCount'], value: productCount },
  { derivation: 'highest-discount', path: ['catalogue', 'summary', 'highestDiscount'], value: highestDiscount },
];

/** What the French supplier's form derives: the billing address copied, the prices with tax, the summary. */
const frenchDerived: readonly ExpectedValue[] = [
  { derivation: 'billing-copies-head-office', path: ['company', 'billingAddress'], value: parisOffice },
  { derivation: 'parent-dropped-when-unchecked', path: ['company', 'parent'], value: undefined },
  price('p1', 15),
  price('p2', 80),
  ...summary(2, 10),
];

const issue = (rule: string, ...path: PilotPath): ExpectedIssue => ({ rule, path });

/** `value` without the property `key`: an optional field the user left empty. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  delete copy[key];
  return copy as Omit<T, K>;
}

export const scenarios: readonly Scenario[] = [
  {
    name: 'valid French supplier',
    given:
      'every field filled as the rules ask, the billing address left the same as the head office, the server accepts',
    today,
    values: frenchSupplier,
    server: 'accepted',
    issues: [],
    derived: frenchDerived,
  },
  {
    name: 'valid German supplier with a parent company',
    given: 'a foreign registration, its own billing address, the parent company sub-form opened and filled, no Kbis',
    today,
    values: germanSupplier,
    server: 'accepted',
    issues: [],
    derived: [price('p3', 239.99), ...summary(1, 12.5)],
  },
  {
    name: 'French company without SIREN',
    given: 'country FR, the SIREN left empty',
    today,
    values: withCompany({}, ['siren']),
    server: 'accepted',
    issues: [issue('siren-required', 'company', 'siren')],
    derived: [],
  },
  {
    name: 'two registration numbers',
    given: 'a French company that also fills the foreign registration number',
    today,
    values: withCompany({ foreignRegistration: 'HRB 123456' }),
    server: 'accepted',
    issues: [
      issue('one-registration', 'company', 'siren'),
      issue('one-registration', 'company', 'foreignRegistration'),
    ],
    derived: [],
  },
  {
    name: 'German company without registration number',
    given: 'country DE, the foreign registration number left empty',
    today,
    values: {
      ...germanSupplier,
      company: without(germanSupplier.company, 'foreignRegistration'),
    },
    server: 'accepted',
    issues: [issue('foreign-registration-required', 'company', 'foreignRegistration')],
    derived: [],
  },
  {
    name: 'SIREN with a wrong checksum',
    given: 'nine digits whose Luhn checksum fails',
    today,
    values: withCompany({ siren: '123456789', vatNumber: 'FR32123456789' }),
    server: 'accepted',
    issues: [issue('siren-checksum', 'company', 'siren')],
    derived: [],
  },
  {
    name: 'European company without VAT number',
    given: 'country FR, the VAT number left empty',
    today,
    values: withCompany({}, ['vatNumber']),
    server: 'accepted',
    issues: [issue('vat-required', 'company', 'vatNumber')],
    derived: [],
  },
  {
    name: 'legal form OTHER left unexplained',
    given: 'legal form OTHER, its description empty, and a legal name of one character',
    today,
    values: withCompany({ legalForm: 'OTHER', legalName: 'A' }),
    server: 'accepted',
    issues: [issue('legal-form-other', 'company', 'legalFormOther'), issue('legal-name', 'company', 'legalName')],
    derived: [],
  },
  {
    name: 'company founded tomorrow',
    given: 'a founding date after the day of submission',
    today,
    values: withCompany({ foundedOn: '2026-10-24' }),
    server: 'accepted',
    issues: [issue('founded-in-past', 'company', 'foundedOn')],
    derived: [],
  },
  {
    name: 'billing address unchecked and left empty',
    given: '"billing address same as head office" unchecked: the billing sub-form opens, nothing entered in it',
    today,
    values: withCompany({ billingSameAsHeadOffice: false }),
    server: 'accepted',
    issues: [issue('billing-address-required', 'company', 'billingAddress')],
    derived: [],
  },
  {
    name: 'billing address half filled',
    given: 'the billing sub-form opened, the city empty and a French postal code of four digits',
    today,
    values: withCompany({
      billingSameAsHeadOffice: false,
      billingAddress: { street: '3 quai Est', postalCode: '6900', city: '', country: 'FR' },
    }),
    server: 'accepted',
    issues: [
      issue('address-fields', 'company', 'billingAddress', 'city'),
      issue('postal-code', 'company', 'billingAddress', 'postalCode'),
    ],
    derived: [],
  },
  {
    name: 'head office postal code malformed',
    given: 'a German head office with a postal code of letters',
    today,
    values: {
      ...germanSupplier,
      company: { ...germanSupplier.company, headOffice: { ...germanSupplier.company.headOffice, postalCode: 'STG' } },
    },
    server: 'accepted',
    issues: [issue('postal-code', 'company', 'headOffice', 'postalCode')],
    derived: [],
  },
  {
    name: 'parent company checked and left empty',
    given: '"has a parent company" checked: the parent sub-form opens, nothing entered in it',
    today,
    values: withCompany({ hasParentCompany: true }),
    server: 'accepted',
    issues: [issue('parent-required', 'company', 'parent')],
    derived: [],
  },
  {
    name: 'parent company filled wrongly, four levels deep',
    given: 'a French parent without SIREN, holding 30 %, whose address has a postal code of four digits',
    today,
    values: withCompany({
      hasParentCompany: true,
      parent: {
        legalName: 'Groupe Durand Holding',
        country: 'FR',
        ownershipPercent: 30,
        address: { ...parisOffice, postalCode: '7501' },
      },
    }),
    server: 'accepted',
    issues: [
      issue('parent-siren-required', 'company', 'parent', 'siren'),
      issue('parent-ownership', 'company', 'parent', 'ownershipPercent'),
      issue('postal-code', 'company', 'parent', 'address', 'postalCode'),
    ],
    derived: [],
  },
  {
    name: 'parent company unchecked after being filled',
    given:
      'the parent sub-form filled with a wrong SIREN, then "has a parent company" unchecked: no issue, nothing sent',
    today,
    values: withCompany({
      parent: {
        legalName: 'Groupe Durand Holding',
        country: 'FR',
        siren: '222222227',
        ownershipPercent: 30,
        address: parisOffice,
      },
    }),
    server: 'accepted',
    issues: [],
    derived: [{ derivation: 'parent-dropped-when-unchecked', path: ['company', 'parent'], value: undefined }],
  },
  {
    name: 'parent SIREN with a wrong checksum',
    given: 'the parent sub-form opened, its SIREN failing the Luhn checksum',
    today,
    values: {
      ...germanSupplier,
      company: { ...germanSupplier.company, parent: { ...germanSupplier.company.parent!, siren: '222222227' } },
    },
    server: 'accepted',
    issues: [issue('siren-checksum', 'company', 'parent', 'siren')],
    derived: [],
  },
  {
    name: 'billing address follows the head office',
    given: 'the head office moved to Lyon, the billing address still "same as head office"',
    today,
    values: withCompany({
      headOffice: { street: '8 cours Gambetta', postalCode: '69003', city: 'Lyon', country: 'FR' },
    }),
    server: 'accepted',
    issues: [],
    derived: [
      {
        derivation: 'billing-copies-head-office',
        path: ['company', 'billingAddress'],
        value: { street: '8 cours Gambetta', postalCode: '69003', city: 'Lyon', country: 'FR' },
      },
    ],
  },
  {
    name: 'two contacts with the same email',
    given: 'the second contact copies the first email in upper case; both are marked, by key',
    today,
    values: { ...frenchSupplier, contacts: [claire, { ...karim, email: 'CLAIRE.DURAND@atelier-durand.example' }] },
    server: 'accepted',
    issues: [
      issue('contact-email-unique', 'contacts', { key: 'c1' }, 'email'),
      issue('contact-email-unique', 'contacts', { key: 'c2' }, 'email'),
    ],
    derived: [],
  },
  {
    name: 'duplicate emails after reordering',
    given: 'the same two contacts, the list reordered: the issues stay on the same contacts',
    today,
    values: { ...frenchSupplier, contacts: [{ ...karim, email: 'CLAIRE.DURAND@atelier-durand.example' }, claire] },
    server: 'accepted',
    issues: [
      issue('contact-email-unique', 'contacts', { key: 'c1' }, 'email'),
      issue('contact-email-unique', 'contacts', { key: 'c2' }, 'email'),
    ],
    derived: [],
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
      issue('one-primary', 'contacts'),
      issue('billing-contact', 'contacts'),
      issue('contact-email', 'contacts', { key: 'c1' }, 'email'),
      issue('contact-roles', 'contacts', { key: 'c2' }, 'roles'),
    ],
    derived: [],
  },
  {
    name: 'no contact at all',
    given: 'the contact list emptied',
    today,
    values: { ...frenchSupplier, contacts: [] },
    server: 'accepted',
    issues: [
      issue('contacts-count', 'contacts'),
      issue('one-primary', 'contacts'),
      issue('billing-contact', 'contacts'),
    ],
    derived: [],
  },
  {
    name: 'IBAN with a wrong checksum',
    given: 'the last digit of the IBAN changed',
    today,
    values: { ...frenchSupplier, bank: { ...frenchSupplier.bank, iban: 'FR7630006000011234567890188' } },
    server: 'accepted',
    issues: [issue('iban-checksum', 'bank', 'iban')],
    derived: [],
  },
  {
    name: 'account outside SEPA without BIC',
    given: 'a Brazilian IBAN, the BIC left empty',
    today,
    values: { ...frenchSupplier, bank: { ...frenchSupplier.bank, iban: 'BR1800360305000010009795493C1' } },
    server: 'accepted',
    issues: [issue('bic-outside-sepa', 'bank', 'bic')],
    derived: [],
  },
  {
    name: 'deposit without percentage',
    given: 'payment by deposit, the percentage left empty',
    today,
    values: withTerms({ paymentTerm: 'DEPOSIT' }),
    server: 'accepted',
    issues: [issue('deposit-percent', 'terms', 'depositPercent')],
    derived: [],
  },
  {
    name: 'deposit above the limit',
    given: 'payment by deposit of 60 %',
    today,
    values: withTerms({ paymentTerm: 'DEPOSIT', depositPercent: 60 }),
    server: 'accepted',
    issues: [issue('deposit-range', 'terms', 'depositPercent')],
    derived: [],
  },
  {
    name: 'contract number without its date',
    given: 'a contract number, no signing date; and terms that end before they start',
    today,
    values: withTerms({ contractNumber: 'CT-2026-0042', validTo: '2026-10-31' }),
    server: 'accepted',
    issues: [issue('contract-pair', 'terms', 'contractSignedOn'), issue('validity-order', 'terms', 'validTo')],
    derived: [],
  },
  {
    name: 'empty catalogue',
    given: 'every product removed',
    today,
    values: withProducts([]),
    server: 'accepted',
    issues: [issue('catalogue-not-empty', 'catalogue', 'products')],
    derived: summary(0, 0),
  },
  {
    name: 'two products with the same reference',
    given: 'the second product takes the first reference in lower case; both are marked, the prices still derived',
    today,
    values: withProducts([chairs, { ...assembly, reference: 'ch-100' }]),
    server: 'accepted',
    issues: [
      issue('product-reference-unique', 'catalogue', 'products', { key: 'p1' }, 'reference'),
      issue('product-reference-unique', 'catalogue', 'products', { key: 'p2' }, 'reference'),
    ],
    derived: [price('p1', 15), price('p2', 80)],
  },
  {
    name: 'taxable product without rate, free of charge',
    given: 'a taxable product with no VAT rate and a unit price of 0',
    today,
    values: withProducts([{ ...without(chairs, 'vatRate'), unitPrice: 0 }, assembly]),
    server: 'accepted',
    issues: [
      issue('vat-rate-required', 'catalogue', 'products', { key: 'p1' }, 'vatRate'),
      issue('unit-price-positive', 'catalogue', 'products', { key: 'p1' }, 'unitPrice'),
    ],
    derived: [],
  },
  {
    name: 'product no longer taxable',
    given: 'the chairs unchecked as taxable, their VAT rate still entered: the price with tax becomes the unit price',
    today,
    values: withProducts([{ ...chairs, taxable: false }, assembly]),
    server: 'accepted',
    issues: [],
    derived: [price('p1', 12.5), price('p2', 80)],
  },
  {
    name: 'reduced VAT rate rounded to the cent',
    given: 'a product at 49.90 with the 5.5 % rate: 52.6445 rounds to 52.64',
    today,
    values: withProducts([{ ...chairs, unitPrice: 49.9, vatRate: 5.5 }, assembly]),
    server: 'accepted',
    issues: [],
    derived: [price('p1', 52.64)],
  },
  {
    name: 'volume discounts out of order, two levels deep',
    given: 'chairs sold from 10: a first discount from 5, a second from 3 with a smaller discount',
    today,
    values: withProducts([
      {
        ...chairs,
        volumeDiscounts: [
          { key: 't1', fromQuantity: 5, discountPercent: 10 },
          { key: 't2', fromQuantity: 3, discountPercent: 5 },
        ],
      },
      assembly,
    ]),
    server: 'accepted',
    issues: [
      issue(
        'first-tier-above-minimum',
        'catalogue',
        'products',
        { key: 'p1' },
        'volumeDiscounts',
        { key: 't1' },
        'fromQuantity',
      ),
      issue(
        'tiers-increasing',
        'catalogue',
        'products',
        { key: 'p1' },
        'volumeDiscounts',
        { key: 't2' },
        'fromQuantity',
      ),
      issue(
        'discounts-increasing',
        'catalogue',
        'products',
        { key: 'p1' },
        'volumeDiscounts',
        { key: 't2' },
        'discountPercent',
      ),
    ],
    derived: [],
  },
  {
    name: 'too many and too large discounts',
    given: 'four discounts on the chairs, the last one of 60 %',
    today,
    values: withProducts([
      {
        ...chairs,
        volumeDiscounts: [
          { key: 't1', fromQuantity: 50, discountPercent: 5 },
          { key: 't2', fromQuantity: 100, discountPercent: 10 },
          { key: 't3', fromQuantity: 200, discountPercent: 15 },
          { key: 't4', fromQuantity: 500, discountPercent: 60 },
        ],
      },
      assembly,
    ]),
    server: 'accepted',
    issues: [
      issue('tiers-count', 'catalogue', 'products', { key: 'p1' }, 'volumeDiscounts'),
      issue(
        'discount-range',
        'catalogue',
        'products',
        { key: 'p1' },
        'volumeDiscounts',
        { key: 't4' },
        'discountPercent',
      ),
    ],
    derived: [],
  },
  {
    name: 'products reordered',
    given: 'the two products swapped: every derived price stays with its product',
    today,
    values: withProducts([assembly, chairs]),
    server: 'accepted',
    issues: [],
    derived: [price('p1', 15), price('p2', 80), ...summary(2, 10)],
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
      issue('document-order', 'documents', { key: 'd1' }, 'expiresOn'),
      issue('insurance-expiry', 'documents', { key: 'd2' }, 'expiresOn'),
    ],
    derived: [],
  },
  {
    name: 'French company without a recent Kbis',
    given: 'the only Kbis extract issued 120 days before the submission',
    today,
    values: { ...frenchSupplier, documents: [{ ...kbis, issuedOn: '2026-06-25' }, insurance] },
    server: 'accepted',
    issues: [issue('kbis-recent', 'documents', { key: 'd1' }, 'issuedOn')],
    derived: [],
  },
  {
    name: 'French company without Kbis',
    given: 'only the insurance certificate attached',
    today,
    values: { ...frenchSupplier, documents: [insurance] },
    server: 'accepted',
    issues: [issue('kbis-for-france', 'documents')],
    derived: [],
  },
  {
    name: 'declarations not accepted',
    given: 'the data processing declaration left unchecked',
    today,
    values: { ...frenchSupplier, declarations: { accuracy: true, dataProcessing: false } },
    server: 'accepted',
    issues: [issue('declarations', 'declarations', 'dataProcessing')],
    derived: [],
  },
  {
    name: 'SIREN already registered',
    given: 'valid values; the server already holds a supplier with this SIREN',
    today,
    values: frenchSupplier,
    server: 'siren-taken',
    issues: [issue('siren-taken', 'company', 'siren')],
    derived: [],
  },
  {
    name: 'account refused by the server',
    given: 'valid values; the sanctions screening refuses the account',
    today,
    values: frenchSupplier,
    server: 'iban-rejected',
    issues: [issue('iban-rejected', 'bank', 'iban')],
    derived: [],
  },
  {
    name: 'server unreachable',
    given: 'valid values; the server does not answer: the form as a whole is marked, nothing is lost',
    today,
    values: frenchSupplier,
    server: 'unavailable',
    issues: [issue('server-unavailable')],
    derived: [],
  },
  {
    name: 'hostile keys are dropped',
    given: 'valid values plus "__proto__" and "constructor" keys in the company: stripped, no prototype changes',
    today,
    values: {
      ...frenchSupplier,
      company: JSON.parse(
        JSON.stringify(frenchSupplier.company).replace(
          /\}$/,
          ',"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
        ),
      ) as Readonly<Record<string, unknown>>,
    },
    server: 'accepted',
    issues: [],
    derived: [],
  },
];
