/**
 * Starts the R2 emulator on the generated release (used by playwright.config.ts).
 *
 *   node --experimental-strip-types tests/support/r2-emulator-cli.ts [--port 5299]
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readCorsPolicy } from '../../scripts/lib/public-check.ts';
import { startR2Emulator } from './r2-emulator.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const { values } = parseArgs({ options: { port: { type: 'string', default: '5299' } } });

const emulator = await startR2Emulator({
  generatedDir: join(ROOT, 'public', 'generated'),
  policy: readCorsPolicy(join(ROOT, 'deploy', 'r2', 'cors.json')),
  port: Number(values.port),
});
console.log(`R2 emulator serving public/generated on ${emulator.url}releases/<release>/ (CORS: deploy/r2/cors.json)`);
