import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ARTIFACTS_ROOT } from './paths.mjs';
import { assertSafeContent, inspectEvidence } from './security.mjs';

const INTERESTING = /linuxdo|linux do|studio\.lexiao|LinuxDoGuestBrowser|PluginException|NoClassDef|NoSuchMethod|extension host|\bERROR\b|Exception/i;
const FATAL = /PluginException|NoClassDef|NoSuchMethod|linkageerror|failed to (?:load|activate)|activation.*failed/i;

export async function collectLogSummary(logRoot, runId) {
  const files = await findLogs(logRoot);
  if (!files.length) return null;
  const selected = files.slice(-20);
  const output = [];
  let fatalCount = 0;
  for (const path of selected) {
    let content;
    try {
      content = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/).filter(line => INTERESTING.test(line)).slice(-200);
    if (!lines.length) continue;
    output.push(`## ${basename(path)}`, ...lines.map(sanitizeLine), '');
    fatalCount += lines.filter(line => FATAL.test(line)).length;
  }
  if (!output.length) return { filesScanned: selected.length, fatalCount: 0, evidence: null };
  const content = `${output.join('\n')}\n`;
  assertSafeContent(content, 'generated IDE log summary');
  const directory = resolve(ARTIFACTS_ROOT, runId);
  const path = resolve(directory, 'ide-log-summary.txt');
  await mkdir(directory, { recursive: true });
  await writeFile(path, content, 'utf8');
  const evidence = await inspectEvidence(path);
  return {
    filesScanned: selected.length,
    fatalCount,
    evidence: { fileName: basename(path), bytes: evidence.bytes, sha256: evidence.sha256, url: null }
  };
}

async function findLogs(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const paths = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) paths.push(...await findLogs(path));
    else if (/\.(?:log|txt)$/i.test(entry.name)) paths.push(path);
  }
  return paths.sort();
}

function sanitizeLine(line) {
  return line
    .replace(/(?:cookie|authorization)\s*:[^\r\n]*/ig, '[REDACTED HEADER]')
    .replace(/(cf_clearance|_forum_session)=[^;\s]+/ig, '$1=[REDACTED]')
    .replace(/Mozilla\/5\.0[^\r\n]*/ig, '[REDACTED USER AGENT]');
}
