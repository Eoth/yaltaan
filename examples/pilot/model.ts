// The pilot form: a supplier onboarding application, the kind of business form a purchasing team fills in to open an
// account for a new supplier. Six steps; fields of every kind (text, number, whole number, boolean, choice, multiple
// choice, date, nested object, list); lists nested in lists; checkboxes that open a sub-form; fields required only
// under conditions; rules across fields, list elements and nesting levels; values the form derives from others; and
// checks only the server can make. This file is the catalogue the scenarios cite: the shape of the values, every field
// with its step and kind, every rule with the fields it reads and marks, and every derived value with its inputs.
//
// Paths follow the contract of ARCHITECTURE.md §5.3: a list of segments, where an element of a list is named by its
// stable key (`{ key }`), so that an issue or a derived value follows the element when the list is reordered. The
// type is written here until `@yaltaan/core` ships its own.

/** A segment of a path: a property name, an index, or the stable key of a list element. */
export type Segment = string | number | { readonly key: string };

/** A path from the root of the values to a field; the empty path names the form as a whole. */
export type PilotPath = readonly Segment[];

export type Country = string;
export type LegalForm = 'SAS' | 'SARL' | 'SA' | 'EI' | 'OTHER';
export type ContactRole = 'billing' | 'sales' | 'technical';
export type PaymentTerm = 'NET30' | 'NET45' | 'NET60' | 'DEPOSIT';
export type DocumentKind = 'kbis' | 'insurance' | 'bank-letter' | 'other';
export type ProductCategory = 'goods' | 'services' | 'software';
export type Currency = 'EUR' | 'USD' | 'GBP';
export type VatRate = 5.5 | 10 | 20;

export interface Address {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: Country;
}

/** The sub-form the "has a parent company" checkbox opens. */
export interface ParentCompany {
  readonly legalName: string;
  readonly country: Country;
  readonly siren?: string;
  readonly foreignRegistration?: string;
  /** Share of the supplier the parent holds, in percent. */
  readonly ownershipPercent: number;
  readonly address: Address;
}

export interface Contact {
  /** Stable identity of the element, created with it, never shown. */
  readonly key: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
  readonly roles: readonly ContactRole[];
  readonly primary: boolean;
}

/** A volume discount: from this quantity on, the unit price drops by this percentage. */
export interface DiscountTier {
  readonly key: string;
  readonly fromQuantity: number;
  readonly discountPercent: number;
}

export interface Product {
  readonly key: string;
  readonly reference: string;
  readonly label: string;
  readonly category: ProductCategory;
  /** Unit price before tax, in the catalogue's currency. */
  readonly unitPrice: number;
  readonly taxable: boolean;
  readonly vatRate?: VatRate;
  /** Derived by the form: the unit price with tax, rounded to the cent. */
  readonly priceIncludingVat?: number;
  readonly minimumQuantity: number;
  readonly volumeDiscounts: readonly DiscountTier[];
}

export interface SupportingDocument {
  readonly key: string;
  readonly kind: DocumentKind;
  readonly fileName: string;
  /** ISO 8601 calendar date. */
  readonly issuedOn: string;
  readonly expiresOn?: string;
}

