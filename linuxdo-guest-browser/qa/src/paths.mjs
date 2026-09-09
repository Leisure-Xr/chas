import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = resolve(QA_ROOT, '..');
export const REPOSITORY_ROOT = resolve(PROJECT_ROOT, '..');
export const LOCK_PATH = resolve(QA_ROOT, 'ide-lock.json');
export const RUNS_ROOT = resolve(QA_ROOT, 'runs');
export const ARTIFACTS_ROOT = resolve(QA_ROOT, 'artifacts');
export const CACHE_ROOT = resolve(QA_ROOT, '.cache');
export const GENERATED_CASES_PATH = resolve(QA_ROOT, 'docs', 'test-cases.md');
export const GENERATED_COVERAGE_PATH = resolve(QA_ROOT, 'docs', 'coverage.md');
