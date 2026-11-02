# Règles : ce qui vaut entre les champs

`import { allOrNone, anyElement, assertDeclaredReads, atLeast, checkRules, each, exactly, mutuallyExclusive, ordered, refine, requiredIf, requiredPaths, unique } from '@yaltaan/rules';`

## Le problème

Un schéma lit un champ à la fois. Ce qu'un formulaire exige vraiment passe d'un champ à l'autre : un SIREN pour une société française, un numéro de contrat et sa date ensemble ou pas du tout, au moins un contact de facturation, jamais deux produits de même référence. Écrites en `if` après le schéma, ces règles ignorent tout du formulaire, répètent ce qui rend un champ requis, et aucun autre moteur ne peut les reprendre.

```mermaid
flowchart LR
  values["Ce que la personne a saisi"] --> schema["N'importe quel Standard Schema"]
  schema -->|"une valeur acceptée"| rules["Vos règles"]
  rules -->|"Issue : code, chemin"| field["Un message près du champ"]
  rules -->|"requiredPaths"| mark["Le champ marqué comme requis"]
```

## Ce que vous écrivez

Construisez les règles par des fonctions, et lancez-les par `checkRules` : toutes les issues, chacune sur le champ à marquer. `requiredPaths` déduit les champs que ces valeurs exigent, qu'aucune règle n'écrit jamais.

```ts
import { allOrNone, atLeast, checkRules, mutuallyExclusive, ordered, requiredIf, requiredPaths } from '@yaltaan/rules';

const rules = [
  // Un SIREN pour une société française.
  requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']]),
  mutuallyExclusive([['siren'], ['foreignNumber']]),
  allOrNone([['contract'], ['signedOn']]),
  atLeast(1, [['phone'], ['email']]),
  ordered(['from'], ['to']),
];

const values = { country: 'FR', foreignNumber: 'X1', contract: 'C-1', phone: '01', from: '2026-11-02', to: '2026-01-01' };

checkRules(rules, values); // → [{ code: 'rules.required_if', path: ['siren'] }, { code: 'rules.all_or_none', path: ['signedOn'] }, { code: 'rules.ordered', path: ['to'] }]
requiredPaths(rules, values); // → [['siren'], ['signedOn']]
checkRules(rules, { country: 'DE', from: 1, to: 2, email: 'a@b' }); // → []
```

Une règle ne garde aucun état et n'écrit rien. `requiredPaths` ne nomme un champ que lorsque la règle ne peut pas tenir sans lui : `atLeast(1, [a, b])` avec les deux vides n'en exige aucun, et `checkRules` marque quand même les deux.

| Règle | Ce qui reçoit l'issue |
|---|---|
| `requiredIf` | chaque champ vide, tant que la condition tient |
| `allOrNone` | chaque champ vide, quand certains sont remplis |
| `atLeast` | chaque champ vide, ou la liste |
| `exactly` | chaque champ vide sous le compte, chaque champ rempli au-dessus, ou la liste |
| `mutuallyExclusive` | chaque champ rempli, quand il y en a deux ou plus |
| `unique` | tout élément qui partage une clé |
| `ordered` | la fin, quand elle précède le début |

Un champ est vide s'il est absent, `undefined`, `null`, une chaîne vide ou un tableau vide. `0` et `false` sont des valeurs, une chaîne d'espaces aussi : un schéma la nettoie d'abord. Une valeur se lit par les clés propres seulement : un champ nommé `toString` est vide tant que l'objet n'a pas le sien. `ordered` compare les nombres et les bigints par valeur, les dates par leur instant et les chaînes par unité de code, l'ordre des dates ISO 8601 ; `compare` sert au reste, comme Temporal. Deux valeurs qu'il ne sait pas comparer reçoivent l'issue : une règle qui ne sait pas dire ne laisse pas passer.

## Les listes

`each` applique des règles à chaque élément, comme si l'élément était les valeurs, et une issue revient avec le chemin de l'élément devant ; les listes s'imbriquent. `identity` nomme le champ qui porte la clé stable d'un élément : le chemin dit alors `{ key }`, et une issue suit son élément quand la liste est réordonnée. Un compte sur une liste prend `{ list, at, where }`, et marque la liste.

```ts
import { atLeast, checkRules, each, exactly, requiredIf, unique } from '@yaltaan/rules';

const lowerCase = (text: unknown): unknown => (typeof text === 'string' ? text.toLowerCase() : text);
const taxed = requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['rate']]);

const rules = [
  each(['products'], [taxed], { identity: ['key'] }),
  unique(['products'], ['reference'], { by: lowerCase, identity: ['key'] }),
  atLeast(1, { list: ['contacts'], at: ['billing'], where: (billing) => billing === true }),
  exactly(1, { list: ['contacts'], at: ['primary'], where: (primary) => primary === true }),
];

const values = {
  products: [
    { key: 'p1', reference: 'A-1', taxable: true },
    { key: 'p2', reference: 'a-1', taxable: false },
  ],
  contacts: [{ billing: true, primary: false }],
};

checkRules(rules, values); // → [{ code: 'rules.required_if', path: ['products', { key: 'p1' }, 'rate'] }, { code: 'rules.unique', path: ['products', { key: 'p1' }, 'reference'] }, { code: 'rules.unique', path: ['products', { key: 'p2' }, 'reference'] }, { code: 'rules.exactly', path: ['contacts'], params: { expected: 1, count: 0 } }]
```

