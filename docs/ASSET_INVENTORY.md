# Inventaire des assets

Ce document décrit ce que contient réellement `assets/` : chaque fichier a été ouvert ou analysé, que ce soit l'en-tête PNG/WAV, les pixels (canal alpha, composantes connexes, différences entre variantes) ou un examen visuel. Il distingue ce qui est **vérifié**, ce qui est **déduit** (à confirmer) et ce qui **manque**.

- **Total** : 659 fichiers, environ 651 Mo (dont 606 Mo de PNG). On compte 419 PNG, 233 WAV et 7 MP3.
- **Réorganisation** : les fichiers ont été déplacés depuis `assets/sprites/` vers l'arborescence ci-dessous, sans modification de contenu.
  - Le script utilisé est `scripts/reorganize-assets.ts`.
  - Le nombre de fichiers et le SHA-256 de chacun ont été vérifiés avant et après.
  - La correspondance complète entre ancien et nouveau chemin, réversible avec `--revert`, se trouve dans `asset-meta/reorg-map.json`.
- **Statut juridique** : il s'agit d'assets Capcom (trilogie PC/HD, DS, 3DS) issus de rips communautaires, utilisables uniquement dans un fan-game non commercial à diffusion privée. Voir `OPEN_QUESTIONS.md`.

```
assets/
  images/
    backgrounds/{courtroom,aa1,aa2,aa3}/<lieu>/…/bgXXX*.png
    characters/<personnage>.png
    ui/evidence-frame.png
    ui/interjections/<langue>/{objection,hold-it,take-that}.png
  audio/
    music/*.mp3
    voices/fr/<personnage>-<interjection>.wav
    sfx/ds/<catégorie>/sfx-*.wav
    sfx/3ds/_a-trier/0x*.wav
```

## 1. Décors

### 1.1 Tribunal : `images/backgrounds/courtroom/` (12 fichiers, tous vérifiés visuellement)

| Fichier | Taille | Rôle | Statut |
|---|---|---|---|
| `bg001.png` | 1920×1080, opaque | Mur derrière le banc de la **défense** | Déduit visuellement |
| `bg002.png` | 1920×1080, opaque | Mur derrière le banc de l'**accusation** (miroir de `bg001`) | Déduit visuellement |
| `bg003.png` | 1920×1080, opaque | Fond de la **barre des témoins** (portes et drapeaux) | Déduit visuellement |
| `bg004.png` | 1920×1080, opaque | **Juge** : siège, sceau, bureau en bas | Vérifié |
| `bg005.png` | 1920×1080, opaque | Vue latérale du **co-conseil** (banc du juge à gauche, bureau à droite) | Déduit visuellement |
| `bg006.png` | 1920×1080, opaque | **Plan large** de la salle | Vérifié |
| `houscr.png` | 2560×1080, opaque | Panoramique flouté (transition « swish » entre les bancs) | Vérifié |
| `etc22.png` | 1920×240, 52 % transparent | Bureau de premier plan de la **défense** (pente vers la droite) | Déduit visuellement |
| `etc21.png` | 1920×240, 52 % transparent | Bureau de premier plan de l'**accusation** (miroir) | Déduit visuellement |
| `etc20.png` | 1202×221, 8 % transparent | Barre des témoins, en arrondi, au premier plan | Déduit visuellement |
| `etc24.png` | 1920×270, opaque | Bureau du juge au premier plan, qui recouvre exactement les 270 px du bas de `bg004` | Vérifié par les dimensions |
| `etc23.png` | 1363×200, 17 % transparent | Bureau du co-conseil au premier plan (pour `bg005`) | Déduit visuellement |

**Composition** : décor, puis personnage, puis bureau de premier plan. Les associations décor/bureau sont centralisées dans `asset-meta/` sous des alias logiques comme `court.defense` et `court.prosecution`. Elles seront confirmées au jalon 1 en comparant les rendus aux captures du jeu.

### 1.2 Lieux : `images/backgrounds/aa1|aa2|aa3/` (374 fichiers)

| Taille | Nombre |
|---|---|
| 1920×1080 | 316 |
| 3840×1080 (panoramas défilants) | 57 |
| 1620×472 (`aa3/hazakura-temple/inner-temple/bg54d.png`, opaque, probablement un élément de décor) | 1 |

