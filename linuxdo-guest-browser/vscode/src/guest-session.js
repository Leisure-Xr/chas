'use strict';

const {
  EXACT_GUEST_COOKIE_NAMES,
  REQUEST_PROFILE_SECRET,
  createRequestProfile,
  parseAndFilterGuestCookies,
  profileSummary,
  sanitizeStoredProfile
} = require('./request-profile');

const SITE_ORIGIN = 'https://linux.do';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const REQUEST_BURST_CAPACITY = 2;
const REQUEST_REFILL_INTERVAL_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const STALE_CACHE_MAX_AGE_MS = 6 * 60 * 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const TRANSIENT_PROTECTION_BACKOFF_MS = Object.freeze([8_000, 15_000, 30_000]);
const TRANSIENT_PROTECTION_RESET_MS = 10 * 60_000;
const SMART_CAREFUL_MINIMUM_MS = 15 * 60_000;
const SMART_BALANCED_STABLE_MS = 10 * 60_000;
const REQUEST_MODES = Object.freeze({
  fluent: Object.freeze({ capacity: 2, refillIntervalMs: 4_000 }),
  balanced: Object.freeze({ capacity: 2, refillIntervalMs: 5_000 }),
  careful: Object.freeze({ capacity: 1, refillIntervalMs: 8_000 })
});
const CLEARANCE_SECRET = 'linuxdoGuest.cloudflare.clearance';
const GUEST_COOKIE_SECRET = 'linuxdoGuest.cloudflare.guestCookies';
const USER_AGENT_SECRET = 'linuxdoGuest.cloudflare.userAgent';
const GUEST_COOKIE_NAMES = EXACT_GUEST_COOKIE_NAMES;
const LOGIN_COOKIE_NAMES = new Set(['_t', 'remember_user_token', 'auth_token']);

class CloudflareError extends Error {
  constructor(hasClearance, message) {
    super(message || (hasClearance
      ? 'Cloudflare 拒绝了这次游客请求；仅凭这一次响应无法判断参数是否失效，可稍后重试或更新请求档案。'
      : 'Cloudflare 要求人机验证，请打开验证设置并手动填写游客参数。'));
    this.name = 'CloudflareError';
    this.hasClearance = hasClearance;
  }
}

class RateLimitError extends Error {
  constructor(status, retryAt, now = Date.now()) {
    const seconds = Math.max(1, Math.ceil((Number(retryAt) - Number(now)) / 1000));
    super(`站点暂时限制请求（HTTP ${status}），插件已暂停联网，请约 ${seconds} 秒后再试。`);
    this.name = 'RateLimitError';
    this.status = status;
    this.retryAt = Number(retryAt);
  }
}

class TransientProtectionError extends Error {
  constructor(retryAt, now = Date.now(), attempt = 1) {
    const seconds = Math.max(1, Math.ceil((Number(retryAt) - Number(now)) / 1000));
    const repeated = attempt > 1 ? `（连续第 ${attempt} 次）` : '';
    super(`Cloudflare 暂时拦截了这次游客请求${repeated}，但这不能证明已保存参数失效。请约 ${seconds} 秒后重试；若持续出现，可更新请求档案，也可以保留当前档案稍后再试。`);
    this.name = 'TransientProtectionError';
    this.status = 403;
    this.retryAt = Number(retryAt);
    this.attempt = attempt;
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
    this.onQueueWait = typeof options.onQueueWait === 'function' ? options.onQueueWait : undefined;
    this.requestMode = normalizeRequestMode(options.requestMode);
    this.customPacing = Number.isFinite(options.requestRefillIntervalMs) || Number.isFinite(options.minRequestIntervalMs);
    const configuredRefillInterval = Number.isFinite(options.requestRefillIntervalMs) ? options.requestRefillIntervalMs : options.minRequestIntervalMs;
    this.requestRefillIntervalMs = Number.isFinite(configuredRefillInterval) ? Math.max(0, configuredRefillInterval) : REQUEST_REFILL_INTERVAL_MS;
    this.requestBurstCapacity = Number.isFinite(options.requestBurstCapacity) ? Math.max(1, Math.floor(options.requestBurstCapacity)) : REQUEST_BURST_CAPACITY;
    this.requestQueue = [];
    this.isDrainingQueue = false;
    this.nextQueueOrder = 0;
    this.inFlight = new Map();
    this.pendingByLane = new Map();
    this.cache = new Map();
    this.lastRequestAt = 0;
    this.lastSuccessfulRequestAt = 0;
    this.cooldownUntil = 0;
    this.cooldownStatus = 429;
    this.transientProtectionUntil = 0;
    this.transientProtectionCount = 0;
    this.lastTransientProtectionAt = 0;
    this.smartMode = 'balanced';
    this.smartCarefulUntil = 0;
    this.smartSuccesses = 0;
    this.lastExplicitRateLimitAt = 0;
    this.smartStableSince = this.now();
    this.bucketMode = this.getEffectiveRequestMode();
    this.bucketTokens = REQUEST_MODES[this.bucketMode].capacity;
    this.bucketUpdatedAt = this.now();
    this.serverBudgetUntil = 0;
    this.serverBudget = undefined;
    this.lastResponseInfo = { source: 'network', storedAt: 0, reason: 'network' };
  }

