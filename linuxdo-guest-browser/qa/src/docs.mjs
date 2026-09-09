import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { allCases } from './cases/index.mjs';
import { GENERATED_CASES_PATH, GENERATED_COVERAGE_PATH } from './paths.mjs';

const PRODUCT_LABELS = { shared: '共享', vscode: 'VS Code', pycharm: 'PyCharm' };

export function renderCaseCatalog(cases = allCases) {
  const lines = [
    '# 测试用例目录',
    '',
    '> 此文件由 `node qa/bin/qa.mjs docs` 从 JavaScript 用例定义生成，请勿手工编辑。',
    ''
  ];
  for (const product of ['shared', 'vscode', 'pycharm']) {
    lines.push(`## ${PRODUCT_LABELS[product]}`, '');
    for (const testCase of cases.filter(entry => entry.product === product)) {
      lines.push(
        `### ${testCase.id} ${testCase.title}`,
        '',
        `- 优先级：${testCase.priority}`,
        `- 类型：${testCase.type}`,
        `- 平台：${testCase.platforms.join(', ')}`,
        `- 能力：${testCase.capabilities.length ? testCase.capabilities.join(', ') : '无额外要求'}`,
        ''
      );
      if (testCase.preconditions.length) {
        lines.push('前置条件：', '');
        for (const item of testCase.preconditions) lines.push(`- ${item}`);
        lines.push('');
      }
      if (testCase.steps.length) {
        lines.push('| # | 操作 | 预期 |', '| --- | --- | --- |');
        testCase.steps.forEach((step, index) => {
          lines.push(`| ${index + 1} | ${escapeCell(step.action)} | ${escapeCell(step.expected)} |`);
        });
        lines.push('');
      }
      lines.push(`最终预期：${testCase.expected}`, '');
    }
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

export function renderCoverage(cases = allCases) {
  const capabilities = new Map();
  for (const testCase of cases) {
    for (const capability of testCase.capabilities) {
      const ids = capabilities.get(capability) || [];
      ids.push(testCase.id);
      capabilities.set(capability, ids);
    }
  }
  const lines = [
    '# 测试能力覆盖',
    '',
    '> 此文件由 `node qa/bin/qa.mjs docs` 生成。能力标签决定某个 IDE 版本适用哪些测试。',
    '',
    '| 能力 | 用例 |',
    '| --- | --- |'
  ];
  for (const [capability, ids] of [...capabilities].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`| ${capability} | ${ids.join(', ')} |`);
  }
  lines.push('');
  return lines.join('\n').replace(/\n*$/, '\n');
}

export async function writeGeneratedDocs() {
  for (const [path, content] of [
    [GENERATED_CASES_PATH, renderCaseCatalog()],
    [GENERATED_COVERAGE_PATH, renderCoverage()]
  ]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

export async function generatedDocsAreCurrent() {
  try {
    const [cases, coverage] = await Promise.all([
      readFile(GENERATED_CASES_PATH, 'utf8'),
      readFile(GENERATED_COVERAGE_PATH, 'utf8')
    ]);
    return cases === renderCaseCatalog() && coverage === renderCoverage();
  } catch {
    return false;
  }
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
