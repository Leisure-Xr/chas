import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { casesFor } from './cases/index.mjs';
import { LOCK_PATH, RUNS_ROOT } from './paths.mjs';
import { readJson } from './json-file.mjs';
import { assertReleaseId } from './identifiers.mjs';
import { MATRIX_TARGETS } from './matrix-targets.mjs';
import { readRunRecords, validateRunRecord } from './validate.mjs';

const REQUIRED_PLATFORMS = ['darwin', 'win32'];

export async function createReport(release) {
  assertReleaseId(release);
  const lock = await readJson(LOCK_PATH);
  const records = await readRunRecords(release);
  records.forEach(validateRunRecord);
  const rows = [];
  for (const definition of MATRIX_TARGETS) {
    const target = lock.targets.find(entry => entry.id === definition.id);
    for (const platform of REQUIRED_PLATFORMS) {
      rows.push(evaluateTarget(definition, target, platform, records));
    }
  }
  const passed = rows.every(row => row.status === 'PASS');
  const content = renderReport(release, rows, records, passed);
  const path = resolve(RUNS_ROOT, release, 'summary.md');
  await mkdir(resolve(RUNS_ROOT, release), { recursive: true });
  await writeFile(path, content, 'utf8');
  return { path, rows, records: records.length, passed };
}

export function evaluateTarget(definition, target, platform, records) {
  const platformKey = Object.keys(target?.downloads || {}).find(key => key.startsWith(`${platform}-`));
  if (!target || target.status !== 'resolved') {
    return row(definition, target, platform, 'BLOCKED', '版本尚未从官方发布源解析并锁定。');
  }
  if (!platformKey || !target.downloads[platformKey]?.sha256 || !target.downloads[platformKey]?.verifiedAt) {
    return row(definition, target, platform, 'BLOCKED', 'IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。');
  }
  const matchingRuns = records.filter(record =>
    record.matrixTarget === definition.id && record.platform === platform && record.ide.version === target.version && !record.workingTreeDirty
  );
  if (!matchingRuns.length) return row(definition, target, platform, 'BLOCKED', '没有该平台的真实 IDE 运行记录。');
  const launchedRuns = matchingRuns.filter(record => record.isolation?.launched);
  const latestLaunch = launchedRuns.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt))).at(-1);
  if (latestLaunch?.diagnostics?.fatalCount > 0) {
    return row(definition, target, platform, 'FAIL', `IDE 日志包含 ${latestLaunch.diagnostics.fatalCount} 条插件加载或链接错误。`);
  }

  const capabilities = baseCapabilities(definition);
  const required = casesFor(definition.product, platform, capabilities)
    .filter(testCase => ['P0', 'P1'].includes(testCase.priority));
  const latestResults = new Map();
  for (const record of matchingRuns) {
    for (const result of record.results) latestResults.set(result.caseId, result);
  }
  const failed = required.filter(testCase => latestResults.get(testCase.id)?.status === 'FAIL');
  if (failed.length) return row(definition, target, platform, 'FAIL', `失败用例：${failed.map(item => item.id).join(', ')}`);
  const incomplete = required.filter(testCase => {
    const result = latestResults.get(testCase.id);
    if (result?.status !== 'PASS') return true;
    if (testCase.type === 'guided') {
      return !result.evidence?.length || result.evidence.some(evidence => !/^https:\/\//.test(evidence.url || ''));
    }
    return false;
  });
  if (incomplete.length) {
    return row(definition, target, platform, 'BLOCKED', `未通过用例：${incomplete.map(item => item.id).join(', ')}`);
  }
  return row(definition, target, platform, 'PASS', `${required.length} 个 P0/P1 用例全部通过。`);
}

function row(definition, target, platform, status, detail) {
  return {
    target: definition.id,
    product: definition.product,
    role: definition.role,
    platform,
    version: target?.version || 'pending',
    build: target?.build || '-',
    status,
    detail
  };
}

function baseCapabilities(definition) {
  const values = new Set([
    'source', 'package', 'visible-desktop', 'live-network', 'cross-product',
    ...(definition.expectedCapabilities || [])
  ]);
  if (definition.product === 'vscode') values.add('vscode-manual');
  if (definition.product === 'pycharm') values.add('jcef');
  return [...values];
}

function renderReport(release, rows, records, passed) {
  const totals = rows.reduce((output, item) => {
    output[item.status] = (output[item.status] || 0) + 1;
    return output;
  }, {});
  const gateStatus = passed ? 'PASS' : rows.some(row => row.status === 'FAIL') ? 'FAIL' : 'BLOCKED';
  const lines = [
    `# Release ${release} 兼容性测试摘要`,
    '',
    `门禁：**${gateStatus}**`,
    '',
    `运行记录：${records.length}；矩阵结果：PASS ${totals.PASS || 0} / FAIL ${totals.FAIL || 0} / BLOCKED ${totals.BLOCKED || 0}。`,
    '',
    '| 目标 | 平台 | IDE 版本 | 构建 | 结果 | 说明 |',
    '| --- | --- | --- | --- | --- | --- |'
  ];
  for (const item of rows) {
    lines.push(`| ${item.target} | ${item.platform} | ${item.version} | ${item.build} | ${item.status} | ${item.detail} |`);
  }
  lines.push(
    '',
    '## 已执行记录',
    '',
    '| Run ID | 目标 | 平台 | IDE | PASS | FAIL | BLOCKED | 工作树 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const record of records) {
    const counts = record.results.reduce((output, result) => {
      output[result.status] = (output[result.status] || 0) + 1;
      return output;
    }, {});
    lines.push(`| ${record.runId} | ${record.matrixTarget} | ${record.platform}-${record.arch} | ${record.ide.version} | ${counts.PASS || 0} | ${counts.FAIL || 0} | ${counts.BLOCKED || 0} | ${record.workingTreeDirty ? 'DIRTY' : 'CLEAN'} |`);
  }
  if (!records.length) lines.push('| - | - | - | - | 0 | 0 | 0 | - |');
  lines.push(
    '',
    '## 判定规则',
    '',
    '- 每个锁定目标必须在 macOS 和 Windows 上完成所有适用的 P0/P1 用例。',
    '- 人工引导用例只有附带脱敏证据的 PASS 才计入通过。',
    '- 未解析版本、未校验 IDE 下载包、缺少 Windows 节点或环境不兼容均保持 BLOCKED。',
    '- 尚未发布的 JetBrains 构建只能保留声明，不能列为已实测。',
    ''
  );
  return lines.join('\n').replace(/\n*$/, '\n');
}