Un élément dont le champ `identity` est absent ou vide est nommé par son indice. Un rappel (`by`, `where`, `compare`) ne rencontre jamais une valeur vide, pour qu'une ligne tout juste ajoutée ne fasse pas planter un validateur, et ce qu'il reçoit est typé `unknown`, puisqu'un formulaire peut tout contenir. `unique` compare par SameValueZero, une chaîne sur ses 16 000 premières unités de code, et une valeur vide n'est pas comparée : un champ encore vide relève d'une autre règle.

## Dans n'importe quel moteur de formulaire

`refine` place des règles derrière n'importe quel Standard Schema : le schéma lit d'abord, et les règles ne voient qu'une valeur qu'il a acceptée. Le résultat est un Standard Schema, asynchrone si le schéma l'est, qu'Angular Signal Forms, TanStack Form ou tout autre moteur prend tel quel.

```ts
import { atLeast, refine } from '@yaltaan/rules';
import { object, optional, string } from '@yaltaan/schema';

const contact = refine(object({ phone: optional(string()), email: optional(string()) }), [atLeast(1, [['phone'], ['email']])], {
  format: (issue) => `Check this field: ${issue.code}`,
});

contact['~standard'].validate({ phone: '01' }); // → { value: { phone: '01' } }
contact['~standard'].validate({}); // → { issues: [{ message: 'Check this field: rules.at_least', path: ['phone'] }, { message: 'Check this field: rules.at_least', path: ['email'] }] }
```

Le message d'une issue est son code tant que `format` ne lui donne pas vos mots. Un `warning` ne bloque rien, et l'interface ne connaît aucune autre sorte d'issue : il reste dehors, pour que `checkRules` le montre. Un chemin Standard Schema contient des noms de propriété et des indices : un `{ key }` a besoin de `resolveKey`, qui reçoit la valeur de cette lecture, sinon l'issue s'arrête à la liste ; un moteur qui affiche les erreurs sur les éléments reçoit donc `each` sans `identity`, ou `resolveKey`.

## Une règle à vous

Une règle est un objet simple : ce qu'elle lit, où elle marque, et ce qu'elle dit de valeurs données. Dans vos tests, `assertDeclaredReads` la lance sur une vue des valeurs qui note chaque lecture et refuse chaque écriture, et lève une erreur si elle a lu ce qu'elle n'a pas déclaré.

```ts
import { assertDeclaredReads, checkRules, each, type Rule } from '@yaltaan/rules';

const firstAboveMinimum: Rule = {
  reads: [['minimum'], ['tiers', 0, 'from']],
  targets: [['tiers', 0, 'from']],
  check: (values) => {
    const { minimum, tiers } = values as { minimum: number; tiers: readonly { from: number }[] };
    return (tiers[0]?.from ?? minimum) < minimum ? [{ code: 'app.first_tier', path: ['tiers', 0, 'from'] }] : [];
  },
};

const value = { minimum: 10, tiers: [{ from: 5 }] };

checkRules([firstAboveMinimum], value); // → [{ code: 'app.first_tier', path: ['tiers', 0, 'from'] }]
checkRules([each(['products'], [firstAboveMinimum])], { products: [value] }); // → [{ code: 'app.first_tier', path: ['products', 0, 'tiers', 0, 'from'] }]

assertDeclaredReads(firstAboveMinimum, value);
const liar: Rule = { reads: [['a']], targets: [], check: (values) => ((values as { b?: unknown }).b === 1 ? [] : []) };
let said = '';
try {
  assertDeclaredReads(liar, { b: 1 });
} catch (error) {
  said = String(error);
}
said; // → 'Error: the rule reads what it does not declare: b'
```

`assertDeclaredReads` voit ce que fait une exécution : ni une branche que ces valeurs ne prennent pas, ni ce que lit une fermeture, ni l'intérieur d'une `Date`, d'une `Map` ou d'une instance de classe, ni une décision sur une valeur qu'un chemin déclaré ne fait que traverser. Une règle fournie ne rencontre que les valeurs des chemins qu'elle déclare, et n'a pas besoin de ce test.

## Ce qu'une entrée peut coûter

Une vérification garde au plus 1 000 erreurs : elle ajoute alors `rules.too_many_issues`, à la racine, et s'arrête. Un avertissement ne compte pas et n'arrête rien, et les 1 000 premiers sont gardés ; `requiredPaths` s'arrête à 1 000 chemins sans rien dire, puisqu'il dit seulement quoi afficher et que `checkRules` décide. Une liste de plus de 1 000 000 d'éléments reçoit `rules.too_large`, sans qu'aucun élément soit lu. Le reste du travail est linéaire en nombre d'éléments d'une valeur qui ne partage aucune liste, comme tout JSON, et la profondeur est celle de vos règles.

## Voir aussi

- [Issues](issue.md)
- [Schémas](schema.md)
- [Référence](../../reference/rules.md), [codes d'issue](../../issue-codes/rules.md)
- [Pourquoi il est construit ainsi](../../adr/0034-rules-package.md)
