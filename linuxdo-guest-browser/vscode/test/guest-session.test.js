'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CloudflareError,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
  RateLimitError,
  SupersededRequestError,
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

test('guest session allows a two-request burst and refills at the configured rate', async () => {
  let now = 10_000;
  const waits = [];
  const calls = [];
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    requestBurstCapacity: 2,
    requestRefillIntervalMs: 2_200,
    fetchResponse: async (url) => {
      calls.push(url.pathname);
      return { status: 200, contentLength: 2, text: '{}' };
    }
  });

  await Promise.all([
    session.request('/latest.json'),
    session.request('/top.json'),
    session.request('/categories.json'),
    session.request('/search.json?q=test')
  ]);
  assert.deepEqual(calls, ['/latest.json', '/top.json', '/categories.json', '/search.json']);
  assert.deepEqual(waits, [2_200, 2_200]);
});

test('frequency comparison covers 800, 1500 and 2200 millisecond refill rates', async () => {
  assert.deepEqual(await Promise.all([800, 1_500, 2_200].map(simulateFiveRequests)), [2_400, 4_500, 6_600]);
});

test('new navigation cancels an obsolete queued navigation before it reaches the site', async () => {
  let releaseFirst;
  const calls = [];
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const session = new GuestRequestSession(memorySecrets(), {
    requestRefillIntervalMs: 0,
    fetchResponse: async (url) => {
      calls.push(url.pathname);
      if (url.pathname === '/latest.json') return firstResponse;
      return { status: 200, contentLength: 2, text: '{}' };
    }
  });

  const first = session.request('/latest.json', { requestLane: 'navigation' });
  await new Promise((resolve) => setImmediate(resolve));
  const obsolete = session.request('/top.json', { requestLane: 'navigation' });
  const newest = session.request('/categories.json', { requestLane: 'navigation' });
  releaseFirst({ status: 200, contentLength: 2, text: '{}' });

  await first;
  await assert.rejects(obsolete, SupersededRequestError);
  await newest;
  assert.deepEqual(calls, ['/latest.json', '/categories.json']);
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

test('a 403 after a recent success is treated as temporary rate limiting', async () => {
  let now = 40_000;
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    requestRefillIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      return calls === 1
        ? { status: 200, contentLength: 11, text: '{"ok":true}' }
        : { status: 403, contentLength: 0, text: '' };
    }
  });

  await session.request('/latest.json');
  now += 1_000;
  await assert.rejects(
    () => session.request('/top.json'),
    (error) => error instanceof RateLimitError && error.status === 403
  );
  now += 5_000;
  await assert.rejects(
    () => session.request('/categories.json'),
    (error) => error instanceof RateLimitError && error.status === 403
  );
  assert.equal(calls, 2);
});

async function simulateFiveRequests(refillInterval) {
  let now = 100_000;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    requestBurstCapacity: 2,
    requestRefillIntervalMs: refillInterval,
    fetchResponse: async () => ({ status: 200, contentLength: 2, text: '{}' })
  });
  await Promise.all(Array.from({ length: 5 }, (_, index) => session.request(`/latest.json?page=${index}`)));
  return now - 100_000;
}

function memorySecrets() {
  const values = new Map();
  return {
    get: async (key) => values.get(key),
    store: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key)
  };
}
