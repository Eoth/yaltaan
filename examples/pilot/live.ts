// The pilot form built with @yaltaan/form, as an application builds it: a node for each field, group and list of the
// values, the schemas of form.ts on the nodes they read, and the rules of the pilot read by the form, which checks each
// one again only once a value it reads changes. The scenarios of scenarios.ts run against it (live.test.ts), as they
// run against the form of the schema and the rules alone (form.test.ts).
//
// A form holds every input of a sub-form, entered or not, where the values the scenarios give leave an empty sub-form
// out, and a rule reads the raw value as it is: an empty sub-form is an object, not a blank. The application writes
// for it what differs: the fields of the billing address and of the parent company are each read through `optional`,
// so that an empty sub-form passes and a field entered in it is checked, and the postal code of an address none of
// whose fields holds a value is not checked. What a form does with an empty or a disabled sub-form, its issues and
// what it submits, is still to decide: until then, an empty billing address or parent company is not marked as
// required, and a parent company unchecked after being filled still shows its issues.
import type { Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import type { Result } from '@yaltaan/core/result';
import { array, createForm, field, group, type Form, type Spec } from '@yaltaan/form';
import { optional, parse, type Schema } from '@yaltaan/schema';

import type { Rule } from '@yaltaan/rules';

import { applicationSchema, derivations, parent, pilotRules, postalCode, type Submission } from './form.ts';
import type { ServerAnswer } from './scenarios.ts';

type AnySchema = Schema<unknown, unknown>;

/** A field read by `schema`, empty until something is entered. */
const input = (schema?: AnySchema): Spec => field<unknown>(undefined, schema ? { schema } : {});

/** A group of fields, one per entry of an object schema, each read by its entry, through `optional` when `loose`. */
function fieldsOf(entries: Readonly<Record<string, unknown>>, loose: boolean): Record<string, Spec> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => {
      const nested = (entry as { readonly entries?: Readonly<Record<string, unknown>> }).entries;
      const schema = entry as AnySchema;
      return [key, nested ? group(fieldsOf(nested, loose)) : input(loose ? optional(schema) : schema)];
    }),
  );
}

/** A group of plain fields, read as a whole by `schema`, an object schema whose issues go to the fields they name. */
function readAsOne(schema: AnySchema & { readonly entries: Readonly<Record<string, unknown>> }): Spec {
  return group(Object.fromEntries(Object.keys(schema.entries).map((key) => [key, input()])), { schema });
}

const { entries } = applicationSchema;
const company = entries.company.entries;
const keyed = { identity: ['key'] };

const blank = (value: unknown): boolean => value === undefined || value === null || value === '';

/** The postal code of an address that holds something: an address of the form is there, filled or not. */
const postalCodeEntered: Rule = {
  ...postalCode,
  check: (values) => {
    const issues = postalCode.check(values);
    return issues.filter(({ path }) => {
      const address = path
        .slice(0, -1)
        .reduce<unknown>((at, key) => (at as Record<PropertyKey, unknown>)?.[key as PropertyKey], values);
      return Object.values(address as object).some((value) => !blank(value));
    });
  },
};

/** The rules of the pilot on the day of submission, as its form reads them: an empty address has no postal code. */
export function liveRules(today: string): readonly Rule[] {
  return pilotRules(today).map((rule) => (rule === postalCode ? postalCodeEntered : rule));
}

/** The description of the pilot form: what `createForm` builds, the rules of `today` at its root. */
export function liveSpec(today: string): Spec {
  return group(
    {
      company: group({
        legalName: input(company.legalName),
        country: input(company.country),
        siren: input(company.siren),
        foreignRegistration: input(company.foreignRegistration),
        vatNumber: input(company.vatNumber),
        legalForm: input(company.legalForm),
        legalFormOther: input(company.legalFormOther),
        foundedOn: input(company.foundedOn),
        headOffice: readAsOne(company.headOffice),
        billingSameAsHeadOffice: field(false, { schema: company.billingSameAsHeadOffice }),
        billingAddress: group(fieldsOf(company.headOffice.entries, true)),
        hasParentCompany: field(false, { schema: company.hasParentCompany }),
        parent: group(fieldsOf(parent.entries, true)),
      }),
      contacts: array(
        group({
          key: input(),
          firstName: input(),
          lastName: input(),
          email: input(),
          phone: input(),
          roles: field<unknown>([]),
          primary: field(false),
        }),
        { ...keyed, schema: entries.contacts },
      ),
      bank: readAsOne(entries.bank),
      terms: readAsOne(entries.terms),
      catalogue: group(
        {
          currency: input(),
          products: array(
            group({
              key: input(),
              reference: input(),
              label: input(),
              category: input(),
              unitPrice: input(),
              taxable: field(false),
              vatRate: input(),
              minimumQuantity: input(),
              volumeDiscounts: array(group({ key: input(), fromQuantity: input(), discountPercent: input() }), keyed),
            }),
            keyed,
          ),
        },
        { schema: entries.catalogue },
      ),
      documents: array(
        group({ key: input(), kind: input(), fileName: input(), issuedOn: input(), expiresOn: input() }),
        { ...keyed, schema: entries.documents },
      ),
      declarations: readAsOne(entries.declarations),
    },
    { rules: liveRules(today) },
  );
}

