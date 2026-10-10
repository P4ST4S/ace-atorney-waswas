# Plan d'implémentation

Chaque jalon produit un résultat **jouable ou vérifiable**. On attaque tôt les zones risquées : rigs des sprites, animation et enchaînement des effets. **Feu vert actuel : jalons 0 à 3** (démo jouable). Le jalon 4 est nécessaire avant de faire jouer une version jugée fiable.

## État d'avancement

| Jalon | État | Résultat vérifié |
|---|---|---|
| 0 — Socle | ✅ | 659 fichiers réorganisés, aucun hash modifié ; `typecheck` (4 configurations), `lint`, `test`, `build` et e2e passent. |
| 1 — Rendu | ✅ | 6 vues du tribunal confirmées par captures. Ron (7 poses) et Phoenix sont animés ; Edgeworth (Mimi) et le Juge ont une pose statique. 16,7 ms au p95, 0 long task, environ 15 Mo d'images décodées par scène. Contrôle d'alignement des frames bloquant au build. |
| 2 — Boucle minimale | ✅ | Moteur pur et Director avec son contrat (tests déterministes de redémarrage, timeout, échec, double clic). Machine à écrire, blips, interjection avec voix FR, musique. |
| 3 — Tranche verticale | ✅ | Témoignage, contre-interrogatoire (16 règles testées), Dossier et vue détail, santé, EXP, verdict, validateur, parcours headless et 300 explorations seedées. Playwright 14/14, dont un parcours à vitesse normale. |
| 4 — Robustesse | ⏳ | Après la revue de la tranche. |
| Lot R2 — Hébergement des assets | ✅ (local) | Résolution d'URL centralisée (`VITE_ASSET_BASE_URL`), releases versionnées et immuables (`releases/<release>/…`), `pnpm assets:upload` et `assets:verify`, politique CORS, build distant sans assets dans `dist/`, émulateur R2 et projet Playwright `remote-emulated`. Les opérations sur le vrai bucket sont décrites dans `DEPLOYMENT_R2.md`. |

**Écarts par rapport au plan initial, tous mineurs :**
- Rigs statiques ajoutés pour Edgeworth et le Juge, nécessaires à la démo. Le Juge est affiché à l'échelle 1,8, car sa planche est stockée en basse résolution.
- Portraits du Dossier découpés automatiquement depuis les poses.
- Garde par clé de ligne contre les clics entre deux lignes.
- Tests e2e exécutés sur un seul worker.

## Jalon 0 — Socle

**Objectif** : documents, assets rangés, projet qui compile et teste à vide.

| Tâche | Détail |
|---|---|
| Docs | `ASSET_INVENTORY`, `ARCHITECTURE` (contrats), `GAME_DESIGN`, ce plan, `OPEN_QUESTIONS` |
| Réorganisation | `scripts/reorganize-assets.ts` : déplacements seuls, SHA-256 vérifiés, `asset-meta/reorg-map.json`, `--revert` |
| Projet | `package.json` (`packageManager: pnpm@10.21.0`, versions exactes), Vite 8, React 19.3, TS 6.0 strict, Tailwind 4.3, ESLint 10 + typescript-eslint, Vitest 5, Playwright 1.64 |
| tsconfig | `app` (DOM), `engine` (sans DOM), `node` (configs), `scripts` (Node, `erasableSyntaxOnly`) ; `pnpm typecheck` les vérifie tous |
| Lint | Frontières de modules (`no-restricted-imports` par dossier), `Date` et `Math.random` interdits dans `engine` |
| git | `git init` local (sans remote ni commit, sauf demande) ; `.gitignore` : `assets/`, `public/generated/`, `node_modules/`, rapports de test |

**Dépendances** : aucune.
**Livrables** : docs, `assets/` rangé, squelette d'application.
**Critères d'acceptation** :
- 659 fichiers déplacés, aucun hash modifié ;
- `pnpm dev`, `build`, `test`, `lint` et `typecheck` passent.

**Risques** :
- peers incompatibles dans la matrice de versions : on vérifie à l'installation et on ajuste en le documentant ;
- binaires natifs (sharp, rolldown) bloqués par pnpm 10 : on utilise `onlyBuiltDependencies`.

## Jalon 1 — Rendu

**Objectif** : valider l'affichage fidèle et l'animation des sprites, c'est-à-dire le risque n°1.

