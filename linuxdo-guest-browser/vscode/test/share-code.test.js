'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShareCode, generatePassword, parseShareCode } = require('../src/share-code');

const TOPIC = { id: 12345, slug: 'hello-linux-do', title: '公开主题' };
const PASSWORD = 'Correct-Horse-电池-9!';
const NOW = 1_800_000_000_000;
const FIXED_SALT = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
const FIXED_NONCE = Buffer.from(Array.from({ length: 12 }, (_, index) => 160 + index));
const CROSS_PLATFORM_FIXTURE = 'LDGS2.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.qPTXbADi28MeJ1EAKqDgqJFx-Squ4i8IGrrrP620_Fc28nn5sFlLW0MrpvnbMhAnVbtAnlXZNIouEjFJe3O0-6QBSK_BfJIs3ZsOONXwLy8VjIdmEtE4w5GtuAgtYaWZUuuuDY9KRQSbwNBoPlMfIei9xOq0wZXlwhKWw3RmaA';

function fixedCode(duration = 60 * 60 * 1000) {
  return createShareCode(TOPIC, PASSWORD, duration, NOW, { salt: FIXED_SALT, nonce: FIXED_NONCE });
}

test('VS Code encrypted share is byte-compatible with the PyCharm producer', () => {
  assert.equal(fixedCode(), CROSS_PLATFORM_FIXTURE);
});

test('VS Code decrypts the encrypted share produced by PyCharm', () => {
  assert.deepEqual(parseShareCode(CROSS_PLATFORM_FIXTURE, PASSWORD, NOW + 1), {
    ...TOPIC,
    createdAt: NOW,
    expiresAt: NOW + 60 * 60 * 1000,
    url: 'https://linux.do/t/hello-linux-do/12345'
  });
});

test('encrypted content does not expose topic metadata or expiry', () => {
  const code = fixedCode();
  const visible = code.split('.').slice(1).map((part) => Buffer.from(part, 'base64url').toString('utf8')).join(' ');
  assert.doesNotMatch(visible, /12345|hello-linux-do|公开主题|iat|exp|1800003600000/);
});

test('encrypted share rejects wrong passwords, damage, expiry and future timestamps', () => {
  const code = fixedCode();
  const parts = code.split('.');
  const sealed = Buffer.from(parts[3], 'base64url');
  sealed[0] ^= 1;
  const damaged = `${parts.slice(0, 3).join('.')}.${sealed.toString('base64url')}`;
  assert.throws(() => parseShareCode(code, 'Wrong-Password-123!', NOW), /密码不正确|修改/);
  assert.throws(() => parseShareCode(damaged, PASSWORD, NOW), /密码不正确|修改/);
  assert.throws(() => parseShareCode(code, PASSWORD, NOW + 60 * 60 * 1000), /失效/);
  assert.throws(() => parseShareCode(code, PASSWORD, NOW - 6 * 60 * 1000), /晚于/);
});

test('password, duration and legacy validation are enforced', () => {
  assert.throws(() => createShareCode(TOPIC, 'too-short', 600_000, NOW), /至少/);
  assert.throws(() => createShareCode(TOPIC, PASSWORD, 8 * 24 * 60 * 60 * 1000, NOW), /有效期/);
  assert.throws(() => parseShareCode('LDGS1.legacy.value', PASSWORD, NOW), /旧版|停止支持/);
  const generated = generatePassword();
  assert.equal(generated.length, 20);
  assert.match(generated, /[A-Z]/);
  assert.match(generated, /[a-z]/);
  assert.match(generated, /[2-9]/);
  assert.match(generated, /[!@#$%*\-_=+]/);
});

test('encrypted payload contains only public topic metadata', () => {
  const code = createShareCode({ ...TOPIC, cookie: 'secret', userAgent: 'secret' }, PASSWORD, 600_000, NOW, {
    salt: FIXED_SALT,
    nonce: FIXED_NONCE
  });
  const decoded = parseShareCode(code, PASSWORD, NOW);
  assert.doesNotMatch(JSON.stringify(decoded), /cookie|userAgent|secret/i);
});
