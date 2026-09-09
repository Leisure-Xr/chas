'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ImageProxy, ImageProxyError, MAX_CACHE_ENTRIES, normalizeImageUrl } = require('../src/image-proxy');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xff, 0xe0]);

function createProxy(overrides = {}) {
  const calls = [];
  const session = {
    requestImage: async (url) => {
      calls.push(String(url));
      if (overrides.sessionError) throw overrides.sessionError;
      return overrides.sessionResult || { contentType: 'image/png', body: PNG };
    }
  };
  const proxy = new ImageProxy({
    session,
    fetchExternal: async (url) => {
      calls.push(String(url));
      return overrides.externalResult || { contentType: 'image/png', body: PNG };
    }
  });
  return { proxy, calls };
}

test('unsupported schemes are rejected before any I/O', async () => {
  const { proxy, calls } = createProxy();
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'http://linux.do/a.png', 'data:image/png;base64,AAAA']) {
    await assert.rejects(() => proxy.load(value), (error) => error.reason === 'unsupported');
  }
  assert.equal(calls.length, 0);
  assert.equal(normalizeImageUrl('vscode-webview-resource://x/a.png'), undefined);
});

test('a cache hit never reaches the session again', async () => {
  const { proxy, calls } = createProxy();
  const first = await proxy.load('https://linux.do/uploads/a.png');
  const second = await proxy.load('https://linux.do/uploads/a.png');
  assert.equal(first, second);
  assert.match(first, /^data:image\/png;base64,/);
  assert.equal(calls.length, 1);
});

test('concurrent requests for one URL collapse into a single fetch', async () => {
  const { proxy, calls } = createProxy();
  const results = await Promise.all([
    proxy.load('https://linux.do/uploads/b.png'),
    proxy.load('https://linux.do/uploads/b.png'),
    proxy.load('https://linux.do/uploads/b.png')
  ]);
  assert.equal(new Set(results).size, 1);
  assert.equal(calls.length, 1);
});

test('cross-origin images never exceed the external concurrency cap', async () => {
  let active = 0;
  let peak = 0;
  const proxy = new ImageProxy({
    session: { requestImage: async () => { throw new Error('linux.do path must not be used'); } },
    fetchExternal: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { contentType: 'image/png', body: PNG };
    }
  });
  await Promise.all([1, 2, 3, 4, 5].map((index) => proxy.load(`https://example.com/${index}.png`)));
  assert.equal(peak, 2);
});

test('oversized bodies and non-image content types are refused', async () => {
  const large = createProxy({ sessionResult: { contentType: 'image/png', body: Buffer.alloc(3 * 1024 * 1024, 1) } });
  await assert.rejects(() => large.proxy.load('https://linux.do/big.png'), (error) => error.reason === 'too-large');

  const html = createProxy({ sessionResult: { contentType: 'text/html; charset=utf-8', body: Buffer.from('<html>') } });
  await assert.rejects(() => html.proxy.load('https://linux.do/challenge.png'), (error) => error.reason === 'blocked');

  const empty = createProxy({ sessionResult: { contentType: 'image/png', body: Buffer.alloc(0) } });
  await assert.rejects(() => empty.proxy.load('https://linux.do/empty.png'), (error) => error.reason === 'network');
});

test('a session cooldown propagates its reason and retry time without caching', async () => {
  const retryAt = Date.now() + 30_000;
  const { proxy, calls } = createProxy({ sessionError: new ImageProxyError('cooldown', '限流中', retryAt) });
  await assert.rejects(() => proxy.load('https://linux.do/c.png'), (error) => {
    assert.equal(error.reason, 'cooldown');
    assert.equal(error.retryAt, retryAt);
    return true;
  });
  assert.equal(proxy.cache.size, 0);
  assert.equal(calls.length, 1);
});

test('the byte and entry budgets evict the oldest entries first', async () => {
  const proxy = new ImageProxy({
    session: { requestImage: async () => ({ contentType: 'image/png', body: Buffer.alloc(512 * 1024, 7) }) }
  });
  // 512 KB each against a 24 MB budget: entry 49 must push the first one out.
  for (let index = 0; index < 49; index += 1) {
    await proxy.load(`https://linux.do/uploads/${index}.png`);
  }
  assert.ok(proxy.cacheBytes <= 24 * 1024 * 1024);
  assert.ok(proxy.cache.size < 49);
  assert.equal(proxy.cache.has('https://linux.do/uploads/0.png'), false);
  assert.equal(proxy.cache.has('https://linux.do/uploads/48.png'), true);
  assert.ok(proxy.cache.size <= MAX_CACHE_ENTRIES);
});

test('a cache hit is promoted to the LRU end', async () => {
  const proxy = new ImageProxy({
    session: { requestImage: async () => ({ contentType: 'image/png', body: PNG }) }
  });
  await proxy.load('https://linux.do/1.png');
  await proxy.load('https://linux.do/2.png');
  await proxy.load('https://linux.do/1.png');
  assert.deepEqual([...proxy.cache.keys()], ['https://linux.do/2.png', 'https://linux.do/1.png']);
  proxy.clear();
  assert.equal(proxy.cache.size, 0);
  assert.equal(proxy.cacheBytes, 0);
});
