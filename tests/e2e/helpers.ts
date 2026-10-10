import { expect, type Page } from '@playwright/test';

export const game = (page: Page) => page.getByTestId('game');
export const box = (page: Page) => page.getByTestId('dialogue-box');

const CLICK = { position: { x: 640, y: 250 } } as const;

/**
 * Opens the game (optionally with a query such as `?fast=1`), records errors and every interjection bubble
 * (in fast mode they only last a frame), then clicks "start".
 */
export async function start(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/${query}`);
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(window, '__interjections', seen);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          const el = node.matches('[data-testid="interjection"]') ? node : node.querySelector('[data-testid="interjection"]');
          const kind = el?.getAttribute('data-kind');
          if (kind !== null && kind !== undefined) seen.push(kind);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId('start').click();
  await expect(page.getByTestId('dialogue-text')).toBeVisible();
  return errors;
}

export async function interjections(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen: unknown = Reflect.get(window, '__interjections');
    return Array.isArray(seen) ? seen.filter((k): k is string => typeof k === 'string') : [];
  });
}

async function currentKey(page: Page): Promise<string> {
  const b = box(page);
  if ((await b.count()) === 0 || !(await b.isVisible())) return 'none';
  return (await b.getAttribute('data-key')) ?? 'none';
}

/**
 * Advances exactly one line: completes the typing if needed, waits until the engine is ready, clicks,
 * then waits until the displayed line actually changes.
 */
export async function next(page: Page): Promise<void> {
  const b = box(page);
  await expect(b).toBeVisible();
  const key = await b.getAttribute('data-key');
  if ((await b.getAttribute('data-typed')) !== '1') await game(page).click(CLICK);
  await expect(b).toHaveAttribute('data-key', key ?? '');
  await expect(b).toHaveAttribute('data-typed', '1');
  await expect(b).toHaveAttribute('data-ready', '1');
  await game(page).click(CLICK);
  await expect.poll(() => currentKey(page)).not.toBe(key);
}

/** Advances lines until the cross-examination bar is shown. */
export async function untilCrossExam(page: Page, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await expect(box(page).or(page.getByTestId('ce-bar')).first()).toBeVisible();
    if (await page.getByTestId('ce-bar').isVisible()) return;
    await next(page);
  }
  throw new Error('cross-examination not reached');
}

/** Advances lines until the ending screen is shown. */
export async function untilEnded(page: Page, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await page.getByTestId('ended').isVisible()) return;
    if (await box(page).isVisible()) await next(page);
    else await page.waitForTimeout(50);
  }
  await expect(page.getByTestId('ended')).toBeVisible();
}

export async function present(page: Page, item: string): Promise<void> {
  await page.getByTestId('ce-present').click();
  await expect(page.getByTestId('court-record')).toHaveAttribute('data-mode', 'present');
  await page.getByTestId(`record-item-${item}`).click();
  await page.getByTestId('record-present').click();
}