/** The values of an application, as the form submits them, derived values included. */
export interface SupplierApplication {
  readonly company: {
    readonly legalName: string;
    readonly country: Country;
    /** French company number: nine digits, Luhn checksum. */
    readonly siren?: string;
    /** Registration number of a company outside France. */
    readonly foreignRegistration?: string;
    readonly vatNumber?: string;
    readonly legalForm: LegalForm;
    readonly legalFormOther?: string;
    readonly foundedOn: string;
    readonly headOffice: Address;
    /** Checked by default: the billing address is then derived from the head office. */
    readonly billingSameAsHeadOffice: boolean;
    readonly billingAddress?: Address;
    /** Checked, it opens the parent company sub-form; unchecked, the sub-form's values are dropped at submission. */
    readonly hasParentCompany: boolean;
    readonly parent?: ParentCompany;
  };
  readonly contacts: readonly Contact[];
  readonly bank: {
    readonly iban: string;
    readonly bic?: string;
    readonly accountHolder: string;
  };
  readonly terms: {
    readonly paymentTerm: PaymentTerm;
    readonly depositPercent?: number;
    readonly contractNumber?: string;
    readonly contractSignedOn?: string;
    readonly validFrom: string;
    readonly validTo?: string;
  };
  readonly catalogue: {
    readonly currency: Currency;
    readonly products: readonly Product[];
    /** Derived by the form from the products. */
    readonly summary?: { readonly productCount: number; readonly highestDiscount: number };
  };
  readonly documents: readonly SupportingDocument[];
  readonly declarations: {
    readonly accuracy: boolean;
    readonly dataProcessing: boolean;
  };
}

/** The six steps, in the order the form shows them. */
export const steps = ['company', 'contacts', 'bank', 'terms', 'catalogue', 'documents'] as const;
export type Step = (typeof steps)[number];

/** What a field holds, as the form edits it. */
export type FieldKind =
  'text' | 'number' | 'whole-number' | 'boolean' | 'choice' | 'choices' | 'date' | 'object' | 'list';

export interface Field {
  readonly step: Step;
  readonly kind: FieldKind;
  /** Computed by the form from other fields, shown read-only. */
  readonly derived?: true;
}

const address = (prefix: string, step: Step): Record<string, Field> => ({
  [prefix]: { step, kind: 'object' },
  [`${prefix}.street`]: { step, kind: 'text' },
  [`${prefix}.postalCode`]: { step, kind: 'text' },
  [`${prefix}.city`]: { step, kind: 'text' },
  [`${prefix}.country`]: { step, kind: 'choice' },
});

/**
 * Every field of the form, by path pattern (`[*]` stands for any element of a list). A path in a scenario must match
 * one of these, or be the empty path.
 */
