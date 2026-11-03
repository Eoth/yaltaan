# Bêta Yaltaan : `@yaltaan/temporal`

Ce kit s'adresse à celles et ceux qui jugeront durement une librairie de dates sur la performance, la sécurité et la documentation. Il n'est pas sur npm, et rien ici n'est publié : vous installez des archives. Chaque fonction est `@experimental` : les noms et les formes peuvent changer d'une bêta à l'autre.

`@yaltaan/temporal` ne calcule rien lui-même : Temporal le fait, natif ou par un polyfill. Il ajoute ce qui manque à Temporal : les intervalles, la lecture d'un format déclaré, une frontière avec `Date` qui nomme toujours son fuseau, le début et la fin d'une unité, les jours ouvrés. Les raisons de quitter dayjs, et les lignes où dayjs est meilleur, sont mesurées plus bas.

## 1. Ce que vous avez reçu

| Fichier | Ce que c'est |
|---|---|
| `yaltaan-core-*.tgz`, `yaltaan-temporal-*.tgz` | Les deux paquets, installés ensemble. Nommés `0.1.0-rehearsal.0` : une répétition de la publication, la seule sorte de version qui existe ; `@since 0.3` dans une déclaration est un jalon de travail. |
| `try.mjs` | Un premier passage qui vérifie une fonction de chaque sorte sur votre plateforme. |
| `docs/guide/fr/temporal.md`, `docs/guide/en/temporal.md` | **Le guide du paquet** : à lire après la section 2. |
| `docs/reference/temporal.md`, `docs/issue-codes/temporal.md` | Chaque fonction avec son contrat ; chaque code d'issue. |
| `docs/comparisons/dayjs-migration.md` | Quoi écrire à la place de chaque appel à dayjs, avec ce que la comparaison a trouvé. |
| `docs/comparisons/dayjs.md`, `docs/comparisons/dayjs-measures.md` | Toute la comparaison avec dayjs, et ce que chacun coûte. |
| `docs/test262/` | Les tests officiels de Temporal sur chaque implémentation. |
| `docs/adr/` | Pourquoi c'est construit ainsi. |
| `FEEDBACK.md` | Ce qu'il faut renvoyer. |
| `SHA256SUMS` | La somme de chaque fichier. |

Vérifiez-les, dans le dossier du kit : `sha256sum --check SHA256SUMS`.

## 2. Démarrer

Il vous faut Node 22.12 ou plus récent. Dans un dossier vide, avec `KIT` réglé sur le dossier du kit :

```sh
npm init -y
npm pkg set type=module
npm install "$KIT"/yaltaan-core-*.tgz "$KIT"/yaltaan-temporal-*.tgz
npm install --save-exact temporal-polyfill@1.0.5
cp "$KIT/try.mjs" .
node try.mjs
```

La dernière commande affiche quel Temporal elle a trouvé, puis `ok: @yaltaan/core and @yaltaan/temporal work together on this platform.` Node 26 a Temporal et n'utilise pas le polyfill ; sous Node 22 et 24, sur Safari et sur iOS, une application l'importe une fois, à son démarrage :

```js
import 'temporal-polyfill/global';
import { parsePlainDate } from '@yaltaan/temporal';

const read = parsePlainDate('31/02/2024', { format: 'dd/MM/yyyy' });
console.log(read.ok ? String(read.value) : read.error.code); // temporal.invalid_date
```

Avec TypeScript 6.0 ou 7, et `moduleResolution` à `nodenext`, `node16` ou `bundler` (pas `node10`), rien à configurer : les déclarations du paquet apportent les types de Temporal. Chaque fonction est décrite dans `docs/reference/temporal.md` et dans le JSDoc de sa déclaration, avec ce qu'elle lève et sa complexité. Une fonction rend un `Result`, `{ ok: true, value }` ou `{ ok: false, error }`, partout où des données peuvent la faire échouer : lisez sa `value` après avoir testé son `ok`. `error.code` est stable, et l'issue d'un lecteur ne contient rien du texte refusé. Trois choses en entier, les mêmes que la fin de `try.mjs` :

