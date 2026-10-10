import { expect, test } from '@playwright/test';

const VIEWS = ['defense', 'prosecution', 'witness', 'judge', 'cocounsel', 'wide'] as const;
const SHOT_DIR = process.env.STAGE_SHOT_DIR;

test.describe('stage rendering (milestone 1)', () => {
  test.use({ viewport: { width: 1920, height: 1130 } });

  for (const view of VIEWS) {
    test(`composes the ${view} view`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`/dev/stage?view=${view}&ui=0`);
      const background = page.getByTestId('background');
      await expect(background).toBeVisible();
      await expect.poll(() => background.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      if (view !== 'cocounsel' && view !== 'wide') {
        // The sprite pieces are created once the pose sheet is decoded.
        await expect(page.getByTestId('character').locator('div').first()).toBeVisible();
      }
      if (SHOT_DIR !== undefined) await page.getByTestId('scene-frame').screenshot({ path: `${SHOT_DIR}/${view}.png` });
      expect(errors).toEqual([]);
    });
  }
});
