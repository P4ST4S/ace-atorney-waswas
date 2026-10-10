# Déploiement des assets sur Cloudflare R2

Les ressources du jeu (décors, sprites, interjections, preuves, musiques, voix, effets sonores) sont servies **localement** par défaut, ou depuis le **bucket R2 public**, chargées directement par le navigateur. Le frontend (HTML, JS, CSS et manifeste) reste un site statique hébergé à part : aucun Worker, aucune migration de l'hébergement du frontend. Le moteur et le contenu ne manipulent que des IDs ; seule la résolution des URL change.

## 1. Valeurs connues

| Paramètre | Valeur |
|---|---|
| URL navigateur (publique) | `https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev` |
| Endpoint S3 (privé, avec credentials) | `https://3ba4389dadfb525c4920fd6c0e13766f.r2.cloudflarestorage.com` |
| Account ID | `3ba4389dadfb525c4920fd6c0e13766f` |
| Bucket | `ace-atorney-waswas` |
| Région S3 | `auto` |

- L'URL navigateur est **déjà liée au bucket** : on n'y ajoute jamais `/ace-atorney-waswas`. `parseAssetBaseUrl` refuse d'ailleurs un chemin après une URL `r2.dev`.
- L'endpoint S3 ne contient pas le nom du bucket : le script d'upload passe `R2_BUCKET` à part, à chaque requête.

## 2. Modes local et distant

| Mode | Commandes | URL des assets | Manifeste |
|---|---|---|---|
| Local (défaut) | `pnpm dev`, `pnpm build`, `pnpm preview` | `/generated/<chemin>` (`public/generated/`) | `/generated/manifest.json` |
| Distant | `pnpm dev:remote` (port 5173), `pnpm build:remote` puis `pnpm preview` (port 4173) | `<VITE_ASSET_BASE_URL>releases/<release>/<chemin>` | `/generated/manifest.json`, servi par le frontend |

**Configuration** :
- `VITE_ASSET_BASE_URL` est la **seule** variable publique. Elle est typée dans `src/vite-env.d.ts` et définie dans `.env.remote` (versionné), que Vite lit en `--mode remote`.
- Absente ou vide, elle sélectionne le mode local. Le mode distant n'est donc jamais actif par défaut.
- On peut la remplacer sans toucher au dépôt :
  - par une variable du shell (prioritaire sur les fichiers) ;
  - par `.env.remote.local`, ignoré par git.
- Elle est validée au démarrage et au build. Sont refusés :
  - une URL relative, une query ou un fragment, des identifiants ;
  - l'endpoint S3 privé ;
  - un chemin après `r2.dev` ;
  - `http:` hors `localhost`, car une page en https ne peut pas charger d'assets en http.
- Le `base` de Vite ne change pas : seul l'hébergement des assets change.