```js
import { gaps, interval, mergeAll, parseZonedDateTime } from '@yaltaan/temporal';

// Intervals: interval() returns a Result, and a list takes what is inside it.
const day = (text) => Temporal.PlainDate.from(text);
const span = (from, to) => {
  const made = interval(day(from), day(to));
  if (!made.ok) throw new Error(made.error.code);
  return made.value;
};
const busy = [span('2024-03-01', '2024-04-01'), span('2024-01-01', '2024-02-01'), span('2024-01-15', '2024-02-15')];
const year = span('2024-01-01', '2025-01-01');
console.log(mergeAll(busy).value.map(String).length); // 2
console.log(gaps(busy, { within: year }).value.map(({ start, end }) => `${start} to ${end}`));

// From dayjs.tz('2024-03-09T23:00:00', 'America/New_York').add(3, 'hour').format('YYYY-MM-DD HH:mm'), which says 02:00, a
// time that did not exist that night:
const read = parseZonedDateTime('2024-03-09T23:00:00', { timeZone: 'America/New_York' });
if (!read.ok) throw new Error(read.error.code);
const later = read.value.add({ hours: 3 });
console.log(later.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ')); // 2024-03-10 03:00

// Today, and its quarter, in a time zone you name:
console.log(String(Temporal.Now.plainDateISO('Europe/Paris')));
```

## 3. Quitter dayjs

Ouvrez `docs/comparisons/dayjs-migration.md` : une ligne par besoin, l'appel à dayjs, quoi écrire à la place, et combien de cas générés dayjs a traités autrement. En bref :

- **Sans le plugin `timezone`, dayjs est d'accord presque partout** : en mode UTC, et en mode local sur une machine réglée sur le fuseau du cas (`local-*`, c'est la `Date` de la plateforme qui travaille). Il reste : les mois et années entre deux dates en fin de mois, une convention ; une date qui n'existe pas, sauf avec son mode strict, qui est d'accord partout ; une année de 0000 à 0099, lue 19xx ; et une fin d'unité dans `local-end-of`.
- **Avec le plugin `timezone`, près d'un changement d'heure, il se trompe** : après `.tz().add(3, 'hour')` l'instant est juste et l'heure affichée fausse ; le début d'une journée avec un changement d'heure peut être décalé d'une heure ; `dayjs.tz` dépend du jour où le code tourne, `.tz()` du fuseau de la machine.
- Commencez par les lecteurs (`parsePlainDate`, `parseZonedDateTime`) : ils transforment des dates fausses et silencieuses en issues que vous pouvez afficher. Puis ce qui utilise `.tz`. Le code en mode local ou `dayjs.utc`, avec une lecture stricte, peut attendre.

**Ce que dayjs garde**, mesuré dans `docs/comparisons/dayjs-measures.md` : il est environ trois fois plus léger que le polyfill sur Safari, iOS, Node 22 et 24 ; il fait moins d'instructions que le polyfill sur certaines opérations ; `format('DD/MM/YYYY')` est plus court qu'`Intl.DateTimeFormat`, dont la sortie suit une locale, pas un motif ; un seul objet chaîné s'apprend plus vite que six classes. Le Temporal natif coûte 0 octet et fait le moins d'instructions sur chaque opération qu'il sait faire ; `parsePlainDate` en fait plus que `PlainDate.from` natif sur une date ISO, qui lit moins strictement, et moins que dayjs en mode strict.

## 4. Ce qui est testé, et sur quoi

| Juge | Sur quoi | Résultat |
|---|---|---|
| test262, les tests officiels de Temporal, 6 634 tests | Natif de Node 26.12.1 ; `temporal-polyfill` 1.0.5, entrées par défaut et `full` | `docs/test262/` |
| Comparaison avec dayjs et java.time, cas générés sur 418 fuseaux | Node 26.12.1, natif et polyfill ; `java.time` du JDK 17 en départage | `docs/comparisons/dayjs.md`, rejoué à l'octet |
| Lois et fuzzing de chaque fonction, sur des entrées générées | Natif de Node 26 ; polyfill sous Node 22, 24 et 26 | Dans la porte du dépôt |
| Limites : texte, format, fuseau, calendrier, un million d'intervalles, nombres de jours énormes, calendriers où tout est férié | Idem | Dans la porte du dépôt |
| Mutations générées du code, témoin d'abord ; et une relecture neuve chargée de refuser, qui a refusé deux fois avant d'accepter les lecteurs | Intervalles, lecteurs, fonctions de calendrier | Dans les messages de commit, au commit ci-dessous |

La date des données compte : une réponse de fuseau est une affirmation sur les données du moteur, et celles de Node et de Java diffèrent.

## 5. Ce qui n'est pas couvert

