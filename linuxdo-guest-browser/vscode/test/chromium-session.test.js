'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ChromiumGuestSession,
  CloudflareError,
  MAX_RESPONSE_BYTES,
  assertLinuxDoRequestUrl,
  browserCookiesToHeader,
  buildBrowserFetchExpression,
  parseBrowserJsonResponse,
  parseCookieHeader
} = require('../src/chromium-session');

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
    { name: '__cf_bm', value: 'bm' },
    { name: '_forum_session', value: 'guest' }
  ]);
});

test('browser cookie export drops login state and anonymous session when login is present', () => {
  const result = browserCookiesToHeader([
    { name: 'cf_clearance', value: 'clear', domain: '.linux.do' },
    { name: '_forum_session', value: 'session', domain: 'linux.do' },
    { name: '_t', value: 'login', domain: 'linux.do' },
    { name: '__stripe_sid', value: 'stripe', domain: 'linux.do' },
    { name: '__cf_bm', value: 'bm', domain: 'other.example' }
  ]);
  assert.equal(result, 'cf_clearance=clear');
});

test('browser response parser handles success and Cloudflare status', () => {
  assert.deepEqual(parseBrowserJsonResponse({ status: 200, contentLength: 7, text: '{"a":1}' }, true), { a: 1 });
  assert.throws(
    () => parseBrowserJsonResponse({ status: 403, contentLength: 0, text: '' }, true),
    (error) => error instanceof CloudflareError && error.hasClearance
  );
  assert.throws(
    () => parseBrowserJsonResponse({ status: 429, contentLength: 0, text: '' }, true),
    /HTTP 429/
  );
});

test('browser response parser enforces timeout, JSON, and byte limits', () => {
  assert.throws(() => parseBrowserJsonResponse({ networkError: 'timeout' }, false), /超时/);
  assert.throws(() => parseBrowserJsonResponse({ status: 200, contentLength: 4, text: 'html' }, false), /可识别/);
  assert.throws(() => parseBrowserJsonResponse({
    status: 200,
    contentLength: MAX_RESPONSE_BYTES + 1,
    text: '{}'
  }, false), /数据过大/);
  assert.throws(() => parseBrowserJsonResponse({
    status: 200,
    contentLength: 0,
    tooLarge: true,
    text: ''
  }, false), /数据过大/);
});

test('browser fetch expression preserves browser credentials without injecting Cookie headers', () => {
  const expression = buildBrowserFetchExpression(new URL('https://linux.do/latest.json'), 15_000);
  assert.match(expression, /credentials:'include'/);
  assert.match(expression, /Accept:'application\/json'/);
  assert.match(expression, new RegExp(`received>${MAX_RESPONSE_BYTES}`));
  assert.doesNotMatch(expression, /Cookie:/);
  assert.match(expression, /https:\/\/linux\.do\/latest\.json/);
});

test('concurrent stops share cleanup and remove an owned temporary profile', async () => {
  const session = new ChromiumGuestSession({ get: async () => undefined });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxdo-guest-cf-'));
  fs.writeFileSync(path.join(profileDir, 'state'), 'temporary');
  let closeCalls = 0;
  session.profileDir = profileDir;
  session.browserClient = {
    send: async () => {
      closeCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    close: () => undefined
  };

  await Promise.all([session.stop(), session.stop(), session.stop()]);

  assert.equal(closeCalls, 1);
  assert.equal(session.hasSessionState(), false);
  assert.equal(fs.existsSync(profileDir), false);
});
