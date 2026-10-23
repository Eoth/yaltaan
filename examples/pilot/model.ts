// The pilot form: a supplier onboarding application, the kind of business form a purchasing team fills in to open an
// account for a new supplier. Five steps, a dynamic list of contacts and one of documents, conditional requirements,
// rules across fields and checks only the server can make. This file is the catalogue the scenarios cite: the shape
// of the values, every field with its step, and every rule with the fields it reads and the fields it marks.
//
// Paths follow the contract of ARCHITECTURE.md §5.3: a list of segments, where an element of a dynamic list is named
// by its stable key (`{ key }`), so that an issue follows the element when the list is reordered. The type is written
// here until `@yaltaan/core` ships its own.

/** A segment of a path: a property name, an index, or the stable key of a list element. */
export type Segment = string | number | { readonly key: string };

/** A path from the root of the values to a field; the empty path names the form as a whole. */
export type PilotPath = readonly Segment[];

export type Country = string;
export type LegalForm = 'SAS' | 'SARL' | 'SA' | 'EI' | 'OTHER';
export type ContactRole = 'billing' | 'sales' | 'technical';
export type PaymentTerm = 'NET30' | 'NET45' | 'NET60' | 'DEPOSIT';
export type DocumentKind = 'kbis' | 'insurance' | 'bank-letter' | 'other';

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

export interface SupportingDocument {
  readonly key: string;
  readonly kind: DocumentKind;
  readonly fileName: string;
  /** ISO 8601 calendar date. */
  readonly issuedOn: string;
  readonly expiresOn?: string;
}

