# Issues : une seule forme d'erreur pour tout

`import { fromStandardIssue, toStandardIssue, type Issue, type IssueFormatter } from '@yaltaan/core/issue';`

## Le problème

Un parseur rend un format d'erreur, une librairie de validation un autre, le serveur un troisième, et l'application écrit du code de colle pour les afficher tous à côté du bon champ, dans la bonne langue. Chaque librairie livre aussi ses propres messages, en anglais, qu'il faut ensuite traduire ou remplacer.

## La forme

Tout échec de Yaltaan est une `Issue` :

| Champ | Contient | Exemple |
|---|---|---|
| `code` | Un code stable, `<espace>.<nom>` : ce sur quoi on s'appuie pour choisir un message. | `'path.syntax'` |
| `path` | Où se trouve l'issue, sous forme de [`Path`](path.md) ; vide pour la valeur entière. | `['lines', 2, 'quantity']` |
| `params` | Les données qui servent à construire un message. | `{ index: 6 }` |
| `severity` | `'error'` (en son absence) bloque ; `'warning'` s'affiche sans bloquer. | `'warning'` |
| `cause` | Ce qui l'a provoquée, pour qui a besoin de plus que le code. | la réponse du serveur |

```ts
import type { Issue } from '@yaltaan/core/issue';
import { parsePath } from '@yaltaan/core/path';

const read = parsePath('lines[2]quantity');
const issue: Issue | undefined = read.ok ? undefined : read.error;
issue?.code; // → 'path.syntax'
issue?.params; // → { index: 8 }
```

Les codes sont un contrat public : un code n'est jamais renommé, et n'est retiré que dans une version majeure. Chaque paquet liste ses codes dans un registre vérifié à chaque changement : [`@yaltaan/core`](../../issue-codes/core.md).

## Vos messages, dans vos langues : le formateur

Yaltaan n'écrit aucun message. Vous écrivez une fonction `(issue) => string` une fois par langue, et toutes les erreurs de toutes les couches passent par elle. Les exemples ci-dessous sont en anglais ; pour le français, remplacez simplement les textes.

```ts
import type { IssueFormatter } from '@yaltaan/core/issue';

type Params = Readonly<Record<string, unknown>>;
const messages = new Map<string, (params: Params) => string>([
  ['path.syntax', (params) => `Unreadable path at character ${String(params['index'])}.`],
  ['schema.too_small', (params) => `At least ${String(params['minimum'])}.`],
]);
const format: IssueFormatter = (issue) => messages.get(issue.code)?.(issue.params ?? {}) ?? 'Invalid value.';

format({ code: 'schema.too_small', path: ['quantity'], params: { minimum: 1 } }); // → 'At least 1.'
format({ code: 'shop.out_of_stock', path: [] }); // → 'Invalid value.'
```

Une `Map` (ou `Object.hasOwn`) compte : avec un objet simple, le code `toString` trouverait la fonction dont hérite tout objet. Un formateur anglais complet, à copier, se trouve dans [`examples/recipes/format-issue-en.ts`](../../../examples/recipes/format-issue-en.ts) ; son test échoue dès qu'un registre liste un code sans message.

## Vers un moteur de formulaire : `toStandardIssue`

Angular Signal Forms, TanStack Form et react-hook-form lisent les erreurs au format Standard Schema : un message et un chemin de noms de propriétés. `toStandardIssue` le construit avec votre formateur.

```ts
import { toStandardIssue, type Issue, type ToStandardIssueOptions } from '@yaltaan/core/issue';

const lines = [{ id: 'a7' }, { id: 'b2' }];
const options: ToStandardIssueOptions = {
  format: (issue) => issue.code,
  resolveKey: (segment) => lines.findIndex((line) => line.id === segment.key),
};
const issue: Issue = { code: 'schema.too_small', path: ['lines', { key: 'b2' }, 'quantity'] };

toStandardIssue(issue, options); // → { message: 'schema.too_small', path: ['lines', 1, 'quantity'] }
toStandardIssue({ code: 'rules.at_least', path: [] }, options); // → { message: 'rules.at_least' }
```

Un moteur de formulaire ne connaît pas les [segments `{ key }`](path.md#suivre-un-élément-de-liste-quand-il-bouge--key-) : `resolveKey` donne l'index de l'élément au moment de la conversion. Quand l'élément a disparu (ou sans `resolveKey`), le chemin s'arrête avant lui et l'erreur s'affiche sur la liste, jamais sur un champ qui n'existe pas.

```ts
import { toStandardIssue } from '@yaltaan/core/issue';

const gone = { code: 'schema.too_small', path: ['lines', { key: 'zz' }, 'quantity'] };
toStandardIssue(gone, { format: (issue) => issue.code }); // → { message: 'schema.too_small', path: ['lines'] }
```

## Depuis un autre validateur : `fromStandardIssue`

Les issues de zod, valibot, arktype ou de tout validateur Standard Schema deviennent des issues Yaltaan de code `issue.external` : leur message est gardé dans `params.message`, l'issue d'origine dans `cause`.

```ts
import { fromStandardIssue } from '@yaltaan/core/issue';

const issue = fromStandardIssue({ message: 'Too short', path: [{ key: 'name' }] });
issue.code; // → 'issue.external'
issue.path; // → ['name']
issue.params.message; // → 'Too short'
```

Votre formateur affiche alors ce message tel quel, ou le remplace en lisant `cause`.

## Bon à savoir

- La conversion ne copie rien quand le chemin n'a pas de segment `{ key }` : le même tableau est réutilisé.
- `format` doit rendre une chaîne, et `resolveKey` un index, -1 ou `undefined` : tout le reste est un bogue du code appelant et lève une `TypeError`.
- Environ 500 octets (minifiés et compressés en brotli) pour les deux conversions ; le type `Issue` seul ne coûte rien.
