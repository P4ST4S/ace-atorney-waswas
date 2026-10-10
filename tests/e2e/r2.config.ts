/**
 * Representative browser run against the real public R2 bucket (pnpm test:e2e:r2), after `pnpm assets:upload`
 * and once deploy/r2/cors.json is applied to the bucket (docs/DEPLOYMENT_R2.md). Builds the frontend in remote
 * mode (which checks that the release is published) and serves it on an origin allowed by the CORS policy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';
import { parseAssetBaseUrl } from '../../asset-meta/release-layout.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const PORT = 5198;
const DIST = 'node_modules/.e2e/r2-dist';
const source = parseAssetBaseUrl(process.env.VITE_ASSET_BASE_URL ?? parseEnv(readFileSync(join(ROOT, '.env.remote'), 'utf8')).VITE_ASSET_BASE_URL);
if (source.kind !== 'remote') throw new Error('.env.remote must define VITE_ASSET_BASE_URL.');

export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'remote-r2',
      testMatch: /(smoke|slice|assets)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, baseURL: `http://localhost:${PORT}` },
      metadata: { assetMode: 'remote', assetBase: `${source.base}releases/` },
    },
  ],
  webServer: {
    command: `pnpm exec vite build --mode remote --outDir ${DIST} && pnpm exec vite preview --mode remote --outDir ${DIST} --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
