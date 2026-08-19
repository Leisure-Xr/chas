'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SITE_ORIGIN = 'https://linux.do';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;
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
      ? 'Cloudflare 验证已失效，请重新连接独立游客浏览器。'
      : 'Cloudflare 要求人机验证。'));
    this.name = 'CloudflareError';
    this.hasClearance = hasClearance;
  }
}

class CdpClient {
  static async connect(url) {
    const client = new CdpClient(url);
    await client.open();
    return client;
  }

  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接浏览器调试端口超时。')), 5_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('无法连接独立游客浏览器。'));
      }, { once: true });
      this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
      this.socket.addEventListener('close', () => this.rejectPending());
    });
  }

  send(method, params = {}, timeoutMs = 5_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器命令超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  handleMessage(rawData) {
    let message;
    try {
      message = JSON.parse(typeof rawData === 'string' ? rawData : Buffer.from(rawData).toString('utf8'));
    } catch {
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || '浏览器命令失败。'));
    else pending.resolve(message.result || {});
  }

  rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('独立游客浏览器连接已关闭。'));
    }
    this.pending.clear();
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // The browser may already have closed the socket.
    }
  }
}

class ChromiumGuestSession {
  constructor(secrets) {
    this.secrets = secrets;
    this.browser = undefined;
    this.browserClient = undefined;
    this.pageClient = undefined;
    this.profileDir = undefined;
    this.port = undefined;
    this.browserWebSocketUrl = undefined;
    this.targetId = undefined;
    this.startPromise = undefined;
    this.stopPromise = undefined;
    this.lifecycleGeneration = 0;
  }

  get isRunning() {
    return Boolean(this.browser && this.browser.exitCode === null && this.pageClient);
  }

  async hasStoredVerification() {
    return Boolean(await this.secrets.get(GUEST_COOKIE_SECRET) || await this.secrets.get(CLEARANCE_SECRET));
  }

  async request(rawPath) {
    const url = assertLinuxDoRequestUrl(rawPath);
    try {
      await this.start({ useStoredVerification: true, visible: false });
      const response = await this.browserFetch(url);
      return parseBrowserJsonResponse(response, await this.hasStoredVerification());
    } catch (error) {
      if (error instanceof CloudflareError) {
        await this.showVerificationPage().catch(() => undefined);
        throw error;
      }
      if (!this.isRunning) {
        throw new CloudflareError(true, '独立游客浏览器会话已关闭，请点击“更新验证”重新连接。');
      }
      throw error;
    }
  }

  async verifyInteractively({ cancellationToken, report } = {}) {
    await this.start({
      useStoredVerification: true,
      visible: true,
      allowUserAgentMismatch: true,
      cancellationToken
    });
    await this.showVerificationPage();
    report?.('等待 Cloudflare 验证完成…');
    const startedAt = Date.now();
    while (Date.now() - startedAt < VERIFICATION_TIMEOUT_MS) {
      if (cancellationToken?.isCancellationRequested) {
        throw new Error('已取消验证。');
      }
      if (!this.isRunning) {
        throw new Error('独立游客浏览器已关闭，请重新验证。');
      }
      const result = await this.readVerifiedState().catch(() => undefined);
      if (result) {
        await this.saveVerifiedState(result);
        await this.minimizeWindow().catch(() => undefined);
        return result;
      }
      await delay(900);
    }
    throw new Error('等待验证超时，请重试。');
  }

  async validateStoredVerification() {
    await this.start({ useStoredVerification: true, visible: true });
    const result = await this.readVerifiedState();
    if (!result) {
      await this.showVerificationPage().catch(() => undefined);
      throw new CloudflareError(true, '粘贴的参数未通过浏览器验证，请改用“自动验证”。');
    }
    await this.saveVerifiedState(result);
    await this.minimizeWindow().catch(() => undefined);
    return result;
  }

