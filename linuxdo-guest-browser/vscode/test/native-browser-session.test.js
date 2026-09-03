'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GuestRequestTransport,
  NativeBrowserSession,
  NativeBrowserUnavailableError,
  OPEN_BROWSER_COMMAND,
  compareVersions,
  isChallengeResponse,
  isChallengeTitle,
  isCloudflareChildSessionName,
  isIntegratedBrowserTab,
  listIntegratedBrowserTabs,
  isMainPageDebugSession,
  isStaleDebugSessionError,
  normalizeTransportMode,
  unquoteDebugString
} = require('../src/native-browser-session');

test('native browser capability is version and command gated', async () => {
  const supported = new NativeBrowserSession(fakeVscode().api, { markerFactory: () => 'supported' });
  assert.equal(await supported.isSupported(), true);

  const old = fakeVscode({ version: '1.113.9' });
  const unsupported = new NativeBrowserSession(old.api, { markerFactory: () => 'old' });
  assert.equal(await unsupported.isSupported(), false);
  assert.equal(compareVersions('1.135.0', '1.114.0'), 1);
  assert.equal(compareVersions('1.114.0', '1.114.0'), 0);
  assert.equal(compareVersions('1.99.0', '1.114.0'), -1);
});

test('native browser creation uses a temporary ephemeral scope and an exact URL filter', async () => {
  let now = 100_000;
  const fixture = fakeVscode();
  const session = new NativeBrowserSession(fixture.api, {
    markerFactory: () => 'fixed-marker',
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; }
  });

  const evaluationSession = await session.ensureAttached();
  assert.equal(evaluationSession.name, 'LINUX DO « LINUX DO Native Reader fixed-marker');
  assert.deepEqual(fixture.configurationUpdates, [
    ['dataStorage', 'ephemeral', 'global'],
    ['dataStorage', undefined, 'global']
  ]);
  assert.deepEqual(fixture.openCalls, [{
    url: 'https://linux.do/latest?linuxdo_guest_reader=fixed-marker',
    reuseUrlFilter: 'https://linux.do/latest?linuxdo_guest_reader=fixed-marker'
  }]);
  assert.equal(fixture.debugStarts[0].configuration.urlFilter, fixture.openCalls[0].url);
  assert.equal(fixture.debugStarts[0].options.suppressDebugToolbar, true);
  assert.equal(fixture.debugStarts[0].options.suppressDebugStatusbar, true);
  assert.equal(fixture.debugStarts[0].options.suppressDebugView, true);
});

test('stopping a native session closes only its integrated browser tab', async () => {
  const fixture = fakeVscode();
  const session = new NativeBrowserSession(fixture.api, { markerFactory: () => 'close-me', sleep: async () => {} });
  await session.ensureAttached();
  assert.equal(fixture.browserTabs.length, 1);
  const browserTab = fixture.browserTabs[0];
  assert.equal(isIntegratedBrowserTab(browserTab), true);
  assert.deepEqual(listIntegratedBrowserTabs(fixture.api), fixture.browserTabs);
  await session.stop();
  assert.deepEqual(fixture.closedTabs, [browserTab]);
  assert.equal(fixture.browserTabs.length, 0);
});

