import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { CACHE_ROOT, PROJECT_ROOT } from './paths.mjs';
import { extractArchive } from './archive.mjs';
import { runCommand, spawnDetached } from './process.mjs';

export async function inspectIde(product, idePath) {
  if (product === 'vscode') return inspectVsCode(idePath);
  if (product === 'pycharm') return inspectPyCharm(idePath);
  throw new Error(`Unsupported IDE product: ${product}`);
}

export async function inspectVsCode(idePath) {
  const root = await findRoot(idePath, [
    ['Contents', 'Resources', 'app', 'package.json'],
    ['resources', 'app', 'package.json']
  ]);
  const mac = resolve(root, 'Contents', 'Resources', 'app', 'package.json');
  const packagePath = await exists(mac) ? mac : resolve(root, 'resources', 'app', 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  const productPath = resolve(dirname(packagePath), 'product.json');
  const product = await exists(productPath) ? JSON.parse(await readFile(productPath, 'utf8')) : {};
  const macLauncher = resolve(root, 'Contents', 'MacOS', 'Code');
  const macCli = resolve(root, 'Contents', 'Resources', 'app', 'bin', 'code');
  const windowsLauncher = resolve(root, 'Code.exe');
  return {
    product: 'vscode',
    root,
    version: manifest.version,
    build: product.commit || manifest.commit || null,
    launcher: await exists(macLauncher) ? macLauncher : windowsLauncher,
    cli: await exists(macCli) ? macCli : windowsLauncher
  };
}

export async function inspectPyCharm(idePath) {
  const root = await findRoot(idePath, [
    ['Contents', 'Resources', 'product-info.json'],
    ['product-info.json']
  ]);
  const mac = resolve(root, 'Contents', 'Resources', 'product-info.json');
  const infoPath = await exists(mac) ? mac : resolve(root, 'product-info.json');
  const info = JSON.parse(await readFile(infoPath, 'utf8'));
  const launch = info.launch?.find(entry => entry.os === platformName() && architectureMatches(entry.arch));
  const launcher = launch
    ? resolve(dirname(infoPath), launch.launcherPath)
    : process.platform === 'darwin'
      ? resolve(root, 'Contents', 'MacOS', 'pycharm')
      : resolve(root, 'bin', 'pycharm64.exe');
  return {
    product: 'pycharm',
    root,
    version: info.version,
    build: String(info.buildNumber || '').replace(/^PY-/, '') || null,
    launcher,
    productCode: info.productCode
  };
}

export function capabilitiesFor(ide, target) {
  const capabilities = new Set(['package', 'source', 'visible-desktop', 'live-network', 'cross-product']);
  for (const capability of target?.expectedCapabilities || []) capabilities.add(capability);
  if (ide.product === 'vscode') {
    capabilities.add('vscode-manual');
    const [major, minor] = ide.version.split('.').map(Number);
    if (major > 1 || minor >= 114) capabilities.add('vscode-native');
    else capabilities.add('vscode-manual-boundary');
  } else {
    capabilities.add('jcef');
  }
  return [...capabilities];
}

export async function prepareIsolatedIde({ ide, artifact, runId, launch = false }) {
  const root = resolve(CACHE_ROOT, 'runs', safeName(runId), ide.product);
  await mkdir(root, { recursive: true });
  const prepared = ide.product === 'vscode'
    ? await prepareVsCode(ide, artifact, root, launch)
    : await preparePyCharm(ide, artifact, root, launch);
  await writeFile(resolve(root, 'environment.json'), `${JSON.stringify({
    ide: { product: ide.product, version: ide.version, build: ide.build, root: ide.root },
    artifact: basename(artifact),
    isolationRoot: root,
    launchedAt: launch ? new Date().toISOString() : null
  }, null, 2)}\n`, 'utf8');
  return prepared;
}

async function prepareVsCode(ide, artifact, root, launch) {
  const userData = resolve(root, 'user-data');
  const extensions = resolve(root, 'extensions');
  await mkdir(userData, { recursive: true });
  await mkdir(extensions, { recursive: true });
  const isolationArgs = ['--user-data-dir', userData, '--extensions-dir', extensions];
  await runCommand(ide.cli, [...isolationArgs, '--install-extension', artifact, '--force']);
  let pid = null;
  if (launch) {
    pid = spawnDetached(ide.cli, [
      ...isolationArgs,
      '--new-window',
      '--disable-updates',
      '--disable-workspace-trust',
      '--skip-welcome',
      PROJECT_ROOT
    ]);
  }
  return { isolationRoot: root, logRoot: resolve(userData, 'logs'), pid };
}

async function preparePyCharm(ide, artifact, root, launch) {
  const config = resolve(root, 'config');
  const system = resolve(root, 'system');
  const plugins = resolve(root, 'plugins');
  const logs = resolve(root, 'logs');
  await Promise.all([config, system, plugins, logs].map(path => mkdir(path, { recursive: true })));
  await extractArchive(artifact, plugins);
  let pid = null;
  if (launch) {
    pid = spawnDetached(ide.launcher, [
      `-Didea.config.path=${config}`,
      `-Didea.system.path=${system}`,
      `-Didea.plugins.path=${plugins}`,
      `-Didea.log.path=${logs}`,
      '-Dide.no.platform.update=true',
      PROJECT_ROOT
    ]);
  }
  return { isolationRoot: root, logRoot: logs, pid };
}

async function findRoot(input, markers) {
  let current = resolve(input);
  for (let depth = 0; depth < 8; depth += 1) {
    for (const marker of markers) {
      if (await exists(resolve(current, ...marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not identify an IDE at ${input}`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function platformName() {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  return 'Linux';
}

function architectureMatches(value) {
  if (!value) return true;
  return value === process.arch || (value === 'aarch64' && process.arch === 'arm64') || (value === 'x64' && process.arch === 'x64');
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}
