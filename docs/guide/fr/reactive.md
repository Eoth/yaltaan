# Valeurs réactives : dériver sans état intermédiaire

`import { createGraph, type ReadableNode, type SourceNode } from '@yaltaan/core/reactive';`

## Le problème

Un formulaire est plein de valeurs qui dépendent d'autres : un total calculé depuis ses lignes, un champ requis dès qu'une case est cochée, un bouton actif quand tout est valide. Les recalculer à la main après chaque changement oublie un cas. Un événement par champ montre un écran à moitié à jour, le total changé et pas encore sa taxe. Les signaux d'un framework lient cette logique au framework, et son test à un composant.

## Ce que vous écrivez

Un graphe contient des sources, des valeurs que vous fixez, et des valeurs dérivées, chacune calculée depuis les nœuds qu'elle nomme. Une valeur dérivée ne calcule rien tant qu'on ne la lit pas, puis seulement quand une de ses dépendances a changé.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const quantity = graph.source(2);
const unitPrice = graph.source(15);
const total = graph.derived([quantity, unitPrice], (count, price) => count * price);

total.get(); // → 30
quantity.set(3);
total.get(); // → 45
```

## Suivre une valeur

`subscribe` appelle sa fonction d'écoute, sans argument, après une écriture qui a changé la valeur ; la fonction la lit avec `get`. Il rend la fonction qui l'arrête. À travers un losange, ici le total qui dépend du prix directement et par la taxe, l'écoute ne voit que l'état final : jamais le nouveau prix avec l'ancienne taxe.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const price = graph.source(100);
const rate = graph.source(0.25);
const tax = graph.derived([price, rate], (amount, share) => amount * share);
const total = graph.derived([price, tax], (amount, due) => amount + due);

const seen: number[] = [];
const stop = total.subscribe(() => seen.push(total.get()));
price.set(200);
seen; // → [250]
stop();
price.set(300);
seen; // → [250]
```

## Changer plusieurs valeurs d'un coup

`batch` retient les notifications des écritures que fait sa fonction jusqu'à ce qu'elle rende la main : chaque écoute est alors appelée une fois, sur les valeurs finales, puis seulement pour ce qu'une écoute écrit. Les lectures faites pendant le batch voient déjà ses écritures.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const first = graph.source('Ada');
const last = graph.source('Byron');
const full = graph.derived([first, last], (given, family) => `${given} ${family}`);

const seen: string[] = [];
full.subscribe(() => seen.push(full.get()));
graph.batch(() => {
  first.set('Augusta Ada');
  last.set('King');
});
seen; // → ['Augusta Ada King']
```

## Un calcul qui peut échouer

Un calcul qui échoue de façon attendue rend un [`Result`](result.md), comme toute fonction de Yaltaan. Un calcul qui lève une exception a un bogue : le nœud garde cette erreur, `get` la relève, et les nœuds qui en dépendent la relèvent aussi, jusqu'à ce qu'une dépendance change.

```ts
import { createGraph } from '@yaltaan/core/reactive';
import { err, ok } from '@yaltaan/core/result';

const graph = createGraph();
const text = graph.source('12');
const quantity = graph.derived([text], (typed) => (/^[0-9]+$/.test(typed) ? ok(Number(typed)) : err('not_a_number')));

quantity.get(); // → { ok: true, value: 12 }
text.set('twelve');
quantity.get(); // → { ok: false, error: 'not_a_number' }
```

## Décider de ce qui compte comme un changement

Une valeur est la même que la précédente au sens d'`Object.is`, sauf si une option `equals` en décide autrement : le nœud garde alors sa valeur actuelle, et personne n'est prévenu.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const amount = graph.source(1.2, { equals: (current, next) => Math.round(current) === Math.round(next) });

amount.set(1.4);
amount.get(); // → 1.2
amount.set(1.6);
amount.get(); // → 1.6
```

## Nommer chaque dépendance

