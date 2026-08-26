'use strict';

const crypto = require('crypto');

const PREFIX = 'LDGS2';
const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const AAD = Buffer.from(PREFIX, 'ascii');
const PASSWORD_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%*-_=+'
];

function createShareCode(topic, password, durationMs = 60 * 60 * 1000, now = Date.now(), options = {}) {
  const normalized = normalizeTopic(topic);
  const normalizedPassword = normalizePassword(password);
  const duration = Number(durationMs);
  const createdAt = Number(now);
  if (!Number.isInteger(duration) || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
    throw new Error('分享有效期必须在 1 分钟到 7 天之间。');
  }
  if (!Number.isInteger(createdAt) || createdAt <= 0) throw new Error('分享时间无效。');

  const salt = fixedLengthBytes(options.salt || crypto.randomBytes(SALT_BYTES), SALT_BYTES, '分享盐');
  const nonce = fixedLengthBytes(options.nonce || crypto.randomBytes(NONCE_BYTES), NONCE_BYTES, '分享随机数');
  const key = crypto.pbkdf2Sync(normalizedPassword, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
  const payload = createPayload(normalized, createdAt, createdAt + duration);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const sealed = Buffer.concat([
    cipher.update(payload),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  key.fill(0);
  return `${PREFIX}.${salt.toString('base64url')}.${nonce.toString('base64url')}.${sealed.toString('base64url')}`;
}

function parseShareCode(input, password, now = Date.now()) {
  const code = String(input || '').trim();
  if (code.startsWith('LDGS1.')) {
    throw new Error('旧版分享内容没有密码加密，已停止支持。请让发送方使用新版插件重新生成。');
  }
  if (code.length > 4096) throw new Error('加密分享内容过长。');
  const parts = code.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX || parts.slice(1).some((part) => !isBase64Url(part))) {
    throw new Error('加密分享内容格式不正确。');
  }
  const normalizedPassword = normalizePassword(password);

  let salt;
  let nonce;
  let sealed;
  try {
    salt = fixedLengthBytes(decodeBase64Url(parts[1]), SALT_BYTES, '分享盐');
    nonce = fixedLengthBytes(decodeBase64Url(parts[2]), NONCE_BYTES, '分享随机数');
    sealed = decodeBase64Url(parts[3]);
  } catch {
    throw new Error('加密分享内容格式不正确。');
  }
  if (sealed.length <= TAG_BYTES || sealed.length > 4096) throw new Error('加密分享内容格式不正确。');

  const key = crypto.pbkdf2Sync(normalizedPassword, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
  let payload;
  try {
    const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
    const tag = sealed.subarray(sealed.length - TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('分享密码不正确，或加密分享内容已被修改。');
  } finally {
    key.fill(0);
  }

  const values = parsePayload(payload);
  const topic = normalizeTopic({ id: Number(values.id), slug: values.slug, title: values.title });
  const createdAt = Number(values.iat);
  const expiresAt = Number(values.exp);
  const currentTime = Number(now);
  if (![createdAt, expiresAt, currentTime].every(Number.isInteger) || createdAt <= 0 || expiresAt <= createdAt) {
    throw new Error('分享时间信息无效。');
  }
  if (createdAt > currentTime + CLOCK_SKEW_MS) throw new Error('分享生成时间晚于当前设备时间。');
  if (expiresAt - createdAt > MAX_DURATION_MS || expiresAt - createdAt < MIN_DURATION_MS) {
    throw new Error('分享有效期无效。');
  }
  if (expiresAt <= currentTime) {
    const expiredAt = new Date(expiresAt).toLocaleString('zh-CN', { hour12: false });
    throw new Error(`加密分享已于 ${expiredAt} 失效。`);
  }
  return {
    ...topic,
    createdAt,
    expiresAt,
    url: `https://linux.do/t/${topic.slug}/${topic.id}`
  };
}

function generatePassword(length = 20) {
  const size = Number(length);
  if (!Number.isInteger(size) || size < MIN_PASSWORD_LENGTH || size > MAX_PASSWORD_LENGTH) {
    throw new Error('生成密码长度无效。');
  }
  const alphabet = PASSWORD_GROUPS.join('');
  const characters = PASSWORD_GROUPS.map((group) => group[crypto.randomInt(group.length)]);
  while (characters.length < size) characters.push(alphabet[crypto.randomInt(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join('');
}

function validatePassword(value) {
  normalizePassword(value);
}

function normalizePassword(value) {
  const normalized = String(value || '').normalize('NFKC');
  const length = [...normalized].length;
  if (length < MIN_PASSWORD_LENGTH) throw new Error(`分享密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`);
  if (length > MAX_PASSWORD_LENGTH) throw new Error(`分享密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符。`);
  return normalized;
}

function normalizeTopic(topic) {
  const id = Number(topic?.id);
  const slug = String(topic?.slug || '').trim();
  const title = String(topic?.title || '').replace(/[\r\n]+/g, ' ').trim();
  if (!Number.isInteger(id) || id <= 0) throw new Error('主题编号无效。');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(slug)) throw new Error('主题地址无效。');
  if (!title || title.length > 200) throw new Error('主题标题无效。');
  return { id, slug, title };
}

function createPayload(topic, createdAt, expiresAt) {
  const params = new URLSearchParams();
  params.set('v', '2');
  params.set('id', String(topic.id));
  params.set('slug', topic.slug);
  params.set('title', topic.title);
  params.set('iat', String(createdAt));
  params.set('exp', String(expiresAt));
  return Buffer.from(params.toString(), 'utf8');
}

function parsePayload(payload) {
  const params = new URLSearchParams(payload.toString('utf8'));
  const allowed = ['v', 'id', 'slug', 'title', 'iat', 'exp'];
  if ([...params.keys()].some((key) => !allowed.includes(key))
      || allowed.some((key) => params.getAll(key).length !== 1)
      || params.get('v') !== '2') {
    throw new Error('加密分享内容无效。');
  }
  return Object.fromEntries(allowed.map((key) => [key, params.get(key)]));
}

function fixedLengthBytes(value, length, label) {
  const bytes = Buffer.from(value);
  if (bytes.length !== length) throw new Error(`${label}长度无效。`);
  return bytes;
}

function decodeBase64Url(value) {
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.toString('base64url') !== value) throw new Error('Base64URL 无效。');
  return bytes;
}

function isBase64Url(value) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

module.exports = {
  CLOCK_SKEW_MS,
  MAX_DURATION_MS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  PREFIX,
  createShareCode,
  generatePassword,
  parseShareCode,
  validatePassword
};
