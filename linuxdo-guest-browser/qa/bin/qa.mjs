#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArguments, flag, option, options } from '../src/args.mjs';
import { writeGeneratedDocs } from '../src/docs.mjs';
import { inspectIde } from '../src/environment.mjs';
import { allTargetIds, resolveMatrix } from '../src/resolve-matrix.mjs';
import { provisionTarget } from '../src/provision.mjs';
import { createReport } from '../src/report.mjs';
import { runSuite } from '../src/run-suite.mjs';
import { validateRepository } from '../src/validate.mjs';

const parsed = parseArguments(process.argv.slice(2));

try {
  switch (parsed.command) {
    case 'docs': {
      await writeGeneratedDocs();
      console.log('Generated qa/docs/test-cases.md and qa/docs/coverage.md.');
      break;
    }
    case 'validate': {
      const result = await validateRepository();
      console.log(`Validated ${result.cases} cases and ${result.runs} run records.`);
      if (result.unresolvedTargets.length) console.log(`Release gate pending: ${result.unresolvedTargets.join(', ')}`);
      break;
    }
    case 'resolve': {
      const targets = flag(parsed.options, 'all') ? allTargetIds() : options(parsed.options, 'target');
      const lock = await resolveMatrix(targets);
      console.log(`Resolved ${targets.length} target(s) at ${lock.resolvedAt}.`);
      break;
    }
    case 'provision': {
      const target = option(parsed.options, 'target');
      if (!target) throw new Error('provision requires --target');
      const result = await provisionTarget(target, option(parsed.options, 'platform'));
      console.log(`${target}: ${result.ide.version} installed at ${result.ide.root}`);
      console.log(`SHA-256: ${result.sha256}`);
      break;
    }
    case 'inspect': {
      const product = option(parsed.options, 'product');
      const path = option(parsed.options, 'ide');
      if (!product || !path) throw new Error('inspect requires --product and --ide');
      console.log(JSON.stringify(await inspectIde(product, resolve(path)), null, 2));
      break;
    }
    case 'run': {
      const result = await runSuite({
        product: option(parsed.options, 'product'),
        targetId: option(parsed.options, 'target'),
        idePath: option(parsed.options, 'ide'),
        release: option(parsed.options, 'release'),
        mode: option(parsed.options, 'mode', 'all'),
        interactive: flag(parsed.options, 'interactive'),
        launch: flag(parsed.options, 'launch')
      });
      console.log(`Wrote ${result.path}`);
      break;
    }
    case 'report': {
      const result = await createReport(option(parsed.options, 'release'));
      console.log(`Wrote ${result.path}; release gate ${result.passed ? 'PASS' : 'BLOCKED'}.`);
      if (flag(parsed.options, 'gate') && !result.passed) process.exitCode = 1;
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`linuxdo-guest-browser QA

Usage:
  node qa/bin/qa.mjs docs
  node qa/bin/qa.mjs validate
  node qa/bin/qa.mjs resolve --target <matrix-id> [--target <matrix-id>]
  node qa/bin/qa.mjs resolve --all
  node qa/bin/qa.mjs provision --target <matrix-id> [--platform darwin-arm64|win32-x64]
  node qa/bin/qa.mjs inspect --product vscode|pycharm --ide <path>
  node qa/bin/qa.mjs run --product <product> --target <matrix-id> --ide <path> --release <id>
                           [--mode automated|guided|all] [--interactive] [--launch]
  node qa/bin/qa.mjs report --release <id> [--gate]
`);
}