**Résolution** :
- Toute la logique est dans `asset-meta/release-layout.ts`, partagé par le runtime, les scripts, le plugin Vite et les tests.
- `AssetCatalog` (`src/runtime/assets.ts`) charge le manifeste et résout **une seule fois** chaque chemin en URL : `image()`, `pose()` et `audio()` renvoient des URL prêtes à l'emploi.
- Chaque segment de chemin est encodé avec `encodeURIComponent`, et les `/` sont conservés. Les chemins `..`, `.`, vides, avec `\` ou avec des caractères de contrôle sont refusés.

## 3. Releases versionnées

`pnpm assets:build` écrit dans `public/generated/` :
- les fichiers du runtime ;
- `manifest.json`, au schéma v2 : un champ `release` et des chemins relatifs comme `sprites/ron-delite/normal.webp` ;
- `release.json`, l'index de la release : chemin, taille, SHA-256 et Content-Type de chaque fichier, manifeste compris.

| Règle | Détail |
|---|---|
| Version | Les 16 premiers caractères hexadécimaux du SHA-256 du manifeste (hors `release`) et des fichiers qu'il référence (chemin, taille, SHA-256). |
| Déterminisme | Mêmes fichiers générés, même release. C'est vérifié après une reconstruction complète (`pnpm assets:build --force`). Une autre version de sharp ou de libvips peut produire d'autres octets, donc une autre release ; c'est sans risque, puisque ce sera simplement une nouvelle release. |
| Contenu | Seuls les fichiers **référencés** par le manifeste. Ni `.cache.json`, ni `poses.json`, ni fichiers périmés, ni planches sources : `assets/` reste en local. |
| Clés R2 | `releases/<release>/<chemin>`, par exemple `releases/484a0b919698a519/sprites/ron-delite/normal.webp`. |
| URL | `https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev/releases/484a0b919698a519/sprites/ron-delite/normal.webp` |
| Noms de fichiers | Le pipeline n'accepte que `[A-Za-z0-9._-]`, et refuse deux noms qui ne diffèrent que par la casse : le serveur de dev ne décode pas toutes les séquences `%xx`, et Windows ignore la casse alors que R2 la respecte. |
| Immuabilité | Une release publiée ne change jamais. Ses objets portent `Cache-Control: public, max-age=31536000, immutable`, et un objet existant n'est jamais réécrit. |
| Complétude | `release.json` est envoyé **en dernier**, après la vérification complète. Sa présence sur le bucket signifie que la release est complète. |

## 4. Credentials et secrets

- Copier `r2.env.example` vers **`r2.env`**, qui est ignoré par git, puis renseigner `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY`.
  - Les variables attendues sont `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` et `R2_BUCKET`.
  - `R2_ACCOUNT_ID`, `R2_REGION` et `R2_PUBLIC_BASE_URL` sont facultatives : elles ne servent qu'à des contrôles de cohérence et de repli.
- Le token se crée dans Cloudflare : R2 → *Manage API tokens* → permission **Object Read & Write**, limitée au bucket `ace-atorney-waswas`.
- Seul `pnpm assets:upload` lit ce fichier, via `node --env-file-if-exists`. Les variables du shell restent prioritaires, ce qui convient à la CI.
- Les credentials n'apparaissent :
  - **ni dans git**, puisque `r2.env` et `.r2.env` sont ignorés ;
  - **ni dans les logs** : le script n'affiche que le bucket, l'hôte de l'endpoint, les clés d'objets et les compteurs, et ses erreurs ne citent que des noms de variables ;
  - **ni dans le bundle** : le build échoue si une variable `VITE_*` ressemble à un secret, et vérifie qu'aucune valeur de `r2.env` ne figure dans `dist/`.
- Le token S3 ne permet pas de modifier la politique CORS (voir §7).

## 5. Commandes

| Commande | Rôle | Credentials |
|---|---|---|
| `pnpm assets:build [--force]` | Génère les fichiers, le manifeste et l'index de release | Non |
| `pnpm assets:upload --dry-run` | Sans credentials : affiche les objets prévus. Avec : compare au bucket (HEAD seulement) | Facultatifs |
| `pnpm assets:upload [--concurrency N]` | Publie la release (§6), puis la vérifie par l'URL publique | Oui |
| `pnpm assets:verify [--release v] [--origin o]… [--skip-cors]` | Vérifie une release publiée par l'URL publique : index, chaque fichier (statut, taille, Content-Type, Cache-Control) et CORS | Non |
| `pnpm dev:remote` | Serveur de dev, assets lus sur R2 (port 5173 strict) | Non |
| `pnpm build:remote` | Build du frontend en mode distant : seul `generated/manifest.json` est copié dans `dist/`, et la release doit être publiée | Non |
| `pnpm test:e2e` | Projets `local` et `remote-emulated` (émulateur R2, voir §11) | Non |
| `pnpm test:e2e:r2` | Parcours navigateur sur le vrai bucket | Non (release publiée et CORS appliqué) |

Pour définir une variable ponctuellement, la syntaxe dépend du shell :
- PowerShell : `$env:ASSET_RELEASE_CHECK='skip'; pnpm build:remote` ;
- bash : `ASSET_RELEASE_CHECK=skip pnpm build:remote`.

## 6. Upload (`pnpm assets:upload`)

1. **Relecture.** `manifest.json` et `release.json` sont relus et tous les fichiers sont re-hachés. Le moindre écart avec le dernier `pnpm assets:build` arrête tout.
2. **Garde « lot public ».** Toute image `evidence.*` qui n'est pas `evidence.demo-*` est refusée (voir §13).
3. **Pour chaque fichier**, avec au plus 4 requêtes en parallèle (`--concurrency`) :
   - un `HEAD` d'abord ;
   - si l'objet existe avec la même taille et la même empreinte `x-amz-meta-sha256`, on le **saute**. L'ETag n'est jamais utilisé, car ce n'est pas toujours un MD5 ;
   - s'il existe avec un autre contenu, c'est une **erreur** : une release est immuable, et il faut regénérer pour obtenir une nouvelle release ;
   - sinon, `PutObject` envoie l'objet avec :
     - `Content-Type` ;
     - `Cache-Control` immuable ;
     - les métadonnées `sha256` ;
     - `Content-MD5`, pour l'intégrité du transfert ;
     - `If-None-Match: *`, pour ne jamais écraser un objet, même en cas d'envoi concurrent.
4. **Reprise sur erreur.** Les erreurs temporaires (réseau, 429, 5xx) sont retentées jusqu'à 5 fois, avec un backoff exponentiel et du jitter. Une 403 ou une 404 ne l'est pas. La commande est aussi **reprenable** : une nouvelle exécution saute tout ce qui est déjà en place.
5. **Complétude.** `ListObjectsV2` sur `releases/<release>/` ne doit montrer ni clé manquante, ni clé inattendue. Un `HEAD` par clé vérifie ensuite la taille, l'empreinte, le Content-Type et le Cache-Control.
6. **Marqueur.** Puis seulement, `release.json` est envoyé.
7. **Vérification publique** par l'URL navigateur.
   - Un fichier illisible est une erreur.
   - Un problème CORS n'est qu'un avertissement, puisque la politique peut ne pas encore être appliquée.

Rien n'est jamais supprimé : les anciennes releases restent disponibles pour un retour arrière (§9).

## 7. CORS

**Qui a besoin de CORS ?**

| Ressource | Chargement | CORS |
|---|---|---|
| Décors, sprites (CSS `background-image`), interjections, preuves, portraits | `<img>`, CSS, `new Image()` + `decode()`, sans `crossOrigin` | Non (aucun pixel n'est lu) |
| Musiques (`html5: true`) | `<audio>` en streaming, requêtes `Range` | Non |
| Effets sonores, voix, blips | Howler en Web Audio : **XHR** `GET` puis `decodeAudioData` | **Oui** |
| Sonde de démarrage (`probeAssetCors`) | `HEAD` sur `releases/<release>/manifest.json` | **Oui** |
| Manifeste | Même origine que le site | Non |

- **Repli silencieux de Howler.** Si le XHR échoue, CORS compris, Howler bascule **silencieusement** en HTML5 Audio : les sons partent en retard ou échouent sans erreur claire. En mode distant, la sonde de démarrage écrit donc une erreur explicite dans la console quand l'origine des assets refuse la page.
- **Un seul mode par URL.** Les images restent en *no-cors* et les sons en *cors*. Une même URL ne doit pas être chargée dans les deux modes : avec un cache immuable, une réponse sans en-têtes CORS mise en cache pourrait ensuite être réutilisée pour un XHR.
- **Préchargement.** Après le clic « Cliquez pour commencer », `Presenter.warmUp()` lance le téléchargement :
  - des effets sonores, des voix et des blips du chapitre ;
  - des bulles d'interjection et du cadre de preuve.

  `r2.dev` n'ayant pas de cache CDN, cela évite qu'une interjection ne dépasse son délai avant l'arrivée de sa voix. Les décors et les feuilles de pose restent préchargés par section, avant l'affichage (`loadEssential`).

**Politique** : `deploy/r2/cors.json` (format dashboard et S3) et `deploy/r2/cors.wrangler.json` (format wrangler), équivalents ; un test Vitest vérifie leur équivalence.

| Champ | Valeur |
|---|---|
| Origines | `http://localhost:5173` (`pnpm dev:remote`), `http://localhost:4173` (`pnpm preview` du build distant), `http://localhost:5198` (`pnpm test:e2e:r2`) |
| Méthodes | `GET`, `HEAD` |
| En-têtes autorisés | `Range` |
| En-têtes exposés | `Content-Length`, `Content-Range`, `Content-Type`, `ETag`, `Accept-Ranges` |
| Durée du preflight | 7200 s (plafond de Chrome) |