| Tâche | Détail |
|---|---|
| Alias | `asset-meta/assets.ts` : vues du tribunal (`court.defense` → `bg001` + `etc22`, etc.), interjections, cadre de preuve |
| Ron | `scripts/slice-frame-sheet.ts` sur `ron-delite.png` produit un brouillon de rig ; on étiquette ensuite les poses (normal, sueur…), la base, le clignement et la parole |
| Phoenix | Une pose saisie à la main (base et 1 patch bouche recalé par template-matching), dans `asset-meta/rigs/phoenix-wright.json` |
| Pipeline | `scripts/build-assets.ts` (sharp) : WebP, feuilles de pose, `public/generated/manifest.json`, build incrémental |
| Scène | Composant `Stage` : repère 1920×1080, échelle uniforme, letterbox, calques décor / personnage / bureau |
| Sprite | `CharacterSprite` et lecteur impératif : base, clignement seedé, parole en boucle, sans re-render React |
| Chargement | `img.decode()` avant affichage ; LRU minimal |
| Page de test | `/dev/stage` : sélection de vue ; Wassim (Ron) animé à la barre ; Phoenix à la défense ; une réplique statique lisible dans `TextBox` |
| HUD perf | Intervalle entre frames rAF (p95, frames perdues), mémoire si disponible |

**Dépendances** : jalon 0.
**Livrables** : page `/dev/stage`, pipeline, deux rigs.
**Critères d'acceptation** :
- captures Playwright des vues du tribunal en 1280×720 et 1920×1080 ;
- test de scintillement : aucun décalage entre frames d'une même pose ;
- aucune long task de plus de 50 ms et frames régulières pendant l'animation ;
- mémoire décodée de la scène mesurée et notée.

**Risques** : mapping décor/bureau incorrect, à corriger dans les alias ; échelle personnage/décor à calibrer ; recalage du patch de Phoenix imprécis, à ajuster à la main.

## Jalon 2 — Boucle minimale

**Objectif** : premier dialogue jouable piloté par le moteur, avec le contrat d'effets complet.

| Tâche | Détail |
|---|---|
| Moteur | Types, `compileChapter` (blocs, jetons de texte, `compat`), `startChapter`, `step` pour : `say`, `show`, `hide`, `pose`, `court`, `location`, `music`, `sfx`, `shake`, `flash`, `wait`, `interjection`, `set`, `addVar`, `if`, `exitTo`, `call`, `return`, `ending`. Plus `waitRev`, le budget d'instructions et le refus des entrées invalides. |
| Texte | Parseur de balisage, normalisation typographique française, `{raw}` |
| DSL | `src/content/dsl/` : registres typés, builders `say` par personnage, `section`, `defineChapter` |
| Director | Runs, `AbortController`, file d'effets séquentielle, IDs d'effet, `fxEnd` (`done`/`failed`), timeouts, écran « Réessayer », redémarrage de partie, état stable. Il **respecte ses contrats dès ce jalon** ; son implémentation pourra évoluer. |
| Store | Zustand vanilla : état affiché (scène, ligne, contrôles) |
| TextBox | Spans pré-rendus, frappe, couleurs, pauses, blips, clic de complétion consommé, `rev` capturé à la création de l'action |
| Effets | Interjection (image, voix FR, secousse), secousse, flash, fondu |
| Audio | `AudioService` (Howler) : musique avec fondu, effets sonores, blips, volumes, écran « Cliquez pour commencer » |
| Démo | Un court dialogue au tribunal : le juge ouvre l'audience, Phoenix répond, Mimi interjette « Objection ! », la musique change |

**Dépendances** : jalon 1.
**Livrables** : dialogue de démo jouable de bout en bout.
**Critères d'acceptation** :
- Vitest :
  - `step` pour chaque commande ;
  - deux « avancer » avec le même `rev` : un seul est accepté ;
  - le budget d'instructions lève une `ContentError` sur une boucle d'`exitTo` ;
  - balisage et typographie ;
  - `compat`, qui ne change pas pour un texte seul mais change pour un `{sfx}`.
- **Test déterministe du Director** : un effet contrôlable est en cours, on redémarre sans recharger la page, puis l'ancien effet se termine. L'acquittement doit être ignoré : pas d'avancée fantôme, état intact.
- Playwright : un clic pendant la frappe complète la ligne, le clic suivant avance ; un parcours à vitesse normale.

**Risques** : soft-lock par acquittement perdu (timeouts, HUD de debug) ; autoplay audio (écran de démarrage).

