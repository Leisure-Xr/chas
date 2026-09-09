export const MATRIX_TARGETS = Object.freeze([
  { id: 'vscode-1.85', product: 'vscode', line: '1.85', role: 'minimum', expectedCapabilities: ['vscode-manual-boundary'] },
  { id: 'vscode-1.113', product: 'vscode', line: '1.113', role: 'pre-native-boundary', expectedCapabilities: ['vscode-manual-boundary'] },
  { id: 'vscode-1.114', product: 'vscode', line: '1.114', role: 'native-boundary', expectedCapabilities: ['vscode-native'] },
  { id: 'vscode-latest', product: 'vscode', line: 'latest', role: 'latest', expectedCapabilities: ['vscode-native', 'latest'] },
  { id: 'pycharm-2022.3', product: 'pycharm', line: '2022.3', role: 'minimum', expectedCapabilities: ['jcef'] },
  { id: 'pycharm-2024.2', product: 'pycharm', line: '2024.2', role: 'intermediate', expectedCapabilities: ['jcef'] },
  { id: 'pycharm-latest', product: 'pycharm', line: 'latest', role: 'latest', expectedCapabilities: ['jcef', 'latest'] }
]);

export function matrixTarget(id) {
  return MATRIX_TARGETS.find(target => target.id === id);
}
