# Feuille de route

**Ambition** : une « standard library applicative » TypeScript, native-first et sobre, dont la valeur vient d'un seul modèle partagé (`Result`, `Issue`, `Path`, schéma Standard Schema, nœud réactif) utilisé à l'identique par tous les domaines, et de contrats écrits, vérifiés en CI et mesurés. Le succès se compte en code applicatif, dépendances et octets supprimés chez l'utilisateur. La conception en vigueur est dans `ARCHITECTURE.md` ; les décisions motivées dans `docs/adr/`.

Ce fichier est un **carnet de tickets**, pas un journal : le « pourquoi » d'un changement va dans son message de commit, le « comment » dans la documentation du code.

## 0. Mode d'emploi pour une itération

1. Prendre **le premier ticket non clos** de l'ordre d'exécution (§2). Ne lire que ce ticket, les fichiers qu'il cite et les sections d'`ARCHITECTURE.md` qu'il nomme.
2. Si le ticket renvoie à une décision de §3, l'appliquer telle qu'actée. Une décision nouvelle du même ordre se pose au propriétaire **avant** tout code qui en dépend, avec un ADR et une recommandation écrite en §3.
3. Appliquer la définition de fini commune (§8), plus le critère d'acceptation propre au ticket.
4. Clore = retirer le ticket de §5 et ajouter **une ligne** en §9 (identifiant, commit, chiffres mesurés, itérations consommées). Aucun récit.
5. Un problème découvert hors périmètre devient **un nouveau ticket au format standard** dans le bon lot, jamais un paragraphe ou une mention en passant.
6. Un ticket taille **L** se découpe en étapes S/M (a, b, c) avant de commencer.

**Format d'un ticket** : `Pourquoi` (valeur, en une phrase) · `Faire` (le changement) · `Où` (fichiers, paquets) · `Accepté si` (critère vérifiable) · `Taille` S (≤ 1 itération) / M (1–3) / L (à découper) · `Prio` P0 (colonne vertébrale, tranche verticale) / P1 (important) / P2 (utile) / P3 (plus tard) · `Dépend de`. **L'ordre réel de réalisation est celui de §2**, pas l'ordre de numérotation.

**Itérations consommées** (quatrième cellule de §9) : leur nombre, puis la taille entre parenthèses, `1 (M)` ; une demi-itération s'écrit `0,5 (S)`.

## 1. État mesuré (base de toute comparaison)

Aucun paquet publié ; premières API, `@yaltaan/core/result` (T1.1), 121 à 122 o brotli, `@yaltaan/core/path` (T1.3), `parsePath` seul 637 à 639 o (`toPath` d'es-toolkit : 495 à 496 o), `@yaltaan/core/issue` (T1.2), les deux conversions Standard Schema 487 à 498 o, et `@yaltaan/core/equal` (T1.5), `equal` 946 à 948 o (`isEqual` d'es-toolkit : 1 162 à 1 166 o). Taille d'import : harnais en place (T0.2), cinq scénarios de référence mesurés dans `docs/size-baseline.tsv` (brotli, esbuild / Rollup : es-toolkit `omit` 90 / 97 o, dix primitives 657 / 661, schéma de connexion valibot 1 285 / 1 254, `@preact/signals-core` 1 562 / 1 559, temporal-polyfill 17 851 / 17 876), budgets calibrés dans `bench/size/budgets.tsv` (ADR 0010), neuf en attente de leur scénario. Coût des types : harnais en place (T0.3, ADR 0014), projet de référence de 2 000 fichiers sans usage de la librairie, 110 220 instanciations sous TypeScript 7.0.2 et 110 055 sous 6.0.3 avec `exactOptionalPropertyTypes` (`docs/type-cost-baseline.tsv`), aucun plafond tant qu'aucun type public n'existe. Comptage d'instructions : `scripts/perf-count.sh <A> <B>` sous Callgrind (T0.4 a, ADR 0016), deux scénarios de référence dans `bench/perf/scenarios/` (`omit` : natif / es-toolkit ; connexion : natif / valibot ; jeux micro, réaliste, pathologique), écart maximal entre comptages du même arbre 0,0291 %, seuil 0,10 % des instructions par appel ; aucun chemin chaud de la librairie encore compté. Chronométrage : `scripts/perf-time.sh` (T0.4 b, ADR 0017 et 0018), lots d'au moins 10 µs, plancher de la boucle soustrait (0,74 ns), trois passes, octets alloués par appel recoupés par la comptabilité du ramasse-miettes ; omit natif/micro 696 ns et 976 octets par appel, es-toolkit/micro 226 ns et 545 octets, connexion valibot/micro 137 ns et 349 octets (médianes de trois passes, portable sur batterie) ; seconde lecture tinybench à 2,8 % près.

Outillage de développement (empreinte installée, à ne laisser croître que par ADR 0003, 0009, 0013, 0014 ou suivant) : 19 paquets tiers installés sous Linux x64 (TypeScript 7.0.2 et son binaire, TypeScript 6.0.3 sous son enveloppe `@typescript/typescript6` 6.0.2, installée en stratégie `shallow` (ADR 0015), Prettier 3.9.9, `@types/node` 22.20.5 et `undici-types`, `esbuild-wasm` 0.28.2, `@rollup/wasm-node` 4.64.0 avec `@types/estree` et son module natif optionnel `@napi-rs/lzma`, es-toolkit 1.52.0, valibot 1.5.0, temporal-polyfill 1.0.5 et ses deux dépendances, `@preact/signals-core` 1.14.4, fast-check 4.10.2 et `pure-rand` 8.4.2) et les deux liens de l'espace de travail, `node_modules` 95,9 Mo ; verrou de 39 entrées tierces, MIT 15 et Apache-2.0 24, un seul script d'installation admis (fsevents, macOS, jamais exécuté) (mesure du 2026-10-19, Ubuntu 26.04 x64). Porte : 184 tests, étape de taille en 4 s, graphe des dépendances (T0.7, ADR 0011) en 0,3 s, tags de contrat (T0.6, ADR 0012) en 0,15 à 0,18 s et catalogue adversarial (T0.5, ADR 0013) en 0,09 s tant qu'aucun paquet n'a de source, coût des types (T0.3, ADR 0014) en 4,0 à 4,1 s ; porte complète en 15,7 s sur une machine chargée, verte sous Linux (Node 24.21.0), tests verts aussi sous Node 22.23.3 et 26.12.0. Relevé à chaque changement du verrou (`npm ls --all`, taille de `node_modules`), chiffres dans le message de commit.

## 2. Ordre d'exécution

Une version utilisable d'abord (décision du propriétaire du 2026-10-23, §3) : la 0.1.0 livre `@yaltaan/core`, les utilitaires que les équipes recodent, sur les contrats de §5 d'`ARCHITECTURE.md` ; la 0.2.0 ajoute schéma et règles, validés sur le formulaire pilote ; la 0.3.0 le formulaire et Angular. L'outillage qui reste attend d'être utile. Les contrats se gèlent après le pilote (T2.7), pas avant. Une itération peut prendre deux tickets S ou M d'un même domaine.

**Avancement** : 19 étapes closes sur 82 ; prochaine : T3.5.

| # | Lot | Tickets, dans l'ordre | Avancement | Sortie |
|---|---|---|---|---|
| 1 | 0 — Outillage | T0.1, T0.2, T0.7, T0.6, T0.5, T0.3, T0.4 a, b | 8 / 8 clos, terminé | Paquets vides qui passent toute la CI ; taille, coût des types, instructions et temps mesurés. |
| 2 | 0.1.0 — `@yaltaan/core` utilisable | T1.1, T1.3, T1.2, T1.5, T3.1 a, b, T0.17, T3.2, T0.20 a, T3.3 a, b, T3.5, T3.4, T0.10 | 11 / 14 clos ; prochain : T3.5 | `Result`, `Issue`, `Path`, `equal`, objets et accès par chemin, collections, nombres, chaînes ; version 0.1.0 étiquetée, archive vérifiée, publiée sur npm dès que l'organisation `@yaltaan` est réservée. |
| 3 | 0.2.0 — Schéma et règles sur le pilote | T2.1 a, b, T2.8, T2.2, T2.3, T1.4, T0.20 b | 0 / 7 clos ; prochain : T2.1 a | Schéma Standard Schema minimal et règles relationnelles, scénarios du pilote verts sans `form`. |
| 4 | 0.3.0 — Formulaire et Angular | T0.14, T1.6 a, T1.6 b, T2.4 a, b, c, T2.5, T2.6, T2.7 | 0 / 9 clos ; prochain : T0.14 | Pilote de bout en bout dans Angular, mesures, **ADR go/no-go de `form`**, gel des contrats. |
| 5 | Outillage reporté | T0.18, T0.19, T0.21, T0.22, T0.16, T0.8, T0.9, T0.13, T0.15 | 0 / 9 clos ; prochain : T0.18 | Selon le besoin réel des versions précédentes. |
| 6 | 3 — Données (suite) | T3.3 c, T3.10, T3.6 a, b, c, T3.7 a, b, T3.8, T3.9 | 0 / 9 clos ; prochain : T3.3 c | Modules `@experimental`. |
| 7 | 4 — Temporal | T4.5, T4.1, T4.2, T4.3, T4.4 | 0 / 5 clos ; prochain : T4.5 | Tests sur l'implémentation native et sur le polyfill recommandé. |
| 8 | 5 — Schéma et règles complets | T5.1 a, b, T5.2, T5.3, T5.4, T5.5, T5.6, T5.7 | 0 / 8 clos ; prochain : T5.1 a | Interopérabilité Standard Schema vérifiée avec au moins deux moteurs tiers. |
| 9 | 6 — Formulaire complet (si go) | T6.1, T6.2, T6.3, T6.4, T6.5, T6.6 | 0 / 6 clos ; prochain : T6.1 | Second projet pilote. |
| 10 | 7 — Durcissement | T0.11, T0.12, T7.1, T7.2, T7.3, T7.4, T7.5 | 0 / 7 clos ; prochain : T0.11 | 1.0 = uniquement des modules `@stable`. |

`core/async` et `core/cache` (`ARCHITECTURE.md` §7.6, §7.7) n'avaient pas de phase : ils entrent au lot 3 (T3.7, T3.8). Si le formulaire montre que sa validation asynchrone en a besoin plus tôt, T3.7 a remonte avant T2.4 c.

## 3. Décisions produit et architecture

Une décision réservée au propriétaire (nom, licence, API publique, contrat transverse, exclusion, dépendance lourde, comportement par défaut visible, baseline) s'écrit ici avec sa recommandation et son ADR, et se pose au propriétaire avant tout code qui en dépend. Les choix techniques internes se décident par ADR sans attendre.

