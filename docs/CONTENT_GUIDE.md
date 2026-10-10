# Guide d'écriture du contenu

Aide-mémoire pour écrire le chapitre, seul ou avec un assistant IA. Le contenu est du **TypeScript typé** : une faute dans un nom de personnage, de pose, de preuve ou de son est signalée à la compilation. Le reste (sections, fins, déclarations) est vérifié par `pnpm content:check`.

Exemple complet : `src/content/demo/` (`cast.ts`, `chapter.ts`).

## 1. Déclarer les éléments (`cast.ts`)

```ts
import { character, counter, flag, evidence, profile } from '../dsl/index.ts';

export const wassim = character('wassim', {
  name: 'Wassim',
  sprite: 'ron-delite',                          // planche utilisée (l'identité est indépendante du sprite)
  poses: { normal: 'normal', sueur: 'nervous' }, // pose du script -> pose du rig
  blip: 'male',                                  // 'male' | 'female' | 'typewriter'
  voices: { objection: 'voice.phoenix-wright.objection' }, // optionnel ; null = pas de voix
});

export const expWassim = counter('expWassim', 0, 'EXP de Wassim'); // affiché dans le HUD grâce au label
export const aMenti = flag('aMenti');

export const capture = evidence('capture', {
  name: 'Capture d’écran',
  description: 'Conversation du 14 mars.',
  icon: 'evidence.demo-capture',     // alias d'image (asset-meta/assets.ts)
  detail: 'evidence.demo-capture',   // image plein écran, zoomable et défilable (captures verticales)
  variants: { annotee: { description: 'Annotée par la police.' } },
});

export const profilWassim = profile(wassim, { description: 'L’accusé.', portrait: 'portrait.wassim' });
```

## 2. Écrire les sections (`chapter.ts`)

| Commande | Effet |
|---|---|
| `wassim.say('texte')`, `wassim.say('sueur', 'texte')` | Réplique ; la caméra coupe sur le banc du personnage |
| `phoenix.think('(texte)')` | Pensée en bleu ; la caméra ne bouge pas |
| `narrate('texte')` | Narration, sans nom |
| `wassim.show('normal', 'witness')`, `.hide()`, `.pose('sueur')` | Placer, retirer ou changer la pose |
| `court('judge' \| 'witness' \| 'defense' \| 'prosecution' \| 'cocounsel' \| 'wide', 'cut' \| 'fade')` | Vue du tribunal |
| `location('detention')` | Lieu (`asset-meta/assets.ts` → `locationViews`) |
| `music('music.pursuit', 500)`, `stopMusic()`, `sfx('sfx.gavel')` | Musique (avec fondu en ms) et son |
| `shake()`, `flash()`, `pause(500)` | Effets de scène |
| `mimi.objection()`, `.holdIt()`, `.takeThat()` | Interjection (image et voix) |
| `capture.add()`, `.add(true)`, `.update('annotee')`, `.remove()` | Dossier. `add()` affiche « ajouté au Dossier » ; `add(true)` est silencieux. |
| `expWassim.add(10, 'Wassim gagne 10 EXP !')`, `aMenti.set(true)` | Variables |
| `when(expWassim.is('>=', 30), [...], [...])`, `has(capture)`, `not()`, `all()`, `any()` | Conditions |
| `exitTo('section')` | Quitte **tout** ce qui est en cours (la pile est vidée) |
| `call('section')` | Exécute une section puis revient ici |
| `healthBar(true)`, `penalty(20)` | Barre de vie. À 0 PV, la partie part vers la section `gameOver`. |
| `verdict('Coupable')`, `ending('coupable')` | Verdict animé et fin |

## 3. Témoignage et contre-interrogatoire

```ts
export const tSoiree = testimony('t-soiree', 'La soirée du 14 mars', wassim, [
  { id: 's1', pose: 'normal', text: 'Je suis rentré vers 21 h.' },
  { id: 's2b', text: 'Il s’est éteint vers 22 h.', hidden: true },   // révélée par une pression
]);

play(tSoiree),                     // bannière « Témoignage » et déclarations en vert
crossExam({
  id: 'ce-soiree', testimony: tSoiree,
  press: { s1: [mimi.say('Vraiment ?'), reveal('ce-soiree', tSoiree, 's2b')] },
  solutions: [{ stmts: ['s2b'], items: [capture], body: [/* … */ exitTo('suite')] }],
  wrong: [juge.say('Hors sujet.'), expWassim.add(10, 'Wassim gagne 10 EXP !'), penalty(20)],
  wrongAt: { s1: [/* réponse spécifique à s1 */ penalty(10)] },
  loop: [juge.say('On reprend depuis le début.')],
}),
```

Règles à retenir (détail : `ARCHITECTURE.md` §9) :
- **Après une pression**, le contre-interrogatoire reprend sur la déclaration suivante. On peut forcer `{ body, resume: 'same' }` ou `{ body, resume: { to: 's3' } }`.
- **Un corps de solution doit finir** par `exitTo(...)` ou `resumeCrossExam()`.
- **La pénalité se place en dernier** dans `wrong`, car à 0 PV plus rien ne s'exécute après elle.
- **Stocker les déclarations** avec des IDs stables (`s1`, `s2b`…), jamais par leur position.

## 4. Balisage du texte

| Balise | Effet |
|---|---|
| `{red}…{/}`, `{blue}`, `{green}` | Couleurs |
| `{p:400}` | Pause de 400 ms |
| `{s:0.5}` | Vitesse de frappe |
| `{shake}`, `{flash}` | Secousse ou flash au moment où la frappe atteint la balise |
| `{sfx:sfx.shock}` | Son au moment où la frappe atteint la balise |
| `{raw}…{/raw}` | Texte exact, sans typographie automatique, pour citer un message |

**Typographie française automatique** : espace fine insécable avant `! ? ;`, insécable avant `:` et à l'intérieur des `« »`.

Les effets inline sont **décoratifs** : un clic qui complète la ligne les saute. Un effet important doit être une commande à part (`sfx(...)`, `shake()`).

## 5. Vérifier

```
pnpm content:check   # validation (références, solutions, sections), parcours, exploration
pnpm dev             # jouer : http://localhost:5173 (?fast=1 pour tout accélérer)
```

Après une modification de **structure** (commandes, IDs, balises), les anciennes sauvegardes redémarreront le chapitre. Pour forcer ce redémarrage même sans changement de structure, augmenter `contentRevision`.
