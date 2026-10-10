import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1920, height: 1130 } });

test('animated witness keeps frames regular and has no long tasks', async ({ page }) => {
  await page.goto('/dev/stage?view=witness&talk=1');
  await expect(page.getByTestId('character').locator('div').first()).toBeVisible();
  const hud = page.getByTestId('perf-hud');
  await expect(hud).toHaveAttribute('data-longtasks', /\d+/);
  // Only the animation window counts (page load and dev-server compilation are excluded).
  await page.waitForTimeout(500);
  const longTasksBefore = Number(await hud.getAttribute('data-longtasks'));
  const droppedBefore = Number(await hud.getAttribute('data-dropped'));
  await page.waitForTimeout(4000);
  const longTasks = Number(await hud.getAttribute('data-longtasks')) - longTasksBefore;
  const p95 = Number(await hud.getAttribute('data-p95'));
  const dropped = Number(await hud.getAttribute('data-dropped')) - droppedBefore;
  // Estimated decoded memory of the images used by the scene (browsers decode to 4 bytes per pixel).
  const decodedMb = await page.evaluate(() => {
    const urls = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="scene"] *')) {
      const bg = el.style.backgroundImage;
      if (bg.startsWith('url(')) urls.add(bg.slice(5, -2));
      if (el instanceof HTMLImageElement) urls.add(el.src);
    }
    return Promise.all([...urls].map(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img.naturalWidth * img.naturalHeight * 4;
    })).then((sizes) => sizes.reduce((a, b) => a + b, 0) / 1048576);
  });
  console.log(`perf: p95 frame interval ${p95} ms, dropped ${dropped}, long tasks ${longTasks}, estimated decoded images ${decodedMb.toFixed(1)} MB`);
  expect(longTasks).toBe(0);
  expect(p95).toBeLessThan(25);
});