  async start(options = {}) {
    if (this.stopPromise) await this.stopPromise;
    if (this.isRunning) {
      if (options.visible) await this.restoreWindow().catch(() => undefined);
      return;
    }
    if (this.startPromise) return this.startPromise;

    if (this.hasSessionState()) await this.stop();
    const generation = this.lifecycleGeneration;
    this.startPromise = this.startInternal(options, generation).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  async startInternal({
    useStoredVerification = false,
    visible = false,
    allowUserAgentMismatch = false,
    cancellationToken
  } = {}, generation) {
    if (typeof WebSocket !== 'function') {
      throw new Error('当前 VS Code 版本不支持浏览器会话，请升级 VS Code。');
    }
    const executable = findChromiumExecutable();
    if (!executable) {
      throw new Error('未找到 Google Chrome、Chromium、Microsoft Edge 或 Brave。');
    }
    const storedCookies = useStoredVerification ? await getStoredCookieHeader(this.secrets) : '';
    if (cancellationToken?.isCancellationRequested) throw new Error('已取消验证。');
    this.assertLifecycleGeneration(generation);
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxdo-guest-cf-'));
    const args = [
      `--user-data-dir=${this.profileDir}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-timer-throttling',
      '--new-window',
      'about:blank'
    ];
    if (!visible && storedCookies) args.splice(args.length - 2, 0, '--start-minimized');
    const browser = spawn(executable, args, { detached: false, stdio: 'ignore' });
    this.browser = browser;
    browser.once('exit', () => {
      if (this.browser !== browser) return;
      this.pageClient?.close();
      this.browserClient?.close();
      this.pageClient = undefined;
      this.browserClient = undefined;
    });

    try {
      const activePort = await waitForDevTools(
        path.join(this.profileDir, 'DevToolsActivePort'),
        browser,
        cancellationToken
      );
      this.assertLifecycleGeneration(generation);
      this.port = activePort.port;
      this.browserWebSocketUrl = `ws://127.0.0.1:${activePort.port}${activePort.browserPath}`;
      this.browserClient = await CdpClient.connect(this.browserWebSocketUrl);
      const target = await waitForPageTarget(this.port);
      this.assertLifecycleGeneration(generation);
      this.targetId = target.id;
      this.pageClient = await CdpClient.connect(target.webSocketDebuggerUrl);
      await this.pageClient.send('Network.enable');

      const actualUserAgent = await this.readUserAgent();
      const savedUserAgent = useStoredVerification ? await this.secrets.get(USER_AGENT_SECRET) : undefined;
      if (storedCookies && savedUserAgent && savedUserAgent.trim() !== actualUserAgent && !allowUserAgentMismatch) {
        throw new CloudflareError(true, '保存的 User-Agent 与当前浏览器不一致，请改用“自动验证”。');
      }
      if (storedCookies && (!savedUserAgent || savedUserAgent.trim() === actualUserAgent)) {
        await this.injectCookies(storedCookies);
      }
      await this.pageClient.send('Page.navigate', { url: `${SITE_ORIGIN}/latest` });
      await waitForLinuxDoPage(this.pageClient);
      this.assertLifecycleGeneration(generation);
      if (visible) await this.restoreWindow().catch(() => undefined);
      else await this.minimizeWindow().catch(() => undefined);
    } catch (error) {
      await this.disposeCurrentSession();
      throw error;
    }
  }

  async browserFetch(url) {
    if (!this.isRunning) {
      throw new Error('独立游客浏览器未运行。');
    }
    const expression = buildBrowserFetchExpression(url, REQUEST_TIMEOUT_MS);
    const evaluation = await this.pageClient.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, REQUEST_TIMEOUT_MS + 7_000);
    if (evaluation.exceptionDetails) {
      throw new Error('浏览器内请求执行失败。');
    }
    const value = evaluation.result?.value;
    if (!value || typeof value !== 'object') {
      throw new Error('浏览器没有返回可识别的数据。');
    }
    return value;
  }

  async readVerifiedState() {
    if (!this.isRunning) return undefined;
    const cookiesResult = await this.pageClient.send('Network.getCookies', { urls: [`${SITE_ORIGIN}/`] });
    const cookieHeader = browserCookiesToHeader(cookiesResult.cookies || []);
    if (!/(?:^|;\s*)cf_clearance=/i.test(cookieHeader)) return undefined;
    const response = await this.browserFetch(new URL('/latest.json', SITE_ORIGIN));
    if (response.status !== 200) return undefined;
    try {
      const data = JSON.parse(response.text);
      if (!Array.isArray(data.topic_list?.topics)) return undefined;
    } catch {
      return undefined;
    }
    return { cookieHeader, userAgent: await this.readUserAgent() };
  }