- Les ports sont **stricts** (`--strictPort`). `localhost` et `127.0.0.1` sont deux origines différentes : il faut ouvrir `http://localhost:…`.
- **Domaine du site** : pas encore connu. Quand il le sera, il faudra ajouter `https://<domaine>` (sans `/` final ni chemin) dans **les deux** fichiers, puis réappliquer la politique.

**Appliquer la politique :**
- **Dashboard** : R2 → bucket `ace-atorney-waswas` → *Settings* → *CORS Policy* → *Add CORS policy* → onglet *JSON*, coller `deploy/r2/cors.json`, puis *Save*.
- **Wrangler** :
  - `pnpm dlx wrangler login`. Wrangler s'authentifie avec un compte ou `CLOUDFLARE_API_TOKEN`, pas avec les clés S3.
  - Puis `pnpm dlx wrangler r2 bucket cors set ace-atorney-waswas --file deploy/r2/cors.wrangler.json`.
  - Relecture : `pnpm dlx wrangler r2 bucket cors list ace-atorney-waswas`.
- La propagation peut prendre jusqu'à 30 s.

**Vérifier :**
- `pnpm assets:verify` envoie un GET avec chaque `Origin` listée, puis un preflight avec `Range`, et contrôle qu'une origine non listée n'obtient pas d'`Access-Control-Allow-Origin`.
- À la main :
  ```
  curl -sI -H "Origin: http://localhost:5173" https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev/releases/<release>/audio/sfx.gavel.wav
  ```
  La réponse doit contenir `access-control-allow-origin: http://localhost:5173`.
