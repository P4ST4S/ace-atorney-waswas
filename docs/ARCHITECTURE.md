# Architecture

Ce document fixe l'architecture du moteur et les **contrats** que le code doit respecter. Les signatures TypeScript sont normatives ; l'implémentation peut évoluer tant que les contrats tiennent.

## 1. Principes

1. **Moteur pur.** Toute la logique narrative passe par une fonction déterministe `step(state, input, chapter) → { state, effects }`. Elle ne dépend ni de React, ni du DOM, ni du temps réel.
2. **La présentation joue des effets.** Un *Director* reçoit les effets émis par le moteur et les joue dans l'ordre : texte, animations, sons. Il renvoie au moteur la fin des effets bloquants.
3. **Contenu orienté données.** Dialogues, preuves, témoignages et branches vivent dans des modules TypeScript typés (`src/content/`), jamais dans les composants React.
4. **Fidélité.** Les décors et personnages HD de la trilogie sont affichés dans leur repère d'origine en 1920×1080.
5. **Le strict nécessaire.** Un seul chapitre ; on ajoute un mécanisme seulement quand le jeu en a besoin.

## 2. Stack

| Outil | Version | Rôle et justification |
|---|---|---|
| pnpm | 10.21.0 (`packageManager`) | Gestionnaire unique, lockfile versionné |
| React / React DOM | 19.3.0 | Interface et structure des calques |
| Vite | 8.3.x (Rolldown) + `@vitejs/plugin-react` 6 | Serveur de développement et build |
| TypeScript | **6.0.x** | Mode strict. Pourquoi pas la 7.0, pourtant sortie : `typescript-eslint` 8 exige `<6.1`. |
| Tailwind CSS | 4.3.x via `@tailwindcss/vite` | Styles de l'interface ; configuration en CSS (`@theme`), sans `tailwind.config.js` |
| Zustand | 5 (store *vanilla*) | Pont entre le Director et React, avec sélecteurs pour éviter les re-renders inutiles |
| Howler.js | 2.2.4 | Audio : déverrouillage de l'autoplay, fondus, lecteurs multiples, repli HTML5 pour les musiques longues |
| zod | 4 (`zod/mini`) | Validation structurelle des sauvegardes uniquement |
| sharp | 0.35 | Pipeline d'assets (découpe, WebP) |
| `@aws-sdk/client-s3` | 3.x | Upload des assets vers Cloudflare R2 (`scripts/` uniquement, jamais dans le bundle) |
| Vitest | 5 | Tests unitaires du moteur, du Director, du texte, du contenu |
| Playwright | 1.64 | Tests de bout en bout et captures |
| ESLint + typescript-eslint | 10 / 8 | Qualité et frontières de modules |

**Écartés :**

| Outil | Pourquoi |
|---|---|
| PixiJS | Voir §5.1. |
| XState | La difficulté est dans les données (pile d'appels, blocs ré-entrants), pas dans un graphe d'états fixe. Un réducteur écrit à la main est plus simple à sauvegarder et à tester. |
| Bibliothèque i18n | Le jeu est en français uniquement ; les textes d'interface sont dans `ui-fr.ts`. |
| Backend | Aucun besoin : tout tourne côté client et les sauvegardes sont locales. Les assets peuvent être servis par un bucket R2 public, sans Worker (`DEPLOYMENT_R2.md`). |

**Scripts TypeScript** (`scripts/`) :
- Ils sont exécutés par le *type-stripping* natif de Node (`--experimental-strip-types` sous Node 22.17).
- Ce mode **ne vérifie pas les types** et **ignore les alias du tsconfig**. C'est pourquoi `tsconfig.scripts.json` est inclus dans `pnpm typecheck`.
- Les imports y sont relatifs, avec l'extension `.ts`, et `erasableSyntaxOnly` est actif (pas d'`enum` ni de `namespace`).

## 3. Arborescence

```
asset-meta/            versionné : alias d'assets, rigs des personnages, carte de réorganisation
  assets.ts            alias logiques → fichiers sources (décors, bureaux, audio, interjections)
  rigs/*.json          rigs des personnages (frames ou pièces, ancres, offsets)
  reorg-map.json       trace de la réorganisation d'assets/
  release-layout.ts    emplacement des assets : URL locales ou R2, clés `releases/<release>/…` (partagé)
assets/                sources brutes (hors git)
public/generated/      sortie du pipeline (hors git) : fichiers, manifest.json, release.json
scripts/               reorganize-assets.ts, build-assets.ts, slice-frame-sheet.ts,
                       upload-assets.ts, verify-release.ts, vite-asset-plugin.ts, lib/ (release, upload, contrôles)
deploy/r2/             politique CORS du bucket (formats dashboard et wrangler)
docs/
src/
  engine/              PUR : types, compile, step (dont contre-interrogatoire), text, validate, autoplay
  content/
    dsl/               builders et registres typés qui produisent un ChapterSource
    demo/              chapitre de démonstration (cast, chapter, tests de contenu)
  runtime/             director, presenter, audio, store, scene, assets, image-cache
  ui/
    stage/             SceneViewport, CharacterSprite, sprite-player, ticker, sprite-registry
    game/              GameScreen, StageView, Dialogue, CourtRecord, TrialHud, Overlays, context
    typewriter.ts      machine à écrire impérative
  dev/                 page /dev/stage et HUD de performance (développement uniquement)
  boot.ts, App.tsx     création des services hors de React, écran « Cliquez pour commencer »
tests/e2e/             Playwright (helpers, smoke, stage, perf, dialogue, slice, assets ; r2.config.ts)
tests/support/         émulateur R2 local pour les tests en mode distant
```

