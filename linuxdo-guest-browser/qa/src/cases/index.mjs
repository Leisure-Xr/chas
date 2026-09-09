import { pycharmCases } from './pycharm.mjs';
import { sharedCases } from './shared.mjs';
import { vscodeCases } from './vscode.mjs';

export const allCases = Object.freeze([
  ...sharedCases,
  ...vscodeCases,
  ...pycharmCases
].sort((left, right) => left.id.localeCompare(right.id)));

export function casesFor(product, platform, capabilities = []) {
  const available = new Set(capabilities);
  return allCases.filter(testCase =>
    (testCase.product === 'shared' || testCase.product === product) &&
    testCase.platforms.includes(platform) &&
    testCase.capabilities.every(capability => available.has(capability))
  );
}
