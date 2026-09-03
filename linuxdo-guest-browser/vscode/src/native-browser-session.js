'use strict';

const crypto = require('node:crypto');

const SITE_ORIGIN = 'https://linux.do';
const OPEN_BROWSER_COMMAND = 'workbench.action.browser.open';
const NATIVE_DEBUG_TYPE = 'editor-browser';
const NATIVE_DEBUG_SESSION_TYPE = 'pwa-editor-browser';
const MINIMUM_NATIVE_BROWSER_VERSION = '1.114.0';
const RESPONSE_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const RESPONSE_CHUNK_BYTES = 60_000;
const CONFIGURATION_SETTLE_MS = 1_000;
const CONFIGURATION_RESTORE_MS = 500;
const DEBUG_TARGET_SETTLE_MS = 3_000;
const CHALLENGE_SETTLE_ATTEMPTS = 15;
const CHALLENGE_SETTLE_INTERVAL_MS = 2_000;

class NativeBrowserUnavailableError extends Error {
  constructor(message, cause) {
    super(message || 'VS Code 原生浏览器暂时不可用。');
    this.name = 'NativeBrowserUnavailableError';
    this.cause = cause;
  }
}

class NativeBrowserSession {
  constructor(vscodeApi, options = {}) {
    if (!vscodeApi?.commands || !vscodeApi?.debug || !vscodeApi?.workspace) {
      throw new TypeError('NativeBrowserSession requires the VS Code API.');
    }
    this.vscode = vscodeApi;
    this.sleep = options.sleep || delay;
    this.now = options.now || (() => Date.now());
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : undefined;
    this.onReady = typeof options.onReady === 'function' ? options.onReady : undefined;
    this.evaluateRequest = options.evaluateRequest || ((session, expression) => session.customRequest('evaluate', {
      expression,
      context: 'repl'
    }));
    this.markerFactory = options.markerFactory || (() => crypto.randomBytes(8).toString('hex'));
    this.supportedPromise = undefined;
    this.attachPromise = undefined;
    this.rootSession = undefined;
    this.evaluationSession = undefined;
    this.sessionTracker = undefined;
    this.browserTab = undefined;
    this.debugTabs = [];
    this.terminationListener = this.vscode.debug.onDidTerminateDebugSession?.((session) => this.handleSessionTermination(session));
    this.sessions = [];
    this.requestCounter = 0;
    this.createSessionIdentity();
  }

  createSessionIdentity() {
    const marker = this.markerFactory();
    this.marker = marker;
    this.sessionUrl = `${SITE_ORIGIN}/latest?linuxdo_guest_reader=${encodeURIComponent(marker)}`;
    this.debugSessionName = `LINUX DO Native Reader ${marker}`;
    this.storeName = `__linuxdoGuestNative_${marker.replace(/[^a-zA-Z0-9_]/g, '')}`;
    this.initialChallengeWaitDone = false;
    this.opened = false;
  }

  async isSupported() {
    if (!this.supportedPromise) {
      this.supportedPromise = (async () => {
        if (compareVersions(this.vscode.version || '0.0.0', MINIMUM_NATIVE_BROWSER_VERSION) < 0) return false;
        const commands = await this.vscode.commands.getCommands(true);
        return commands.includes(OPEN_BROWSER_COMMAND);
      })();
    }
    return this.supportedPromise;
  }

