import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { allCases } from './cases/index.mjs';
import { CASE_TYPES, PLATFORMS, PRIORITIES, PRODUCTS, RESULT_STATUSES } from './case-definition.mjs';
import { generatedDocsAreCurrent } from './docs.mjs';
import { LOCK_PATH, RUNS_ROOT } from './paths.mjs';
import { readJson } from './json-file.mjs';
import { MATRIX_TARGETS } from './matrix-targets.mjs';
import { assertSafeContent } from './security.mjs';
import { assertReleaseId } from './identifiers.mjs';

export async function validateRepository() {
  validateCases(allCases);
  const lock = await readJson(LOCK_PATH);
  validateLock(lock);
  assert.equal(await generatedDocsAreCurrent(), true, 'Generated QA docs are stale; run `node qa/bin/qa.mjs docs`');
  const records = await readRunRecords();
  for (const record of records) validateRunRecord(record);
  return {
    cases: allCases.length,
    runs: records.length,
    unresolvedTargets: lock.targets.filter(target => target.status !== 'resolved').map(target => target.id)
  };
}

export function validateCases(cases) {
  const ids = new Set();
  for (const testCase of cases) {
    assert.match(testCase.id || '', /^(?:SHR|VSC|PYC)-\d{3}$/);
    assert.ok(!ids.has(testCase.id), `Duplicate test case ID: ${testCase.id}`);
    ids.add(testCase.id);
    assert.ok(PRODUCTS.includes(testCase.product), `${testCase.id}: invalid product`);
    assert.ok(PRIORITIES.includes(testCase.priority), `${testCase.id}: invalid priority`);
    assert.ok(CASE_TYPES.includes(testCase.type), `${testCase.id}: invalid type`);
    assert.ok(testCase.title && testCase.expected, `${testCase.id}: title and expected are required`);
    assert.ok(testCase.platforms.length > 0 && testCase.platforms.every(value => PLATFORMS.includes(value)), `${testCase.id}: invalid platforms`);
    assert.ok(Array.isArray(testCase.capabilities) && Array.isArray(testCase.preconditions) && Array.isArray(testCase.steps));
    if (testCase.type === 'automated') assert.equal(typeof testCase.run, 'function', `${testCase.id}: automated case needs run()`);
    if (testCase.type === 'guided') {
      assert.ok(testCase.steps.length > 0, `${testCase.id}: guided case needs steps`);
      for (const step of testCase.steps) assert.ok(step.action && step.expected, `${testCase.id}: incomplete step`);
    }
  }
  for (const prefix of ['SHR', 'VSC', 'PYC']) {
    assert.ok(cases.some(entry => entry.id.startsWith(prefix) && entry.priority === 'P0'), `${prefix} requires P0 coverage`);
    assert.ok(cases.some(entry => entry.id.startsWith(prefix) && entry.priority === 'P1'), `${prefix} requires P1 coverage`);
  }
}

export function validateLock(lock) {
  assert.equal(lock.schemaVersion, 1);
  assert.ok(Array.isArray(lock.targets));
  assert.deepEqual(
    lock.targets.map(target => target.id).sort(),
    MATRIX_TARGETS.map(target => target.id).sort(),
    'ide-lock targets must match matrix-targets.mjs'
  );
  for (const target of lock.targets) {
    const definition = MATRIX_TARGETS.find(entry => entry.id === target.id);
    assert.equal(target.product, definition.product, `${target.id}: product drift`);
    assert.equal(target.line, definition.line, `${target.id}: line drift`);
    assert.equal(target.role, definition.role, `${target.id}: role drift`);
    assert.ok(['pending', 'observed-local', 'resolved'].includes(target.status), `${target.id}: invalid status`);
    if (target.status === 'resolved') {
      assert.ok(target.version && Object.keys(target.downloads || {}).length, `${target.id}: resolved target is incomplete`);
      for (const [platform, download] of Object.entries(target.downloads)) {
        assert.match(platform, /^(?:darwin|win32)-(?:arm64|x64)$/);
        assert.match(download.url || '', /^https:\/\//, `${target.id}/${platform}: download must use HTTPS`);
        if (download.sha256) assert.match(download.sha256, /^[a-f0-9]{64}$/, `${target.id}/${platform}: invalid SHA-256`);
      }
    }
  }
}

export function validateRunRecord(record) {
  assert.equal(record.schemaVersion, 1);
  assert.ok(record.runId && record.release && record.commit);
  assertReleaseId(record.release);
  assert.equal(typeof record.workingTreeDirty, 'boolean');
  assert.ok(['vscode', 'pycharm'].includes(record.product));
  const target = MATRIX_TARGETS.find(entry => entry.id === record.matrixTarget);
  assert.ok(target, `${record.runId}: unknown matrix target`);
  assert.equal(record.product, target.product, `${record.runId}: target product mismatch`);
  assert.ok(PLATFORMS.includes(record.platform));
  assert.ok(['arm64', 'x64'].includes(record.arch));
  assert.ok(record.ide?.version && record.plugin?.version && record.plugin?.sha256);
  assert.match(record.plugin.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(record.results));
  assertSafeContent(JSON.stringify(record), `run ${record.runId}`);
  for (const result of record.results) {
    assert.ok(allCases.some(testCase => testCase.id === result.caseId), `${record.runId}: unknown case ${result.caseId}`);
    assert.ok(RESULT_STATUSES.includes(result.status), `${record.runId}/${result.caseId}: invalid status`);
    assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0);
    if (['FAIL', 'BLOCKED', 'SKIP'].includes(result.status)) {
      assert.ok(result.note, `${record.runId}/${result.caseId}: ${result.status} needs a note`);
    }
    if (result.status === 'PASS' && result.type === 'guided') {
      assert.ok(result.evidence?.length, `${record.runId}/${result.caseId}: guided PASS needs evidence`);
    }
    for (const evidence of result.evidence || []) assert.match(evidence.sha256 || '', /^[a-f0-9]{64}$/);
  }
}

export async function readRunRecords(release) {
  if (release !== undefined) assertReleaseId(release);
  const root = release ? resolve(RUNS_ROOT, release) : RUNS_ROOT;
  const paths = await jsonFiles(root);
  return Promise.all(paths.map(path => readFile(path, 'utf8').then(JSON.parse)));
}

async function jsonFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const output = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...await jsonFiles(path));
    else if (entry.name.endsWith('.json')) output.push(path);
  }
  return output.sort();
}
