'use strict';

const crypto = require('crypto');

const PREFIX = 'LDGS1';
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function createShareCode(topic, durationMs = 60 * 60 * 1000, now = Date.now()) {
  const normalized = normalizeTopic(topic);
  const duration = Number(durationMs);
  const createdAt = Number(now);
  if (!Number.isInteger(duration) || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
    throw new Error('分享有效期必须在 1 分钟到 7 天之间。');
  }
  if (!Number.isInteger(createdAt) || createdAt <= 0) throw new Error('分享时间无效。');

  const params = new URLSearchParams();
  params.set('v', '1');
  params.set('id', String(normalized.id));
  params.set('slug', normalized.slug);
  params.set('title', normalized.title);
  params.set('iat', String(createdAt));
  params.set('exp', String(createdAt + duration));
  const payload = Buffer.from(params.toString(), 'utf8');
  const encoded = payload.toString('base64url');
  return `${PREFIX}.${encoded}.${checksum(payload)}`;
}

function parseShareCode(input, now = Date.now()) {
  const code = String(input || '').trim();
  if (code.length > 4096) throw new Error('分享码过长。');
  const parts = code.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[a-f0-9]{16}$/.test(parts[2])) {
    throw new Error('分享码格式不正确。');
  }

  let payload;
  try {
    payload = Buffer.from(parts[1], 'base64url');
  } catch {
    throw new Error('分享码格式不正确。');
  }
  if (!payload.length || checksum(payload) !== parts[2]) throw new Error('分享码已损坏或被修改。');

  const params = new URLSearchParams(payload.toString('utf8'));
  if (params.get('v') !== '1') throw new Error('分享码版本不受支持。');
  const topic = normalizeTopic({
    id: Number(params.get('id')),
    slug: params.get('slug'),
    title: params.get('title')
  });
  const createdAt = Number(params.get('iat'));
  const expiresAt = Number(params.get('exp'));
  const currentTime = Number(now);
  if (![createdAt, expiresAt, currentTime].every(Number.isInteger) || createdAt <= 0 || expiresAt <= createdAt) {
    throw new Error('分享码时间信息无效。');
  }
  if (createdAt > currentTime + CLOCK_SKEW_MS) throw new Error('分享码生成时间晚于当前设备时间。');
  if (expiresAt - createdAt > MAX_DURATION_MS || expiresAt - createdAt < MIN_DURATION_MS) {
    throw new Error('分享码有效期无效。');
  }
  if (expiresAt <= currentTime) {
    const expiredAt = new Date(expiresAt).toLocaleString('zh-CN', { hour12: false });
    throw new Error(`分享码已于 ${expiredAt} 失效。`);
  }
  return {
    ...topic,
    createdAt,
    expiresAt,
    url: `https://linux.do/t/${topic.slug}/${topic.id}`
  };
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

function checksum(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

module.exports = {
  CLOCK_SKEW_MS,
  MAX_DURATION_MS,
  PREFIX,
  createShareCode,
  parseShareCode
};
