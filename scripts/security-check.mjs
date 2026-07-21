import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'dist', 'playwright-report', 'test-results']);
const readable = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.env', '']);
const findings = [];
const patterns = [
  { name: 'Liveblocks secret key', regex: /sk_(?:prod|test)_[A-Za-z0-9_-]{24,}/g },
  { name: 'GitHub access token', regex: /gh[opusr]_[A-Za-z0-9]{30,}/g },
  { name: 'Private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Committed environment secret', regex: /(?:GITHUB_CLIENT_SECRET|SMARTLINE_SESSION_SECRET|LIVEBLOCKS_SECRET_KEY)\s*=\s*(?!your_|replace_|sk_test_your_)[^\s#]{12,}/g },
];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (readable.has(extname(entry.name)) || entry.name.startsWith('.env') || entry.name.startsWith('.dev.vars')) {
      const content = await readFile(path, 'utf8').catch(() => '');
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern.regex)) findings.push(`${relative(root, path)}: ${pattern.name} (${match[0].slice(0, 12)}…)`);
      }
    }
  }
}

await walk(root);
if (findings.length) {
  console.error(`发现可能提交的敏感信息：\n${findings.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('敏感信息检查通过。');
}
