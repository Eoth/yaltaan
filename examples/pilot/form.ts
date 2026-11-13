// The pilot form written with the library, as an application writes it: a schema for the shape and the bounds of each
// field, rules for what holds across fields, the values the form derives before it checks anything, and the answer of
// the server. The scenarios of scenarios.ts run against it (form.test.ts).
//
// The minimal schema has no refinement yet: a check of one field that it cannot state, such as a checksum or a date
// compared with the day of submission, is a rule of the application, with a code of its own. The day of submission is
// an argument, never the machine's clock, so that the same values give the same issues on any day.
import type { Issue } from '@yaltaan/core/issue';
import { round } from '@yaltaan/core/number';
import type { Path } from '@yaltaan/core/path';
import {
  allOrNone,
  anyElement,
  atLeast,
  each,
  exactly,
  mutuallyExclusive,
  ordered,
  requiredIf,
  unique,
  checkRules,
  type Rule,
} from '@yaltaan/rules';
import {
  array,
  boolean,
  literal,
  number,
  object,
  optional,
  parse,
  picklist,
  string,
  type Schema,
} from '@yaltaan/schema';

import { euCountries } from './model.ts';
import type { ServerAnswer } from './scenarios.ts';

type Values = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Values {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** What is at `path` in `values`, through own keys only; `undefined` when anything on the way is missing. */
function at(values: unknown, ...path: readonly (string | number)[]): unknown {
  let current = values;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === 'string' && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function listAt(values: unknown, ...path: readonly string[]): readonly unknown[] {
  const list = at(values, ...path);
  return Array.isArray(list) ? list : [];
}

const isFilled = (value: unknown): value is string => typeof value === 'string' && value !== '';

// The schema. Bounds are the HTML constraint attributes a designer would give each input.

const text = (maxLength: number): Schema<string> => string({ maxLength });
const filled = (maxLength: number): Schema<string> => string({ minLength: 1, maxLength });
// Written YYYY-MM-DD by a date input; whether the day exists is the rule `date-exists`.
const date = text(10);
const country = string({ minLength: 2, maxLength: 2, pattern: /^[A-Z]{2}$/ });
const key = filled(64);

const address = object({ street: filled(120), postalCode: text(12), city: filled(80), country });

/** A parent company: the sub-form the form version of the pilot reads field by field (live.ts). */
export const parent = object({
  legalName: filled(120),
  country,
  siren: optional(text(20)),
  foreignRegistration: optional(text(40)),
  ownershipPercent: number({ min: 50, max: 100 }),
  address,
});

const contact = object({
  key,
  firstName: filled(60),
  lastName: filled(60),
  // An address with one @ and a dotted domain; every part excludes the separators, so that a failing match is linear.
  email: string({ maxLength: 254, pattern: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/ }),
  phone: optional(text(30)),
  roles: array(picklist(['billing', 'sales', 'technical']), { minLength: 1, maxLength: 3 }),
  primary: boolean(),
});

const tier = object({
  key,
  fromQuantity: number({ min: 1, integer: true }),
  discountPercent: number({ min: 0.01, max: 50 }),
});

const product = object({
  key,
  reference: filled(40),
  label: filled(120),
  category: picklist(['goods', 'services', 'software']),
  // Above zero: the smallest positive number is the bound, both bounds being included.
  unitPrice: number({ min: Number.MIN_VALUE }),
  taxable: boolean(),
  vatRate: optional(picklist([5.5, 10, 20])),
  priceIncludingVat: optional(number()),
  minimumQuantity: number({ min: 1, integer: true }),
  volumeDiscounts: array(tier, { maxLength: 3 }),
});

const supportingDocument = object({
  key,
  kind: picklist(['kbis', 'insurance', 'bank-letter', 'other']),
  fileName: filled(255),
  issuedOn: date,
  expiresOn: optional(date),
});

/** The shape of the values the form submits, derived values included; unknown keys are dropped. */
export const applicationSchema = object({
  company: object({
    legalName: string({ minLength: 2, maxLength: 120 }),
    country,
    siren: optional(text(20)),
    foreignRegistration: optional(text(40)),
    vatNumber: optional(text(20)),
    legalForm: picklist(['SAS', 'SARL', 'SA', 'EI', 'OTHER']),
    legalFormOther: optional(text(60)),
    foundedOn: date,
    headOffice: address,
    billingSameAsHeadOffice: boolean(),
    billingAddress: optional(address),
    hasParentCompany: boolean(),
    parent: optional(parent),
  }),
  contacts: array(contact, { minLength: 1, maxLength: 5 }),
  bank: object({ iban: text(42), bic: optional(text(11)), accountHolder: filled(120) }),
  terms: object({
    paymentTerm: picklist(['NET30', 'NET45', 'NET60', 'DEPOSIT']),
    depositPercent: optional(number({ min: 1, max: 50, integer: true })),
    contractNumber: optional(text(40)),
    contractSignedOn: optional(date),
    validFrom: date,
    validTo: optional(date),
  }),
  catalogue: object({
    currency: picklist(['EUR', 'USD', 'GBP']),
    products: array(product, { minLength: 1, maxLength: 50 }),
    summary: optional(object({ productCount: number({ min: 0, integer: true }), highestDiscount: number({ min: 0 }) })),
  }),
  documents: array(supportingDocument, { maxLength: 20 }),
  declarations: object({ accuracy: literal(true), dataProcessing: literal(true) }),
});

// The checks of one field that the schema cannot state yet, written as an application writes a rule.

/** A SIREN: nine digits whose Luhn sum is a multiple of ten. */
export function isSiren(text: string): boolean {
  if (!/^\d{9}$/.test(text)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const digit = Number(text[8 - index]) * (index % 2 === 1 ? 2 : 1);
    sum += digit > 9 ? digit - 9 : digit;
  }
  return sum % 10 === 0;
}

/** An IBAN by ISO 13616: a country, two check digits and up to 30 letters or digits, whose number is 1 modulo 97. */
export function isIban(text: string): boolean {
  const compact = text.replaceAll(' ', '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(compact)) {
    return false;
  }
  let remainder = 0;
  for (const character of compact.slice(4) + compact.slice(0, 4)) {
    const value = Number.parseInt(character, 36);
    remainder = (value > 9 ? remainder * 100 + value : remainder * 10 + value) % 97;
  }
  return remainder === 1;
}

/** The day `text` names, in days since 1970-01-01, if it is a day of the calendar written YYYY-MM-DD. */
export function dayNumber(text: unknown): number | undefined {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return undefined;
  }
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day
    ? time / 86_400_000
    : undefined;
}

/** A rule on fields given by their full paths, each checked alone; the issue goes on the field that fails. */
function fieldCheck(code: string, paths: readonly (readonly string[])[], holds: (value: string) => boolean): Rule {
  return {
    reads: paths,
    targets: paths,
    check: (values) =>
      paths.flatMap((path) => {
        const value = at(values, ...path);
        return isFilled(value) && !holds(value) ? [{ code, path }] : [];
      }),
  };
}

/** A check of one field of every element of a list, the issue on that element, by its key. */
function elementCheck(
  list: readonly string[],
  field: string,
  code: string,
  holds: (value: string, element: Values) => boolean,
): Rule {
  return {
    reads: [[...list, anyElement]],
    targets: [[...list, anyElement, field]],
    check: (values) =>
      listAt(values, ...list).flatMap((element) => {
        if (!isRecord(element)) {
          return [];
        }
        const value = element[field];
        return Object.hasOwn(element, field) && isFilled(value) && !holds(value, element)
          ? [{ code, path: [...list, { key: element['key'] }, field] }]
          : [];
      }),
  };
}

const ADDRESSES: readonly (readonly string[])[] = [
  ['company', 'headOffice'],
  ['company', 'billingAddress'],
  ['company', 'parent', 'address'],
];

/** The postal code of each address, by the format of its country; an absent address has none to check. */
export const postalCode: Rule = {
  reads: ADDRESSES,
  targets: ADDRESSES.map((prefix) => [...prefix, 'postalCode']),
  check: (values) =>
    ADDRESSES.flatMap((prefix) => {
      const where = at(values, ...prefix);
      if (!isRecord(where)) {
        return [];
      }
      const code = at(where, 'postalCode');
      const inCountry = at(where, 'country');
      const valid =
        typeof code === 'string' && (inCountry === 'FR' || inCountry === 'DE' ? /^\d{5}$/.test(code) : code !== '');
      return valid ? [] : [{ code: 'pilot.postal_code_format', path: [...prefix, 'postalCode'] }];
    }),
};

const DATES: readonly (readonly string[])[] = [
  ['company', 'foundedOn'],
  ['terms', 'contractSignedOn'],
  ['terms', 'validFrom'],
  ['terms', 'validTo'],
];

const SEPA: ReadonlySet<string> = new Set([...euCountries, 'AD', 'CH', 'GB', 'IS', 'LI', 'MC', 'NO', 'SM', 'VA']);

const isValue =
  (expected: unknown) =>
  (value: unknown): boolean =>
    value === expected;

const keyed = { identity: ['key'] };

const lowerCase = (value: unknown): unknown => (typeof value === 'string' ? value.toLowerCase() : value);

// Each volume discount against the one before it, the later one marked: a rule over the elements of a list in order.
function increasing(field: string, strict: boolean): Rule {
  const list = 'volumeDiscounts';
  return {
    reads: [
      [list, anyElement, field],
      [list, anyElement, 'key'],
    ],
    targets: [[list, anyElement, field]],
    check: (values) =>
      listAt(values, list).flatMap((item, index, all) => {
        const before = index === 0 ? undefined : at(all[index - 1], field);
        const value = at(item, field);
        return typeof before === 'number' && typeof value === 'number' && (strict ? value <= before : value < before)
          ? [{ code: 'rules.ordered', path: [list, { key: at(item, 'key') }, field] }]
          : [];
      }),
  };
}

// A rule across two levels: the first discount of a product against the product's minimum quantity.
const firstTierAboveMinimum: Rule = {
  reads: [['minimumQuantity'], ['volumeDiscounts', 0, 'fromQuantity'], ['volumeDiscounts', 0, 'key']],
  targets: [['volumeDiscounts', anyElement, 'fromQuantity']],
  check: (values) => {
    const minimum = at(values, 'minimumQuantity');
    const from = at(values, 'volumeDiscounts', 0, 'fromQuantity');
    return typeof from === 'number' && typeof minimum === 'number' && from < minimum
      ? [
          {
            code: 'rules.ordered',
            path: ['volumeDiscounts', { key: at(values, 'volumeDiscounts', 0, 'key') }, 'fromQuantity'],
          },
        ]
      : [];
  },
};

// `when` of a later version of the rules: a rule of the French case only.
function onlyInFrance(inner: Rule): Rule {
  return {
    reads: [['company', 'country'], ...inner.reads],
    targets: inner.targets,
    check: (values) => (at(values, 'company', 'country') === 'FR' ? inner.check(values) : []),
  };
}

const KBIS_DAYS = 90;

/** The rules of the pilot on the day of submission `today` (YYYY-MM-DD): the catalogue's, but the schema's. */
export function pilotRules(today: string): readonly Rule[] {
  const day = dayNumber(today);
  if (day === undefined) {
    throw new TypeError(`not a day of the calendar: ${today}`);
  }
  const products = ['catalogue', 'products'];
  return [
    requiredIf({ reads: [['company', 'country']], when: isValue('FR') }, [['company', 'siren']]),
    requiredIf({ reads: [['company', 'country']], when: (country) => country !== 'FR' }, [
      ['company', 'foreignRegistration'],
    ]),
    mutuallyExclusive([
      ['company', 'siren'],
      ['company', 'foreignRegistration'],
    ]),
    fieldCheck(
      'pilot.siren_checksum',
      [
        ['company', 'siren'],
        ['company', 'parent', 'siren'],
      ],
      isSiren,
    ),
    requiredIf({ reads: [['company', 'country']], when: (country) => euCountries.has(country as string) }, [
      ['company', 'vatNumber'],
    ]),
    requiredIf({ reads: [['company', 'legalForm']], when: isValue('OTHER') }, [['company', 'legalFormOther']]),
    fieldCheck('pilot.founded_in_future', [['company', 'foundedOn']], (text) => (dayNumber(text) ?? -Infinity) <= day),
    fieldCheck('pilot.invalid_date', DATES, (text) => dayNumber(text) !== undefined),
    elementCheck(['documents'], 'issuedOn', 'pilot.invalid_date', (text) => dayNumber(text) !== undefined),
    elementCheck(['documents'], 'expiresOn', 'pilot.invalid_date', (text) => dayNumber(text) !== undefined),
    postalCode,
    requiredIf({ reads: [['company', 'billingSameAsHeadOffice']], when: isValue(false) }, [
      ['company', 'billingAddress'],
    ]),
    requiredIf({ reads: [['company', 'hasParentCompany']], when: isValue(true) }, [['company', 'parent']]),
    requiredIf(
      {
        reads: [
          ['company', 'hasParentCompany'],
          ['company', 'parent', 'country'],
        ],
        when: (has, country) => has === true && country === 'FR',
      },
      [['company', 'parent', 'siren']],
    ),
    unique(['contacts'], ['email'], { by: lowerCase, ...keyed }),
    exactly(1, { list: ['contacts'], at: ['primary'], where: isValue(true) }),
    atLeast(1, {
      list: ['contacts'],
      at: ['roles'],
      where: (roles) => Array.isArray(roles) && roles.includes('billing'),
    }),
    fieldCheck('pilot.iban_checksum', [['bank', 'iban']], isIban),
    requiredIf(
      {
        reads: [['bank', 'iban']],
        when: (iban) => typeof iban === 'string' && !SEPA.has(iban.slice(0, 2).toUpperCase()),
      },
      [['bank', 'bic']],
    ),
    requiredIf({ reads: [['terms', 'paymentTerm']], when: isValue('DEPOSIT') }, [['terms', 'depositPercent']]),
    allOrNone([
      ['terms', 'contractNumber'],
      ['terms', 'contractSignedOn'],
    ]),
    ordered(['terms', 'validFrom'], ['terms', 'validTo']),
    unique(products, ['reference'], { by: lowerCase, ...keyed }),
    each(products, [requiredIf({ reads: [['taxable']], when: isValue(true) }, [['vatRate']])], keyed),
    each(products, [firstTierAboveMinimum], keyed),
    each(products, [increasing('fromQuantity', true)], keyed),
    each(products, [increasing('discountPercent', false)], keyed),
    each(['documents'], [requiredIf({ reads: [['kind']], when: isValue('insurance') }, [['expiresOn']])], keyed),
    each(['documents'], [ordered(['issuedOn'], ['expiresOn'], { strict: true })], keyed),
    onlyInFrance(atLeast(1, { list: ['documents'], at: ['kind'], where: isValue('kbis') })),
    elementCheck(['documents'], 'issuedOn', 'pilot.document_too_old', (text, element) => {
      const issued = dayNumber(text);
      return element['kind'] !== 'kbis' || issued === undefined || day - issued <= KBIS_DAYS;
    }),
  ];
}

// The derived values: what the form computes, or clears, from what the user entered, before it checks anything.

/** A derivation: the values with one derived field written, or cleared; never a change of the values given. */
export type Derivation = (values: Values) => Values;

function withCompany(values: Values, change: (company: Record<string, unknown>) => void): Values {
  const company = values['company'];
  if (!isRecord(company)) {
    return values;
  }
  const copy = { ...company };
  change(copy);
  return { ...values, company: copy };
}

function withProducts(values: Values, change: (product: Record<string, unknown>) => void): Values {
  const catalogue = values['catalogue'];
  const products = at(catalogue, 'products');
  if (!isRecord(catalogue) || !Array.isArray(products)) {
    return values;
  }
  const copies = products.map((element: unknown) => {
    if (!isRecord(element)) {
      return element;
    }
    const copy = { ...element };
    change(copy);
    return copy;
  });
  return { ...values, catalogue: { ...catalogue, products: copies } };
}

function withSummary(values: Values, field: string, value: number): Values {
  const catalogue = values['catalogue'];
  if (!isRecord(catalogue)) {
    return values;
  }
  const summary = isRecord(catalogue['summary']) ? catalogue['summary'] : {};
  return { ...values, catalogue: { ...catalogue, summary: { ...summary, [field]: value } } };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The derivations of the catalogue, by name. */
export const derivations: Readonly<Record<string, Derivation>> = {
  'legal-name-trimmed': (values) =>
    withCompany(values, (company) => {
      if (typeof company['legalName'] === 'string') {
        company['legalName'] = company['legalName'].trim();
      }
    }),
  'billing-copies-head-office': (values) =>
    withCompany(values, (company) => {
      if (company['billingSameAsHeadOffice'] === true) {
        const office = company['headOffice'];
        company['billingAddress'] = isRecord(office) ? { ...office } : office;
      }
    }),
  'parent-dropped-when-unchecked': (values) =>
    withCompany(values, (company) => {
      if (company['hasParentCompany'] !== true) {
        delete company['parent'];
      }
    }),
  'price-including-vat': (values) =>
    withProducts(values, (product) => {
      const { unitPrice, taxable, vatRate } = product;
      if (finite(unitPrice) && taxable === false) {
        product['priceIncludingVat'] = unitPrice;
      } else if (finite(unitPrice) && taxable === true && finite(vatRate)) {
        product['priceIncludingVat'] = round(unitPrice * (1 + vatRate / 100), { digits: 2, mode: 'halfExpand' });
      } else {
        delete product['priceIncludingVat'];
      }
    }),
  'product-count': (values) => withSummary(values, 'productCount', listAt(values, 'catalogue', 'products').length),
  'highest-discount': (values) => {
    let highest = 0;
    for (const element of listAt(values, 'catalogue', 'products')) {
      for (const tierValues of listAt(element, 'volumeDiscounts')) {
        const discount = at(tierValues, 'discountPercent');
        if (finite(discount) && discount > highest) {
          highest = discount;
        }
      }
    }
    return withSummary(values, 'highestDiscount', highest);
  },
};

// The server's answers, as issues on the field they concern.

const SERVER_ISSUES: Readonly<Record<Exclude<ServerAnswer, 'accepted'>, Issue>> = {
  'siren-taken': { code: 'pilot.siren_taken', path: ['company', 'siren'] },
  'iban-rejected': { code: 'pilot.iban_rejected', path: ['bank', 'iban'] },
  unavailable: { code: 'pilot.server_unavailable', path: [] },
};

/** What a form is made of: one schema, its rules and its derivations. The tests take some away. */
export interface PilotParts {
  readonly schema: Schema<unknown, unknown>;
  readonly rules: readonly Rule[];
  readonly derivations: readonly Derivation[];
}

export function pilotParts(today: string): PilotParts {
  return {
    schema: applicationSchema as Schema<unknown, unknown>,
    rules: pilotRules(today),
    derivations: Object.values(derivations),
  };
}

/** What a submission gives: the values the form holds, every issue, and what reached the server, if anything did. */
export interface Submission {
  readonly values: unknown;
  readonly issues: readonly Issue[];
  readonly sent?: unknown;
}

/** A path of the schema, with each list element named by its `key` as the rules name it, so that both agree. */
function keyedPath(values: unknown, path: readonly (string | number)[]): Path {
  let current: unknown = values;
  return path.map((segment) => {
    const element = at(current, segment);
    current = element;
    return typeof segment === 'number' && isRecord(element) && typeof element['key'] === 'string'
      ? { key: element['key'] }
      : segment;
  });
}

/**
 * Submits what the user entered: derives, reads by the schema, checks the rules on the derived values (all at once,
 * so that the form shows every issue), and asks the server only when nothing is wrong.
 */
export function submitApplication(
  entered: unknown,
  send: (values: unknown) => ServerAnswer,
  parts: PilotParts,
): Submission {
  const values = isRecord(entered) ? parts.derivations.reduce((current, derive) => derive(current), entered) : entered;
  const read = parse(parts.schema, values);
  const found: Issue[] = read.ok ? [] : read.error.map((issue) => ({ ...issue, path: keyedPath(values, issue.path) }));
  found.push(...checkRules(parts.rules, values));
  // A billing address copied from the head office is shown read-only: its issues are the head office's, shown there.
  const copied = at(values, 'company', 'billingSameAsHeadOffice') === true;
  const issues = copied ? found.filter(({ path }) => !(path[0] === 'company' && path[1] === 'billingAddress')) : found;
  if (issues.length > 0 || !read.ok) {
    return { values, issues };
  }
  const answer = send(read.value);
  return { values, issues: answer === 'accepted' ? [] : [SERVER_ISSUES[answer]], sent: read.value };
}
