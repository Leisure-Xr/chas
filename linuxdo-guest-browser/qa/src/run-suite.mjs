import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { platform as osPlatform, release as osRelease } from 'node:os';
import { basename, resolve } from 'node:path';
import { checkPyCharmArtifact, checkVsCodeArtifact } from './checks.mjs';
import { casesFor } from './cases/index.mjs';
import { RESULT_STATUSES } from './case-definition.mjs';
import { capabilitiesFor, inspectIde, prepareIsolatedIde } from './environment.mjs';
import { LOCK_PATH, REPOSITORY_ROOT, RUNS_ROOT } from './paths.mjs';
import { readJson, writeJson } from './json-file.mjs';
import { assertReleaseId } from './identifiers.mjs';
import { collectLogSummary } from './logs.mjs';
import { matrixTarget } from './matrix-targets.mjs';
import { runCommand } from './process.mjs';
import { assertSafeContent, inspectEvidence } from './security.mjs';

export async function runSuite(options) {
  const { product, targetId, idePath, release, mode = 'all', interactive = false, launch = false } = options;
  if (!['vscode', 'pycharm'].includes(product)) throw new Error('run requires --product vscode|pycharm');
  if (!targetId || !matrixTarget(targetId)) throw new Error('run requires a known --target');
  if (!idePath) throw new Error('run requires --ide pointing to the real IDE installation');
  assertReleaseId(release);

  const startedAt = new Date().toISOString();
  const lock = await readJson(LOCK_PATH);
  const locked = lock.targets.find(entry => entry.id === targetId);
  const target = matrixTarget(targetId);
  if (target.product !== product) throw new Error(`${targetId} is not a ${product} target`);
  const ide = await inspectIde(product, idePath);
  if (locked.version && ide.version !== locked.version) {
    throw new Error(`${targetId} is locked to ${locked.version}, but ${ide.version} was supplied`);
  }
  const artifactInfo = product === 'vscode' ? await checkVsCodeArtifact() : await checkPyCharmArtifact();
  const runId = `${timestamp()}-${targetId}-${process.platform}-${process.arch}`;
  const preparation = await prepareIsolatedIde({ ide, artifact: artifactInfo.artifact, runId, launch });
  const capabilities = capabilitiesFor(ide, target);
  const selected = casesFor(product, process.platform, capabilities)
    .filter(testCase => mode === 'all' || testCase.type === mode);
  if (!selected.length) throw new Error(`No ${mode} cases apply to ${targetId}`);

  const prompt = interactive ? createInterface({ input: stdin, output: stdout }) : null;
  const results = [];
  try {
    for (const testCase of selected) results.push(await executeCase(testCase, { ide, target, preparation }, prompt));
  } finally {
    prompt?.close();
  }
  const { stdout: commitOutput } = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT });
  const { stdout: statusOutput } = await runCommand('git', ['status', '--porcelain', '--', 'linuxdo-guest-browser'], { cwd: REPOSITORY_ROOT });
  const diagnostics = launch ? await collectLogSummary(preparation.logRoot, runId) : null;
  const record = {
    schemaVersion: 1,
    runId,
    release,
    commit: commitOutput.trim(),
    workingTreeDirty: hasSourceChanges(statusOutput),
    product,
    matrixTarget: targetId,
    platform: process.platform,
    arch: process.arch,
    host: { os: osPlatform(), release: osRelease() },
    ide: { version: ide.version, build: ide.build },
    plugin: {
      version: artifactInfo.pluginVersion,
      sha256: artifactInfo.pluginSha256,
      fileName: basename(artifactInfo.artifact)
    },
    isolation: { prepared: true, launched: launch, logLocation: 'qa/.cache/runs/<run-id>' },
    diagnostics,
    startedAt,
    capabilities,
    results
  };
  assertSafeContent(JSON.stringify(record), `run ${runId}`);
  const path = resolve(RUNS_ROOT, release, `${runId}.json`);
  await writeJson(path, record);
  return { path, record };
}

async function executeCase(testCase, context, prompt) {
  const started = performance.now();
  if (testCase.type === 'automated') {
    try {
      const output = await testCase.run(context);
      return result(testCase, 'PASS', performance.now() - started, output?.detail || testCase.expected, []);
    } catch (error) {
      return result(testCase, 'FAIL', performance.now() - started, error.stack || error.message, []);
    }
  }
  if (!prompt) {
    return result(testCase, 'BLOCKED', performance.now() - started, '需要可见桌面和人工交互确认，本次以非交互模式运行。', []);
  }
  stdout.write(`\n[${testCase.id}] ${testCase.title}\n`);
  testCase.steps.forEach((step, index) => stdout.write(`${index + 1}. ${step.action}\n   预期: ${step.expected}\n`));
  const status = (await prompt.question('结果 PASS/FAIL/BLOCKED/SKIP: ')).trim().toUpperCase();
  if (!RESULT_STATUSES.includes(status)) throw new Error(`Invalid result status: ${status}`);
  const note = (await prompt.question('备注（失败、阻塞或跳过时必填）: ')).trim();
  if (status !== 'PASS' && !note) throw new Error(`${status} requires a note`);
  const rawEvidence = (await prompt.question('证据文件路径（PASS 必填，多个用逗号分隔）: ')).trim();
  const evidencePaths = rawEvidence ? rawEvidence.split(',').map(value => value.trim()).filter(Boolean) : [];
  if (status === 'PASS' && !evidencePaths.length) throw new Error('Guided PASS requires at least one evidence file');
  const evidence = [];
  for (const path of evidencePaths) {
    const inspected = await inspectEvidence(path);
    evidence.push({ fileName: basename(path), bytes: inspected.bytes, sha256: inspected.sha256, url: null });
  }
  return result(testCase, status, performance.now() - started, note || testCase.expected, evidence);
}

function result(testCase, status, duration, note, evidence) {
  return {
    caseId: testCase.id,
    type: testCase.type,
    priority: testCase.priority,
    status,
    durationMs: Math.round(duration),
    note,
    evidence
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function hasSourceChanges(statusOutput) {
  return String(statusOutput)
    .split(/\r?\n/)
    .filter(Boolean)
    .some(line => !line.includes('linuxdo-guest-browser/qa/runs/'));
}
