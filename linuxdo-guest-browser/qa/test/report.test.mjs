import test from 'node:test';
import assert from 'node:assert/strict';
import { casesFor } from '../src/cases/index.mjs';
import { MATRIX_TARGETS } from '../src/matrix-targets.mjs';
import { evaluateTarget } from '../src/report.mjs';

test('release row stays blocked until a resolved download has a checksum', () => {
  const definition = MATRIX_TARGETS.find(target => target.id === 'vscode-1.114');
  const target = { ...definition, status: 'resolved', version: '1.114.2', downloads: { 'darwin-arm64': { sha256: null, verifiedAt: null } } };
  assert.equal(evaluateTarget(definition, target, 'darwin', []).status, 'BLOCKED');
});

test('release row requires every applicable P0/P1 and external guided evidence', () => {
  const definition = MATRIX_TARGETS.find(target => target.id === 'vscode-latest');
  const target = {
    ...definition,
    status: 'resolved',
    version: '1.136.1',
    downloads: { 'darwin-arm64': { sha256: 'a'.repeat(64), verifiedAt: '2026-09-10T00:00:00Z' } }
  };
  const capabilities = [
    'source', 'package', 'visible-desktop', 'live-network', 'cross-product',
    'vscode-native', 'vscode-manual', 'latest'
  ];
  const results = casesFor('vscode', 'darwin', capabilities)
    .filter(testCase => ['P0', 'P1'].includes(testCase.priority))
    .map(testCase => ({
      caseId: testCase.id,
      status: 'PASS',
      evidence: testCase.type === 'guided' ? [{ url: 'https://example.test/evidence', sha256: 'b'.repeat(64) }] : []
    }));
  const record = {
    matrixTarget: definition.id,
    platform: 'darwin',
    workingTreeDirty: false,
    ide: { version: target.version },
    results
  };
  assert.equal(evaluateTarget(definition, target, 'darwin', [record]).status, 'PASS');
  results.find(result => result.caseId === 'VSC-003').evidence[0].url = null;
  assert.equal(evaluateTarget(definition, target, 'darwin', [record]).status, 'BLOCKED');
  record.workingTreeDirty = true;
  assert.equal(evaluateTarget(definition, target, 'darwin', [record]).status, 'BLOCKED');
});
