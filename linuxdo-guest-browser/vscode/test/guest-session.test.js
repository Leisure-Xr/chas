'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CloudflareError,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
  REQUEST_MODES,
  REQUEST_PROFILE_SECRET,
  GUEST_COOKIE_SECRET,
  USER_AGENT_SECRET,
  RateLimitError,
  SupersededRequestError,
  assertLinuxDoRequestUrl,
  cacheKeyForUrl,
  cookieHeaderFromPairs,
  isCloudflareChallenge,
  isExplicitRateLimitResponse,
  parseCookieHeader,
  parseJsonResponse,
  parseRateLimitBudget
} = require('../src/guest-session');

const VALID_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36';

test('request URL validation only allows linux.do without credentials or fragments', () => {
  assert.equal(assertLinuxDoRequestUrl('/latest.json?page=2').toString(), 'https://linux.do/latest.json?page=2');
  assert.throws(() => assertLinuxDoRequestUrl('https://example.com/latest.json'), /拒绝访问/);
  assert.throws(() => assertLinuxDoRequestUrl('https://user:pass@linux.do/latest.json'), /拒绝访问/);
  assert.throws(() => assertLinuxDoRequestUrl('https://linux.do/latest.json#secret'), /拒绝访问/);
});

test('manual cookie parsing keeps only the guest whitelist', () => {
  assert.deepEqual(parseCookieHeader(
    'cf_clearance=clear; __cf_bm=bm; cf_chl_seq_a1=seq; _forum_session=guest; __stripe_mid=no'
  ), [
    { name: 'cf_clearance', value: 'clear' },
    { name: '__cf_bm', value: 'bm' },
    { name: 'cf_chl_seq_a1', value: 'seq' },
    { name: '_forum_session', value: 'guest' }
  ]);
  assert.throws(() => parseCookieHeader('cf_clearance=clear; _t=login'), /拒绝整组导入/);
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
    cookieHeader: 'cf_clearance=clear; _forum_session=guest; __stripe_mid=drop',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
    validate: false
  });
  assert.equal(session.isRunning, false);
  assert.equal(await session.hasStoredVerification(), true);
  assert.equal([...values.values()].some((value) => String(value).includes('_t=')), false);
  assert.equal([...values.values()].some((value) => String(value).includes('__stripe_mid=')), false);
  assert.equal([...values.values()].some((value) => String(value).includes('_forum_session=guest')), true);
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
  });
  assert.deepEqual(await session.request('/latest.json'), { topic_list: { topics: [] } });
  assert.equal(calls, 1);
});

test('legacy Cookie and User-Agent migrate atomically on first read', async () => {
  const values = new Map([
    [GUEST_COOKIE_SECRET, 'cf_clearance=legacy; __cf_bm=bm'],
    [USER_AGENT_SECRET, VALID_UA]
  ]);
  const session = new GuestRequestSession(mapSecrets(values));
  const profile = await session.getStoredVerification();
  assert.equal(profile.source, 'legacy-secret-storage');
  assert.equal(profile.status, 'legacy-unverified');
  assert.equal(profile.cookieHeader, 'cf_clearance=legacy; __cf_bm=bm');
  assert.equal(typeof values.get(REQUEST_PROFILE_SECRET), 'string');
  assert.equal(await session.hasStoredVerification(), false);
});

test('failed candidate verification preserves the previously saved profile', async () => {
  const values = new Map();
  let calls = 0;
  const session = new GuestRequestSession(mapSecrets(values), {
    now: () => 100_000,
    fetchResponse: async () => {
      calls += 1;
      return { status: 403, contentType: 'text/html', cfMitigated: 'challenge', text: '<html>cf-chl-</html>' };
    }
  });
  await session.saveManualVerification({ cookieHeader: 'cf_clearance=old', userAgent: VALID_UA, validate: false });
  await assert.rejects(() => session.saveManualVerification({ cookieHeader: 'cf_clearance=new', userAgent: VALID_UA, validate: true }), CloudflareError);
  assert.equal((await session.getStoredVerification()).cookieHeader, 'cf_clearance=old');
  assert.equal(calls, 1);
});

test('verification during server cooldown sends no test request', async () => {
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), { now: () => 100_000, fetchResponse: async () => { calls += 1; return { status: 200, text: '{}' }; } });
  session.cooldownUntil = 120_000;
  await assert.rejects(() => session.saveManualVerification({ cookieHeader: 'cf_clearance=new', userAgent: VALID_UA, validate: true }), RateLimitError);
  assert.equal(calls, 0);
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