  get isRunning() {
    return false;
  }

  async hasStoredVerification() {
    const verification = await this.getStoredVerification();
    return Boolean(verification.cookieHeader && verification.userAgent && verification.status !== 'legacy-unverified');
  }

  async getStoredVerification() {
    const [storedProfile, cookies, legacy, userAgent] = await Promise.all([
      this.secrets.get(REQUEST_PROFILE_SECRET),
      this.secrets.get(GUEST_COOKIE_SECRET),
      this.secrets.get(CLEARANCE_SECRET),
      this.secrets.get(USER_AGENT_SECRET)
    ]);
    const profile = sanitizeStoredProfile(storedProfile);
    if (profile) return profile;
    const cookieHeader = cookies || (legacy ? `cf_clearance=${legacy}` : '');
    const normalizedUserAgent = String(userAgent || '').trim();
    if (!cookieHeader || !normalizedUserAgent) return { cookieHeader, userAgent: normalizedUserAgent, clientHints: {}, status: 'unverified' };
    try {
      const migrated = createRequestProfile({ cookieHeader, userAgent: normalizedUserAgent, source: 'legacy-secret-storage' });
      migrated.status = 'legacy-unverified';
      await this.secrets.store(REQUEST_PROFILE_SECRET, JSON.stringify(migrated));
      return migrated;
    } catch {
      return { cookieHeader, userAgent: normalizedUserAgent, clientHints: {}, status: 'unverified' };
    }
  }

  async getStoredProfileSummary() {
    return profileSummary(await this.getStoredVerification());
  }

  async request(rawPath, options = {}) {
    const url = assertLinuxDoRequestUrl(rawPath);
    const key = cacheKeyForUrl(url);
    const now = this.now();
    const cached = this.cache.get(key);
    const ttlMs = Number.isFinite(options.cacheTtlMs)
      ? Math.max(0, options.cacheTtlMs)
      : cacheTtlForUrl(url);

    if (!options.force && cached && now - cached.storedAt <= ttlMs) {
      this.touchCache(key, cached);
      return this.returnData(cached.data, { source: 'cache', storedAt: cached.storedAt, reason: 'fresh' });
    }
    const existing = this.inFlight.get(key);
    if (existing && !existing.token.cancelled) {
      return existing.promise;
    }

    const token = this.createRequestToken(options);
    const request = this.enqueue(async () => {
      if (token.cancelled) throw new SupersededRequestError();
      return this.performRequest(url, key, cached, ttlMs, token);
    }, token);
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
    let resolveCancelled;
    const token = {
      lane,
      started: false,
      cancelled: false,
      cancelledPromise: new Promise((resolve) => { resolveCancelled = resolve; }),
      cancel: () => resolveCancelled(),
      priority: Number.isFinite(options.requestPriority) ? Number(options.requestPriority) : requestPriorityForLane(lane),
      continuation: Boolean(options.continuation) || lane === 'topic-more' || lane === 'list-more'
    };
    if (lane) this.pendingByLane.set(lane, token);
    return token;
  }

  cancelPendingRequests(lanes) {
    for (const pendingLane of lanes || []) {
      const pending = this.pendingByLane.get(pendingLane);
      if (pending && !pending.started) {
        pending.cancelled = true;
        pending.cancel();
      }
    }
  }