Ces fichiers sont tous en RGBA. Seuls quelques-uns contiennent de la transparence utile ; voir plus bas.

**Suffixes de fichiers.** Le contenu a été vérifié par différence de pixels.

| Suffixe | Sens | Preuve |
|---|---|---|
| aucun | version japonaise de base | — |
| `u` `f` `g` `k` `l` `s` `t` `b` / `bb` | langue : US, français, allemand, coréen, espagnol latino, chinois simplifié, chinois traditionnel, portugais brésilien | `aa3/kb-security/ceos-office/bg204u` ne diffère de `bg204` que sur 0,07 % des pixels (une enseigne). `bg074l` ne diffère de `bg074bb` que sur 0,16 %. |
| `a`, `b`, `c` (sur une base sans langue) | **variante d'état ou de cadrage** : une image entièrement différente | `bg075b` diffère de `bg075a` sur 89,5 % des pixels ; `bg074b` diffère de `bg074a` sur 87,9 %. |

> ⚠️ `b` est **ambigu** : il signifie « Brésil » ou « variante ». On le distingue par les dimensions et la comparaison visuelle. Pour le jeu en français, on prend la variante `f` quand elle existe, sinon la base.

> ⚠️ Les **IDs se répètent entre jeux** : par exemple `aa2/kurain-village/channeling-chamber/bg202` et `aa3/atmey-detective-agency/bg202`. Le jeu ne référence donc jamais un fichier par son seul nom : il passe par un alias logique.

**Décors avec transparence utile**

| Fichier | Détail |
|---|---|
| `aa1/detention-center/bg01ew.png` | Avant-plan du parloir : le mur et le cadre de la vitre sont opaques, la zone de la vitre est à alpha 0 sur 67 % de l'image. Composition : `bg01e` (la pièce, avec un gardien peint), puis le personnage, puis `bg01ew`. |
| `aa1/bluecorp/bg01fl.png`, `aa3/hazakura-temple/dusky-bridge/bg503f.png`, `bg504f.png` | Quelques pixels non opaques seulement (moins de 1 %), négligeables. |

**Lieux pertinents pour une affaire « moderne »** (vérifiés visuellement)

| Lieu | Fichiers | Remarque |
|---|---|---|
| Centre de détention | `aa1/detention-center/bg01e.png` + `bg01ew.png` | Parloir avec vitre |
| Hall des accusés | `aa1/defendant-lobby/bg002.png` | Deux gardiens peints |
| KB Security, bureau du PDG | `aa3/kb-security/ceos-office/bg204*.png` | Scène de crime, silhouette au sol marquée A, B et C |
| KB Security, salle de sécurité | `aa3/kb-security/security-room/bg205*.png` | — |
| Lordly Tailor | `aa3/lordly-tailor/main-exhibition-hall/bg200*.png`, `basement-warehouse/bg201*.png` | Le second est un panorama 3840 |
| Atmey Detective Agency, Mask☆DeMasque, Tender Lender | `aa3/…` | — |
| Bureaux Wright & Co. | `aa1/wright-prev-fey-and-co-law-offices/bg000.png`, `bg001.png`, `bg009.png` | `bg000` est un panorama 3840 |
| Département de police, parking souterrain, etc. | `aa1/…` | — |

La liste complète, avec tous les fichiers de chaque lieu, est dans `asset-meta/reorg-map.json`.

## 2. Personnages : `images/characters/` (6 planches, toutes en RGBA 8 bits)

| Fichier | Taille | Décodé en mémoire (RGBA) | Type | Statut |
|---|---|---|---|---|
| `ron-delite.png` | 7663×7345 | ≈ 225 Mo | **Planche compilée** de frames complètes | Découpe automatique validée |
| `phoenix-wright.png` | 6626×3456 | ≈ 92 Mo | **Atlas Unity brut** | Rectangles à saisir à la main |
| `miles-edgeworth.png` | 5208×6944 | ≈ 145 Mo | Atlas brut | Idem |
| `miles-edgeworth-defense.png` | 3472×5208 | ≈ 72 Mo | Atlas brut ; Edgeworth tourné vers la droite (côté défense) | Idem |
| `franziska-von-karma.png` | 5664×5664 | ≈ 128 Mo | Atlas brut ; plusieurs poses très fragmentées, plus l'effet de fouet | Idem, plus difficile |
| `judges.png` | 1728×1728 | ≈ 12 Mo | Atlas brut : le Juge (chauve) et le juge blond | Idem ; pièces collées (77 % opaque) |