- Ouvrir une image dans un onglet **ne prouve rien** pour CORS, ni pour Web Audio.

**CORS n'est pas une authentification** : il empêche seulement d'autres sites de *lire* les sons par script. Les objets restent publics pour quiconque connaît leur URL.

## 8. Ordre de livraison

1. `pnpm assets:build` génère la release, dont la version s'affiche.
2. `pnpm assets:upload` fait l'upload complet, la vérification S3, l'envoi du marqueur et la vérification publique.
3. `pnpm assets:verify` confirme les fichiers et CORS.
4. `pnpm build:remote` construit le frontend. Le build échoue si `releases/<release>/release.json` est absent ou ne décrit pas exactement le manifeste local. Pour un build hors ligne, il faut `ASSET_RELEASE_CHECK=skip`, et uniquement pour des tests.
5. On déploie `dist/` sur l'hébergement statique choisi. `dist/generated/` ne contient que `manifest.json`, soit environ 0,7 Mo au total au lieu de 21 Mo.
6. On ajoute l'origine du site au CORS **avant** d'ouvrir le site (§7).

`pnpm build` (local) échoue si `public/generated/manifest.json` manque : il faut lancer `pnpm assets:build` d'abord.

### 8.1 Hébergement sur Vercel (ou toute CI sans les assets)

Vercel construit depuis git, où ne figurent ni `public/generated/` ni `assets/`. Le build y télécharge donc le manifeste de la release publiée, avec `ASSET_RELEASE`.