  async fetchResponse(url) {
    const target = url instanceof URL ? url : new URL(String(url), SITE_ORIGIN);
    if (target.origin !== SITE_ORIGIN || target.username || target.password || target.hash) {
      throw new Error('拒绝通过原生浏览器访问非 LINUX DO 接口。');
    }

    let retriedFreshSession = false;
    for (;;) {
      try {
        const session = await this.ensureAttached();
        if (!this.initialChallengeWaitDone) {
          await this.waitForChallengeToSettle(session);
          this.initialChallengeWaitDone = true;
        }
        const response = await this.fetchThroughPage(session, target);
        if (response.status === 403 && isChallengeResponse(response)) {
          this.onStatus?.('Cloudflare 需要验证，请在已打开的原生浏览器标签中完成。');
          await this.revealVerification();
        }
        return { ...response, nativeBrowser: true };
      } catch (error) {
        if (!retriedFreshSession && isStaleDebugSessionError(error)) {
          retriedFreshSession = true;
          await this.resetDebugSession(true);
          continue;
        }
        if (error instanceof NativeBrowserUnavailableError) throw error;
        throw new NativeBrowserUnavailableError(
          `VS Code 原生浏览器连接失败：${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }
    }
  }

  async ensureAttached() {
    if (this.evaluationSession && await this.isEvaluationSessionUsable(this.evaluationSession)) {
      return this.evaluationSession;
    }
    if (this.attachPromise) return this.attachPromise;
    this.attachPromise = this.createAndAttach().finally(() => { this.attachPromise = undefined; });
    return this.attachPromise;
  }

  async createAndAttach() {
    if (!await this.isSupported()) {
      throw new NativeBrowserUnavailableError(`原生浏览器需要 VS Code ${MINIMUM_NATIVE_BROWSER_VERSION} 或更高版本。`);
    }

    this.onStatus?.('正在准备 VS Code 原生游客浏览器...');
    await this.openEphemeralBrowser();
    this.sessions = [];
    this.sessionTracker?.dispose();
    this.sessionTracker = this.vscode.debug.onDidStartDebugSession((session) => {
      if (String(session.type).includes('editor-browser')) this.sessions.push(session);
    });

    const tabsBeforeDebug = listAllTabs(this.vscode);
    const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
    const started = await this.vscode.debug.startDebugging(workspaceFolder, {
      type: NATIVE_DEBUG_TYPE,
      request: 'attach',
      name: this.debugSessionName,
      urlFilter: this.sessionUrl
    }, {
      suppressSaveBeforeStart: true,
      suppressDebugToolbar: true,
      suppressDebugStatusbar: true,
      suppressDebugView: true
    });
    if (!started) throw new NativeBrowserUnavailableError('VS Code 未能启动原生浏览器调试连接。');

    this.rootSession = await this.waitForSession(
      (session) => session.name === this.debugSessionName,
      15_000,
      '等待原生浏览器调试会话超时。'
    );
    await this.sleep(DEBUG_TARGET_SETTLE_MS);
    this.evaluationSession = await this.waitForSession(
      (session) => isMainPageDebugSession(session, this.rootSession, this.debugSessionName),
      12_000,
      '没有找到 LINUX DO 主页面调试目标。'
    );
    this.debugTabs = listAllTabs(this.vscode).filter((tab) =>
      !tabsBeforeDebug.includes(tab) && !isIntegratedBrowserTab(tab) && isLikelyNativeDebugTab(tab)
    );
    this.opened = true;
    this.onStatus?.('原生游客浏览器已连接。');
    await this.onReady?.(this.evaluationSession);
    return this.evaluationSession;
  }

  async openEphemeralBrowser() {
    const configuration = this.vscode.workspace.getConfiguration('workbench.browser');
    const previousGlobalValue = configuration.inspect?.('dataStorage')?.globalValue;
    const tabsBefore = listIntegratedBrowserTabs(this.vscode);
    let changed = false;
    try {
      if (previousGlobalValue !== 'ephemeral') {
        await configuration.update('dataStorage', 'ephemeral', this.vscode.ConfigurationTarget.Global);
        changed = true;
        await this.sleep(CONFIGURATION_SETTLE_MS);
      }
      await this.vscode.commands.executeCommand(OPEN_BROWSER_COMMAND, {
        url: this.sessionUrl,
        reuseUrlFilter: this.sessionUrl
      });
      // The public command does not return a tab handle. Capture the tab opened
      // by this invocation so stop() can close only our isolated browser tab.
      const tabsAfter = listIntegratedBrowserTabs(this.vscode);
      this.browserTab = tabsAfter.find((tab) => !tabsBefore.includes(tab))
        || tabsAfter.find((tab) => tab.isActive && isIntegratedBrowserTab(tab))
        || this.browserTab;
    } finally {
      if (changed) {
        await this.sleep(CONFIGURATION_RESTORE_MS);
        await configuration.update('dataStorage', previousGlobalValue, this.vscode.ConfigurationTarget.Global);
      }
    }
  }

  async waitForSession(predicate, timeoutMs, timeoutMessage) {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      const match = this.sessions.find(predicate);
      if (match) return match;
      if (this.now() >= deadline) throw new NativeBrowserUnavailableError(timeoutMessage);
      await this.sleep(100);
    }
  }

  async isEvaluationSessionUsable(session) {
    try {
      return await this.evaluatePayload(session, 'location.origin') === SITE_ORIGIN;
    } catch {
      return false;
    }
  }

  async waitForChallengeToSettle(session) {
    for (let attempt = 0; attempt < CHALLENGE_SETTLE_ATTEMPTS; attempt += 1) {
      const title = await this.evaluatePayload(session, 'document.title');
      if (!isChallengeTitle(title)) return;
      this.onStatus?.('正在等待 Cloudflare 完成原生浏览器验证...');
      await this.sleep(CHALLENGE_SETTLE_INTERVAL_MS);
    }
  }

  async fetchThroughPage(session, url) {
    const requestId = `${this.now()}_${++this.requestCounter}`;
    const metaExpression = createFetchExpression({
      url: url.toString(),
      storeName: this.storeName,
      requestId,
      timeoutMs: RESPONSE_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES
    });
    let meta;
    try {
      meta = JSON.parse(await this.evaluateEncoded(session, metaExpression));
      if (meta.networkError || meta.tooLarge || !Number.isInteger(meta.byteLength) || meta.byteLength < 0) {
        return { ...meta, text: '' };
      }
      const chunks = [];
      for (let offset = 0; offset < meta.byteLength; offset += RESPONSE_CHUNK_BYTES) {
        const chunkExpression = createChunkExpression({
          storeName: this.storeName,
          requestId,
          start: offset,
          end: Math.min(offset + RESPONSE_CHUNK_BYTES, meta.byteLength)
        });
        chunks.push(Buffer.from(await this.evaluateTaggedBase64(session, chunkExpression), 'base64'));
      }
      const body = Buffer.concat(chunks);
      if (body.length !== meta.byteLength) throw new Error('原生浏览器响应分块长度不一致。');
      return { ...meta, text: body.toString('utf8') };
    } finally {
      try {
        await this.evaluateRaw(session, `delete globalThis[${JSON.stringify(this.storeName)}]?.[${JSON.stringify(requestId)}]`);
      } catch {
        // The debug target may already be gone; its in-page store disappears with it.
      }
    }
  }

  async evaluatePayload(session, valueExpression) {
    return this.evaluateEncoded(session, createEncodeExpression(valueExpression));
  }

  async evaluateEncoded(session, expression) {
    return Buffer.from(await this.evaluateTaggedBase64(session, expression), 'base64').toString('utf8');
  }

  async evaluateTaggedBase64(session, expression) {
    const response = await this.evaluateRaw(session, expression);
    const value = unquoteDebugString(response?.result);
    if (!value.startsWith('LDNB64:')) throw new Error('原生浏览器返回了无法识别的调试数据。');
    return value.slice('LDNB64:'.length);
  }

  async evaluateRaw(session, expression) {
    let lastError;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.evaluateRequest(session, expression);
      } catch (error) {
        lastError = error;
        if (!isDebuggerNotReadyError(error)) throw error;
        await this.sleep(200);
      }
    }
    throw lastError || new Error('原生浏览器页面执行失败。');
  }

  async revealVerification() {
    if (!this.opened) {
      await this.ensureAttached();
      return;
    }
    await this.vscode.commands.executeCommand(OPEN_BROWSER_COMMAND, {
      url: this.sessionUrl,
      reuseUrlFilter: this.sessionUrl
    });
  }

  handleSessionTermination(session) {
    if (![this.rootSession?.id, this.evaluationSession?.id].includes(session?.id)) return;
    this.rootSession = undefined;
    this.evaluationSession = undefined;
    this.initialChallengeWaitDone = false;
  }

  async resetDebugSession(newIdentity = false) {
    const root = this.rootSession;
    const browserTab = this.browserTab;
    const debugTabs = this.debugTabs;
    this.rootSession = undefined;
    this.evaluationSession = undefined;
    this.browserTab = undefined;
    this.debugTabs = [];
    this.sessions = [];
    this.sessionTracker?.dispose();
    this.sessionTracker = undefined;
    if (root) {
      try {
        await Promise.race([
          this.vscode.debug.stopDebugging(root),
          this.sleep(5_000)
        ]);
      } catch {
        // Reconnection below creates a fresh browser identity.
      }
    }
    if (browserTab) {
      try {
        await this.vscode.window?.tabGroups?.close(browserTab, true);
      } catch {
        // A user may have already closed the tab; there is nothing left to do.
      }
    }
    for (const tab of debugTabs) {
      try {
        await this.vscode.window?.tabGroups?.close(tab, true);
      } catch {
        // Debug editors can already be closed by the user.
      }
    }
    if (newIdentity) this.createSessionIdentity();
  }

  async stop() {
    await this.resetDebugSession(false);
    this.terminationListener?.dispose();
    this.terminationListener = undefined;
  }
}

class GuestRequestTransport {
  constructor({ nativeBrowser, manualFetch, mode = 'auto' }) {
    this.nativeBrowser = nativeBrowser;
    this.manualFetch = manualFetch;
    this.mode = normalizeTransportMode(mode);
    this.lastEngine = 'manual';
  }

  setMode(mode) {
    this.mode = normalizeTransportMode(mode);
  }

  async fetchResponse(url, verification, options = {}) {
    // Candidate verification must test the exact Cookie/User-Agent pair the
    // user entered.  Do not silently validate it with the already-running
    // native browser session, whose cookies may be different.
    if (this.mode === 'manual' || options.forceManual) {
      this.lastEngine = 'manual';
      return this.manualFetch(url, verification);
    }
    const supported = await this.nativeBrowser.isSupported();
    if (!supported) {
      if (this.mode === 'native') throw new NativeBrowserUnavailableError('当前 VS Code 不支持原生集成浏览器请求。');
      this.lastEngine = 'manual';
      return this.manualFetch(url, verification);
    }
    try {
      const response = await this.nativeBrowser.fetchResponse(url);
      this.lastEngine = 'native';
      return response;
    } catch (error) {
      if (this.mode !== 'auto' || !(error instanceof NativeBrowserUnavailableError)) throw error;
      this.lastEngine = 'manual';
      return this.manualFetch(url, verification);
    }
  }

  async stop() {
    await this.nativeBrowser.stop();
  }
}

function createFetchExpression({ url, storeName, requestId, timeoutMs, maxBytes }) {
  return `(async()=>{const encode=(text)=>{const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'LDNB64:'+btoa(binary)};const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),${Number(timeoutMs)});try{const response=await fetch(${JSON.stringify(url)},{method:'GET',credentials:'include',cache:'no-store',redirect:'follow',signal:controller.signal});const text=await response.text();const bytes=new TextEncoder().encode(text);const meta={status:response.status,contentLength:bytes.length,byteLength:bytes.length,retryAfter:response.headers.get('retry-after')||'',rateLimit:response.headers.get('ratelimit')||'',rateLimitPolicy:response.headers.get('ratelimit-policy')||'',rateLimitLimit:response.headers.get('ratelimit-limit')||response.headers.get('x-ratelimit-limit')||'',rateLimitRemaining:response.headers.get('ratelimit-remaining')||response.headers.get('x-ratelimit-remaining')||'',rateLimitReset:response.headers.get('ratelimit-reset')||response.headers.get('x-ratelimit-reset')||'',discourseRateLimitCode:response.headers.get('discourse-rate-limit-error-code')||response.headers.get('x-discourse-rate-limit-error-code')||'',contentType:response.headers.get('content-type')||'',cfMitigated:response.headers.get('cf-mitigated')||'',cfRay:response.headers.get('cf-ray')||'',tooLarge:bytes.length>${Number(maxBytes)}};if(!meta.tooLarge){const store=globalThis[${JSON.stringify(storeName)}]||(globalThis[${JSON.stringify(storeName)}]=Object.create(null));store[${JSON.stringify(requestId)}]=bytes}return encode(JSON.stringify(meta))}catch(error){return encode(JSON.stringify({networkError:error?.name==='AbortError'?'timeout':String(error?.message||error)}))}finally{clearTimeout(timer)}})()`;
}

function createChunkExpression({ storeName, requestId, start, end }) {
  return `(()=>{const bytes=globalThis[${JSON.stringify(storeName)}]?.[${JSON.stringify(requestId)}];if(!bytes)throw new Error('native-response-missing');const part=bytes.subarray(${Number(start)},${Number(end)});let binary='';for(let i=0;i<part.length;i+=8192)binary+=String.fromCharCode(...part.subarray(i,i+8192));return 'LDNB64:'+btoa(binary)})()`;
}

function createEncodeExpression(valueExpression) {
  return `(()=>{const text=String(${valueExpression});const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'LDNB64:'+btoa(binary)})()`;
}

function isMainPageDebugSession(session, rootSession, debugSessionName) {
  if (!session || session.id === rootSession?.id || String(session.type) !== NATIVE_DEBUG_SESSION_TYPE) return false;
  const name = String(session.name || '');
  if (isCloudflareChildSessionName(name)) return false;
  return name.includes(`« ${debugSessionName}`) || /linux do|linux\.do|请稍候|just a moment/i.test(name);
}

function isCloudflareChildSessionName(name) {
  return /^(?:blob:|service worker)|challenges\.cloudflare\.com/i.test(String(name || ''));
}

function listIntegratedBrowserTabs(vscodeApi) {
  return (vscodeApi.window?.tabGroups?.all || [])
    .flatMap((group) => group.tabs || [])
    .filter(isIntegratedBrowserTab);
}

function listAllTabs(vscodeApi) {
  return (vscodeApi.window?.tabGroups?.all || []).flatMap((group) => group.tabs || []);
}

function isIntegratedBrowserTab(tab) {
  const input = tab?.input;
  const scheme = String(input?.uri?.scheme || '');
  const viewType = String(input?.viewType || '');
  return scheme === 'vscode-browser' || /browser/i.test(viewType);
}

function isLikelyNativeDebugTab(tab) {
  const label = String(tab?.label || '');
  const description = String(tab?.description || '');
  return /^VM\d+$/i.test(label) || /debugger|debug/i.test(`${label} ${description}`);
}

function isChallengeTitle(title) {
  return /请稍候|just a moment|attention required/i.test(String(title || ''));
}

function isChallengeResponse(response) {
  if (String(response?.cfMitigated || '').toLowerCase() === 'challenge') return true;
  const sample = String(response?.text || '').slice(0, 4_096).toLowerCase();
  return sample.includes('cf-chl-') || sample.includes('just a moment') || sample.includes('/cdn-cgi/challenge-platform');
}

function isDebuggerNotReadyError(error) {
  return /unknown request: evaluate|no debugger available|debugger.*not ready/i.test(String(error?.message || error));
}

function isStaleDebugSessionError(error) {
  return /unknown session id|no debugger available|can not send ['"]evaluate|debug session.*(?:ended|not found)|native-response-missing/i.test(String(error?.message || error));
}

function unquoteDebugString(value) {
  const text = String(value || '');
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") return text.slice(1, -1);
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') return JSON.parse(text);
  throw new Error('原生浏览器调试结果不是字符串。');
}

function normalizeTransportMode(value) {
  return ['auto', 'native', 'manual'].includes(value) ? value : 'auto';
}

function compareVersions(left, right) {
  const leftParts = String(left).split('.').map((value) => Number(value) || 0);
  const rightParts = String(right).split('.').map((value) => Number(value) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function normalizeTransportError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  CHALLENGE_SETTLE_ATTEMPTS,
  CHALLENGE_SETTLE_INTERVAL_MS,
  GuestRequestTransport,
  MAX_RESPONSE_BYTES,
  MINIMUM_NATIVE_BROWSER_VERSION,
  NativeBrowserSession,
  NativeBrowserUnavailableError,
  OPEN_BROWSER_COMMAND,
  RESPONSE_CHUNK_BYTES,
  compareVersions,
  createChunkExpression,
  createEncodeExpression,
  createFetchExpression,
  isChallengeResponse,
  isChallengeTitle,
  isCloudflareChildSessionName,
  isIntegratedBrowserTab,
  isLikelyNativeDebugTab,
  listAllTabs,
  listIntegratedBrowserTabs,
  isMainPageDebugSession,
  isStaleDebugSessionError,
  normalizeTransportMode,
  normalizeTransportError,
  unquoteDebugString
};
