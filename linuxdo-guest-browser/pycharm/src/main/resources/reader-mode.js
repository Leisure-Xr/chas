(function () {
  'use strict';

  var enabled = __LEXIAO_DEMO_MODE__;
  if (window.__lexiaoReaderModeCleanup) window.__lexiaoReaderModeCleanup();
  var contentSelector = '.topic-list,.category-list,#topic-title,.topic-post';
  var validationFrame = 0;
  var validationTimer = 0;
  var validationStable = false;
  var modeSuppressed = false;
  var suppressedContent = null;
  var suppressCount = 0;
  var suppressLatched = false;
  var recoveryTimer = 0;
  var lastReportedState = '';
  var SUPPRESS_LIMIT = 3;

  function layoutState(element) {
    if (!element) return null;
    var style = getComputedStyle(element);
    var bounds = element.getBoundingClientRect();
    return {
      display: style.display,
      visibility: style.visibility,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };
  }

  function reportState(reason) {
    var matches = Array.from(document.querySelectorAll(contentSelector));
    var state = {
      reason: reason,
      readyState: document.readyState,
      readerMode: document.body.classList.contains('lexiao-demo-mode'),
      suppressed: modeSuppressed,
      contentCount: matches.length,
      visibleContentCount: matches.filter(function (element) {
        var layout = layoutState(element);
        return layout.display !== 'none'
          && layout.visibility !== 'hidden'
          && layout.width > 0
          && layout.height > 0
          && (element.textContent || '').trim().length > 0;
      }).length,
      body: layoutState(document.body),
      mainOutlet: layoutState(document.querySelector('#main-outlet')),
      readerStyle: Boolean(document.querySelector('#lexiao-guest-reader-style')),
      loadingStyle: Boolean(document.querySelector('#lexiao-guest-loading-privacy'))
    };
    var serialized = JSON.stringify(state);
    if (serialized === lastReportedState) return;
    lastReportedState = serialized;
    console.info('LEXIAO_READER_STATE ' + serialized);
  }

  function hasVisibleReaderContent() {
    return Array.from(document.querySelectorAll(contentSelector)).some(function (element) {
      var style = getComputedStyle(element);
      var bounds = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && bounds.width > 0
        && bounds.height > 0
        && (element.textContent || '').trim().length > 0;
    });
  }

  function syncReaderMode() {
    var content = document.querySelector(contentSelector);
    var hasReaderContent = Boolean(content);
    if (modeSuppressed && !suppressLatched && content !== suppressedContent) {
      modeSuppressed = false;
      suppressedContent = null;
      validationStable = false;
    }
    document.body.classList.toggle('lexiao-demo-mode', enabled && hasReaderContent && !modeSuppressed);
    if (!document.body.classList.contains('lexiao-demo-mode')) {
      if (!modeSuppressed) validationStable = false;
      reportState(modeSuppressed ? 'suppressed' : 'waiting');
      return;
    }
    if (validationFrame) return;
    validationFrame = requestAnimationFrame(function () {
      validationFrame = 0;
      if (!hasVisibleReaderContent()) {
        recoverOrSuppress('fallback');
        return;
      }
      if (validationStable) return;
      reportState('active');
      if (validationTimer) clearTimeout(validationTimer);
      validationTimer = setTimeout(function () {
        validationTimer = 0;
        if (!hasVisibleReaderContent()) {
          recoverOrSuppress('delayed-fallback');
        } else {
          validationStable = true;
          reportState('stable');
        }
      }, 1000);
    });
  }

  function recoverOrSuppress(reason) {
    document.body.classList.remove('lexiao-demo-mode');
    validationStable = false;
    if (validationTimer) clearTimeout(validationTimer);
    validationTimer = 0;
    // Discourse hides the outlet during SPA transitions, independently of our CSS.
    // Re-measuring with the class off is what separates "the privacy CSS collapsed
    // the page" from "the page simply has not rendered yet".
    modeSuppressed = hasVisibleReaderContent();
    if (modeSuppressed) {
      suppressedContent = document.querySelector(contentSelector);
      suppressCount += 1;
      // Discourse swaps the content root on poll/append, which releases the latch.
      // Stop re-arming once the CSS has demonstrably collapsed the page, so a real
      // conflict settles on the original layout instead of flickering forever.
      if (suppressCount >= SUPPRESS_LIMIT) suppressLatched = true;
      reportState(reason);
      return;
    }
    suppressedContent = null;
    // Nothing is visible either way, so the privacy layout is not at fault. Put the
    // class straight back: no paint happens inside one synchronous block, so this
    // never flashes the raw forum — header, sidebar, avatars, usernames — at the
    // user, and the content renders already styled once Discourse lays it out.
    document.body.classList.toggle(
      'lexiao-demo-mode',
      enabled && Boolean(document.querySelector(contentSelector))
    );
    reportState('render-pending');
    if (!recoveryTimer) {
      recoveryTimer = setTimeout(function checkRecovery() {
        recoveryTimer = 0;
        // No content at all: the MutationObserver re-runs syncReaderMode as soon as
        // Discourse inserts the next content root, so the chain can end here.
        if (!document.querySelector(contentSelector)) return;
        // Re-run both layout checks even if styled content is still invisible.
        syncReaderMode();
      }, 500);
    }
  }

  syncReaderMode();
  if (!enabled) return;

  var privateSelector = [
    '.avatar', '.avatar-flair', '.avatar-flair-preview', '.topic-avatar', '.topic-list .posters',
    '.user-card', '.user-card-avatar', '.user-card-popup', '.user-card .badge-wrapper',
    '.user-card .badge-grouping', '.user-card .user-badge', '.user-card .user-status-message',
    '.topic-post .names .badge-wrapper', '.topic-post .names .badge-grouping',
    '.topic-post .names .user-title', '.topic-post .names .user-status',
    '.topic-post .names .poster-icon', '.topic-post .names .full-name',
    '.topic-post .names .primary-group', '.topic-post .names .user-profile-link',
    '.poster-icon', '.presence', '.user-status-background', '.user-status-message'
  ].join(',');
  var usernameSelector = '.topic-post .names a.username,.topic-post .names .username,.topic-post .names a[data-user-card]';

  function mark(element, kind) {
    if (element instanceof Element) element.dataset.lexiaoPrivate = kind;
  }

  function scanAddedNode(root) {
    if (!(root instanceof Element)) return;
    if (root.matches(privateSelector)) mark(root, 'identity');
    if (root.matches(usernameSelector)) mark(root, 'username');
    root.querySelectorAll(privateSelector).forEach(function (element) { mark(element, 'identity'); });
    root.querySelectorAll(usernameSelector).forEach(function (element) { mark(element, 'username'); });
  }

  scanAddedNode(document.body);
  var pendingRoots = new Set();
  var pendingFrame = 0;

  function scanPendingRoots() {
    pendingFrame = 0;
    var roots = pendingRoots;
    pendingRoots = new Set();
    roots.forEach(scanAddedNode);
  }

  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) {
        if (node instanceof Element) pendingRoots.add(node);
      });
    });
    syncReaderMode();
    if (!pendingFrame && pendingRoots.size) pendingFrame = requestAnimationFrame(scanPendingRoots);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.__lexiaoReaderModeSync = syncReaderMode;

  window.__lexiaoReaderModeCleanup = function () {
    observer.disconnect();
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    if (validationFrame) cancelAnimationFrame(validationFrame);
    if (validationTimer) clearTimeout(validationTimer);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    pendingFrame = 0;
    validationFrame = 0;
    validationTimer = 0;
    recoveryTimer = 0;
    validationStable = false;
    pendingRoots.clear();
    document.querySelectorAll('[data-lexiao-private]').forEach(function (element) {
      delete element.dataset.lexiaoPrivate;
    });
    document.body.classList.remove('lexiao-demo-mode');
    window.__lexiaoReaderModeCleanup = null;
    window.__lexiaoReaderModeSync = null;
  };
})();
