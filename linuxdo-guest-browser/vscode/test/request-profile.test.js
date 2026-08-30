'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRequestProfile,
  parseCapturedRequest,
  parseCurlRequest,
  profileSummary,
  sanitizeStoredProfile,
  tokenizeCurl
} = require('../src/request-profile');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const EDGE_UA = `${CHROME_UA} Edg/128.0.0.0`;

test('raw Request Headers create one filtered anonymous profile', () => {
  const profile = parseCapturedRequest([
    'cookie: cf_clearance=clear; __cf_bm=bm; cf_chl_seq_a1=seq; _forum_session=guest; __stripe_mid=drop',
    `user-agent: ${CHROME_UA}`,
    'sec-ch-ua: "Chromium";v="128", "Google Chrome";v="128", "Not=A?Brand";v="99"',
    'sec-ch-ua-platform: "Windows"',
    'accept-language: zh-CN,zh;q=0.9'
  ].join('\n'));
  assert.equal(profile.cookieHeader, 'cf_clearance=clear; __cf_bm=bm; cf_chl_seq_a1=seq; _forum_session=guest');
  assert.equal(profile.userAgent, CHROME_UA);
  assert.equal(profile.clientHints['sec-ch-ua-platform'], '"Windows"');
  assert.equal(profile.browser.name, 'Chrome');
  assert.equal(profile.browser.major, 128);
  assert.equal(profile.status, 'unverified');
});

test('Chrome Bash cURL is parsed without executing it', () => {
  const command = `curl 'https://linux.do/latest.json' \\\n+    -H 'cookie: cf_clearance=clear; _forum_session=guest' \\\n+    -H 'sec-ch-ua: "Chromium";v="128", "Google Chrome";v="128"' \\\n+    -H 'sec-ch-ua-platform: "Windows"' \\\n+    -H 'user-agent: ${CHROME_UA}' --compressed`;
  const profile = parseCapturedRequest(command);
  assert.equal(profile.requestUrl, 'https://linux.do/latest.json');
  assert.equal(profile.browser.name, 'Chrome');
  assert.match(profile.source, /^curl:/);
});

test('Windows CMD and PowerShell continuations parse Edge cURL', () => {
  const cmd = `curl.exe "https://linux.do/latest.json" ^\r\n-H "cookie: cf_clearance=edge" ^\r\n-H "user-agent: ${EDGE_UA}" ^\r\n-H "sec-ch-ua: \\"Chromium\\";v=\\"128\\", \\"Microsoft Edge\\";v=\\"128\\"" ^\r\n-H "sec-ch-ua-platform: \\"Windows\\""`;
  const cmdProfile = parseCapturedRequest(cmd, 'edge');
  assert.equal(cmdProfile.browser.name, 'Edge');
  const powershell = cmd.replace(/\^\r\n/g, '`\r\n');
  assert.equal(parseCapturedRequest(powershell, 'edge').browser.major, 128);
});

test('Brave Copy as cURL is parsed with its client hints', () => {
  const profile = parseCapturedRequest(
    `curl 'https://linux.do/latest.json' -H 'cookie: cf_clearance=brave' -H 'user-agent: ${CHROME_UA}' -H 'sec-ch-ua: "Chromium";v="128", "Brave";v="128"' -H 'sec-ch-ua-platform: "Windows"'`,
    'brave'
  );
  assert.equal(profile.browser.name, 'Brave');
  assert.equal(profile.clientHints['sec-ch-ua-platform'], '"Windows"');
  assert.match(profile.source, /^curl:/);
});

test('explicit source browser must match the captured request profile', () => {
  const chromeCapture = `curl 'https://linux.do/latest.json' -H 'cookie: cf_clearance=clear' -H 'user-agent: ${CHROME_UA}'`;
  assert.throws(() => parseCapturedRequest(chromeCapture, 'edge'), /选择的来源浏览器是 Edge/);
  assert.throws(() => parseCapturedRequest(chromeCapture, 'brave'), /选择的来源浏览器是 Brave/);
  assert.throws(() => parseCapturedRequest(chromeCapture, 'chromium'), /选择的来源浏览器是 Chromium/);
  assert.equal(parseCapturedRequest(chromeCapture, 'chrome').browser.name, 'Chrome');
  assert.throws(() => createRequestProfile({
    cookieHeader: 'cf_clearance=clear', userAgent: CHROME_UA, source: 'manual:edge'
  }), /选择的来源浏览器是 Edge/);
});