  enqueue(task, token) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ task, token, resolve, reject, order: this.nextQueueOrder++ });
      void this.drainQueue();
    });
  }

  async drainQueue() {
    if (this.isDrainingQueue) return;
    this.isDrainingQueue = true;
    try {
      while (this.requestQueue.length) {
        this.requestQueue.sort((left, right) => right.token.priority - left.token.priority || left.order - right.order);
        const job = this.requestQueue.shift();
        if (job.token.cancelled) {
          job.reject(new SupersededRequestError());
          continue;
        }
        try {
          job.resolve(await job.task());
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.isDrainingQueue = false;
    }
  }

  async performRequest(url, key, cached, ttlMs, token) {
    let now = this.now();
    if (now < this.cooldownUntil) {
      if (isUsableStaleCache(cached, now)) {
        this.touchCache(key, cached);
        return this.returnData(cached.data, { source: 'stale-cache', storedAt: cached.storedAt, reason: 'rate-limit', retryAt: this.cooldownUntil, status: this.cooldownStatus });
      }
      throw new RateLimitError(this.cooldownStatus, this.cooldownUntil, now);
    }
    if (now < this.transientProtectionUntil) {
      if (isUsableStaleCache(cached, now)) {
        this.touchCache(key, cached);
        return this.returnData(cached.data, {
          source: 'stale-cache',
          storedAt: cached.storedAt,
          reason: 'cloudflare-protection',
          retryAt: this.transientProtectionUntil,
          status: 403
        });
      }
      throw new TransientProtectionError(this.transientProtectionUntil, now, this.transientProtectionCount);
    }

    now = await this.acquireRequestPermit(token);
    if (token.cancelled) throw new SupersededRequestError();
    token.started = true;
    this.lastRequestAt = now;

    const verification = await this.getStoredVerification();
    const hasVerification = Boolean(verification.cookieHeader && verification.userAgent);
    const response = await this.fetchResponse(url, verification);
    if (response.status === 403 || response.status === 429) {
      this.resetSmartStability(now);
      if (isExplicitRateLimitResponse(response)) {
        const cooldownMs = retryAfterMilliseconds(response.retryAfter, now, DEFAULT_RATE_LIMIT_COOLDOWN_MS);
        this.setRateLimitCooldown(response.status, now, cooldownMs);
        if (isUsableStaleCache(cached, now)) {
          this.touchCache(key, cached);
          return this.returnData(cached.data, { source: 'stale-cache', storedAt: cached.storedAt, reason: 'rate-limit', retryAt: this.cooldownUntil, status: response.status });
        }
        throw new RateLimitError(response.status, this.cooldownUntil, now);
      }
      if (!hasVerification) throw new CloudflareError(false);
      return this.handleTransientProtection(key, cached, now);
    }

    this.applyServerBudget(response, now);

    let data;
    try {
      data = parseJsonResponse(response, hasVerification);
    } catch (error) {
      if (isNetworkResponse(response) && isUsableStaleCache(cached, now)) {
        this.touchCache(key, cached);
        return this.returnData(cached.data, { source: 'stale-cache', storedAt: cached.storedAt, reason: 'offline' });
      }
      throw error;
    }
    await this.promoteStoredProfileAfterSuccess(verification, now);
    this.clearTransientProtection();
    this.recordSuccessfulRequest(now);
    this.cache.delete(key);
    this.cache.set(key, { data, storedAt: now });
    while (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
    return this.returnData(data, { source: 'network', storedAt: now, reason: 'network' });
  }

  setRequestMode(mode) {
    const now = this.now();
    this.refillTokenBucket(now);
    const available = this.bucketTokens;
    this.requestMode = normalizeRequestMode(mode);
    this.switchTokenBucketMode(now, available);
  }

  getEffectiveRequestMode() {
    return this.requestMode === 'smart' ? this.smartMode : this.requestMode;
  }

  consumeLastResponseInfo() {
    return { ...this.lastResponseInfo };
  }

  async acquireRequestPermit(token) {
    for (;;) {
      const now = this.now();
      if (token.cancelled) throw new SupersededRequestError();
      const waitMs = this.requestPermitWaitMs(now, token);
      if (waitMs <= 0) {
        this.onQueueWait?.({ waitMs: 0, reason: 'ready' });
        this.recordRequestPermit(now, token);
        return now;
      }
      this.onQueueWait?.({
        waitMs,
        reason: this.serverBudgetUntil > now ? 'server-budget' : 'local-pacing'
      });
      // A navigation that arrives while this job waits for pacing must be able to
      // replace it immediately instead of inheriting the obsolete wait.
      await Promise.race([this.sleep(waitMs), token.cancelledPromise]);
    }
  }

  requestPermitWaitMs(now, token) {
    if (this.customPacing) {
      const last = this.lastRequestAt;
      return Math.max(0, this.requestRefillIntervalMs - Math.max(0, now - last));
    }
    this.refillTokenBucket(now);
    const pacing = REQUEST_MODES[this.bucketMode];
    const localWait = this.bucketTokens >= 1 ? 0 : Math.ceil((1 - this.bucketTokens) * pacing.refillIntervalMs);
    const serverWait = Math.max(0, this.serverBudgetUntil - now);
    return Math.max(localWait, serverWait);
  }

  recordRequestPermit(now, token) {
    if (!this.customPacing) {
      this.refillTokenBucket(now);
      this.bucketTokens = Math.max(0, this.bucketTokens - 1);
    }
    this.lastRequestAt = now;
  }

  refillTokenBucket(now) {
    const mode = this.getEffectiveRequestMode();
    if (mode !== this.bucketMode) {
      this.bucketMode = mode;
      this.bucketTokens = Math.min(this.bucketTokens, REQUEST_MODES[mode].capacity);
      this.bucketUpdatedAt = now;
      return;
    }
    const pacing = REQUEST_MODES[mode];
    const elapsed = Math.max(0, now - this.bucketUpdatedAt);
    if (elapsed > 0) {
      this.bucketTokens = Math.min(pacing.capacity, this.bucketTokens + elapsed / pacing.refillIntervalMs);
      this.bucketUpdatedAt = now;
    }
  }

  resetTokenBucket(now) {
    this.bucketMode = this.getEffectiveRequestMode();
    this.bucketTokens = REQUEST_MODES[this.bucketMode].capacity;
    this.bucketUpdatedAt = now;
  }

  switchTokenBucketMode(now, available = this.bucketTokens) {
    this.bucketMode = this.getEffectiveRequestMode();
    this.bucketTokens = Math.min(Math.max(0, available), REQUEST_MODES[this.bucketMode].capacity);
    this.bucketUpdatedAt = now;
  }

  applyServerBudget(response, now) {
    const budget = parseRateLimitBudget(response, now);
    if (!budget) return;
    this.serverBudget = budget;
    if (budget.remaining <= budget.reserve && budget.resetAt > now) {
      this.serverBudgetUntil = Math.max(this.serverBudgetUntil, budget.resetAt);
    } else if (budget.remaining > budget.reserve) {
      this.serverBudgetUntil = 0;
    }
  }

  recordSuccessfulRequest(now) {
    this.lastSuccessfulRequestAt = now;
    if (this.requestMode !== 'smart') return;
    this.smartSuccesses += 1;
    if (this.smartMode === 'careful' && now >= this.smartCarefulUntil && this.smartSuccesses >= 8) {
      this.smartMode = 'balanced';
      this.smartSuccesses = 0;
      this.smartStableSince = now;
      this.switchTokenBucketMode(now);
    } else if (this.smartMode === 'balanced' && now - this.smartStableSince >= SMART_BALANCED_STABLE_MS && this.smartSuccesses >= 12) {
      this.smartMode = 'fluent';
      this.smartSuccesses = 0;
      this.switchTokenBucketMode(now);
    }
  }

  setRateLimitCooldown(status, now, cooldownMs, explicit = true) {
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldownMs);
    this.cooldownStatus = status;
    if (explicit && this.requestMode === 'smart') {
      this.smartMode = 'careful';
      this.smartCarefulUntil = now + SMART_CAREFUL_MINIMUM_MS;
      this.smartSuccesses = 0;
      this.lastExplicitRateLimitAt = now;
      this.smartStableSince = now;
      this.switchTokenBucketMode(now);
    }
  }

  resetSmartStability(now) {
    if (this.requestMode !== 'smart') return;
    this.smartSuccesses = 0;
    this.smartStableSince = now;
  }

  handleTransientProtection(key, cached, now) {
    const error = this.registerTransientProtection(now);
    if (isUsableStaleCache(cached, now)) {
      this.touchCache(key, cached);
      return this.returnData(cached.data, {
        source: 'stale-cache',
        storedAt: cached.storedAt,
        reason: 'cloudflare-protection',
        retryAt: error.retryAt,
        status: 403
      });
    }
    throw error;
  }

  registerTransientProtection(now) {
    if (!this.lastTransientProtectionAt || now - this.lastTransientProtectionAt > TRANSIENT_PROTECTION_RESET_MS) {
      this.transientProtectionCount = 0;
    }
    this.transientProtectionCount += 1;
    this.lastTransientProtectionAt = now;
    const waitMs = TRANSIENT_PROTECTION_BACKOFF_MS[Math.min(
      this.transientProtectionCount - 1,
      TRANSIENT_PROTECTION_BACKOFF_MS.length - 1
    )];
    this.transientProtectionUntil = now + waitMs;
    return new TransientProtectionError(this.transientProtectionUntil, now, this.transientProtectionCount);
  }

  clearTransientProtection() {
    this.transientProtectionUntil = 0;
    this.transientProtectionCount = 0;
    this.lastTransientProtectionAt = 0;
  }

  async promoteStoredProfileAfterSuccess(profile, now) {
    if (!profile?.cookieHeader || !profile?.userAgent || profile.status === 'verified') return;
    const promoted = { ...profile, status: 'verified', verifiedAt: now };
    try {
      await this.secrets.store(REQUEST_PROFILE_SECRET, JSON.stringify(promoted));
    } catch {
      // A metadata promotion must never discard an otherwise successful page response.
    }
  }

  touchCache(key, entry) {
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  returnData(data, responseInfo) {
    this.lastResponseInfo = responseInfo;
    return data;
  }

  resetRequestState(preservePacing = false) {
    for (const token of this.pendingByLane.values()) {
      if (!token.started) {
        token.cancelled = true;
        token.cancel();
      }
    }
    this.pendingByLane.clear();
    this.cache.clear();
    this.clearTransientProtection();
    if (!preservePacing) {
      this.cooldownUntil = 0;
      this.cooldownStatus = 429;
      this.lastRequestAt = 0;
      this.lastSuccessfulRequestAt = 0;
      this.serverBudgetUntil = 0;
      this.serverBudget = undefined;
      this.smartMode = 'balanced';
      this.smartCarefulUntil = 0;
      this.smartSuccesses = 0;
      this.lastExplicitRateLimitAt = 0;
      this.smartStableSince = this.now();
      this.resetTokenBucket(this.now());
    }
    this.lastResponseInfo = { source: 'network', storedAt: 0, reason: 'network' };
  }

  async saveManualVerification({ cookieHeader, userAgent, clientHints = {}, source = 'manual', validate = true }) {
    const candidate = createRequestProfile({ cookieHeader, userAgent, headers: clientHints, source });

    let validatedData;
    if (validate) {
      validatedData = await this.validateCandidateProfile(candidate);
    }

    await this.secrets.store(REQUEST_PROFILE_SECRET, JSON.stringify(candidate));
    await Promise.allSettled([
      this.secrets.delete(CLEARANCE_SECRET),
      this.secrets.delete(GUEST_COOKIE_SECRET),
      this.secrets.delete(USER_AGENT_SECRET)
    ]);
    this.resetRequestState(true);
    if (validatedData) {
      const storedAt = this.now();
      this.lastRequestAt = storedAt;
      this.lastSuccessfulRequestAt = storedAt;
      this.cache.set(new URL('/latest.json', SITE_ORIGIN).toString(), { data: validatedData, storedAt });
    }
    return candidate;
  }

  async validateCandidateProfile(candidate) {
    const token = this.createRequestToken({ requestLane: 'verification', requestPriority: 40 });
    try {
      return await this.enqueue(async () => {
        let now = this.now();
        if (now < this.cooldownUntil) throw new RateLimitError(this.cooldownStatus, this.cooldownUntil, now);
        if (now < this.transientProtectionUntil) {
          throw new TransientProtectionError(this.transientProtectionUntil, now, this.transientProtectionCount);
        }
        now = await this.acquireRequestPermit(token);
        if (token.cancelled) throw new SupersededRequestError();
        token.started = true;
        this.lastRequestAt = now;
        const response = await this.fetchResponse(new URL('/latest.json', SITE_ORIGIN), candidate);
        this.applyServerBudget(response, now);
        if (response.status === 403) this.resetSmartStability(now);
        if (isExplicitRateLimitResponse(response)) {
          const cooldownMs = retryAfterMilliseconds(response.retryAfter, now, DEFAULT_RATE_LIMIT_COOLDOWN_MS);
          this.setRateLimitCooldown(response.status || 429, now, cooldownMs);
          throw new RateLimitError(response.status || 429, this.cooldownUntil, now);
        }
        if (response.status === 403) {
          const error = this.registerTransientProtection(now);
          error.message = `本次 /latest.json 参数测试被 Cloudflare 暂时拦截，无法据此判断档案失效。旧档案没有被覆盖；请约 ${Math.ceil((error.retryAt - now) / 1000)} 秒后再测试，或仅保存为未验证。`;
          throw error;
        }
        const data = parseJsonResponse(response, true);
        if (!Array.isArray(data.topic_list?.topics)) throw new Error('参数测试返回的数据不完整。');
        candidate.status = 'verified';
        candidate.verifiedAt = now;
        this.clearTransientProtection();
        this.recordSuccessfulRequest(now);
        return data;
      }, token);
    } finally {
      if (this.pendingByLane.get('verification') === token) this.pendingByLane.delete('verification');
    }
  }

  async stop() {
    this.resetRequestState();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cacheTtlForUrl(url) {
  if (url.pathname === '/categories.json') return 30 * 60_000;
  if (url.pathname === '/search.json') return 2 * 60_000;
  if (/^\/t\/\d+\/posts\.json$/.test(url.pathname)) return 60 * 60_000;
  if (/^\/t\/.+\.json$/.test(url.pathname)) return 30 * 60_000;
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
  for (const [name, value] of Object.entries(verification.clientHints || {})) {
    if (/^(?:sec-ch-ua(?:-[a-z-]+)?|accept-language)$/i.test(name) && value) headers[name] = String(value);
  }

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
      rateLimit: response.headers.get('ratelimit') || '',
      rateLimitPolicy: response.headers.get('ratelimit-policy') || '',
      rateLimitLimit: response.headers.get('ratelimit-limit') || response.headers.get('x-ratelimit-limit') || '',
      rateLimitRemaining: response.headers.get('ratelimit-remaining') || response.headers.get('x-ratelimit-remaining') || '',
      rateLimitReset: response.headers.get('ratelimit-reset') || response.headers.get('x-ratelimit-reset') || '',
      discourseRateLimitCode: response.headers.get('discourse-rate-limit-error-code')
        || response.headers.get('x-discourse-rate-limit-error-code') || '',
      contentType: response.headers.get('content-type') || '',
      cfMitigated: response.headers.get('cf-mitigated') || '',
      cfRay: response.headers.get('cf-ray') || '',
      text: await readLimitedText(response, MAX_RESPONSE_BYTES)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { networkError: 'timeout' };
    return { networkError: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRequestMode(value) {
  return ['smart', 'fluent', 'balanced', 'careful'].includes(value) ? value : 'smart';
}

function requestPriorityForLane(lane) {
  if (lane === 'navigation') return 30;
  if (lane === 'manual-more') return 20;
  if (lane === 'topic-more' || lane === 'list-more') return 10;
  return 20;
}

function cacheKeyForUrl(url) {
  const normalized = new URL(url.toString());
  const topicMatch = normalized.pathname.match(/^\/t\/[^/]+\/(\d+)\.json$/);
  if (topicMatch) return `${SITE_ORIGIN}/t/${topicMatch[1]}.json`;
  if (/^\/t\/\d+\/posts\.json$/.test(normalized.pathname)) {
    const postIds = [...new Set(normalized.searchParams.getAll('post_ids[]').map(Number))]
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((left, right) => left - right);
    return `${SITE_ORIGIN}${normalized.pathname}?post_ids=${postIds.join(',')}`;
  }
  normalized.searchParams.sort();
  return normalized.toString();
}

function isCloudflareChallenge(response) {
  if (String(response.cfMitigated || '').toLowerCase() === 'challenge') return true;
  const contentType = String(response.contentType || '').toLowerCase();
  const sample = String(response.text || '').slice(0, 4_096).toLowerCase();
  return contentType.includes('text/html') && (
    sample.includes('cf-chl-') || sample.includes('just a moment') || sample.includes('/cdn-cgi/challenge-platform')
  );
}

function isExplicitRateLimitResponse(response) {
  if (Number(response.status) === 429 || String(response.retryAfter || '').trim() || String(response.discourseRateLimitCode || '').trim()) return true;
  const budget = parseRateLimitBudget(response, Date.now());
  if (budget && budget.remaining <= 0) return true;
  const sample = String(response.text || '').slice(0, 4_096).toLowerCase();
  return /\b(?:too many requests|rate[ _-]?limit(?:ed|ing)?|slow down)\b/.test(sample)
    || sample.includes('请求过于频繁')
    || sample.includes('访问频率过高')
    || /"error_type"\s*:\s*"(?:rate_limit|too_many_requests)"/.test(sample);
}

function parseRateLimitBudget(response, now) {
  const combined = String(response?.rateLimit || '');
  const policy = String(response?.rateLimitPolicy || '');
  let limit = positiveNumber(response?.rateLimitLimit);
  let remaining = nonNegativeNumber(response?.rateLimitRemaining);
  let resetValue = String(response?.rateLimitReset || '').trim();
  if (combined) {
    limit ||= namedRateValue(combined, 'limit') || positiveNumber(combined.match(/^\s*(\d+)/)?.[1]);
    if (remaining === undefined) remaining = namedRateValue(combined, 'remaining');
    resetValue ||= String(namedRateValue(combined, 'reset') ?? '');
  }
  if (!limit && policy) limit = positiveNumber(policy.match(/^\s*(\d+)/)?.[1]) || namedRateValue(policy, 'limit');
  if (!limit || remaining === undefined) return undefined;
  const resetAt = rateLimitResetAt(resetValue, now);
  return {
    limit,
    remaining,
    reserve: Math.max(1, Math.ceil(limit * 0.2)),
    resetAt
  };
}

function positiveNumber(value) {
  const number = Number(String(value ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function nonNegativeNumber(value) {
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function namedRateValue(value, name) {
  const match = String(value || '').match(new RegExp(`(?:^|[,;\\s])${name}\\s*=\\s*"?(\\d+(?:\\.\\d+)?)`, 'i'));
  return match ? Number(match[1]) : undefined;
}

function rateLimitResetAt(value, now) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number > 10_000_000_000) return number;
  if (number > 1_000_000_000) return number * 1000;
  return now + number * 1000;
}

function isNetworkResponse(response) {
  return Boolean(response?.networkError);
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
      ? '服务器暂时拒绝了游客请求（HTTP 403）。仅凭这一次响应无法判断档案是否失效。'
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
  return parseAndFilterGuestCookies(input);
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
  TRANSIENT_PROTECTION_BACKOFF_MS,
  GUEST_COOKIE_NAMES,
  GUEST_COOKIE_SECRET,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
  REQUEST_BURST_CAPACITY,
  REQUEST_REFILL_INTERVAL_MS,
  REQUEST_MODES,
  RateLimitError,
  REQUEST_TIMEOUT_MS,
  SITE_ORIGIN,
  SupersededRequestError,
  TransientProtectionError,
  USER_AGENT_SECRET,
  REQUEST_PROFILE_SECRET,
  assertLinuxDoRequestUrl,
  cookieHeaderFromPairs,
  cacheTtlForUrl,
  cacheKeyForUrl,
  defaultUserAgent,
  fetchGuestResponse,
  isLinuxDoUrl,
  parseCookieHeader,
  parseJsonResponse,
  isCloudflareChallenge,
  isExplicitRateLimitResponse,
  parseRateLimitBudget,
  retryAfterMilliseconds,
  readLimitedText
};
