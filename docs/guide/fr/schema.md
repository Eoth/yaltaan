# Schémas : lire ce qui vient de l'extérieur

`import { array, discriminatedUnion, literal, nullable, number, object, optional, parse, string, withMessages } from '@yaltaan/schema';`

## Le problème

Un formulaire, le corps d'une requête ou un fichier stocké contient ce qu'il contient, quoi que disent les types. Le vérifier à la main demande un test par champ, s'arrête à la première erreur ou en oublie une, et laisse le compilateur croire un transtypage. Un schéma dit une fois ce que la donnée doit être : il la vérifie, donne le type, et signale chaque problème avec un code et un chemin.

## Ce que vous écrivez

Construisez un schéma avec des fonctions et lisez avec `parse` : un `Result` de la sortie, ou de toutes les issues trouvées.

```ts
import { number, object, optional, parse, string, type InferOutput } from '@yaltaan/schema';

const signUp = object({
  email: string({ pattern: /^[^@\s]+@[^@\s]+$/, maxLength: 254 }),
  password: string({ minLength: 8 }),
  age: optional(number({ min: 18, integer: true })),
});

type SignUp = InferOutput<typeof signUp>;

const valid: SignUp = { email: 'ada@example.com', password: 'analytical' };

parse(signUp, valid); // → { ok: true, value: valid }
parse(signUp, { email: 'ada', age: 17.5 }); // → { ok: false, error: [{ code: 'schema.invalid_format', path: ['email'], params: { pattern: '^[^@\\s]+@[^@\\s]+$' } }, { code: 'schema.missing', path: ['password'] }, { code: 'schema.too_small', path: ['age'], params: { minimum: 18 } }, { code: 'schema.not_integer', path: ['age'] }] }
```

`parse` ne modifie jamais son entrée et ne lève jamais d'exception pour une donnée fausse. La sortie est un nouvel objet qui contient ce qui a été vérifié. Une lecture garde au plus 1 000 issues : elle ajoute alors `schema.too_many_issues` et s'arrête, pour qu'un corps construit pour échouer coûte peu. Un tableau au-delà de `maxLength`, 1 000 000 sauf si vous en nommez un autre, reçoit cette seule issue, et ses éléments ne sont pas lus. Un schéma construit avec un argument faux (une borne qui n'est pas un nombre, deux options avec le même littéral) est un bug, et lève une `TypeError` à sa construction.

## Les bornes

| Schéma | Options | Issues |
|---|---|---|
| `string` | `minLength`, `maxLength`, en unités de code UTF-16 ; `pattern` | `schema.too_short`, `schema.too_long`, `schema.invalid_format` |
| `number` | `min`, `max`, tous deux inclus ; `integer` | `schema.too_small`, `schema.too_large`, `schema.not_integer` |
| `array` | `minLength`, `maxLength`, en éléments | `schema.too_small`, `schema.too_large` |

`number` ne prend que des nombres finis : `NaN` et les infinis donnent `schema.invalid_type`. Un `pattern` exige `maxLength` et n'est pas testé sur un texte qui le dépasse, pour ne rencontrer qu'un texte borné ; un motif à répétitions imbriquées peut quand même prendre un temps exponentiel, et c'est à vous de l'éviter. Pour compter ce qu'un lecteur voit, utilisez `graphemeLength` de [`@yaltaan/core/string`](string.md).

## Absent, `undefined` et `null`

Ce sont trois états, et un champ dit lesquels il accepte :

| Champ | Clé absente | `undefined` | `null` |
|---|---|---|---|
| `string()` | `schema.missing` | `schema.invalid_type` | `schema.invalid_type` |
| `optional(string())` | valide | valide | `schema.invalid_type` |
| `optional(string(), { exactOptional: true })` | valide | `schema.invalid_type` | `schema.invalid_type` |
| `nullable(string())` | `schema.missing` | `schema.invalid_type` | valide |
| `optional(nullable(string()))` | valide | valide | valide |
| `nullable(optional(string()))` | `schema.missing` | valide | valide |

La sortie garde l'état : une clé absente reste absente, et un `undefined` explicite reste là. Les types disent la même chose sous `exactOptionalPropertyTypes`.