Un calcul reçoit les valeurs des nœuds qu'il nomme, et rien d'autre : un autre nœud lu à l'intérieur, ou le sien, passerait inaperçu quand il change. Le graphe le refuse : `get`, `subscribe` ou `set` sur un nœud du même graphe pendant un calcul lève une `TypeError`, que le nœud garde comme son erreur. Nommez plutôt ce nœud parmi les dépendances.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const price = graph.source(10);
const rate = graph.source(0.2);
const unfollowed = graph.derived([price], (amount) => amount * rate.get());

let refused: unknown;
try {
  unfollowed.get();
} catch (error) {
  refused = error;
}
refused instanceof TypeError; // → true
const tax = graph.derived([price, rate], (amount, share) => amount * share);
tax.get(); // → 2
```

## Dans Angular et Vue

Un nœud a déjà ce qu'un framework demande à une valeur extérieure : un moyen de la lire, et un moyen d'être prévenu qu'elle a changé. Ces deux fonctions en font un signal Angular et une ref Vue ; copiez-les dans votre application. Les deux sont vérifiées avec Angular 22.2.4 et Vue 3.5.44.

Dans Angular, appelez `fromNode` dans un contexte d'injection, un constructeur ou l'initialisation d'un champ : l'abonnement finit avec le composant. Le signal suit le nœud, et lève ce que le nœud lève.

```ts angular
import { computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import type { ReadableNode } from '@yaltaan/core/reactive';

export function fromNode<T>(node: ReadableNode<T>): Signal<T> {
  const version = signal(0);
  inject(DestroyRef).onDestroy(node.subscribe(() => version.update((count) => count + 1)));
  return computed(() => {
    version();
    return node.get();
  });
}
```

Dans Vue, appelez `nodeRef` dans `setup()` ou dans un `effectScope` : l'abonnement finit avec la portée. La ref d'une source écrit dans cette source.

```ts vue
import { customRef, onScopeDispose, type Ref } from 'vue';
import type { ReadableNode, SourceNode } from '@yaltaan/core/reactive';

export function nodeRef<T>(node: SourceNode<T>): Ref<T>;
export function nodeRef<T>(node: ReadableNode<T>): Readonly<Ref<T>>;
export function nodeRef<T>(node: ReadableNode<T>): Ref<T> {
  return customRef<T>((track, trigger) => {
    onScopeDispose(node.subscribe(trigger));
    return {
      get: () => {
        track();
        return node.get();
      },
      set: (value) => (node as SourceNode<T>).set(value),
    };
  });
}
```

## Bon à savoir

- Un calcul nomme ses dépendances et reçoit leurs valeurs dans cet ordre ; il doit être pur. Un nœud d'un autre graphe lu à l'intérieur n'est ni suivi ni refusé.
- Rien de suivi, rien de calculé : une écriture ne coûte rien à une valeur qu'aucune écoute ne suit, et le ramasse-miettes la récupère avec sa dernière référence.
- Une écoute n'est appelée que si la valeur diffère de celle qu'elle a vue en dernier : une valeur changée puis remise avant la fin d'un batch ne prévient personne. Les écoutes passent après les écritures, jamais au milieu d'un batch, chacune au plus une fois par passe, dans l'ordre de création de leurs nœuds, puis dans l'ordre d'abonnement : une écriture ou un batch fait une passe, et ce que les écoutes écrivent pendant une passe fait la suivante.
- Une écoute qui lève une exception n'arrête pas les autres ; l'écriture relève ensuite cette erreur, ou une `AggregateError` de toutes.
- Des écoutes qui écrivent sans cesse sont arrêtées après 100 passes : l'écriture lève une `RangeError`, après les erreurs des écoutes, et les notifications restantes attendent l'écriture ou le batch suivant.
- `get` et `subscribe` sont des méthodes, le contrat de `useSyncExternalStore` de React : passez-lui `(listener) => node.subscribe(listener)` et `() => node.get()`, construites une fois par nœud.
- Toutes les dépendances appartiennent au même graphe, et deux graphes n'attendent jamais les batchs l'un de l'autre : construisez sur un seul graphe ce qui doit changer ensemble.
- Le module entier pèse moins de 1 000 octets minifié et compressé par brotli.
