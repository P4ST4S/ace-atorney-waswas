import {
  court, crossExam, defineChapter, ending, exitTo, healthBar, music, penalty, play, reveal, section, sfx, shake, stopMusic, testimony, verdict,
} from '../dsl/index.ts';
import { badge, capture, expWassim, juge, mimi, phoenix, profilJuge, profilPhoenix, profilWassim, wassim } from './cast.ts';

/**
 * Demo chapter used to validate the engine (milestones 2-3). Not the real story.
 */
export const tSoiree = testimony('t-soiree', 'La soirée du 14 mars', wassim, [
  { id: 's1', pose: 'normal', text: 'Le soir du 14, je suis rentré chez moi vers 21 h.' },
  { id: 's2', pose: 'sueur', text: 'J’étais crevé, mon téléphone était à plat, j’ai dormi direct.' },
  { id: 's2b', pose: 'sueur', text: 'Il s’est éteint vers 22 h, au plus tard.', hidden: true },
  { id: 's3', pose: 'normal', text: 'Donc je n’ai envoyé {red}aucun message{/} cette nuit-là !' },
]);

const intro = section('intro', [
  juge.show('normal', 'judge'),
  phoenix.show('normal', 'defense'),
  mimi.show('normal', 'prosecution'),
  wassim.show('normal', 'witness'),
  court('judge'),
  capture.add(true),
  badge.add(true),
  profilWassim.add(true),
  profilPhoenix.add(true),
  profilJuge.add(true),
  music('music.court-in-session'),
  sfx('sfx.gavel'),
  juge.say('L’audience du procès de {red}Wassim{/} est ouverte.{p:250}'),
  juge.say('L’accusation est-elle prête ?'),
  mimi.say('L’accusation est prête, Votre Honneur.'),
  phoenix.say('La défense est prête, Votre Honneur !'),
  juge.say('Bien. Que l’accusé s’avance à la barre.'),
  wassim.say('Je n’ai rien fait, je vous jure !{p:300} J’étais chez moi toute la soirée.'),
  mimi.objection(),
  music('music.objection'),
  shake(),
  mimi.say('Ce sera à vous de le {red}prouver{/}. Racontez-nous cette soirée.'),
  wassim.say('sueur', 'Euh…{p:400} D’accord.'),
  healthBar(true),
  exitTo('temoignage'),
]);

const temoignage = section('temoignage', [
  music('music.questioning-moderato'),
  play(tSoiree),
  juge.say('Hmm… L’accusation peut procéder au contre-interrogatoire.'),
  mimi.say('Avec plaisir, Votre Honneur.'),
  crossExam({
    id: 'ce-soiree',
    testimony: tSoiree,
    press: {
      s1: [
        mimi.say('« Vers 21 h » ? Vous en êtes certain ?'),
        wassim.say('Ouais. Demandez à mon chat.'),
      ],
      s2: [
        mimi.say('À plat ? Depuis quelle heure, exactement ?'),
        wassim.say('sueur', 'Euh… Vers 22 h, je dirais.'),
        phoenix.think('(Aïe… Il n’aurait pas dû préciser ça.)'),
        juge.say('Témoin, ajoutez cela à votre témoignage.'),
        reveal('ce-soiree', tSoiree, 's2b'),
      ],
      s2b: [
        mimi.say('22 h au plus tard… Vous le maintenez ?'),
        wassim.say('sueur', 'Sûr et certain ! Après, plus rien.'),
      ],
      s3: [
        mimi.say('Aucun message ? Vous le jurez ?'),
        wassim.say('Sur la tête de ma console.'),
      ],
    },
    solutions: [{
      stmts: ['s3', 's2b'],
      items: [capture],
      body: [
        music('music.pursuit'),
        mimi.say('Alors expliquez-moi ceci, monsieur « téléphone à plat ».'),
        mimi.say('Ce message a été envoyé {red}à 23 h 12{/}… depuis {red}votre{/} compte !{shake}'),
        wassim.say('crise', 'Q-quoi ?!{p:200} C’est un montage !'),
        phoenix.think('(Il est coincé…)'),
        exitTo('verdict'),
      ],
    }],
    wrong: [
      juge.say('L’accusation peut-elle m’expliquer le rapport avec cette déclaration ?'),
      phoenix.say('L’accusation s’égare, Votre Honneur !'),
      wassim.say('Trop facile.'),
      expWassim.add(10, 'Wassim gagne 10 EXP !'),
      penalty(20),
    ],
    loop: [juge.say('Le témoin a terminé. L’accusation a-t-elle relevé quelque chose ?')],
  }),
]);

const verdictSection = section('verdict', [
  stopMusic(),
  juge.say('La cour en a assez entendu.'),
  juge.say('Je déclare l’accusé, Wassim…'),
  verdict('Coupable'),
  ending('coupable'),
]);

const acquitte = section('acquitte', [
  stopMusic(),
  juge.say('L’accusation n’a apporté aucune preuve solide…'),
  verdict('Non coupable'),
  wassim.say('Haha ! Niveau suivant !'),
  ending('acquitte'),
]);

export const demoChapter = defineChapter({
  id: 'demo',
  title: 'Démo — Le procès de Wassim',
  contentRevision: 1,
  start: 'intro',
  gameOver: 'acquitte',
  maxHealth: 100,
  player: { character: mimi, bench: 'prosecution' },
  cast: [juge, phoenix, mimi, wassim],
  vars: [expWassim],
  evidence: [capture, badge],
  profiles: [profilWassim, profilPhoenix, profilJuge],
  testimonies: [tSoiree],
  endings: {
    coupable: { title: 'Coupable — Wassim est condamné', tone: 'win' },
    acquitte: { title: 'Acquitté — Wassim s’en sort (et gagne de l’EXP)', tone: 'lose' },
  },
  sections: [intro, temoignage, verdictSection, acquitte],
});
