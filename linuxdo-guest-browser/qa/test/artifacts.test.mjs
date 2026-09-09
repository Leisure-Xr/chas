import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPyCharmArtifact, checkSharedCopies, checkVsCodeArtifact, runVsCodeUnitTests } from '../src/checks.mjs';

test('published VSIX matches source metadata', async () => {
  const result = await checkVsCodeArtifact();
  assert.equal(result.pluginVersion, '0.18.0');
  assert.match(result.pluginSha256, /^[a-f0-9]{64}$/);
});

test('published PyCharm ZIP matches source metadata and package contract', async () => {
  const result = await checkPyCharmArtifact();
  assert.equal(result.pluginVersion, '0.12.0');
  assert.equal(result.sinceBuild, '223');
  assert.equal(result.untilBuild, '263.*');
});

test('shared game resources match both packaged source trees', async () => {
  await assert.doesNotReject(checkSharedCopies());
});

test('existing VS Code unit suite remains green', async () => {
  const result = await runVsCodeUnitTests();
  assert.match(result.detail, /unit suite passed/);
});
