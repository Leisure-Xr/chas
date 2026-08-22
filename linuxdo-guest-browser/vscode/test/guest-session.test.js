'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CloudflareError,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
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
