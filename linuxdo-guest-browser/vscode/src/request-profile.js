'use strict';

const SITE_ORIGIN = 'https://linux.do';
const PROFILE_VERSION = 1;
const REQUEST_PROFILE_SECRET = 'linuxdoGuest.cloudflare.requestProfile.v1';

const CLIENT_HINT_HEADERS = new Set([
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list'
]);
const PASSTHROUGH_HEADERS = new Set(['accept-language']);
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-csrf-token',
  'x-xsrf-token',
  'x-api-key',
  'api-key',
  'api-username',
  'x-discourse-api-key',
  'x-discourse-api-username'
]);
const LOGIN_COOKIE_NAMES = new Set([
  '_t',
  'auth_token',
  'remember_user_token',
  'discourse_auth_token',
  'csrf',
  '_csrf',
  'csrf_token',
  'xsrf_token'
]);
const EXACT_GUEST_COOKIE_NAMES = new Set([
  'cf_clearance',
  '__cf_bm',
  '__cfuvid',
  '_cfuvid',
  '__cfseq',
  '_bypass_cache',
  '_forum_session',
  'cf_chl_2',
  'cf_chl_prog',
  'cf_chl_rc_i',
  'cf_chl_rc_m',
  'cf_chl_rc_ni',
  'cf_ob_info',
  'cf_use_ob'
]);

function parseCapturedRequest(input, sourceHint = 'auto') {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('请粘贴 /latest.json 的 Request Headers 或 Copy as cURL 内容。');
  const parsed = /^\s*curl(?:\.exe)?(?:\s|$)/i.test(raw)
    ? parseCurlRequest(raw)
    : parseRawRequestHeaders(raw);
  assertExactLatestJson(parsed.url);
  rejectCredentialHeaders(parsed.headers);
  const candidate = createRequestProfile({
    cookieHeader: parsed.headers.cookie || '',
    userAgent: parsed.headers['user-agent'] || '',
    headers: parsed.headers,
    source: captureSource(parsed.kind, sourceHint, parsed.headers)
  });
  assertSourceBrowser(sourceHint, candidate.browser.name);
  return { ...candidate, requestUrl: parsed.url || `${SITE_ORIGIN}/latest.json` };
}

function parseRawRequestHeaders(raw) {
  const headers = {};
  let url = '';
  const pseudoHeaders = {};
  for (const sourceLine of String(raw).replace(/\r/g, '').split('\n')) {
    const line = sourceLine.trim();
    if (!line) continue;
    const requestLine = line.match(/^(?:GET|HEAD)\s+(\S+)\s+HTTP\/\S+$/i);
    if (requestLine) {
      url = new URL(requestLine[1], SITE_ORIGIN).toString();
      continue;
    }
    const pseudoHeader = line.match(/^:([a-z0-9-]+)\s*:\s*(.+)$/i);
    if (pseudoHeader) {
      pseudoHeaders[`:${pseudoHeader[1].toLowerCase()}`] = pseudoHeader[2].trim();
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name && value) headers[name] = value;
  }
  if (!url && pseudoHeaders[':path']) {
    const scheme = pseudoHeaders[':scheme'] || 'https';
    const authority = pseudoHeaders[':authority'] || new URL(SITE_ORIGIN).host;
    url = new URL(pseudoHeaders[':path'], `${scheme}://${authority}`).toString();
  }
  return { kind: 'request-headers', url, headers };
}

