/**
 * Content checks for the demo chapter (run by `pnpm test` and `pnpm content:check`):
 * static validation, deterministic playthroughs, and a seeded bounded exploration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audio, authoredImages, images, locationViews, portraits, rigs } from '../../../asset-meta/assets.ts';
import { AutoPlayer, explore } from '../../engine/autoplay.ts';
import { compileChapter } from '../../engine/compile.ts';
import { validateChapter } from '../../engine/validate.ts';
import { demoChapter } from './chapter.ts';

const chapter = compileChapter(demoChapter);

function rigPoses(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const rig of rigs) {
    const json: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '../../../asset-meta/rigs', `${rig}.json`), 'utf8'));
    const poses = typeof json === 'object' && json !== null && 'poses' in json && typeof json.poses === 'object' && json.poses !== null ? Object.keys(json.poses) : [];
    out[rig] = poses;
  }
  return out;
}

describe('demo chapter: static validation', () => {
  it('has no errors (warnings are listed for the author)', () => {
    const issues = validateChapter(chapter, {
      sounds: new Set(Object.keys(audio)),
      images: new Set([...Object.keys(images), ...Object.keys(authoredImages), ...Object.keys(portraits)]),
      places: new Set(Object.keys(locationViews)),
      rigPoses: rigPoses(),
    });
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
    expect(issues.filter((i) => i.level === 'warning').map((i) => `${i.where}: ${i.message}`)).toEqual([]);
  });

  it('names evidence images "evidence.*" (the public bucket only accepts "evidence.demo-*", see scripts/lib/release.ts)', () => {
    for (const def of Object.values(chapter.evidence)) {
      const aliases = [def.icon, def.detail, ...Object.values(def.variants ?? {}).flatMap((v) => [v.icon, v.detail])];
      for (const alias of aliases) if (alias !== undefined) expect(alias).toMatch(/^evidence\./);
    }
  });
});

describe('demo chapter: deterministic playthroughs', () => {
  it('golden path: press s2, present the screenshot on the revealed statement -> "Coupable"', () => {
    const p = new AutoPlayer(chapter);
    p.advanceUntil((x) => x.state.wait.t === 'ce');
    expect(p.currentStatement()).toBe('s1');
    p.goToStatement('s2').act({ t: 'press' });
    expect(p.lines()).toContain('À plat\u202F? Depuis quelle heure, exactement\u202F?');
    p.goToStatement('s2b');
    p.act({ t: 'present', item: 'capture' });
    expect(p.effects[0]).toMatchObject({ fx: 'interjection', kind: 'objection', by: 'mimi' });
    p.advanceUntil((x) => x.ended !== null);
    expect(p.ended).toBe('coupable');
    expect(p.state.health).toBe(100);
    expect(p.state.vars.expWassim).toBe(0);
  });

  it('the contradiction also works on the original statement s3 without pressing', () => {
    const p = new AutoPlayer(chapter);
    p.advanceUntil((x) => x.state.wait.t === 'ce');
    p.goToStatement('s3').act({ t: 'present', item: 'capture' });
    p.advanceUntil((x) => x.ended !== null);
    expect(p.ended).toBe('coupable');
  });

  it('a wrong presentation costs 20 HP, gives Wassim 10 EXP and returns to the same statement', () => {
    const p = new AutoPlayer(chapter);
    p.advanceUntil((x) => x.state.wait.t === 'ce');
    p.act({ t: 'present', item: 'badge' });
    p.advanceUntil((x) => x.state.wait.t === 'ce');
    expect(p.state.health).toBe(80);
    expect(p.state.vars.expWassim).toBe(10);
    expect(p.currentStatement()).toBe('s1');
  });

  it('five wrong presentations empty the health bar -> Wassim is acquitted', () => {
    const p = new AutoPlayer(chapter);
    p.advanceUntil((x) => x.state.wait.t === 'ce');
    for (let i = 0; i < 5; i += 1) {
      p.act({ t: 'present', item: 'wassim' });
      p.advanceUntil((x) => x.state.wait.t === 'ce' || x.ended !== null || x.state.health === 0);
    }
    expect(p.state.health).toBe(0);
    p.advanceUntil((x) => x.ended !== null);
    expect(p.ended).toBe('acquitte');
    expect(p.state.vars.expWassim).toBe(50);
  });
});

describe('demo chapter: seeded exploration (bounded, reproducible)', () => {
  it('finds no crash or dead end over 300 seeded runs', () => {
    const endings = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) {
      const result = explore(chapter, seed, 400);
      if (result.ending !== null) endings.add(result.ending);
    }
    expect([...endings].sort()).toEqual(['acquitte', 'coupable']);
  });
});
