'use strict';

const SITE_ORIGIN = 'https://linux.do';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
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

class GuestRequestSession {
  constructor(secrets) {
    this.secrets = secrets;
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

  async request(rawPath) {
    const url = assertLinuxDoRequestUrl(rawPath);
    const verification = await this.getStoredVerification();
    const response = await fetchGuestResponse(url, verification);
    return parseJsonResponse(response, Boolean(verification.cookieHeader && verification.userAgent));
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

    if (validate) {
      const response = await fetchGuestResponse(new URL('/latest.json', SITE_ORIGIN), {
        cookieHeader: filteredCookies,
        userAgent: normalizedUserAgent
      });
      const data = parseJsonResponse(response, true);
      if (!Array.isArray(data.topic_list?.topics)) {
        throw new Error('参数测试返回的数据不完整。');
      }
    }

    await this.secrets.store(GUEST_COOKIE_SECRET, filteredCookies);
    await this.secrets.delete(CLEARANCE_SECRET);
    await this.secrets.store(USER_AGENT_SECRET, normalizedUserAgent);
    return { cookieHeader: filteredCookies, userAgent: normalizedUserAgent };
  }

  async stop() {
    // Manual mode owns no browser process or temporary profile.
  }
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
      ? 'Cloudflare 仍拒绝这组参数。请在获取参数的同一个浏览器中重新验证，并从 Network 请求复制完整 Cookie 与 User-Agent。'
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
  GUEST_COOKIE_NAMES,
  GUEST_COOKIE_SECRET,
  GuestRequestSession,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  SITE_ORIGIN,
  USER_AGENT_SECRET,
  assertLinuxDoRequestUrl,
  cookieHeaderFromPairs,
  defaultUserAgent,
  fetchGuestResponse,
  isLinuxDoUrl,
  parseCookieHeader,
  parseJsonResponse,
  readLimitedText
};
