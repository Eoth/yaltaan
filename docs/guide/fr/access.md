# Lire et écrire par chemin : get, has, set, update, remove

`import { get, has, set, update, remove } from '@yaltaan/core/object';`

## Le problème

Un chemin arrive souvent comme une donnée : le champ d'une erreur du serveur, le contrôle d'un formulaire, une ligne d'un rapport d'import. Le lire par `a?.b?.[0]` demande que le chemin soit écrit dans le code ; l'écrire, c'est une décomposition par niveau, à la main. Les fonctions habituelles répondent `undefined` aussi bien pour un champ absent que pour un champ qui vaut `undefined`, modifient l'objet qu'on leur donne, et créent des trous dans les tableaux quand un index dépasse la fin.

## get et has : lire, et savoir pourquoi il n'y a rien

`get` rend un `Result` : la valeur, ou une issue qui dit où le parcours s'est arrêté. Un champ qui vaut `undefined` est une valeur ; un champ absent n'en est pas une.

```ts
import { get, has } from '@yaltaan/core/object';

const order = { lines: [{ sku: 'A1', qty: 2 }], note: undefined };
get(order, ['lines', 0, 'qty']); // → { ok: true, value: 2 }
get(order, ['note']); // → { ok: true, value: undefined }
get(order, ['lines', 3, 'qty']); // → { ok: false, error: { code: 'path.missing', path: ['lines', 3, 'qty'], params: { index: 1 } } }
get(order, ['lines', 0, 'qty', 'unit']); // → { ok: false, error: { code: 'path.not_traversable', path: ['lines', 0, 'qty', 'unit'], params: { index: 3 } } }
has(order, ['note']); // → true
```

`path.missing` signifie que le conteneur est là mais ne tient rien à ce segment ; `path.not_traversable`, que la valeur à cet endroit ne se parcourt pas par ce segment. `index` est le segment où le parcours s'est arrêté.

## set, update, remove : une copie où un seul endroit change

Une écriture copie les objets et les tableaux le long du chemin et partage tout le reste. Rien n'est jamais modifié sur place : des données gelées conviennent, et une écriture qui ne change rien rend la valeur elle-même.

```ts
import { remove, set, update } from '@yaltaan/core/object';

const form = { user: { name: 'Ada' }, tags: ['a', 'b', 'c'] };
set(form, ['user', 'name'], 'Grace'); // → { ok: true, value: { user: { name: 'Grace' }, tags: ['a', 'b', 'c'] } }
set(form, ['tags', 3], 'd'); // → { ok: true, value: { user: { name: 'Ada' }, tags: ['a', 'b', 'c', 'd'] } }
update(form, ['tags'], (tags) => (tags as string[]).length); // → { ok: true, value: { user: { name: 'Ada' }, tags: 3 } }
remove(form, ['tags', 1]); // → { ok: true, value: { user: { name: 'Ada' }, tags: ['a', 'c'] } }
```

`set` peut ajouter le dernier segment : un champ nouveau, ou l'index égal à la longueur d'un tableau (un ajout en fin). Tout autre segment absent échoue, sauf si vous demandez sa création : `createMissing: 'object'` crée des objets, `'array-if-numeric'` un tableau là où le segment suivant est un nombre. Aucune écriture ne crée de trou : un index au-delà de la fin échoue.

```ts
import { set, update } from '@yaltaan/core/object';

set({}, ['address', 'city'], 'Lyon'); // → { ok: false, error: { code: 'path.missing', path: ['address', 'city'], params: { index: 0 } } }
set({}, ['address', 'city'], 'Lyon', { createMissing: 'object' }); // → { ok: true, value: { address: { city: 'Lyon' } } }
set({}, ['lines', 0, 'qty'], 1, { createMissing: 'array-if-numeric' }); // → { ok: true, value: { lines: [{ qty: 1 }] } }
update({}, ['visits'], (n) => ((n as number | undefined) ?? 0) + 1, { createMissing: 'object' }); // → { ok: true, value: { visits: 1 } }
```

## Des éléments par identité : le segment { key }

Un index change quand on trie une liste ou qu'on en retire un élément. Un segment `{ key }` désigne l'élément dont la clé, lue par votre `keyOf`, est cette clé.

```ts
import { get, remove } from '@yaltaan/core/object';

const cart = { lines: [{ id: 'x', qty: 2 }, { id: 'y', qty: 5 }] };
const keyOf = (line: unknown) => (line as { id: string }).id;
get(cart, ['lines', { key: 'y' }, 'qty'], { keyOf }); // → { ok: true, value: 5 }
remove(cart, ['lines', { key: 'x' }], { keyOf }); // → { ok: true, value: { lines: [{ id: 'y', qty: 5 }] } }
```

## Ce que désigne un segment

- Une chaîne ou un symbole nomme un champ propre et énumérable d'un objet simple (`Object.create(null)` compris) : jamais un champ hérité comme `toString`.
- Un nombre est un index d'un tableau simple ; `'0'` sur un tableau, ou `0` sur un objet, ne désigne rien. Un chemin lu par `parsePath` n'a qu'une forme par segment : cela ne compte que pour un chemin construit à la main.
- `Map`, `Set`, les dates, les instances de classe et les primitives ne se parcourent pas.
- `__proto__`, `constructor` et `prototype` sont refusés à l'écriture, avec l'issue `path.forbidden_segment`.
- Retirer un élément d'un tableau le sort du tableau : les éléments suivants descendent d'un index.

Le résultat de `set`, `update` et `remove` a le type de la valeur donnée : le compilateur ne suit pas le chemin, c'est vous qui garantissez que l'écriture garde sa forme.

## Les lois qu'elles tiennent

Chacune vaut pour toute valeur et tout chemin, vérifiée sur des milliers de cas générés et comparée aux fonctions compatibles lodash d'es-toolkit :

- `get(set(x, p, v).value, p)` vaut `v` ; chaque branche que le chemin ne suit pas est le même objet qu'avant.
- `update(x, p, (v) => v)` et `set(x, p, get(x, p).value)` rendent `x` lui-même.
- `has(x, p)` vaut `get(x, p).ok` ; en cas d'échec, le chemin jusqu'à `index` existe et le segment suivant non.
- Aucun appel ne modifie ce qu'on lui donne.

## Ce que cela coûte

Minifié et compressé par brotli : `get` seul environ 570 octets (le `get` compatible lodash d'es-toolkit, 780), `set` seul environ 1 320 (le `set` d'es-toolkit, 1 174, qui modifie son argument), les cinq ensemble environ 1 430 (les cinq d'es-toolkit, 1 483).
