import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { capabilitiesFor, inspectIde } from '../src/environment.mjs';

test('VS Code inspection reads the real application metadata layout', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'linuxdo-qa-vscode-'));
  try {
    const app = resolve(root, 'Visual Studio Code.app');
    const resources = resolve(app, 'Contents', 'Resources', 'app');
    const executableRoot = resolve(app, 'Contents', 'MacOS');
    await mkdir(resolve(resources, 'bin'), { recursive: true });
    await mkdir(executableRoot, { recursive: true });
    await writeFile(resolve(resources, 'package.json'), JSON.stringify({ version: '1.114.2' }));
    await writeFile(resolve(resources, 'product.json'), JSON.stringify({ commit: 'commit-id' }));
    await writeFile(resolve(resources, 'bin', 'code'), '');
    await writeFile(resolve(executableRoot, 'Code'), '');
    const ide = await inspectIde('vscode', app);
    assert.equal(ide.version, '1.114.2');
    assert.equal(ide.build, 'commit-id');
    assert.ok(capabilitiesFor(ide, { expectedCapabilities: [] }).includes('vscode-native'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PyCharm inspection reads product-info and normalizes its build', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'linuxdo-qa-pycharm-'));
  try {
    const app = resolve(root, 'PyCharm.app');
    const resources = resolve(app, 'Contents', 'Resources');
    const executableRoot = resolve(app, 'Contents', 'MacOS');
    await mkdir(resources, { recursive: true });
    await mkdir(executableRoot, { recursive: true });
    await writeFile(resolve(executableRoot, 'pycharm'), '');
    await writeFile(resolve(resources, 'product-info.json'), JSON.stringify({
      name: 'PyCharm', version: '2022.3.3', buildNumber: 'PY-223.1', productCode: 'PY',
      launch: [{ os: 'macOS', arch: 'aarch64', launcherPath: '../MacOS/pycharm' }]
    }));
    const ide = await inspectIde('pycharm', app);
    assert.equal(ide.version, '2022.3.3');
    assert.equal(ide.build, '223.1');
    assert.equal(ide.envVarBaseName, 'PYCHARM');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