test('Cloudflare iframe targets are rejected while the linux.do main target is selected', () => {
  const root = debugSession('root', 'LINUX DO Native Reader marker');
  const main = debugSession('main', '请稍候… « LINUX DO Native Reader marker');
  const worker = debugSession('worker', 'blob:https://linux.do/worker');
  const challenge = debugSession('challenge', 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform');
  assert.equal(isMainPageDebugSession(main, root, root.name), true);
  assert.equal(isMainPageDebugSession(worker, root, root.name), false);
  assert.equal(isMainPageDebugSession(challenge, root, root.name), false);
  assert.equal(isCloudflareChildSessionName(challenge.name), true);
  assert.equal(isChallengeTitle('请稍候…'), true);
  assert.equal(isChallengeTitle('LINUX DO'), false);
});

test('native page transport reconstructs a multi-chunk UTF-8 response exactly', async () => {
  const body = Buffer.from(JSON.stringify({ text: '测试内容'.repeat(12_000) }), 'utf8');
  const fakeSession = debugSession('main', 'LINUX DO');
  const session = new NativeBrowserSession(fakeVscode().api, {
    markerFactory: () => 'chunks',
    evaluateRequest: async (_debugSession, expression) => {
      if (expression.includes('await fetch(')) {
        return taggedJson({
          status: 200,
          contentLength: body.length,
          byteLength: body.length,
          contentType: 'application/json; charset=utf-8',
          cfMitigated: '',
          cfRay: 'test-ray',
          tooLarge: false
        });
      }
      const range = expression.match(/\.subarray\((\d+),(\d+)\)/);
      if (range) return taggedBytes(body.subarray(Number(range[1]), Number(range[2])));
      if (expression.startsWith('delete ')) return { result: 'true' };
      throw new Error(`Unexpected expression: ${expression.slice(0, 80)}`);
    }
  });
  session.ensureAttached = async () => fakeSession;
  session.initialChallengeWaitDone = true;

  const response = await session.fetchResponse('https://linux.do/latest.json');
  assert.equal(response.status, 200);
  assert.equal(response.nativeBrowser, true);
  assert.equal(response.cfRay, 'test-ray');
  assert.equal(Buffer.byteLength(response.text, 'utf8'), body.length);
  assert.equal(response.text, body.toString('utf8'));
});

test('auto transport falls back only when the native engine is unavailable', async () => {
  let manualCalls = 0;
  const unavailable = {
    isSupported: async () => true,
    fetchResponse: async () => { throw new NativeBrowserUnavailableError('unavailable'); },
    stop: async () => {}
  };
  const automatic = new GuestRequestTransport({
    nativeBrowser: unavailable,
    manualFetch: async () => { manualCalls += 1; return { status: 200, text: '{}' }; },
    mode: 'auto'
  });
  assert.equal((await automatic.fetchResponse(new URL('https://linux.do/latest.json'), {})).status, 200);
  assert.equal(automatic.lastEngine, 'manual');
  assert.equal(manualCalls, 1);

  automatic.setMode('native');
  await assert.rejects(() => automatic.fetchResponse(new URL('https://linux.do/latest.json'), {}), NativeBrowserUnavailableError);
  assert.equal(manualCalls, 1);
});

test('candidate verification can force the exact manual request engine', async () => {
  let manualCalls = 0;
  let nativeCalls = 0;
  const transport = new GuestRequestTransport({
    nativeBrowser: {
      isSupported: async () => true,
      fetchResponse: async () => { nativeCalls += 1; return { status: 200, text: '{}' }; },
      stop: async () => {}
    },
    manualFetch: async (_url, verification) => {
      manualCalls += 1;
      assert.equal(verification.userAgent, 'candidate-agent');
      return { status: 200, text: '{}' };
    },
    mode: 'auto'
  });
  const response = await transport.fetchResponse(
    new URL('https://linux.do/latest.json'),
    { userAgent: 'candidate-agent' },
    { forceManual: true }
  );
  assert.equal(response.status, 200);
  assert.equal(manualCalls, 1);
  assert.equal(nativeCalls, 0);
  assert.equal(transport.lastEngine, 'manual');
});

test('transport helpers classify challenges, stale sessions and debug strings', () => {
  assert.equal(normalizeTransportMode('unknown'), 'auto');
  assert.equal(unquoteDebugString("'LDNB64:e30='"), 'LDNB64:e30=');
  assert.equal(isChallengeResponse({ cfMitigated: 'challenge', text: '' }), true);
  assert.equal(isChallengeResponse({ text: '<html>Just a moment</html>' }), true);
  assert.equal(isChallengeResponse({ status: 200, text: '{}' }), false);
  assert.equal(isStaleDebugSessionError(new Error('Unknown session id: abc')), true);
  assert.equal(isStaleDebugSessionError(new Error('network timeout')), false);
});

function fakeVscode(options = {}) {
  const startListeners = [];
  const terminateListeners = [];
  const configurationUpdates = [];
  const openCalls = [];
  const debugStarts = [];
  const browserTabs = [];
  const closedTabs = [];
  const browserTab = { label: 'LINUX DO', isActive: true, input: { uri: { scheme: 'vscode-browser' }, viewType: 'workbench.editors.browser' } };
  const configuration = {
    inspect: () => ({ globalValue: undefined }),
    update: async (key, value, target) => configurationUpdates.push([key, value, target])
  };
  const api = {
    version: options.version || '1.135.0',
    ConfigurationTarget: { Global: 'global' },
    commands: {
      getCommands: async () => ['workbench.action.browser.open'],
      executeCommand: async (_command, value) => { openCalls.push(value); }
    },
    debug: {
      onDidStartDebugSession: (listener) => {
        startListeners.push(listener);
        return { dispose: () => {} };
      },
      onDidTerminateDebugSession: (listener) => {
        terminateListeners.push(listener);
        return { dispose: () => {} };
      },
      startDebugging: async (_folder, configurationValue, optionsValue) => {
        debugStarts.push({ configuration: configurationValue, options: optionsValue });
        const root = debugSession('root', configurationValue.name);
        const main = debugSession('main', `LINUX DO « ${configurationValue.name}`);
        for (const listener of startListeners) listener(root);
        for (const listener of startListeners) listener(main);
        return true;
      },
      stopDebugging: async () => true
    },
    window: {
      tabGroups: {
        all: [{ tabs: browserTabs }],
        close: async (tab) => {
          closedTabs.push(tab);
          const index = browserTabs.indexOf(tab);
          if (index >= 0) browserTabs.splice(index, 1);
          return true;
        }
      }
    },
    workspace: {
      workspaceFolders: [{ uri: 'file:///workspace' }],
      getConfiguration: () => configuration
    }
  };
  const originalExecute = api.commands.executeCommand;
  api.commands.executeCommand = async (command, value) => {
    const result = await originalExecute(command, value);
    if (command === OPEN_BROWSER_COMMAND && !browserTabs.includes(browserTab)) browserTabs.push(browserTab);
    return result;
  };
  return { api, configurationUpdates, debugStarts, openCalls, terminateListeners, browserTabs, closedTabs };
}

function debugSession(id, name) {
  return { id, name, type: 'pwa-editor-browser', customRequest: async () => ({}) };
}

function taggedJson(value) {
  return taggedBytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function taggedBytes(value) {
  return { result: `'LDNB64:${Buffer.from(value).toString('base64')}'` };
}