test('balanced token bucket permits two requests and then refills smoothly', async () => {
  let now = 10_000;
  const waits = [];
  const calls = [];
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    requestMode: 'balanced',
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
  assert.deepEqual(waits, [5_000, 5_000]);
});

test('fixed request modes expose their documented token buckets', () => {
  assert.deepEqual(REQUEST_MODES.fluent, { capacity: 2, refillIntervalMs: 4_000 });
  assert.deepEqual(REQUEST_MODES.balanced, { capacity: 2, refillIntervalMs: 5_000 });
  assert.deepEqual(REQUEST_MODES.careful, { capacity: 1, refillIntervalMs: 8_000 });
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
  now += 20_000;
  await assert.rejects(() => session.request('/top.json'), RateLimitError);
  assert.equal(calls, 1);
});

test('guest session falls back to a recent stale cache entry during explicit cooldown', async () => {
  let now = 30_000;
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      if (calls === 1) return { status: 200, contentLength: 11, text: '{"ok":true}' };
      return { status: 429, contentLength: 0, retryAfter: '60', text: '' };
    }
  });

  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  now += 6 * 60_000;
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.equal(calls, 2);
});

test('an unmarked 403 immediately reports verification or browser fingerprint incompatibility', async () => {
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
    (error) => error instanceof CloudflareError
  );
  assert.equal(session.cooldownUntil, 0);
  assert.equal(calls, 2);
});

test('challenge HTML bypasses cooldown and cache keys normalize topic routes', async () => {
  const session = new GuestRequestSession(memorySecrets(), {
    requestMode: 'fluent',
    fetchResponse: async () => ({ status: 403, contentType: 'text/html', cfMitigated: 'challenge', text: '<html>Just a moment... cf-chl-widget</html>' })
  });
  await assert.rejects(() => session.request('/latest.json'), CloudflareError);
  assert.equal(session.cooldownUntil, 0);
  assert.equal(isCloudflareChallenge({ contentType: 'text/html', text: 'Cloudflare Just a moment' }), true);
  assert.equal(isCloudflareChallenge({ contentType: 'text/html', text: 'Cloudflare branded rate limit page' }), false);
  assert.equal(isExplicitRateLimitResponse({ status: 403, text: '{"error_type":"rate_limit"}' }), true);
  assert.equal(isExplicitRateLimitResponse({ status: 403, text: '请求过于频繁，请稍后再试' }), true);
  assert.equal(cacheKeyForUrl(new URL('https://linux.do/t/a-topic/123.json')), 'https://linux.do/t/123.json');
  assert.equal(cacheKeyForUrl(new URL('https://linux.do/t/123/posts.json?post_ids%5B%5D=9&post_ids%5B%5D=2&post_ids%5B%5D=9')), 'https://linux.do/t/123/posts.json?post_ids=2,9');
});

test('rate limits move smart mode to careful and use the injected clock in the message', async () => {
  let now = 500_000;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    fetchResponse: async () => ({ status: 429, retryAfter: '30', contentLength: 0, text: '' })
  });
  await assert.rejects(
    () => session.request('/latest.json'),
    (error) => error instanceof RateLimitError && error.retryAt === now + 30_000 && /30 秒/.test(error.message)
  );
  assert.equal(session.getEffectiveRequestMode(), 'careful');
});

test('a marked 403 is treated as explicit rate limiting instead of an expired verification', async () => {
  const session = new GuestRequestSession(memorySecrets(), {
    fetchResponse: async () => ({ status: 403, contentLength: 0, text: '{"error_type":"rate_limit"}' })
  });
  await assert.rejects(() => session.request('/latest.json'), RateLimitError);
  assert.equal(session.getEffectiveRequestMode(), 'careful');
});

test('server RateLimit budget reserves twenty percent before another request', async () => {
  let now = 100_000;
  const waits = [];
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    sleep: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
    requestMode: 'fluent',
    fetchResponse: async () => {
      calls += 1;
      return calls === 1
        ? { status: 200, text: '{}', rateLimitLimit: '10', rateLimitRemaining: '2', rateLimitReset: '20' }
        : { status: 200, text: '{}' };
    }
  });
  await session.request('/latest.json');
  await session.request('/top.json');
  assert.deepEqual(waits, [20_000]);
  assert.deepEqual(parseRateLimitBudget({ rateLimit: 'limit=50, remaining=9, reset=30' }, 100_000), {
    limit: 50, remaining: 9, reserve: 10, resetAt: 130_000
  });
});

