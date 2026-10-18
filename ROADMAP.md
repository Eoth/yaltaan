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

Aucun paquet publié, aucune API. Taille d'import : harnais en place (T0.2), cinq scénarios de référence mesurés dans `docs/size-baseline.tsv` (brotli, esbuild / Rollup : es-toolkit `omit` 90 / 97 o, dix primitives 657 / 661, schéma de connexion valibot 1 285 / 1 254, `@preact/signals-core` 1 562 / 1 559, temporal-polyfill 17 851 / 17 876), budgets calibrés dans `bench/size/budgets.tsv` (ADR 0010), neuf en attente de leur scénario. Coût des types et comptage d'instructions commencent avec T0.3 et T0.4.

Outillage de développement (empreinte installée, à ne laisser croître que par ADR 0003, 0009 ou suivant) : 15 paquets installés sous Windows (TypeScript 7.0.2 et son binaire, Prettier 3.9.9, `@types/node` 22.20.5 et `undici-types`, `esbuild-wasm` 0.28.2, `@rollup/wasm-node` 4.64.0 et `@types/estree`, es-toolkit 1.52.0, valibot 1.5.0, temporal-polyfill 1.0.5 et ses deux dépendances, `@preact/signals-core` 1.14.4, le lien de l'espace de travail), `node_modules` 68,9 Mo dont 28 Mo de compilateur natif et 14,5 Mo d'`esbuild-wasm` ; verrou de 35 entrées tierces, MIT 13 et Apache-2.0 22, un seul script d'installation admis (fsevents, macOS, jamais exécuté) (mesure du 2026-10-12, Windows x64). Porte : 128 tests, étape de taille en 4 s, graphe des dépendances (T0.7, ADR 0011) en 0,3 s, tags de contrat (T0.6, ADR 0012) en 0,15 à 0,18 s tant qu'aucun paquet n'a de source ; verte sous Windows (Node 24.17.0) et Linux (Node 22.23.3). Relevé à chaque changement du verrou (`npm ls --all`, taille de `node_modules`), chiffres dans le message de commit.

## 2. Ordre d'exécution

Tranche verticale d'abord : la colonne vertébrale (§5 d'`ARCHITECTURE.md`) se valide de bout en bout sur un formulaire réel avant d'être gelée, puis les domaines s'élargissent. Un ticket découpé (a, b, c) prend une itération par étape.

| # | Lot | Tickets, dans l'ordre | Sortie |
|---|---|---|---|
| 1 | 0 — Outillage | T0.1, T0.2, T0.7, T0.6, T0.5, T0.3, T0.4, T0.8, T0.9 | Un paquet vide qui passe toute la CI ; budgets calibrés contre les références. |
| 2 | 1 — Colonne vertébrale | T1.1, T1.3, T1.2, T1.5, T1.4, T0.14, T1.6 a, T1.6 b | Contrats v0 (`Result`, `Issue`, `Path`, `equal`, nœud réactif), propriétés testées. |
| 3 | 2 — Tranche verticale | T2.1, T2.2, T2.3, T2.4 a, b, c, T2.5, T0.13, T2.6, T0.10, T2.7 | Formulaire pilote de bout en bout, mesures, **ADR go/no-go de `form`**, gel des contrats ; première version expérimentale publiée avec provenance. |
| 4 | 3 — Données | T3.1, T3.2, T3.3 a, b, T3.4, T3.5, T3.6 a, b, c, T3.7 a, b, T3.8 | Modules `@experimental`. |
| 5 | 4 — Temporal | T4.1, T4.2, T4.3, T4.4 | Tests sur l'implémentation native et sur le polyfill recommandé. |
| 6 | 5 — Schéma et règles complets | T5.1 a, b, T5.2, T5.3, T5.4, T5.5, T5.6, T5.7 | Interopérabilité Standard Schema vérifiée avec au moins deux moteurs tiers. |
| 7 | 6 — Formulaire complet (si go) | T6.1, T6.2, T6.3, T6.4, T6.5, T6.6 | Second projet pilote. |
| 8 | 7 — Durcissement | T0.11, T0.12, T7.1, T7.2, T7.3, T7.4, T7.5 | 1.0 = uniquement des modules `@stable`. |