  async readUserAgent() {
    const result = await this.pageClient.send('Runtime.evaluate', {
      expression: 'navigator.userAgent',
      returnByValue: true
    });
    const userAgent = result.result?.value;
    if (typeof userAgent !== 'string' || userAgent.length < 20) {
      throw new Error('无法读取独立游客浏览器的 User-Agent。');
    }
    return userAgent.trim();
  }

  async injectCookies(cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader).map(({ name, value }) => ({
      name,
      value,
      url: SITE_ORIGIN,
      secure: true
    }));
    if (cookies.length) {
      await this.pageClient.send('Network.setCookies', { cookies });
    }
  }

  async saveVerifiedState(result) {
    await this.secrets.store(GUEST_COOKIE_SECRET, result.cookieHeader);
    await this.secrets.delete(CLEARANCE_SECRET);
    await this.secrets.store(USER_AGENT_SECRET, result.userAgent);
  }

  async showVerificationPage() {
    if (!this.isRunning) return;
    await this.pageClient.send('Page.navigate', { url: `${SITE_ORIGIN}/latest` });
    await waitForLinuxDoPage(this.pageClient);
    await this.restoreWindow();
  }

  async getWindowId() {
    if (!this.browserClient || !this.targetId) throw new Error('浏览器窗口不可用。');
    const result = await this.browserClient.send('Browser.getWindowForTarget', { targetId: this.targetId });
    return result.windowId;
  }

  async restoreWindow() {
    const windowId = await this.getWindowId();
    await this.browserClient.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await this.pageClient.send('Page.bringToFront');
  }

  async minimizeWindow() {
    const windowId = await this.getWindowId();
    await this.browserClient.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  }

  async stop() {
    this.lifecycleGeneration += 1;
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.disposeCurrentSession().finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  hasSessionState() {
    return Boolean(this.browser || this.browserClient || this.pageClient || this.profileDir);
  }

  assertLifecycleGeneration(generation) {
    if (generation !== this.lifecycleGeneration) {
      throw new Error('独立游客浏览器会话已关闭。');
    }
  }

  async disposeCurrentSession() {
    const browser = this.browser;
    const browserClient = this.browserClient;
    const pageClient = this.pageClient;
    const profileDir = this.profileDir;
    this.browser = undefined;
    this.browserClient = undefined;
    this.pageClient = undefined;
    this.profileDir = undefined;
    this.port = undefined;
    this.browserWebSocketUrl = undefined;
    this.targetId = undefined;
    try {
      if (browserClient) {
        await browserClient.send('Browser.close', {}, 3_000).catch(() => undefined);
      }
      if (browser?.exitCode === null) browser.kill('SIGTERM');
      if (browser && !await waitForProcessExit(browser, 3_000) && browser.exitCode === null) {
        browser.kill('SIGKILL');
        await waitForProcessExit(browser, 2_000);
      }
    } finally {
      pageClient?.close();
      browserClient?.close();
      if (profileDir && isOwnedTemporaryProfile(profileDir)) {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true });
        } catch {
          // Chrome can briefly retain files after exit; the OS temp folder owns leftovers.
        }
      }
    }
  }
}

function assertLinuxDoRequestUrl(rawPath) {
  const url = rawPath instanceof URL ? rawPath : new URL(String(rawPath), SITE_ORIGIN);
  if (url.origin !== SITE_ORIGIN || url.username || url.password || url.hash) {
    throw new Error('拒绝访问非 LINUX DO 接口。');
  }
  return url;
}

