import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CACHE_ROOT, LOCK_PATH } from './paths.mjs';
import { readJson, updateJson } from './json-file.mjs';
import { runCommand } from './process.mjs';
import { inspectIde } from './environment.mjs';
import { sha256File } from './security.mjs';

export async function provisionTarget(targetId, platform = platformKey(), fetchImpl = fetch) {
  const lock = await readJson(LOCK_PATH);
  const target = lock.targets.find(entry => entry.id === targetId);
  if (!target) throw new Error(`Unknown matrix target: ${targetId}`);
  if (target.status !== 'resolved') throw new Error(`${targetId} must be resolved before provisioning`);
  const source = target.downloads?.[platform];
  if (!source?.url) throw new Error(`${targetId} has no download for ${platform}`);

  const downloadRoot = resolve(CACHE_ROOT, 'downloads', target.id);
  const installRoot = resolve(CACHE_ROOT, 'ides', target.id, platform);
  await mkdir(downloadRoot, { recursive: true });
  const archive = resolve(downloadRoot, safeFileName(source.fileName, source.url, target));
  const reusableSha256 = await reusableArchiveHash(target.product, source, archive);
  const actualSha256 = reusableSha256 || await downloadFile(source.url, archive, fetchImpl);
  if (source.sha256 && source.sha256 !== actualSha256) {
    throw new Error(`${targetId} checksum mismatch: expected ${source.sha256}, got ${actualSha256}`);
  }
  const updatedLock = await updateJson(LOCK_PATH, latest => {
    const latestTarget = latest.targets.find(entry => entry.id === targetId);
    if (!latestTarget || latestTarget.version !== target.version) {
      throw new Error(`${targetId} changed while provisioning; resolve and retry`);
    }
    const latestSource = latestTarget.downloads?.[platform];
    if (!latestSource || latestSource.url !== source.url) {
      throw new Error(`${targetId}/${platform} download changed while provisioning`);
    }
    latestSource.sha256 = actualSha256;
    latestSource.fileName = basename(archive);
    latestSource.verifiedAt = new Date().toISOString();
    return latest;
  });
  const updatedTarget = updatedLock.targets.find(entry => entry.id === targetId);

  await rm(installRoot, { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });
  const idePath = await installIde(target.product, archive, installRoot);
  const ide = await inspectIde(target.product, idePath);
  if (ide.version !== target.version) {
    throw new Error(`Provisioned ${ide.version}, but ${target.id} is locked to ${target.version}`);
  }
  return { target: updatedTarget, platform, archive, ide, sha256: actualSha256 };
}

export function platformKey() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32') return `win32-${process.arch}`;
  throw new Error(`Real IDE provisioning is not configured for ${process.platform}`);
}

export async function downloadFile(url, destination, fetchImpl) {
  if (fetchImpl === fetch && process.env.LINUXDO_QA_NODE_DOWNLOAD !== '1') {
    const existingBytes = await fileSize(destination);
    const hasAriaControl = await fileSize(`${destination}.aria2`) > 0;
    if (existingBytes === 0 || hasAriaControl) {
      try {
        await runCommand('aria2c', [
          '--continue=true',
          '--max-connection-per-server=8',
          '--split=8',
          '--min-split-size=1M',
          '--max-tries=5',
          '--retry-wait=1',
          '--connect-timeout=30',
          '--summary-interval=0',
          '--console-log-level=warn',
          '--dir', dirname(destination),
          '--out', basename(destination),
          url
        ]);
        return sha256File(destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    try {
      await runCommand('curl', [
        '--fail',
        '--location',
        '--retry', '4',
        '--retry-all-errors',
        '--connect-timeout', '30',
        '--continue-at', '-',
        '--output', destination,
        url
      ]);
      return sha256File(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existingBytes = await fileSize(destination);
    const headers = { 'user-agent': 'linuxdo-guest-browser-qa/1.0' };
    if (existingBytes > 0) headers.range = `bytes=${existingBytes}-`;
    try {
      const response = await fetchImpl(url, { redirect: 'follow', headers });
      if (response.status === 416 && existingBytes > 0) return sha256File(destination);
      if (!response.ok || !response.body) throw new Error(`GET ${url} returned HTTP ${response.status}`);
      const append = existingBytes > 0 && response.status === 206;
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(destination, { flags: append ? 'a' : 'w' })
      );
      return sha256File(destination);
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function reusableArchiveHash(product, source, path) {
  if (await fileSize(path) === 0) return null;
  const hash = await sha256File(path);
  if (source.sha256) return source.sha256 === hash ? hash : null;
  if (product !== 'vscode') return null;
  try {
    await runCommand('tar', ['-tf', path]);
    return hash;
  } catch {
    return null;
  }
}

async function installIde(product, archive, destination) {
  const extension = extname(archive).toLowerCase();
  if (extension === '.zip') {
    await runCommand('tar', ['-xf', archive, '-C', destination]);
    return findInstalledRoot(product, destination);
  }
  if (extension === '.dmg' && process.platform === 'darwin') {
    const mount = resolve(destination, 'mounted');
    await mkdir(mount, { recursive: true });
    await runCommand('hdiutil', ['attach', archive, '-nobrowse', '-readonly', '-mountpoint', mount]);
    try {
      const app = (await readdir(mount)).find(name => name.endsWith('.app'));
      if (!app) throw new Error(`No .app bundle found in ${archive}`);
      const installed = resolve(destination, app);
      await runCommand('ditto', [resolve(mount, app), installed]);
      return installed;
    } finally {
      await runCommand('hdiutil', ['detach', mount]);
    }
  }
  if (extension === '.exe' && process.platform === 'win32') {
    const installed = resolve(destination, 'PyCharm');
    await runCommand(archive, ['/S', `/D=${installed}`]);
    return installed;
  }
  throw new Error(`Unsupported IDE package: ${archive}`);
}

async function findInstalledRoot(product, directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = resolve(directory, entry.name);
    try {
      await inspectIde(product, candidate);
      return candidate;
    } catch {
      // Continue through the single archive wrapper directory.
    }
    const children = await readdir(candidate, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const nested = resolve(candidate, child.name);
      try {
        await inspectIde(product, nested);
        return nested;
      } catch {
        // Not an IDE root.
      }
    }
  }
  throw new Error(`No ${product} installation found under ${directory}`);
}

function safeFileName(fileName, url, target) {
  const preferred = fileName && fileName !== 'stable' && fileName !== 'download'
    ? basename(fileName)
    : `${target.id}${archiveSuffix(url, target.product)}`;
  const safe = preferred.replace(/[^a-zA-Z0-9._-]/g, '-');
  return safe && safe !== '.' && safe !== '..'
    ? safe
    : `${target.id}${archiveSuffix(url, target.product)}`;
}

function archiveSuffix(url, product) {
  const path = new URL(url).pathname.toLowerCase();
  for (const suffix of ['.tar.gz', '.dmg', '.zip', '.exe']) {
    if (path.endsWith(suffix)) return suffix;
  }
  return product === 'vscode' ? '.zip' : process.platform === 'darwin' ? '.dmg' : '.exe';
}