## 4. Frontières de modules

Ces règles sont imposées par ESLint (`no-restricted-imports` par dossier) et par les tsconfig.

| Module | Peut importer | Interdit |
|---|---|---|
| `engine` | Rien d'extérieur. Le chapitre compilé lui est **passé en argument**. | `content`, `runtime`, `ui`, `react`, tout DOM (tsconfig sans lib DOM), `Date`, `Math.random` |
| `content` | **Uniquement les types** du moteur (`import type`) et son propre `dsl/` | `runtime`, `ui`, valeurs du moteur |
| `runtime` | `engine`, `content`, `asset-meta` | `ui` |
| `ui` | API du Director (`runtime`), types du moteur | `engine` en valeur, sauf utilitaires purs explicitement exportés |

`compileChapter()` fait partie du moteur, qui ne connaît pas le DSL. C'est `runtime` qui compile le contenu au démarrage.

## 5. Rendu

### 5.1 DOM/CSS plutôt que PixiJS

| Critère | Ce que montrent nos assets et notre besoin |
|---|---|
| Complexité de scène | 6 calques au plus (décor, personnage, bureau, effets, interjection, UI) ; 1 ou 2 personnages ; animations à 10–15 images/s |
| Format | Art peint en HD : pas de pixel art, pas besoin de contrôler le filtrage texel par texel |
| Effets | Secousse, flash, fondu, zoom d'interjection et panoramique sont faisables en `transform`/`opacity` via la Web Animations API |
| Texte et UI | Le texte natif est net, accessible et facile à tester avec Playwright ; Tailwind s'applique directement |

PixiJS apporterait un scene graph, du batching, des filtres et des render textures, inutiles à cette échelle, au prix d'un second modèle de rendu à synchroniser avec React. **Repli** : si le jalon 1 montre des saccades (voir §5.6), on réévalue.

### 5.2 Deux couches

- **La scène** contient le décor, les personnages, les bureaux et les effets de scène.
  - Elle vit dans un repère **logique fixe de 1920×1080** (16:9), le format natif des décors et de la trilogie HD.
  - Un conteneur `1920×1080` est mis à l'échelle uniforme (`transform: scale(s)`), centré, avec letterbox noir.
  - Le lissage est celui par défaut, adapté à l'art peint : pas de `image-rendering: pixelated`.
- **L'UI** comprend la boîte de texte, la plaque de nom, les boutons et la barre de vie.
  - C'est un calque CSS superposé au rectangle de la scène.
  - Les tailles sont calculées à partir de l'échelle de la scène, avec un **minimum lisible** : par exemple `font-size: max(16px, calc(40px * var(--scene-scale)))`.
  - Sur desktop, on garde ainsi le ratio texte/image d'origine ; sur petit écran, le texte reste lisible.
- **Vue détail d'une preuve** : une fenêtre plein écran, **hors du repère de la scène**, qui permet de zoomer et de faire défiler les captures verticales.
- **Cible v1** : desktop, à partir de 1280×720, navigateurs récents (Chrome, Edge, Firefox, Safari). **Mobile non garanti en v1.**

### 5.3 Ordre des calques (dans la scène)

1. Décor (avec panoramique possible pour les fonds 3840 et `houscr`)
2. Personnage(s)
3. Bureau ou avant-plan (`etc2x`, `bg01ew`)
4. Effets de scène : lignes de vitesse, flash blanc
5. Interjection (bulle « Objection ! »)

La couche UI vient par-dessus : barre de vie, boîte de texte, contrôles, fenêtres (Dossier, vue détail).

### 5.4 Sprites et rigs

**Rigs écrits à la main** (`asset-meta/rigs/<sprite>.json`, versionnés ; types dans `asset-meta/manifest-types.ts`) :

