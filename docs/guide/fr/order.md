# Collections par ordre : le plus petit, les k premiers, trier, paginer

`import { minBy, maxBy, topK, sortBy, paginate } from '@yaltaan/core/collection';`

## Le problème

La plateforme trie (`toSorted`), mais chaque étape autour s'écrit à la main. Trouver l'offre la moins chère trie toute la liste pour garder un élément. Garder les dix meilleurs scores d'un long flux garde tout le flux en mémoire. Un tri sur plusieurs champs est une chaîne de `||` dans un comparateur qui appelle chaque clé deux fois par comparaison, et se trompe sur `NaN`, `null` et `undefined` faute de soin : un comparateur qui dit `NaN` égal à tout nombre n'est plus un ordre, et la liste peut revenir non triée. Et une page d'un tableau est un `slice` plus le calcul du nombre de pages, réécrits dans chaque projet.

## Le plus petit et le plus grand

```ts
import { maxBy, minBy } from '@yaltaan/core/collection';

const offers = [
  { shop: 'A', price: 30 },
  { shop: 'B', price: 26 },
  { shop: 'C', price: Number.NaN },
];
minBy(offers, (offer) => offer.price)?.shop; // → 'B'
maxBy(offers, (offer) => offer.price)?.shop; // → 'A'
minBy([], (n: number) => n); // → undefined
```

À clés égales, le premier élément l'emporte. Une clé manquante (`undefined`, `null` ou `NaN`) n'est jamais choisie.

## Les k premiers

```ts
import { topK } from '@yaltaan/core/collection';

const scores = [12, 87, 45, 99, 60, 87];
topK(scores, 3, (a, b) => b - a); // → [99, 87, 87]
```

`topK(items, k, compare)` donne exactement `items.toSorted(compare).slice(0, k)`, les éléments égaux dans l'ordre d'entrée, mais ne garde que `k` éléments en mémoire : il lit un générateur ou un flux sans le garder en entier.

## Trier sur plusieurs clés

```ts
import { sortBy } from '@yaltaan/core/collection';

const people = [
  { name: 'Lin', age: 30 },
  { name: 'Ada', age: 26 },
  { name: 'Joe', age: 30 },
];
sortBy(people, [{ key: (person) => person.age, order: 'desc' }, (person) => person.name]).map((person) => person.name); // → ['Joe', 'Lin', 'Ada']

const words = ['zèbre', 'été', 'ete'];
sortBy(words, { key: (word) => word, compare: new Intl.Collator('fr').compare }); // → ['ete', 'été', 'zèbre']
```

Chaque clé est calculée une fois par élément, puis les éléments sont triés par le tri natif stable : les éléments égaux gardent leur ordre. Les nombres, `bigint` et booléens passent avant les chaînes, les chaînes se comparent par unité de code sauf si un critère donne un `compare` (un collator pour l'ordre d'une langue), et les clés manquantes viennent en dernier, dans les deux sens.

## Une page

```ts
import { paginate } from '@yaltaan/core/collection';

const rows = ['a', 'b', 'c', 'd', 'e'];
paginate(rows, { pageIndex: 1, pageSize: 2 }); // → { items: ['c', 'd'], pageIndex: 1, pageSize: 2, length: 5, pageCount: 3 }
paginate(rows, { pageIndex: 9, pageSize: 2 }).items; // → []
```

Les pages se numérotent à partir de 0, sous les noms du paginateur d'Angular Material : son événement de page se passe tel quel, et le résultat s'y relie (`length` est le nombre d'éléments de toute la collection). Un tableau n'est lu que sur la page.

## Bon à savoir

- Une clé est un nombre, un `bigint`, un booléen ou une chaîne ; tout le reste est une `TypeError`. Trier des dates par `date.getTime()`.
- Un comparateur incohérent (qui dit `a < b`, `b < c` et `c < a`) donne un ordre non spécifié, jamais une boucle sans fin ni une exception de notre part.
- Chaque fonction prend n'importe quel itérable et le lit une fois ; les trous d'un tableau se lisent `undefined`, que `topK`, comme `toSorted`, place en dernier sans appeler `compare`.