| Variable Vercel | Valeur | Rôle |
|---|---|---|
| `ASSET_RELEASE` | la release publiée, par exemple `ce7a8ce99dfa5107` (affichée par `pnpm assets:build` et `pnpm assets:upload`) | Le build télécharge `releases/<release>/manifest.json`, vérifie l'index, puis l'embarque dans `dist/`. |
| `VITE_ASSET_BASE_URL` | `https://pub-fcafc9a980984336ba95440ef648c8cb.r2.dev` | Facultative avec `pnpm build:remote` (déjà dans `.env.remote`), mais **indispensable** si la commande de build reste `pnpm build`. Seule variable publique. |

Réglages du projet :
- **Commande de build** : `pnpm build:remote`. `pnpm build` convient aussi si `VITE_ASSET_BASE_URL` est définie dans Vercel.
- **Dossier de sortie** : `dist`.
- **Node** : 22.x.

À **ne pas** définir sur Vercel :
- `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY` : l'upload se fait en local ;
- toute variable `VITE_*` secrète ;
- `ASSET_RELEASE_CHECK=skip`.

**À chaque nouvelle release**, enchaîner :
1. `pnpm assets:build`, puis `pnpm assets:upload` ;
2. mettre à jour `ASSET_RELEASE` dans Vercel ;
3. **redéployer** : une variable modifiée ne s'applique qu'aux nouveaux déploiements.

**CORS** : ajouter l'origine du site Vercel (`https://<projet>.vercel.app`, puis le domaine personnalisé) à `deploy/r2/cors.json` et `cors.wrangler.json`, puis réappliquer la politique (§7). Sinon, les effets sonores basculent en HTML5 et la console signale l'erreur. Les URL de *preview* changent à chaque déploiement : seule l'URL de production est à déclarer.

## 9. Retour arrière

Les releases ne sont jamais supprimées par les scripts. Deux façons de revenir en arrière :
- **Redéployer le build frontend précédent.** Il embarque le manifeste de son ancienne release, qui est toujours en ligne.
- **Reconstruire le frontend sur une release publiée**, sans les assets locaux :
  - PowerShell : `$env:ASSET_RELEASE='<release>'; pnpm build:remote` ;
  - bash : `ASSET_RELEASE=<release> pnpm build:remote`.

  Le plugin télécharge `releases/<release>/manifest.json` et vérifie l'index et le SHA-256 du manifeste avant de l'embarquer.

Les releases existantes se trouvent dans le dashboard, sous le préfixe `releases/`. Un nettoyage éventuel se fait **à la main**, et jamais pour une release encore référencée par un déploiement.

## 10. `r2.dev` et domaine personnalisé

L'URL `r2.dev` est une **URL de développement** :
- son débit est limité (429 au-delà de quelques centaines de requêtes par seconde, bande passante bridée) ;
- elle n'a **pas de cache CDN** Cloudflare ;
- elle n'offre ni WAF, ni contrôle d'accès.

Pour une diffusion réelle, il faut un domaine personnalisé. Le passage ne demande **aucun changement de code** :
1. Le domaine doit être une zone Cloudflare du même compte. Dans R2 → bucket → *Settings* → *Custom Domains* → *Add*, saisir par exemple `assets.<domaine>`.
2. Mettre `VITE_ASSET_BASE_URL=https://assets.<domaine>/` dans `.env.remote`, ou dans `.env.remote.local` pour essayer d'abord.
3. Ajouter l'origine du site à la politique CORS et la réappliquer. Si des objets étaient déjà en cache sans CORS, il faut purger le cache du domaine.
4. Si besoin, ajouter une règle de cache (*Cache Everything*), car tous les types de fichiers ne sont pas mis en cache par défaut.
5. Lancer `pnpm assets:verify`, puis `pnpm build:remote` et déployer. Les clés `releases/…` sont les mêmes : rien n'est à re-téléverser.
6. Enfin, on peut désactiver l'accès `r2.dev` du bucket.