export const fields: Readonly<Record<string, Field>> = {
  company: { step: 'company', kind: 'object' },
  'company.legalName': { step: 'company', kind: 'text' },
  'company.country': { step: 'company', kind: 'choice' },
  'company.siren': { step: 'company', kind: 'text' },
  'company.foreignRegistration': { step: 'company', kind: 'text' },
  'company.vatNumber': { step: 'company', kind: 'text' },
  'company.legalForm': { step: 'company', kind: 'choice' },
  'company.legalFormOther': { step: 'company', kind: 'text' },
  'company.foundedOn': { step: 'company', kind: 'date' },
  ...address('company.headOffice', 'company'),
  'company.billingSameAsHeadOffice': { step: 'company', kind: 'boolean' },
  ...address('company.billingAddress', 'company'),
  'company.hasParentCompany': { step: 'company', kind: 'boolean' },
  'company.parent': { step: 'company', kind: 'object' },
  'company.parent.legalName': { step: 'company', kind: 'text' },
  'company.parent.country': { step: 'company', kind: 'choice' },
  'company.parent.siren': { step: 'company', kind: 'text' },
  'company.parent.foreignRegistration': { step: 'company', kind: 'text' },
  'company.parent.ownershipPercent': { step: 'company', kind: 'number' },
  ...address('company.parent.address', 'company'),
  contacts: { step: 'contacts', kind: 'list' },
  'contacts[*].firstName': { step: 'contacts', kind: 'text' },
  'contacts[*].lastName': { step: 'contacts', kind: 'text' },
  'contacts[*].email': { step: 'contacts', kind: 'text' },
  'contacts[*].phone': { step: 'contacts', kind: 'text' },
  'contacts[*].roles': { step: 'contacts', kind: 'choices' },
  'contacts[*].primary': { step: 'contacts', kind: 'boolean' },
  bank: { step: 'bank', kind: 'object' },
  'bank.iban': { step: 'bank', kind: 'text' },
  'bank.bic': { step: 'bank', kind: 'text' },
  'bank.accountHolder': { step: 'bank', kind: 'text' },
  terms: { step: 'terms', kind: 'object' },
  'terms.paymentTerm': { step: 'terms', kind: 'choice' },
  'terms.depositPercent': { step: 'terms', kind: 'whole-number' },
  'terms.contractNumber': { step: 'terms', kind: 'text' },
  'terms.contractSignedOn': { step: 'terms', kind: 'date' },
  'terms.validFrom': { step: 'terms', kind: 'date' },
  'terms.validTo': { step: 'terms', kind: 'date' },
  'catalogue.currency': { step: 'catalogue', kind: 'choice' },
  'catalogue.products': { step: 'catalogue', kind: 'list' },
  'catalogue.products[*].reference': { step: 'catalogue', kind: 'text' },
  'catalogue.products[*].label': { step: 'catalogue', kind: 'text' },
  'catalogue.products[*].category': { step: 'catalogue', kind: 'choice' },
  'catalogue.products[*].unitPrice': { step: 'catalogue', kind: 'number' },
  'catalogue.products[*].taxable': { step: 'catalogue', kind: 'boolean' },
  'catalogue.products[*].vatRate': { step: 'catalogue', kind: 'choice' },
  'catalogue.products[*].priceIncludingVat': { step: 'catalogue', kind: 'number', derived: true },
  'catalogue.products[*].minimumQuantity': { step: 'catalogue', kind: 'whole-number' },
  'catalogue.products[*].volumeDiscounts': { step: 'catalogue', kind: 'list' },
  'catalogue.products[*].volumeDiscounts[*].fromQuantity': { step: 'catalogue', kind: 'whole-number' },
  'catalogue.products[*].volumeDiscounts[*].discountPercent': { step: 'catalogue', kind: 'number' },
  'catalogue.summary.productCount': { step: 'catalogue', kind: 'whole-number', derived: true },
  'catalogue.summary.highestDiscount': { step: 'catalogue', kind: 'number', derived: true },
  documents: { step: 'documents', kind: 'list' },
  'documents[*].kind': { step: 'documents', kind: 'choice' },
  'documents[*].fileName': { step: 'documents', kind: 'text' },
  'documents[*].issuedOn': { step: 'documents', kind: 'date' },
  'documents[*].expiresOn': { step: 'documents', kind: 'date' },
  'declarations.accuracy': { step: 'documents', kind: 'boolean' },
  'declarations.dataProcessing': { step: 'documents', kind: 'boolean' },
};

/** Who checks a rule: the schema of one field, a rule across fields, or the server after submission. */
export type RuleSource = 'schema' | 'rule' | 'server';

/** A rule of the form: what it requires, the code of the issue it raises, and the fields it reads and marks. */
export interface PilotRule {
  readonly source: RuleSource;
  readonly code: string;
  readonly says: string;
  readonly reads: readonly string[];
  readonly marks: readonly string[];
}

const postalCodes = ['company.headOffice', 'company.billingAddress', 'company.parent.address'];

/**
 * The rules, by identifier. Codes of the library (`schema.*`, `rules.*`) are the names the issue registry is expected
 * to hold; codes of the application (`pilot.*`) belong to the pilot, as an application's own codes and rules would.
 */
