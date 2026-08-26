'use strict';

const SITE_ORIGIN = 'https://linux.do';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const REQUEST_BURST_CAPACITY = 2;
const REQUEST_REFILL_INTERVAL_MS = 2_200;
const DEFAULT_CACHE_TTL_MS = 90_000;
const STALE_CACHE_MAX_AGE_MS = 30 * 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const RECENT_SUCCESS_WINDOW_MS = 30 * 60_000;
const PENALTY_SUCCESS_THRESHOLD = 4;
const CLEARANCE_SECRET = 'linuxdoGuest.cloudflare.clearance';
const GUEST_COOKIE_SECRET = 'linuxdoGuest.cloudflare.guestCookies';
const USER_AGENT_SECRET = 'linuxdoGuest.cloudflare.userAgent';
const GUEST_COOKIE_NAMES = new Set([
  'cf_clearance',
  '__cf_bm',
  '__cfuvid',
  '_cfuvid',
  '_bypass_cache',
  '_forum_session'
]);
const LOGIN_COOKIE_NAMES = new Set(['_t', 'remember_user_token', 'auth_token']);

class CloudflareError extends Error {
  constructor(hasClearance, message) {
    super(message || (hasClearance
      ? 'Cloudflare 拒绝了已保存的游客参数，请在原浏览器重新验证并复制最新 Cookie 与 User-Agent。'
      : 'Cloudflare 要求人机验证，请打开验证设置并手动填写游客参数。'));
    this.name = 'CloudflareError';
    this.hasClearance = hasClearance;
  }
}

class RateLimitError extends Error {
  constructor(status, retryAt) {
    const seconds = Math.max(1, Math.ceil((Number(retryAt) - Date.now()) / 1000));
    super(`站点暂时限制请求（HTTP ${status}），插件已暂停联网，请约 ${seconds} 秒后再试。`);
    this.name = 'RateLimitError';
    this.status = status;
    this.retryAt = Number(retryAt);
  }
}

class SupersededRequestError extends Error {
  constructor() {
    super('请求已被更新的页面操作取代。');
    this.name = 'SupersededRequestError';
  }
}

class GuestRequestSession {
  constructor(secrets, options = {}) {
    this.secrets = secrets;
    this.fetchResponse = options.fetchResponse || fetchGuestResponse;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || delay;
    const configuredRefillInterval = Number.isFinite(options.requestRefillIntervalMs)
      ? options.requestRefillIntervalMs
      : options.minRequestIntervalMs;
    this.requestRefillIntervalMs = Number.isFinite(configuredRefillInterval)
      ? Math.max(0, configuredRefillInterval)
      : REQUEST_REFILL_INTERVAL_MS;
    this.requestBurstCapacity = Number.isFinite(options.requestBurstCapacity)
      ? Math.max(1, Math.floor(options.requestBurstCapacity))
      : REQUEST_BURST_CAPACITY;
    this.requestQueue = Promise.resolve();
    this.inFlight = new Map();
    this.pendingByLane = new Map();
    this.cache = new Map();
    this.lastRequestAt = 0;
    this.lastSuccessfulRequestAt = 0;
    this.cooldownUntil = 0;
    this.cooldownStatus = 429;
    this.penaltyLevel = 0;
    this.successesSincePenalty = 0;
    this.availableRequestTokens = this.requestBurstCapacity;
    this.lastTokenRefillAt = this.now();
  }

  get isRunning() {
    return false;
  }

  async hasStoredVerification() {
    const verification = await this.getStoredVerification();
    return Boolean(verification.cookieHeader && verification.userAgent);
  }

  async getStoredVerification() {
    const [cookies, legacy, userAgent] = await Promise.all([
      this.secrets.get(GUEST_COOKIE_SECRET),
      this.secrets.get(CLEARANCE_SECRET),
      this.secrets.get(USER_AGENT_SECRET)
    ]);
    return {
      cookieHeader: cookies || (legacy ? `cf_clearance=${legacy}` : ''),
      userAgent: String(userAgent || '').trim()
    };
  }

