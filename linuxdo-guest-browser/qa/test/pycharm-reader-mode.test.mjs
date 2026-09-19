import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../../pycharm/src/main/resources/reader-mode.js', import.meta.url), 'utf8');

function createReaderMode({ hasContent = true, visible = true, collapsesWhenStyled = false } = {}) {
  const frames = new Map();
  const timers = new Map();
  const logs = [];
  let nextId = 0;
  let observerCallback;
  let disconnected = false;
  class FakeClassList {
    #values = new Set();
    contains(value) { return this.#values.has(value); }
    remove(value) { this.#values.delete(value); }
    toggle(value, enabled) { enabled ? this.#values.add(value) : this.#values.delete(value); }
  }
  class FakeElement {
    constructor() {
      this.classList = new FakeClassList();
      this.dataset = {};
      this.textContent = 'Public topic';
    }
    getBoundingClientRect() {
      const collapsed = !visible || (body.classList.contains('lexiao-demo-mode') && collapsesWhenStyled);
      return { width: collapsed ? 0 : 640, height: collapsed ? 0 : 480 };
    }
    matches() { return false; }
    querySelectorAll() { return []; }
  }
  const body = new FakeElement();
  let content = new FakeElement();
  const document = {
    body,
    readyState: 'complete',
    querySelector: selector => selector.includes('.topic-list') && hasContent ? content : null,
    querySelectorAll: selector => selector.includes('.topic-list') && hasContent ? [content] : [],
  };
  const context = {
    Element: FakeElement,
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      disconnect() { disconnected = true; }
      observe() {}
    },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    console: { info(message) { logs.push(JSON.parse(message.slice('LEXIAO_READER_STATE '.length))); } },
    document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    window: {},
  };
  vm.runInNewContext(source.replace('__LEXIAO_DEMO_MODE__', 'true'), context);
  return {
    active: () => body.classList.contains('lexiao-demo-mode'),
    logs,
    frames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback());
    },
    timer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a ${delay} ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    mutate() { if (!disconnected) observerCallback([{ addedNodes: [content] }]); },
    setVisible(value) { visible = value; },
    setCollapsed(value) { collapsesWhenStyled = value; },
    setContent(value) { hasContent = value; content = new FakeElement(); },
    sync() { context.window.__lexiaoReaderModeSync(); },
    cleanup() { context.window.__lexiaoReaderModeCleanup(); },
    disable() { vm.runInNewContext(source.replace('__LEXIAO_DEMO_MODE__', 'false'), context); },
    retry() {
      disconnected = false;
      vm.runInNewContext(source.replace('__LEXIAO_DEMO_MODE__', 'true'), context);
    },
    pending: () => frames.size + timers.size,
  };
}

test('reader mode waits for supported Discourse content', () => {
  const page = createReaderMode({ hasContent: false });
  assert.equal(page.active(), false);
  page.setContent(true); page.mutate(); page.frames(); page.timer(1000);
  assert.equal(page.active(), true);
});

test('reader mode fails open for actual CSS collapse without retry loops', () => {
  const page = createReaderMode({ collapsesWhenStyled: true });
  page.frames();
  assert.equal(page.active(), false);
  assert.equal(page.logs.at(-1).reason, 'fallback');
  for (let index = 0; index < 5; index++) { page.mutate(); page.frames(); page.sync(); }
  assert.equal(page.active(), false);
  assert.equal(page.pending(), 0);
});

test('reader mode keeps delayed CSS collapse protection', () => {
  const page = createReaderMode();
  page.frames(); page.setCollapsed(true); page.timer(1000);
  assert.equal(page.active(), false);
  assert.equal(page.logs.at(-1).reason, 'delayed-fallback');
});

test('initial hidden content recovers without DOM mutation or reinjection', () => {
  const page = createReaderMode({ visible: false });
  page.frames();
  assert.equal(page.logs.at(-1).reason, 'render-pending');
  assert.equal(page.logs.at(-1).suppressed, false);
  page.timer(500); page.frames(); page.setVisible(true); page.timer(500); page.frames(); page.timer(1000);
  assert.equal(page.active(), true);
  assert.equal(page.logs.at(-1).reason, 'stable');
});

