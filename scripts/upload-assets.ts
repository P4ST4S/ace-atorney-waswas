/**
 * Publishes the generated release to Cloudflare R2 (see docs/DEPLOYMENT_R2.md).
 *
 *   pnpm assets:upload [--dry-run] [--concurrency N]
 *
 * Credentials come from the environment (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET), or
 * from the git-ignored r2.env file (see r2.env.example). They are never printed.
 * Objects go to `releases/<release>/<path>`; existing identical objects are skipped, nothing is overwritten or
 * deleted, and `release.json` is uploaded last once the release is complete. Then the release is checked
 * through its public URL (VITE_ASSET_BASE_URL from .env.remote), CORS included.
 *
 * --dry-run never writes: without credentials it prints the plan, with credentials it also compares with the bucket.
 */
import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ReleaseFile } from '../asset-meta/manifest-types.ts';
import { parseAssetBaseUrl, releaseKey } from '../asset-meta/release-layout.ts';
import { checkCors, checkPublicFiles, corsOrigins, fetchPublishedIndex, readCorsPolicy, resilientFetch } from './lib/public-check.ts';
import { assertPublicSafe, readLocalRelease } from './lib/release.ts';
import { describeError, httpStatus, uploadRelease, type ObjectStore } from './lib/upload-core.ts';

const ROOT = join(import.meta.dirname, '..');
const GENERATED = join(ROOT, 'public', 'generated');
const CORS_POLICY = join(ROOT, 'deploy', 'r2', 'cors.json');

interface R2Config {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly endpoint: string;
  readonly bucket: string;
}

const REQUIRED = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'] as const;

