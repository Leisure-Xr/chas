import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { QA_ROOT } from '../src/paths.mjs';
import { assertSafeContent } from '../src/security.mjs';

test('VS Code webview fixture loads production assets and required controls', async () => {
  const content = await readFile(resolve(QA_ROOT, 'fixtures', 'vscode-webview.html'), 'utf8');
  for (const id of ['back', 'history', 'favorites', 'content', 'more-tools', 'refresh']) {
    assert.match(content, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(content, /src="\/vscode\/media\/main\.js"/);
  assert.match(content, /href="\/vscode\/media\/styles\.css"/);
  assert.match(content, /favoriteAddCurrent/);
  assert.match(content, /favoriteFolderCreate/);
  assertSafeContent(content, 'VS Code webview fixture');
});
