import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { extractArchive, listArchive, readArchiveEntry } from './archive.mjs';
import { PROJECT_ROOT } from './paths.mjs';
import { runCommand } from './process.mjs';
import { sha256File } from './security.mjs';

export async function checkSharedCopies() {
  const pairs = [
    ['shared/game-core.js', 'vscode/media/game-core.js'],
    ['shared/game-core.js', 'pycharm/src/main/resources/game-core.js'],
    ['shared/game-ui.js', 'vscode/media/game-ui.js'],
    ['shared/game-ui.js', 'pycharm/src/main/resources/game-ui.js']
  ];
  for (const [expected, actual] of pairs) {
    assert.deepEqual(
      await readFile(resolve(PROJECT_ROOT, actual)),
      await readFile(resolve(PROJECT_ROOT, expected)),
      `${actual} must match ${expected}`
    );
  }
  return { detail: `Verified ${pairs.length} shared resource copies.` };
}

export async function checkIdeStarted({ preparation }) {
  if (!preparation?.pid) throw new Error('IDE launch did not return a process ID');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!processIsAlive(preparation.pid)) throw new Error('IDE process exited during startup');
    if (await containsLogFile(preparation.logRoot)) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 2_000));
      if (!processIsAlive(preparation.pid)) throw new Error('IDE process exited immediately after creating its startup log');
      return { detail: 'Real IDE process started and wrote an isolated startup log.' };
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000));
  }
  throw new Error('IDE did not create an isolated startup log within 30 seconds');
}

export async function runVsCodeUnitTests() {
  const testRoot = resolve(PROJECT_ROOT, 'vscode', 'test');
  const tests = (await readdir(testRoot))
    .filter(name => name.endsWith('.test.js'))
    .sort()
    .map(name => resolve(testRoot, name));
  const { stdout } = await runCommand(process.execPath, ['--test', ...tests], {
    cwd: resolve(PROJECT_ROOT, 'vscode')
  });
  const match = stdout.match(/tests\s+(\d+)/);
  return { detail: `VS Code unit suite passed${match ? ` (${match[1]} tests)` : ''}.` };
}

export async function checkVsCodeArtifact() {
  const manifest = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'vscode', 'package.json'), 'utf8'));
  const artifact = resolve(PROJECT_ROOT, 'dist', `linuxdo-guest-browser-vscode-${manifest.version}.vsix`);
  const packaged = JSON.parse(await readArchiveEntry(artifact, 'extension/package.json'));
  assert.equal(packaged.version, manifest.version);
  assert.equal(packaged.engines?.vscode, manifest.engines?.vscode);
  assert.equal(packaged.publisher, manifest.publisher);
  const entries = await listArchive(artifact);
  for (const required of ['extension/src/extension.js', 'extension/media/main.js', 'extension/LICENSE.txt']) {
    assert.ok(entries.includes(required), `${required} missing from ${basename(artifact)}`);
  }
  return {
    detail: `VSIX ${manifest.version} matches the source manifest.`,
    artifact,
    pluginVersion: manifest.version,
    pluginSha256: await sha256File(artifact)
  };
}

export async function checkPyCharmArtifact() {
  const descriptorPath = resolve(PROJECT_ROOT, 'pycharm', 'src', 'main', 'resources', 'META-INF', 'plugin.xml');
  const descriptor = await readFile(descriptorPath, 'utf8');
  const version = capture(descriptor, /<version>([^<]+)<\/version>/, 'plugin version');
  const sinceBuild = capture(descriptor, /since-build="([^"]+)"/, 'since-build');
  const untilBuild = capture(descriptor, /until-build="([^"]+)"/, 'until-build');
  const buildScript = await readFile(resolve(PROJECT_ROOT, 'pycharm', 'build.gradle.kts'), 'utf8');
  assert.match(buildScript, new RegExp(`version\\s*=\\s*"${escapeRegExp(version)}"`));
  assert.match(buildScript, new RegExp(`sinceBuild\\.set\\("${escapeRegExp(sinceBuild)}"\\)`));
  assert.match(buildScript, new RegExp(`untilBuild\\.set\\("${escapeRegExp(untilBuild)}"\\)`));

  const artifact = resolve(PROJECT_ROOT, 'dist', `linuxdo-guest-browser-pycharm-${version}.zip`);
  const outerEntries = await listArchive(artifact);
  const jarEntry = 'LinuxDoGuestBrowser/lib/linuxdo-guest-browser.jar';
  assert.ok(outerEntries.includes(jarEntry), `${jarEntry} missing from ${basename(artifact)}`);
  const requiredOuter = ['LinuxDoGuestBrowser/THIRD_PARTY_NOTICES.md'];
  for (const required of requiredOuter) assert.ok(outerEntries.includes(required), `${required} missing`);

  const temporary = await mkdtemp(resolve(tmpdir(), 'linuxdo-pycharm-package-'));
  try {
    await extractArchive(artifact, temporary);
    const jar = resolve(temporary, jarEntry);
    const jarEntries = await listArchive(jar);
    const requiredInner = [
      'META-INF/plugin.xml',
      'break-overlay.js',
      'game-core.js',
      'game-ui.js',
      'reader-mode.css',
      'reader-mode.js',
      'studio/lexiao/linuxdo/LinuxDoToolWindowFactory.class',
      'studio/lexiao/linuxdo/ReaderHistory.class',
      'studio/lexiao/linuxdo/ShareCode.class'
    ];
    for (const required of requiredInner) assert.ok(jarEntries.includes(required), `${required} missing from plugin JAR`);
    const packagedDescriptor = await readArchiveEntry(jar, 'META-INF/plugin.xml');
    assert.equal(capture(packagedDescriptor, /<version>([^<]+)<\/version>/, 'packaged plugin version'), version);
    assert.equal(capture(packagedDescriptor, /since-build="([^"]+)"/, 'packaged since-build'), sinceBuild);
    assert.equal(capture(packagedDescriptor, /until-build="([^"]+)"/, 'packaged until-build'), untilBuild);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    detail: `PyCharm ZIP ${version} declares builds ${sinceBuild}-${untilBuild} and passed package verification.`,
    artifact,
    pluginVersion: version,
    pluginSha256: await sha256File(artifact),
    sinceBuild,
    untilBuild
  };
}

function capture(value, pattern, label) {
  const match = value.match(pattern);
  assert.ok(match, `Could not read ${label}`);
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function containsLogFile(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(?:log|txt)$/i.test(entry.name)) return true;
    if (entry.isDirectory() && await containsLogFile(resolve(root, entry.name))) return true;
  }
  return false;
}
