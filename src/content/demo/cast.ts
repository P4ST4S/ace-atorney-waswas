import { character, counter, evidence, profile } from '../dsl/index.ts';

/** Demo cast. Wassim and Mimi have no sprites of their own yet: they borrow Ron DeLite's and Edgeworth's. */
export const juge = character('juge', {
  name: 'Le Juge',
  sprite: 'judges',
  poses: { normal: 'normal' },
  blip: 'male',
});

export const phoenix = character('phoenix', {
  name: 'Phoenix',
  sprite: 'phoenix-wright',
  poses: { normal: 'normal' },
  blip: 'male',
  voices: { objection: 'voice.phoenix-wright.objection', holdit: 'voice.phoenix-wright.holdit', takethat: 'voice.phoenix-wright.takethat' },
});

export const mimi = character('mimi', {
  name: 'Mimi',
  sprite: 'miles-edgeworth',
  poses: { normal: 'normal' },
  blip: 'male',
  voices: { objection: 'voice.miles-edgeworth.objection', holdit: 'voice.miles-edgeworth.holdit', takethat: 'voice.miles-edgeworth.takethat' },
});

export const wassim = character('wassim', {
  name: 'Wassim',
  sprite: 'ron-delite',
  poses: { normal: 'normal', penche: 'tilt', abattu: 'down', sueur: 'nervous', pleure: 'crying', crise: 'breakdown', supplie: 'pleading' },
  blip: 'male',
});

export const expWassim = counter('expWassim', 0, 'EXP de Wassim');

export const capture = evidence('capture', {
  name: 'Capture d’écran',
  description: 'Conversation du 14 mars avec le compte de Wassim. Dernier message envoyé à 23 h 12.',
  icon: 'evidence.demo-capture',
  detail: 'evidence.demo-capture',
});

export const badge = evidence('badge', {
  name: 'Badge d’accès',
  description: 'Badge de Wassim. Entrée à 18 h 02, sortie à 20 h 41.',
  icon: 'evidence.demo-badge',
  detail: 'evidence.demo-badge',
});

export const profilWassim = profile(wassim, { description: 'L’accusé. Jure qu’il était chez lui toute la soirée.', portrait: 'portrait.wassim' });
export const profilPhoenix = profile(phoenix, { description: 'Avocat de la défense. Têtu comme une mule.', portrait: 'portrait.phoenix' });
export const profilJuge = profile(juge, { description: 'Préside le procès. A vu passer beaucoup d’accusés.', portrait: 'portrait.juge' });