- **Firefox, Safari, iOS et tous les autres navigateurs n'ont pas été lancés.** Deno et Bun non plus. `@mdn/browser-compat-data` 8.1.5 annonçait Temporal natif sur Chrome 144+, Edge 144+ et Firefox 139+, et absent de Safari et d'iOS lors de la vérification (ADR 0005 du dépôt), mais ni ce paquet ni ses lois n'ont tourné dans un navigateur. Si vous en utilisez un, votre premier passage est le premier.
- **Pas de codecs pour `@yaltaan/schema`.** Un formulaire ne peut pas faire passer des valeurs Temporal par un schéma sans votre propre conversion vers et depuis le texte : cela attend le codec du paquet de schémas.
- **Les calendriers autres qu'ISO** sont transportés, et testés par ces lois seulement jusqu'au grégorien ; l'entrée par défaut du polyfill n'a que l'ISO et le grégorien, `temporal-polyfill/full` a les autres.
- **Pas de formatage ni de noms de mois** : `Intl.DateTimeFormat` écrit, et rien ne lit `4 mars 2024`.
- **Les plugins de dayjs autres que** `utc`, `timezone`, `customParseFormat`, `isBetween`, `quarterOfYear` et `isoWeek` n'ont pas été comparés, ni ses locales.
- **Aucun projet réel n'a fait tourner ceci.** Les cas de la comparaison sont générés, et le projet à l'origine de ce travail n'a pas été à sa disposition. Votre projet est le juge qui manque.
- **Le polyfill n'est pas le Temporal natif.** Il échantillonne le décalage de chaque fuseau par période, et rate une heure d'été courte dont les deux bouts ont le même décalage : sur les changements d'heure depuis 2000, neuf fuseaux diffèrent du natif, dont `Africa/Casablanca` et `Africa/Cairo`, où il répond comme si l'horloge n'avait pas changé (`2021-05-16T02:30:00` à Casablanca ; la liste est dans `docs/comparisons/dayjs.md`), et il accepte quatre anciens noms de fuseaux que le Temporal natif refuse, comme `US/Pacific-New`. Il garde aussi en mémoire ce qu'il a appris de chaque fuseau : un service sous Node 22 ou 24 qui lit des dates et des fuseaux venus de l'extérieur grossit avec eux. Sur un serveur, préférez Node 26.

## 6. Les mesures, et comment les rejouer

Le dépôt est public : `https://github.com/Eoth/yaltaan`, au commit `{commit}`, dont les messages de commit tiennent les chiffres et ce que les relectures ont trouvé (`git log --grep temporal`). Il vous faut Node 24 comme `node` ; les scripts téléchargent le Node 26.12.1 sur lequel ils mesurent, par sa somme. `run.sh` demande un JDK avec `javac` dans le `PATH`, et ne rejoue à l'octet qu'avec les données de fuseau de Java 17.0.20.1 (tzdb 2026b) ; un autre JDK fait bouger la colonne `java.time alone`, et elle seule. `measure.sh` demande valgrind.

```sh
git clone https://github.com/Eoth/yaltaan.git && cd yaltaan && git checkout {commit}
npm ci --ignore-scripts
bash scripts/test262.sh              # 30 s environ ; affiche ok: test262 gives the tables of docs/test262...
bash scripts/verify.sh               # 2 min environ ; toute la porte, finit par OK
bash tests/compare-dayjs/run.sh      # 1 min environ ; affiche ok: the comparison gives the recorded report, to the byte
bash tests/compare-dayjs/measure.sh  # 4 min environ ; réécrit docs/comparisons/dayjs-measures.md : lisez git diff
```

Les instructions viennent de Callgrind, pas d'une horloge : elles se répètent à 0,03 % près environ, même sur une machine partagée, et sont écrites sur trois chiffres : un dernier chiffre peut bouger, un octet non. Les octets viennent d'esbuild et de Rollup, minifiés et compressés en brotli.

## 7. Ce qu'il faut renvoyer

Remplissez `FEEDBACK.md` et renvoyez-le à la personne qui vous a remis ce kit. Un problème de sécurité passe par là aussi, jamais par un ticket public. Ce qui aide le plus : l'étape où vous vous êtes arrêté, une vraie date de votre projet qui se trompe, une entrée qui fait lever une erreur ou durer une fonction à `Result`, et une phrase de ce guide que vous n'avez pas pu vérifier.
