import { expect, test } from '@playwright/test';

test('app boots on the start screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('start')).toContainText('Cliquez pour commencer');
  expect(errors).toEqual([]);
});
