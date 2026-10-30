# Collections par clé : séparer, indexer, compter, dédoublonner, comparer

`import { partition, indexBy, countBy, uniqueBy, intersectionBy, differenceBy } from '@yaltaan/core/collection';`

## Le problème

La plateforme groupe (`Map.groupBy`) et filtre, mais s'arrête là. Indexer une liste par identifiant avec `new Map(list.map((x) => [x.id, x]))` perd un élément sans rien dire quand deux partagent un identifiant. Compter avec `Map.groupBy` construit chaque groupe pour n'en garder qu'un nombre. Dédoublonner par un champ, ou garder les lignes d'une liste dont l'identifiant figure dans une autre, est une boucle réécrite dans chaque projet. Et les librairies qui le font rendent des objets, où la clé `1` et la clé `'1'` ne font qu'une, et où une clé `"__proto__"` change le prototype du résultat.

## Séparer et indexer

```ts
import { indexBy, partition } from '@yaltaan/core/collection';

partition([1, 2, 3, 4, 5], (n) => n % 2 === 0); // → [[2, 4], [1, 3, 5]]

const users = [
  { id: 7, name: 'Ada' },
  { id: 9, name: 'Grace' },
];
indexBy(users, (user) => user.id).ok; // → true
indexBy([{ id: 1 }, { id: 2 }, { id: 1 }], (item) => item.id); // → { ok: false, error: { code: 'collection.duplicate_key', path: [2], params: { first: 0 } } }
```

`indexBy` rend un `Result` : une clé vue deux fois est un fait des données, signalé avec la position des deux éléments, jamais un élément remplacé en silence. Un prédicat qui est une garde de type affine les deux côtés de `partition`.

## Compter et dédoublonner

```ts
import { countBy, uniqueBy } from '@yaltaan/core/collection';

countBy(['apple', 'avocado', 'banana'], (word) => word[0]).get('a'); // → 2
countBy([1, '1', 1], (item) => item).size; // → 2
uniqueBy([1.2, 1.7, 2.1], Math.floor); // → [1.2, 2.1]
uniqueBy([0, -0], (n) => n, { equality: 'SameValue' }); // → [0, -0]
```

Les clés sont des valeurs quelconques, comparées comme une `Map` les compare (SameValueZero : `NaN` égale `NaN`, `0` égale `-0`), et les résultats qui portent des clés sont des `Map`, dans l'ordre de première apparition. `uniqueBy` garde le premier élément de chaque clé.

## Comparer deux collections

```ts
import { differenceBy, intersectionBy } from '@yaltaan/core/collection';

const cart = [{ sku: 'A' }, { sku: 'B' }, { sku: 'A' }];
const outOfStock = [{ sku: 'A' }];
intersectionBy(cart, outOfStock, (line) => line.sku); // → [{ sku: 'A' }, { sku: 'A' }]
differenceBy(cart, outOfStock, (line) => line.sku); // → [{ sku: 'B' }]
```

Chaque élément de la première collection est gardé ou écarté pour lui-même : les doublons restent, et les deux résultats coupent toujours la première collection en deux.

## Bon à savoir

- Chaque fonction prend n'importe quel itérable (un tableau, un `Set`, un générateur, une chaîne) et le lit une fois, dans l'ordre ; les trous d'un tableau se lisent `undefined`.
- Le rappel reçoit l'élément et sa position, jamais la collection.
- Une clé objet se compare par identité, comme dans une `Map` : la ramener à une primitive (`(user) => user.id`) pour comparer par valeur.
