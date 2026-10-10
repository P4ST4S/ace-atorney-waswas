import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { wasWasAssets } from './scripts/vite-asset-plugin.ts';

// Asset hosting is chosen by VITE_ASSET_BASE_URL (unset: local; `--mode remote` loads .env.remote), never by `base`.
export default defineConfig({
  plugins: [react(), tailwindcss(), wasWasAssets()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'asset-meta/**/*.test.ts', 'tests/support/**/*.test.ts'],
    environment: 'node',
  },
});