## Jalon 3 — Gameplay : tranche verticale

**Objectif** : la boucle du procès complète, sur du contenu de démo.

| Tâche | Détail |
|---|---|
| Moteur | `testimony` (développé en bannière et déclarations), `crossExam` ré-entrant (règles de `ARCHITECTURE.md` §9), `reveal`, `amend`, `resumeCrossExam`, `penalty` (0 PV → `gameOver`), `healthBar`, `evidence` (ajout, mise à jour, retrait), `profile`, `verdict` |
| UI | `CourtRecord` (onglets, miniatures dans le cadre de preuve, mode présentation), vue détail plein écran (zoom et défilement des captures), `CrossExamBar` (flèches, Presser, Présenter), `HealthBar` (animation de dégâts), bannières, notification d'EXP, verdict « Coupable » / « Non coupable » |
| Contenu de démo | Témoignage de Wassim en 3 déclarations, dont une cachée révélée par une pression. 2 preuves, dont une capture factice. Une mauvaise preuve coûte 20 PV et +10 EXP. La bonne preuve déclenche « Objection ! » et Pursuit, mène à une nouvelle section, puis au verdict « Coupable ». |
| Validateur | `validateChapter()` statique de base et `pnpm content:check` |
| Parcours | Joueur headless : chemin doré jusqu'à « Coupable » ; erreurs ; 0 PV jusqu'à « acquitté » |

**Dépendances** : jalon 2.
**Livrables** : la tranche verticale jouable.
**Critères d'acceptation** :
- les 8 étapes passent en Playwright (`?fast=1`) : chargement d'un décor, personnage animé, dialogue, changement d'expression, ouverture du Dossier, présentation d'une preuve, contradiction, transition vers un autre état narratif ;
- chaque règle du tableau du contre-interrogatoire est couverte par un test Vitest.

**Risques** : débordement du texte français dans la boîte (heuristique du validateur et contrôle Playwright) ; ergonomie de la vue détail des captures.

## Jalon 4 — Robustesse (après revue de la tranche)

- Autosauvegarde aux états stables et « Continuer », branchés sur l'annulation livrée au jalon 2.
- `compat` strict : si la structure a changé, le chapitre redémarre avec un message.
- Stockage défaillant : localStorage absent, données corrompues ou écriture refusée.
- Défaite et reprise.
- Exploration seedée bornée, avec traces reproductibles.

**Critères d'acceptation** :
- test du Director : on **charge** une partie sans recharger la page, puis l'ancien effet se termine ; l'acquittement est ignoré ;
- Playwright : on **recharge la page** pendant une objection, l'état sauvegardé est repris, sans dégâts en double ;
- tests de stockage défaillant.

## Jalon 5 — Extension (plus tard)

Selon les besoins du scénario :
- enquête : examiner, se déplacer, parler, présenter ;
- choix multiples et demandes de preuve hors contre-interrogatoire ;
- rigs complets de Phoenix, Edgeworth, Franziska et du Juge, avec un éditeur de rig si le volume le justifie ;
- étiquetage des 113 effets sonores 3DS (page d'écoute) ;
- panoramique `houscr`, lignes de vitesse, verdict animé ;
- options complètes, emplacements de sauvegarde, mobile.

Ensuite viendra l'**écriture du chapitre** avec l'utilisateur, appuyée sur un `docs/CONTENT_GUIDE.md` (aide-mémoire du DSL et du balisage, pour co-écrire avec une IA).

## Stratégie de test (synthèse)

| Cible | Outil | Ce qui est testé |
|---|---|---|
| Moteur | Vitest (Node) | Chaque commande, règles du contre-interrogatoire, `waitRev`, IDs d'effet, budget, 0 PV |
| Texte | Vitest | Balisage, typographie française, `{raw}` |
| Contenu | Vitest + `content:check` | Validation statique, parcours déterministes, exploration seedée |
| Sauvegardes | Vitest (jalon 4) | Restauration exacte, `compat`, stockage défaillant, aucun rejeu |
| Director | Vitest, effets contrôlables | Runs, annulation, acquittements périmés |
| Interface | Playwright | Parcours rapide et à vitesse normale, clic de complétion, Dossier, présentation, captures des vues, rechargement (jalon 4) |

**Hooks de test** :
- `?fast=1` rend la frappe instantanée et les animations nulles ;
- les `data-testid` sont posés sur les contrôles ;
- le HUD de debug n'est actif qu'en développement.
