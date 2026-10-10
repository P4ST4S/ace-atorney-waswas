/**
 * Logical asset aliases -> source files under `assets/`.
 *
 * The game never references raw file names (they are ambiguous across games, see docs/ASSET_INVENTORY.md);
 * it only uses these aliases. The pipeline (scripts/build-assets.ts) only processes what is listed here.
 */

/** Opaque full-screen images (backgrounds) and overlays, converted to WebP at their original size. */
export const images = {
  // Courtroom
  'court.defense': 'images/backgrounds/courtroom/bg001.png',
  'court.prosecution': 'images/backgrounds/courtroom/bg002.png',
  'court.witness': 'images/backgrounds/courtroom/bg003.png',
  'court.judge': 'images/backgrounds/courtroom/bg004.png',
  'court.cocounsel': 'images/backgrounds/courtroom/bg005.png',
  'court.wide': 'images/backgrounds/courtroom/bg006.png',
  'court.pan': 'images/backgrounds/courtroom/houscr.png',
  'court.desk.defense': 'images/backgrounds/courtroom/etc22.png',
  'court.desk.prosecution': 'images/backgrounds/courtroom/etc21.png',
  'court.desk.witness': 'images/backgrounds/courtroom/etc20.png',
  'court.desk.judge': 'images/backgrounds/courtroom/etc24.png',
  'court.desk.cocounsel': 'images/backgrounds/courtroom/etc23.png',
  // Locations
  'detention.room': 'images/backgrounds/aa1/detention-center/bg01e.png',
  'detention.glass': 'images/backgrounds/aa1/detention-center/bg01ew.png',
  'defendant-lobby': 'images/backgrounds/aa1/defendant-lobby/bg002.png',
  'kb.ceo-office': 'images/backgrounds/aa3/kb-security/ceos-office/bg204u.png',
  // Interface
  'ui.evidence-frame': 'images/ui/evidence-frame.png',
  'ui.objection': 'images/ui/interjections/en/objection.png',
  'ui.holdit': 'images/ui/interjections/fr/hold-it.png',
  'ui.takethat': 'images/ui/interjections/fr/take-that.png',
} as const satisfies Record<string, string>;

/** Images authored for this game (not from the original games), stored next to this file. */
export const authoredImages = {
  'evidence.demo-capture': 'asset-meta/demo-evidence/capture-messages.svg',
  'evidence.demo-badge': 'asset-meta/demo-evidence/badge.svg',
} as const satisfies Record<string, string>;

/** Character rigs (asset-meta/rigs/<id>.json). */
export const rigs = ['ron-delite', 'phoenix-wright', 'miles-edgeworth', 'judges'] as const;

/** Court Record portraits, cropped from a pose's idle frame (rectangle in pose space). */
export const portraits = {
  'portrait.wassim': { rig: 'ron-delite', pose: 'normal', rect: { x: 160, y: 0, w: 440, h: 440 } },
  'portrait.phoenix': { rig: 'phoenix-wright', pose: 'normal', rect: { x: 330, y: 20, w: 380, h: 380 } },
  'portrait.mimi': { rig: 'miles-edgeworth', pose: 'normal', rect: { x: 110, y: 0, w: 380, h: 380 } },
  'portrait.juge': { rig: 'judges', pose: 'normal', rect: { x: 27, y: 0, w: 270, h: 270 } },
} as const satisfies Record<string, { readonly rig: (typeof rigs)[number]; readonly pose: string; readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } }>;

