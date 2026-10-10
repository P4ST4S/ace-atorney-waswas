import { defineConfig, devices } from '@playwright/test';

/** Local assets: the Vite dev server serves public/generated/. */
const LOCAL_PORT = 5199;
/** Remote assets: a remote-mode production build (preview); this origin is allowed by deploy/r2/cors.json. */
const REMOTE_PORT = 5198;
/** Stand-in for the public R2 bucket (tests/support/r2-emulator.ts). */
const EMULATOR = 'http://localhost:5299/';
const REMOTE_DIST = 'node_modules/.e2e/remote-dist';
const NODE = 'node --experimental-strip-types --no-warnings=ExperimentalWarning';
const CHROME = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  // A single worker: some tests measure frame timing, which parallel workers would distort.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'local',
      use: { ...CHROME, baseURL: `http://localhost:${LOCAL_PORT}` },
      metadata: { assetMode: 'local', assetBase: `http://localhost:${LOCAL_PORT}/generated/` },
    },
    {
      // Same game, assets on another origin: URLs, release prefix, CORS for Web Audio, no assets in dist/.
      name: 'remote-emulated',
      testMatch: /(smoke|slice|assets)\.spec\.ts/,
      use: { ...CHROME, baseURL: `http://localhost:${REMOTE_PORT}` },
      metadata: { assetMode: 'remote', assetBase: `${EMULATOR}releases/` },
    },
  ],
  // Started in order: the remote build checks that its release is published on the emulator.
  webServer: [
    {
      command: `${NODE} tests/support/r2-emulator-cli.ts --port 5299`,
      url: `${EMULATOR}__health`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm dev --port ${LOCAL_PORT} --strictPort`,
      url: `http://localhost:${LOCAL_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite build --mode remote --outDir ${REMOTE_DIST} && pnpm exec vite preview --mode remote --outDir ${REMOTE_DIST} --port ${REMOTE_PORT} --strictPort`,
      url: `http://localhost:${REMOTE_PORT}`,
      env: { VITE_ASSET_BASE_URL: EMULATOR },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
