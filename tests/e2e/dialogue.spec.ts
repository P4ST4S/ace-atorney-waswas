import { expect, test } from '@playwright/test';
import { box, game, interjections, next, start } from './helpers.ts';

const text = (page: Parameters<typeof box>[0]) => page.getByTestId('dialogue-text');

test('plays the opening dialogue with camera cuts and a pose change (fast mode)', async ({ page }) => {
  const errors = await start(page, '?fast=1');
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:judge');
  await expect(page.getByTestId('nameplate')).toHaveText('Le Juge');
  await expect(text(page)).toContainText('L’audience du procès de Wassim est ouverte.');

  await next(page);
  await expect(text(page)).toContainText('L’accusation est-elle prête');
  await next(page);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:prosecution');
  await expect(page.getByTestId('nameplate')).toHaveText('Mimi');
  await next(page);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:defense');
  await next(page);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:judge');
  await next(page);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:witness');
  await expect(page.getByTestId('nameplate')).toHaveText('Wassim');

  // "Objection !" by the player, then Mimi's line.
  await next(page);
  await expect.poll(() => interjections(page)).toEqual(['objection']);
  await expect(page.getByTestId('nameplate')).toHaveText('Mimi');
  await expect(text(page)).toContainText('prouver');

  // Expression change: Wassim switches to his nervous pose.
  await next(page);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-actors', /witness=wassim:sueur/);
  expect(errors).toEqual([]);
});

test('normal speed: a click while typing completes the line, the next click advances', async ({ page }) => {
  const errors = await start(page);
  const b = box(page);
  await expect(text(page)).toContainText('L’audience');
  // Still typing: some characters are hidden.
  await expect(b).toHaveAttribute('data-typed', '0');
  const key = await b.getAttribute('data-key');
  const hidden = () => text(page).locator('span').evaluateAll((spans) => spans.filter((s) => s instanceof HTMLElement && s.style.visibility === 'hidden').length);
  expect(await hidden()).toBeGreaterThan(0);

  await game(page).click({ position: { x: 640, y: 250 } });
  await expect(b).toHaveAttribute('data-typed', '1');
  expect(await hidden()).toBe(0);
  // Same line: the completing click was consumed by the presentation.
  await expect(b).toHaveAttribute('data-key', key ?? '');
  await expect(text(page)).toContainText('est ouverte');

  await expect(b).toHaveAttribute('data-ready', '1');
  await game(page).click({ position: { x: 640, y: 250 } });
  await expect(text(page)).toContainText('prête');
  expect(errors).toEqual([]);
});

test('normal speed: the interjection bubble is shown and the text box hidden meanwhile', async ({ page }) => {
  const errors = await start(page);
  for (let i = 0; i < 6; i += 1) await next(page);
  await expect(page.getByTestId('interjection')).toHaveAttribute('data-kind', 'objection');
  await expect(page.getByTestId('interjection')).toBeHidden({ timeout: 5000 });
  await expect(page.getByTestId('nameplate')).toHaveText('Mimi');
  expect(errors).toEqual([]);
});