export const audio = {
  // Music
  'music.court-in-session': 'audio/music/court-is-now-in-session.mp3',
  'music.questioning-moderato': 'audio/music/questioning-moderato-2001.mp3',
  'music.questioning-allegro': 'audio/music/questioning-allegro-2001.mp3',
  'music.objection': 'audio/music/objection-2001.mp3',
  'music.pursuit': 'audio/music/pursuit-corner-the-culprit.mp3',
  'music.truth': 'audio/music/telling-the-truth-2001.mp3',
  'music.suspense': 'audio/music/suspense.mp3',
  // Text blips
  'blip.male': 'audio/sfx/ds/blips/sfx-blipmale.wav',
  'blip.female': 'audio/sfx/ds/blips/sfx-blipfemale.wav',
  'blip.typewriter': 'audio/sfx/ds/blips/sfx-typwriter.wav',
  // Sound effects
  'sfx.gavel': 'audio/sfx/ds/court/sfx-gavel.wav',
  'sfx.deskslam': 'audio/sfx/ds/court/sfx-deskslam.wav',
  'sfx.objection': 'audio/sfx/ds/court/sfx-objection.wav',
  'sfx.damage': 'audio/sfx/ds/court/sfx-damage1.wav',
  'sfx.guilty': 'audio/sfx/ds/court/sfx-guilty.wav',
  'sfx.testimony': 'audio/sfx/ds/court/sfx-testimony.wav',
  'sfx.realization': 'audio/sfx/ds/court/sfx-realization.wav',
  'sfx.shock': 'audio/sfx/ds/court/sfx-shock.wav',
  'sfx.gallery': 'audio/sfx/ds/court/sfx-gallery.wav',
  'sfx.evidence': 'audio/sfx/ds/ui/sfx-evidenceshoop.wav',
  'sfx.pageturn': 'audio/sfx/ds/ui/sfx-pageturn.wav',
  'sfx.select': 'audio/sfx/ds/ui/sfx-selectblip.wav',
  'sfx.cancel': 'audio/sfx/ds/ui/sfx-cancel.wav',
  // French interjection voices: `voice.<sprite-owner>.<kind>`
  'voice.phoenix-wright.objection': 'audio/voices/fr/phoenix-wright-objection.wav',
  'voice.phoenix-wright.holdit': 'audio/voices/fr/phoenix-wright-hold-it.wav',
  'voice.phoenix-wright.takethat': 'audio/voices/fr/phoenix-wright-take-that.wav',
  'voice.miles-edgeworth.objection': 'audio/voices/fr/miles-edgeworth-objection.wav',
  'voice.miles-edgeworth.holdit': 'audio/voices/fr/miles-edgeworth-hold-it.wav',
  'voice.miles-edgeworth.takethat': 'audio/voices/fr/miles-edgeworth-take-that.wav',
  'voice.franziska-von-karma.objection': 'audio/voices/fr/franziska-von-karma-objection.wav',
  'voice.mia-fey.objection': 'audio/voices/fr/mia-fey-objection.wav',
  'voice.mia-fey.holdit': 'audio/voices/fr/mia-fey-hold-it.wav',
  'voice.mia-fey.takethat': 'audio/voices/fr/mia-fey-take-that.wav',
} as const satisfies Record<string, string>;

export type ImageAlias = keyof typeof images | keyof typeof authoredImages | keyof typeof portraits;
export type AudioAlias = keyof typeof audio;
export type RigId = (typeof rigs)[number];

export type CourtPos = 'defense' | 'prosecution' | 'witness' | 'judge' | 'cocounsel';

/** A composed view: background, optional foreground overlay drawn over characters, and the character slot. */
export interface SceneView {
  readonly bg: ImageAlias;
  /** Foreground (desk, glass…) drawn over the character, positioned in stage coordinates (1920x1080). */
  readonly fg?: { readonly image: ImageAlias; readonly x: number; readonly y: number };
  /** Where the character's pose anchor (bottom-center) is placed. */
  readonly slot: { readonly x: number; readonly y: number };
}

/** Courtroom camera views. Positions were confirmed against rendered screenshots (milestone 1). */
export const courtViews: Readonly<Record<CourtPos | 'wide', SceneView>> = {
  defense: { bg: 'court.defense', fg: { image: 'court.desk.defense', x: 0, y: 840 }, slot: { x: 760, y: 1130 } },
  prosecution: { bg: 'court.prosecution', fg: { image: 'court.desk.prosecution', x: 0, y: 840 }, slot: { x: 1160, y: 1130 } },
  witness: { bg: 'court.witness', fg: { image: 'court.desk.witness', x: 359, y: 859 }, slot: { x: 960, y: 1160 } },
  judge: { bg: 'court.judge', fg: { image: 'court.desk.judge', x: 0, y: 810 }, slot: { x: 960, y: 1080 } },
  cocounsel: { bg: 'court.cocounsel', fg: { image: 'court.desk.cocounsel', x: 0, y: 880 }, slot: { x: 1300, y: 1130 } },
  wide: { bg: 'court.wide', slot: { x: 960, y: 1080 } },
};

/** Investigation places (engine `location` command ids). */
export const locationViews = {
  detention: { bg: 'detention.room', fg: { image: 'detention.glass', x: 0, y: 0 }, slot: { x: 960, y: 1180 } },
  'defendant-lobby': { bg: 'defendant-lobby', slot: { x: 960, y: 1180 } },
  'kb-office': { bg: 'kb.ceo-office', slot: { x: 960, y: 1180 } },
} as const satisfies Record<string, SceneView>;

export type PlaceId = keyof typeof locationViews;
