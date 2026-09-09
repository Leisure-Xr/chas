import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, flag, option, options } from '../src/args.mjs';
import { defineCase } from '../src/case-definition.mjs';
import { renderCaseCatalog } from '../src/docs.mjs';
import { resolvePyCharmTarget, resolveVsCodeTarget } from '../src/resolve-matrix.mjs';
import { assertSafeContent, findSensitiveContent } from '../src/security.mjs';
import { compareVersions, latestVersion, matchesLine } from '../src/versions.mjs';
import { assertReleaseId } from '../src/identifiers.mjs';
import { validateCases, validateLock, validateRunRecord } from '../src/validate.mjs';
import { hasSourceChanges } from '../src/run-suite.mjs';

test('CLI parser supports repeated options, flags and equals syntax', () => {
  const parsed = parseArguments(['resolve', '--target', 'vscode-1.85', '--target=vscode-1.114', '--all']);
  assert.equal(parsed.command, 'resolve');
  assert.deepEqual(options(parsed.options, 'target'), ['vscode-1.85', 'vscode-1.114']);
  assert.equal(option(parsed.options, 'target'), 'vscode-1.114');
  assert.equal(flag(parsed.options, 'all'), true);
});

test('release identifiers cannot escape the run-record directory', () => {
  assert.equal(assertReleaseId('0.2.0-rc.1'), '0.2.0-rc.1');
  assert.throws(() => assertReleaseId('../outside'), /Release identifier/);
  assert.throws(() => assertReleaseId('/absolute'), /Release identifier/);
});

test('new run records do not mark otherwise clean source as dirty', () => {
  assert.equal(hasSourceChanges('?? linuxdo-guest-browser/qa/runs/0.2.0/run.json\n'), false);
  assert.equal(hasSourceChanges(' M linuxdo-guest-browser/vscode/src/extension.js\n'), true);
});

test('numeric IDE versions sort without lexicographic mistakes', () => {
  assert.equal(compareVersions('1.114.0', '1.99.9'), 1);
  assert.equal(compareVersions('2026.1.4', '2024.2.5'), 1);
  assert.equal(latestVersion(['1.85.2', '1.85.10', '1.85.3']), '1.85.10');
  assert.equal(matchesLine('2022.3.3', '2022.3'), true);
  assert.equal(matchesLine('2023.1', '2022.3'), false);
});

test('VS Code resolver selects the latest patch and stable archive names', () => {
  const resolved = resolveVsCodeTarget(
    { id: 'vscode-1.85', product: 'vscode', line: '1.85', role: 'minimum' },
    ['1.86.0', '1.85.2', '1.85.10']
  );
  assert.equal(resolved.version, '1.85.10');
  assert.equal(resolved.downloads['darwin-arm64'].fileName, 'vscode-1.85.10-darwin-arm64.zip');
  assert.match(resolved.downloads['win32-x64'].url, /win32-x64-archive/);
});

test('PyCharm resolver stays inside declared build range and records checksums', async () => {
  const checksum = 'a'.repeat(64);
  const response = { PCP: [
    release('2026.3.1', '263.99', checksum),
    release('2026.4', '264.1', 'b'.repeat(64)),
    release('2026.3.2', '263.100', checksum)
  ] };
  const resolved = await resolvePyCharmTarget(
    { id: 'pycharm-latest', product: 'pycharm', line: 'latest', role: 'latest' },
    response,
    async () => ({ ok: true, text: async () => `${checksum}  pycharm.dmg` })
  );
  assert.equal(resolved.version, '2026.3.2');
  assert.equal(resolved.build, '263.100');
  assert.equal(resolved.downloads['darwin-arm64'].sha256, checksum);
});

test('evidence scanner rejects visitor credentials and full user agents', () => {
  assert.deepEqual(findSensitiveContent('harmless screenshot note'), []);
  assert.throws(() => assertSafeContent('cookie: cf_clearance=secret'), /sensitive data/);
  assert.throws(() => assertSafeContent('Mozilla/5.0 (Macintosh) AppleWebKit Chrome/130.0.0.0'), /User-Agent/);
});

test('case validation rejects duplicate IDs and generated docs come from code', () => {
  const sample = defineCase({
    id: 'VSC-999', title: 'Sample', product: 'vscode', priority: 'P0', type: 'guided',
    steps: [{ action: 'Act', expected: 'Expected' }], expected: 'Done'
  });
  assert.match(renderCaseCatalog([sample]), /VSC-999 Sample/);
  assert.throws(() => validateCases([sample, sample]), /Duplicate/);
});

test('lock and run schemas reject incomplete release evidence', () => {
  assert.throws(() => validateLock({ schemaVersion: 1, targets: [] }), /ide-lock targets/);
  const record = {
    schemaVersion: 1,
    runId: 'run', release: 'rc', commit: 'abc', workingTreeDirty: false, product: 'vscode',
    matrixTarget: 'vscode-latest', platform: 'darwin', arch: 'arm64',
    ide: { version: '1.136.1' }, plugin: { version: '0.18.0', sha256: 'a'.repeat(64) },
    results: [{ caseId: 'VSC-003', type: 'guided', priority: 'P0', status: 'PASS', durationMs: 1, note: 'ok', evidence: [] }]
  };
  assert.throws(() => validateRunRecord(record), /guided PASS needs evidence/);
});

function release(version, build, checksum) {
  const download = {
    link: `https://download.example/pycharm-${version}.dmg`,
    checksumLink: `https://download.example/pycharm-${version}.dmg.sha256`
  };
  return { version, build, downloads: { macM1: download, mac: download, windows: download }, checksum };
}
