'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShareCode, parseShareCode } = require('../src/share-code');

const TOPIC = { id: 12345, slug: 'hello-linux-do', title: '公开主题' };
const NOW = 1_800_000_000_000;

const CROSS_PLATFORM_FIXTURE = 'LDGS1.dj0xJmlkPTEyMzQ1JnNsdWc9aGVsbG8tbGludXgtZG8mdGl0bGU9JUU1JTg1JUFDJUU1JUJDJTgwJUU0JUI4JUJCJUU5JUEyJTk4JmlhdD0xODAwMDAwMDAwMDAwJmV4cD0xODAwMDAzNjAwMDAw.e8e9aca9e05466c1';

test('VS Code share code is byte-compatible with the PyCharm producer', () => {
  const code = createShareCode(TOPIC, 60 * 60 * 1000, NOW);
  assert.equal(code, CROSS_PLATFORM_FIXTURE);
});

test('VS Code opens the stable share code produced by PyCharm', () => {
  assert.deepEqual(parseShareCode(CROSS_PLATFORM_FIXTURE, NOW + 1), {
    ...TOPIC,
    createdAt: NOW,
    expiresAt: NOW + 60 * 60 * 1000,
    url: 'https://linux.do/t/hello-linux-do/12345'
  });
});

test('share code rejects damage, expiry, future timestamps and excessive lifetimes', () => {
  const code = createShareCode(TOPIC, 60 * 60 * 1000, NOW);
  assert.throws(() => parseShareCode(`${code.slice(0, -1)}0`, NOW), /损坏|修改/);
  assert.throws(() => parseShareCode(code, NOW + 60 * 60 * 1000), /失效/);
  assert.throws(() => parseShareCode(code, NOW - 6 * 60 * 1000), /晚于/);
  assert.throws(() => createShareCode(TOPIC, 8 * 24 * 60 * 60 * 1000, NOW), /有效期/);
});

test('share code contains only public topic metadata', () => {
  const code = createShareCode({ ...TOPIC, cookie: 'secret', userAgent: 'secret' }, 600_000, NOW);
  const decoded = Buffer.from(code.split('.')[1], 'base64url').toString('utf8');
  assert.doesNotMatch(decoded, /cookie|userAgent|secret/i);
});
