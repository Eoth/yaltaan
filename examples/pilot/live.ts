// The pilot form built with @yaltaan/form, as an application builds it: a node for each field, group and list of the
// values, the schemas of form.ts on the nodes they read, and the rules of the pilot read by the form, which checks each
// one again only once a value it reads changes. The scenarios of scenarios.ts run against it (live.test.ts), as they
// run against the form of the schema and the rules alone (form.test.ts).
//
// A form holds every input of a sub-form, entered or not, where the values the scenarios give leave an empty sub-form
// out. The billing address and the parent company are `optional` groups: left empty, they are absent from what the
// form submits, as from those values, so that a rule finds them blank and their fields are not checked; started, each
// of their fields is read by its own schema. Each is hidden while its box says it is not needed, the billing address
// while it follows the head office, the parent company while there is none: a hidden sub-form is left out of the
// submission, neither checked nor read by a rule, whatever it holds.
import type { Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import type { Result } from '@yaltaan/core/result';
import { array, createForm, field, group, type Form, type Spec } from '@yaltaan/form';
import { parse, type Schema } from '@yaltaan/schema';

import { applicationSchema, derivations, parent, pilotRules, type Submission } from './form.ts';
import type { ServerAnswer } from './scenarios.ts';

type AnySchema = Schema<unknown, unknown>;

/** A field read by `schema`, empty until something is entered. */
const input = (schema?: AnySchema): Spec => field<unknown>(undefined, schema ? { schema } : {});

/** The fields of an object schema, one per entry, each read by its entry, a nested object schema a group of its own. */
function fieldsOf(entries: Readonly<Record<string, unknown>>): Record<string, Spec> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => {
      const nested = (entry as { readonly entries?: Readonly<Record<string, unknown>> }).entries;
      return [key, nested ? group(fieldsOf(nested)) : input(entry as AnySchema)];
    }),
  );
}

/** A sub-form the user may leave empty, absent then, and hidden while the box at `box` holds `hiddenWhen`. */
const subForm = (entries: Readonly<Record<string, unknown>>, box: string, hiddenWhen: boolean): Spec =>
  group(fieldsOf(entries), {
    optional: true,
    hidden: { reads: [['company', box]], when: (checked) => (checked === true) === hiddenWhen },
  });

/** A group of plain fields, read as a whole by `schema`, an object schema whose issues go to the fields they name. */
function readAsOne(schema: AnySchema & { readonly entries: Readonly<Record<string, unknown>> }): Spec {
  return group(Object.fromEntries(Object.keys(schema.entries).map((key) => [key, input()])), { schema });
}

const { entries } = applicationSchema;
const company = entries.company.entries;
const keyed = { identity: ['key'] };

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
        billingAddress: subForm(company.headOffice.entries, 'billingSameAsHeadOffice', true),
        hasParentCompany: field(false, { schema: company.hasParentCompany }),
        parent: subForm(parent.entries, 'hasParentCompany', false),
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
    { rules: pilotRules(today) },
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
  readonly hidden: { get(): boolean };
  readonly disabled: { get(): boolean };
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
 * value written into the form, which shows every issue its schemas and its rules find; the server is asked only when
 * the form reads none, with what the form submits and the values the derivations give from it.
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
  if (!read.ok) {
    const raw = form.raw.get() as Readonly<Record<string, unknown>>;
    const values = Object.values(derivations).reduce((current, derive) => derive(current), raw);
    return { form, values, issues: read.error.map((issue) => ({ ...issue, path: byBusinessKey(form, issue.path) })) };
  }
  // What the form submits, a hidden sub-form `undefined` and an empty optional one absent, is what the server reads.
  const submitted = read.value as Readonly<Record<string, unknown>>;
  const values = Object.values(derivations).reduce((current, derive) => derive(current), submitted);
  const sent = parse(applicationSchema, values);
  if (!sent.ok) {
    throw new Error(`the form accepted what the server reads wrong: ${JSON.stringify(sent.error)}`);
  }
  const answer = send(sent.value);
  return { form, values, issues: answer === 'accepted' ? [] : [SERVER_ISSUES[answer]], sent: sent.value };
}
