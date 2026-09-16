import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const probeSource = await readFile(
  new URL('../../pycharm/src/main/resources/page-probe.js', import.meta.url),
  'utf8'
);
const factorySource = await readFile(
  new URL('../../pycharm/src/main/java/studio/lexiao/linuxdo/LinuxDoToolWindowFactory.java', import.meta.url),
  'utf8'
);

// 0.14.1–0.14.3 都是"日志说修好了、屏幕上还是白的"。根因是唯一的诊断通道挂在了
// 那条已经断掉的链路上，只能观测到每个会话的第一次加载——恰好是唯一正常的那次。
// 下面这些断言守的就是"验证通道本身不能死"。

function runProbe({ bodyOpacity = '1', pointElement = 'content' } = {}) {
  const messages = [];

  class FakeElement {
    constructor(tagName, { id = '', className = '', text = '', bg = 'rgb(255, 255, 255)' } = {}) {
      this.tagName = tagName;
      this.id = id;
      this.className = className;
      this.textContent = text;
      this.backgroundColor = bg;
      this.parentElement = null;
    }

    getBoundingClientRect() {
      return { width: 640, height: 480, left: 0, top: 0 };
    }
  }

  const html = new FakeElement('HTML', { bg: 'rgb(255, 255, 255)' });
  const body = new FakeElement('BODY', { bg: 'rgba(0, 0, 0, 0)' });
  body.parentElement = html;
  const content = new FakeElement('DIV', {
    id: 'main-outlet',
    className: 'topic-list',
    text: '公开主题标题',
    bg: 'rgba(0, 0, 0, 0)',
  });
  content.parentElement = body;

  const elements = { html, body, content };

  const document = {
    documentElement: html,
    body,
    scrollingElement: html,
    readyState: 'complete',
    querySelector: (selector) => (selector === '#main-outlet' ? content : null),
    getElementById: () => null,
    elementFromPoint: () => (pointElement ? elements[pointElement] : null),
  };

  const context = {
    Array,
    Boolean,
    JSON,
    Math,
    clearTimeout() {},
    setTimeout() { return 1; },
    console: { info: (message) => messages.push(message) },
    document,
    location: { pathname: '/latest', search: '' },
    getComputedStyle: (element) => ({
      display: 'block',
      visibility: 'visible',
      opacity: element === body ? bodyOpacity : '1',
      filter: 'none',
      transform: 'none',
      contentVisibility: 'visible',
      backgroundColor: element.backgroundColor,
      color: 'rgb(28, 30, 33)',
    }),
    window: { innerWidth: 900, innerHeight: 700, visualViewport: null },
  };
  context.window.document = document;

  vm.runInNewContext(probeSource, context);
  const tagged = messages.filter((message) => message.startsWith('LEXIAO_PAGE_PROBE '));
  return tagged.map((message) => JSON.parse(message.slice('LEXIAO_PAGE_PROBE '.length)));
}

test('page probe reports without depending on reader mode being applied', () => {
  const reports = runProbe();
  assert.ok(reports.length >= 1, 'probe must report even with no reader-mode state present');
  assert.equal(reports[0].reason, 'settled');
});

test('page probe measures visibility, not just geometry', () => {
  const [state] = runProbe({ bodyOpacity: '0' });
  // 旧的 reportState() 只量 display/visibility/尺寸，opacity:0 的整页会被判为"正常"。
  assert.equal(state.body.opacity, '0');
  for (const key of ['filter', 'transform', 'contentVisibility', 'bg', 'fg']) {
    assert.ok(key in state.body, `body.${key} must be reported`);
  }
  assert.ok(state.scroll && 'y' in state.scroll, 'scroll offset must be reported');
  assert.ok(state.viewport.w > 0 && state.viewport.h > 0, 'viewport must be reported');
});

test('page probe samples what Chromium actually hit-tests at viewport points', () => {
  const [state] = runProbe();
  assert.ok(state.points.length >= 3, 'must sample several viewport points');
  const point = state.points[0];
  assert.equal(point.tag, 'div');
  assert.equal(point.text, '公开主题标题');
  // 元素自身是透明的，报出来的必须是最近不透明祖先的颜色，否则"看上去是白的"无从判断。
  assert.equal(point.bg, 'rgb(255, 255, 255)');
  assert.equal(point.fg, 'rgb(28, 30, 33)');
});

test('page probe still reports when nothing is hit-tested at the sample points', () => {
  const [state] = runProbe({ pointElement: null });
  assert.ok(state.points.length >= 3);
  assert.equal(state.points[0].tag, null);
});

test('loading privacy mask clears itself without any Java callback', () => {
  const mask = factorySource.slice(
    factorySource.indexOf('private void applyLoadingPrivacyStyle')
  ).slice(0, factorySource.slice(factorySource.indexOf('private void applyLoadingPrivacyStyle')).indexOf('\n        }'));
  assert.match(mask, /__lexiaoLoadingMaskTimer\s*=\s*setTimeout/, 'mask must arm a JS-side self-clear timer');
  assert.match(mask, /stale\.remove\(\)/, 'mask self-clear must actually remove the style element');
  assert.match(mask, /LOADING_MASK_MAX_MILLIS/, 'self-clear delay must come from the shared constant');
});

test('probe injection is not gated on the load-completion path it diagnoses', () => {
  const handler = factorySource.slice(
    factorySource.indexOf('public void onLoadingStateChange'),
    factorySource.indexOf('public void onLoadEnd')
  );
  const at = handler.indexOf('injectPageProbe');
  assert.ok(at > 0, 'probe must be injected from the loading-state handler');
  const guard = handler.slice(handler.lastIndexOf('if (', at), at).replace(/\/\/[^\n]*/g, '');
  assert.ok(
    !/documentLoadState|trackedLoad|demoMode|mainLoadFailed/.test(guard),
    `probe injection must not be gated on document-completion state, got guard: ${guard.trim()}`
  );
});

test('a load that stops without settling never silently disarms both timers', () => {
  const handler = factorySource.slice(
    factorySource.indexOf('public void onLoadingStateChange'),
    factorySource.indexOf('public void onLoadEnd')
  );
  assert.match(
    handler,
    /completeFromLoadingState\(\)\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?documentSettleTimer\.restart\(\)/,
    'failing to settle must arm the settle watchdog'
  );
  assert.ok(
    factorySource.includes('private void handleSettleTimeout'),
    'settle watchdog handler must exist'
  );
});