function parseCurlRequest(raw) {
  const tokens = tokenizeCurl(raw);
  const headers = {};
  let url = '';
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isCredentialCurlOption(token)) {
      throw new Error(`检测到 cURL 认证参数（${token.split('=')[0]}），已拒绝整组导入。`);
    } else if (token === '-H' || token === '--header') {
      addHeader(headers, tokens[++index]);
    } else if (/^-H.+/s.test(token)) {
      addHeader(headers, token.slice(2));
    } else if (token.startsWith('--header=')) {
      addHeader(headers, token.slice('--header='.length));
    } else if (token === '-A' || token === '--user-agent') {
      headers['user-agent'] = String(tokens[++index] || '').trim();
    } else if (/^-A.+/s.test(token)) {
      headers['user-agent'] = token.slice(2).trim();
    } else if (token.startsWith('--user-agent=')) {
      headers['user-agent'] = token.slice('--user-agent='.length).trim();
    } else if (token === '-b' || token === '--cookie') {
      headers.cookie = String(tokens[++index] || '').trim();
    } else if (/^-b.+/s.test(token)) {
      headers.cookie = token.slice(2).trim();
    } else if (token.startsWith('--cookie=')) {
      headers.cookie = token.slice('--cookie='.length).trim();
    } else if (token === '--url') {
      url = String(tokens[++index] || '').trim();
    } else if (token.startsWith('--url=')) {
      url = token.slice('--url='.length).trim();
    } else if (/^https?:\/\//i.test(token)) {
      url = token;
    }
  }
  return { kind: 'curl', url, headers };
}

function isCredentialCurlOption(token) {
  const raw = String(token || '');
  if (/^-(?:u|U|E).+/s.test(raw)) return true;
  const option = raw.split('=')[0].toLowerCase();
  return new Set([
    '-u', '--user', '--proxy-user', '--oauth2-bearer', '--aws-sigv4',
    '--cert', '--cert-type', '--key', '--key-type', '--pass'
  ]).has(option);
}

function tokenizeCurl(raw) {
  const input = String(raw)
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ');
  const tokens = [];
  let token = '';
  let quote = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) {
        quote = '';
      } else if ((character === '\\' || character === '`' || character === '^') && input[index + 1]) {
        token += input[++index];
      } else {
        token += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
    } else if ((character === '\\' || character === '`' || character === '^') && input[index + 1]) {
      token += input[++index];
    } else {
      token += character;
    }
  }
  if (quote) throw new Error('cURL 引号不完整，请重新复制完整命令。');
  if (token) tokens.push(token);
  if (!/^curl(?:\.exe)?$/i.test(tokens[0] || '')) throw new Error('无法识别 cURL 内容。');
  return tokens;
}

function addHeader(headers, headerLine) {
  const line = String(headerLine || '');
  const separator = line.indexOf(':');
  if (separator <= 0) return;
  const name = line.slice(0, separator).trim().toLowerCase();
  const value = line.slice(separator + 1).trim();
  if (name && value) headers[name] = value;
}

function createRequestProfile({ cookieHeader, userAgent, headers = {}, source = 'manual' }) {
  rejectCredentialHeaders(headers);
  const cookies = parseAndFilterGuestCookies(cookieHeader);
  if (!cookies.some(({ name }) => name.toLowerCase() === 'cf_clearance')) {
    throw new Error('参数缺失：没有找到 cf_clearance。');
  }
  const normalizedUserAgent = validateUserAgent(userAgent);
  const clientHints = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName).toLowerCase();
    const value = String(rawValue || '').trim();
    if ((CLIENT_HINT_HEADERS.has(name) || PASSTHROUGH_HEADERS.has(name)) && value && !/[\r\n]/.test(value)) {
      clientHints[name] = value.slice(0, 1024);
    }
  }
  const browser = validateBrowserConsistency(normalizedUserAgent, clientHints);
  const sourceBrowser = String(source || '').match(/(?:^|:)(chrome|edge|brave|chromium)$/i)?.[1];
  if (sourceBrowser) assertSourceBrowser(sourceBrowser, browser.name);
  return {
    version: PROFILE_VERSION,
    cookieHeader: cookies.map(({ name, value }) => `${name}=${value}`).join('; '),
    userAgent: normalizedUserAgent,
    clientHints,
    source: String(source || 'manual').slice(0, 80),
    capturedAt: Date.now(),
    verifiedAt: 0,
    status: 'unverified',
    browser
  };
}

