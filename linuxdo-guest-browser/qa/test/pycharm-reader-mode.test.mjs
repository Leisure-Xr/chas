import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../../pycharm/src/main/resources/reader-mode.js', import.meta.url), 'utf8');

function runReaderMode({ hasContent, collapsesWhenStyled = false, collapsesAfterDelay = false }) {
  let delayedCollapse = false;
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
      this.textContent = hasContent ? '公开话题' : '';
    }

    getBoundingClientRect() {
      const collapsed = body.classList.contains('lexiao-demo-mode')
        && (collapsesWhenStyled || delayedCollapse);
      return { width: collapsed ? 0 : 640, height: collapsed ? 0 : 480 };
    }

    matches() { return false; }
    querySelectorAll() { return []; }
  }

  const body = new FakeElement();
  const content = new FakeElement();
  const document = {
    body,
    readyState: 'complete',
    querySelector: () => hasContent ? content : null,
    querySelectorAll: () => hasContent ? [content] : [],
  };
  class FakeMutationObserver {
    disconnect() {}
    observe() {}
  }
  const context = {
    Array,
    Boolean,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    Set,
    cancelAnimationFrame() {},
    clearTimeout() {},
    console: { info() {} },
    document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    requestAnimationFrame(callback) { callback(); return 1; },
    setTimeout(callback) {
      delayedCollapse = collapsesAfterDelay;
      callback();
      return 1;
    },
    window: {},
  };
  vm.runInNewContext(source.replace('__LEXIAO_DEMO_MODE__', 'true'), context);
  return body.classList.contains('lexiao-demo-mode');
}

test('PyCharm reader mode waits for supported Discourse content', () => {
  assert.equal(runReaderMode({ hasContent: false }), false);
  assert.equal(runReaderMode({ hasContent: true }), true);
});

test('PyCharm reader mode fails open when privacy CSS collapses the page', () => {
  assert.equal(runReaderMode({ hasContent: true, collapsesWhenStyled: true }), false);
});

test('PyCharm reader mode fails open when privacy CSS collapses after initial layout', () => {
  assert.equal(runReaderMode({ hasContent: true, collapsesAfterDelay: true }), false);
});
