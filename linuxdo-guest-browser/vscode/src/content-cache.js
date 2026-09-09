'use strict';

// The reader already falls back to stale content while the site rate-limits us,
// but that fallback used to live in a Map that died with the window.  A cold
// start that hit 429 therefore had nothing to show.  This module persists the
// JSON cache as a single snapshot file so the fallback survives a reload.
const CACHE_FILE_NAME = 'content-cache.json';
const SNAPSHOT_VERSION = 1;
const MAX_ENTRIES = 80;
const MAX_ENTRY_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
// How stale a cached page may be and still be served as a rate-limit fallback.
// Owned here and imported by guest-session.js so the disk copy and the memory
// copy can never disagree about what counts as usable.
const STALE_CACHE_MAX_AGE_MS = 6 * 60 * 60_000;

const NOOP_CONTENT_CACHE_STORE = Object.freeze({
  load: async () => [],
  save: async () => {},
  clear: async () => {}
});

function normalizeEntry(key, value, now) {
  if (typeof key !== 'string' || !key) return undefined;
  const storedAt = Number(value?.storedAt);
  if (!Number.isInteger(storedAt) || storedAt <= 0) return undefined;
  if (now - storedAt > STALE_CACHE_MAX_AGE_MS) return undefined;
  const data = value?.data;
  if (!data || typeof data !== 'object') return undefined;
  return [key, { data, storedAt }];
}

// Entries arrive in Map order, which the session maintains as least-recently
// used first, so walking backwards keeps the freshest pages when we run out of
// budget.  An oversized entry is skipped rather than ending the walk: smaller
// older pages are still worth caching.
function prepareSnapshot(entries, now = Date.now()) {
  const kept = [];
  let totalBytes = 0;
  for (let index = entries.length - 1; index >= 0 && kept.length < MAX_ENTRIES; index -= 1) {
    const entry = entries[index];
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const normalized = normalizeEntry(entry[0], entry[1], now);
    if (!normalized) continue;
    let serialized;
    try {
      serialized = JSON.stringify(normalized[1].data);
    } catch {
      continue;
    }
    if (!serialized) continue;
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > MAX_ENTRY_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) continue;
    totalBytes += bytes;
    kept.push(normalized);
  }
  kept.reverse();
  return {
    version: SNAPSHOT_VERSION,
    savedAt: now,
    entries: kept.map(([key, value]) => ({ key, storedAt: value.storedAt, data: value.data }))
  };
}

function parseSnapshot(text, now = Date.now()) {
  let snapshot;
  try {
    snapshot = JSON.parse(String(text || ''));
  } catch {
    return [];
  }
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.entries)) return [];
  const entries = [];
  for (const item of snapshot.entries) {
    if (entries.length >= MAX_ENTRIES) break;
    const normalized = normalizeEntry(item?.key, item, now);
    if (normalized) entries.push(normalized);
  }
  return entries;
}

// `fs` is vscode.workspace.fs; it is injected so the store can be tested
// without the editor host.
function createContentCacheStore({ fs, directoryUri, fileUri, now = () => Date.now() }) {
  async function load() {
    try {
      const bytes = await fs.readFile(fileUri);
      return parseSnapshot(Buffer.from(bytes).toString('utf8'), now());
    } catch {
      // Missing, unreadable or corrupt snapshots simply mean an empty cache.
      return [];
    }
  }

  async function clear() {
    try {
      await fs.delete(fileUri, { useTrash: false });
    } catch {
      // Already gone, or not ours to delete.
    }
  }

  async function save(entries) {
    const snapshot = prepareSnapshot(Array.isArray(entries) ? entries : [], now());
    if (!snapshot.entries.length) {
      await clear();
      return;
    }
    try {
      await fs.createDirectory(directoryUri);
      await fs.writeFile(fileUri, Buffer.from(JSON.stringify(snapshot), 'utf8'));
    } catch {
      // A cache that cannot be written must never break browsing.
    }
  }

  return { load, save, clear };
}

module.exports = {
  CACHE_FILE_NAME,
  STALE_CACHE_MAX_AGE_MS,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  NOOP_CONTENT_CACHE_STORE,
  SNAPSHOT_VERSION,
  createContentCacheStore,
  parseSnapshot,
  prepareSnapshot
};
