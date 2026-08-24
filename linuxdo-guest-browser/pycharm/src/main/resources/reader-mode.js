(function () {
  'use strict';

  var enabled = __LEXIAO_DEMO_MODE__;
  if (window.__lexiaoReaderModeCleanup) window.__lexiaoReaderModeCleanup();
  document.body.classList.toggle('lexiao-demo-mode', enabled);

  var existing = document.getElementById('lexiao-demo-header');
  if (!enabled) {
    if (existing) existing.remove();
    return;
  }

  var scheduled = false;
  function fileName() {
    var path = location.pathname || '/latest';
    var topic = path.match(/^\/t\/(?:[^/]+\/)?(\d+)/);
    if (topic) return 'examples/topic-' + topic[1] + '.md';
    if (path.indexOf('/search') === 0) return 'examples/search-results.json';
    if (path.indexOf('/top') === 0) return 'examples/popular-samples.json';
    if (path.indexOf('/categories') === 0) return 'examples/catalog.json';
    return 'examples/public-feed.json';
  }

  function decorate() {
    scheduled = false;
    var outlet = document.getElementById('main-outlet');
    if (!outlet) return;
    var header = document.getElementById('lexiao-demo-header');
    if (!header) {
      header = document.createElement('div');
      header.id = 'lexiao-demo-header';
      header.className = 'lexiao-demo-header';

      var mark = document.createElement('span');
      mark.className = 'lexiao-demo-header__mark';
      mark.textContent = '{}';
      var path = document.createElement('span');
      path.className = 'lexiao-demo-header__path';
      var status = document.createElement('span');
      status.className = 'lexiao-demo-header__status';
      status.textContent = 'READ ONLY';
      header.append(mark, path, status);
    }
    var pathLabel = header.querySelector('.lexiao-demo-header__path');
    if (pathLabel) pathLabel.textContent = fileName();
    if (outlet.firstElementChild !== header) outlet.prepend(header);
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  decorate();
  var observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });
  window.__lexiaoReaderModeCleanup = function () {
    observer.disconnect();
    document.getElementById('lexiao-demo-header')?.remove();
    document.body.classList.remove('lexiao-demo-mode');
    window.__lexiaoReaderModeCleanup = null;
  };
})();
