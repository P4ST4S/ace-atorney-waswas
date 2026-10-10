/**
 * Checks a published release through its public URL only, without credentials (see docs/DEPLOYMENT_R2.md).
 *
 *   pnpm assets:verify [--release <release>] [--base <url>] [--origin <origin>]... [--skip-cors]
 *
 * Defaults: the release of public/generated/manifest.json, VITE_ASSET_BASE_URL from .env.remote, and the
 * origins of deploy/r2/cors.json. Checks the release index (completeness marker), every file (status, size,
 * Content-Type, Cache-Control) and CORS: GET with each Origin as Howler's XHR does, preflight with Range, and
 * refusal of an unlisted origin. Exits with code 1 on any problem.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { MANIFEST_FILE, parseAssetBaseUrl, validateRelease } from '../asset-meta/release-layout.ts';
import { checkCors, checkPublicFiles, corsOrigins, fetchPublishedIndex, readCorsPolicy, resilientFetch } from './lib/public-check.ts';
import { parseManifest } from './lib/release.ts';

const ROOT = join(import.meta.dirname, '..');

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      release: { type: 'string' },
      base: { type: 'string' },
      origin: { type: 'string', multiple: true },
      'skip-cors': { type: 'boolean', default: false },
    },
  });
  const source = parseAssetBaseUrl(values.base ?? process.env.VITE_ASSET_BASE_URL);
  if (source.kind !== 'remote') throw new Error('No asset base URL: pass --base or set VITE_ASSET_BASE_URL (.env.remote).');
  const release = validateRelease(values.release ?? parseManifest(readFileSync(join(ROOT, 'public', 'generated', MANIFEST_FILE), 'utf8')).release);
  console.log(`Checking release ${release} on ${source.base}`);
  const http = resilientFetch(fetch);

  const index = await fetchPublishedIndex(source.base, release, http);
  if (index === null) throw new Error(`Release ${release} is not published (no release.json): run \`pnpm assets:upload\`.`);
  if (index.release !== release) throw new Error(`release.json describes release ${index.release}.`);
  const problems = await checkPublicFiles(source.base, index, http);
  console.log(`Files: ${index.files.length} checked, ${problems.length} problem(s)`);

  if (!values['skip-cors']) {
    const origins = values.origin ?? corsOrigins(readCorsPolicy(join(ROOT, 'deploy', 'r2', 'cors.json')));
    const corsProblems = await checkCors(source.base, index, origins, http);
    console.log(`CORS: ${origins.join(', ')} -> ${corsProblems.length} problem(s)`);
    problems.push(...corsProblems);
  }
  if (problems.length > 0) throw new Error(`\n  ${problems.join('\n  ')}`);
  console.log(`Release ${release} OK.`);
}

main().catch((error: unknown) => {
  console.error(`assets:verify failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
