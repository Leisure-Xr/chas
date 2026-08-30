(function () {
  'use strict';

  var enabled = __LEXIAO_DEMO_MODE__;
  if (window.__lexiaoReaderModeCleanup) window.__lexiaoReaderModeCleanup();
  document.body.classList.toggle('lexiao-demo-mode', enabled);
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
  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(scanAddedNode);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.__lexiaoReaderModeCleanup = function () {
    observer.disconnect();
    document.querySelectorAll('[data-lexiao-private]').forEach(function (element) {
      delete element.dataset.lexiaoPrivate;
    });
    document.body.classList.remove('lexiao-demo-mode');
    window.__lexiaoReaderModeCleanup = null;
  };
})();