export const rules: Readonly<Record<string, PilotRule>> = {
  'legal-name': {
    source: 'schema',
    code: 'schema.too_short',
    says: 'The legal name has 2 to 120 characters once trimmed.',
    reads: ['company.legalName'],
    marks: ['company.legalName'],
  },
  'siren-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'A French company gives its SIREN.',
    reads: ['company.country', 'company.siren'],
    marks: ['company.siren'],
  },
  'foreign-registration-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'A company outside France gives its registration number.',
    reads: ['company.country', 'company.foreignRegistration'],
    marks: ['company.foreignRegistration'],
  },
  'one-registration': {
    source: 'rule',
    code: 'rules.mutually_exclusive',
    says: 'A SIREN and a foreign registration number are never both given.',
    reads: ['company.siren', 'company.foreignRegistration'],
    marks: ['company.siren', 'company.foreignRegistration'],
  },
  'siren-checksum': {
    source: 'schema',
    code: 'pilot.siren_checksum',
    says: 'A SIREN is nine digits whose Luhn checksum holds, for the company and for its parent.',
    reads: ['company.siren', 'company.parent.siren'],
    marks: ['company.siren', 'company.parent.siren'],
  },
  'vat-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'A company of the European Union gives its VAT number.',
    reads: ['company.country', 'company.vatNumber'],
    marks: ['company.vatNumber'],
  },
  'legal-form-other': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'The legal form "OTHER" is spelled out.',
    reads: ['company.legalForm', 'company.legalFormOther'],
    marks: ['company.legalFormOther'],
  },
  'founded-in-past': {
    source: 'schema',
    code: 'schema.too_large',
    says: 'The founding date is not after today.',
    reads: ['company.foundedOn'],
    marks: ['company.foundedOn'],
  },
  'address-fields': {
    source: 'schema',
    code: 'schema.too_short',
    says: 'Every line of an address is filled.',
    reads: postalCodes.flatMap((prefix) => [`${prefix}.street`, `${prefix}.city`]),
    marks: postalCodes.flatMap((prefix) => [`${prefix}.street`, `${prefix}.city`]),
  },
  'postal-code': {
    source: 'rule',
    code: 'pilot.postal_code_format',
    says: 'A postal code in France or Germany is five digits; elsewhere, it is not empty.',
    reads: postalCodes.flatMap((prefix) => [`${prefix}.country`, `${prefix}.postalCode`]),
    marks: postalCodes.map((prefix) => `${prefix}.postalCode`),
  },
  'billing-address-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'Unchecking "billing address same as head office" opens the billing address, which is then required.',
    reads: ['company.billingSameAsHeadOffice', 'company.billingAddress'],
    marks: ['company.billingAddress'],
  },
  'parent-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'Checking "has a parent company" opens the parent company, which is then required.',
    reads: ['company.hasParentCompany', 'company.parent'],
    marks: ['company.parent'],
  },
  'parent-siren-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'A French parent company gives its SIREN.',
    reads: ['company.parent.country', 'company.parent.siren'],
    marks: ['company.parent.siren'],
  },
  'parent-ownership': {
    source: 'schema',
    code: 'schema.too_small',
    says: 'A parent company holds 50 to 100 % of the supplier.',
    reads: ['company.parent.ownershipPercent'],
    marks: ['company.parent.ownershipPercent'],
  },
  'contacts-count': {
    source: 'schema',
    code: 'schema.too_small',
    says: 'One to five contacts.',
    reads: ['contacts'],
    marks: ['contacts'],
  },
  'contact-email': {
    source: 'schema',
    code: 'schema.invalid_format',
    says: 'A contact email is an email address.',
    reads: ['contacts[*].email'],
    marks: ['contacts[*].email'],
  },
  'contact-email-unique': {
    source: 'rule',
    code: 'rules.unique',
    says: 'No two contacts share an email, ignoring case; every contact sharing one is marked.',
    reads: ['contacts[*].email'],
    marks: ['contacts[*].email'],
  },
  'contact-roles': {
    source: 'schema',
    code: 'schema.too_small',
    says: 'A contact has at least one role.',
    reads: ['contacts[*].roles'],
    marks: ['contacts[*].roles'],
  },
  'one-primary': {
    source: 'rule',
    code: 'rules.exactly',
    says: 'Exactly one contact is the primary contact.',
    reads: ['contacts[*].primary'],
    marks: ['contacts'],
  },
  'billing-contact': {
    source: 'rule',
    code: 'rules.at_least',
    says: 'At least one contact has the billing role.',
    reads: ['contacts[*].roles'],
    marks: ['contacts'],
  },
  'iban-checksum': {
    source: 'schema',
    code: 'pilot.iban_checksum',
    says: 'An IBAN passes the ISO 13616 mod-97 check.',
    reads: ['bank.iban'],
    marks: ['bank.iban'],
  },
  'bic-outside-sepa': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'An account outside the SEPA area gives its BIC.',
    reads: ['bank.iban', 'bank.bic'],
    marks: ['bank.bic'],
  },
  'deposit-percent': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'Payment by deposit gives the deposit percentage.',
    reads: ['terms.paymentTerm', 'terms.depositPercent'],
    marks: ['terms.depositPercent'],
  },
  'deposit-range': {
    source: 'schema',
    code: 'schema.too_large',
    says: 'A deposit is a whole percentage from 1 to 50.',
    reads: ['terms.depositPercent'],
    marks: ['terms.depositPercent'],
  },
  'contract-pair': {
    source: 'rule',
    code: 'rules.all_or_none',
    says: 'A contract number and its signing date are given together or not at all; the missing one is marked.',
    reads: ['terms.contractNumber', 'terms.contractSignedOn'],
    marks: ['terms.contractNumber', 'terms.contractSignedOn'],
  },
  'validity-order': {
    source: 'rule',
    code: 'rules.ordered',
    says: 'The terms end on or after the day they start.',
    reads: ['terms.validFrom', 'terms.validTo'],
    marks: ['terms.validTo'],
  },
  'catalogue-not-empty': {
    source: 'schema',
    code: 'schema.too_small',
    says: 'The catalogue lists one to fifty products.',
    reads: ['catalogue.products'],
    marks: ['catalogue.products'],
  },
  'product-reference-unique': {
    source: 'rule',
    code: 'rules.unique',
    says: 'No two products share a reference, ignoring case; every product sharing one is marked.',
    reads: ['catalogue.products[*].reference'],
    marks: ['catalogue.products[*].reference'],
  },
  'unit-price-positive': {
    source: 'schema',
    code: 'schema.too_small',
    says: 'A unit price is above zero.',
    reads: ['catalogue.products[*].unitPrice'],
    marks: ['catalogue.products[*].unitPrice'],
  },
  'vat-rate-required': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'A taxable product gives its VAT rate.',
    reads: ['catalogue.products[*].taxable', 'catalogue.products[*].vatRate'],
    marks: ['catalogue.products[*].vatRate'],
  },
  'tiers-count': {
    source: 'schema',
    code: 'schema.too_large',
    says: 'A product has at most three volume discounts.',
    reads: ['catalogue.products[*].volumeDiscounts'],
    marks: ['catalogue.products[*].volumeDiscounts'],
  },
  'first-tier-above-minimum': {
    source: 'rule',
    code: 'rules.ordered',
    says: "The first volume discount starts at or above the product's minimum quantity (a rule across two levels).",
    reads: ['catalogue.products[*].minimumQuantity', 'catalogue.products[*].volumeDiscounts[*].fromQuantity'],
    marks: ['catalogue.products[*].volumeDiscounts[*].fromQuantity'],
  },
  'tiers-increasing': {
    source: 'rule',
    code: 'rules.ordered',
    says: 'Each volume discount starts at a higher quantity than the one before it; the later one is marked.',
    reads: ['catalogue.products[*].volumeDiscounts[*].fromQuantity'],
    marks: ['catalogue.products[*].volumeDiscounts[*].fromQuantity'],
  },
  'discounts-increasing': {
    source: 'rule',
    code: 'rules.ordered',
    says: 'A larger quantity never gets a smaller discount; the later one is marked.',
    reads: ['catalogue.products[*].volumeDiscounts[*].discountPercent'],
    marks: ['catalogue.products[*].volumeDiscounts[*].discountPercent'],
  },
  'discount-range': {
    source: 'schema',
    code: 'schema.too_large',
    says: 'A discount is above 0 and at most 50 %.',
    reads: ['catalogue.products[*].volumeDiscounts[*].discountPercent'],
    marks: ['catalogue.products[*].volumeDiscounts[*].discountPercent'],
  },
  'insurance-expiry': {
    source: 'rule',
    code: 'rules.required_if',
    says: 'An insurance certificate gives its expiry date.',
    reads: ['documents[*].kind', 'documents[*].expiresOn'],
    marks: ['documents[*].expiresOn'],
  },
  'document-order': {
    source: 'rule',
    code: 'rules.ordered',
    says: 'A document expires after the day it was issued.',
    reads: ['documents[*].issuedOn', 'documents[*].expiresOn'],
    marks: ['documents[*].expiresOn'],
  },
  'kbis-for-france': {
    source: 'rule',
    code: 'rules.at_least',
    says: 'A French company attaches at least one Kbis extract.',
    reads: ['company.country', 'documents[*].kind'],
    marks: ['documents'],
  },
  'kbis-recent': {
    source: 'schema',
    code: 'pilot.document_too_old',
    says: 'A Kbis extract was issued at most 90 days before today.',
    reads: ['documents[*].kind', 'documents[*].issuedOn'],
    marks: ['documents[*].issuedOn'],
  },
  declarations: {
    source: 'schema',
    code: 'schema.invalid_value',
    says: 'Both declarations are accepted.',
    reads: ['declarations.accuracy', 'declarations.dataProcessing'],
    marks: ['declarations.accuracy', 'declarations.dataProcessing'],
  },
  'siren-taken': {
    source: 'server',
    code: 'pilot.siren_taken',
    says: 'The server already holds a supplier with this SIREN.',
    reads: ['company.siren'],
    marks: ['company.siren'],
  },
  'iban-rejected': {
    source: 'server',
    code: 'pilot.iban_rejected',
    says: 'The server refuses the account (sanctions screening).',
    reads: ['bank.iban'],
    marks: ['bank.iban'],
  },
  'server-unavailable': {
    source: 'server',
    code: 'pilot.server_unavailable',
    says: 'The server could not be reached; the form as a whole is marked and the values are kept.',
    reads: [],
    marks: [''],
  },
};

