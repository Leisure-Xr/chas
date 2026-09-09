import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

const SECRET_PATTERNS = [
  { name: 'Cookie header', pattern: /(?:^|[\r\n])\s*cookie\s*:/i },
  { name: 'Cloudflare clearance', pattern: /cf_clearance\s*=/i },
  { name: 'forum session', pattern: /_forum_session\s*=/i },
  { name: 'authorization header', pattern: /(?:^|[\r\n])\s*authorization\s*:/i },
  { name: 'bearer token', pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i },
  { name: 'full User-Agent', pattern: /Mozilla\/5\.0[^\r\n]{20,}/i }
];

export function findSensitiveContent(content) {
  return SECRET_PATTERNS
    .filter(entry => entry.pattern.test(String(content)))
    .map(entry => entry.name);
}

export function assertSafeContent(content, label = 'content') {
  const matches = findSensitiveContent(content);
  if (matches.length) {
    throw new Error(`${label} contains sensitive data: ${matches.join(', ')}`);
  }
}

export async function inspectEvidence(path) {
  const data = await readFile(path);
  const lowerPath = path.toLowerCase();
  if (/\.(?:txt|log|json|md|html|xml|csv)$/.test(lowerPath)) {
    assertSafeContent(data.toString('utf8'), path);
  }
  return {
    path,
    bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex')
  };
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