### 2.1 Ron DeLite : planche compilée (vérifié par analyse)

- **Contenu** : 31 frames complètes, chacune comportant le corps, les yeux et la bouche. Elles sont rangées en 6 bandes horizontales :

  | Bande | Nombre de frames | Largeur des frames |
  |---|---|---|
  | 1 | 5 | 770 px |
  | 2 | 8 | 770 px |
  | 3 | 3 | 770 px |
  | 4 | 5 | 679 px |
  | 5 | 5 | 760 px (une à 779) |
  | 6 | 5 | 1351 px |

- **Alignement** : dans chaque bande, les frames ont la même largeur et partagent la **même ligne de base basse**. On peut donc les aligner sur une ancre en bas au centre sans tremblement ; un test de scintillement le vérifiera au jalon 1.
- **Sous-séquences** : dans la plupart des bandes, un écart horizontal plus large sépare un premier groupe de 3 frames d'un second de 2. Il s'agit probablement de clignements et de paroles, à confirmer visuellement au moment de l'étiquetage.
- **Texte à exclure** : un bloc de crédits (« Sprites Ripped by: YDgeon… ») se trouve en `x 3482–7663`, `y 3055–3449`.
- **Hauteur** : 1033 à 1205 px pour une scène de 1080 px. L'échelle est donc d'environ 1:1 avec les décors, le bas du buste étant hors cadre ou masqué par le bureau. À confirmer au rendu.

### 2.2 Atlas Unity bruts (Phoenix, Edgeworth ×2, Franziska, Juges)

- **Organisation** : des **poses de base** (corps et tête) côtoient des **patchs** rectangulaires de visage (yeux, bouche) que le moteur d'origine superposait sur la base. Aucune métadonnée de position n'est fournie : pas de fichier `.asset`, de JSON ni de XML.
- **Analyse des composantes connexes** : les pièces sont **collées sans marge transparente**.

  | Planche | Composantes ≥ 2000 px |
  |---|---|
  | Phoenix | 45 |
  | Edgeworth | 70 |
  | Franziska | 81 |
  | Juges | 6 (dont une de 1728×1727, soit presque toute la planche) |

  Une découpe automatique par composantes est donc **impossible**.
- **Spike de recalage** (Phoenix, bande de patchs à droite de la pose 1) :
  - la bande (191×374 px) forme une seule pièce, car les patchs empilés se touchent ;
  - une fois la bande découpée selon les ruptures de couleur, le template-matching sur la tête de la base donne des offsets plausibles pour les segments bien découpés, avec un écart médian de 3 à 5 niveaux de gris et 54 à 62 % des pixels à moins de 10 niveaux ;
  - il échoue sur les segments mal découpés (écart médian de 26 à 37).

  **Conclusion** : il faut des **rectangles saisis à la main**, avec un recalage assisté par script.