  async request(rawPath, options = {}) {
    const url = assertLinuxDoRequestUrl(rawPath);
    const key = url.toString();
    const now = this.now();
    const cached = this.cache.get(key);
    const ttlMs = Number.isFinite(options.cacheTtlMs)
      ? Math.max(0, options.cacheTtlMs)
      : cacheTtlForUrl(url);

    if (!options.force && cached && now - cached.storedAt <= ttlMs) {
      return cached.data;
    }
    const existing = this.inFlight.get(key);
    if (existing && !existing.token.cancelled) {
      return existing.promise;
    }

    const token = this.createRequestToken(options);
    const request = this.enqueue(async () => {
      if (token.cancelled) throw new SupersededRequestError();
      token.started = true;
      return this.performRequest(url, key, cached, ttlMs);
    });
    this.inFlight.set(key, { promise: request, token });
    request.finally(() => {
      if (this.inFlight.get(key)?.promise === request) this.inFlight.delete(key);
      if (token.lane && this.pendingByLane.get(token.lane) === token) this.pendingByLane.delete(token.lane);
    }).catch(() => {});
    return request;
  }

  createRequestToken(options) {
    const lane = typeof options.requestLane === 'string' ? options.requestLane : '';
    const lanesToCancel = new Set(Array.isArray(options.cancelPendingLanes) ? options.cancelPendingLanes : []);
    if (lane) lanesToCancel.add(lane);
    this.cancelPendingRequests(lanesToCancel);
    const token = { lane, started: false, cancelled: false };
    if (lane) this.pendingByLane.set(lane, token);
    return token;
  }

  cancelPendingRequests(lanes) {
    for (const pendingLane of lanes || []) {
      const pending = this.pendingByLane.get(pendingLane);
      if (pending && !pending.started) pending.cancelled = true;
    }
  }