/** The values of a complete application, as the form submits them. */
export interface SupplierApplication {
  readonly company: {
    readonly legalName: string;
    /** ISO 3166-1 alpha-2. */
    readonly country: Country;
    /** French company number: nine digits, Luhn checksum. */
    readonly siren?: string;
    /** Registration number of a company outside France. */
    readonly foreignRegistration?: string;
    readonly vatNumber?: string;
    readonly legalForm: LegalForm;
    readonly legalFormOther?: string;
    readonly foundedOn: string;
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
  readonly documents: readonly SupportingDocument[];
  readonly declarations: {
    readonly accuracy: boolean;
    readonly dataProcessing: boolean;
  };
}

/** The five steps, in the order the form shows them. */
export const steps = ['company', 'contacts', 'bank', 'terms', 'documents'] as const;
export type Step = (typeof steps)[number];

/**
 * Every field of the form: its path pattern (`[*]` stands for any element of a list) and its step. A path in a
 * scenario must match one of these, or be the empty path.
 */
export const fields: Readonly<Record<string, Step>> = {
  company: 'company',
  'company.legalName': 'company',
  'company.country': 'company',
  'company.siren': 'company',
  'company.foreignRegistration': 'company',
  'company.vatNumber': 'company',
  'company.legalForm': 'company',
  'company.legalFormOther': 'company',
  'company.foundedOn': 'company',
  contacts: 'contacts',
  'contacts[*].firstName': 'contacts',
  'contacts[*].lastName': 'contacts',
  'contacts[*].email': 'contacts',
  'contacts[*].phone': 'contacts',
  'contacts[*].roles': 'contacts',
  'contacts[*].primary': 'contacts',
  bank: 'bank',
  'bank.iban': 'bank',
  'bank.bic': 'bank',
  'bank.accountHolder': 'bank',
  terms: 'terms',
  'terms.paymentTerm': 'terms',
  'terms.depositPercent': 'terms',
  'terms.contractNumber': 'terms',
  'terms.contractSignedOn': 'terms',
  'terms.validFrom': 'terms',
  'terms.validTo': 'terms',
  documents: 'documents',
  'documents[*].kind': 'documents',
  'documents[*].fileName': 'documents',
  'documents[*].issuedOn': 'documents',
  'documents[*].expiresOn': 'documents',
  'declarations.accuracy': 'documents',
  'declarations.dataProcessing': 'documents',
};

/** Who checks a rule: the schema of one field, a rule across fields, or the server after submission. */
export type RuleSource = 'schema' | 'rule' | 'server';

/** A rule of the form: what it requires, the code of the issue it raises, and the fields it reads and marks. */
export interface PilotRule {
  readonly id: string;
  readonly source: RuleSource;
  readonly code: string;
  readonly says: string;
  readonly reads: readonly string[];
  readonly marks: readonly string[];
}

/**
 * The rules. Codes of the library (`schema.*`, `rules.*`) are the names the issue registry is expected to hold;
 * codes of the application (`pilot.*`) belong to the pilot, as an application's own codes would.
 */
export const rules: readonly PilotRule[] = [
  {
    id: 'legal-name',
    source: 'schema',
    code: 'schema.too_short',
    says: 'The legal name has 2 to 120 characters once trimmed.',
    reads: ['company.legalName'],
    marks: ['company.legalName'],
  },
  {
    id: 'siren-required',
    source: 'rule',
    code: 'rules.required_if',
    says: 'A French company gives its SIREN.',
    reads: ['company.country', 'company.siren'],
    marks: ['company.siren'],
  },
  {
    id: 'foreign-registration-required',
    source: 'rule',
    code: 'rules.required_if',
    says: 'A company outside France gives its registration number.',
    reads: ['company.country', 'company.foreignRegistration'],
    marks: ['company.foreignRegistration'],
  },
  {
    id: 'one-registration',
    source: 'rule',
    code: 'rules.mutually_exclusive',
    says: 'A SIREN and a foreign registration number are never both given.',
    reads: ['company.siren', 'company.foreignRegistration'],
    marks: ['company.siren', 'company.foreignRegistration'],
  },
  {
    id: 'siren-checksum',
    source: 'schema',
    code: 'pilot.siren_checksum',
    says: 'A SIREN is nine digits whose Luhn checksum holds.',
    reads: ['company.siren'],
    marks: ['company.siren'],
  },
  {
    id: 'vat-required',
    source: 'rule',
    code: 'rules.required_if',
    says: 'A company of the European Union gives its VAT number.',
    reads: ['company.country', 'company.vatNumber'],
    marks: ['company.vatNumber'],
  },
  {
    id: 'legal-form-other',
    source: 'rule',
    code: 'rules.required_if',
    says: 'The legal form "OTHER" is spelled out.',
    reads: ['company.legalForm', 'company.legalFormOther'],
    marks: ['company.legalFormOther'],
  },
  {
    id: 'founded-in-past',
    source: 'schema',
    code: 'schema.too_large',
    says: 'The founding date is not after today.',
    reads: ['company.foundedOn'],
    marks: ['company.foundedOn'],
  },
  {
    id: 'contacts-count',
    source: 'schema',
    code: 'schema.too_small',
    says: 'One to five contacts.',
    reads: ['contacts'],
    marks: ['contacts'],
  },
  {
    id: 'contact-email',
    source: 'schema',
    code: 'schema.invalid_format',
    says: 'A contact email is an email address.',
    reads: ['contacts[*].email'],
    marks: ['contacts[*].email'],
  },
  {
    id: 'contact-email-unique',
    source: 'rule',
    code: 'rules.unique',
    says: 'No two contacts share an email, ignoring case; every contact sharing one is marked.',
    reads: ['contacts[*].email'],
    marks: ['contacts[*].email'],
  },
  {
    id: 'contact-roles',
    source: 'schema',
    code: 'schema.too_small',
    says: 'A contact has at least one role.',
    reads: ['contacts[*].roles'],
    marks: ['contacts[*].roles'],
  },
  {
    id: 'one-primary',
    source: 'rule',
    code: 'rules.exactly',
    says: 'Exactly one contact is the primary contact.',
    reads: ['contacts[*].primary'],
    marks: ['contacts'],
  },
  {
    id: 'billing-contact',
    source: 'rule',
    code: 'rules.at_least',
    says: 'At least one contact has the billing role.',
    reads: ['contacts[*].roles'],
    marks: ['contacts'],
  },
  {
    id: 'iban-checksum',
    source: 'schema',
    code: 'pilot.iban_checksum',
    says: 'An IBAN passes the ISO 13616 mod-97 check.',
    reads: ['bank.iban'],
    marks: ['bank.iban'],
  },
  {
    id: 'bic-outside-sepa',
    source: 'rule',
    code: 'rules.required_if',
    says: 'An account outside the SEPA area gives its BIC.',
    reads: ['bank.iban', 'bank.bic'],
    marks: ['bank.bic'],
  },
  {
    id: 'deposit-percent',
    source: 'rule',
    code: 'rules.required_if',
    says: 'Payment by deposit gives the deposit percentage.',
    reads: ['terms.paymentTerm', 'terms.depositPercent'],
    marks: ['terms.depositPercent'],
  },
  {
    id: 'deposit-range',
    source: 'schema',
    code: 'schema.too_large',
    says: 'A deposit is a whole percentage from 1 to 50.',
    reads: ['terms.depositPercent'],
    marks: ['terms.depositPercent'],
  },
  {
    id: 'contract-pair',
    source: 'rule',
    code: 'rules.all_or_none',
    says: 'A contract number and its signing date are given together or not at all; the missing one is marked.',
    reads: ['terms.contractNumber', 'terms.contractSignedOn'],
    marks: ['terms.contractNumber', 'terms.contractSignedOn'],
  },
  {
    id: 'validity-order',
    source: 'rule',
    code: 'rules.ordered',
    says: 'The terms end on or after the day they start.',
    reads: ['terms.validFrom', 'terms.validTo'],
    marks: ['terms.validTo'],
  },
  {
    id: 'insurance-expiry',
    source: 'rule',
    code: 'rules.required_if',
    says: 'An insurance certificate gives its expiry date.',
    reads: ['documents[*].kind', 'documents[*].expiresOn'],
    marks: ['documents[*].expiresOn'],
  },
  {
    id: 'document-order',
    source: 'rule',
    code: 'rules.ordered',
    says: 'A document expires after the day it was issued.',
    reads: ['documents[*].issuedOn', 'documents[*].expiresOn'],
    marks: ['documents[*].expiresOn'],
  },
  {
    id: 'kbis-for-france',
    source: 'rule',
    code: 'rules.at_least',
    says: 'A French company attaches at least one Kbis extract.',
    reads: ['company.country', 'documents[*].kind'],
    marks: ['documents'],
  },
  {
    id: 'kbis-recent',
    source: 'schema',
    code: 'pilot.document_too_old',
    says: 'A Kbis extract was issued at most 90 days before today.',
    reads: ['documents[*].kind', 'documents[*].issuedOn'],
    marks: ['documents[*].issuedOn'],
  },
  {
    id: 'declarations',
    source: 'schema',
    code: 'schema.invalid_value',
    says: 'Both declarations are accepted.',
    reads: ['declarations.accuracy', 'declarations.dataProcessing'],
    marks: ['declarations.accuracy', 'declarations.dataProcessing'],
  },
  {
    id: 'siren-taken',
    source: 'server',
    code: 'pilot.siren_taken',
    says: 'The server already holds a supplier with this SIREN.',
    reads: ['company.siren'],
    marks: ['company.siren'],
  },
  {
    id: 'iban-rejected',
    source: 'server',
    code: 'pilot.iban_rejected',
    says: 'The server refuses the account (sanctions screening).',
    reads: ['bank.iban'],
    marks: ['bank.iban'],
  },
  {
    id: 'server-unavailable',
    source: 'server',
    code: 'pilot.server_unavailable',
    says: 'The server could not be reached; the form as a whole is marked and the values are kept.',
    reads: [],
    marks: [''],
  },
];

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
