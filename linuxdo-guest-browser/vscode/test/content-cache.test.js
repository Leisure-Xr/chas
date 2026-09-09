'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CACHE_FILE_NAME,
  MAX_ENTRIES,
  NOOP_CONTENT_CACHE_STORE,
  SNAPSHOT_VERSION,
  STALE_CACHE_MAX_AGE_MS,
  createContentCacheStore,
  parseSnapshot,
  prepareSnapshot
} = require('../src/content-cache');

const NOW = 1_700_000_000_000;

function entry(key, storedAt, data = { topic_list: { topics: [{ id: 1 }] } }) {
  return [key, { data, storedAt }];
}

function createMemoryFs() {
  const files = new Map();
  return {
    files,
    createdDirectories: [],
    async readFile(uri) {
      const stored = files.get(String(uri));
      if (!stored) throw new Error('ENOENT');
      return stored;
    },
    async writeFile(uri, bytes) {
      files.set(String(uri), Buffer.from(bytes));
    },
    async delete(uri) {
      if (!files.delete(String(uri))) throw new Error('ENOENT');
    },
    async createDirectory(uri) {
      this.createdDirectories.push(String(uri));
    }
  };
}

function createStore(fs = createMemoryFs()) {
  return {
    fs,
    store: createContentCacheStore({
      fs,
      directoryUri: '/storage',
      fileUri: `/storage/${CACHE_FILE_NAME}`,
      now: () => NOW
    })
  };
}

test('snapshot keeps the freshest entries when the entry cap is exceeded', () => {
  const entries = [];
  for (let index = 0; index < MAX_ENTRIES + 10; index += 1) {
    entries.push(entry(`https://linux.do/t/${index}.json`, NOW - 1_000));
  }
  const snapshot = prepareSnapshot(entries, NOW);
  assert.equal(snapshot.entries.length, MAX_ENTRIES);
  // Map order is least-recently-used first, so the tail must survive.
  assert.equal(snapshot.entries.at(-1).key, `https://linux.do/t/${MAX_ENTRIES + 9}.json`);
  assert.equal(snapshot.entries[0].key, `https://linux.do/t/10.json`);
});

test('snapshot drops entries past the stale window and keeps ones inside it', () => {
  const snapshot = prepareSnapshot([
    entry('https://linux.do/expired.json', NOW - STALE_CACHE_MAX_AGE_MS - 1),
    entry('https://linux.do/fresh.json', NOW - STALE_CACHE_MAX_AGE_MS + 1_000)
  ], NOW);
  assert.deepEqual(snapshot.entries.map((item) => item.key), ['https://linux.do/fresh.json']);
});

test('snapshot skips oversized entries but still keeps smaller ones', () => {
  const huge = { body: 'x'.repeat(600 * 1024) };
  const snapshot = prepareSnapshot([
    entry('https://linux.do/small.json', NOW - 1_000),
    entry('https://linux.do/huge.json', NOW - 1_000, huge)
  ], NOW);
  assert.deepEqual(snapshot.entries.map((item) => item.key), ['https://linux.do/small.json']);
});

test('snapshot drops entries whose payload cannot be serialised', () => {
  const circular = {};
  circular.self = circular;
  const snapshot = prepareSnapshot([
    entry('https://linux.do/circular.json', NOW - 1_000, circular),
    entry('https://linux.do/ok.json', NOW - 1_000)
  ], NOW);
  assert.deepEqual(snapshot.entries.map((item) => item.key), ['https://linux.do/ok.json']);
});

test('parsing rejects corrupt, foreign and wrong-version snapshots', () => {
  assert.deepEqual(parseSnapshot('not json at all', NOW), []);
  assert.deepEqual(parseSnapshot('', NOW), []);
  assert.deepEqual(parseSnapshot(JSON.stringify({ version: SNAPSHOT_VERSION + 1, entries: [] }), NOW), []);
  assert.deepEqual(parseSnapshot(JSON.stringify({ version: SNAPSHOT_VERSION, entries: 'nope' }), NOW), []);
});

test('parsing filters entries that aged out while the snapshot sat on disk', () => {
  const text = JSON.stringify(prepareSnapshot([
    entry('https://linux.do/a.json', NOW - 1_000),
    entry('https://linux.do/b.json', NOW - 1_000)
  ], NOW));
  assert.equal(parseSnapshot(text, NOW).length, 2);
  assert.deepEqual(parseSnapshot(text, NOW + STALE_CACHE_MAX_AGE_MS + 2_000), []);
});

test('store round-trips entries through the file system', async () => {
  const { fs, store } = createStore();
  await store.save([entry('https://linux.do/latest.json', NOW - 1_000)]);
  assert.ok(fs.files.has(`/storage/${CACHE_FILE_NAME}`));
  assert.deepEqual(fs.createdDirectories, ['/storage']);

  const loaded = await store.load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0][0], 'https://linux.do/latest.json');
  assert.equal(loaded[0][1].storedAt, NOW - 1_000);
  assert.deepEqual(loaded[0][1].data, { topic_list: { topics: [{ id: 1 }] } });
});

test('store reports an empty cache instead of throwing when the file is missing or corrupt', async () => {
  const { fs, store } = createStore();
  assert.deepEqual(await store.load(), []);

  fs.files.set(`/storage/${CACHE_FILE_NAME}`, Buffer.from('{ broken', 'utf8'));
  assert.deepEqual(await store.load(), []);
});

test('store survives a file system that refuses to write', async () => {
  const fs = createMemoryFs();
  fs.writeFile = async () => { throw new Error('EACCES'); };
  const { store } = createStore(fs);
  await assert.doesNotReject(store.save([entry('https://linux.do/latest.json', NOW - 1_000)]));
});

test('clear removes the snapshot file and tolerates it being gone', async () => {
  const { fs, store } = createStore();
  await store.save([entry('https://linux.do/latest.json', NOW - 1_000)]);
  await store.clear();
  assert.equal(fs.files.size, 0);
  await assert.doesNotReject(store.clear());
});

test('saving nothing usable removes a stale snapshot rather than leaving it behind', async () => {
  const { fs, store } = createStore();
  await store.save([entry('https://linux.do/latest.json', NOW - 1_000)]);
  await store.save([entry('https://linux.do/expired.json', NOW - STALE_CACHE_MAX_AGE_MS - 1)]);
  assert.equal(fs.files.size, 0);
});

test('the no-op store satisfies the same interface', async () => {
  assert.deepEqual(await NOOP_CONTENT_CACHE_STORE.load(), []);
  await assert.doesNotReject(NOOP_CONTENT_CACHE_STORE.save([entry('https://linux.do/a.json', NOW)]));
  await assert.doesNotReject(NOOP_CONTENT_CACHE_STORE.clear());
});
