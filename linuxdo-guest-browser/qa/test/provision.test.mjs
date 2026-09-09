import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { downloadFile } from '../src/provision.mjs';

test('IDE downloads resume a partial file and hash the complete archive', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'linuxdo-download-'));
  const path = resolve(root, 'archive.zip');
  try {
    await writeFile(path, 'partial-');
    const hash = await downloadFile('https://example.test/archive.zip', path, async (_url, options) => {
      assert.equal(options.headers.range, 'bytes=8-');
      return new Response('complete', { status: 206 });
    });
    assert.equal(await readFile(path, 'utf8'), 'partial-complete');
    assert.equal(hash, 'f06f4453210327bc62d30741fe45856e6830d980e8fbf945aee527d651a5aa50');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