- **Poses fragmentées** : certaines poses (bras, Franziska en particulier) sont découpées en plusieurs morceaux, ce qui demande d'assembler plusieurs pièces. On les évite tant que le scénario ne les exige pas.
- **Orientation** : Phoenix regarde vers la droite (banc de la défense, à gauche de l'écran). Edgeworth (la planche standard) est surtout tourné vers la gauche (banc de l'accusation). Edgeworth (Défense) est tourné vers la droite.
- **Transparence** : les pixels à alpha 0 sont noirs dans toutes les planches sauf celle des Juges, dont les pixels transparents gardent une couleur résiduelle.
  - Les pixels semi-transparents sont sombres (contours d'encre), ce qui est normal pour de l'art à contours noirs.
  - Sur la planche des Juges, la couleur des pixels transparents doit être ignorée au redimensionnement, en travaillant en alpha prémultiplié ; sharp le gère.

### 2.3 Personnages manquants

| Rôle | Situation | Proposition |
|---|---|---|
| **Wassim** (accusé) | Aucun sprite | Ron DeLite en remplaçant, puisque l'identité du personnage est séparée de sa planche. Voir `OPEN_QUESTIONS.md`. |
| **Mimi** (procureur incarné par le joueur ou la joueuse) | Aucun sprite | Edgeworth (côté accusation, 3 voix FR) ou Franziska (1 seule voix FR). |
| Témoins, co-conseil, enquêteur | Aucun sprite | À fournir si le scénario les exige. |

## 3. Interface

| Asset | Chemin | Taille | Statut |
|---|---|---|---|
| Cadre de preuve | `images/ui/evidence-frame.png` | 450×450 | Vérifié : coins bleus, fond gris clair opaque (RGB 190,191,188) à l'intérieur. L'image de la preuve se pose dessus. |
| « Objection! » | `images/ui/interjections/en/objection.png` | 1728×1296 | Vérifié : bulle opaque, contour transparent, zone utile d'environ 1442×1058. **Utilisable en français**, le mot étant identique. |
| « Un instant ! » | `images/ui/interjections/fr/hold-it.png` | 1558×1080 | Vérifié ; zone utile d'environ 1472×1068, quasi identique à l'anglais, donc aucun redimensionnement spécifique n'est nécessaire. |
| « Prends ça ! » | `images/ui/interjections/fr/take-that.png` | 1558×1080 | Vérifié |
| « Objection ! » en français | — | — | **Absent** du dossier français ; on utilise la version anglaise. |
| Autres langues | `images/ui/interjections/{de,ja,ko,es-419,pt-br,zh-hans,zh-hant,en}/` | — | 3 interjections chacune, sauf le français (2) |

**Manquants**, à recréer en CSS/SVG, sans asset :

| Élément | Exemples |
|---|---|
| Texte et commandes | Boîte de dialogue, plaque de nom, boutons (Presser, Présenter, Dossier, flèches de navigation) |
| Dossier | Fenêtre et onglets Preuves / Profils |
| Icônes de preuves | Seul le cadre existe ; chaque preuve doit fournir son image |
| Contre-interrogatoire et santé | Barre de vie, bannières « Témoignage » et « Contre-interrogatoire » |
| Verdict | Écrans « Coupable » et « Non coupable » |
| Effets | Lignes de vitesse, flash, fondus |
| Police | Aucune police fournie |

## 4. Audio

### 4.1 Musiques : `audio/music/` (7 MP3, 44,1 kHz stéréo)

| Fichier | Durée | Débit | Usage prévu (tableau fourni) |
|---|---|---|---|
| `court-is-now-in-session.mp3` | 116 s | 192 kbps | Début du procès |
| `questioning-moderato-2001.mp3` | 110 s | 192 kbps | Témoignage (« Cross-Examination – Moderato ») |
| `questioning-allegro-2001.mp3` | 130 s | 192 kbps | Témoignage tendu (« Cross-Examination – Allegro ») |
| `objection-2001.mp3` | 75 s | 192 kbps | Objection |
| `pursuit-corner-the-culprit.mp3` | 98 s | 192 kbps | Contradiction décisive |
| `telling-the-truth-2001.mp3` | 85 s | 124 kbps | Révélation : le tableau cite « The Truth Revealed 2001 », **titre à confirmer à l'écoute** |
| `suspense.mp3` | 95 s | 205 kbps | Moment inquiétant |

**Manquants** : thèmes d'enquête, d'écran-titre, de victoire et de défaite. Les **points de boucle** sont inconnus : les fichiers bouclent en entier. Une boucle parfaitement continue demanderait des métadonnées de boucle.

### 4.2 Voix françaises : `audio/voices/fr/` (12 WAV, 16 364 Hz mono, 1,3 à 2,0 s)

| Personnage | Objection | Un instant | Prends ça |
|---|---|---|---|
| Phoenix Wright | ✅ | ✅ | ✅ |
| Miles Edgeworth | ✅ | ✅ | ✅ |
| Mia Fey | ✅ | ✅ | ✅ |
| Franziska von Karma | ✅ | ❌ | ❌ |
| Godot | ✅ | ❌ | ❌ |
| Winston Payne | ✅ | ❌ | ❌ |

### 4.3 Effets sonores DS : `audio/sfx/ds/` (108 WAV mono, de 10 à 44 kHz, 8 ou 16 bits, noms explicites)

| Catégorie | Nombre | Exemples |
|---|---|---|
| `blips/` | 6 | `sfx-blipmale`, `sfx-blipfemale`, `sfx-typwriter` (blips de texte) |
| `court/` | 20 | `sfx-objection`, `sfx-gavel`, `sfx-deskslam`, `sfx-damage1/2`, `sfx-testimony`, `sfx-guilty`, `sfx-realization`, `sfx-shock`, `sfx-gallery` |
| `ui/` | 18 | `sfx-selectblip`, `sfx-cancel`, `sfx-pageturn`, `sfx-evidenceshoop`, `sfx-saveblip`, `sfx-scenechange` |
| `impacts/` | 27 | `sfx-thud*`, `sfx-smack`, `sfx-whip`, `sfx-gunshot*`, `sfx-shattering` |
| `movement/` | 17 | `sfx-swoop`, `sfx-longwoosh`, `sfx-zooma` |
| `ambience/` | 17 | `sfx-phone*`, `sfx-sirens`, `sfx-dooropens`, `sfx-photosnap` |
| `psyche-lock/` | 3 | `sfx-lock`, `sfx-locksbreak`, `sfx-psyche1` |

Le fichier `sfx-dog bark.wav` a été renommé `sfx-dog-bark.wav`, car les espaces posent problème dans les URL.

### 4.4 Effets sonores 3DS : `audio/sfx/3ds/_a-trier/` (113 WAV, 32 728 Hz, dont 10 en stéréo)

Ces fichiers sont nommés par offset hexadécimal (`0x1411E0.wav`, etc.) et ne sont **pas identifiés**. Un regroupement par durée et par caractéristiques simples (RMS, taux de passage par zéro) donne :

| Durée | Nombre | Hypothèse, à confirmer à l'écoute |
|---|---|---|
| < 0,25 s | 26 | Sons d'UI, blips |
| 0,25 – 0,7 s | 21 | Impacts, sons d'UI |
| 0,7 – 1,1 s | 13 | Jingles courts |
| 1,1 – 1,4 s | 30 (dont 28 à environ 1,3 s, mono) | **Voix d'interjection** (probablement les voix anglaises 3DS) |
| 1,4 – 5 s | 6 | Jingles |
| > 5 s (11 à 15 s) | 17 | Ambiances ou morceaux courts |

Ce dossier sera étiqueté par écoute plus tard (jalon 5). Le jeu étant en français, les voix FR DS sont prioritaires.

## 5. Problèmes de compatibilité identifiés

1. **Taille des planches** : 7663 px dépasse la taille de texture maximale de nombreux GPU, et une planche décodée occupe jusqu'à 225 Mo. On ne sert **jamais** une planche brute : un découpage par pose est fait au build.
2. **Poids total** : environ 606 Mo de PNG. Les fichiers effectivement utilisés passent par le pipeline (WebP pour les images), qui ne copie que ce qui est référencé par les alias.
3. **Formats audio** :
   - les WAV 8 bits à 10–22 kHz sont lus par tous les navigateurs ;
   - les blips restent en WAV, pour éviter le délai d'encodeur des MP3 ;
   - les musiques restent en MP3.
4. **Noms non uniques** entre jeux (`bg202`) et **suffixes ambigus** (`b`) : on passe toujours par des alias explicites.
5. **Mapping du tribunal** déduit visuellement : il sera confirmé au jalon 1.

## 6. Stratégie de chargement

| Étape | Détail |
|---|---|
| `asset-meta/` (versionné) | Alias logiques vers les fichiers sources, rigs des personnages, carte de réorganisation. |
| `pnpm assets:build` | Script `scripts/build-assets.ts` (sharp). Il produit `public/generated/` (hors git) avec :<br>• décors et interjections en WebP ;<br>• images découpées par pose et patch ;<br>• audio copié tel quel ;<br>• un `manifest.json` (dimensions, ancres, frames, offsets). |
| Exécution | Le manifeste est chargé au démarrage ; les ressources sont chargées par section, puis décodées (`img.decode()`) avant affichage. Une politique LRU libère les références aux ressources dont ni la section courante ni la suivante n'ont besoin. |
