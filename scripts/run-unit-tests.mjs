import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = readdirSync('tests', { recursive: true })
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`).sort();
if (!files.length) throw new Error('No unit tests found.');
const result = spawnSync(process.execPath,
  [fileURLToPath(import.meta.resolve('tsx/cli')), '--test', ...files],
  { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
