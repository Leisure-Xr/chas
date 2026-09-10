'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_ENTRIES,
  addHistoryEntry,
  createHistoryEntry,
  normalizeStoredHistory
} = require('../src/reader-history');

test('history stores a public title, URL, visit time and reopen action', () => {
  const entry = createHistoryEntry(
    { type: 'topic', id: 123, slug: 'hello' },
    'Hello\nLINUX DO',
    'https://linux.do/t/hello/123#post_2',
    2000
  );
  assert.deepEqual(entry, {
    url: 'https://linux.do/t/hello/123',
    title: 'Hello LINUX DO',
    visitedAt: 2000,
    action: { type: 'topic', id: 123, slug: 'hello' }
  });
});

test('history rejects private/off-site entries and deduplicates by URL', () => {
  assert.equal(createHistoryEntry({ type: 'topic', id: 1, slug: 'one' }, 'One', 'https://example.com/t/one/1', 1), undefined);
  assert.equal(createHistoryEntry({ type: 'view', view: 'latest' }, 'Login', 'https://linux.do/login', 1), undefined);
  assert.equal(createHistoryEntry({ type: 'view', view: 'latest' }, 'Challenge', 'https://linux.do/latest?__cf_chl_tk=secret', 1), undefined);
  const first = createHistoryEntry({ type: 'topic', id: 1, slug: 'one' }, 'Old', undefined, 1);
  const latest = createHistoryEntry({ type: 'topic', id: 1, slug: 'one' }, 'New', 'https://linux.do/t/one/1/10', 2);
  assert.deepEqual(addHistoryEntry([first], latest), [latest]);
  assert.deepEqual(normalizeStoredHistory([{ broken: true }, latest]), [latest]);
});

test('history is capped at sixty entries', () => {
  let history = [];
  for (let id = 1; id <= 80; id += 1) {
    history = addHistoryEntry(history, createHistoryEntry({ type: 'topic', id, slug: `topic-${id}` }, `Topic ${id}`, undefined, id));
  }
  assert.equal(history.length, MAX_ENTRIES);
  assert.equal(history[0].action.id, 80);
});

test('history keeps a valid topic when its slug is missing or non-ASCII', () => {
  const missing = createHistoryEntry({ type: 'topic', id: 123 }, 'Missing slug', undefined, 1);
  const unicode = createHistoryEntry({ type: 'topic', id: 456, slug: '中文主题' }, 'Unicode slug', undefined, 2);
  assert.equal(missing.url, 'https://linux.do/t/topic/123');
  assert.deepEqual(missing.action, { type: 'topic', id: 123, slug: 'topic' });
  assert.equal(unicode.url, 'https://linux.do/t/topic/456');
});