function parseAndFilterGuestCookies(input) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const normalized = !raw.includes('=') && !/[\r\n;]/.test(raw) ? `cf_clearance=${raw}` : raw;
  const selected = new Map();
  for (const part of normalized.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const lowerName = name.toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (LOGIN_COOKIE_NAMES.has(lowerName)) {
      throw new Error(`检测到登录或安全凭据 Cookie（${name}），已拒绝整组导入。请退出登录后重新复制游客请求。`);
    }
    if (isGuestCookieName(lowerName) && value && !/[\r\n;]/.test(value)) selected.set(lowerName, { name, value });
  }
  return [...selected.values()];
}

function isGuestCookieName(name) {
  return EXACT_GUEST_COOKIE_NAMES.has(name) || /^cf_chl_seq_[a-z0-9_-]{1,64}$/i.test(name);
}

function rejectCredentialHeaders(headers) {
  for (const rawName of Object.keys(headers || {})) {
    const name = rawName.toLowerCase();
    if (FORBIDDEN_HEADERS.has(name) || /(?:^|-)csrf(?:-|$)/.test(name) || /(?:api|auth).*(?:key|token)|(?:key|token).*(?:api|auth)/.test(name)) {
      throw new Error(`检测到登录、授权或 API 凭据标头（${rawName}），已拒绝整组导入。`);
    }
  }
}

function validateUserAgent(input) {
  const userAgent = String(input || '').trim();
  if (userAgent.length < 40 || userAgent.length > 1024 || /[\r\n]/.test(userAgent)) {
    throw new Error('参数缺失：User-Agent 格式不完整。Cookie 与 User-Agent 必须来自同一次 /latest.json 请求。');
  }
  if (!/(?:Chrome|Chromium)\/\d+/i.test(userAgent)) {
    throw new Error('浏览器档案不兼容：目前只支持 Chrome、Edge、Brave 或 Chromium 的请求参数。');
  }
  return userAgent;
}

function validateBrowserConsistency(userAgent, hints) {
  const chromeMajor = majorVersion(userAgent, /(?:Chrome|Chromium)\/(\d+)/i);
  const edgeMajor = majorVersion(userAgent, /Edg(?:A|iOS)?\/(\d+)/i);
  const secChUa = hints['sec-ch-ua'] || '';
  const hintChromeMajor = brandMajor(secChUa, ['Google Chrome', 'Chromium']);
  const hintEdgeMajor = brandMajor(secChUa, ['Microsoft Edge']);
  if (hintChromeMajor && chromeMajor && hintChromeMajor !== chromeMajor) {
    throw new Error('参数混用：User-Agent 与 sec-ch-ua 的 Chromium 主版本不一致。请复制同一次 /latest.json 请求。');
  }
  if (edgeMajor && hintEdgeMajor && edgeMajor !== hintEdgeMajor) {
    throw new Error('参数混用：Edge 的 User-Agent 与 sec-ch-ua 主版本不一致。');
  }
  if (!edgeMajor && hintEdgeMajor) throw new Error('参数混用：sec-ch-ua 来自 Edge，但 User-Agent 不是 Edge。');

  const platform = userAgentPlatform(userAgent);
  const hintedPlatform = String(hints['sec-ch-ua-platform'] || '').replace(/^"|"$/g, '').toLowerCase();
  if (hintedPlatform && platform && hintedPlatform !== platform.toLowerCase()) {
    throw new Error(`参数混用：User-Agent 平台为 ${platform}，sec-ch-ua-platform 却为 ${hintedPlatform}。`);
  }
  const browser = edgeMajor ? 'Edge' : /"Brave"/i.test(secChUa) ? 'Brave' : /Chromium\//i.test(userAgent) && !/Chrome\//i.test(userAgent) ? 'Chromium' : 'Chrome';
  return { name: browser, major: edgeMajor || chromeMajor || 0, platform: platform || '未知' };
}

function majorVersion(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? Number(match[1]) : 0;
}

function brandMajor(value, brands) {
  for (const brand of brands) {
    const match = String(value || '').match(new RegExp(`"${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*;\\s*v="(\\d+)"`, 'i'));
    if (match) return Number(match[1]);
  }
  return 0;
}

function userAgentPlatform(userAgent) {
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return '';
}

