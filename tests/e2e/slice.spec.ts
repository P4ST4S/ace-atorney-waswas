import { expect, test } from '@playwright/test';
import { box, interjections, next, present, start, untilCrossExam, untilEnded } from './helpers.ts';

/**
 * Vertical slice (milestone 3): the 8 steps of the plan, end to end through the real UI.
 * 1 background, 2 animated character, 3 dialogue, 4 expression change, 5 Court Record,
 * 6 presenting evidence, 7 contradiction, 8 transition to another narrative state.
 */

test('vertical slice: from the opening to the "Coupable" verdict (fast mode)', async ({ page }) => {
  const errors = await start(page, '?fast=1');

  // 1. Background loaded.
  await expect(page.getByTestId('stage')).toHaveAttribute('data-place', 'court:judge');
  // 3. Dialogue runs.
  await expect(page.getByTestId('nameplate')).toHaveText('Le Juge');
  for (let i = 0; i < 5; i += 1) await next(page);
  await expect(page.getByTestId('nameplate')).toHaveText('Wassim');
  // 2. Character displayed (sprite pieces present).
  await expect(page.getByTestId('actor-wassim').locator('div').first()).toBeVisible();
  // 4. Expression change: Wassim becomes nervous.
  await next(page);
  await next(page);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-actors', /witness=wassim:sueur/);

  await untilCrossExam(page);
  await expect(page.getByTestId('ce-bar')).toHaveAttribute('data-stmt', 's1');
  await expect(page.getByTestId('health')).toHaveAttribute('data-health', '100');

  // 5. Court Record: browse and examine the screenshot (zoomable detail view).
  await page.getByTestId('record-button').click();
  await expect(page.getByTestId('court-record')).toHaveAttribute('data-mode', 'view');
  await page.getByTestId('record-item-capture').click();
  await page.getByTestId('record-examine').click();
  await expect(page.getByTestId('evidence-detail')).toBeVisible();
  await page.getByTestId('detail-zoom').click();
  await page.getByTestId('detail-close').click();
  await page.getByTestId('record-tab-profile').click();
  await expect(page.getByTestId('record-item-wassim')).toBeVisible();
  await page.getByTestId('record-close').click();
  await expect(page.getByTestId('court-record')).toBeHidden();

  // Wrong presentation: penalty + EXP for Wassim, back to the same statement.
  await present(page, 'badge');
  await expect.poll(() => interjections(page)).toEqual(['objection', 'objection']);
  await untilCrossExam(page);
  await expect(page.getByTestId('health')).toHaveAttribute('data-health', '80');
  await expect(page.getByTestId('var-expWassim')).toContainText('10');
  await expect(page.getByTestId('ce-bar')).toHaveAttribute('data-stmt', 's1');

  // Press statement 2: a hidden statement is revealed and selected.
  await page.getByTestId('ce-next').click();
  await expect(page.getByTestId('ce-bar')).toHaveAttribute('data-stmt', 's2');
  await page.getByTestId('ce-press').click();
  await expect.poll(() => interjections(page)).toContain('holdit');
  await untilCrossExam(page);
  await expect(page.getByTestId('ce-bar')).toHaveAttribute('data-stmt', 's2b');

  // 6. Present the screenshot. 7. Contradiction: "Objection !" and the accusation.
  await present(page, 'capture');
  await expect.poll(() => interjections(page)).toEqual(['objection', 'objection', 'holdit', 'objection']);
  await expect(page.getByTestId('nameplate')).toHaveText('Mimi');
  await expect(page.getByTestId('dialogue-text')).toContainText('téléphone à plat');

  // 8. New narrative state: verdict and ending.
  await untilEnded(page);
  await expect(page.getByTestId('ended')).toHaveAttribute('data-ending', 'coupable');
  expect(errors).toEqual([]);
});

test('normal speed: the witness is animated while talking', async ({ page }) => {
  const errors = await start(page);
  for (let i = 0; i < 5; i += 1) await next(page);
  await expect(page.getByTestId('nameplate')).toHaveText('Wassim');
  // While Wassim's line is being typed, his mouth frames change (background positions of the sprite pieces).
  const frames = new Set<string>();
  for (let i = 0; i < 15 && (await box(page).getAttribute('data-typed')) !== '1'; i += 1) {
    frames.add(await page.getByTestId('actor-wassim').evaluate((el) => [...el.children].map((c) => (c instanceof HTMLElement ? `${c.style.display}|${c.style.backgroundPosition}` : '')).join(';')));
    await page.waitForTimeout(60);
  }
  expect(frames.size).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('reaching 0 HP ends with the acquittal (fast mode)', async ({ page }) => {
  const errors = await start(page, '?fast=1');
  await untilCrossExam(page);
  for (let i = 0; i < 5; i += 1) {
    await present(page, 'badge');
    await expect.poll(async () => (await interjections(page)).length).toBe(i + 2);
    if (i < 4) await untilCrossExam(page);
  }
  await untilEnded(page);
  await expect(page.getByTestId('ended')).toHaveAttribute('data-ending', 'acquitte');
  await expect(page.getByTestId('var-expWassim')).toContainText('50');
  expect(errors).toEqual([]);
});
