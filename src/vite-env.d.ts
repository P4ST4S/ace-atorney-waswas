/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Public base URL of the hosted game assets (e.g. the R2 bucket URL, see docs/DEPLOYMENT_R2.md).
   * Unset: assets are served locally from `public/generated/`. Never put secrets in `VITE_*` variables.
   */
  readonly VITE_ASSET_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
