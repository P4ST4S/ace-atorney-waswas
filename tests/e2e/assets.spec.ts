import { expect, test, type Page } from '@playwright/test';
import { interjections, present, start, untilCrossExam } from './helpers.ts';

/**
 * Asset hosting (docs/DEPLOYMENT_R2.md), run by every project: locally (Vite serves public/generated/) and with
 * remote assets (R2 emulator or the real bucket): URLs, Web Audio over CORS, and missing resources.
 */

interface AssetProject {
  readonly assetMode: 'local' | 'remote';
  /** Local: `<site>/generated/`; remote: `<bucket>/releases/`. */
  readonly assetBase: string;
}

function assetProject(): AssetProject {
  const { assetMode, assetBase } = test.info().project.metadata as Partial<AssetProject>;
  if ((assetMode !== 'local' && assetMode !== 'remote') || typeof assetBase !== 'string') throw new Error('Project metadata must define assetMode and assetBase.');
  return { assetMode, assetBase };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GAME_ASSET = /\.(?:webp|wav|mp3)$/;
/** Chrome reports every 404 as a console error; tests about missing files expect exactly those. */
const notMissingFile = (message: string): boolean => !message.includes('Failed to load resource');

interface AssetResponse {
  readonly url: string;
  readonly type: string;
  readonly status: number;
  readonly allowOrigin: string | null;
}

function recordAssets(page: Page): { readonly responses: AssetResponse[]; readonly failed: string[] } {
  const responses: AssetResponse[] = [];
  const failed: string[] = [];
  page.on('response', (response) => {
    if (!GAME_ASSET.test(new URL(response.url()).pathname)) return;
    responses.push({ url: response.url(), type: response.request().resourceType(), status: response.status(), allowOrigin: response.headers()['access-control-allow-origin'] ?? null });
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? '';
    // Media elements cancel their range requests on purpose (streaming, track changes).
    if (!error.includes('ERR_ABORTED')) failed.push(`${request.url()} ${error}`);
  });
  return { responses, failed };
}

test('backgrounds, sprites, evidence, interjections and sounds come from the configured asset origin', async ({ page, baseURL }) => {
  const { assetMode, assetBase } = assetProject();
  const assets = recordAssets(page);
  const errors = await start(page, '?fast=1');
  await untilCrossExam(page);

  // Court Record: portraits, evidence icons in their frame, and the zoomable capture.
  await page.getByTestId('record-button').click();
  await page.getByTestId('record-item-capture').click();
  await page.getByTestId('record-examine').click();
  const capture = page.getByTestId('evidence-detail').locator('img');
  await expect.poll(() => capture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByTestId('detail-close').click();
  await page.getByTestId('record-tab-profile').click();
  await expect(page.getByTestId('record-item-wassim')).toBeVisible();
  await page.getByTestId('record-close').click();

  // An interjection: bubble, voice and impact sound.
  await present(page, 'badge');
  await expect.poll(() => interjections(page)).toEqual(['objection', 'objection']);
  await untilCrossExam(page);
  expect(errors).toEqual([]);
  expect(assets.failed).toEqual([]);

  const urls = assets.responses.map((r) => r.url);
  for (const expected of [/img\/court\./, /sprites\/ron-delite\//, /img\/ui\.objection\./, /img\/ui\.evidence-frame\./, /img\/evidence\.demo-capture\./, /img\/portrait\./, /audio\/voice\./, /audio\/sfx\./, /audio\/music\./]) {
    expect(urls.some((url) => expected.test(url)), String(expected)).toBe(true);
  }
  // Remote: `<bucket>/releases/<release>/...` only, nothing from the site's own generated/ folder.
  const root = new RegExp(`^${escapeRegExp(assetBase)}${assetMode === 'remote' ? '[0-9a-f]{16}/' : ''}`);
  expect(urls.filter((url) => !root.test(url))).toEqual([]);
  expect(assets.responses.filter((r) => r.status >= 400)).toEqual([]);

  // Every image requested by the game decodes.
  const images = [...new Set(assets.responses.filter((r) => r.url.endsWith('.webp')).map((r) => r.url))];
  const widths = await page.evaluate((list) => Promise.all(list.map(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth;
  })), images);
  expect(widths.every((w) => w > 0)).toBe(true);

  // Sound effects, voices and blips go through Web Audio (XHR); music streams through <audio>.
  const sounds = assets.responses.filter((r) => r.url.endsWith('.wav'));
  expect(sounds.length).toBeGreaterThan(0);
  expect(sounds.filter((r) => r.type !== 'xhr')).toEqual([]);
  expect(assets.responses.filter((r) => r.url.endsWith('.mp3') && r.type !== 'media')).toEqual([]);
  if (assetMode === 'remote') {
    // Cross-origin XHR only succeeds with CORS; otherwise Howler would silently fall back to HTML5 audio.
    const origin = new URL(baseURL ?? '').origin;
    expect(sounds.filter((r) => r.allowOrigin !== origin && r.allowOrigin !== '*')).toEqual([]);
  }
});

test('a missing background shows the retry prompt, then the game resumes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let missing = true;
  await page.route(/\/img\/court\.judge\.webp$/, (route) => (missing ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'NoSuchKey' }) : route.continue()));
  await page.goto('/?fast=1');
  await page.getByTestId('start').click();

  const retry = page.getByTestId('retry');
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('dialogue-text')).toHaveCount(0);
  missing = false;
  await retry.getByRole('button', { name: 'Réessayer' }).click();
  await expect(retry).toBeHidden();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:judge');
  await expect(page.getByTestId('dialogue-text')).toBeVisible();
  expect(errors.filter(notMissingFile)).toEqual([]);
});

test('missing sound effects, voices and blips never block the game nor flood the asset host', async ({ page }) => {
  const requests = new Map<string, number>();
  await page.route(/\.wav$/, (route) => {
    const url = route.request().url();
    requests.set(url, (requests.get(url) ?? 0) + 1);
    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'NoSuchKey' });
  });
  const errors = await start(page, '?fast=1');
  await untilCrossExam(page);
  await present(page, 'badge');
  await expect.poll(() => interjections(page)).toEqual(['objection', 'objection']);
  await untilCrossExam(page);
  await expect(page.getByTestId('health')).toHaveAttribute('data-health', '80');
  expect(errors.filter(notMissingFile)).toEqual([]);
  expect(requests.size).toBeGreaterThan(0);
  // One XHR, plus at most one HTML5 attempt; then the sound is skipped for a while.
  expect(Math.max(...requests.values())).toBeLessThanOrEqual(2);
});

test('a missing evidence image keeps the Court Record usable', async ({ page }) => {
  await page.route(/\/img\/evidence\.demo-badge\.webp$/, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'NoSuchKey' }));
  const errors = await start(page, '?fast=1');
  await untilCrossExam(page);
  await page.getByTestId('record-button').click();
  await page.getByTestId('record-item-badge').click();
  await expect(page.getByTestId('record-selected')).toHaveAttribute('data-item', 'badge');
  await page.getByTestId('record-close').click();
  await expect(page.getByTestId('court-record')).toBeHidden();
  expect(errors.filter(notMissingFile)).toEqual([]);
});