/** A value the form computes from other fields, or clears, before showing or submitting the values. */
export interface PilotDerivation {
  readonly says: string;
  readonly reads: readonly string[];
  readonly writes: string;
}

export const derivations: Readonly<Record<string, PilotDerivation>> = {
  'billing-copies-head-office': {
    says: 'While "billing address same as head office" is checked, the billing address is a copy of the head office.',
    reads: ['company.billingSameAsHeadOffice', 'company.headOffice'],
    writes: 'company.billingAddress',
  },
  'parent-dropped-when-unchecked': {
    says: 'While "has a parent company" is unchecked, the parent company is absent from the submitted values.',
    reads: ['company.hasParentCompany'],
    writes: 'company.parent',
  },
  'price-including-vat': {
    says: 'Unit price × (1 + VAT rate / 100), rounded to the cent; the unit price itself for a product not taxable.',
    reads: ['catalogue.products[*].unitPrice', 'catalogue.products[*].taxable', 'catalogue.products[*].vatRate'],
    writes: 'catalogue.products[*].priceIncludingVat',
  },
  'product-count': {
    says: 'The number of products of the catalogue.',
    reads: ['catalogue.products'],
    writes: 'catalogue.summary.productCount',
  },
  'highest-discount': {
    says: 'The highest discount of every tier of every product; 0 without any.',
    reads: ['catalogue.products[*].volumeDiscounts[*].discountPercent'],
    writes: 'catalogue.summary.highestDiscount',
  },
};

/** The countries of the European Union, for the VAT requirement. */
export const euCountries: ReadonlySet<Country> = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
]);

/** The pattern of a concrete path: property names joined by dots, every list element written `[*]`. */
export function pathPattern(path: PilotPath): string {
  let pattern = '';
  for (const segment of path) {
    if (typeof segment === 'string') {
      pattern += pattern === '' ? segment : `.${segment}`;
    } else {
      pattern += '[*]';
    }
  }
  return pattern;
}