test('stable privacy layout recovers after a SPA outlet is temporarily hidden', () => {
  const page = createReaderMode();
  page.frames(); page.timer(1000);
  page.setVisible(false); page.mutate(); page.frames();
  // The class stays on while Discourse re-renders, otherwise the unstyled forum
  // header, sidebar and avatars would be painted for the length of the transition.
  assert.equal(page.active(), true);
  assert.equal(page.logs.at(-1).reason, 'render-pending');
  assert.equal(page.logs.at(-1).suppressed, false);
  page.setVisible(true); page.mutate(); page.frames(); page.timer(1000);
  assert.equal(page.active(), true);
  page.timer(500); page.frames();
  assert.equal(page.active(), true);
});

test('delayed check during loading waits and recovers', () => {
  const page = createReaderMode();
  page.frames(); page.setVisible(false); page.timer(1000);
  assert.equal(page.logs.at(-1).reason, 'render-pending');
  page.setVisible(true); page.timer(500); page.frames(); page.timer(1000);
  assert.equal(page.active(), true);
});

test('CSS suppression does not carry over to a new SPA content root', () => {
  const page = createReaderMode({ collapsesWhenStyled: true });
  page.frames();
  page.setCollapsed(false); page.setContent(true); page.mutate(); page.frames(); page.timer(1000);
  assert.equal(page.active(), true);
});

test('repeated CSS collapse stops re-arming once the suppression limit is reached', () => {
  const page = createReaderMode({ collapsesWhenStyled: true });
  page.frames();
  assert.equal(page.logs.at(-1).reason, 'fallback');
  // Discourse swaps the content root on poll/append, which releases the latch and
  // retries the privacy layout — but only up to the limit.
  for (let index = 0; index < 2; index++) {
    page.setContent(true); page.mutate(); page.frames();
    assert.equal(page.logs.at(-1).reason, 'fallback');
  }
  page.setContent(true); page.mutate(); page.frames();
  assert.equal(page.active(), false);
  assert.equal(page.logs.at(-1).reason, 'suppressed');
  assert.equal(page.pending(), 0);
});

test('cleanup and disabling cancel pending recovery and leave original layout', () => {
  for (const action of ['cleanup', 'disable']) {
    const page = createReaderMode({ visible: false });
    page.frames(); page[action](); page.setVisible(true); page.mutate(); page.frames();
    assert.equal(page.active(), false);
    assert.equal(page.pending(), 0);
  }
});

test('loading followed by actual CSS collapse fails open without DOM mutation', () => {
  const page = createReaderMode({ visible: false, collapsesWhenStyled: true });
  page.frames();
  page.setVisible(true); page.timer(500); page.frames();
  assert.equal(page.active(), false);
  assert.equal(page.logs.at(-1).reason, 'fallback');
  assert.equal(page.pending(), 0);
});

test('manual retry clears the suppression latch and restores healthy content', () => {
  const page = createReaderMode({ collapsesWhenStyled: true });
  page.frames();
  for (let index = 0; index < 2; index++) {
    page.setContent(true); page.mutate(); page.frames();
  }
  page.setCollapsed(false); page.retry(); page.frames(); page.timer(1000);
  assert.equal(page.active(), true);
  assert.equal(page.logs.at(-1).suppressed, false);
});

test('Java exposes reader fallback state and a reinjection retry command', async () => {
  const java = await readFile(new URL('../../pycharm/src/main/java/studio/lexiao/linuxdo/LinuxDoToolWindowFactory.java', import.meta.url), 'utf8');
  assert.match(java, /message\.startsWith\("LEXIAO_READER_STATE "\)/);
  assert.ok(java.includes('readerFallbackActive = message.contains("\\"suppressed\\":true")'));
  assert.match(java, /if \(demoMode && readerFallbackActive\)/);
  assert.match(java, /menuAction\("重新应用隐私阅读布局（当前已回退）", this::retryReaderMode\)/);
  assert.match(java, /if \(isLoading && trackedLoad\) \{\s*readerFallbackActive = false;/);
  assert.ok(java.includes('executeJavaScript("window.__lexiaoReaderModeApplied=null;"'));
});

test('same-mode Java injection invokes the existing sync entry point', async () => {
  const java = await readFile(new URL('../../pycharm/src/main/java/studio/lexiao/linuxdo/LinuxDoToolWindowFactory.java', import.meta.url), 'utf8');
  assert.match(java, /else if\(window\.__lexiaoReaderModeSync\)\{window\.__lexiaoReaderModeSync\(\);\}/);
});
