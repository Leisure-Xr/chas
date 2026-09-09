import AdmZip from 'adm-zip';

export async function listArchive(path) {
  return new AdmZip(path).getEntries().map(entry => entry.entryName);
}

export async function readArchiveEntry(path, entry) {
  const value = new AdmZip(path).getEntry(entry);
  if (!value) throw new Error(`${entry} is missing from ${path}`);
  return value.getData().toString('utf8');
}

export async function extractArchive(path, destination) {
  new AdmZip(path).extractAllTo(destination, true);
}
