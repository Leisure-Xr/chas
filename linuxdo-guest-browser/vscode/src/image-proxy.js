'use strict';

const SITE_ORIGIN = 'https://linux.do';
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 120;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const EXTERNAL_CONCURRENCY = 2;
const EXTERNAL_TIMEOUT_MS = 15_000;
const EXTERNAL_USER_AGENT = 'Mozilla/5.0 (compatible; LinuxDoGuestReader/1.0)';
const ALLOWED_IMAGE_TYPES = /^image\/(?:png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/;

class ImageProxy {
  constructor({ session, fetchExternal, now } = {}) {
    this.session = session;
    this.fetchExternal = fetchExternal || fetchExternalImage;
    this.now = now || (() => Date.now());
    this.cache = new Map();
    this.inFlight = new Map();
    this.cacheBytes = 0;
    this.externalActive = 0;
    this.externalQueue = [];
  }

  async load(rawUrl) {
    const url = normalizeImageUrl(rawUrl);
    if (!url) throw new ImageProxyError('unsupported', '不支持的图片地址。');
    const key = url.toString();

    const cached = this.cache.get(key);
    if (cached) {
      this.touch(key, cached);
      return cached.dataUri;
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.fetchImage(url)
      .then((dataUri) => {
        this.inFlight.delete(key);
        return dataUri;
      })
      .catch((error) => {
        this.inFlight.delete(key);
        throw error;
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  async fetchImage(url) {
    const result = url.origin === SITE_ORIGIN
      ? await this.session.requestImage(url)
      : await this.runExternal(url);
    const contentType = normalizeContentType(result.contentType);
    if (!ALLOWED_IMAGE_TYPES.test(contentType)) {
      throw new ImageProxyError('blocked', '返回的不是受支持的图片格式。');
    }
    const body = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body || '');
    if (!body.length) throw new ImageProxyError('network', '图片内容为空。');
    if (body.length > MAX_IMAGE_BYTES) throw new ImageProxyError('too-large', '图片超过大小上限。');
    const dataUri = `data:${contentType};base64,${body.toString('base64')}`;
    this.store(url.toString(), dataUri, body.length);
    return dataUri;
  }

  // Cross-origin images cannot go through the native in-page fetch (CORS), so
  // they use a plain cookie-less request under the same concurrency cap.
  async runExternal(url) {
    if (this.externalActive >= EXTERNAL_CONCURRENCY) {
      await new Promise((resolve) => this.externalQueue.push(resolve));
    }
    this.externalActive += 1;
    try {
      return await this.fetchExternal(url);
    } finally {
      this.externalActive -= 1;
      this.externalQueue.shift()?.();
    }
  }

  store(key, dataUri, bytes) {
    this.cache.set(key, { dataUri, bytes, storedAt: this.now() });
    this.cacheBytes += bytes;
    while (this.cacheBytes > MAX_CACHE_BYTES || this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.evict(oldest.value);
    }
  }

  touch(key, entry) {
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  evict(key) {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cacheBytes -= entry.bytes;
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.cacheBytes = 0;
  }
}

class ImageProxyError extends Error {
  constructor(reason, message, retryAt = 0) {
    super(message || '图片加载失败。');
    this.name = 'ImageProxyError';
    this.reason = reason;
    this.retryAt = Number(retryAt) || 0;
  }
}

function normalizeImageUrl(rawUrl) {
  let url;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl), SITE_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  url.hash = '';
  return url;
}

function normalizeContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

async function fetchExternalImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': EXTERNAL_USER_AGENT
      },
      signal: controller.signal
    });
    if (response.status >= 400) {
      throw new ImageProxyError('network', `图片请求返回 HTTP ${response.status}。`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new ImageProxyError('too-large', '图片超过大小上限。');
    return {
      contentType: response.headers.get('content-type') || '',
      body: Buffer.from(await response.arrayBuffer())
    };
  } catch (error) {
    if (error instanceof ImageProxyError) throw error;
    if (error?.name === 'AbortError') throw new ImageProxyError('network', '图片请求超时。');
    throw new ImageProxyError('network', '图片请求失败。');
  } finally {
    clearTimeout(timer);
  }
}

function imageErrorReason(error) {
  const reason = error?.reason;
  return ['cooldown', 'blocked', 'too-large', 'network', 'unsupported', 'superseded'].includes(reason)
    ? reason
    : 'network';
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  EXTERNAL_CONCURRENCY,
  ImageProxy,
  ImageProxyError,
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  MAX_IMAGE_BYTES,
  fetchExternalImage,
  imageErrorReason,
  normalizeImageUrl
};