  enqueue(task) {
    const request = this.requestQueue.then(task, task);
    this.requestQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  async performRequest(url, key, cached) {
    let now = this.now();
    if (now < this.cooldownUntil) {
      if (isUsableStaleCache(cached, now)) return cached.data;
      throw new RateLimitError(this.cooldownStatus, this.cooldownUntil);
    }

    now = await this.acquireRequestPermit();
    this.lastRequestAt = now;

    const verification = await this.getStoredVerification();
    const hasVerification = Boolean(verification.cookieHeader && verification.userAgent);
    const response = await this.fetchResponse(url, verification);
    if (response.status === 403 || response.status === 429) {
      const fallbackMs = response.status === 429 ? DEFAULT_RATE_LIMIT_COOLDOWN_MS : 45_000;
      const cooldownMs = retryAfterMilliseconds(response.retryAfter, now, fallbackMs);
      this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldownMs);
      this.cooldownStatus = response.status;
      this.applyRateLimitPenalty(now);
      if (isUsableStaleCache(cached, now)) return cached.data;
      const hadRecentSuccess = this.lastSuccessfulRequestAt > 0 &&
        now - this.lastSuccessfulRequestAt <= RECENT_SUCCESS_WINDOW_MS;
      if (response.status === 429 || hadRecentSuccess) {
        throw new RateLimitError(response.status, this.cooldownUntil);
      }
      throw new CloudflareError(hasVerification, hasVerification
        ? `Cloudflare 拒绝或暂时限制了请求。插件已暂停联网 ${Math.ceil(cooldownMs / 1000)} 秒；请等待后再试，持续出现 403 时再更新游客参数。`
        : undefined);
    }

    const data = parseJsonResponse(response, hasVerification);
    this.recordSuccessfulRequest(now);
    this.cache.set(key, { data, storedAt: now });
    while (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
    return data;
  }

  effectiveRefillIntervalMs() {
    return this.requestRefillIntervalMs * Math.min(3, 1 + this.penaltyLevel);
  }

  refillRequestTokens(now) {
    const interval = this.effectiveRefillIntervalMs();
    if (interval <= 0) {
      this.availableRequestTokens = this.requestBurstCapacity;
      this.lastTokenRefillAt = now;
      return;
    }
    const elapsed = Math.max(0, now - this.lastTokenRefillAt);
    this.availableRequestTokens = Math.min(
      this.requestBurstCapacity,
      this.availableRequestTokens + elapsed / interval
    );
    this.lastTokenRefillAt = now;
  }

  async acquireRequestPermit() {
    let now = this.now();
    this.refillRequestTokens(now);
    if (this.availableRequestTokens < 1) {
      const waitMs = Math.ceil((1 - this.availableRequestTokens) * this.effectiveRefillIntervalMs());
      if (waitMs > 0) await this.sleep(waitMs);
      now = this.now();
      this.refillRequestTokens(now);
    }
    this.availableRequestTokens = Math.max(0, this.availableRequestTokens - 1);
    return now;
  }

  applyRateLimitPenalty(now) {
    this.penaltyLevel = Math.min(2, this.penaltyLevel + 1);
    this.successesSincePenalty = 0;
    this.availableRequestTokens = 0;
    this.lastTokenRefillAt = now;
  }

  recordSuccessfulRequest(now) {
    this.lastSuccessfulRequestAt = now;
    if (this.penaltyLevel <= 0) return;
    this.successesSincePenalty += 1;
    if (this.successesSincePenalty < PENALTY_SUCCESS_THRESHOLD) return;
    this.penaltyLevel -= 1;
    this.successesSincePenalty = 0;
    this.availableRequestTokens = Math.min(this.availableRequestTokens, 1);
    this.lastTokenRefillAt = now;
  }

  resetRequestState() {
    for (const token of this.pendingByLane.values()) {
      if (!token.started) token.cancelled = true;
    }
    this.pendingByLane.clear();
    this.cache.clear();
    this.cooldownUntil = 0;
    this.cooldownStatus = 429;
    this.lastRequestAt = 0;
    this.lastSuccessfulRequestAt = 0;
    this.penaltyLevel = 0;
    this.successesSincePenalty = 0;
    this.availableRequestTokens = this.requestBurstCapacity;
    this.lastTokenRefillAt = this.now();
  }

  async saveManualVerification({ cookieHeader, userAgent, validate = true }) {
    const filteredCookies = cookieHeaderFromPairs(parseCookieHeader(cookieHeader));
    if (!/(?:^|;\s*)cf_clearance=/i.test(filteredCookies)) {
      throw new Error('没有找到有效的 cf_clearance。');
    }
    const normalizedUserAgent = String(userAgent || '').trim();
    if (normalizedUserAgent.length < 20 || normalizedUserAgent.length > 1024 || /[\r\n]/.test(normalizedUserAgent)) {
      throw new Error('User-Agent 格式不正确。');
    }

    let validatedData;
    if (validate) {
      const response = await this.fetchResponse(new URL('/latest.json', SITE_ORIGIN), {
        cookieHeader: filteredCookies,
        userAgent: normalizedUserAgent
      });
      const data = parseJsonResponse(response, true);
      if (!Array.isArray(data.topic_list?.topics)) {
        throw new Error('参数测试返回的数据不完整。');
      }
      validatedData = data;
    }

    await this.secrets.store(GUEST_COOKIE_SECRET, filteredCookies);
    await this.secrets.delete(CLEARANCE_SECRET);
    await this.secrets.store(USER_AGENT_SECRET, normalizedUserAgent);
    this.resetRequestState();
    if (validatedData) {
      const storedAt = this.now();
      this.lastRequestAt = storedAt;
      this.lastSuccessfulRequestAt = storedAt;
      this.availableRequestTokens = Math.max(0, this.requestBurstCapacity - 1);
      this.lastTokenRefillAt = storedAt;
      this.cache.set(new URL('/latest.json', SITE_ORIGIN).toString(), { data: validatedData, storedAt });
    }
    return { cookieHeader: filteredCookies, userAgent: normalizedUserAgent };
  }

  async stop() {
    this.resetRequestState();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cacheTtlForUrl(url) {
  if (url.pathname === '/categories.json') return 10 * 60_000;
  if (url.pathname === '/search.json') return 60_000;
  if (/^\/t\/.+\.json$/.test(url.pathname) || /^\/t\/\d+\/posts\.json$/.test(url.pathname)) return 5 * 60_000;
  return DEFAULT_CACHE_TTL_MS;
}

function isUsableStaleCache(cached, now) {
  return Boolean(cached && now - cached.storedAt <= STALE_CACHE_MAX_AGE_MS);
}

function retryAfterMilliseconds(value, now, fallback) {
  const raw = String(value || '').trim();
  if (/^\d+$/.test(raw)) return Math.max(1_000, Number(raw) * 1000);
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp) && timestamp > now) return timestamp - now;
  return fallback;
}

async function fetchGuestResponse(url, verification = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    Accept: 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${SITE_ORIGIN}/latest`,
    'User-Agent': verification.userAgent || defaultUserAgent()
  };
  if (verification.cookieHeader) headers.Cookie = verification.cookieHeader;

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers,
      signal: controller.signal
    });
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      return { status: response.status, contentLength, tooLarge: true, text: '' };
    }
    return {
      status: response.status,
      contentLength,
      retryAfter: response.headers.get('retry-after') || '',
      text: await readLimitedText(response, MAX_RESPONSE_BYTES)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { networkError: 'timeout' };
    return { networkError: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response, byteLimit) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > byteLimit) throw new Error('response-too-large');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > byteLimit) {
      await reader.cancel();
      throw new Error('response-too-large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseJsonResponse(response, hasClearance) {
  if (response.networkError === 'timeout') throw new Error('连接 LINUX DO 超时。');
  if (response.networkError === 'response-too-large') throw new Error('站点返回的数据过大，已停止加载。');
  if (response.networkError) throw new Error('无法连接 LINUX DO，请检查网络、代理或 DNS 设置。');
  if (response.status === 403) {
    throw new CloudflareError(hasClearance, hasClearance
      ? 'Cloudflare 拒绝了请求，可能是游客参数已失效或站点临时限流。请先稍候再试；持续出现 403 时，再从同一浏览器的 Network 请求复制完整 Cookie 与 User-Agent。'
      : undefined);
  }
  if (response.status === 429) throw new Error('站点请求过于频繁（HTTP 429），请稍后再试。');
  if (response.status < 200 || response.status >= 300) throw new Error(`LINUX DO 返回 HTTP ${response.status}。`);
  if (response.tooLarge || response.contentLength > MAX_RESPONSE_BYTES || Buffer.byteLength(response.text || '', 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('站点返回的数据过大，已停止加载。');
  }
  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error('站点没有返回可识别的公开数据，可能正在进行人机验证。');
  }
}

function assertLinuxDoRequestUrl(rawPath) {
  const url = rawPath instanceof URL ? rawPath : new URL(String(rawPath), SITE_ORIGIN);
  if (url.origin !== SITE_ORIGIN || url.username || url.password || url.hash) {
    throw new Error('拒绝访问非 LINUX DO 接口。');
  }
  return url;
}

function parseCookieHeader(input) {
  const raw = String(input || '').trim();
  const hasLoginCookie = [...LOGIN_COOKIE_NAMES].some((name) =>
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`, 'i').test(raw));
  const selected = new Map();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (GUEST_COOKIE_NAMES.has(name) && !(hasLoginCookie && name === '_forum_session') && value && !/[\r\n;]/.test(value)) {
      selected.set(name, value);
    }
  }
  if (!selected.size && raw && !raw.includes('=') && !/[\r\n;]/.test(raw)) {
    selected.set('cf_clearance', raw);
  }
  return [...selected.entries()].map(([name, value]) => ({ name, value }));
}

function cookieHeaderFromPairs(pairs) {
  return pairs.map(({ name, value }) => `${name}=${value}`).join('; ');
}

function defaultUserAgent() {
  const chromeVersion = process.versions.chrome || '120.0.0.0';
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function isLinuxDoUrl(rawUrl) {
  try {
    return new URL(String(rawUrl)).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

module.exports = {
  CLEARANCE_SECRET,
  CloudflareError,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  GUEST_COOKIE_NAMES,
  GUEST_COOKIE_SECRET,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
  REQUEST_BURST_CAPACITY,
  REQUEST_REFILL_INTERVAL_MS,
  RateLimitError,
  REQUEST_TIMEOUT_MS,
  SITE_ORIGIN,
  SupersededRequestError,
  USER_AGENT_SECRET,
  assertLinuxDoRequestUrl,
  cookieHeaderFromPairs,
  cacheTtlForUrl,
  defaultUserAgent,
  fetchGuestResponse,
  isLinuxDoUrl,
  parseCookieHeader,
  parseJsonResponse,
  retryAfterMilliseconds,
  readLimitedText
};
