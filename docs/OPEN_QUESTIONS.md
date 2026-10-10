# Questions ouvertes

Ce sont les décisions que ni les assets ni le contexte ne permettent de trancher avec certitude. Chacune a une **recommandation par défaut**, appliquée tant que rien d'autre n'est décidé. Aucune ne bloque les jalons 0 à 3.

## 1. Sprite de Wassim

- **Constat** : aucun sprite n'existe pour Wassim.
- **Recommandation** : utiliser **Ron DeLite** comme remplaçant. Sa planche est compilée, donc ses animations de clignement et de parole sont complètes et faciles à exploiter. Le moteur sépare l'identité du personnage de sa planche : remplacer plus tard Ron par un sprite dédié ne touchera pas au scénario.
- **Alternative** : un sprite personnalisé, qu'il faudrait fournir en frames complètes ou sous forme de planche compilée, comme celle de Ron.

## 2. Sprite et voix de Mimi

- **Constat** : il n'y a pas de sprite pour Mimi. Côté accusation, deux candidats :

  | Candidat | Avantages | Inconvénients |
  |---|---|---|
  | **Edgeworth** | Les 3 voix FR existent (« Objection », « Un instant », « Prends ça ») ; poses tournées vers la gauche, adaptées au banc de l'accusation | Atlas brut : rectangles à saisir à la main |
  | **Franziska** | — | Seule « Objection » existe en FR ; atlas plus fragmenté |

- **Recommandation** : **Edgeworth** pour la démo. Le registre permet de changer de planche et de déclarer un repli de voix.
- **À décider par l'utilisateur** : l'identité visuelle de Mimi, et le genre grammatical à utiliser dans le texte du jeu (« le procureur », « la procureure »…).

## 3. Police d'écriture

- **Constat** : aucune police n'est fournie.
- **Recommandation** : une police libre (licence OFL) auto-hébergée, arrondie et très lisible, qui couvre tous les caractères français. Le défaut proposé est **Nunito** via `@fontsource`. On peut la remplacer sans impact sur le reste.

## 4. Proportions de l'interface

- **Constat** : le « même ratio texte/image » que l'original est demandé, mais aucune capture de référence de l'interface HD n'est disponible.
- **Recommandation** : caler la boîte de texte sur environ le quart bas de l'écran, d'après les proportions connues de la trilogie HD.
- **Ce qui aiderait** : 2 ou 3 captures de référence (dialogue au tribunal, contre-interrogatoire, Dossier), pour affiner.

## 5. Musique « Révélation »

- **Constat** : le tableau cite « The Truth Revealed 2001 », mais le fichier présent est « Telling the Truth 2001 ».
- **Recommandation** : utiliser ce fichier pour la révélation, à confirmer à l'écoute. Il s'agit peut-être du même morceau sous un autre titre traduit.

## 6. Musiques manquantes

- **Constat** : il manque les thèmes d'enquête, d'écran-titre, de victoire et de défaite. Les points de boucle sont également inconnus : les morceaux bouclent en entier.
- **Recommandation** :
  - écran-titre : « Court is Now in Session » ;
  - verdict : silence suivi d'un effet sonore (`sfx-guilty`), en attendant ;
  - les thèmes d'enquête ne seront nécessaires qu'à l'arrivée de l'enquête (jalon 5).

## 7. Effets sonores 3DS non identifiés

- **Constat** : 113 fichiers nommés par offset hexadécimal ont été rangés dans `audio/sfx/3ds/_a-trier/`.
- **Recommandation** : s'en passer pour la démo, puisque les effets DS couvrent les besoins. Au jalon 5, une page d'écoute permettra d'étiqueter ces fichiers et de les renommer avec traçabilité.

## 8. Hébergement, copyright et vie privée

- **Constat** :
  - les assets appartiennent à Capcom ;
  - les preuves sont de **vrais messages privés** entre personnes réelles.
- **Recommandation** :
  - **Pas de diffusion publique** : usage local (`pnpm dev` ou `pnpm preview`), ou hébergement **privé** (lien non listé et protégé par mot de passe).
  - `assets/` et `public/generated/` sont **hors git**.
  - Les captures de messages doivent rester **hors de tout dépôt public**, et toutes les personnes qui y apparaissent doivent avoir donné leur accord.
  - Mention en jeu : « Fan-game non officiel, non affilié à Capcom. »
- **Décision de l'utilisateur (hébergement R2)** :
  - les assets sont servis par le bucket R2 **public** `ace-atorney-waswas`, à travers l'URL `r2.dev`, puis plus tard par un domaine personnalisé ;
  - les objets sont lisibles par quiconque connaît leur URL, assets Capcom compris ;
  - ce déploiement ne publie que les **preuves de démo** (`evidence.demo-*`) : `pnpm assets:upload` refuse toute autre image `evidence.*` ;
  - les **vraies captures restent hors du lot public**, et devront passer par un hébergement privé si elles sont un jour diffusées.
  - Voir `DEPLOYMENT_R2.md`.

## 9. Versionnement git

- **Constat** : le dossier n'était pas un dépôt git.
- **Recommandation** : un dépôt local, initialisé au jalon 0, sans remote. Les métadonnées sont versionnées (rigs, alias, carte de réorganisation, scripts, docs), mais pas les images ni l'audio. Un remote **privé** pourra être ajouté par l'utilisateur.

## 10. Langue des déclinaisons de décors

- **Constat** : certains décors contiennent du texte peint (enseignes) et existent en plusieurs langues.
- **Recommandation** : prendre la variante **française** (`f`) quand elle existe, sinon la version de base. Les alias le rendent explicite, fichier par fichier.

## 11. Mapping exact des vues du tribunal

- **Constat** : le rôle de `bg001`, `bg002`, `bg003` et `bg005`, ainsi que des bureaux `etc20`, `etc21`, `etc22` et `etc23`, est déduit visuellement.
- **Recommandation** : le confirmer au jalon 1 en composant chaque vue et en la comparant à l'original, puis corriger les alias si nécessaire.