/**
 * `value` as the form of `spec` holds it: an absent sub-form an empty one, every input of a form existing whether
 * something was entered or not, the rest as it is.
 */
export function holding(spec: Spec, value: unknown): unknown {
  if (spec.kind === 'array') {
    return Array.isArray(value) ? value.map((item: unknown) => holding(spec.element, item)) : value;
  }
  if (spec.kind === 'field' || (value !== undefined && (typeof value !== 'object' || value === null))) {
    return value;
  }
  const given = (value ?? {}) as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.entries(spec.children).map(([key, child]) => [
      key,
      holding(child, Object.hasOwn(given, key) ? given[key] : undefined),
    ]),
  );
}

const SERVER_ISSUES: Readonly<Record<Exclude<ServerAnswer, 'accepted'>, Issue>> = {
  'siren-taken': { code: 'pilot.siren_taken', path: ['company', 'siren'] },
  'iban-rejected': { code: 'pilot.iban_rejected', path: ['bank', 'iban'] },
  unavailable: { code: 'pilot.server_unavailable', path: [] },
};

/** What the replay reads of a node of the form, whatever its kind. */
export interface LiveNode {
  readonly path: Path;
  readonly key?: unknown;
  readonly raw: { get(): unknown };
  readonly issues: { get(): readonly Issue[] };
  readonly required: { get(): boolean };
  readonly children?: Readonly<Record<string, LiveNode>>;
  readonly items?: { get(): readonly LiveNode[] };
}

/** The form of the pilot, as the replay drives it. */
export interface LiveForm extends LiveNode {
  readonly graph: Form<Spec>['graph'];
  set(raw: unknown): void;
  submit(): Result<unknown, readonly Issue[]>;
}

/** `path` with each item named by the business key its value holds, as the scenarios name it, not the form's key. */
function byBusinessKey(form: LiveNode, path: Path): Path {
  let node: LiveNode | undefined = form;
  return path.map((segment) => {
    if (node?.items && typeof segment === 'object') {
      const item = node.items.get().find((candidate) => candidate.key === (segment as { key: unknown }).key);
      node = item;
      return item ? { key: (item.raw.get() as { key: unknown }).key } : segment;
    }
    node = typeof segment === 'string' ? node?.children?.[segment] : undefined;
    return segment;
  });
}

/**
 * Submits what the user entered through the form: the legal name trimmed, as its input does when it loses focus, every
 * value written into the form, which shows every issue its schemas and its rules find; the server is asked, with the
 * values the derivations give, only when the form reads none.
 */
export function submitLive(
  entered: Readonly<Record<string, unknown>>,
  send: (values: unknown) => ServerAnswer,
  today: string,
): Submission & { readonly form: LiveForm } {
  const spec = liveSpec(today);
  const form = createForm(spec) as unknown as LiveForm;
  form.set(holding(spec, derivations['legal-name-trimmed']!(entered)));
  const read = form.submit();
  const raw = form.raw.get() as Readonly<Record<string, unknown>>;
  const values = Object.values(derivations).reduce((current, derive) => derive(current), raw);
  if (!read.ok) {
    return { form, values, issues: read.error.map((issue) => ({ ...issue, path: byBusinessKey(form, issue.path) })) };
  }
  const sent = parse(applicationSchema, values);
  if (!sent.ok) {
    throw new Error(`the form accepted what the server reads wrong: ${JSON.stringify(sent.error)}`);
  }
  const answer = send(sent.value);
  return { form, values, issues: answer === 'accepted' ? [] : [SERVER_ISSUES[answer]], sent: sent.value };
}