/** Reads the R2 settings; errors only ever mention variable names, never their values. */
function readR2Config(env: NodeJS.ProcessEnv): R2Config | { readonly missing: readonly string[] } {
  const missing = REQUIRED.filter((name) => (env[name]?.trim() ?? '') === '');
  if (missing.length > 0) return { missing };
  const endpointRaw = env.R2_ENDPOINT?.trim() ?? '';
  const bucket = env.R2_BUCKET?.trim() ?? '';
  let endpoint: URL;
  try {
    endpoint = new URL(endpointRaw);
  } catch {
    throw new Error('R2_ENDPOINT is not a URL (expected https://<account-id>.r2.cloudflarestorage.com).');
  }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('R2_ENDPOINT must be https://<account-id>.r2.cloudflarestorage.com.');
  }
  if (endpoint.pathname !== '/' || endpoint.search !== '') {
    throw new Error(`R2_ENDPOINT must not contain a path${endpoint.pathname.includes(bucket) ? ' (the bucket name goes in R2_BUCKET only)' : ''}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('R2_BUCKET is not a valid bucket name.');
  // Optional consistency checks (r2.env.example): they catch a mismatched account or a non-R2 region.
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? '';
  if (accountId !== '' && endpoint.hostname.split('.')[0] !== accountId) throw new Error('R2_ENDPOINT does not belong to R2_ACCOUNT_ID.');
  const region = env.R2_REGION?.trim() ?? '';
  if (region !== '' && region !== 'auto') throw new Error('R2_REGION must be "auto" on R2.');
  return { accessKeyId: env.R2_ACCESS_KEY_ID?.trim() ?? '', secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim() ?? '', endpoint: endpoint.origin, bucket };
}

/** ObjectStore over the S3-compatible API of R2. The bucket is passed per request, never in the endpoint. */
function r2Store(config: R2Config): ObjectStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 does not support every flexible checksum; integrity is covered by Content-MD5 and our SHA-256.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // Retries are handled (and logged) by upload-core's withRetry.
    maxAttempts: 1,
  });
  const Bucket = config.bucket;
  return {
    async head(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: head.ContentLength ?? -1, sha256: head.Metadata?.sha256, contentType: head.ContentType, cacheControl: head.CacheControl };
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
    async putIfAbsent(request) {
      try {
        await client.send(new PutObjectCommand({
          Bucket,
          Key: request.key,
          Body: request.body,
          ContentLength: request.body.byteLength,
          ContentType: request.contentType,
          CacheControl: request.cacheControl,
          ContentMD5: request.md5Base64,
          Metadata: { sha256: request.sha256 },
          IfNoneMatch: '*',
        }));
        return 'created';
      } catch (error) {
        if (httpStatus(error) === 412) return 'exists';
        throw error;
      }
    },
    async list(prefix) {
      const objects: { key: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents ?? []) if (object.Key !== undefined) objects.push({ key: object.Key, size: object.Size ?? -1 });
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return objects;
    },
  };
}

function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false }, concurrency: { type: 'string', default: '4' } } });
  const dryRun = values['dry-run'];
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('--concurrency must be an integer between 1 and 16.');

  const local = readLocalRelease(GENERATED);
  assertPublicSafe(local.index);
  const { release, files } = local.index;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  console.log(`Release ${release}: ${files.length} files + release.json, ${megabytes(total)}${dryRun ? ' (dry run: nothing is written)' : ''}`);

  const config = readR2Config(process.env);
  if ('missing' in config) {
    if (!dryRun) throw new Error(`Missing ${config.missing.join(', ')}: set them in the environment or in r2.env (see r2.env.example).`);
    console.log(`Credentials not set (${config.missing.join(', ')}): remote state not checked. Planned objects:`);
    for (const file of files) console.log(`  ${releaseKey(release, file.path)}  ${file.contentType}  ${file.size} B`);
    console.log(`  ${releaseKey(release, 'release.json')}  application/json  (uploaded last)`);
    return;
  }
  console.log(`Bucket ${config.bucket} on ${new URL(config.endpoint).host}, concurrency ${concurrency}`);

  const report = await uploadRelease(r2Store(config), local.index, {
    dryRun,
    concurrency,
    indexText: local.indexText,
    readFile: (file: ReleaseFile) => readFile(join(GENERATED, ...file.path.split('/'))),
    log: (line) => { console.log(line); },
  });
  if (dryRun) {
    console.log(`Dry run: ${report.pending.length} to upload, ${report.skipped.length} unchanged; release marker ${report.marker === 'present' ? 'already published' : 'not published yet'}.`);
    return;
  }
  console.log(`Release ${release} complete on the bucket: ${report.uploaded.length} uploaded, ${report.skipped.length} unchanged, marker ${report.marker}.`);
  await publicCheck(release);
}

/** Checks the release as browsers will see it. Missing public files fail; CORS problems only warn. */
async function publicCheck(release: string): Promise<void> {
  const source = parseAssetBaseUrl(process.env.VITE_ASSET_BASE_URL ?? process.env.R2_PUBLIC_BASE_URL);
  if (source.kind !== 'remote') {
    console.warn('VITE_ASSET_BASE_URL is not set (.env.remote): public check skipped.');
    return;
  }
  const declared = parseAssetBaseUrl(process.env.R2_PUBLIC_BASE_URL);
  if (declared.kind === 'remote' && declared.base !== source.base) {
    console.warn(`R2_PUBLIC_BASE_URL (${declared.base}) differs from VITE_ASSET_BASE_URL (${source.base}); the frontend uses the latter.`);
  }
  const http = resilientFetch(fetch);
  const index = await fetchPublishedIndex(source.base, release, http);
  if (index === null) throw new Error(`The release index is not readable at ${source.base}: is public access enabled on the bucket?`);
  const fileProblems = await checkPublicFiles(source.base, index, http);
  if (fileProblems.length > 0) throw new Error(`Public check failed on ${source.base}:\n  ${fileProblems.join('\n  ')}`);
  console.log(`Public URL OK: ${index.files.length} files readable under ${source.base}releases/${release}/`);
  const corsProblems = await checkCors(source.base, index, corsOrigins(readCorsPolicy(CORS_POLICY)), http);
  if (corsProblems.length > 0) {
    console.warn(`CORS is not (fully) applied yet, sound effects would fall back to HTML5 audio:\n  ${corsProblems.join('\n  ')}`);
    console.warn('Apply deploy/r2/cors.json to the bucket (docs/DEPLOYMENT_R2.md), then run `pnpm assets:verify`.');
  } else {
    console.log('CORS OK for every origin of deploy/r2/cors.json.');
  }
}

main().catch((error: unknown) => {
  console.error(`assets:upload failed: ${describeError(error)}`);
  process.exitCode = 1;
});