`core/async` et `core/cache` (`ARCHITECTURE.md` §7.6, §7.7) n'avaient pas de phase : ils entrent au lot 3 (T3.7, T3.8). Si la tranche verticale montre que la validation asynchrone du formulaire en a besoin plus tôt, T3.7 a remonte avant T2.4 c.

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
| Projet pilote | Quel formulaire réel pour la tranche verticale ? | **À fournir par le propriétaire** : un formulaire métier réel d'une application Angular qu'il connaît (multi-étapes, tableau dynamique, requis conditionnel, validation serveur), anonymisé et reproduit dans `examples/` ; à défaut, un formulaire administratif public et documenté de même complexité. Bloque T2.1. |

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

#### T0.3 — Harnais de coût des types
- **Pourquoi** : une API au type parfait qui ralentit fortement le contrôle d'un gros projet est défaillante (`ARCHITECTURE.md` §8).
- **Faire** : générateur déterministe d'un projet de référence (≈ 2 000 fichiers) qui emploie les types publics au fil de leur arrivée (`Path<T>`, inférence de schéma et de formulaire) ; mesure `tsc --extendedDiagnostics` (temps de contrôle, instanciations, mémoire), avec et sans la librairie ; seuil de temps (+10 % au plus, hypothèse à calibrer) et plafond d'instanciations par type public ; contrôle sous TypeScript 7 et 6.0 (`@typescript/typescript6`, ADR), avec et sans `exactOptionalPropertyTypes`.
- **Où** : `bench/types/`, `scripts/`.
- **Accepté si** : deux exécutions donnent les mêmes instanciations ; un type volontairement explosif (récursion non bornée) fait échouer le seuil ; le temps de contrôle jugé sur plusieurs passes avec sa dispersion.
- **Taille** M · **Prio** P1 · **Dépend de** T0.1

