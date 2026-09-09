import { basename } from 'node:path';
import { LOCK_PATH } from './paths.mjs';
import { readJson, writeJson } from './json-file.mjs';
import { MATRIX_TARGETS, matrixTarget } from './matrix-targets.mjs';
import { latestVersion, matchesLine } from './versions.mjs';

const VSCODE_RELEASES_URL = 'https://update.code.visualstudio.com/api/releases/stable';
const PYCHARM_RELEASES_URL = 'https://data.services.jetbrains.com/products/releases?code=PCP&latest=false&type=release';

export async function resolveMatrix(targetIds, fetchImpl = fetch) {
  if (!targetIds.length) throw new Error('resolve requires at least one --target, or --all');
  const unknown = targetIds.filter(id => !matrixTarget(id));
  if (unknown.length) throw new Error(`Unknown matrix target: ${unknown.join(', ')}`);

  const lock = await readJson(LOCK_PATH);
  let vscodeReleases;
  let pycharmReleases;
  for (const id of targetIds) {
    const target = matrixTarget(id);
    let resolved;
    if (target.product === 'vscode') {
      vscodeReleases ||= await fetchJson(fetchImpl, VSCODE_RELEASES_URL);
      resolved = resolveVsCodeTarget(target, vscodeReleases);
    } else {
      pycharmReleases ||= await fetchJson(fetchImpl, PYCHARM_RELEASES_URL);
      resolved = await resolvePyCharmTarget(target, pycharmReleases, fetchImpl);
    }
    const index = lock.targets.findIndex(entry => entry.id === id);
    lock.targets[index] = resolved;
  }
  lock.resolvedAt = new Date().toISOString();
  await writeJson(LOCK_PATH, lock);
  return lock;
}

export function resolveVsCodeTarget(target, releases) {
  const versions = releases.filter(version => matchesLine(version, target.line));
  const version = latestVersion(versions);
  if (!version) throw new Error(`No stable VS Code release found for ${target.line}`);
  return {
    ...target,
    status: 'resolved',
    version,
    build: null,
    downloads: {
      'darwin-arm64': download(`https://update.code.visualstudio.com/${version}/darwin-arm64/stable`, `vscode-${version}-darwin-arm64.zip`),
      'darwin-x64': download(`https://update.code.visualstudio.com/${version}/darwin/stable`, `vscode-${version}-darwin-x64.zip`),
      'win32-x64': download(`https://update.code.visualstudio.com/${version}/win32-x64-archive/stable`, `vscode-${version}-win32-x64.zip`)
    }
  };
}

export async function resolvePyCharmTarget(target, response, fetchImpl = fetch) {
  const releases = Array.isArray(response) ? response : response.PCP;
  if (!Array.isArray(releases)) throw new Error('JetBrains response did not contain PCP releases');
  const supported = releases.filter(release => {
    const buildMajor = Number(String(release.build || '').match(/^\d+/)?.[0]);
    return buildMajor >= 223 && buildMajor <= 263 && matchesLine(release.version, target.line);
  });
  const version = latestVersion(supported.map(release => release.version));
  const release = supported.find(entry => entry.version === version);
  if (!release) throw new Error(`No stable PyCharm release found for ${target.line}`);
  const sources = {
    'darwin-arm64': release.downloads?.macM1,
    'darwin-x64': release.downloads?.mac,
    'win32-x64': release.downloads?.windows
  };
  const downloads = {};
  for (const [platform, source] of Object.entries(sources)) {
    if (!source?.link) continue;
    downloads[platform] = download(source.link);
    downloads[platform].fileName = basename(new URL(source.link).pathname);
    downloads[platform].checksumUrl = source.checksumLink || null;
    if (source.checksumLink) {
      const checksum = await fetchText(fetchImpl, source.checksumLink);
      downloads[platform].sha256 = checksum.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase() || null;
    }
  }
  return { ...target, status: 'resolved', version, build: release.build, downloads };
}

function download(url, fileName) {
  return {
    url,
    fileName: fileName || basename(new URL(url).pathname) || 'download',
    checksumUrl: null,
    sha256: null
  };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { 'user-agent': 'linuxdo-guest-browser-qa/1.0' } });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response.json();
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { 'user-agent': 'linuxdo-guest-browser-qa/1.0' } });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response.text();
}

export function allTargetIds() {
  return MATRIX_TARGETS.map(target => target.id);
}