| Sujet | Question | Décision |
|---|---|---|
| Nom (ADR 0001) | Quel nom de produit et quelle portée npm ? | **Acté par le propriétaire le 2026-10-12** : **Yaltaan**, portée npm **`@yaltaan`** (`@yaltaan/core`…), libre comme le paquet nu `yaltaan` et le nom GitHub (vérifié le 2026-10-12) ; le dossier du dépôt porte le même nom. Restent au propriétaire, avant la première publication : antériorité INPI, EUIPO, OMPI (classes 9 et 42), domaines, réservation de l'organisation npm. Écartés : Pien (`@pien` tenue par un tiers) ; un nom descriptif (marque indéfendable). |
| Licence (ADR 0002) | Sous quelle licence publier ? | **Acté par le propriétaire le 2026-10-12** : **MIT** : une librairie importée par des applications Angular et React ne se diffuse que sous licence permissive, et la thèse se mesure à l'adoption. Contributions sous MIT entrant = MIT sortant, sans CLA. Écartés : AGPL + licence commerciale (atteint le code des applications consommatrices : aucune adoption) ; Apache-2.0 (concession de brevet utile, mais texte long et NOTICE à propager pour un gain nul ici). |
| Outillage (ADR 0003) | Gestionnaire de paquets, compilateur, exécuteur de tests, formateur ? | **Décidé (choix technique interne)** : espaces de travail npm 11 (déjà installé, verrou v3, aucun outil de plus), TypeScript 7 (`tsc`, compilateur natif GA), `node --test` sur les fichiers `.ts` (effacement des types de Node, aucune dépendance), Prettier épinglé à la version exacte. Détail et mesures dans l'ADR. |
| Baseline (ADR 0004) | Quelles plateformes cibler, et que faire des API trop récentes ? | **Acté le 2026-10-12, délégué par le propriétaire à la recommandation** : navigateurs « Baseline Widely Available » (web-features) à la date de chaque version majeure ; Node : toutes les lignes LTS non arrivées en fin de vie à cette date (aujourd'hui 22, 24, 26) ; Deno et Bun récents. Une API hors baseline n'est jamais utilisée en interne ni polyfillée en silence ; ponyfill isolé dans `core/compat/*` si nécessaire. Mesure du 2026-10-12 (web-features 3.42.0) : `groupBy`, `toSorted`, `structuredClone`, `AbortSignal.any`, `Promise.withResolvers`, `Array.fromAsync` sont Widely ; ensembles (`union`…) le deviennent le 2026-12-11, itérateurs le 2027-09-30, `RegExp.escape` le 2027-11-01 ; `Math.sumPrecise` et base64 de `Uint8Array` en 2028 : la table natif → ajout d'`ARCHITECTURE.md` §4 en tient compte. |
| Temporal (ADR 0005) | Temporal manque à Safari stable et à Node 22 et 24 (il est ES2027) : comment le traiter, quel polyfill recommander ? | **Acté le 2026-10-12, délégué par le propriétaire à la recommandation** : pair de plateforme, lu sur `globalThis` au moment de l'appel, jamais embarqué ; polyfill recommandé **`temporal-polyfill`** (1.0.5, MIT, 19,3 ko minifié + brotli, maintenu, à jour de la spécification de septembre 2026) ; tests sur l'implémentation native (Chrome, Firefox, Node 26, Deno, Bun) et sur ce polyfill. Écarté : `@js-temporal/polyfill` (0.5.1, aucune version depuis mars 2025, 38,9 ko), qui reste testé tant qu'il est le plus téléchargé derrière lui. |
| Versions prises en charge (ADR 0006) | TypeScript, Angular, Node côté utilisateur ? | **Acté le 2026-10-12, délégué par le propriétaire à la recommandation** : TypeScript 6.0 et 7.x (l'outillage des gabarits Angular reste sur 6.0, selon l'annonce de TypeScript 7) ; Angular ≥ 22 pour le pont Signal Forms (stable en 22, qui accepte Standard Schema par `validateStandardSchema`), versions actives et LTS ensuite ; Node ≥ 22.12 (première version de la ligne 22 qui charge un module ESM par `require()` sans drapeau : une librairie ESM seule en dépend pour ses utilisateurs CommonJS). Une ligne retirée = version majeure. |
| React (ADR 0007) | Hooks propres seulement, ou aussi un adapter TanStack Form ? | **Acté le 2026-10-12, délégué par le propriétaire à la recommandation** : hooks propres seulement (`useSyncExternalStore`). TanStack Form lit déjà Standard Schema nativement : un schéma ou une règle de Yaltaan y fonctionne sans pont. Un adapter dédié n'est rouvert que si T2.6 mesure du code de colle répété chez l'utilisateur. |
| Clés inconnues (ADR 0008) | Défaut des schémas d'objet : `strip`, `reject` ou `passthrough` ? | **Acté le 2026-10-12, délégué par le propriétaire à la recommandation** : `strip`, comme le cadrage le proposait et comme le font Zod 4 et Valibot : un champ ajouté côté serveur ne casse pas les clients déployés, et aucune clé non déclarée ne traverse sans contrôle ; `reject` recommandé et documenté pour les entrées non fiables. |
| Harnais de taille (ADR 0009) | Avec quels bundlers mesurer les imports, et contre quelles références ? | **Décidé (choix technique interne)** : esbuild et Rollup dans leurs versions WebAssembly (`esbuild-wasm` 0.28.2, `@rollup/wasm-node` 4.64.0 : mêmes octets sur tout système, aucun binaire par plateforme, sorties identiques aux versions natives), résolveur propre pour Rollup vérifié contre esbuild à chaque exécution, minification par esbuild des deux sorties ; références es-toolkit, valibot, temporal-polyfill et `@preact/signals-core`, recoupées à l'octet par bundlejs.com. Seul script d'installation admis : fsevents (macOS, jamais exécuté). Coût : 25,5 Mo installés, 11 entrées de verrou, 4 s par porte. |
| Budgets d'import (ADR 0010) | Quelles valeurs remplacent les hypothèses d'`ARCHITECTURE.md` §9.1 ? | **Décidé (choix technique interne)** : le plus serré de l'hypothèse et de 1,5 × la référence, arrondi à 10 o : `omit` 150 o (es-toolkit 97), dix primitives 1 000 o (661), graphe réactif 1 000 o (`@preact/signals-core` 1 562), schéma de connexion 1 500 o (valibot 1 285) ; couche Temporal 1 790 o, un dixième du polyfill ; règles, formulaire et adapters gardent leur hypothèse jusqu'à la mesure du pilote (T2.6). Source unique : `bench/size/budgets.tsv`. |
| Graphe des dépendances (ADR 0011) | Avec quel outil contrôler le graphe autorisé et les règles de publication ? | **Décidé (choix technique interne)** : un contrôleur du dépôt sur `parseAst` de `@rollup/wasm-node` (déjà installé) pour le JavaScript construit, et `tsc --listFilesOnly` pour les imports de types ; graphe lu dans `ARCHITECTURE.md` §6, arêtes lues dans les `dependencies` et `peerDependencies` des package.json, une arête interne = une `dependencies` à la version exacte du paquet du workspace. Écarté : dependency-cruiser 18.6.0 (accepte TypeScript < 7 seulement : sur des sources `.ts` il lit 0 module et sort en 0 ; 43 paquets, 4,8 Mo ; ni code au chargement, ni barrels). |
| Tags de contrat (ADR 0012) | Avec quel analyseur lire les tags JSDoc des exports publics, et où tenir la liste des tags admis ? | **Décidé (choix technique interne)** : l'entrée `typescript/unstable/sync` de TypeScript 7.0.2 (déjà installé, 0 octet ajouté, 0,15 s par lecture), confinée à `scripts/lib/declarations.ts`, sur les `.d.ts` publiés ; les exports de valeur lus par le compilateur sont recoupés par les clés du module que Node charge ; liste unique des tags dans `scripts/lib/contract-tags.ts`, d'où découlent le contrôle et la table de `docs/reference/README.md`. Un export qui s'exécute porte tout le contrat ; une constante non appelable, une interface ou un alias de type portent `@since` et la stabilité seulement. Risque mesuré : la 7.1 en développement rend privé `updateSnapshot` (réparation dans l'adaptateur seul). Repli mesuré : `@typescript/typescript6` (2 paquets, 24,4 Mo, API stable, 0,38 s). Écarté : un analyseur propre (re-exports et surcharges à réimplémenter, sans seconde lecture). |
| Catalogue adversarial (ADR 0013) | Avec quelle librairie générer les cas adversariaux, où vit la déclaration de chaque export, et que demande la porte à un export `@experimental` ? | **Acté par le propriétaire le 2026-10-19, sur la recommandation** : **fast-check 4.10.2** en dépendance de développement de la racine (2 paquets avec `pure-rand` 8.4.2, 1 588 005 octets, MIT, provenance vérifiée, aucun script d'installation, 12 versions en 10 mois, un seul mainteneur ; 10 ms d'import par fichier de test, +0,03 s de vérification des types), importée seulement par les tests via le paquet interne `@yaltaan/testing`, hors graphe et jamais publié (ligne « paquets internes » en §6 d'`ARCHITECTURE.md`, lue par les contrôles). La déclaration vit dans le fichier de test de l'export : les six catégories, chacune avec son contrôle, « N/A » et sa raison, ou « différé » ; la porte la lit dans les évènements du passage des tests. Tout export qui s'exécute déclare dès le premier jour (une interface, un alias de type ou une constante non appelable n'ont rien à attaquer) ; un export `@experimental` peut différer les tests d'une catégorie qui le concerne (compté et affiché), un export `@stable` non : la ligne du §10.5 se dédouble (« déclarées » oui / oui, « testées » non / oui). Écartés : rien de plus que `node:test` (ni réduction des cas en échec, ni ordonnanceur pour les courses du §10.3 : une seconde librairie à écrire) ; jsverify et testcheck (plus publiés depuis 2023 et 2022) ; jazzer.js (module natif que `ignore-scripts` ne construit pas, autre usage : à rouvrir pour les parseurs) ; un tag `@adversarial` publié (change le contrat du §5.6, et affirmerait une couverture qu'un test supprimé ne fournirait plus). |
| Coût des types et TypeScript 6.0 (ADR 0014) | Faut-il installer TypeScript 6.0 pour tenir la promesse de l'ADR 0006, par quel paquet, et que mesure la porte sous chaque compilateur ? | **Acté par le propriétaire le 2026-10-19, sur la recommandation** : **`@typescript/typescript6` 6.0.2** en dépendance de développement de la racine (2 paquets avec TypeScript 6.0.3, 24 358 478 octets, Apache-2.0, signatures du registre vérifiées, aucun script d'installation ; commande `tsc6` ; son `tsc` 6.0.3 ne remplace celui de TypeScript 7 que grâce à l'installation `shallow` de l'ADR 0015 ; `node_modules` 71,5 → 95,9 Mo, +34 %), lue seulement par le harnais de coût des types et les tests de types. Porte : nombre d'instanciations du projet de référence et d'un exemple par type public, sous les deux compilateurs, avec et sans `exactOptionalPropertyTypes`, plafonds par compilateur (mesure du 2026-10-19 : compte identique sur 7 passes, mais 1 596 054 sous 6.0.3 contre 1 779 120 sous 7.0.2 pour le même projet) ; temps de contrôle jugé sous TypeScript 7 seulement, médiane de cinq passes avec min et max (écart entre passes jusqu'à 16 %, plus que le seuil de +10 %), affiché sans être jugé sous 6.0 (5,8 fois plus lent : 2,42 s contre 0,41 s sur une sonde de 2 000 fichiers). Coût estimé sur la sonde : +11 s de porte (7,6 s aujourd'hui), moins tant que les types publics sont peu nombreux. ADR 0012 réexaminé : conservé (lire les tags par TypeScript 6.0 coûterait 0,23 s par porte et lirait avec un autre compilateur que celui qui construit ; la mise à jour qui cassera l'adaptateur choisira alors). Écartés : TypeScript 7 seul (promesse aux utilisateurs Angular non vérifiée) ; alias `npm:typescript@6.0.3` (11 ko de moins, mais deux `tsc` dans `node_modules/.bin`) ; téléchargement à la demande (réseau, hors verrou) ; tâche de CI séparée (mêmes octets, régression vue après la poussée). |
| Installation `shallow` (ADR 0015) | Comment garder `tsc` à TypeScript 7 quand une dépendance de dépendance livre une commande du même nom ? | **Décidé (choix technique interne)** : `install-strategy=shallow` dans `.npmrc` : seules les dépendances directes sont en tête de `node_modules`, seules leurs commandes sont liées ; `@typescript/old` (alias de `typescript@6.0.3`, dépendance de `@typescript/typescript6`) s'installe sous l'enveloppe. Constat du 2026-10-19 en stratégie par défaut : `npx tsc -v` → 6.0.3, la porte aurait construit avec TypeScript 6.0 et passé. Garde ajoutée au contrôle du verrou : deux paquets en tête de `node_modules` qui livrent la même commande font échouer la porte. Écartés : appeler TypeScript 7 par son fichier partout (`npx tsc` d'un terminal resterait faux) ; `install-strategy=linked` (expérimental dans npm 11). |
| Harnais chronométré (ADR 0017) | Avec quel outil chronométrer les scénarios de `bench/perf/` pour la publication du §9.2 d'`ARCHITECTURE.md` (le départage A/B reste au comptage d'instructions, ADR 0016) ? | **Acté par le propriétaire le 2026-10-20, contre la recommandation (tinybench 6.2.2)** : **aucune dépendance**, un harnais écrit dans `bench/perf/` sur `process.hrtime.bigint()`, à ces conditions : échantillons groupés (un échantillon dure au moins 10 µs, taille du lot publiée), boucle vide chronométrée dans la même exécution et soustraite, plancher publié ; ses tests vérifient qu'une fonction vide lit moins d'une nanoseconde et qu'un travail double lit entre 1,8 et 2,2 fois le temps ; seconde lecture une fois par tinybench et mitata dans une copie jetable, jamais dans le verrou. Mesure du 2026-10-20 : une copie d'objet lue 9-10 ns par mitata, 9,1 à 9,5 ns par tinybench groupé, 34-35 ns par un premier chronomètre maison sans soustraction. Écartés : tinybench (recommandé : 1 paquet, 87 315 octets, MIT, provenance vérifiée, actif) ; mitata 1.0.34 (aucune version depuis le 2025-02-04, un seul mainteneur, sans provenance). |
| Octets alloués et passes du harnais chronométré (ADR 0018) | Comment lire les octets alloués par appel (Node 24 n'a pas de compteur), et que doivent vérifier les tests du harnais ? | **Décidé (choix technique interne)** : croissance du tas sur des fenêtres de N appels sans collecte (jeune génération de 64 Mo, collectes vues par `v8.GCProfiler`), sept fenêtres, deux jetées, médiane des cinq publiée avec la plus petite et la plus grande ; recoupée dans un autre processus par la comptabilité du ramasse-miettes (collectes laissées faire, croissance plus octets libérés), et une fois hors des fichiers suivis par l'échantillonneur du tas de V8 (0 à 1,8 % d'écart, 7,7 % sur le schéma valibot). Trois passes par défaut, dispersion entre passes, alimentation et gouverneur publiés. Tests ajoutés à ceux de l'ADR 0017, qui restent verts avec des lots d'un appel : échantillon médian d'au moins 10 µs, fonction plancher lue à moins d'un tiers du plancher ; travail double lu sur la passe la plus rapide. |
| Projet pilote | Quel formulaire réel pour la tranche verticale ? | **Acté par le propriétaire le 2026-10-23** : son formulaire métier réel est sur un poste professionnel dont il ne peut rien sortir ; le pilote est donc imaginé dans le dépôt, de même complexité (multi-étapes, tableau dynamique, requis conditionnels, règles entre champs, validation serveur), dans `examples/pilot/` (T2.1 a, à relire par le propriétaire). |
| Version 0.1.0 | Faut-il finir l'outillage et la tranche verticale avant une première version ? | **Acté par le propriétaire le 2026-10-23** : non. Après huit itérations sans code de librairie, viser vite une 0.1.0 utilisable (`@yaltaan/core`), puis 0.2.0 (schéma, règles, pilote) et 0.3.0 (formulaire, Angular). L'outillage, les ADR et les tickets non urgents attendent un besoin réel ; les règles de qualité (tests, porte verte, taille mesurée) restent. |
| `Issue` et registre des codes (ADR 0019) | Où vit le registre, comment prouver qu'un code n'est jamais retiré, que devient un segment `{ key }` en Standard Schema, quel code pour une issue d'un autre validateur ? | **Décidé le 2026-10-25 par délégation du propriétaire (choix de conception)** : un registre écrit à la main par paquet, `docs/issue-codes/<paquet>.md`, comparé aux déclarations publiées et à chacune de ses versions committées (une ligne n'est jamais supprimée, un code retiré garde sa ligne avec la version qui le retire ; à partir de 1.0, seulement en majeure) ; un `{ key }` sort en index actuel donné par un `resolveKey` de l'appelant, ou le chemin s'arrête avant lui (l'erreur s'affiche sur la liste, jamais sur un champ inexistant) ; une issue d'un autre validateur devient `issue.external`, message dans `params.message`, issue d'origine dans `cause` ; formateur anglais en recette (`examples/recipes/`), jamais livré. Écartés : codes dans la JSDoc seule (rien ne prouve qu'un code existe encore) ; registre généré depuis les déclarations (un code retiré quitterait aussi le registre) ; `{ key }` transmis tel quel (lu comme un nom de propriété : erreur sur un champ inexistant, en silence) ; conversion qui échoue (chaque frontière devrait traiter un échec pour une issue affichable). |
| Juge différentiel (ADR 0022) | Quel juge extérieur pour les fonctions de `@yaltaan/core`, et comment tenir les différences voulues ? | **Décidé le 2026-10-28 (choix technique interne, demandé par le propriétaire)** : es-toolkit 1.52.0, déjà installé pour le banc (aucun paquet ajouté, `node_modules` inchangé à 95 862 726 octets), en dépendance des tests ; harnais `createJudge` de `@yaltaan/testing` : mêmes entrées générées des deux côtés, résultats comparés par `util.isDeepStrictEqual`, 1 000 entrées par comparaison ; chaque différence voulue écrite dans l'en-tête du module (bloc qui nomme la version installée) et vérifiée par le juge dans les deux sens (écrite, atteinte, changeante ; un quart des entrées au moins comparées). Écartés : ne rien faire ; Node seul (une fonction sur huit) ; lodash 4.18.1 (un paquet de plus, 1 413 741 octets, pour ce que `es-toolkit/compat` lit déjà comme lodash). |
| Guide utilisateur bilingue | Faut-il documenter chaque fonctionnalité pour l'utilisateur dès sa livraison, et en quelle langue ? | **Acté par le propriétaire le 2026-10-25** : oui, en anglais et en français, avec des schémas quand ils expliquent mieux que le texte. `docs/guide/en/` et `docs/guide/fr/`, une page par sous-chemin livré, mêmes blocs de code dans les deux langues (lignes de commentaire exceptées) ; schémas en Mermaid (texte, dessiné par GitHub, aucune image à télécharger) ; chaque exemple compilé et exécuté par la porte, chaque résultat annoncé par `// →` vérifié (`scripts/check-doc-examples.ts`, READMEs des paquets publiés compris). Exception à la règle « documentation publique en anglais » limitée au guide ; référence, ADR et READMEs restent en anglais. |

## 4. Non-objectifs (exclusions motivées)

| Élément | Verdict | Raison | Ticket |
|---|---|---|---|
| Fuseaux, DST, calendriers | **EXCLU** | Temporal le fait, avec les données de fuseau du runtime ; le réimplémenter coûterait des dizaines de ko et une maintenance permanente. | — |
| Cryptographie | **EXCLU** | Une implémentation maison est un risque, pas une économie ; Web Crypto existe. | — |
| Catalogues i18n, messages en langue naturelle | **EXCLU** | Les messages appartiennent à l'application ; le cœur produit des codes stables et des paramètres. Un formateur anglais minimal existe en recette. | — |
| Alias d'API natives | **EXCLU** | Des octets et une API à apprendre sans rien apporter. | — |
| State manager généraliste, client HTTP, cache de requêtes | **EXCLU** | Écosystèmes matures, hors de la thèse. | — |
| CommonJS | **EXCLU** | Node 22 et suivants savent `require()` un module ESM ; un double build complique `exports` et le tree-shaking. | — |
| `Option<T>` | **EXCLU** | `T \| undefined` suffit en TypeScript ; un type de plus coûte sans rien apporter. | — |
| Rust / WebAssembly | **EXCLU**, réouvrable | Réouvrable seulement par ADR chiffré (benchmark JS optimisé de référence, coût d'initialisation et de transfert, taille, cas réel). Candidats plausibles : validation de très gros volumes, diff de très grands jeux de données. | — |
| Décorateurs à l'exécution, réflexion, `new Function`, `eval` | **EXCLU** | Opaque, incompatible avec une CSP stricte, coûteux au démarrage. | — |
| Registres globaux, greffons auto-enregistrés | **EXCLU** | Incompatibles avec le tree-shaking et le déterminisme. | — |
| Clone profond générique, proxys d'immutabilité « à la immer » | **EXCLU** | `structuredClone` existe ; le besoin réel est la mise à jour localisée avec partage structurel (T3.2). | — |
| Arithmétique décimale arbitraire | **EXCLU** | Domaine d'une librairie dédiée ; `core/number` refuse toute conversion avec perte. | — |
| Formatage de dates et de nombres | **EXCLU** | `Intl.*` le fait ; seule une recette de résolution de locale est fournie. | — |

## 5. Tickets

### Lot 0 — Outillage

#### T0.8 — Baseline de plateforme vérifiée
- **Pourquoi** : « la plateforme le fait » ne vaut que si c'est vrai sur toute la baseline, et une API qui y entre doit faire retirer la fonction équivalente.
- **Faire** : la table natif → ajout d'`ARCHITECTURE.md` §4 devient un fichier de données unique, vérifié contre `web-features` (dépendance de développement, ADR) : statut Baseline de chaque API citée, date de passage à Widely ; échec quand une API utilisée en interne n'est pas dans la baseline, avertissement quand une API passe Widely (candidate au retrait d'une fonction de la librairie).
- **Où** : `scripts/`, `docs/`.
- **Accepté si** : l'usage fabriqué d'une API Newly (`Iterator.prototype.map`) dans `packages/` fait échouer la porte ; la table générée identique à l'octet sur deux exécutions.
- **Taille** S · **Prio** P1 · **Dépend de** T0.1 · **Décision** : §3, baseline (ADR 0004)

#### T0.9 — Matrice d'exécution : Node, Deno, Bun, navigateurs
- **Pourquoi** : une librairie « tout runtime » qui n'est testée que sous Node ne le prouve pas.
- **Faire** : tests sous Node 22, 24 et 26 (CI), Deno et Bun récents, Chromium, Firefox et WebKit (Playwright, ADR ; exécuteur minimal plutôt que Vitest si la mesure le confirme : Vitest + Playwright = 65 paquets, 64 Mo) ; fuseau et locale épinglés ; Temporal natif et polyfill.
- **Où** : `.github/workflows/`, `scripts/`.
- **Accepté si** : un test qui dépend du fuseau de la machine échoue en CI comme en local ; chaque runtime exécute le même nombre de tests.
- **Taille** M · **Prio** P1 · **Dépend de** T0.1

#### T0.10 — Publication sûre
- **Pourquoi** : la provenance et l'absence de jeton sont des promesses de la chaîne d'approvisionnement (`ARCHITECTURE.md` §11).
- **Faire** : workflow de release : trusted publishing (OIDC) avec provenance, aucun jeton npm ; SBOM CycloneDX ; cohérence étiquette, version et CHANGELOG ; contenu réel du tarball inspecté (`npm pack`) ; publint et arethetypeswrong (ADR) ; archives reproductibles (deux `npm pack` identiques à l'octet) ; mode répétition qui ne publie rien.
- **Où** : `.github/workflows/release.yml`, `scripts/`.
- **Accepté si** : la répétition passe sur une étiquette de test ; un fichier de test glissé dans `files` fait échouer l'inspection.
- **Taille** M · **Prio** P1 · **Dépend de** T0.1, recherches de marque du propriétaire (§3, nom)

#### T0.11 — Chaîne d'approvisionnement continue
- **Pourquoi** : un audit ponctuel vieillit ; les alertes doivent arriver d'elles-mêmes.
- **Faire** : osv-scanner sur le verrou et gitleaks sur tout l'historique en CI (téléchargés, somme vérifiée) ; Dependabot (propositions groupées mensuelles, jamais fusionnées automatiquement, délai de 7 jours) ; CodeQL une fois le dépôt public. Recommandations écrites en §3 avant mise en place.
- **Où** : `.github/`.
- **Accepté si** : une dépendance vulnérable fabriquée dans un verrou de test fait échouer le job ; un secret fabriqué fait échouer gitleaks.
- **Taille** S · **Prio** P2 · **Dépend de** T0.1

#### T0.12 — Tableau de bord du carnet
- **Pourquoi** : savoir ce qui reste par jalon sans recompter à la main.
- **Faire** : générateur (Node, sans dépendance) du tableau fait / total par lot et des trois prochains tickets, depuis §2, §5 et §9, entre marqueurs en tête de ce fichier ; la porte refuse un tableau périmé.
- **Où** : `scripts/`, `ROADMAP.md`.
- **Accepté si** : un ticket clos sans régénération fait échouer la porte ; sortie identique à l'octet sur deux exécutions.
- **Taille** S · **Prio** P3

#### T0.13 — Temps de compilation et d'exécution à froid des scénarios d'import
- **Pourquoi** : les octets ne disent pas tout du coût d'un import ; un module qui travaille au chargement le fait payer à chaque démarrage d'application, et `ARCHITECTURE.md` §9.1 promet cette mesure sans qu'aucun harnais la fasse.
- **Faire** : pour chaque scénario de `bench/size/` (références comprises), temps de compilation et d'exécution à froid du bundle minifié produit par le rapport de taille : isolat V8 neuf par mesure (Node), passes répétées, dispersion publiée ; méthode et seuils par ADR (comptage d'instructions de T0.4 si le chronomètre ne départage pas) ; résultat versionné à côté de `docs/size-baseline.tsv`.
- **Où** : `scripts/`, `bench/size/`, `docs/`.
- **Accepté si** : un scénario fabriqué qui exécute un travail coûteux au chargement dépasse le seuil et fait échouer la porte ; deux exécutions dans la dispersion mesurée ; temporal-polyfill mesuré comme référence.
- **Taille** M · **Prio** P2 · **Dépend de** T0.2, T0.4

#### T0.14 — Tags de contrat des membres publics
- **Pourquoi** : la promesse « chaque fonction documente sa mutation » s'arrête aux exports (ADR 0012) ; les méthodes d'une instance rendue par un `create*` ou d'un nœud réactif (`subscribe`) changent un état sans tag vérifié.
- **Faire** : étendre le contrôle des tags aux membres appelables des classes et interfaces exportées et aux fonctions portées par une constante objet exportée : mêmes tags qu'un export qui s'exécute, `@mutates this` pour l'état de l'instance (à décider par ADR) ; référence générée par membre.
- **Où** : `scripts/lib/declarations.ts`, `scripts/lib/contract-tags.ts`, `scripts/check-contract-tags.ts`.
- **Accepté si** : une méthode sans tag d'une interface exportée fait échouer la porte, comme un `@mutates` qui nomme un paramètre absent de la méthode ; référence identique à l'octet sur deux exécutions.
- **Taille** S · **Prio** P1 · **Dépend de** T0.6

#### T0.15 — Coût du harnais de types quand les usages se multiplient
- **Pourquoi** : chaque usage d'un type public ajoute quatre vérifications à la porte (deux compilateurs, deux jeux d'options), dont deux sous TypeScript 6.0 à 0,35 s environ rien qu'au démarrage : à dix usages, l'étape « type cost » passerait de 4 s à une vingtaine.
- **Faire** : mesurer l'étape avec les usages réels ; si elle dépasse 10 s, compter tous les usages d'un compilateur en un seul lancement (un projet de fixtures par usage, lus par une seule exécution de `tsc -b` ou par l'API de TypeScript 6.0), ou une autre méthode prouvée qui garde des comptes par usage identiques à l'unité.
- **Où** : `scripts/type-cost.ts`.
- **Accepté si** : mêmes comptes que la méthode actuelle sur chaque usage ; étape ≤ 10 s avec tous les usages de la tranche verticale, mesurée sur plusieurs passes.
- **Taille** S · **Prio** P2 · **Dépend de** T1.4

#### T0.16 — Caractères invisibles et de contrôle bidirectionnel écrits en clair dans le code
- **Pourquoi** : un contrôle bidirectionnel (U+202A à U+202E, U+2066 à U+2069) ou un caractère invisible (U+200B à U+200D, U+2060, U+FEFF) écrit en clair dans un fichier suivi rend le code relu différent du code exécuté (classe « Trojan Source », CVE-2021-42574) ; `packages/testing/src/unicode.ts` et `catalogue.test.ts` en contiennent aujourd'hui dans des chaînes, et aucun contrôle de la porte ne les voit.
- **Faire** : écrire ces caractères en échappement (`\u202E`) dans les deux fichiers ; ajouter le refus de ces points de code au contrôle du format des textes (`scripts/check-text-format.sh`), avec un test qui le voit rouge.
- **Où** : `packages/testing/src/`, `scripts/check-text-format.sh`, `scripts/tests/text-guards.test.ts`.
- **Accepté si** : la porte échoue sur un fichier suivi qui contient l'un de ces caractères en clair ; aucun n'en contient ; catalogue Unicode inchangé (mêmes cas, mêmes chaînes à l'exécution).
- **Taille** S · **Prio** P1 · **Dépend de** —

#### T0.18 — Test de mutation de `core`
- **Pourquoi** : les mutations faites à la main ne mesurent que celles qu'on a pensé à faire ; un outil de mutation dit ce que les lois tuent vraiment.
- **Faire** : Stryker (ou un équivalent mesuré, ADR : poids, sous-dépendances, compatibilité avec `node --test` sur des fichiers `.ts`) sur `packages/core/` ; d'abord une mesure des survivants par module ; puis une porte sur le code changé, seuil par ADR.
- **Où** : `scripts/`, `docs/adr/`.
- **Accepté si** : survivants comptés par module, chacun tué par une loi ou motivé (mutant équivalent) ; une loi retirée exprès fait apparaître un survivant.
- **Taille** M · **Prio** P1 · **Dépend de** T0.5

#### T0.19 — Test d'échelle des fonctions de chemin et de fusion
- **Pourquoi** : un coût quadratique caché ne se voit pas sur une entrée de taille fixe ; le même scénario en n, 2n et 4n le montre.
- **Faire** : dans `scripts/perf-count.sh` (Callgrind, ADR 0016), un mode qui compte les instructions d'un scénario en n, 2n et 4n et compare les rapports à ce que la complexité annoncée (`@complexity`) prévoit ; d'abord sur `parsePath`, `formatPath`, `merge`, `defaults` et les fonctions de T3.2.
- **Où** : `scripts/`, `bench/perf/scenarios/`.
- **Accepté si** : rouge sur une version quadratique fabriquée d'une fonction linéaire ; rapports publiés pour chaque fonction listée ; les scénarios couverts tirés des `@complexity` publiés, pas d'une liste écrite à la main.
- **Taille** S · **Prio** P1 · **Dépend de** T0.4 a, T3.2

#### T0.20 — Cure des consignes de travail
- **Pourquoi** : les consignes chargées au départ de chaque itération (2 655 mots le 2026-10-28) répètent des règles que des scripts tiennent déjà ; une règle tenue par un script tient en une ligne qui le nomme.
- **Faire** : (a) inventaire de chaque règle de l'ancien texte, une ligne chacune avec sa destination (ligne gardée, script, crochet, test, ADR, archive) ; un contrôle vérifie que chaque entrée se retrouve à sa destination ; une règle retirée sans destination va dans une liste soumise au propriétaire ; (b) bilan après les dix tickets qui suivent (a) : mots chargés au départ, itérations, écarts (commits `fix` ou `revert`, clôture rouverte, erreur qu'une règle déplacée aurait évitée), comparés aux dix tickets d'avant (T0.4 a à T3.2 : 8,5 itérations, 45 commits, aucun `fix` ni `revert` ; 4 479 mots au départ, consignes 2 655, passation 1 040, §0 et §2 784).
- **Où** : consignes locales (non suivies), `CONTRIBUTING.md` si une règle publique y manque.
- **Accepté si** : la moitié des mots au plus ; aucune règle de l'inventaire sans destination ; (b) une erreur qu'une règle déplacée aurait évitée remet cette règle dans les consignes, et la cure est défaite si les écarts montent.
- **Taille** S → (a) S, (b) S · **Prio** P1 · **Dépend de** — ; (b) : dix tickets clos après (a)

#### T0.21 — Comptage d'instructions : variantes natives qui bougent sans changement de leur code
- **Pourquoi** : un verdict A/B ne vaut que si une variante qui n'exécute rien de nous reste à « same work » ; le 2026-10-28, `equal` `native/realistic` (Node `util.isDeepStrictEqual` seul) passe de 1 427 732 à 1 551 433 instructions par appel (+8,664 %, reproduit à l'identique) entre `ce7724c` et `53d7d6f`, et `omit` `native/pathological` −0,257 %, quand seuls nos modules chargés à côté ont changé.
- **Faire** : trouver ce que compte la variante en plus (collecte du ramasse-miettes dans la fenêtre comptée, compilation, emplacement du tas), par la sortie de Callgrind par fonction ; isoler les variantes l'une de l'autre (processus, collecte forcée avant la fenêtre, ou soustraction mesurée) ; puis une garde : une variante native hors de « same work » rend le comptage non concluant au lieu de juger les autres.
- **Où** : `scripts/perf-count.ts`, `scripts/lib/perf-count.ts`, `bench/perf/`.
- **Accepté si** : `ce7724c` contre `53d7d6f` donne « same work » sur chaque variante native ; un changement fabriqué de nos seuls modules qui déplace une variante native fait sortir le comptage en « non concluant ».
- **Taille** S · **Prio** P1 · **Dépend de** T0.4 a

#### T0.22 — Catalogue adversarial : une boucle sans fin du code testé bloque la porte au lieu de la faire échouer
- **Pourquoi** : le 2026-10-30, une mutation de `topK` (tamisage qui ne descend plus) a fait tourner sans fin le contrôle `callbacks` : un rappel qui répond toujours « plus grand » ne s'arrête jamais, et la porte reste bloquée au lieu de rougir ; seuls les rappels qui agrandissent la collection sont bornés (`GROWTH_LIMIT`).
- **Faire** : borner dans `@yaltaan/testing` le nombre d'appels de chaque rappel de la catégorie `callbacks`, par une erreur distincte de `CallbackError` (que les contrôles acceptent), qui fait donc échouer le contrôle ; retirer la borne écrite à la main dans `packages/core/src/collection/order.test.ts`.
- **Où** : `packages/testing/src/callbacks.ts`, `packages/testing/src/declare.ts`, les contrôles `callbacks` des modules.
- **Accepté si** : la mutation « tamisage qui ne descend pas » de `topK` fait rougir `topK: callbacks` en moins d'une seconde sans borne locale ; chaque déclaration `callbacks` existante reste verte.
- **Taille** S · **Prio** P2 · **Dépend de** T0.5

### Lot 1 — Colonne vertébrale

#### T1.4 — `Path<T>` et `PathValue<T, P>` typés
- **Pourquoi** : un chemin typé attrape à la compilation ce qu'un chemin texte laisse au runtime, à condition de ne pas faire exploser le contrôle des types.
- **Faire** : chemins typés, profondeur bornée (hypothèse 8, calibrée par T0.3), dégradation explicite et documentée vers un chemin non typé au-delà ; plafond du nombre de chemins générés.
- **Où** : `packages/core/src/path/`.
- **Accepté si** : budget du coût des types tenu : premier usage d'un type public, `bench/types/usages/path.ts` (code d'application sur le `Model` de `bench/types/model.ts`, qui importe `@yaltaan/core` construit), son plafond d'instanciations par compilateur dans `bench/types/ceilings.tsv` et le seuil de +10 % calibrés par ADR (`node scripts/type-cost.ts`, sous TypeScript 7 et 6.0) ; tests de types ; messages d'erreur de compilation relus et lisibles.
- **Taille** M · **Prio** P0 · **Dépend de** T0.3, T1.3

#### T1.6 — Graphe réactif (`ReadableNode`)
- **Pourquoi** : tout le formulaire en dépend, et sa sémantique ne doit pas dépendre d'un framework (`ARCHITECTURE.md` §5.5).
- **Faire** : (a) nœuds source et dérivés, `get` et `subscribe` (le contrat de `useSyncExternalStore`), graphe push-pull paresseux sans glitch, batch explicite porté par une instance ou un appel, ordre topologique, aucun ordonnanceur global ; (b) détection des cycles à la construction, propriétés (aucun glitch observable sous entrelacements fast-check, aucun abonné qui fuit), conversion en signal Angular et en `customRef` Vue documentée.
- **Où** : `packages/core/src/reactive/`.
- **Accepté si** : (a) tests de glitch et de paresse ; (b) cycle refusé à la construction, budget ≤ 1 000 o brotli tenu (scénario `yaltaan/core-reactive`, ADR 0010).
- **Taille** L → (a) M, (b) M · **Prio** P0 · **Dépend de** T0.5

### Lot 2 — Tranche verticale

#### T2.1 — Formulaire pilote et ses scénarios
- **Pourquoi** : la tranche se juge sur un formulaire de la complexité d'un vrai, pas sur un exemple écrit pour une fonction.
- **Faire** : (a) écrire le pilote (§3, projet pilote) : étapes, champs, tableau dynamique, requis conditionnels, règles entre champs, validation serveur, et ses scénarios d'acceptation en données (entrée, issues attendues avec code et chemin) ; (b) les mêmes scénarios en tests exécutables dès que `schema` existe, chacun rouge avant la tranche.
- **Où** : `examples/pilot/`.
- **Accepté si** : (a) chaque règle et chaque issue d'un scénario cite un champ du pilote par son chemin, scénarios relus par le propriétaire ; (b) chaque scénario vu rouge, puis vert avec T2.2 et T2.3.
- **Taille** M → (a) S, (b) S · **Prio** P0 · **Dépend de** (b) T2.2

#### T2.2 — Schéma minimal conforme Standard Schema v1
- **Pourquoi** : premier domaine branché sur `Result`, `Issue` et `Path`, et porte d'entrée vers les moteurs tiers.
- **Faire** : `object`, `string`, `number`, `optional`, `nullable`, `array`, `literal`, union discriminée ; API en fonctions (tree-shaking) ; interface `~standard` (types recopiés, aucune dépendance) ; clés inconnues selon §3 ; clé absente, `undefined` et `null` distincts ; validation qui ne mute jamais l'entrée.
- **Où** : `packages/schema/`.
- **Accepté si** : un schéma consommé par `validateStandardSchema` d'Angular et par TanStack Form sans pont ; invariants d'`ARCHITECTURE.md` §7.9 en propriétés fast-check (déterminisme ; une valeur valide relue par son schéma redonne la même valeur, et `parse` est idempotent), plutôt qu'en exemples ; budget du schéma de connexion tenu (scénario `yaltaan/schema-login`, 1 500 o, ADR 0010).
- **Taille** M · **Prio** P0 · **Dépend de** T1.1, T1.2, T1.3

#### T2.3 — Cinq règles relationnelles
- **Pourquoi** : le différenciateur : des règles déclaratives qui fonctionnent dans n'importe quel moteur de formulaire (`ARCHITECTURE.md` §7.10).
- **Faire** : les cinq règles que le pilote exige parmi `requiredIf`, `allOrNone`, `atLeast`, `atMost`, `exactly`, `mutuallyExclusive`, `unique`, `ordered` ; chaque règle déclare ses dépendances et ses cibles ; lectures réelles tracées et comparées en mode test ; `requiredPaths(rules, values)` dérivé ; chaque règle utilisable comme raffinement Standard Schema.
- **Où** : `packages/rules/`.
- **Accepté si** : une règle qui lit hors de ses dépendances déclarées échoue en mode test ; `atLeast` monotone (propriété) ; les règles fonctionnent dans Angular Signal Forms sans `form`.
- **Taille** M · **Prio** P0 · **Dépend de** T2.2

#### T2.4 — Formulaire minimal
- **Pourquoi** : mesurer ce qu'un modèle de formulaire propre apporte face à Signal Forms et TanStack Form avant de s'y engager.
- **Faire** : (a) `field`, `group`, valeur brute et valeur lue, états dérivés (`dirty`, `touched`, `pending`, `submitted`, `disabled`) sur le graphe réactif ; (b) `array` à identité stable : issues et état attachés à la clé, pas à l'index ; (c) validation asynchrone : jeton de génération et `AbortSignal` par exécution, résultat périmé ignoré, suppression d'un nœud qui aborte ses validations, `pending` dérivé.
- **Où** : `packages/form/`.
- **Accepté si** : (b) un élément déplacé garde ses issues (propriété) ; (c) entrelacements explorés par `fc.scheduler()` sans résultat périmé livré ni double résolution.
- **Taille** L → (a) M, (b) M, (c) M · **Prio** P0 · **Dépend de** T1.6, T2.3

#### T2.5 — Pont Angular Signal Forms
- **Pourquoi** : Angular est la cible prioritaire, et Signal Forms est stable depuis Angular 22.
- **Faire** : règles de `rules` exposées en validateurs Signal Forms ; nœuds de `form` exposés en signaux ; aucun état propre au pont ; versions selon §3.
- **Où** : `packages/angular/`.
- **Accepté si** : le pilote tourne dans une vraie application Angular (test de composants) ; budget de l'adapter tenu (T0.2).
- **Taille** M · **Prio** P0 · **Dépend de** T2.4

#### T2.6 — Pilote de bout en bout et mesures
- **Pourquoi** : la décision go/no-go se prend sur des chiffres.
- **Faire** : pilote complet sur la tranche ; mesures : octets livrés, temps, re-rendus, coût des types, lignes de code de l'application, face au même formulaire écrit avec Signal Forms seul (et avec les seuls `schema` et `rules`) ; budgets de `rules`, de `form` et des adapters recalibrés sur cette mesure par un ADR qui remplace leurs hypothèses (ADR 0010).
- **Où** : `examples/pilot/`, `bench/`.
- **Accepté si** : chaque scénario de T2.1 vert ; tableau de mesures reproductible ; plus aucun budget `hypothesis` dans `bench/size/budgets.tsv`.
- **Taille** M · **Prio** P0 · **Dépend de** T2.5

#### T2.7 — Décision go/no-go de `form` et gel des contrats
- **Pourquoi** : `form` n'existe que si sa valeur face aux moteurs natifs est démontrée ; les contrats se gèlent après la preuve, pas avant.
- **Faire** : ADR go/no-go sur les mesures de T2.6 ; gel des contrats transverses (toute modification ultérieure = ADR et majeure) ; si non : plan de retrait (`schema` + `rules` + ponts vers les moteurs natifs) et lot 6 retiré.
- **Où** : `docs/adr/`, `ARCHITECTURE.md`.
- **Accepté si** : ADR accepté par le propriétaire.
- **Taille** S · **Prio** P0 · **Dépend de** T2.6

#### T2.8 — Juges externes du schéma
- **Pourquoi** : un schéma qui se dit conforme à Standard Schema et cohérent avec les moteurs courants doit être jugé par eux, pas par nos seuls tests.
- **Faire** : la suite de tests publiée de Standard Schema (si elle existe sous forme exécutable, sinon les exemples de sa spécification) branchée dans la porte ; comparaison différentielle avec valibot (déjà installé pour le banc, ADR 0009 ; en dépendance de test seulement, ADR) sur des entrées et des schémas générés par fast-check : même verdict, mêmes chemins d'issue ; chaque écart corrigé ou écrit comme différence voulue dans la doc du module.
- **Où** : `packages/schema/`, `packages/testing/src/`, `docs/adr/`.
- **Accepté si** : le juge vu rouge sur un défaut volontaire ; branché avant le premier schéma livré par T2.2, dès son premier test.
- **Taille** S · **Prio** P0 · **Dépend de** T0.17

### Lot 3 — Données

#### T3.3 — `core/collection`
- **Pourquoi** : seulement ce qui manque au natif (`ARCHITECTURE.md` §7.2).
- **Faire** : (a) par clé (ADR 0024) : `partition`, `indexBy`, `countBy`, `uniqueBy`, `intersectionBy`/`differenceBy` ; (b) par ordre : `minBy`/`maxBy`, `topK` (tas), `sortBy` multicritère, `paginate` ; (c) `chunk`, `window`, `zip` paresseux sur itérables (générateurs, sans dépendre des assistants d'itérateurs tant qu'ils sont hors baseline), `mapConcurrent`.
- **Où** : `packages/core/src/collection/`.
- **Accepté si** : (a) `partition` garde chaque élément et leur ordre, `uniqueBy` idempotent, `intersectionBy` et `differenceBy` partagent leur entrée, chacune jugée contre es-toolkit (ADR 0022) ; (b) `topK(xs, k)` égal à `xs.toSorted(cmp).slice(0, k)` (propriété de cohérence avec le natif) ; un comparateur non transitif ne boucle ni ne lève.
- **Taille** L → (a) M, (b) M, (c) M · **Prio** P1 · **Dépend de** T1.5

#### T3.4 — `core/string`
- **Pourquoi** : longueur et troncature par graphème, `slugify` aux règles écrites, détection des caractères invisibles et des contrôles bidirectionnels (attaques Trojan Source).
- **Faire** : `graphemeLength`, `truncate` (sur `Intl.Segmenter`), `slugify`, `normalizeWhitespace`, détection des invisibles et des contrôles bidirectionnels.
- **Où** : `packages/core/src/string/`.
- **Accepté si** : idempotences ; `truncate` ne coupe jamais un graphème (fuzz Unicode).
- **Taille** M · **Prio** P1 · **Dépend de** T0.5

#### T3.5 — `core/number`
- **Pourquoi** : `parseFloat` accepte n'importe quoi ; les arrondis nommés manquent.
- **Faire** : `parseNumber` strict (séparateurs explicites, `Result`), `clamp`, `inRange`, `approxEqual`, `round` à modes nommés, conversions `number` ↔ `bigint` exactes ou en erreur.
- **Où** : `packages/core/src/number/`.
- **Accepté si** : aucune conversion implicite avec perte ; aller-retour `parseNumber(format(x))` pour les formats déclarés ; scénario de taille `core-ten-primitives` (primitives de `object`, `collection` et `number`), son budget de 1 000 o remesuré (`pick` et `omit` profonds pèsent déjà environ 630 o ensemble, ADR 0021 ; `merge`, `defaults`, `mapValues` et `mapKeys` 743 o).
- **Taille** M · **Prio** P1 · **Dépend de** T1.1

#### T3.6 — `core/diff` et patch
- **Pourquoi** : un diff au format `Path` sert l'historique, les brouillons et la synchronisation sans conversion.
- **Faire** : (a) `diff` et `apply` sur objets, cycles refusés, références des sous-arbres non touchés conservées ; (b) tableaux par index ou par clé, opérations `move` ; (c) patch inversible en option, conversion RFC 6902 à la frontière.
- **Où** : `packages/core/src/diff/`.
- **Accepté si** : `apply(diff(a, b), a)` égal à `b`, `diff(a, a)` vide, `apply(invert(p), apply(p, a))` égal à `a` (propriétés).
- **Taille** L → (a) M, (b) M, (c) S · **Prio** P1 · **Dépend de** T1.5, T3.2

#### T3.7 — `core/async`
- **Pourquoi** : annulation, limite de concurrence et résultat jamais périmé, réécrits à la main dans chaque application.
- **Faire** : (a) `withTimeout`, `retry`, `createLimiter`, `latest`, `dedupe` ; (b) `debounce`, `throttle`, `createQueue` ; tout accepte un `AbortSignal`, annulation = rejet avec `signal.reason`, horloge injectable, aucun minuteur global.
- **Où** : `packages/core/src/async/`.
- **Accepté si** : jamais de résultat périmé ni de double résolution sous `fc.scheduler()` ; signal déjà aborté = rejet immédiat sans exécuter la tâche.
- **Taille** L → (a) M, (b) M · **Prio** P1 · **Dépend de** T0.5

#### T3.8 — `core/cache`
- **Pourquoi** : un cache non borné est une fuite de mémoire différée.
- **Faire** : `createLru` (taille maximale obligatoire, poids, TTL, horloge), `memo`, `memoAsync` (déduplication en vol, stale-while-revalidate, cache négatif en option), `memoWeak` ; toujours une instance.
- **Où** : `packages/core/src/cache/`.
- **Accepté si** : éviction LRU déterministe (propriété contre un modèle de référence) ; aucune croissance au-delà du maximum.
- **Taille** M · **Prio** P1 · **Dépend de** T3.7

#### T3.9 — `equal` : autres types natifs
- **Pourquoi** : `equal` compare par identité `RegExp`, `ArrayBuffer`, `DataView`, `Error`, `URL` et les objets enveloppes (`new Number(1)`), alors qu'es-toolkit et Node comparent au moins les deux premiers par contenu (ADR 0020).
- **Faire** : pour chaque type, trancher ce qui fait son contenu (`lastIndex` d'une expression régulière, `cause` d'une erreur, octets d'un tampon), l'ajouter au tableau de support ou motiver son identité ; mesurer les octets ajoutés au scénario `yaltaan/core-equal`.
- **Où** : `packages/core/src/equal/`, `docs/guide/{en,fr}/equal.md`.
- **Accepté si** : chaque type listé est comparé par contenu ou porte sa raison dans le tableau de support ; budget de 1 750 o tenu ; mêmes propriétés que T1.5 (réflexivité, symétrie).
- **Taille** S · **Prio** P2 · **Dépend de** T1.5

#### T3.10 — Chemins typés : `Path<T>` et `PathValue<T, P>`
- **Pourquoi** : `get` rend `unknown` et `set`, `update`, `remove` le type de leur entrée sans suivre le chemin (ADR 0023) ; `ARCHITECTURE.md` §5.3 promet des chemins typés, à profondeur bornée, qui rendraient ces types exacts.
- **Faire** : `Path<T>` (les chemins d'un `T`, profondeur bornée à 8, mesurée) et `PathValue<T, P>` ; surcharges typées de `get`, `set`, `update`, `remove` quand le chemin est littéral, repli explicite vers le chemin non typé au-delà ; coût des types mesuré (T0.3).
- **Où** : `packages/core/src/path/`, `packages/core/src/object/access.ts`.
- **Accepté si** : un segment mal orthographié dans un chemin littéral est une erreur de compilation ; `get(x, ['a', 0])` typé comme `x.a[0]` ; coût des types dans son seuil, nombre d'instanciations par usage publié.
- **Taille** M · **Prio** P1 · **Dépend de** T3.2

### Lot 4 — Temporal

#### T4.1 — Intervalles
- **Pourquoi** : Temporal n'a pas d'intervalle ; chaque application en réécrit un.
- **Faire** : `Interval<T>` semi-ouvert `[start, end)` par défaut, intervalle inversé refusé à la construction, intervalle vide explicite ; `overlaps`, `contains`, `intersect`, `union`, `gaps`, `mergeAll`.
- **Où** : `packages/temporal/`.
- **Accepté si** : intersection commutative et associative, `union` d'intervalles disjoints qui conserve la mesure (propriétés), sur Temporal natif et sur le polyfill recommandé.
- **Taille** M · **Prio** P1 · **Dépend de** T1.1, décision §3 (Temporal)

#### T4.2 — Lecture de formats déclarés
- **Pourquoi** : une chaîne de date ambiguë ne doit jamais être devinée.
- **Faire** : `parsePlainDate(text, { format, pivotYear })` et suivants → `Result` ; sans format explicite, une chaîne ambiguë donne l'issue `temporal.ambiguous_format`.
- **Où** : `packages/temporal/`.
- **Accepté si** : `parse(format(x, f), f)` égal à `x` pour chaque format déclaré ; fuzz du lecteur.
- **Taille** M · **Prio** P1 · **Dépend de** T4.1

#### T4.3 — Conversions de frontière et calendrier ouvré
- **Pourquoi** : la frontière `Date` ↔ Temporal est la première source de bugs de fuseau.
- **Faire** : `fromDate` et `toDate` qui exigent un fuseau explicite ; `startOf`/`endOf` (semaine avec `firstDayOfWeek` explicite, trimestre) ; jours ouvrés avec jours fériés injectés (aucune donnée embarquée).
- **Où** : `packages/temporal/`.
- **Accepté si** : aucune conversion sans fuseau ne compile ; tests sous plusieurs fuseaux forcés.
- **Taille** M · **Prio** P1 · **Dépend de** T4.1

#### T4.4 — Codecs des types Temporal
- **Pourquoi** : sérialiser un formulaire qui contient des dates sans code de colle.
- **Faire** : codecs `schema` pour les types Temporal, dans un sous-chemin séparé pour ne pas faire dépendre `temporal` de `schema`.
- **Où** : `packages/temporal/`.
- **Accepté si** : `decode(encode(x))` égal à `x` ; le sous-chemin principal de `temporal` n'embarque rien de `schema` (T0.2).
- **Taille** S · **Prio** P1 · **Dépend de** T4.2, T5.2

#### T4.5 — Tests Temporal de test262 avant le code de `temporal`
- **Pourquoi** : le paquet `temporal` s'appuie sur Temporal natif et sur un polyfill ; test262 est le juge officiel de leur comportement, et dit sur quelles implémentations nos fonctions peuvent compter.
- **Faire** : sous-ensemble de `test/built-ins/Temporal/` de test262 (épinglé à un commit, téléchargé et vérifié par somme, jamais dans le verrou npm) exécuté sur le Temporal natif de Node 26 et sur temporal-polyfill ; écarts publiés par implémentation ; les fonctions de T4.1 à T4.4 n'utilisent que ce qui passe partout, ou documentent la différence.
- **Où** : `scripts/`, `packages/temporal/`, `docs/adr/`.
- **Accepté si** : résultats par implémentation versionnés et rejoués à l'identique ; un test test262 rendu faux exprès fait échouer la porte.
- **Taille** M · **Prio** P1 · **Dépend de** T0.17

### Lot 5 — Schéma et règles complets

#### T5.1 — Combinateurs complets
- **Pourquoi** : couvrir les formes de données réelles.
- **Faire** : (a) `record`, `tuple`, `map`, `set`, `union`, `intersect`, `lazy` (récursif et mutuellement récursif), `default` ; (b) raffinements, transformations, `partial`, `deepPartial`, `pick`, `omit`, `extend` ; ordre d'évaluation documenté (structure → enfants → raffinements du parent), `abortEarly` en option.
- **Où** : `packages/schema/`.
- **Accepté si** : déterminisme et idempotence de `parse` sur une valeur valide sans transformation (propriétés).
- **Taille** L → (a) M, (b) M · **Prio** P1 · **Dépend de** T2.7

#### T5.2 — Codecs bidirectionnels
- **Pourquoi** : un codec est un schéma réversible ; une transformation sans `encode` doit l'être au niveau des types.
- **Faire** : `codec(schema, encode)` ; appeler `encode` sur une transformation non réversible est une erreur de compilation.
- **Où** : `packages/schema/`.
- **Accepté si** : `decode(encode(x))` égal à `x` (propriété) ; test de type `@ts-expect-error` sur une transformation non réversible.
- **Taille** M · **Prio** P1 · **Dépend de** T5.1

#### T5.3 — Versions et migrations
- **Pourquoi** : les brouillons et les données stockées survivent aux évolutions du schéma.
- **Faire** : `versioned({ 1: s1, 2: s2 }, migrations)`, migrations chaînées, version inconnue → `schema.unknown_version`.
- **Où** : `packages/schema/`.
- **Accepté si** : toute donnée v1 valide migre en v2 valide (propriété).
- **Taille** M · **Prio** P1 · **Dépend de** T5.1

#### T5.4 — Raffinements asynchrones
- **Pourquoi** : la validation serveur entre dans le même modèle que la validation locale.
- **Faire** : raffinements asynchrones séparés ; `parse` synchrone refuse un schéma asynchrone au niveau des types ; contexte externe passé explicitement, jamais global.
- **Où** : `packages/schema/`.
- **Accepté si** : test de type de refus ; annulation par `AbortSignal`.
- **Taille** M · **Prio** P1 · **Dépend de** T5.1, T3.7

#### T5.5 — Limites de sécurité et fuzz du schéma
- **Pourquoi** : un schéma valide des entrées non fiables.
- **Faire** : options de lecture à défauts finis (profondeur 64, 10 000 clés, 1 000 000 éléments : hypothèses à calibrer) ; fuzz continu des parseurs.
- **Où** : `packages/schema/`.
- **Accepté si** : chaque limite atteinte donne une issue à code stable, sans exception ni temps non borné.
- **Taille** S · **Prio** P1 · **Dépend de** T5.1

#### T5.6 — Toutes les règles
- **Pourquoi** : compléter le différenciateur.
- **Faire** : le reste de `ARCHITECTURE.md` §7.10 (`aggregate`, `when`, `withContext`, et les règles non faites en T2.3) ; explication « pourquoi ce champ est-il requis ? ».
- **Où** : `packages/rules/`.
- **Accepté si** : invariants de §7.10 en propriétés ; détection de cycles entre règles.
- **Taille** M · **Prio** P1 · **Dépend de** T2.7

#### T5.7 — Interopérabilité Standard Schema vérifiée
- **Pourquoi** : « pas de verrouillage » se prouve dans les deux sens.
- **Faire** : `rules` et `form` acceptent des schémas zod, valibot et arktype ; nos schémas validés par au moins deux moteurs tiers (TanStack Form, résolveurs de react-hook-form, Angular Signal Forms).
- **Où** : `tests/interop/` (dépendances de test, ADR).
- **Accepté si** : matrice d'interopérabilité verte en CI.
- **Taille** S · **Prio** P1 · **Dépend de** T5.1

### Lot 6 — Formulaire complet (si go)

#### T6.1 — Erreurs serveur
- **Pourquoi** : une erreur serveur doit survivre à un réordonnancement et s'effacer au bon moment.
- **Faire** : import d'`Issue` avec `Path` (segments `{ key }` compris) ; politique `clearOn: 'change' | 'submit'` ; catégories (validation, métier, autorisation, transport) portées par l'espace de noms du code.
- **Où** : `packages/form/`.
- **Accepté si** : une erreur serveur suit son élément déplacé (propriété).
- **Taille** M · **Prio** P1 · **Dépend de** T2.7 (go)

#### T6.2 — Brouillons
- **Pourquoi** : reprendre un formulaire après une mise à jour du schéma.
- **Faire** : instantané = valeur brute + version de schéma ; restauration par les migrations du schéma.
- **Où** : `packages/form/`.
- **Accepté si** : un brouillon v1 restauré sous un schéma v2 (test).
- **Taille** M · **Prio** P1 · **Dépend de** T5.3, T6.1

#### T6.3 — Multi-étapes
- **Pourquoi** : sans moteur dédié : une étape est un sous-ensemble de chemins.
- **Faire** : valider une étape = filtrer les issues par chemins ; recette.
- **Où** : `packages/form/`, documentation.
- **Accepté si** : le scénario multi-étapes du pilote passe sans code spécifique.
- **Taille** S · **Prio** P1 · **Dépend de** T6.1

#### T6.4 — Pont React
- **Pourquoi** : seconde cible après Angular.
- **Faire** : pont `useSyncExternalStore` ; `useField(form, path, selector?)` pour limiter les re-rendus ; aucun fournisseur de contexte obligatoire.
- **Où** : `packages/react/`.
- **Accepté si** : re-rendus mesurés sur un vrai composant ; budget de l'adapter tenu.
- **Taille** M · **Prio** P1 · **Dépend de** T2.7 (go)

#### T6.5 — Second projet pilote
- **Pourquoi** : un modèle validé sur un seul formulaire n'est pas validé.
- **Faire** : un second formulaire réel, de préférence sous React.
- **Où** : `examples/`.
- **Accepté si** : scénarios verts, mesures publiées.
- **Taille** M · **Prio** P1 · **Dépend de** T6.4

#### T6.6 — Pont Vue
- **Pourquoi** : troisième framework, après la preuve sur les deux premiers.
- **Faire** : nœuds exposés en `customRef`.
- **Où** : `packages/vue/`.
- **Accepté si** : composant réel testé ; budget tenu.
- **Taille** M · **Prio** P3 · **Dépend de** T6.4

### Lot 7 — Durcissement vers 1.0

#### T7.1 — Fuzz continu
- **Pourquoi** : les parseurs (chemins, nombres, dates, schémas) lisent des entrées non fiables.
- **Faire** : campagne de fuzz planifiée en CI sur chaque parseur, graines rejouables committées.
- **Où** : `.github/workflows/`, `tests/fuzz/`.
- **Accepté si** : une graine qui fait échouer un parseur devient un test de non-régression.
- **Taille** M · **Prio** P1

#### T7.2 — Documentation complète
- **Pourquoi** : « ce que ça ne fait pas » est aussi utile que l'API.
- **Faire** : référence générée (T0.6), guides par domaine (amorcés en anglais et en français dans `docs/guide/`, tenus à jour par chaque ticket, §8 ; reste : un guide par paquet au-delà de `core`), recettes (formateur d'issues livré ; résolution de locale, configuration), équivalents natifs documentés.
- **Où** : `docs/`.
- **Accepté si** : chaque exemple de la documentation est exécuté par la porte.
- **Taille** M · **Prio** P1

#### T7.3 — Audit de la chaîne d'approvisionnement avant 1.0
- **Pourquoi** : la 1.0 engage la confiance des utilisateurs.
- **Faire** : relecture complète des dépendances de développement, des workflows, des permissions et de la publication ; Scorecard et badge OpenSSF (dépôt public).
- **Où** : `.github/`, `docs/`.
- **Accepté si** : constats corrigés ou motivés par ADR.
- **Taille** S · **Prio** P1

#### T7.4 — Promotion en `@stable`, module par module
- **Pourquoi** : la rigueur maximale s'exige à la promotion, pas à la naissance (`ARCHITECTURE.md` §10.5).
- **Faire** : un ADR de promotion par module : catalogue adversarial testé, propriétés, benchmark si chemin chaud, documentation complète, usage réel.
- **Où** : `docs/adr/`.
- **Accepté si** : chaque critère de §10.5 coché par preuve.
- **Taille** M (répété) · **Prio** P1

#### T7.5 — Version 1.0
- **Pourquoi** : 1.0 = uniquement des modules `@stable`.
- **Faire** : retrait ou maintien explicite de chaque module `@experimental` ; publication.
- **Où** : tout le dépôt.
- **Accepté si** : aucun export `@experimental` dans un paquet 1.0.
- **Taille** S · **Prio** P1 · **Dépend de** T7.4

## 6. Hors feuille de route

Rien d'autre n'est planifié ni refusé. Un besoin qui n'apparaît ni en §4 ni en §5 est **à instruire** : l'ajouter comme ticket, ne jamais le supposer exclu.

## 7. Jalons mesurables

- **0.1.0 expérimentale** : lots 0, 1 et 2 clos ; décision go/no-go de `form` prise ; contrats transverses gelés ; première publication avec provenance.
- **0.x** : lots 3 à 6, chaque module publié `@experimental` dans ses budgets de taille et de coût des types.
- **1.0** : lot 7 clos ; uniquement des modules `@stable`.

## 8. Définition de fini (commune à tous les tickets)

1. `bash scripts/verify.sh` affiche `OK` (gardes, format, types, tests, construction, manifestes, licences et sources du verrou, puis, au fil de leur arrivée, taille, coût des types, graphe des dépendances, tags de contrat, catalogue adversarial, baseline).
2. Taille : rapport de taille sans écart non expliqué ; si la référence change, l'écart par paquet et sous-chemin figure dans le message de commit, toute hausse expliquée (dès T0.2).
3. Coût des types dans son seuil (dès T0.3) ; comptage A/B des chemins chauds, tableau dans le message de commit (dès T0.4).
4. Chaque export touché porte ses tags de contrat (dès T0.6) et sa déclaration adversariale (dès T0.5).
5. Un bogue corrigé = un test de non-régression ; une régression de *processus* = un garde-fou mécanique.
6. ADR pour tout nouveau paquet, nouvelle dépendance, contrat modifié, exception ou promotion ; `CHANGELOG.md` pour tout changement visible.
7. Ticket déplacé en §9 avec le hash du commit.
8. Fonctionnalité visible de l'utilisateur : sa page du guide, en anglais et en français (`docs/guide/`, §3), exemples exécutés par la porte.

## 9. Clos

Une ligne par ticket : `identifiant — commit — résultat mesuré — itérations consommées` (format de §0).

| Ticket | Commit | Résultat | Itérations |
|---|---|---|---|
| T0.1 | `chore: start the repository with guards on what a commit may name`, puis `style(scripts): keep the commit-message guard within 120 columns`, `build: set up the npm workspace and its TypeScript toolchain`, `ci: add the verification gate and the guards it runs`, `ci: run the gate, the Node matrix and a secret scan on GitHub`, `docs: describe the library, its decisions and its plan` (cités par sujet : commits de journée sur `wip`, rejoués ensuite) | Dépôt, porte `verify.sh` (18 étapes), 10 gardes et contrôles, crochets pre-commit/commit-msg/pre-push, CI (porte, Node 22/24/26, gitleaks, « CI passed ») et Scorecard, `ARCHITECTURE.md`, ADR 0001 à 0007, documents publics. 64 tests, chaque garde neutralisée vue rouge ; porte verte sous Windows et sous Linux (WSL, Node 22.23.3, npm 10.9.9) ; actions épinglées vérifiées par `git ls-remote`, sommes d'actionlint et de gitleaks égales à celles publiées ; outillage 6 paquets, 43,4 Mo. | 1 (M) |
| T0.2 | `e3aa190` build: add the bundlers and reference libraries of the size harness ; `86865d1` ci: measure each import scenario with esbuild and Rollup against a baseline ; `57d30c7` docs(adr): calibrate the import budgets against the reference libraries | `scripts/size-report.ts` sur `esbuild-wasm` 0.28.2 et `@rollup/wasm-node` 4.64.0 (ADR 0009) : 5 scénarios de référence, 10 bundles, base `docs/size-baseline.tsv` à l'octet, fuites d'import, écarts de résolution entre bundlers et budgets vérifiés ; fuite fabriquée vue rouge, comme chaque garde neutralisée ; recoupé par bundlejs.com à l'octet (es-toolkit, valibot), temporal-polyfill à 0,23 % près en compression ; mêmes tailles sous Node 22 (brotli 1.1.0) et 24 (1.2.0), trois passes identiques ; budgets (ADR 0010) : `omit` 150 o, dix primitives 1 000, graphe réactif 1 000, schéma de connexion 1 500, couche Temporal 1 790 ; tests 65 → 79 ; +25,5 Mo installés. | 1 (M) |
| T0.7 | `f4be106` docs(adr): check the dependency graph with Rollup's parser and tsc ; `dae91cd` build: let a package depend on the workspace packages below it ; `70d70bf` ci: check the dependency graph and the module rules after the build | `scripts/check-dependency-graph.ts` (étape de la porte après la construction, 0,23 à 0,30 s sans paquet construit) : graphe lu dans `ARCHITECTURE.md` §6, arêtes = `dependencies`/`peerDependencies` des package.json (arête interne = version exacte du workspace, vérifiée par `check-manifests.ts`), modules de `dist/` lus par `parseAst` (imports déclarés et par sous-chemin exporté, aucun barrel d'un autre paquet, corps de module en déclarations seules), imports de types lus par `tsc --listFilesOnly` ; dependency-cruiser 18.6.0 écarté (TypeScript < 7 seulement : 0 module lu, sortie 0) ; toute forme acceptée au chargement est éliminée par Rollup et par esbuild (vérifié en test) ; import core → schema, adapter → adapter, appel au niveau module vus rouges en test et dans la porte du vrai dépôt ; 14 gardes neutralisées une à une, chacune rouge ; tests 79 → 100 ; porte verte sous Windows (Node 24.17.0) et Linux (WSL, Node 22.23.3) sur `70d70bf`. | 1 (S) |
| T0.6 | `ff4a6e1` docs(adr): read contract tags through the compiler's unstable API ; `5bea87d` ci: check the contract tags of every public export after the build | `scripts/check-contract-tags.ts` (étape de la porte après la construction, 0,15 à 0,18 s sans paquet construit) : `.d.ts` de chaque sous-chemin de `exports` lus par `typescript/unstable/sync` 7.0.2 (adaptateur unique `scripts/lib/declarations.ts`, 0 octet ajouté), exports de valeur recoupés par les clés du module chargé par Node, liste unique des tags dans `scripts/lib/contract-tags.ts`, référence `docs/reference/` générée (`--update`) et comparée à l'octet ; `@typescript/typescript6` mesuré en repli (2 paquets, 24,4 Mo, 0,38 s) ; export sans tag, tag inconnu, `@mutates` d'un paramètre absent vus rouges en test et dans la porte du vrai dépôt (source temporaire de `core`, seule l'étape en échec), lecture recoupée par TypeScript 6.0.3 ; 33 gardes neutralisées une à une, chacune rouge ; référence identique sur deux exécutions et deux dossiers ; tests 102 → 128 ; porte verte sous Windows (Node 24.17.0) et Linux (WSL, Node 22.23.3) sur `5bea87d`. | 1 (M) |
| T0.5 | `168f8f1` docs(adr): propose fast-check for the shared adversarial catalogue ; `3f3ba3b` docs(adr): accept fast-check and the declaration rule for adversarial tests ; `02d9e64` build: add fast-check for property and adversarial tests ; `a2612fb` ci: let internal packages stay outside the graph and the publishing checks ; `bf00a30` test: add the shared adversarial catalogue as the internal testing package ; `978477e` ci: fail the gate on an export that does not declare its adversarial cases | Paquet interne `@yaltaan/testing` (jamais publié, hors graphe ; liste unique des paquets internes en §6 d'`ARCHITECTURE.md`, lue par le graphe, les manifestes, les tags, le contenu des paquets et la garde de taille) : 6 catégories, 73 cas nommés construits neufs à chaque appel, valeurs aléatoires par fast-check 4.10.2 (ADR 0013, acté par le propriétaire : 2 paquets, 1 588 005 octets, MIT, provenance vérifiée) ; `declareAdversarial()` (contrôle, N/A ou différé, déclaration refusée en bloc si une entrée est fausse) ; rapporteur de tests qui écrit un enregistrement par catégorie quand la porte le demande ; étape « adversarial catalogue » (0,09 s sans source) : export sans déclaration, déclaration orpheline ou d'un export qui ne s'exécute pas, catégorie absente ou en double, contrôle en échec ou sauté, `@stable` qui diffère, refusés ; recoupé dans la porte du vrai dépôt (source temporaire de `core` : étape rouge sans déclaration, porte verte une fois déclarée ; un test qui supposait le dépôt sans export, corrigé) ; règle retirée → 2 tests rouges ; tests 128 → 170, verts sous Node 22.23.3, 24.21.0 et 26.12.0 ; porte 6,95 → 7,55 s. | 1 (M) |
| T0.3 | `b6f4387` docs(adr): propose TypeScript 6.0 for the type-cost harness ; `5212aa9` docs(adr): accept TypeScript 6.0 for the type-cost harness ; `742a3ae` build: install only direct dependencies at the top, one owner per command ; `b4dcafc` build: add TypeScript 6.0 for the type-cost harness and the type tests ; `75f4331` ci: measure the type-check cost of the public types under TypeScript 7 and 6.0 | `scripts/type-cost.ts` (étape « type cost », 3,98 à 4,11 s sur 3 passes) : projet de référence généré de 2 000 fichiers (`scripts/lib/type-project.ts`, modèle commun `bench/types/model.ts`), vérifié par `--extendedDiagnostics` sous `tsc` 7.0.2 et `tsc6` 6.0.3 (ADR 0014, acté par le propriétaire : `@typescript/typescript6` 6.0.2, 2 paquets, 24 358 478 octets), avec et sans `exactOptionalPropertyTypes` ; comptes d'instanciations enregistrés dans `docs/type-cost-baseline.tsv` (110 220 / 110 224 sous 7, 110 055 / 110 056 sous 6.0), identiques sur trois exécutions et sous Node 22.23.3, 24.21.0 et 26.12.0 ; plafond par usage et par compilateur (`bench/types/ceilings.tsv`, vide tant qu'aucun type public n'existe) ; temps jugé sous 7 sur la médiane de 5 passes entrelacées, contre la dispersion des passes ; chemin récursif à la profondeur 9 refusé par un plafond que la profondeur 4 tient, récursion non bornée refusée (TS2615), sous les deux compilateurs, chaque assertion vue rouge ; la 6.0 remontée en tête de `node_modules` remplaçait `tsc` (`npx tsc -v` → 6.0.3) : installation `shallow` (ADR 0015) et garde du verrou « une commande, un paquet », vue rouge sur le verrou réel remis à plat ; tests 170 → 184 ; porte 7,55 → 15,7 s (machine chargée). | 1 (M) |
| T0.4 a | `b994191` docs(adr): decide between two commits by counting instructions under Callgrind ; `fe7719e` docs(adr): time the benchmarks with a harness written in the repository ; `e4f089f` test(bench): count the instructions of each scenario at two commits | `scripts/perf-count.sh <A> <B>` (`--worktree`, `--repeat`, `--clean`) : arbres extraits et réutilisés par empreinte, paquets construits, types retirés d'avance, deux processus par variante (N et 2N appels), V8 `--predictable`, graines fixes, un seul fil ; Node 24.21.0 suffit (3 comptages : 1 956 instructions d'écart sur 2,2 milliards ; 0,3 % sans les drapeaux) ; retrait des types par Node en WebAssembly = ±28,4 millions d'instructions par processus selon l'horloge, supprimé en chargeant du JavaScript (10 comptages parallèles : 7 837 d'écart) ; 5 comptages du même arbre : écart maximal 0,0291 % par appel, seuil 0,10 % (ADR 0016) ; régression fabriquée (105 enregistrements au lieu de 100) : +4,122 %, « MORE work », sortie 3, autres variantes à 0,018 % au plus, recoupée au chronomètre (+4,7 à +5,2 %, 5 passes) ; scénarios `omit` et connexion, chaque côté égal aux autres (test vu rouge) ; harnais chronométré décidé par le propriétaire (ADR 0017 : sans dépendance, contre la recommandation tinybench) ; tests 184 → 200, verts sous Node 22.23.3, 24.21.0, 26.12.0 ; porte 14 s. | 1 (M) |
| T0.4 b | `67a2b44` ci: derive the roadmap's progress column from its closed table ; `3397aaa` docs(adr): read allocations from heap growth and time each variant in passes ; `a30b84d` test(bench): time each scenario in batches, floor subtracted, with its allocations | `scripts/perf-time.sh` : un processus neuf par variante et par passe, lots d'au moins 10 µs (relevés tant que la médiane des 30 derniers échantillons est en dessous), plancher soustrait et publié, p50, p99, min, max, moyenne et marge à 95 %, trois passes et leur dispersion, alimentation et gouverneur, épinglage `--cpu` ; octets par appel : croissance du tas sans collecte, médiane de cinq fenêtres, recoupée par la comptabilité du ramasse-miettes (0,2 % près) et une fois par l'échantillonneur du tas (1,8 % près, 7,7 % sur valibot/micro) ; étalonnage : fonction vide −0,24 à −0,28 ns, fonction plancher −0,12 à 0,00 ns, travail double 1,90 à 2,11 fois, chaque contrôle vu rouge ; seconde lecture : tinybench à 2,8 % près, mitata plus haut avec les allocations (+1 à +19 %, ses échantillons longs étalent les collectes) ; deux exécutions complètes en 36,7 et 37,0 s ; tests 200 → 213 plus l'étape chronométrée seule (2,3 s), verts sous Node 22.23.3, 24.21.0, 26.12.0 ; colonne « Avancement » de §2 calculée depuis §9 et vérifiée par la porte. | 1 (S) |
| T1.1 | `e4fb34c` test(testing): assert type equality in type tests ; `f181272` feat(core): return expected failures as a Result, the first core subpath | `@yaltaan/core/result` : `Result<T, E>`, `Ok`, `Err`, `ok`, `err`, `mapResult`, `unwrapOr`, tous `@experimental` ; première source de `core` (`tsconfig.build.json` sans les tests, tests vérifiés par la configuration racine) ; 4 exports déclarés (20 contrôles adversariaux passés, 4 N/A), propriétés d'identité et de composition, tests de types (`Equal`, `assertType`, 5 erreurs attendues), mutations vues rouges ; scénario `yaltaan/core-result` 209 o bruts, 121 / 122 o brotli (Rollup / esbuild) pour un budget de 150 o (hypothèse, classe de `core-omit`), recoupé à l'octet par esbuild en ligne de commande ; référence `docs/reference/core.md` (7 exports) ; tests 221 → 532 ; porte verte en 18,5 s. | 0,5 (S) |
| T1.3 | `1cb197a` feat(core): add Path, its text form at the boundaries, and the write check | `@yaltaan/core/path` : `Path`, `PathSegment`, `KeySegment`, `PathIssue` (5 codes `path.*`), `parsePath` (bornes 4 096 unités de code et 64 segments), `formatPath`, `checkWritablePath` (`__proto__`, `constructor`, `prototype`), tous `@experimental` ; grammaire écrite (noms ASCII, index canoniques, clés en chaîne JSON), une seule graphie par chemin ; aller-retour vérifié par propriétés (surrogats isolés, `.`, `[`, `]`, `\`, clé vide), fuzz de 2 000 textes sans exception, 8 textes hostiles de taille maximale lus en 0,5 ms (retour arrière réintroduit : plus de 120 s), aucune écriture dans `Object.prototype` ; 3 exports déclarés (14 contrôles adversariaux, 4 N/A), 7 mutations vues rouges ; scénario `yaltaan/core-parse-path` 637 / 639 o brotli pour un budget de 750 o (1,5 × `toPath` d'es-toolkit, 495 / 496 o, nouvelle référence sans dépendance), sous-chemin entier 825 o ; tests 532 → 762 ; ticket T0.16 ouvert (caractères invisibles en clair). | 0,5 (M) |
| T1.2 | `fd6a3ce` feat(core): add Issue, its Standard Schema boundary and a registry of codes ; `d37b040` docs(guide): explain each core feature in English and French, examples run | `@yaltaan/core/issue` : `Issue`, `IssueSeverity`, `IssueFormatter`, `StandardIssue`, `StandardPathSegment`, `ExternalIssue`, `ToStandardIssueOptions`, `toStandardIssue` (`{ key }` résolu par `resolveKey` ou chemin coupé avant lui), `fromStandardIssue` (`issue.external`), tous `@experimental` (ADR 0019) ; `PathIssue` est une `Issue` (test de types) ; registre `docs/issue-codes/core.md` (6 codes) et étape « issue codes » : code sans ligne, ligne vivante sans code, ligne committée disparue ou redatée, retrait hors SemVer, chacun vu rouge sur un dépôt factice ; codes vus à l'exécution recoupés avec le registre ; issues d'un vrai schéma valibot 1.5.0 lues avec leurs chemins ; recette de formateur anglais complète par test ; 3 mutations vues rouges (48, 8, 21 échecs) ; scénario `yaltaan/core-issue` 487 / 498 o brotli (507 / 517 avant réduction des messages) pour un budget de 550 o (hypothèse) ; guide anglais et français (`docs/guide/`, 4 pages par langue, schémas Mermaid) et étape « documentation examples » : 27 exemples de 10 documents compilés et exécutés, 59 résultats vérifiés, parité des blocs de code entre langues, 0,13 s ; tests 762 → 946 ; porte verte en 27,7 s. | 1 (M) |
| T1.5 | `5262537` feat(core): add equal, a deep equality that ends on cycles at any depth | `@yaltaan/core/equal` : `equal`, `EqualOptions` (`equality` SameValueZero ou SameValue, `symbols`), `@experimental` (ADR 0020 : bisimulation, éléments de `Set` et clés de `Map` par SameValueZero, trou ≠ `undefined`, prototypes `Object.prototype` et `null` confondus, Temporal par `equals`, `Duration` champ par champ, autres objets par identité) ; pile explicite (10 000 niveaux), mémoire des paires dès la 64ᵉ (échelle de 60 niveaux, 2^60 chemins, en temps linéaire) ; taille 946 / 948 o brotli (budget 1 750 o, `isEqual` d'es-toolkit 1 162 / 1 166 o) ; propriétés : réflexivité, symétrie, accord avec `Object.is` et avec `isDeepStrictEqual` de Node sur JSON ; catalogue adversarial 48 contrôles, 12 N/A ; tests 946 → 1 030 ; page `equal.md` du guide en anglais et en français (36 exemples, 85 résultats vérifiés) ; T3.9 ouvert (autres types natifs). | 1 (M) |
| T3.1 a | `0026b44` docs(adr): select fields by a mask shaped like the value, checked by the compiler ; `eddaa02` feat(core): select fields by a typed mask in pick, omit, redact and equal ; `d628b23` test(bench): count Yaltaan's omit by a mask beside es-toolkit and the platform | `@yaltaan/core/object` : `pick`, `omit`, `redact`, `Mask<T>`, `UntypedMask`, `Picked`, `Omitted`, `Redacted`, `MaskOptions`, `RedactOptions` ; `equal` prend `pick`/`omit` (`EqualMasks<T>`), mémoire des paires par masque ; clé fautive refusée par le compilateur à toute profondeur ; taille brotli `core-omit` 532 / 528 o (budget 150 → 600 o, référence profonde es-toolkit `compat` 2 741 o), `core-equal` 946 / 948 → 1 288 / 1 303 o ; instructions sans masque −0,57 % à −0,05 % ; tests 1 030 → 1 253 ; catalogue adversarial 13 exports, 60 contrôles, 18 N/A | 1 (M) |
| T3.1 b | `960a5b3` feat(core): merge, fill defaults and map records, specified by laws ; `484983b` test(core): state Result by laws over any value instead of hand-picked cases | `@yaltaan/core/object` : `merge` (tableaux `'replace'` ou `'concat'`, sans défaut), `defaults`, `mapValues`, `mapKeys`, `Merged`, `Defaulted`, `ArrayStrategy`, `MergeOptions`, `KeyOptions` ; tests par lois (16 mutations sur 16 attrapées) ; brotli `merge` 523 o (`toMerged` d'es-toolkit 1 446 o), `defaults` 407 o (`defaultsDeep` 463 o), `mapValues` 377 o et `mapKeys` 416 o (es-toolkit 105 et 104 o) ; `Result` : 6 exemples remplacés par 3 lois ; tests 1 253 → 1 547 ; catalogue adversarial 17 exports, 78 contrôles, 24 N/A | 1 (M) |
| T0.17 | `141f32d` docs(adr): judge the core functions against es-toolkit on generated inputs ; `4990e30` test(core): compare eight functions with es-toolkit on generated inputs | Juge différentiel (ADR 0022) : es-toolkit 1.52.0 en dépendance des tests, aucun paquet ajouté (`node_modules` 95 862 726 octets avant et après) ; `createJudge` et `runComparison` dans `@yaltaan/testing`, 1 000 entrées par comparaison ; 8 fonctions jugées (`pick`, `omit`, `mapValues`, `mapKeys`, `merge`, `defaults`, `equal`, `parsePath`), 9 sans équivalent nommées ; 23 paires fonction-différence en 13 lignes d'en-tête de module, toutes des choix déjà actés, aucun défaut ; 12 défauts volontaires sur 12 vus rouges (8 dans le code, 4 dans le juge ; un seul passait à 300 entrées) ; tests 1 547 → 1 564 ; suite de tests 6,71 → 7,33 s (médianes) ; 30 assertions écrites à la main désormais couvertes, gardées. | 0,5 (S) |
| T3.2 | `2d66cec` docs(adr): read and write a value by a path with strict segments ; `995c2eb` feat(core): read and write a value by Path, judged against lodash's ; `53d7d6f` perf(core): keep the record copy helpers local to each object module | `@yaltaan/core/object` : `get`, `has`, `set`, `update`, `remove` par `Path` (ADR 0023 : segments stricts, `Result`, copie le long du chemin seulement, jamais de trou, `createMissing`, `{ key }` par `keyOf`), codes `path.missing` et `path.not_traversable` ; 6 lois générées sur entrées gelées, juge contre `es-toolkit/compat` dès le premier test (5 comparaisons, 9 différences dont 8 exactes) ; 10 défauts volontaires : lois et exemples 10/10, juge 6/10 ; tailles brotli `get` 567 / 570 o, `set` 1 317 / 1 312 o, les cinq 1 418 / 1 426 o (compat 1 466 / 1 483) ; un déplacement de `put` coûtait +1,78 % d'instructions à `omit`, corrigé (série : variantes Yaltaan à ±0,008 %) ; tests 1 564 → 1 926, exports 46 → 55 ; tickets T3.10 (chemins typés) et T0.21 (bruit du comptage) ouverts. | 1 (M) |
| T0.20 a | `f52ce0d` fix(hooks): refuse a local hook that exists but cannot run | Consignes locales 2 655 → 1 221 mots (−54 %, plafond 1 327) ; inventaire de 260 éléments, chacun à sa destination (ligne gardée, document suivi, script de la porte, crochet, archive), jugé par un contrôle hors dépôt, 20 retraits au hasard sur 20 vus ou dans un angle mort annoncé ; relecture par un contradicteur neuf : 6 règles affaiblies remises, et les deux crochets locaux du clone trouvés non exécutables, donc jamais lancés, d'où le refus d'un crochet local non exécutable (3 tests) ; 2 retraits proposés au propriétaire, non appliqués | 0,5 (S) |
| T3.3 a | `499679b` docs(adr): index, count and compare collections by a key held in a Map ; `b9f24ad` feat(core): split, index, count and compare collections by a key | `@yaltaan/core/collection` : `partition`, `indexBy` (`Result`, code `collection.duplicate_key`), `countBy`, `uniqueBy`, `intersectionBy`, `differenceBy`, `@experimental` (ADR 0024 : itérables lus une fois, clés dans une `Map` par SameValueZero, `equality: 'SameValue'` en option) ; lois contre la plateforme (5 mutations à la main, toutes vues), juge es-toolkit 1.52.0 (641 à 1 000 entrées comparées sur 1 000, 4 différences écrites, 2 mutations vues) ; 554 / 558 o brotli (esbuild / Rollup) contre 324 / 329 o pour es-toolkit, sans budget encore ; 1 929 → 2 400 tests | 0,5 (M) |
| T3.3 b | `5832e28` docs(adr): order collections by one total order on keys ; `c14b51a` feat(core): find, sort and page collections by one order on keys | `@yaltaan/core/collection` : `minBy`, `maxBy`, `sortBy` (critères `{ key, order, compare }`, clés calculées une fois, tri natif stable), `topK` (tas de k éléments, égal à `toSorted(compare).slice(0, k)`), `paginate` (pages depuis 0, noms du paginateur d'Angular Material), `@experimental` (ADR 0025 : un ordre sur les clés, nombres avant chaînes, `undefined`, `null` et `NaN` en dernier dans les deux sens) ; lois contre la plateforme (14 mutations à la main, toutes vues, dont un comparateur incohérent borné en appels), juge es-toolkit 1.52.0 (`minBy`, `maxBy`, `orderBy`, `chunk` : 501 à 1 000 entrées comparées sur 1 000, 4 différences écrites, 3 mutations vues par le juge seul) ; 1 105 / 1 103 o brotli (esbuild / Rollup) contre 422 / 422 o pour es-toolkit, `sortBy` 572 / 574 o contre 232 / 232 o, sans budget ; 2 400 → 2 791 tests, exports 63 → 74 ; ticket T0.22 ouvert | 0,5 (M) |
