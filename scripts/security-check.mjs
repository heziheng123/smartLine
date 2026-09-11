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
const responseHeaders = await readFile(join(root, 'public', '_headers'), 'utf8').catch(() => '');
for (const requiredHeader of [
  'Content-Security-Policy:',
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy:',
  'Permissions-Policy:',
  'X-Frame-Options: DENY',
]) {
  if (!responseHeaders.includes(requiredHeader)) findings.push(`public/_headers: missing ${requiredHeader}`);
}
const entryHtml = await readFile(join(root, 'index.html'), 'utf8').catch(() => '');
if (/\son[a-z]+\s*=/i.test(entryHtml)) findings.push('index.html: inline event handler bypasses the CSP policy');
const sanitizer = await readFile(join(root, 'src', 'utils', 'sanitize.ts'), 'utf8').catch(() => '');
const allowedAttrs = sanitizer.match(/ALLOWED_ATTR:\s*\[([^\]]*)\]/s)?.[1] ?? '';
if (/['"](?:style|class|id)['"]/.test(allowedAttrs)) {
  findings.push('src/utils/sanitize.ts: layout-capable attributes are allowed in remote rich text');
}
const allowedUriRule = sanitizer.match(/ALLOWED_URI_REGEXP:\s*(\/.*\/[a-z]*)/i)?.[1] ?? '';
if (/data:image/i.test(allowedUriRule)) {
  findings.push('src/utils/sanitize.ts: data images are allowed in remote rich text');
}
if (findings.length) {
  console.error(`发现可能提交的敏感信息：\n${findings.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('敏感信息检查通过。');
}