function buildBrowserFetchExpression(url, timeoutMs) {
  return `(async()=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),${Number(timeoutMs)});try{const response=await fetch(${JSON.stringify(url.toString())},{method:'GET',credentials:'include',redirect:'follow',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});const contentLength=Number(response.headers.get('content-length')||0);if(contentLength>${MAX_RESPONSE_BYTES})return{status:response.status,contentLength,tooLarge:true,text:''};if(!response.body){const text=await response.text();return{status:response.status,contentLength,text}}const reader=response.body.getReader();const decoder=new TextDecoder();let received=0,text='';for(;;){const{done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>${MAX_RESPONSE_BYTES}){await reader.cancel();return{status:response.status,contentLength,tooLarge:true,text:''}}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();return{status:response.status,contentLength,text};}catch(error){return{networkError:String(error&&error.name==='AbortError'?'timeout':error&&error.message||error)}}finally{clearTimeout(timer)}})()`;
}

function parseBrowserJsonResponse(response, hasClearance) {
  if (response.networkError === 'timeout') throw new Error('连接 LINUX DO 超时。');
  if (response.networkError) throw new Error('无法连接 LINUX DO，请检查网络、代理或 DNS 设置。');
  if (response.status === 403) throw new CloudflareError(hasClearance);
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

function parseCookieHeader(input) {
  const cookies = [];
  for (const part of String(input || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (GUEST_COOKIE_NAMES.has(name) && value && !/[\r\n;]/.test(value)) cookies.push({ name, value });
  }
  return cookies;
}

function browserCookiesToHeader(cookies) {
  const linuxDoCookies = (cookies || []).filter((cookie) =>
    cookie && (cookie.domain === 'linux.do' || cookie.domain === '.linux.do'));
  const hasLoginCookie = linuxDoCookies.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value);
  return linuxDoCookies
    .filter((cookie) => GUEST_COOKIE_NAMES.has(cookie.name))
    .filter((cookie) => !(hasLoginCookie && cookie.name === '_forum_session'))
    .filter((cookie) => cookie.value && !/[\r\n;]/.test(cookie.value))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function getStoredCookieHeader(secrets) {
  const current = await secrets.get(GUEST_COOKIE_SECRET);
  if (current) return current;
  const legacy = await secrets.get(CLEARANCE_SECRET);
  return legacy ? `cf_clearance=${legacy}` : '';
}

function findChromiumExecutable() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ]
    : process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Chromium/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware/Brave-Browser/Application/brave.exe')
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
          '/usr/bin/brave-browser'
        ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function waitForDevTools(activePortFile, browser, cancellationToken) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (cancellationToken?.isCancellationRequested) throw new Error('已取消验证。');
    if (browser.exitCode !== null) throw new Error(`浏览器提前退出（代码 ${browser.exitCode}）。`);
    try {
      const [portLine, browserPath] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && browserPath?.startsWith('/devtools/browser/')) {
        return { port, browserPath };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(200);
  }
  throw new Error('无法连接独立游客浏览器。');
}

async function waitForPageTarget(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {
      // DevTools can publish its port just before the HTTP endpoint starts accepting connections.
    }
    await delay(200);
  }
  throw new Error('无法找到独立游客浏览器页面。');
}

async function waitForLinuxDoPage(pageClient) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    try {
      const result = await pageClient.send('Runtime.evaluate', {
        expression: '({origin:location.origin,readyState:document.readyState})',
        returnByValue: true
      });
      const state = result.result?.value;
      if (state?.origin === SITE_ORIGIN && state.readyState !== 'loading') return;
    } catch {
      // Navigation replaces the execution context; retry against the new document.
    }
    await delay(200);
  }
  throw new Error('LINUX DO 验证页面加载超时。');
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function isOwnedTemporaryProfile(profileDir) {
  const relative = path.relative(os.tmpdir(), profileDir);
  return relative.startsWith('linuxdo-guest-cf-') && !relative.includes(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isLinuxDoUrl(value) {
  try {
    return assertLinuxDoRequestUrl(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  ChromiumGuestSession,
  CloudflareError,
  CdpClient,
  CLEARANCE_SECRET,
  GUEST_COOKIE_NAMES,
  GUEST_COOKIE_SECRET,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  SITE_ORIGIN,
  USER_AGENT_SECRET,
  assertLinuxDoRequestUrl,
  browserCookiesToHeader,
  buildBrowserFetchExpression,
  findChromiumExecutable,
  isLinuxDoUrl,
  isOwnedTemporaryProfile,
  parseBrowserJsonResponse,
  parseCookieHeader,
  waitForDevTools
};