test('a queued continuation is cancelled immediately when a new navigation replaces it', async () => {
  let now = 100_000;
  let wake;
  const wait = new Promise((resolve) => { wake = resolve; });
  const calls = [];
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    sleep: async () => wait,
    requestMode: 'careful',
    fetchResponse: async (url) => {
      calls.push(url.pathname);
      return { status: 200, contentLength: 2, text: '{}' };
    }
  });
  await session.request('/latest.json', { requestLane: 'navigation' });
  const obsolete = session.request('/t/4/posts.json?post_ids%5B%5D=8', { requestLane: 'topic-more' });
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = session.request('/categories.json', {
    requestLane: 'navigation',
    cancelPendingLanes: ['navigation', 'topic-more', 'list-more']
  });
  await assert.rejects(obsolete, SupersededRequestError);
  now += 8_000;
  wake();
  await replacement;
  assert.deepEqual(calls, ['/latest.json', '/categories.json']);
});

test('token buckets refill at 4, 5 and 8 seconds without lane-specific cliffs', () => {
  const foreground = { continuation: false };
  const continuation = { continuation: true };
  for (const [mode, interval, capacity] of [['fluent', 4_000, 2], ['balanced', 5_000, 2], ['careful', 8_000, 1]]) {
    const session = new GuestRequestSession(memorySecrets(), { requestMode: mode, now: () => 100_000 });
    for (let index = 0; index < capacity; index += 1) session.recordRequestPermit(100_000, foreground);
    assert.equal(session.requestPermitWaitMs(100_000, continuation), interval);
    assert.equal(session.requestPermitWaitMs(100_000 + interval / 2, foreground), interval / 2);
    assert.equal(session.requestPermitWaitMs(100_000 + interval, foreground), 0);
  }
});

test('simulated pacing comparison has no hidden cliff across legacy and current intervals', () => {
  for (const interval of [1_200, 1_800, 2_500, 4_000, 5_000, 6_000, 8_000]) {
    const session = new GuestRequestSession(memorySecrets(), {
      requestRefillIntervalMs: interval,
      now: () => 100_000
    });
    session.lastRequestAt = 100_000;
    assert.equal(session.requestPermitWaitMs(100_000, {}), interval);
    assert.equal(session.requestPermitWaitMs(100_000 + Math.floor(interval / 2), {}), Math.ceil(interval / 2));
    assert.equal(session.requestPermitWaitMs(100_000 + interval, {}), 0);
  }
});

test('switching request modes preserves the current token balance', () => {
  const session = new GuestRequestSession(memorySecrets(), { requestMode: 'balanced', now: () => 100_000 });
  const token = { continuation: false };
  session.recordRequestPermit(100_000, token);
  session.recordRequestPermit(100_000, token);
  assert.equal(session.requestPermitWaitMs(100_000, token), 5_000);
  session.setRequestMode('fluent');
  assert.equal(session.requestPermitWaitMs(100_000, token), 4_000);
  session.setRequestMode('balanced');
  assert.equal(session.requestPermitWaitMs(100_000, token), 5_000);
});

test('local pacing never creates a 60 second sliding-window wait', async () => {
  let now = 100_000;
  const waits = [];
  const session = new GuestRequestSession(memorySecrets(), {
    requestMode: 'balanced',
    now: () => now,
    sleep: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
    fetchResponse: async () => ({ status: 200, contentLength: 2, text: '{}' })
  });
  for (let index = 0; index < 16; index += 1) await session.request(`/latest.json?page=${index}`);
  assert.equal(Math.max(...waits), 5_000);
  assert.equal(waits.some((wait) => wait >= 60_000), false);
});