## 11. Émulateur et tests

- **`tests/support/r2-emulator.ts`** joue le rôle du bucket public pour les tests, sans credentials ni réseau. Il sert, comme R2 :
  - `releases/<release>/<clé>`, à partir de `public/generated/`, uniquement pour les clés de `release.json` et avec des segments décodés ;
  - les mêmes Content-Type et Cache-Control que l'upload ;
  - les requêtes `Range` ;
  - la politique CORS **lue dans `deploy/r2/cors.json`**.
- **Projet Playwright `remote-emulated`** :
  - un vrai build distant (`vite build --mode remote`), qui vérifie la release sur l'émulateur ;
  - servi par `vite preview` sur le port 5198 ;
  - il joue `smoke`, `slice` et `assets.spec`. Le test de mutation (retrait de l'origine 5198 du CORS) fait bien échouer ce projet.
- **`tests/e2e/assets.spec.ts`** vérifie, en local comme en distant :
  - les URL : en mode distant, toutes sous `<bucket>/releases/<release>/` ;
  - le décodage de chaque image ;
  - les sons, chargés en XHR avec `Access-Control-Allow-Origin` (Web Audio, et non le repli HTML5) ;
  - la musique, chargée en `media` ;
  - un décor absent (« Réessayer », puis reprise) ;
  - des sons absents (le jeu continue, avec au plus 2 requêtes par fichier) ;
  - une preuve absente (le Dossier reste utilisable).
- **Tests unitaires** :
  - `asset-meta/release-layout.test.ts` : URL, encodage, et correspondance URL ↔ clé R2 ;
  - `scripts/release.test.ts` : version, index, garde des preuves ;
  - `scripts/upload-core.test.ts` : upload avec un bucket en mémoire (immuabilité, marqueur, reprises, concurrence, dry-run) ;
  - `scripts/public-check.test.ts` : vérifications publiques contre l'émulateur ;
  - `scripts/vite-asset-plugin.test.ts` : contenu de `dist`, contrôle de release, fichiers CORS ;
  - `src/runtime/assets.test.ts` et `src/runtime/audio.test.ts`.

## 12. Dépannage

| Symptôme | Cause probable | Remède |
|---|---|---|
| `build:remote` : « index not found … (HTTP 404) » | Release non publiée, ou incomplète | `pnpm assets:upload` |
| `build:remote` : « The local manifest differs » | Assets regénérés après l'upload | `pnpm assets:upload` (nouvelle release) |
| Console : « rejects CORS requests from this page » ; sons muets ou en retard | Origine absente du CORS : autre port, `127.0.0.1`, ou domaine du site non ajouté | Ajouter l'origine exacte (§7) |
| `assets:upload` : « already exists with different content » | Tentative de modifier une release publiée | Ne rien écraser : regénérer (nouvelle release) |
| `assets:upload` : « Generated files changed since the last build » | Fichiers modifiés après `assets:build` | `pnpm assets:build` |
| Erreurs 429 | Limite de débit de `r2.dev` | Relancer (la commande reprend) ; passer à un domaine personnalisé (§10) |
| Images OK mais pas les sons, en distant uniquement | CORS (les images n'en ont pas besoin) | §7 |

## 13. Sécurité et confidentialité

- **Bucket public.** Toute personne qui connaît une URL peut lire l'objet. C'est un choix de l'utilisateur (voir `docs/OPEN_QUESTIONS.md` §8), qui expose aussi les assets Capcom.
- **Preuves de démo uniquement.** Seules les preuves `evidence.demo-*` (`asset-meta/demo-evidence/`) sont publiées.
  - `pnpm assets:upload` refuse toute autre image `evidence.*`.
  - Un test de contenu vérifie que les images de preuves sont bien nommées `evidence.*`.
  - Les **vraies captures de messages restent hors du lot public**.
- **Secrets** : §4.
