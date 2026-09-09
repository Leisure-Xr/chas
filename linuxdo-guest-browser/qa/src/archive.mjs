import { runCommand } from './process.mjs';

export async function listArchive(path) {
  const { stdout } = await runCommand('tar', ['-tf', path]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

export async function readArchiveEntry(path, entry) {
  const { stdout } = await runCommand('tar', ['-xOf', path, entry]);
  return stdout;
}

export async function extractArchive(path, destination) {
  await runCommand('tar', ['-xf', path, '-C', destination]);
}