```ts
import { object, optional, parse, string } from '@yaltaan/schema';

const profile = object({ nick: optional(string()) });

parse(profile, {}); // → { ok: true, value: {} }
parse(profile, { nick: undefined }); // → { ok: true, value: { nick: undefined } }
parse(profile, { nick: null }); // → { ok: false, error: [{ code: 'schema.invalid_type', path: ['nick'], params: { expected: 'string' } }] }
```

## Les clés que le schéma ne déclare pas

`strip`, le défaut, les retire : un champ ajouté par un serveur plus récent ne casse pas un client déployé. Sur une entrée non fiable, utilisez `reject` : chacune reçoit sa propre issue. `passthrough` les garde sans les vérifier ni les copier, sauf les clés `__proto__`, `constructor` et `prototype` de cet objet : une valeur gardée n'est pas parcourue, ne la fusionnez donc jamais en profondeur sans la vérifier.

```ts
import { object, parse, string } from '@yaltaan/schema';

const input: unknown = JSON.parse('{ "name": "Ada", "admin": true, "__proto__": { "polluted": true } }');
const entries = { name: string() };

parse(object(entries), input); // → { ok: true, value: { name: 'Ada' } }
parse(object(entries, { unknownKeys: 'passthrough' }), input); // → { ok: true, value: { name: 'Ada', admin: true } }
parse(object(entries, { unknownKeys: 'reject' }), input); // → { ok: false, error: [{ code: 'schema.unknown_key', path: ['admin'] }, { code: 'schema.unknown_key', path: ['__proto__'] }] }
```

`object` ne lit que les clés propres d'un objet simple. Un tableau, une `Date`, une `Map`, une instance de classe ou un objet d'un autre royaume (`iframe`, `vm`) donne `schema.invalid_type` au lieu de perdre son contenu, et une clé héritée d'un `Object.prototype` pollué ne satisfait rien.

## Plusieurs formes d'un même objet

`discriminatedUnion` choisit l'option par le littéral d'une clé, pour que les issues soient celles de la forme que la donnée dit avoir.

```ts
import { discriminatedUnion, literal, number, object, parse, string } from '@yaltaan/schema';

const payment = discriminatedUnion('by', [
  object({ by: literal('card'), pan: string({ minLength: 12 }) }),
  object({ by: literal('transfer'), days: number({ max: 60 }) }),
]);

parse(payment, { by: 'transfer', days: 30 }); // → { ok: true, value: { by: 'transfer', days: 30 } }
parse(payment, { by: 'card', pan: '42' }); // → { ok: false, error: [{ code: 'schema.too_short', path: ['pan'], params: { length: 2, minimum: 12 } }] }
parse(payment, { by: 'cash' }); // → { ok: false, error: [{ code: 'schema.invalid_value', path: ['by'], params: { expected: ['card', 'transfer'] } }] }
```

## Dans un moteur de formulaire

Chaque schéma implémente Standard Schema version 1 : passez-le tel quel à `validateStandardSchema` d'Angular Signal Forms, ou aux validateurs de TanStack Form. La librairie n'écrit aucun message : un moteur lit le code comme message tant que vous ne lui donnez pas de mots, avec votre [formateur](issue.md), sur le seul schéma qu'il lit.

```ts
import { number, object, withMessages } from '@yaltaan/schema';

const order = object({ quantity: number({ min: 1 }) });
const worded = withMessages(order, (issue) => (issue.code === 'schema.too_small' ? 'Order at least one.' : 'Invalid.'));

order['~standard'].validate({ quantity: 0 }); // → { issues: [{ message: 'schema.too_small', path: ['quantity'] }] }
worded['~standard'].validate({ quantity: 0 }); // → { issues: [{ message: 'Order at least one.', path: ['quantity'] }] }
```

## Ce qu'il ne fait pas encore

Les raffinements, les transformations, `record`, `tuple`, `union`, la récursion et les options pour les limites viendront dans des versions suivantes ; une lecture prend un temps linéaire dans l'entrée qu'elle parcourt. La [feuille de route](../../../ROADMAP.md) a leurs tickets.
