# Résultats : échouer sans exception

`import { err, mapResult, ok, unwrapOr, type Result } from '@yaltaan/core/result';`

## Le problème

Une fonction qui lit une saisie échoue souvent, et c'est normal : un champ vide, un mot là où on attendait un nombre. Lever une exception pour ça cache l'échec au système de types (rien ne dit à l'appelant de le traiter) et coûte une pile d'appels à chaque fois. Rendre `null` cache la raison de l'échec.

## Ce que vous écrivez

Une fonction qui peut échouer rend un `Result` : soit `{ ok: true, value }`, soit `{ ok: false, error }`. Le type dit que les deux cas existent, et le compilateur oblige l'appelant à regarder `ok` avant d'atteindre la valeur.

```ts
import { err, ok, type Result } from '@yaltaan/core/result';

function parseQuantity(text: string): Result<number, 'not_a_whole_number'> {
  const quantity = Number(text);
  return text !== '' && Number.isSafeInteger(quantity) ? ok(quantity) : err('not_a_whole_number');
}

parseQuantity('12'); // → { ok: true, value: 12 }
parseQuantity('twelve'); // → { ok: false, error: 'not_a_whole_number' }
```

## Lire un résultat

Testez `ok` : dans chaque branche, TypeScript sait quel côté vous tenez.

```ts
import { err, ok, type Result } from '@yaltaan/core/result';

function describe(result: Result<number, string>): string {
  return result.ok ? `quantity ${result.value}` : `refused: ${result.error}`;
}

describe(ok(3)); // → 'quantity 3'
describe(err('empty')); // → 'refused: empty'
```

## Transformer et se replier

`mapResult` change la valeur d'un succès et laisse passer un échec tel quel ; `unwrapOr` donne la valeur, ou une valeur de repli.

```ts
import { err, mapResult, ok, unwrapOr } from '@yaltaan/core/result';

mapResult(ok(12), (quantity) => quantity * 2); // → { ok: true, value: 24 }
mapResult(err('empty'), (quantity: number) => quantity * 2); // → { ok: false, error: 'empty' }
unwrapOr(err('empty'), 1); // → 1
```

## Bon à savoir

- Un résultat est un objet simple : il se sérialise en JSON, traverse un `postMessage` et se compare avec `deepEqual` dans les tests.
- Il n'a pas de méthodes (`result.map(...)`) : un bundler peut retirer une fonction que vous n'importez pas, jamais une méthode. L'import reste ainsi autour de 120 octets.
- Les objets sont en lecture seule par leur type, pas gelés : les geler coûterait du temps à chaque appel.
- Dans le reste de Yaltaan, le côté erreur d'un résultat est une [`Issue`](issue.md).
