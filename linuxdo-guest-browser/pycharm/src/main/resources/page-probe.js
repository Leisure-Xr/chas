(function () {
  'use strict';

  // 独立于阅读模式和 Java 侧“加载完成”判定的页面自检探针。
  // 它回答的是 reportState() 答不上来的那个问题：用户眼前那片白，
  // 到底是页面真的被画成了白色，还是内容存在却不可见。
  var TAG = 'LEXIAO_PAGE_PROBE ';
  var lastReported = '';

  function px(value) {
    return Math.round(value || 0);
  }

  function isTransparent(color) {
    return !color || color === 'transparent' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(color);
  }

  function boxOf(element) {
    if (!element) return null;
    var style = getComputedStyle(element);
    var bounds = element.getBoundingClientRect();
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      filter: style.filter === 'none' ? null : style.filter,
      transform: style.transform === 'none' ? null : style.transform,
      contentVisibility: style.contentVisibility || null,
      bg: style.backgroundColor,
      fg: style.color,
      w: px(bounds.width),
      h: px(bounds.height),
      x: px(bounds.left),
      y: px(bounds.top)
    };
  }

  // 元素自己往往是透明的；真正决定“看上去是什么颜色”的是最近的不透明祖先。
  function effectiveBackground(element) {
    for (var node = element; node; node = node.parentElement) {
      var color = getComputedStyle(node).backgroundColor;
      if (!isTransparent(color)) return color;
    }
    return getComputedStyle(document.documentElement).backgroundColor;
  }

  function classNameOf(element) {
    var name = element.className;
    if (name && typeof name === 'object' && 'baseVal' in name) name = name.baseVal;
    name = (name || '').toString().trim();
    return name ? name.slice(0, 60) : null;
  }

  // 在视口上取几个点，问 Chromium 自己那里实际是什么。
  function samplePoints() {
    var width = window.innerWidth || 0;
    var height = window.innerHeight || 0;
    if (!width || !height) return [];
    return [[0.5, 0.12], [0.25, 0.35], [0.5, 0.5], [0.75, 0.65], [0.5, 0.88]].map(function (ratio) {
      var x = Math.round(width * ratio[0]);
      var y = Math.round(height * ratio[1]);
      var element = document.elementFromPoint(x, y);
      if (!element) return { at: x + ',' + y, tag: null };
      return {
        at: x + ',' + y,
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        cls: classNameOf(element),
        fg: getComputedStyle(element).color,
        bg: effectiveBackground(element),
        text: (element.textContent || '').trim().slice(0, 24) || null
      };
    });
  }

  function styleTagInfo(id) {
    var element = document.getElementById(id);
    return element ? { len: (element.textContent || '').length } : null;
  }

  function report(reason) {
    var scroller = document.scrollingElement || document.documentElement;
    var viewport = window.visualViewport;
    var state = {
      reason: reason,
      path: location.pathname + location.search,
      readyState: document.readyState,
      viewport: { w: px(window.innerWidth), h: px(window.innerHeight) },
      visualViewport: viewport
        ? { w: px(viewport.width), h: px(viewport.height), scale: viewport.scale, top: px(viewport.offsetTop) }
        : null,
      scroll: scroller
        ? { x: px(scroller.scrollLeft), y: px(scroller.scrollTop), h: px(scroller.scrollHeight) }
        : null,
      html: boxOf(document.documentElement),
      body: boxOf(document.body),
      mainOutlet: boxOf(document.querySelector('#main-outlet')),
      loadingStyle: styleTagInfo('lexiao-guest-loading-privacy'),
      readerStyle: styleTagInfo('lexiao-guest-reader-style'),
      maskTimerPending: Boolean(window.__lexiaoLoadingMaskTimer),
      points: samplePoints()
    };

    var serialized;
    try {
      serialized = JSON.stringify(state);
    } catch (error) {
      console.info(TAG + '{"reason":"' + reason + '","error":"serialize-failed"}');
      return;
    }
    if (serialized === lastReported) return;
    lastReported = serialized;
    console.info(TAG + serialized);
  }

  window.__lexiaoPageProbe = report;

  if (window.__lexiaoPageProbeTimers) {
    window.__lexiaoPageProbeTimers.forEach(function (id) { clearTimeout(id); });
  }
  report('settled');
  // Discourse 是 SPA，首帧之后还会继续换内容；补两次采样，避免只看到过渡态。
  window.__lexiaoPageProbeTimers = [
    setTimeout(function () { report('settled+1s'); }, 1000),
    setTimeout(function () { report('settled+4s'); }, 4000)
  ];
})();
