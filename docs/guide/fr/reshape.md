# Fusionner et transformer des objets : merge, defaults, mapValues, mapKeys

`import { merge, defaults, mapValues, mapKeys } from '@yaltaan/core/object';`

## Le problème

Les réglages s'écrivent par couches (ceux du produit, puis ceux du client, puis ceux de l'utilisateur), et un objet d'options arrive avec des trous qu'une valeur par défaut doit combler. Une décomposition `{ ...base, ...overrides }` ne fusionne qu'un niveau : `{ ...defaults, retry: { delay: 500 } }` perd `retry.count`. Les fusions profondes habituelles modifient leur premier argument, décident seules du sort des tableaux, et écrivent une clé `"__proto__"` d'un JSON lu dans un prototype.

## merge : des surcharges posées sur une base

Deux objets simples sont fusionnés champ par champ, à toute profondeur, les champs de `overrides` l'emportant. Tout le reste vaut `overrides` lui-même, même `undefined`, comme le fait une décomposition. Vous choisissez le sort des tableaux : `'replace'` prend le tableau des surcharges entier, `'concat'` met les deux bout à bout. Il n'y a pas de valeur par défaut : qui lit l'appel sait laquelle s'applique.

```ts
import { merge } from '@yaltaan/core/object';

const product = { retry: { count: 3, delay: 100 }, hosts: ['eu.example.com'] };
const customer = { retry: { delay: 500 }, hosts: ['us.example.com'] };
merge(product, customer, { arrays: 'replace' }); // → { retry: { count: 3, delay: 500 }, hosts: ['us.example.com'] }
merge(product, customer, { arrays: 'concat' }); // → { retry: { count: 3, delay: 500 }, hosts: ['eu.example.com', 'us.example.com'] }
merge(product, { retry: undefined }, { arrays: 'replace' }); // → { retry: undefined, hosts: ['eu.example.com'] }
```

Aucune des deux valeurs ne change : le résultat est neuf partout où les deux côtés avaient un objet, et partage tout le reste avec elles.

## defaults : combler ce qui manque

`defaults(value, fallback)` garde ce que `value` contient et prend dans `fallback` ce qui lui manque : un champ absent, ou qui vaut `undefined`, à toute profondeur où les deux sont des objets. `undefined` lui-même donne `fallback` : des options facultatives se passent de `?? {}`. Comme une valeur par défaut dans une déstructuration, `null` est une valeur et reste ; un tableau aussi est une valeur, jamais mis bout à bout.

```ts
import { defaults } from '@yaltaan/core/object';

const DEFAULTS = { retry: { count: 3, delay: 100 }, verbose: false };
defaults({ retry: { count: 5 } }, DEFAULTS); // → { retry: { count: 5, delay: 100 }, verbose: false }
defaults({ retry: { count: undefined }, verbose: null }, DEFAULTS); // → { retry: { count: 3, delay: 100 }, verbose: null }
defaults(undefined, DEFAULTS); // → DEFAULTS
```

`defaults(value, fallback)` donne les mêmes champs que `merge(fallback, value, { arrays: 'replace' })` quand aucun champ de `value` ne vaut `undefined` ; le résultat garde le prototype et l'ordre des champs de `value`.

## mapValues et mapKeys : d'un objet à un autre

```ts
import { mapKeys, mapValues } from '@yaltaan/core/object';

const stock = { apples: 3, pears: 5 };
mapValues(stock, (count) => count * 2); // → { apples: 6, pears: 10 }
mapValues(stock, (count, fruit) => `${fruit}: ${count}`); // → { apples: 'apples: 3', pears: 'pears: 5' }
mapKeys({ first_name: 'Ada', last_name: 'Lovelace' }, (key) => key.replace('_n', 'N')); // → { firstName: 'Ada', lastName: 'Lovelace' }
mapKeys({ Accept: 'a', accept: 'b' }, (key) => key.toLowerCase()); // → { accept: 'b' }
```

`mapValues` garde les clés et leurs types : `mapValues(stock, …)` a les champs `apples` et `pears`, rien d'autre. Quand `mapKeys` donne le même nom à deux champs, le dernier l'emporte, comme avec `Object.fromEntries` : ne renommer que lorsque les nouveaux noms ne peuvent pas se rencontrer, ou quand perdre la valeur précédente est voulu.

## Les lois qu'elles respectent

Chacune vaut pour toute valeur, et les tests la vérifient sur des milliers de valeurs tirées au hasard, clés `"__proto__"` et objets sans prototype compris :

- `merge(x, {}, o)` et `merge({}, x, o)` ont les champs de `x` ; `merge(x, x, { arrays: 'replace' })` aussi.
- `merge(merge(a, b, o), c, o)` égale `merge(a, merge(b, c, o), o)` quand `a`, `b` et `c` ont des objets aux mêmes endroits.
- `mapValues(x, (v) => v)` est une copie de `x` ; appliquer `f` puis `g` égale appliquer une fois `g` après `f`.
- `mapKeys(mapKeys(x, (k) => p + k), (k) => k.slice(p.length))` rend `x`.
- Aucun appel ne modifie ses arguments, et aucune clé des données n'atteint un prototype.

## Ce qui est parcouru, et ce qui est pris entier

Comme pour [choisir des champs](object.md) : les objets simples (et ceux d'`Object.create(null)`) sont parcourus par leurs clés texte propres et énumérables, les clés symboles seulement avec `{ symbols: true }` ; les tableaux sont mis bout à bout ou remplacés, jamais parcourus ; tout le reste (`Map`, `Set`, dates, instances de classe) est une valeur prise entière. Une copie garde le prototype de son objet, une clé `"__proto__"` reste une clé, et chaque accesseur est lu une fois. `mapValues` et `mapKeys` ne prennent qu'un objet simple, et lèvent une `TypeError` pour toute autre valeur.

## Ce que ça coûte

Minifié puis compressé par brotli : `merge` environ 520 octets (`toMerged` d'es-toolkit, qui ne modifie pas non plus son argument, 1 446), `defaults` environ 410 (`defaultsDeep` d'es-toolkit, compatible lodash, 463), `mapValues` environ 380 et `mapKeys` environ 420, les quatre ensemble environ 740. `mapValues` et `mapKeys` coûtent plus qu'une simple boucle (celles d'es-toolkit pèsent environ 105) : les octets en plus gardent le prototype, refusent `"__proto__"` comme prototype et vérifient l'entrée.
