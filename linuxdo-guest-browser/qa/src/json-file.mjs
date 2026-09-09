import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function updateJson(path, mutate) {
  const lockPath = `${path}.lock`;
  let lock;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      lock = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 299) throw new Error(`Timed out waiting for ${lockPath}`);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
  }
  try {
    const current = await readJson(path);
    const updated = await mutate(current);
    await writeJson(path, updated ?? current);
    return updated ?? current;
  } finally {
    await lock?.close();
    await unlink(lockPath).catch(() => {});
  }
}