function captureSource(kind, sourceHint, headers) {
  const hint = String(sourceHint || 'auto').toLowerCase();
  if (hint !== 'auto') return `${kind}:${hint}`;
  if (/Edg\//i.test(headers['user-agent'] || '')) return `${kind}:edge`;
  if (/"Brave"/i.test(headers['sec-ch-ua'] || '')) return `${kind}:brave`;
  return `${kind}:chrome`;
}

function assertSourceBrowser(sourceHint, detectedBrowser) {
  const expected = String(sourceHint || 'auto').trim().toLowerCase();
  if (expected === 'auto') return;
  if (!['chrome', 'edge', 'brave', 'chromium'].includes(expected)) {
    throw new Error('来源浏览器无效，请重新选择 Chrome、Edge、Brave 或 Chromium。');
  }
  if (String(detectedBrowser || '').toLowerCase() !== expected) {
    throw new Error(`参数混用：选择的来源浏览器是 ${browserLabel(expected)}，但请求档案识别为 ${detectedBrowser || '未知浏览器'}。`);
  }
}

function browserLabel(value) {
  return value === 'edge' ? 'Edge' : value === 'brave' ? 'Brave' : value === 'chromium' ? 'Chromium' : 'Chrome';
}

function assertExactLatestJson(rawUrl) {
  if (!rawUrl) return;
  let url;
  try {
    url = new URL(rawUrl, SITE_ORIGIN);
  } catch {
    throw new Error('cURL 中的请求地址无效。');
  }
  const sensitiveQuery = [...url.searchParams.keys()].some((name) =>
    /(?:api|auth).*(?:key|token)|(?:key|token).*(?:api|auth)|api_username/i.test(name));
  if (url.username || url.password || sensitiveQuery) {
    throw new Error('请求地址包含登录、授权或 API 凭据，已拒绝整组导入。');
  }
  if (url.origin !== SITE_ORIGIN || url.pathname !== '/latest.json') {
    throw new Error('请求来源不正确：请复制 https://linux.do/latest.json 的 XHR/fetch 请求，不要复制 /latest 文档请求。');
  }
}

function profileSummary(profile) {
  if (!profile?.cookieHeader || !profile?.userAgent) return undefined;
  return {
    browser: profile.browser?.name || 'Chromium',
    major: Number(profile.browser?.major || 0),
    platform: profile.browser?.platform || '未知',
    source: profile.source || '旧参数迁移',
    cookieNames: parseAndFilterGuestCookies(profile.cookieHeader).map(({ name }) => name),
    clientHintCount: Object.keys(profile.clientHints || {}).length,
    status: profile.status === 'verified'
      ? 'verified'
      : profile.status === 'legacy-unverified' ? 'legacy-unverified' : 'unverified',
    verifiedAt: Number(profile.verifiedAt || 0)
  };
}

function sanitizeStoredProfile(value) {
  try {
    const profile = typeof value === 'string' ? JSON.parse(value) : value;
    if (!profile || profile.version !== PROFILE_VERSION) return undefined;
    const normalized = createRequestProfile({
      cookieHeader: profile.cookieHeader,
      userAgent: profile.userAgent,
      headers: profile.clientHints,
      source: profile.source
    });
    normalized.capturedAt = Number(profile.capturedAt || 0);
    normalized.verifiedAt = Number(profile.verifiedAt || 0);
    normalized.status = profile.status === 'verified'
      ? 'verified'
      : profile.status === 'legacy-unverified' ? 'legacy-unverified' : 'unverified';
    return normalized;
  } catch {
    return undefined;
  }
}

module.exports = {
  CLIENT_HINT_HEADERS,
  EXACT_GUEST_COOKIE_NAMES,
  PROFILE_VERSION,
  REQUEST_PROFILE_SECRET,
  createRequestProfile,
  parseAndFilterGuestCookies,
  parseCapturedRequest,
  parseCurlRequest,
  parseRawRequestHeaders,
  profileSummary,
  sanitizeStoredProfile,
  tokenizeCurl,
  assertSourceBrowser,
  validateBrowserConsistency,
  validateUserAgent
};
