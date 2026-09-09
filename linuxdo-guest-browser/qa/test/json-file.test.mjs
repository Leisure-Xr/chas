import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readJson, updateJson, writeJson } from '../src/json-file.mjs';

test('concurrent JSON updates preserve changes from both writers', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'linuxdo-json-lock-'));
  const path = resolve(root, 'lock.json');
  try {
    await writeJson(path, { first: 0, second: 0 });
    await Promise.all([
      updateJson(path, async value => {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
        value.first = 1;
      }),
      updateJson(path, value => {
        value.second = 2;
      })
    ]);
    assert.deepEqual(await readJson(path), { first: 1, second: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