| Type de rig | Contenu | Construction |
|---|---|---|
| `frames` (Ron) | Références aux frames détectées par `scripts/slice-frame-sheet.ts` (fichier `<sprite>.slices.json`) : `idle`, `blink[]`, `talk[]` | Les frames d'une bande partagent leur bord gauche (pas de grille de 850 px) et leur ligne de base : elles sont alignées à gauche et en bas dans la boîte de pose. L'ancre est en bas au centre de la frame idle. |
| `parts` (atlas) | `size`, `anchor`, `base[]`, puis `blink[][]` et `talk[][]`, qui sont des surcouches. Chaque pièce porte `src` (rectangle dans l'atlas) et `at` (position dans la pose). | Une pièce peut porter `seeds`, des points de départ : seuls les pixels opaques 8-connexes à ces points sont gardés, ce qui retire les pièces étrangères rangées dans le rectangle. Elle peut aussi porter `exclude`, des rectangles effacés. Les offsets des patchs sont trouvés par template-matching (pour Phoenix, l'écart médian est de 0 sur la bouche fermée, et d'environ 3 sur 255 pour les deux bouches de parole), puis vérifiés visuellement. Un rectangle source ne doit contenir que sa pièce : l'atlas de Phoenix range un œil et un nez juste au-dessus de la bouche ouverte. |

**Ce que produit le pipeline** (`public/generated/manifest.json`) :
- **Frames complètes.** Chaque frame d'animation est **complète** : c'est la liste de toutes les pièces à dessiner, base comprise. Le runtime n'a donc qu'un seul modèle de rendu.
- **Patchs de différence.** Pour un rig `frames`, chaque frame d'animation est réduite aux **pixels qui diffèrent** de la frame idle. Ce patch est dessiné par-dessus la base. On garde la frame entière dans un seul cas : quand superposer le patch ne reproduirait pas la frame, c'est-à-dire quand il faudrait effacer ou mélanger des pixels de la base. Résultat pour Ron « normal » : une feuille de 1385×1145 au lieu de 5 frames de 770×1145.
- **Contrôle anti-tremblement.** Toute frame entière de repli est comparée à la frame idle sur les 20 % du bas de la pose, une zone qui n'est jamais animée. **Le build échoue** si plus de 2 % des pixels diffèrent. Les frames patchées sont identiques à la base hors du patch, par construction.
- **Contrôle des raccords (rigs `parts`).** Une surcouche (bouche, yeux) remplace des pixels à l'intérieur du visage : son bord, sur 2 px, doit donc se fondre dans la base. **Le build échoue** si plus de 2 % des pixels de ce bord diffèrent de la base de plus de 48 sur un canal. Cela révèle un rectangle source qui déborde sur une pièce voisine de l'atlas, ou un mauvais offset. Ce contrôle a détecté la bouche ouverte de Phoenix : 39 % de son bord différait.
- **Une feuille par pose.** Les pièces sont rangées dans une petite feuille WebP par pose (rangement en étagères, largeur maximale de 4096 px).

**À l'exécution** :
- `CharacterSprite` rend un conteneur positionné sur l'emplacement de la vue (`slot` moins `anchor`), avec un petit nombre de `<div>` en position absolue. Chaque `<div>` affiche la feuille de la pose en `background-image`, décalée par `background-position` sur sa pièce.
- `SpritePlayer`, impératif et branché sur un ticker `requestAnimationFrame` partagé, change les `background-position` pour la parole et le clignement **sans re-render React**.
- Le clignement suit un intervalle pseudo-aléatoire **seedé** (mulberry32) de 2,2 à 5,2 s, à 55 ms par frame.
- La parole tourne en boucle à 90 ms par frame tant que le personnage parle.
- Une pose ne s'affiche qu'une fois sa feuille décodée (`img.decode()`).

**Vues du tribunal** (`asset-meta/assets.ts`, `courtViews`) : pour chaque vue, un décor, un bureau de premier plan avec sa position, et l'emplacement du personnage. Ces positions ont été **confirmées par captures** au jalon 1.

### 5.5 Mémoire

- Une planche brute n'est jamais chargée (jusqu'à 225 Mo décodée) : seules les feuilles par pose arrivent dans le navigateur.
- Les ressources sont chargées par section : avant d'afficher un état, le Director attend `img.decode()` pour les images indispensables.
- Un cache LRU garde les ressources des sections courante et suivante et **libère les références** des autres.
- Les images sont chargées sans `crossOrigin` (aucun pixel n'est lu), comme les `<img>` et les fonds CSS qui les affichent : elles partagent le cache HTTP et n'ont pas besoin de CORS quand les assets sont sur R2.
- Après le clic de démarrage, `Presenter.warmUp()` précharge les sons des effets, les voix, les blips et les bulles d'interjection, au mieux et sans bloquer (utile quand les assets viennent de `r2.dev`, sans CDN).
  - Le format WebP réduit le transfert, pas la mémoire décodée.
  - La LRU borne ce que **l'application** retient ; elle ne garantit pas la libération immédiate des caches internes du navigateur. La mémoire est **mesurée** (DevTools, HUD de debug), pas promise.

### 5.6 Critères de performance

- Aucun rendu React global à chaque frame. Les animations (sprites, frappe, secousse) mutent le DOM via des refs ou la Web Animations API.
- Pas de saccade perceptible :
  - aucune *long task* de plus de 50 ms pendant les animations ;
  - **régularité des frames** mesurée par le HUD de performance en développement : intervalle entre frames rAF (p95) et nombre de frames perdues.
- La mémoire décodée est mesurée sur une scène de tribunal complète.

## 6. Pipeline d'assets

| Étape | Rôle |
|---|---|
| `scripts/reorganize-assets.ts` | Réorganisation unique et réversible d'`assets/` (déjà exécutée ; voir `ASSET_INVENTORY.md`). |
| `scripts/slice-frame-sheet.ts` | Détecte les bandes et les frames d'une planche compilée (Ron) et écrit un brouillon de rig. |
| `scripts/build-assets.ts` | Lit `asset-meta/assets.ts` et `asset-meta/rigs/*.json`, puis écrit dans `public/generated/` :<br>• décors et bureaux en WebP, à la taille d'origine ;<br>• interjections en WebP ;<br>• feuilles de pose en WebP ;<br>• audio copié tel quel (MP3, WAV) ;<br>• `manifest.json` (schéma v2), qui contient la `release` et, pour chaque alias, le **chemin** relatif, les dimensions, les ancres et les rectangles ;<br>• `release.json`, l'index de la release (chemin, taille, SHA-256, Content-Type de chaque fichier).<br>Seuls les assets **référencés** sont traités ; le build est incrémental (hash source + paramètres). La `release` est déterministe : 16 caractères hexadécimaux du SHA-256 du manifeste et des fichiers référencés. |
| `scripts/upload-assets.ts` | `pnpm assets:upload [--dry-run]` : publie la release sur R2 sous `releases/<release>/`, sans jamais écraser ni supprimer ; `release.json` en dernier, comme marqueur de complétude (`DEPLOYMENT_R2.md`). |
| `scripts/verify-release.ts` | `pnpm assets:verify` : vérifie une release publiée par son URL publique, CORS compris. |
| `scripts/vite-asset-plugin.ts` | Choisit ce qui va dans `dist/` : en local, le manifeste et ses fichiers ; en distant, le manifeste seul, après avoir vérifié que la release est publiée. |

La règle à respecter : les **métadonnées** (alias, rigs, paramètres) sont versionnées, mais les **images** ne le sont pas.

**Résolution des URL.** Le manifeste ne contient que des chemins ; `AssetCatalog` (`src/runtime/assets.ts`) les résout une seule fois avec `asset-meta/release-layout.ts`, selon `VITE_ASSET_BASE_URL` :
- absente : `<base>generated/<chemin>`, servi localement ;
- définie (`--mode remote`, `.env.remote`) : `<VITE_ASSET_BASE_URL>releases/<release>/<chemin>`.

Le manifeste lui-même est toujours servi par le frontend. Le moteur, le contenu et le Director ne manipulent que des IDs. Le `base` de Vite ne change pas. Voir `DEPLOYMENT_R2.md`.

## 7. Moteur

### 7.1 Contenu compilé

Le DSL produit un `ChapterSource` : des sections composées de commandes, avec des corps imbriqués pour les pressions, les réponses et les conditions. `compileChapter()` produit un `CompiledChapter` en quatre opérations :
- les corps imbriqués deviennent des **blocs** nommés, dont l'ID est dérivé de leur position (par exemple `proces/ce1#3/press:s2`) ;
- le texte est analysé en jetons (§10) et normalisé (typographie française) ;
- les témoignages sont développés en commandes ;
- le hash `compat` est calculé (§12).

### 7.2 État

L'état du moteur ne contient que des **données sérialisables** : unions, tableaux, dictionnaires, chaînes, nombres, booléens. Il ne contient ni fonction, ni classe, ni référence DOM.

```ts
interface EngineState {
  readonly v: 1;
  frames: Frame[];                 // call stack, top = last
  wait: Wait;
  waitRev: number;                 // incremented on every new wait
  fxSeq: number;                   // last blocking-effect id
  stage: Stage;                    // authoritative visual snapshot
  vars: Record<string, number | boolean>;
  record: { evidence: string[]; profiles: string[]; variants: Record<string, string> };
  ce: Record<string, CrossExamState>;
  health: number;                  // 0..chapter.maxHealth
}
interface Frame { block: string; ip: number }

type Wait =
  | { t: 'line' }                          // a line is displayed; waits for `advance`
  | { t: 'fx'; fxId: number }              // waits for the end of a blocking effect
  | { t: 'ce'; ce: string }                // cross-examination: next / prev / press / present
  | { t: 'ended'; ending: string };

type CourtPos = 'defense' | 'prosecution' | 'witness' | 'judge' | 'cocounsel';
interface Actor { char: string; pose: string }
interface Stage {
  place: { k: 'none' } | { k: 'court'; view: CourtPos | 'wide' } | { k: 'location'; bg: string };
  court: Partial<Record<CourtPos, Actor>>;   // who stands where, persists across camera cuts
  actor: Actor | null;                       // single character shown in a location
  music: string | null;
  healthBar: boolean;
}
```

### 7.3 Exécution

```ts
function startChapter(chapter: CompiledChapter): StepResult;
function step(state: EngineState, input: Input, chapter: CompiledChapter): StepResult;
function availableInputs(state: EngineState, chapter: CompiledChapter): Input['t'][];  // UI only
function hydrate(state: EngineState, chapter: CompiledChapter): Effect[];              // rebuild visuals after load

type StepResult =
  | { ok: true; state: EngineState; effects: Effect[] }
  | { ok: false; state: EngineState; reason: RejectReason };   // state unchanged

type Input =
  | { t: 'advance'; rev: number }                       // next line, or next statement in a CE
  | { t: 'cePrev'; rev: number }
  | { t: 'press'; rev: number }
  | { t: 'present'; rev: number; item: string }         // evidence or profile id
  | { t: 'fxEnd'; fxId: number; outcome: 'done' | 'failed' };
```

Règles d'exécution :
- **Course jusqu'à une attente.** Le moteur exécute les instructions jusqu'à la prochaine attente (`line`, `fx`, `ce`, `ended`), en accumulant les effets.
- **Budget d'instructions.** Au-delà de 10 000 instructions sans attente, le moteur lève `ContentError` avec la trace des derniers blocs. C'est ce qui protège des boucles d'`exitTo` : aucun timeout du Director ne pourrait les résoudre.
- **`exitTo(section)`** vide la pile et repart de la section. **`call(section)`** empile la section et y revient à la fin.
- **`if`** avance le pointeur parent, puis empile le bloc `then` ou `else`.
- **Fin de bloc.** On dépile. Le pointeur du parent pointe soit après l'appel (`call`, `if`), soit **sur** l'instruction ré-entrante (contre-interrogatoire), qui est alors réexécutée.
- **Fin de pile.** Une pile vide sans `ending` est une `ContentError` ; le validateur la détecte en amont.
- **Santé à 0.** Lorsque `penalty` fait tomber la santé à 0 ou moins, l'effet `damage` est émis (bloquant), puis la pile est remplacée par `[{ block: chapter.gameOver, ip: 0 }]`. Les commandes situées après la pénalité ne s'exécutent pas.
- **Caméra automatique.** Un `say` dont le locuteur occupe une position au tribunal coupe sur cette position et applique la pose, sauf pour une pensée (`thought`), qui ne change pas la caméra.
- **Camp joueur.** `chapter.player = { char, bench }` : quand Mimi presse, « Un instant ! » vient du personnage joueur, et « Objection ! » quand Mimi présente une preuve. Gagner, c'est simplement atteindre une fin (`ending`).

## 8. Contrat moteur ↔ Director

### 8.1 Entrées

**Refus.** `step()` **refuse lui-même** toute entrée invalide ou périmée. Il renvoie `ok: false` avec l'état inchangé et un motif, que le HUD de debug affiche en développement. `availableInputs()` sert uniquement à activer ou désactiver les boutons.

**`waitRev`, la révision d'attente.**
- Elle est incrémentée à chaque nouvelle attente.
- Toute entrée joueur porte le `rev` de l'attente qu'elle vise ; le moteur la refuse si `rev !== state.waitRev`.
- `waitRev` rejette deux actions qui visent la même attente. Il n'absorbe pas un second clic distinct qui vise déjà la réplique suivante, et c'est voulu.

**Capture de la révision.** Le `rev` est capturé **à la création de l'action**, dans le gestionnaire d'événement UI, à partir de l'instantané affiché. Le Director le transmet **tel quel** et ne le remplace jamais par la révision courante.

**Clic de complétion.** Un clic pendant la frappe complète la ligne : il est **consommé par la présentation** et n'est jamais transmis au moteur. Seul un clic sur une ligne entièrement affichée envoie `advance`. Le comportement attendu dans le navigateur est donc : un clic complète la ligne, le clic suivant avance.

**Clic entre deux lignes.** Chaque ligne affichée porte une clé (`line.key`). La boîte de dialogue est re-montée à chaque ligne, et la machine à écrire active est étiquetée avec cette clé.
- Un clic qui arrive après la mise à jour du store mais **avant** le démarrage de la machine à écrire de la nouvelle ligne est **ignoré**. Sans cette garde, un clic aurait pu faire avancer une ligne jamais affichée, bug repéré par les tests e2e.
- Les flèches et le bouton ▶ du contre-interrogatoire suivent la même règle : un clic pendant la frappe complète d'abord la déclaration.

### 8.2 Effets

```ts
type Effect =
  | { fx: 'stage'; stage: Stage; transition: 'cut' | 'fade'; fxId?: number }    // fxId when blocking
  | { fx: 'line'; speaker: string | null; name: string | null; tokens: TextToken[];
      style: 'dialogue' | 'thought' | 'testimony' | 'crossExam';
      ce?: { id: string; stmt: string; isFirst: boolean; isLast: boolean } }
  | { fx: 'interjection'; kind: 'objection' | 'holdit' | 'takethat'; by: string; fxId: number }
  | { fx: 'music'; track: string | null; fadeMs: number }
  | { fx: 'sfx'; sound: string }
  | { fx: 'shake' | 'flash'; ms: number; fxId?: number }
  | { fx: 'wait'; ms: number; fxId: number }
  | { fx: 'damage'; amount: number; health: number; max: number; fxId: number }
  | { fx: 'var'; name: string; delta: number; value: number; toast: string | null }
  | { fx: 'record'; op: 'add' | 'remove' | 'update'; kind: 'evidence' | 'profile'; item: string; fxId?: number }
  | { fx: 'banner'; kind: 'testimony' | 'crossExam'; title: string; fxId: number }
  | { fx: 'verdict'; text: string; fxId: number }
  | { fx: 'healthBar'; visible: boolean }
  | { fx: 'ended'; ending: string };
```

- **Effets bloquants.** Un effet est bloquant s'il porte un `fxId`. Un lot d'effets contient **au plus un** effet bloquant, toujours en dernier : le moteur s'arrête là avec `wait = { t: 'fx', fxId }`.
- **Fin d'effet.** Le Director signale la fin par `{ t: 'fxEnd', fxId, outcome }`, et le moteur ne l'accepte que si `fxId === wait.fxId`.
- **Ordre de lecture.** Le Director joue **tous** les effets dans l'ordre, bloquants ou non. Une ligne ne s'affiche donc qu'après le changement de décor qui la précède.

### 8.3 Sessions d'exécution (runs) et annulation

- **`runId`.** Le Director tient un `runId`, renouvelé à chaque nouvelle partie, redémarrage et (au jalon 4) chargement.
- **Annulation.** Chaque run possède son `AbortController`. Toutes les animations, timers et sons transitoires y sont rattachés et sont **annulés** au changement de run.
- **Callbacks périmés.** Un effet annulé n'est **jamais** acquitté. Un acquittement portant un ancien `runId` est ignoré, et un `fxId` qui n'est pas celui attendu est refusé par le moteur.
- **Issue d'un effet** : `done`, `cancelled` ou `failed`. Le `finally` sert **uniquement au nettoyage** ; il ne signale jamais une réussite.
  - **Effet cosmétique** (secousse, flash, son, voix, image d'interjection) en échec ou en timeout : il est arrêté de force, puis acquitté avec `outcome: 'failed'`, et le jeu continue.
  - **Ressource indispensable** (décor ou feuille de pose de la scène) en échec : le Director affiche « Réessayer » et n'acquitte rien tant que ce n'est pas résolu.
- **Timeouts.** Chaque effet bloquant a une durée maximale (par exemple, interjection 4 s, `wait` : `ms` + 1 s).

### 8.4 React

Le Director est créé **une seule fois au démarrage, hors de React**. Les composants enregistrent et désenregistrent leurs cibles DOM (`attachStage(el)`, `attachTextBox(el)`) de façon **idempotente**, ce qui résiste aux doubles cycles d'effets du Strict Mode. React lit l'état affiché par des sélecteurs Zustand.

### 8.5 État stable

Le Director considère l'état comme **stable** quand sa file d'effets est vide et que le moteur attend une ligne ou un contre-interrogatoire. Seul un état stable peut être sauvegardé (§12). Pendant une animation, le Director conserve le dernier état stable.

## 9. Contre-interrogatoire

```ts
interface CrossExamState {
  current: string;                       // statement id, never an index
  revealed: string[];
  amended: Record<string, string>;       // statement id -> variant key
  pressed: string[];
  after: null
    | { k: 'press'; stmt: string; resume: 'next' | 'same' | { to: string } }
    | { k: 'wrong'; stmt: string }
    | { k: 'loop' }
    | { k: 'resume' };
}
```

| Action | Règle |
|---|---|
| Identité | Chaque déclaration a un **ID stable**. Ajouter une déclaration cachée ne déplace pas le point de reprise. |
| Entrée | Au premier passage, l'état est créé (`current` = première déclaration visible) et la bannière « Contre-interrogatoire » est émise (bloquante). Ensuite, l'instruction est ré-entrante : elle applique `after`, l'efface, émet la déclaration courante et attend (`ce`). |
| Ordre visible | L'ordre d'écriture, en ne gardant que les déclarations non cachées ou révélées. |
| Suivant (`advance`) | On passe à la déclaration visible suivante. Sur la **dernière** : on appelle le bloc `loop` s'il existe, puis on revient à la **première** déclaration visible. |
| Précédent (`cePrev`) | On revient à la déclaration visible précédente. Sur la première, l'entrée est **refusée**. |
| Presser S | « Un instant ! » du personnage joueur (bloquant), puis appel du bloc `press[S]`. Au retour, par défaut, on passe à la **déclaration visible suivante**, qui est la nouvelle si une déclaration a été révélée juste après S. Chaque pression peut forcer `resume: 'same' \| 'next' \| { to }`. |
| Révéler / amender | `reveal(ce, stmt)` rend une déclaration visible **à sa position écrite**. `amend(ce, stmt, variant)` remplace le texte sans déplacer la déclaration. |
| Mauvaise preuve sur S | « Objection ! » du joueur, puis appel de `wrongAt[S] ?? wrong`. La pénalité est écrite dans ce bloc et s'applique donc **une fois par présentation**. Au retour, on revient à S. |
| Bonne preuve | Une preuve est bonne si S figure parmi les déclarations de la solution et l'objet parmi ses objets. « Objection ! » du joueur, puis appel du bloc solution. Celui-ci **doit** se terminer par `exitTo(...)` (sortie définitive) ou `resumeCrossExam()` (reprise sur S, par exemple après un amendement). Le validateur signale toute solution qui ne fait ni l'un ni l'autre. |
| 0 PV | Toute la pile est abandonnée, puis on passe à la section `gameOver` (§7.3). |

## 10. Texte

**Balisage** (analysé à la compilation en `TextToken[]`) :

| Balise | Effet |
|---|---|
| `{red}…{/}` | Rouge : élément important |
| `{blue}…{/}` | Bleu : pensée |
| `{green}…{/}` | Vert : témoignage |
| `{p:400}` | Pause de 400 ms |
| `{s:0.5}` | Vitesse de frappe ×0,5 (plus lente) jusqu'à la fin de la ligne ou la prochaine balise `{s}` |
| `{shake}`, `{flash}` | Secousse ou flash au moment où la frappe atteint la balise |
| `{sfx:id}` | Son au moment où la frappe atteint la balise |
| `{raw}…{/raw}` | Désactive la normalisation typographique (citation exacte d'un message) |

```ts
type TextToken =
  | { t: 'text'; text: string; color: 'white' | 'red' | 'blue' | 'green' }
  | { t: 'pause'; ms: number } | { t: 'speed'; factor: number }
  | { t: 'shake' } | { t: 'flash' } | { t: 'sfx'; sound: string };
```

**Typographie française** : le balisage est analysé **avant** cette normalisation, qui ne s'applique qu'aux jetons de texte hors `{raw}`.

| Contexte | Transformation |
|---|---|
| Espace avant `!` `?` `;` | Espace fine insécable U+202F |
| Espace avant `:` | Espace insécable U+00A0 |
| Guillemets `« »` | Espace insécable U+00A0 à l'intérieur |
| `!` ou `?` collé à un mot | Insertion de U+202F devant la première ponctuation (`Quoi?!` → `Quoi ?!`) |
| `:` collé à un mot | Rien n'est inséré, pour préserver `23:12` |

**Machine à écrire** (présentation) :
- Tous les caractères sont rendus d'avance dans des `<span>` invisibles, puis révélés via des refs. La mise en page ne bouge jamais : un mot ne saute pas de ligne en cours de frappe.
- La vitesse de base se règle dans les options. Les blips sautent les espaces et la ponctuation et sont limités à un toutes les 45 ms environ.
- **Compléter une ligne** révèle tout le reste et **ignore** les pauses, changements de vitesse et effets inline restants. Les effets inline sont décoratifs par contrat ; un effet important doit être une commande séparée.

## 11. Audio

`AudioService`, au-dessus de Howler :
- **Musiques.** Une piste à la fois, avec fondu enchaîné. Les MP3 longs sont lus avec `html5: true`.
- **Effets sonores et voix.** Lecteurs multiples ; un son transitoire est rattaché au run et coupé à l'annulation.
- **Blips.** WAV courts, lus en Web Audio pour une latence minimale.
- **Volumes séparés** : musique, effets, voix, blips. Ils sont réglés dans les options (stockées en localStorage).
- **Autoplay.** Un écran « Cliquez pour commencer » déverrouille l'`AudioContext` avant toute lecture.
- **Origine distante.** Les sons ponctuels passent par Web Audio : Howler les télécharge en XHR, ce qui exige CORS quand les assets sont sur R2. En cas d'échec, Howler bascule **silencieusement** en HTML5 ; une sonde au démarrage (`probeAssetCors`) signale donc une origine refusée. Un son qui ne se charge pas est déchargé, puis ignoré pendant 30 s : il ne bloque pas le jeu et ne déclenche pas de rafale de requêtes.
- **Repli des voix.** Si un personnage n'a pas de voix pour une interjection (Franziska n'a qu'« Objection »), on utilise le repli déclaré dans son registre, sinon on ne joue aucune voix. Le validateur avertit.

## 12. Sauvegarde et reprise (jalon 4)

**Ce qui est sauvegardé.** v1 : **une autosauvegarde** et un bouton « Continuer ».
- **Quand** : uniquement aux états **stables** (§8.5).
- **Format** : `{ saveFormat: 1, chapter: { id, compat }, at, state }`, en `localStorage` sous la clé `waswas:autosave`.
- **`compat`** = hash de la **structure** du chapitre compilé et d'une **révision manuelle** `chapter.contentRevision`.
  - Il inclut les commandes, les IDs et les jetons non textuels (`{sfx}`, `{p}`, `{flash}`…) ; seuls les mots affichés en sont exclus.
  - Corriger une faute de frappe garde donc la sauvegarde ; déplacer un `{sfx}` l'invalide.

**Au chargement :**
- **Même `compat`** : l'état est restauré à l'identique, puis `hydrate()` restaure le visuel persistant (décor, personnages, musique, barre de vie) **sans transition**. Les effets déjà consommés (dégâts, voix, interjections, notifications) ne sont jamais rejoués.
- **`compat` différent** : le chapitre redémarre avec un état neuf et le message « Le jeu a été mis à jour : la partie recommence au début du chapitre. »
- **Stockage défaillant** (localStorage absent, données corrompues, écriture refusée) : le jeu reste jouable et un avertissement non bloquant s'affiche. Une sauvegarde corrompue est ignorée et l'écran propose « Nouvelle partie ».

**Reporté :**
- emplacements manuels ;
- import et export ;
- chaîne de migrations (le champ `saveFormat` existe dès le départ) ;
- repli sur un checkpoint. Il exigerait une compatibilité propre à chaque checkpoint et une validation des références du snapshot.

## 13. Contenu

### 13.1 Format : modules TypeScript et DSL typé

| Option | Verdict |
|---|---|
| JSON | Pas de commentaires, verbeux, aucune vérification des IDs à la compilation. |
| YAML | Piégé par la ponctuation française (`Objection : …`), pas de types. |
| DSL textuel maison | Agréable à écrire, mais demande un parseur, des messages d'erreur et un outillage d'éditeur, et les assistants IA ne le connaissent pas. |
| **TypeScript + builders** | Autocomplétion des IDs et des poses, erreurs de compilation, renommage, commentaires. Les assistants IA l'écrivent bien. **Retenu.** |

**Registres** (`as const`) : personnages, poses, preuves, profils, variables, décors, musiques et effets sonores. `wassim.say('sueur', "…")` est donc vérifié à la compilation.

**Identité ≠ planche** : Wassim peut utiliser la planche `ron-delite`, et Mimi la planche `miles-edgeworth`.

**Vérifications au test.** Les références « en avant » (cibles d'`exitTo`, IDs cités dans le balisage) sont contrôlées par le validateur (§14).

### 13.2 Exemple : témoignage et contradiction

```ts
// src/content/demo/proces.ts (illustrative)
export const tSoiree = testimony('t-soiree', 'La soirée du 14 mars', 'wassim', [
  { id: 's1', pose: 'normal', text: "Le soir du 14, je suis rentré chez moi vers 21 h." },
  { id: 's2', pose: 'normal', text: "Mon téléphone était à plat, j'ai dormi direct." },
  { id: 's2b', pose: 'sueur', text: "Il s'est éteint vers 22 h, au plus tard.", hidden: true },
  { id: 's3', pose: 'normal', text: "Donc je n'ai envoyé {red}aucun message{/} cette nuit-là !" },
]);

const mauvaisePiece = [
  juge.say('normal', "L'accusation s'égare… Je ne vois pas le rapport."),
  wassim.say('normal', "Trop facile.{p:300}"),
  addVar('expWassim', 10),     // before the penalty: 0 HP aborts the block
  penalty(20),
];

export const ce1 = section('proces/ce1', [
  play(tSoiree),
  crossExam({
    id: 'ce-soiree', testimony: tSoiree,
    press: {
      s1: [mimi.say('normal', "« Vers 21 h » ? Vous en êtes certain ?"),
           wassim.say('normal', "Ouais. Demandez à mon chat.")],
      s2: [mimi.say('normal', "À plat ? Depuis quelle heure ?"),
           wassim.say('sueur', "Euh… Vers 22 h, je dirais."),
           reveal('ce-soiree', 's2b')],
      s3: [mimi.say('normal', "Aucun message ? Vous le jurez ?"),
           wassim.say('normal', "Sur la tête de ma console.")],
    },
    solutions: [{
      stmts: ['s3', 's2b'], items: ['capture-23h12'],
      body: [
        music('pursuit'),
        mimi.say('normal', "Ce message a été envoyé {red}à 23 h 12{/}… depuis {red}votre{/} compte !"),
        wassim.say('pleure', "Q-quoi ?!{shake} C'est un montage !"),
        exitTo('proces/apres-ce1'),
      ],
    }],
    wrong: mauvaisePiece,
  }),
]);
```

## 14. Validation et tests

| Niveau | Outil | Garantie |
|---|---|---|
| Statique | `validateChapter()`, exécuté par Vitest et `pnpm content:check` | Structure ; références (sections, témoignages, déclarations, preuves, vars, sons dans le balisage) ; existence d'une solution **déclarée** ; solutions terminées par `exitTo`/`resumeCrossExam` ; sections qui ne retombent pas en fin de pile ; balisage équilibré ; voix manquantes (avertissement) ; longueur des lignes (heuristique). |
| Parcours déterministes | Joueur headless (Vitest) | Chemin doré jusqu'à « Coupable » ; erreurs importantes ; 0 PV menant à l'acquittement. Ce sont eux qui prouvent l'**accessibilité réelle**. |
| Exploration seedée bornée | Vitest | Recherche de bugs avec une seed et une trace reproductibles ; **pas** une preuve d'absence de blocage. |
| Director | Vitest, effets contrôlables | Rejet des acquittements périmés après redémarrage ou chargement sans rechargement de la page ; `waitRev`. |
| Navigateur | Playwright | Chemin rapide (`?fast=1`) ; **au moins un parcours à vitesse normale** ; clic de complétion puis avance ; rechargement de la page pendant une objection (persistance, jalon 4) ; captures des vues. |

**Mise en œuvre**

| Composant | Fichier | Rôle |
|---|---|---|
| Validateur statique | `src/engine/validate.ts` | Un contre-interrogatoire compte comme fin de section valide, puisqu'il n'en sort que par l'`exitTo` d'une solution. |
| Joueur headless | `src/engine/autoplay.ts` (`AutoPlayer`) | Acquitte les effets bloquants comme le ferait le Director. |
| Exploration seedée | `src/engine/autoplay.ts` (`explore`) | Exploration bornée et reproductible. |
| Tests du contenu de démo | `src/content/demo/demo.content.test.ts` | Validation, parcours déterministes, 300 explorations. |
| Tests e2e | `tests/e2e/` | Exécutés sur **un seul worker**, parce que certains tests mesurent la régularité des frames. Deux projets : `local` (assets servis par Vite) et `remote-emulated` (build distant et émulateur R2). |
| Hébergement des assets | `asset-meta/release-layout.test.ts`, `scripts/*.test.ts`, `src/runtime/{assets,audio}.test.ts`, `tests/e2e/assets.spec.ts` | Correspondance URL ↔ clé R2, version déterministe, upload immuable et reprenable, CORS, contenu de `dist/`, ressources absentes. |

## 15. Compromis assumés

| Compromis | Raison |
|---|---|
| Rigs saisis à la main | L'automatique échoue sur les atlas ; on compense en limitant les poses à celles qui servent vraiment. |
| Sauvegarde stricte | Une modification de structure redémarre le chapitre. C'est moins confortable, mais toujours cohérent. |
| Desktop d'abord | Le mobile n'est pas garanti en v1 ; les deux couches d'affichage le préparent sans le promettre. |
| Blocs dérivés de leur position | Leurs IDs changent quand on insère une commande, ce qui est acceptable puisque `compat` est strict. |
