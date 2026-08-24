'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CloudflareError,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
  RateLimitError,
  assertLinuxDoRequestUrl,
  cookieHeaderFromPairs,
  parseCookieHeader,
  parseJsonResponse
} = require('../src/guest-session');

test('request URL validation only allows linux.do without credentials or fragments', () => {
  assert.equal(assertLinuxDoRequestUrl('/latest.json?page=2').toString(), 'https://linux.do/latest.json?page=2');
  assert.throws(() => assertLinuxDoRequestUrl('https://example.com/latest.json'), /拒绝访问/);
  assert.throws(() => assertLinuxDoRequestUrl('https://user:pass@linux.do/latest.json'), /拒绝访问/);
  assert.throws(() => assertLinuxDoRequestUrl('https://linux.do/latest.json#secret'), /拒绝访问/);
});

test('manual cookie parsing keeps only the guest whitelist', () => {
  assert.deepEqual(parseCookieHeader(
    'cf_clearance=clear; __cf_bm=bm; _forum_session=guest; __stripe_mid=no; _t=login'
  ), [
    { name: 'cf_clearance', value: 'clear' },
    { name: '__cf_bm', value: 'bm' }
  ]);
  assert.equal(cookieHeaderFromPairs(parseCookieHeader('clearance-only')), 'cf_clearance=clearance-only');
});

test('response parser handles success, Cloudflare and byte limits', () => {
  assert.deepEqual(parseJsonResponse({ status: 200, contentLength: 7, text: '{"a":1}' }, true), { a: 1 });
  assert.throws(
    () => parseJsonResponse({ status: 403, contentLength: 0, text: '' }, true),
    (error) => error instanceof CloudflareError && error.hasClearance
  );
  assert.throws(() => parseJsonResponse({ status: 429, contentLength: 0, text: '' }, true), /HTTP 429/);
  assert.throws(() => parseJsonResponse({ networkError: 'timeout' }, false), /超时/);
  assert.throws(() => parseJsonResponse({ status: 200, contentLength: 4, text: 'html' }, false), /可识别/);
  assert.throws(() => parseJsonResponse({
    status: 200,
    contentLength: MAX_RESPONSE_BYTES + 1,
    text: '{}'
  }, false), /数据过大/);
});

test('manual session stores structurally valid parameters without owning a browser', async () => {
  const values = new Map();
  const session = new GuestRequestSession({
    get: async (key) => values.get(key),
    store: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key)
  });
  await session.saveManualVerification({
    cookieHeader: 'cf_clearance=clear; _t=login; _forum_session=drop',
    userAgent: 'Mozilla/5.0 Example Chromium User Agent 120.0',
    validate: false
  });
  assert.equal(session.isRunning, false);
  assert.equal(await session.hasStoredVerification(), true);
  assert.equal([...values.values()].some((value) => String(value).includes('_t=')), false);
  assert.equal([...values.values()].some((value) => String(value).includes('_forum_session=')), false);
});

test('validated manual parameters seed the latest-page cache', async () => {
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      return { status: 200, contentLength: 28, text: '{"topic_list":{"topics":[]}}' };
    }
  });
  await session.saveManualVerification({
    cookieHeader: 'cf_clearance=clear',
    userAgent: 'Mozilla/5.0 Example Chromium User Agent 120.0'
  });
  assert.deepEqual(await session.request('/latest.json'), { topic_list: { topics: [] } });
  assert.equal(calls, 1);
});

test('guest session coalesces duplicate requests and serves a fresh cache entry', async () => {
  let calls = 0;
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const session = new GuestRequestSession(memorySecrets(), {
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      return response;
    }
  });

  const first = session.request('/latest.json');
  const duplicate = session.request('/latest.json');
  await Promise.resolve();
  release({ status: 200, contentLength: 11, text: '{"ok":true}' });
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await duplicate, { ok: true });
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.equal(calls, 1);
});

test('guest session serializes different URLs and enforces the minimum interval', async () => {
  let now = 10_000;
  const waits = [];
  const calls = [];
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    minRequestIntervalMs: 1_500,
    fetchResponse: async (url) => {
      calls.push(url.pathname);
      return { status: 200, contentLength: 2, text: '{}' };
    }
  });

  await Promise.all([session.request('/latest.json'), session.request('/top.json')]);
  assert.deepEqual(calls, ['/latest.json', '/top.json']);
  assert.deepEqual(waits, [1_500]);
});

test('guest session enters cooldown after rate limiting without retrying', async () => {
  let calls = 0;
  let now = 20_000;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      return { status: 429, contentLength: 0, retryAfter: '30', text: '' };
    }
  });

  await assert.rejects(() => session.request('/latest.json'), RateLimitError);
  now += 5_000;
  await assert.rejects(() => session.request('/top.json'), RateLimitError);
  assert.equal(calls, 1);
});

test('guest session falls back to a recent stale cache entry during cooldown', async () => {
  let now = 30_000;
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      if (calls === 1) return { status: 200, contentLength: 11, text: '{"ok":true}' };
      return { status: 403, contentLength: 0, text: '' };
    }
  });

  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  now += 120_000;
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.equal(calls, 2);
});

function memorySecrets() {
  const values = new Map();
  return {
    get: async (key) => values.get(key),
    store: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key)
  };
}
