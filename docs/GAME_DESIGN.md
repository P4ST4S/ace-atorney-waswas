# Game design

Ce document spécifie les systèmes de jeu et la façon d'adapter les mécaniques d'Ace Attorney à **un chapitre** côté **accusation**. Il ne raconte pas l'histoire, qui sera écrite plus tard (adaptation d'un début d'affaire existante).

## 1. Concept

- **Genre** : visual novel judiciaire fidèle à la trilogie Ace Attorney (version HD), **en français**.
- **Accusé** : **Wassim**. Les preuves clés sont des **captures d'écran de vrais messages**.
- **Le twist.** **Mimi**, le personnage incarné par le joueur ou la joueuse, est **côté accusation** : le but est de faire condamner Wassim.
  - Phoenix Wright est l'avocat de la défense, donc l'adversaire.
  - Chaque mauvaise décision fait **gagner de l'EXP à Wassim** (gag récurrent, affiché à l'écran) et peut le faire acquitter.
- **Ton** : parodique entre amis, mais mise en scène sérieuse et fidèle (musiques, interjections, secousses, rythme de texte).

## 2. Boucle de jeu (périmètre de la v1)

```
Procès ─► Témoignage ─► Contre-interrogatoire ─┬─► contradiction trouvée ─► suite / verdict « Coupable »
                                               └─► erreurs ─► PV ↓, EXP de Wassim ↑ ─► 0 PV ─► « Non coupable »
```

**Prévu pour la tranche verticale (jalons 0 à 3)** :
- dialogues ;
- témoignage ;
- contre-interrogatoire (presser, présenter) ;
- Dossier (preuves et profils) ;
- santé et EXP ;
- objection et contradiction ;
- verdict.

**Plus tard** : enquête (examiner, se déplacer, parler, présenter hors procès), choix multiples et demandes de preuve hors contre-interrogatoire, selon les besoins du scénario.

## 3. Mécaniques

### 3.1 Dialogues

- **Boîte de texte** en bas de l'écran, avec la plaque du nom du locuteur ; style et proportions de la trilogie HD.
- **Machine à écrire** :
  - les **blips** dépendent du personnage (voix masculine, féminine ou machine à écrire) ;
  - un **clic pendant la frappe complète la ligne**, et le clic suivant avance.
- **Couleurs** : rouge pour les éléments importants, bleu pour les pensées, vert pour les déclarations de témoignage.
- **Mise en scène dans le texte** : pauses, ralentis, secousses, flashs et sons à des points précis.
- **Caméra au tribunal** : elle coupe automatiquement sur le banc du personnage qui parle (défense, accusation, barre, juge).
- **Avancer** : clic, `Espace` ou `Entrée`.

### 3.2 Témoignage

- La bannière « **Témoignage** » apparaît, puis les déclarations défilent en vert, sans interaction possible.
- Le témoin peut être Wassim lui-même : le jeu le présente comme se défendant, et Mimi doit le confondre.

### 3.3 Contre-interrogatoire

C'est le cœur du jeu. Après la bannière « **Contre-interrogatoire** » :

| Action | Commandes | Effet |
|---|---|---|
| Naviguer | Flèches à l'écran, `←` / `→` | Déclaration précédente ou suivante. Après la dernière, retour à la première, avec éventuellement une remarque du juge. |
| **Presser** | Bouton « Presser », `Q` | « Un instant ! » de Mimi, puis une conversation qui peut révéler une nouvelle déclaration ou en modifier une. |
| **Présenter** | Bouton « Présenter », `E` (ouvre le Dossier) | On choisit une preuve ou un profil pour l'opposer à la déclaration affichée. |
| Bonne preuve | — | « **Objection !** », secousse, musique Pursuit, la contradiction est exposée et l'histoire avance. |
| Mauvaise preuve | — | « Objection ! », puis le juge rejette l'objection. **Perte de PV**, **Wassim gagne de l'EXP**, et retour à la même déclaration. |

Règles précises (déclaration de reprise, déclarations cachées, sortie) : voir `ARCHITECTURE.md` §9.

### 3.4 Dossier (Court Record)

- **Onglets** : **Preuves** et **Profils**. Chaque élément affiche une miniature dans le cadre de preuve, son nom et une courte description.
- **Vue détail** (« Examiner ») :
  - pour une capture de messages, l'image s'affiche **en plein écran**, avec zoom et défilement vertical ;
  - le texte cité reste exact, sans retouche typographique.
- **Accès** : bouton « Dossier » ou touche `R`. En contre-interrogatoire, le Dossier sert aussi à **présenter**.
- **Évolutions** : une preuve peut être ajoutée (notification avec son), mise à jour (nouvelle description) ou retirée.

### 3.5 Santé et EXP de Wassim