test('mixed versions and platforms are rejected', () => {
  assert.throws(() => createRequestProfile({
    cookieHeader: 'cf_clearance=clear',
    userAgent: CHROME_UA,
    headers: { 'sec-ch-ua': '"Google Chrome";v="127"' }
  }), /主版本不一致/);
  assert.throws(() => createRequestProfile({
    cookieHeader: 'cf_clearance=clear',
    userAgent: CHROME_UA,
    headers: { 'sec-ch-ua-platform': '"macOS"' }
  }), /参数混用/);
});

test('login cookies and credential headers reject the whole capture', () => {
  assert.throws(() => parseCapturedRequest(`cookie: cf_clearance=clear; _t=login\nuser-agent: ${CHROME_UA}`), /拒绝整组导入/);
  assert.throws(() => parseCapturedRequest(`cookie: cf_clearance=clear\nuser-agent: ${CHROME_UA}\nx-csrf-token: secret`), /凭据标头/);
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json' -H 'cookie: cf_clearance=clear' -H 'user-agent: ${CHROME_UA}' -H 'authorization: Bearer secret'`), /凭据标头/);
});

test('document cURL is rejected and quotes are validated', () => {
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest' -H 'cookie: cf_clearance=clear' -H 'user-agent: ${CHROME_UA}'`), /不要复制 \/latest 文档/);
  assert.throws(() => tokenizeCurl("curl 'https://linux.do/latest.json"), /引号不完整/);
  assert.equal(parseCurlRequest(`curl 'https://linux.do/latest.json' -A '${CHROME_UA}' -b 'cf_clearance=clear'`).url, 'https://linux.do/latest.json');
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json' -u 'name:password' -A '${CHROME_UA}' -b 'cf_clearance=clear'`), /认证参数/);
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json' -uuser:secret -A'${CHROME_UA}' -b'cf_clearance=clear'`), /认证参数/);
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json' -Uproxy:secret -A'${CHROME_UA}' -b'cf_clearance=clear'`), /认证参数/);
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json' -Eclient.pem -A'${CHROME_UA}' -b'cf_clearance=clear'`), /认证参数/);
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json' -H'authorization: Bearer secret' -A'${CHROME_UA}' -b'cf_clearance=clear'`), /凭据标头/);
  assert.throws(() => parseCapturedRequest(`curl 'https://name:password@linux.do/latest.json' -A '${CHROME_UA}' -b 'cf_clearance=clear'`), /包含登录/);
  assert.throws(() => parseCapturedRequest(`curl 'https://linux.do/latest.json?api_key=secret' -A '${CHROME_UA}' -b 'cf_clearance=clear'`), /API 凭据/);
});

test('HTTP/2 pseudo headers must identify the exact latest JSON endpoint', () => {
  const capture = `:authority: linux.do\n:method: GET\n:path: /latest.json\n:scheme: https\ncookie: cf_clearance=clear\nuser-agent: ${CHROME_UA}`;
  assert.equal(parseCapturedRequest(capture).requestUrl, 'https://linux.do/latest.json');
  assert.throws(() => parseCapturedRequest(capture.replace('/latest.json', '/evil.json')), /请求来源不正确/);
  assert.throws(() => parseCapturedRequest(capture.replace('linux.do', 'example.com')), /请求来源不正确/);
});

test('profile summary and stored sanitization never expose secret values', () => {
  const profile = createRequestProfile({ cookieHeader: 'cf_clearance=secret-value; __cf_bm=other-secret', userAgent: CHROME_UA });
  profile.status = 'verified';
  profile.verifiedAt = 123;
  const restored = sanitizeStoredProfile(JSON.stringify(profile));
  const summary = profileSummary(restored);
  assert.deepEqual(summary.cookieNames, ['cf_clearance', '__cf_bm']);
  assert.equal(summary.status, 'verified');
  assert.equal(JSON.stringify(summary).includes('secret-value'), false);
  assert.equal(JSON.stringify(summary).includes(CHROME_UA), false);
});