test('smart mode promotes a stable session and recovers from careful after the minimum window', () => {
  let now = 1_000_000;
  const session = new GuestRequestSession(memorySecrets(), { requestMode: 'smart', now: () => now });
  for (let index = 0; index < 11; index += 1) session.recordSuccessfulRequest(now);
  now += 10 * 60_000;
  session.recordSuccessfulRequest(now);
  assert.equal(session.getEffectiveRequestMode(), 'fluent');
  session.setRateLimitCooldown(429, now, 60_000);
  assert.equal(session.getEffectiveRequestMode(), 'careful');
  now += 15 * 60_000;
  for (let index = 0; index < 8; index += 1) session.recordSuccessfulRequest(now);
  assert.equal(session.getEffectiveRequestMode(), 'balanced');
});

test('any 403 resets smart stability so a session cannot promote early', () => {
  let now = 2_000_000;
  const session = new GuestRequestSession(memorySecrets(), {
    requestMode: 'smart',
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => ({ status: 403, contentLength: 0, text: '' })
  });
  session.lastSuccessfulRequestAt = now;
  session.smartSuccesses = 11;
  session.smartStableSince = now - 10 * 60_000;
  return assert.rejects(() => session.request('/latest.json'), CloudflareError).then(() => {
    assert.equal(session.smartSuccesses, 0);
    now += 1;
    session.recordSuccessfulRequest(now);
    assert.equal(session.getEffectiveRequestMode(), 'balanced');
  });
});

test('stale cache response info preserves source and stored time through cooldown', async () => {
  let now = 100_000;
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      return calls === 1 ? { status: 200, contentLength: 11, text: '{"ok":true}' } : { status: 429, retryAfter: '60', text: '' };
    }
  });
  await session.request('/latest.json');
  now += 6 * 60_000;
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.deepEqual(session.consumeLastResponseInfo(), {
    source: 'stale-cache', storedAt: 100_000, reason: 'rate-limit', retryAt: 520_000, status: 429
  });
  now = 100_000 + 6 * 60 * 60_000 + 1;
  await assert.rejects(() => session.request('/latest.json'), RateLimitError);
});

test('network failure falls back to a stale cache without entering server cooldown', async () => {
  let now = 100_000;
  let calls = 0;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => {
      calls += 1;
      return calls === 1
        ? { status: 200, contentLength: 11, text: '{"ok":true}' }
        : { networkError: 'ECONNRESET' };
    }
  });
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  now += 6 * 60_000;
  assert.deepEqual(await session.request('/latest.json'), { ok: true });
  assert.deepEqual(session.consumeLastResponseInfo(), {
    source: 'stale-cache', storedAt: 100_000, reason: 'offline'
  });
  assert.equal(session.cooldownUntil, 0);
  assert.equal(calls, 2);
});

test('manual continuation takes priority over queued automatic continuation', async () => {
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const session = new GuestRequestSession(memorySecrets(), {
    minRequestIntervalMs: 0,
    fetchResponse: async (url) => {
      calls.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/latest.json') return first;
      return { status: 200, contentLength: 2, text: '{}' };
    }
  });
  const initial = session.request('/latest.json', { requestLane: 'navigation' });
  await new Promise((resolve) => setImmediate(resolve));
  const automatic = session.request('/t/9/posts.json?post_ids%5B%5D=1', { requestLane: 'topic-more' });
  const manual = session.request('/t/9/posts.json?post_ids%5B%5D=2', { requestLane: 'manual-more', continuation: true });
  release({ status: 200, contentLength: 2, text: '{}' });
  await Promise.all([initial, automatic, manual]);
  assert.deepEqual(calls, ['/latest.json', '/t/9/posts.json?post_ids%5B%5D=2', '/t/9/posts.json?post_ids%5B%5D=1']);
});

test('refreshing a cached key moves it to the LRU end before capacity eviction', async () => {
  let now = 3_000_000;
  const session = new GuestRequestSession(memorySecrets(), {
    now: () => now,
    minRequestIntervalMs: 0,
    fetchResponse: async () => ({ status: 200, contentLength: 2, text: '{}' })
  });
  const latestKey = 'https://linux.do/latest.json';
  await session.request('/latest.json');
  for (let index = 0; index < 79; index += 1) session.cache.set(`filler-${index}`, { data: {}, storedAt: now });
  now += 1;
  await session.request('/latest.json', { force: true });
  await session.request('/top.json?period=weekly');
  assert.equal(session.cache.has(latestKey), true);
  assert.equal(session.cache.has('filler-0'), false);
});

function memorySecrets() {
  return mapSecrets(new Map());
}

function mapSecrets(values) {
  return {
    get: async (key) => values.get(key),
    store: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key)
  };
}
