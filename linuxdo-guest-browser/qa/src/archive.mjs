import { runCommand } from './process.mjs';

export async function listArchive(path) {
  const { stdout } = process.platform === 'win32'
    ? await runCommand('tar', ['-tf', path])
    : await runCommand('unzip', ['-Z1', path]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

export async function readArchiveEntry(path, entry) {
  const { stdout } = process.platform === 'win32'
    ? await runCommand('tar', ['-xOf', path, entry])
    : await runCommand('unzip', ['-p', path, entry]);
  return stdout;
}

export async function extractArchive(path, destination) {
  if (process.platform === 'win32') await runCommand('tar', ['-xf', path, '-C', destination]);
  else await runCommand('unzip', ['-q', path, '-d', destination]);
}