#### T0.4 — Benchmarks et départage A/B au nombre d'instructions
- **Pourquoi** : les runners partagés sont bruités et un écart de quelques pourcents ne se juge pas au chronomètre ; un chemin chaud doit se départager de façon reproductible.
- **Faire** : harnais de benchmark (mitata ou tinybench, choisi par ADR) natif / meilleure référence / Yaltaan, jeux de données seedés (micro, réaliste, pathologique), publication complète (CPU, OS, runtime et version, commande, échauffement, itérations, dispersion p50/p99) ; méthode de départage A/B déterministe (comptage d'instructions sous Callgrind dans WSL avec un V8 rendu déterministe, ou autre méthode prouvée), script `scripts/perf-count.sh <A> <B>` qui compare le parent exact et le commit ; octets alloués par opération sur les chemins chauds.
- **Où** : `bench/perf/`, `scripts/`.
- **Accepté si** : deux comptages du même commit égaux, ou leur écart mesuré et pris comme seuil ; une régression fabriquée (+5 % de travail) détectée ; méthode et seuils écrits par ADR.
- **Taille** M (L si la détermination de V8 l'exige : découper) · **Prio** P1 · **Dépend de** T0.1

#### T0.5 — Catalogue adversarial partagé
- **Pourquoi** : « chaque domaine teste ses cas adversariaux » doit devenir vérifiable (`ARCHITECTURE.md` §10.1).
- **Faire** : paquet privé `@yaltaan/testing`, jamais publié : générateurs fast-check `adversarial.*` par catégorie (valeurs limites, structures, objets hostiles, Unicode, callbacks, asynchrone) ; chaque export public déclare les catégories qui le concernent ou « N/A » avec sa raison ; la porte vérifie que la déclaration existe et que ses tests tournent. Dépendance fast-check justifiée par ADR.
- **Où** : `packages/testing/`, `scripts/`.
- **Accepté si** : un export sans déclaration fait échouer la porte ; chaque générateur produit ses cas nommés (vide, `NaN`, `-0`, cycle, Proxy, objet gelé, séquence ZWJ, substitut isolé, signal déjà aborté…), vérifié par test.
- **Taille** M · **Prio** P1 · **Dépend de** T0.1

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

### Lot 1 — Colonne vertébrale

#### T1.1 — `Result` et ses fonctions libres
- **Pourquoi** : premier contrat transverse ; tout échec attendu de la librairie passe par lui (`ARCHITECTURE.md` §5.1).
- **Faire** : type `Result<T, E>` (objet littéral en lecture seule, discriminé par `ok`), fonctions libres `ok`, `err`, `mapResult`, `unwrapOr` et seulement celles que la tranche verticale consomme ; aucune classe ni méthode chaînée.
- **Où** : `packages/core/src/result/`, sous-chemin `@yaltaan/core/result`.
- **Accepté si** : tags de contrat ; propriétés (identité et composition de `mapResult`) ; tests de types (rétrécissement par `ok`, erreurs de compilation attendues) ; budget de taille tenu.
- **Taille** S · **Prio** P0 · **Dépend de** T0.2, T0.6

#### T1.2 — `Issue` et registre des codes
- **Pourquoi** : une même forme d'erreur pour schémas, parseurs, règles, formulaires et erreurs serveur supprime le code de colle (`ARCHITECTURE.md` §5.2).
- **Faire** : interface `Issue` ; registre documenté des codes par paquet, contrat SemVer (un code retiré ou renommé = majeure, vérifié contre le registre versionné) ; conversion vers les issues Standard Schema (`message` + `path`) à la frontière, par un formateur fourni par l'application ; recette d'un formateur anglais minimal.
- **Où** : `packages/core/src/issue/`.
- **Accepté si** : un code retiré du registre fait échouer la porte ; aller-retour vers Standard Schema testé (chemins `{ key }` compris).
- **Taille** M · **Prio** P0 · **Dépend de** T1.1, T1.3

#### T1.3 — `Path` à l'exécution : segments, clé stable, frontière texte
- **Pourquoi** : un `Path` unique sert `get`, `set`, `diff`, les erreurs et les champs ; le segment `{ key }` fait suivre un élément déplacé (`ARCHITECTURE.md` §5.3).
- **Faire** : `PathSegment`, `Path`, segment `{ key }` ; `parsePath` et `formatPath` à la frontière seulement, grammaire et échappement écrits ; refus explicite de `__proto__`, `constructor`, `prototype` en écriture (code d'issue dédié) ; limites de longueur et de profondeur.
- **Où** : `packages/core/src/path/`.
- **Accepté si** : `parsePath(formatPath(p))` égal à `p` pour toute clé Unicode (y compris `.`, `[`, `]`, `\`, vide) ; fuzz du parseur sans exception ni temps non borné ; aucune pollution de prototype.
- **Taille** M · **Prio** P0 · **Dépend de** T0.5

#### T1.4 — `Path<T>` et `PathValue<T, P>` typés
- **Pourquoi** : un chemin typé attrape à la compilation ce qu'un chemin texte laisse au runtime, à condition de ne pas faire exploser le contrôle des types.
- **Faire** : chemins typés, profondeur bornée (hypothèse 8, calibrée par T0.3), dégradation explicite et documentée vers un chemin non typé au-delà ; plafond du nombre de chemins générés.
- **Où** : `packages/core/src/path/`.
- **Accepté si** : budget du coût des types tenu (T0.3) ; tests de types ; messages d'erreur de compilation relus et lisibles.
- **Taille** M · **Prio** P0 · **Dépend de** T0.3, T1.3

#### T1.5 — `equal` profond configurable
- **Pourquoi** : l'égalité profonde manque au natif et sert `diff`, `update`, les formulaires (`ARCHITECTURE.md` §7.5).
- **Faire** : SameValueZero ou `Object.is` ; types spéciaux listés (`Map`, `Set`, `Date`, tableaux typés, objets Temporal via `equals`) ; cycles détectés ; instances de classe opaques sauf support déclaré.
- **Où** : `packages/core/src/equal/`.
- **Accepté si** : réflexivité et symétrie (propriétés), cohérence avec `Object.is` sur les primitives, cycles et aliasing du catalogue adversarial.
- **Taille** M · **Prio** P0 · **Dépend de** T0.5

#### T1.6 — Graphe réactif (`ReadableNode`)
- **Pourquoi** : tout le formulaire en dépend, et sa sémantique ne doit pas dépendre d'un framework (`ARCHITECTURE.md` §5.5).
- **Faire** : (a) nœuds source et dérivés, `get` et `subscribe` (le contrat de `useSyncExternalStore`), graphe push-pull paresseux sans glitch, batch explicite porté par une instance ou un appel, ordre topologique, aucun ordonnanceur global ; (b) détection des cycles à la construction, propriétés (aucun glitch observable sous entrelacements fast-check, aucun abonné qui fuit), conversion en signal Angular et en `customRef` Vue documentée.
- **Où** : `packages/core/src/reactive/`.
- **Accepté si** : (a) tests de glitch et de paresse ; (b) cycle refusé à la construction, budget ≤ 1 000 o brotli tenu (scénario `yaltaan/core-reactive`, ADR 0010).
- **Taille** L → (a) M, (b) M · **Prio** P0 · **Dépend de** T0.5

### Lot 2 — Tranche verticale

#### T2.1 — Formulaire pilote et ses scénarios
- **Pourquoi** : la tranche se juge sur un formulaire réel, pas sur un exemple écrit pour elle.
- **Faire** : reproduire le formulaire choisi (§3, projet pilote) : multi-étapes, tableau dynamique, requis conditionnel, validation serveur ; écrire ses scénarios d'acceptation en tests avant le code de la tranche.
- **Où** : `examples/pilot/`.
- **Accepté si** : scénarios relus par le propriétaire ; chacun rouge avant la tranche.
- **Taille** S · **Prio** P0 · **Dépend de** décision §3 (projet pilote)

#### T2.2 — Schéma minimal conforme Standard Schema v1
- **Pourquoi** : premier domaine branché sur `Result`, `Issue` et `Path`, et porte d'entrée vers les moteurs tiers.
- **Faire** : `object`, `string`, `number`, `optional`, `nullable`, `array`, `literal`, union discriminée ; API en fonctions (tree-shaking) ; interface `~standard` (types recopiés, aucune dépendance) ; clés inconnues selon §3 ; clé absente, `undefined` et `null` distincts ; validation qui ne mute jamais l'entrée.
- **Où** : `packages/schema/`.
- **Accepté si** : un schéma consommé par `validateStandardSchema` d'Angular et par TanStack Form sans pont ; déterminisme ; budget du schéma de connexion tenu (scénario `yaltaan/schema-login`, 1 500 o, ADR 0010).
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

### Lot 3 — Données

#### T3.1 — `core/object`
- **Pourquoi** : `pick`, `omit`, `merge` et consorts sont réécrits dans chaque application, avec des comportements flous sur les prototypes et les getters.
- **Faire** : `pick`, `omit`, `merge` (stratégie explicite pour les tableaux), `mapKeys`, `mapValues`, `defaults`, `redact` ; objets *plain* et tableaux seulement, le reste opaque avec sa table de support ; propriétés propres énumérables à clé texte (symboles en option) ; getters lus une fois, exception propagée.
- **Où** : `packages/core/src/object/`.
- **Accepté si** : invariants d'`ARCHITECTURE.md` §7.1 en propriétés ; aucune pollution de prototype (fuzz).
- **Taille** M · **Prio** P1 · **Dépend de** T1.3, T1.5

#### T3.2 — Accès et mise à jour par `Path`
- **Pourquoi** : la mise à jour localisée avec partage structurel est le vrai besoin derrière le clone profond.
- **Faire** : `get`, `set`, `has`, `remove`, `update` ; chemin inexistant → `Result` en erreur, création en option (`createMissing`) ; variantes `…InPlace` seulement si un benchmark les justifie, `TypeError` explicite sur un objet gelé.
- **Où** : `packages/core/src/object/`.
- **Accepté si** : `update(x, p, v => v) === x` ; branches non touchées de même référence ; `get(set(x, p, v), p) === v`.
- **Taille** M · **Prio** P1 · **Dépend de** T3.1

#### T3.3 — `core/collection`
- **Pourquoi** : seulement ce qui manque au natif (`ARCHITECTURE.md` §7.2).
- **Faire** : (a) `partition`, `indexBy`, `countBy`, `uniqueBy`, `minBy`/`maxBy`, `topK` (tas), `sortBy` multicritère, `intersectionBy`/`differenceBy`, `paginate` ; (b) `chunk`, `window`, `zip` paresseux sur itérables (générateurs, sans dépendre des assistants d'itérateurs tant qu'ils sont hors baseline), `mapConcurrent`.
- **Où** : `packages/core/src/collection/`.
- **Accepté si** : `topK(xs, k)` égal à `xs.toSorted(cmp).slice(0, k)` (propriété de cohérence avec le natif) ; un comparateur non transitif ne boucle ni ne lève.
- **Taille** L → (a) M, (b) M · **Prio** P1 · **Dépend de** T1.5

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
- **Accepté si** : aucune conversion implicite avec perte ; aller-retour `parseNumber(format(x))` pour les formats déclarés.
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
- **Faire** : référence générée (T0.6), guides par domaine, recettes (formateur d'issues, résolution de locale, configuration), équivalents natifs documentés.
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

## 9. Clos

Une ligne par ticket : `identifiant — commit — résultat mesuré — itérations consommées` (format de §0).

| Ticket | Commit | Résultat | Itérations |
|---|---|---|---|
| T0.1 | `chore: start the repository with guards on what a commit may name`, puis `style(scripts): keep the commit-message guard within 120 columns`, `build: set up the npm workspace and its TypeScript toolchain`, `ci: add the verification gate and the guards it runs`, `ci: run the gate, the Node matrix and a secret scan on GitHub`, `docs: describe the library, its decisions and its plan` (cités par sujet : commits de journée sur `wip`, rejoués ensuite) | Dépôt, porte `verify.sh` (18 étapes), 10 gardes et contrôles, crochets pre-commit/commit-msg/pre-push, CI (porte, Node 22/24/26, gitleaks, « CI passed ») et Scorecard, `ARCHITECTURE.md`, ADR 0001 à 0007, documents publics. 64 tests, chaque garde neutralisée vue rouge ; porte verte sous Windows et sous Linux (WSL, Node 22.23.3, npm 10.9.9) ; actions épinglées vérifiées par `git ls-remote`, sommes d'actionlint et de gitleaks égales à celles publiées ; outillage 6 paquets, 43,4 Mo. | 1 (M) |
| T0.2 | `e3aa190` build: add the bundlers and reference libraries of the size harness ; `86865d1` ci: measure each import scenario with esbuild and Rollup against a baseline ; `57d30c7` docs(adr): calibrate the import budgets against the reference libraries | `scripts/size-report.ts` sur `esbuild-wasm` 0.28.2 et `@rollup/wasm-node` 4.64.0 (ADR 0009) : 5 scénarios de référence, 10 bundles, base `docs/size-baseline.tsv` à l'octet, fuites d'import, écarts de résolution entre bundlers et budgets vérifiés ; fuite fabriquée vue rouge, comme chaque garde neutralisée ; recoupé par bundlejs.com à l'octet (es-toolkit, valibot), temporal-polyfill à 0,23 % près en compression ; mêmes tailles sous Node 22 (brotli 1.1.0) et 24 (1.2.0), trois passes identiques ; budgets (ADR 0010) : `omit` 150 o, dix primitives 1 000, graphe réactif 1 000, schéma de connexion 1 500, couche Temporal 1 790 ; tests 65 → 79 ; +25,5 Mo installés. | 1 (M) |
| T0.7 | `f4be106` docs(adr): check the dependency graph with Rollup's parser and tsc ; `dae91cd` build: let a package depend on the workspace packages below it ; `70d70bf` ci: check the dependency graph and the module rules after the build | `scripts/check-dependency-graph.ts` (étape de la porte après la construction, 0,23 à 0,30 s sans paquet construit) : graphe lu dans `ARCHITECTURE.md` §6, arêtes = `dependencies`/`peerDependencies` des package.json (arête interne = version exacte du workspace, vérifiée par `check-manifests.ts`), modules de `dist/` lus par `parseAst` (imports déclarés et par sous-chemin exporté, aucun barrel d'un autre paquet, corps de module en déclarations seules), imports de types lus par `tsc --listFilesOnly` ; dependency-cruiser 18.6.0 écarté (TypeScript < 7 seulement : 0 module lu, sortie 0) ; toute forme acceptée au chargement est éliminée par Rollup et par esbuild (vérifié en test) ; import core → schema, adapter → adapter, appel au niveau module vus rouges en test et dans la porte du vrai dépôt ; 14 gardes neutralisées une à une, chacune rouge ; tests 79 → 100 ; porte verte sous Windows (Node 24.17.0) et Linux (WSL, Node 22.23.3) sur `70d70bf`. | 1 (S) |
| T0.6 | `ff4a6e1` docs(adr): read contract tags through the compiler's unstable API ; `5bea87d` ci: check the contract tags of every public export after the build | `scripts/check-contract-tags.ts` (étape de la porte après la construction, 0,15 à 0,18 s sans paquet construit) : `.d.ts` de chaque sous-chemin de `exports` lus par `typescript/unstable/sync` 7.0.2 (adaptateur unique `scripts/lib/declarations.ts`, 0 octet ajouté), exports de valeur recoupés par les clés du module chargé par Node, liste unique des tags dans `scripts/lib/contract-tags.ts`, référence `docs/reference/` générée (`--update`) et comparée à l'octet ; `@typescript/typescript6` mesuré en repli (2 paquets, 24,4 Mo, 0,38 s) ; export sans tag, tag inconnu, `@mutates` d'un paramètre absent vus rouges en test et dans la porte du vrai dépôt (source temporaire de `core`, seule l'étape en échec), lecture recoupée par TypeScript 6.0.3 ; 33 gardes neutralisées une à une, chacune rouge ; référence identique sur deux exécutions et deux dossiers ; tests 102 → 128 ; porte verte sous Windows (Node 24.17.0) et Linux (WSL, Node 22.23.3) sur `5bea87d`. | 1 (M) |
