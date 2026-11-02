// Five rules of the pilot form, with the call that checks them; a schema and its refinement are not in this scenario.
import { allOrNone, atLeast, checkRules, ordered, requiredIf, unique } from '@yaltaan/rules';

const rules = [
  requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']]),
  allOrNone([['number'], ['signedOn']]),
  atLeast(1, { list: ['contacts'], at: ['billing'] }),
  unique(['contacts'], ['email'], { identity: ['key'] }),
  ordered(['from'], ['to']),
];

export const checkForm = (values) => checkRules(rules, values);