| Élément | Règle |
|---|---|
| **Barre de vie** (style AA2/AA3) | Elle part à 100 ; chaque erreur coûte un montant défini dans le contenu, par exemple 10 ou 20. |
| **EXP de Wassim** | Variable numérique `expWassim` ; chaque erreur l'augmente. Une notification « Wassim gagne X EXP ! » s'affiche. Elle peut alimenter une fin « blague » (par exemple, Wassim repart avec un record d'EXP). |
| **0 PV** | Le procès est perdu : verdict « **Non coupable** », fin « acquitté ». |
| Après la défaite | Le jeu propose de reprendre (au jalon 4, depuis la dernière autosauvegarde). |

### 3.6 Fins

Le contenu déclare ses fins. Le moteur ne présuppose pas qui « gagne ». Fins prévues :

| Fin | Condition | Ton |
|---|---|---|
| **Coupable** | Toutes les contradictions sont exposées | Victoire de Mimi |
| **Acquitté** | 0 PV | Défaite ; Wassim triomphe |
| **Bonus** (optionnelle) | Selon `expWassim` en fin de partie | Gag |

### 3.7 Interjections

| Interjection | Image | Voix FR disponibles |
|---|---|---|
| « Objection ! » | Image anglaise (mot identique) | Phoenix, Edgeworth, Mia, Franziska, Godot, Payne |
| « Un instant ! » | Image française | Phoenix, Edgeworth, Mia |
| « Prends ça ! » | Image française | Phoenix, Edgeworth, Mia |

- **Déroulé** : bulle en plein écran avec léger zoom et secousse, voix du personnage, son d'impact, puis retour à la scène.
- **Voix manquante** : on joue le repli déclaré dans le registre du personnage (voir `ARCHITECTURE.md` §11).

## 4. Distribution et sprites

| Rôle | Personnage | Planche utilisée | Remarques |
|---|---|---|---|
| Joueur·euse (accusation) | **Mimi** | `miles-edgeworth` (proposé) | Les 3 voix FR existent. Avec Franziska, seule « Objection » existe, donc repli. À trancher. |
| Accusé / témoin | **Wassim** | `ron-delite` (remplaçant) | Planche compilée : animations de clignement et de parole complètes |
| Défense | Phoenix Wright | `phoenix-wright` | Atlas : poses saisies à la main |
| Juge | Le Juge | `judges` | Atlas : poses saisies à la main |

## 5. Musiques (mapping fourni)

| Moment | Morceau | Alias |
|---|---|---|
| Début du procès | Court is Now in Session | `court-in-session` |
| Témoignage | Questioning ~ Moderato 2001 | `questioning-moderato` |
| Témoignage tendu | Questioning ~ Allegro 2001 | `questioning-allegro` |
| Objection | Phoenix Wright ~ Objection! 2001 | `objection` |
| Contradiction décisive | Pursuit ~ Corner the Culprit | `pursuit` |
| Révélation | Telling the Truth 2001 (le tableau dit « The Truth Revealed » : à confirmer) | `truth` |
| Moment inquiétant | Suspense | `suspense` |

**Effets sonores clés** (DS) :
- tribunal : `sfx-gavel`, `sfx-deskslam`, `sfx-objection`, `sfx-realization` ;
- santé et verdict : `sfx-damage1`, `sfx-guilty` ;
- bannières : `sfx-testimony` ;
- blips : `sfx-blipmale`, `sfx-blipfemale` ;
- Dossier : `sfx-evidenceshoop`, `sfx-pageturn`.

## 6. Interface

- **Écran**, en 16:9 et en 1920×1080 logiques : la scène occupe tout l'écran, et la boîte de texte se superpose en bas sur environ un quart de la hauteur.
- **Éléments affichés** :
  - en haut à droite : la barre de vie ;
  - à côté : le compteur d'EXP de Wassim, quand il est pertinent ;
  - en haut à gauche : le bouton Dossier.
- **Barre de contre-interrogatoire** : flèches précédent et suivant, ainsi que les boutons « Presser » et « Présenter ».
- **Écran de démarrage** : « Cliquez pour commencer », qui déverrouille l'audio.
- **Options** : vitesse du texte, volumes (musique, effets, voix, blips) et réduction des animations (moins de secousses et de flashs).
- **Plateforme** : desktop d'abord, souris et clavier. Le mobile n'est pas garanti en v1.

## 7. Adaptations par rapport aux jeux originaux

| Original | Ici |
|---|---|
| On joue l'avocat de la défense | On joue l'accusation : les rôles sont inversés, les mécaniques identiques |
| Pénalité = barre de vie | Barre de vie **et** EXP de Wassim (gag), avec des fins conditionnées |
| Preuves = objets dessinés | Preuves = captures d'écran réelles, vue détail zoomable |
| Double écran DS ou interface HD | Interface HD recréée en CSS, sur les décors HD |
| Psyche-Locks, enquête complète | Hors périmètre v1 (Psyche-Locks : AA2 et plus) |
