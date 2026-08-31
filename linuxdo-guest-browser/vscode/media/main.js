(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const backButton = document.getElementById('back');
  const historyButton = document.getElementById('history');
  const breakReminderButton = document.getElementById('break-reminder');
  const shareTopicButton = document.getElementById('share-topic');
  const openShareButton = document.getElementById('open-share');
  const openGameButton = document.getElementById('open-game');
  const densityButton = document.getElementById('density');
  const moreToolsButton = document.getElementById('more-tools');
  const refreshButton = document.getElementById('refresh');
  let savedState = vscode.getState() || {};
  let topicState;
  let loadMoreObserver;
  let topicListState;
  let topicListObserver;
  let currentEntryId;
  let displayedEntryId;
  let currentPageCacheable = false;
  let breakReminderEnabled = false;
  let breakTimer;
  let gameController;
  let historyEntries = [];
  let historyFeedbackTimer;
  let rateLimitTimer;
  const pageCache = new Map();
  const historyOverlay = createHistoryOverlay();

  document.body.classList.toggle('compact', savedState.compact !== false);

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => navigate({ type: 'navigate', view: button.dataset.view }));
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    navigate({ type: 'search', query: searchInput.value.trim() });
  });

  refreshButton.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  backButton.addEventListener('click', () => navigate({ type: 'back' }));
  historyButton.addEventListener('click', showHistory);
  breakReminderButton.addEventListener('click', () => {
    setBreakReminderEnabled(!breakReminderEnabled);
    vscode.postMessage({ type: 'setBreakReminder', enabled: breakReminderEnabled });
  });
  openGameButton.addEventListener('click', () => showGameMenu(false));
  shareTopicButton.addEventListener('click', () => vscode.postMessage({ type: 'shareCurrent' }));
  openShareButton.addEventListener('click', () => vscode.postMessage({ type: 'openShare' }));
  densityButton.addEventListener('click', () => {
    const compact = !document.body.classList.contains('compact');
    document.body.classList.toggle('compact', compact);
    densityButton.classList.toggle('active', compact);
    savedState = { ...savedState, compact };
    vscode.setState(savedState);
  });
  densityButton.classList.toggle('active', document.body.classList.contains('compact'));
  moreToolsButton.addEventListener('click', () => showMoreTools());

  function showMoreTools() {
    const existing = document.getElementById('more-tools-menu');
    if (existing) {
      existing.remove();
      moreToolsButton.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = node('div', 'more-tools-menu');
    menu.id = 'more-tools-menu';
    menu.setAttribute('role', 'menu');
    const reminder = node('button', 'more-tools-item', breakReminderEnabled ? '关闭休息提醒' : '开启休息提醒');
    reminder.type = 'button';
    reminder.setAttribute('role', 'menuitem');
    reminder.addEventListener('click', () => {
      breakReminderButton.click();
      menu.remove();
      moreToolsButton.setAttribute('aria-expanded', 'false');
    });
    const density = node('button', 'more-tools-item', document.body.classList.contains('compact') ? '切换为舒展显示' : '切换为紧凑显示');
    density.type = 'button';
    density.setAttribute('role', 'menuitem');
    density.addEventListener('click', () => {
      densityButton.click();
      menu.remove();
      moreToolsButton.setAttribute('aria-expanded', 'false');
    });
    menu.append(reminder, density);
    document.body.append(menu);
    moreToolsButton.setAttribute('aria-expanded', 'true');
    const close = (event) => {
      if (event.target === moreToolsButton || menu.contains(event.target)) return;
      menu.remove();
      moreToolsButton.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', close, true);
    };
    requestAnimationFrame(() => document.addEventListener('pointerdown', close, true));
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !historyOverlay.hidden) {
      event.preventDefault();
      closeHistory();
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft' && !backButton.disabled) {
      event.preventDefault();
      navigate({ type: 'back' });
    }
  });
  window.addEventListener('scroll', recordMoreScrollIntent, { passive: true });

  content.addEventListener('click', (event) => {
    const loadMoreTopicsButton = event.target.closest('[data-load-more-topics]');
    if (loadMoreTopicsButton) {
      event.preventDefault();
      requestMoreTopics();
      return;
    }

    const loadMoreButton = event.target.closest('[data-load-more]');
    if (loadMoreButton) {
      event.preventDefault();
      requestMorePosts();
      return;
    }

    const topicButton = event.target.closest('[data-topic-id]');
    if (topicButton) {
      event.preventDefault();
      navigate({
        type: 'topic',
        id: Number(topicButton.dataset.topicId),
        slug: topicButton.dataset.topicSlug || 'topic'
      });
      return;
    }

    const categoryButton = event.target.closest('[data-category-id]');
    if (categoryButton) {
      event.preventDefault();
      navigate({
        type: 'category',
        id: Number(categoryButton.dataset.categoryId),
        name: categoryButton.dataset.categoryName || '分类'
      });
      return;
    }

    const externalLink = event.target.closest('a[href]');
    if (externalLink) {
      event.preventDefault();
      const href = externalLink.href;
      const topic = parseLinuxDoTopic(href);
      if (topic) {
        navigate({ type: 'topic', ...topic });
      } else {
        vscode.postMessage({ type: 'external', url: href });
      }
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'historyData':
        historyEntries = Array.isArray(message.entries) ? message.entries : [];
        renderHistoryEntries();
        break;
      case 'historyCopied':
        showHistoryFeedback('URL 已复制');
        break;
      case 'loading':
        renderLoading();
        break;
      case 'queueWait':
        renderQueueWait(message.waitMs, message.reason);
        break;
      case 'error':
        renderError(message.message, message.retryAt, message.allowVerification);
        break;
      case 'cloudflareRequired':
        renderCloudflare(message);
        break;
      case 'navigationState':
        backButton.disabled = !message.canGoBack;
        currentEntryId = Number(message.entryId);
        break;
      case 'breakReminderState':
        setBreakReminderEnabled(Boolean(message.enabled));
        break;
      case 'restorePage':
        backButton.disabled = !message.canGoBack;
        currentEntryId = Number(message.entryId);
        vscode.postMessage({
          type: 'restoreResult',
          entryId: currentEntryId,
          restored: restoreCachedPage(currentEntryId)
        });
        break;
      case 'topicList':
        renderTopicList(message.data, message);
        break;
      case 'categories':
        renderCategories(message.data, message);
        break;
      case 'topic':
        renderTopic(message.data, message);
        break;
      case 'morePosts':
        appendMorePosts(message);
        break;
      case 'morePostsError':
        showMorePostsError(message);
        break;
      case 'moreTopics':
        appendMoreTopics(message);
        break;
      case 'moreTopicsError':
        showMoreTopicsError(message);
        break;
    }
  });

  function createHistoryOverlay() {
    const overlay = node('div', 'reader-overlay history-overlay');
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '浏览历史');

    const panel = node('section', 'history-panel');
    const heading = node('header', 'history-heading', [
      node('div', '', [node('h1', '', '浏览历史'), node('p', '', '最近访问的公开页面保存在本机')]),
      iconAction('×', '关闭历史记录', closeHistory)
    ]);
    const search = document.createElement('input');
    search.id = 'history-search';
    search.className = 'history-search';
    search.type = 'search';
    search.maxLength = 100;
    search.placeholder = '搜索标题或 URL';
    search.setAttribute('aria-label', '搜索历史记录');
    search.addEventListener('input', renderHistoryEntries);

    const list = node('div', 'history-list');
    list.id = 'history-list';
    const count = node('span', 'history-count', '0 条记录');
    count.id = 'history-count';
    const feedback = node('span', 'history-feedback');
    feedback.id = 'history-feedback';
    const clearButton = node('button', 'secondary-button history-clear', '清除全部');
    clearButton.id = 'history-clear';
    clearButton.type = 'button';
    clearButton.addEventListener('click', () => vscode.postMessage({ type: 'historyClear' }));
    const footer = node('footer', 'history-footer', [count, feedback, clearButton]);

    panel.append(heading, search, list, footer);
    overlay.append(panel);
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) closeHistory();
    });
    document.body.append(overlay);
    return overlay;
  }

  function showHistory() {
    historyOverlay.hidden = false;
    vscode.postMessage({ type: 'historyRequest' });
    requestAnimationFrame(() => historyOverlay.querySelector('#history-search')?.focus());
  }

  function closeHistory() {
    historyOverlay.hidden = true;
    historyButton.focus();
  }

  function renderHistoryEntries() {
    const list = historyOverlay.querySelector('#history-list');
    if (!list) return;
    const query = String(historyOverlay.querySelector('#history-search')?.value || '').trim().toLocaleLowerCase('zh-CN');
    const filtered = historyEntries.filter((entry) => !query || `${entry.title} ${entry.url}`.toLocaleLowerCase('zh-CN').includes(query));
    list.replaceChildren();

    if (!filtered.length) {
      list.append(node('div', 'history-empty', historyEntries.length ? '没有匹配的历史记录' : '暂无浏览历史'));
    } else {
      filtered.forEach((entry) => {
        const titleButton = node('button', 'history-entry-main');
        titleButton.type = 'button';
        titleButton.title = `打开 ${entry.title}`;
        titleButton.append(
          node('strong', 'history-entry-title', entry.title || '公开页面'),
          node('span', 'history-entry-url', entry.url),
          node('time', 'history-entry-time', formatHistoryTime(entry.visitedAt))
        );
        titleButton.addEventListener('click', () => {
          historyOverlay.hidden = true;
          navigate({ type: 'historyOpen', url: entry.url });
        });
        const copyButton = iconAction('⧉', '复制 URL', () => vscode.postMessage({ type: 'historyCopy', url: entry.url }));
        copyButton.classList.add('history-copy');
        list.append(node('article', 'history-entry', [titleButton, copyButton]));
      });
    }

    const count = historyOverlay.querySelector('#history-count');
    if (count) count.textContent = query ? `${filtered.length} / ${historyEntries.length} 条` : `${historyEntries.length} 条记录`;
    const clearButton = historyOverlay.querySelector('#history-clear');
    if (clearButton) clearButton.disabled = historyEntries.length === 0;
  }

  function showHistoryFeedback(message) {
    const feedback = historyOverlay.querySelector('#history-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    clearTimeout(historyFeedbackTimer);
    historyFeedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 1800);
  }

  function formatHistoryTime(value) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function setBreakReminderEnabled(enabled) {
    breakReminderEnabled = enabled;
    breakReminderButton.classList.toggle('active', enabled);
    breakReminderButton.setAttribute('aria-pressed', String(enabled));
    breakReminderButton.title = enabled ? '关闭休息提醒' : '开启休息提醒';
    clearTimeout(breakTimer);
    breakTimer = undefined;
    if (enabled) scheduleBreak();
  }

  function scheduleBreak(delay) {
    clearTimeout(breakTimer);
    if (!breakReminderEnabled) return;
    const randomDelay = (31 + Math.floor(Math.random() * 30)) * 60 * 1000;
    breakTimer = setTimeout(() => showGameMenu(true), delay || randomDelay);
  }

  function showGameMenu(fromReminder) {
    clearTimeout(breakTimer);
    if (gameController) gameController.destroy();
    const games = ["2048", "snake", "racer", "jumper", "mines"];
    const recommended = games[Math.floor(Math.random() * games.length)];
    gameController = LinuxDoGameUI.open({
      core: LinuxDoGameCore,
      recommended,
      reminderMode: Boolean(fromReminder),
      bestScores: savedState.gameBestScores || {},
      onBestScore: (game, value, bestScores) => {
        savedState = { ...savedState, gameBestScores: bestScores || { ...(savedState.gameBestScores || {}), [game]: value } };
        vscode.setState(savedState);
      },
      onContinue: () => {
        gameController = undefined;
        if (fromReminder && breakReminderEnabled) scheduleBreak();
        openGameButton.focus();
      },
      onSnooze: () => {
        gameController = undefined;
        if (breakReminderEnabled) scheduleBreak(10 * 60 * 1000);
        openGameButton.focus();
      }
    });
  }

  function renderLoading() {
    if (currentPageCacheable && content.childElementCount) {
      clearInterval(rateLimitTimer);
      showStatusBanner('正在加载更新内容…');
      return;
    }
    setContent(node('div', 'loading', [node('span', 'spinner'), node('span', '', '正在加载公开内容…')]));
  }

  function renderQueueWait(waitMs, reason) {
    const seconds = Math.max(0, Math.ceil(Number(waitMs || 0) / 1000));
    if (!seconds) return;
    const label = reason === 'server-budget' ? '站点剩余请求预算' : '本地平滑请求节奏';
    const message = `${label}：预计 ${seconds} 秒后发送，不属于请求错误。`;
    if (currentPageCacheable && content.childElementCount) showStatusBanner(message);
    else setContent(node('div', 'loading', [node('span', 'spinner'), node('span', '', message)]));
  }

  function renderCloudflare(message) {
    const wrapper = node('section', 'state-page');
    wrapper.append(
      node('div', 'state-icon shield-icon', '✓'),
      node('h1', '', '需要 Cloudflare 验证'),
      node('p', '', String(message.message || '请先在浏览器中完成人机验证。')),
      actionButton(message.hasClearance ? '更新验证参数' : '填写验证参数', () => vscode.postMessage({ type: 'cloudflareSetup' }))
    );
    const note = node('p', 'privacy-note', '只保留游客验证白名单，不读取或保存论坛登录状态。');
    wrapper.append(note);
    setContent(wrapper);
  }

  function renderError(message, retryAt, allowVerification = false) {
    if (currentPageCacheable && content.childElementCount) {
      showRateLimitBanner(message, retryAt, allowVerification);
      return;
    }
    const wrapper = node('section', 'state-page');
    wrapper.append(
      node('div', 'state-icon', '!'),
      node('h1', '', '暂时无法加载'),
      node('p', '', String(message || '未知错误'))
    );
    const actions = node('div', 'state-actions');
    actions.append(actionButton('重试', () => vscode.postMessage({ type: 'refresh' })));
    if (allowVerification) {
      const setup = actionButton('更新验证参数', () => vscode.postMessage({ type: 'cloudflareSetup' }));
      setup.className = 'secondary-button';
      actions.append(setup);
    }
    wrapper.append(actions);
    let startCountdown;
    if (Number.isFinite(Number(retryAt)) && Number(retryAt) > Date.now()) {
      const countdown = node('p', 'privacy-note');
      const update = () => {
        const seconds = Math.max(0, Math.ceil((Number(retryAt) - Date.now()) / 1000));
        countdown.textContent = seconds ? `请求恢复倒计时：约 ${seconds} 秒。页面会自动重试一次。` : '可以重试。';
        if (!seconds) clearInterval(rateLimitTimer);
      };
      wrapper.append(countdown);
      startCountdown = () => {
        clearInterval(rateLimitTimer);
        update();
        if (Number(retryAt) > Date.now()) rateLimitTimer = setInterval(update, 1_000);
      };
    }
    setContent(wrapper);
    startCountdown?.();
  }

  function renderTopicList(data, meta) {
    const title = meta.kind === 'top'
      ? '本周热门'
      : meta.kind === 'search'
        ? `搜索：${meta.query || ''}`
        : meta.kind === 'category'
          ? meta.categoryName || '分类主题'
          : '最新主题';

    const section = node('section', 'page');
    const heading = node('div', 'page-heading');
    heading.append(node('div', '', [node('h1', '', title), node('p', 'page-subtitle', '游客可见的公开内容')]));
    section.append(heading);

    const topics = data?.topics || [];
    if (!topics.length) {
      section.append(node('div', 'empty', '没有找到公开主题。'));
    } else {
      const list = node('div', 'topic-list');
      topics.forEach((topic) => list.append(createTopicRow(topic)));
      section.append(list);
    }
    const loadMore = node('div', 'load-more list-load-more');
    loadMore.id = 'topic-list-load-more';
    section.append(loadMore);
    setContent(section);
    appendCacheNotice(heading, meta.cacheInfo);
    topicListState = {
      hasMore: Boolean(data?.morePath),
      loading: false,
      loadedTopicCount: topics.length,
      error: '',
      autoMore: createAutoMoreGate()
    };
    currentPageCacheable = true;
    displayedEntryId = Number(meta.entryId) || currentEntryId;
    updateTopicListFooter();
  }

  function createTopicRow(topic) {
    const article = node('article', 'topic-row');
    const button = node('button', 'topic-main');
    button.type = 'button';
    button.dataset.topicId = String(topic.id);
    button.dataset.topicSlug = topic.slug || 'topic';

    const text = node('div', 'topic-text');
    text.append(node('h2', '', topic.title || '未命名主题'));
    if (topic.excerpt) text.append(node('p', 'excerpt', topic.excerpt));
    const meta = node('div', 'topic-meta');
    if (topic.poster?.name) meta.append(node('span', '', topic.poster.name));
    meta.append(node('span', '', relativeTime(topic.bumpedAt)));
    text.append(meta);

    if (topic.poster?.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'avatar';
      avatar.src = topic.poster.avatar;
      avatar.alt = '';
      avatar.loading = 'lazy';
      button.append(avatar);
    } else {
      button.append(node('span', 'avatar avatar-fallback', (topic.poster?.name || '?').slice(0, 1).toUpperCase()));
    }
    button.append(text);

    const stats = node('div', 'topic-stats');
    stats.append(stat(formatNumber(topic.replyCount), '回复'), stat(formatNumber(topic.views), '浏览'));
    article.append(button, stats);
    return article;
  }

  function renderCategories(categories, meta = {}) {
    const section = node('section', 'page');
    const heading = node('div', 'page-heading');
    heading.append(node('div', '', [node('h1', '', '浏览分类'), node('p', 'page-subtitle', '选择一个公开分类')]));
    section.append(heading);

    const grid = node('div', 'category-grid');
    (categories || []).forEach((category) => {
      const button = node('button', 'category-item');
      button.type = 'button';
      button.dataset.categoryId = String(category.id);
      button.dataset.categoryName = category.name;
      const marker = node('span', 'category-marker');
      marker.style.backgroundColor = safeColor(category.color);
      const body = node('span', 'category-body');
      body.append(node('strong', '', category.name));
      if (category.description) body.append(node('span', 'category-description', category.description));
      body.append(node('small', '', `${formatNumber(category.topicCount)} 个主题`));
      button.append(marker, body);
      grid.append(button);
    });
    section.append(grid);
    setContent(section);
    appendCacheNotice(heading, meta.cacheInfo);
    currentPageCacheable = true;
    displayedEntryId = Number(meta.entryId) || currentEntryId;
  }

  function renderTopic(topic, meta = {}) {
    const section = node('article', 'topic-page');
    const header = node('header', 'topic-header');
    const titleBox = node('div', 'topic-title-box');
    titleBox.append(node('h1', '', topic.title || '未命名主题'));
    titleBox.append(node('div', 'topic-summary', [
      node('span', '', `${formatNumber(topic.views)} 浏览`),
      node('span', '', `${formatNumber(topic.replyCount)} 回复`),
      node('span', '', `${formatNumber(topic.likeCount)} 赞`)
    ]));
    const original = document.createElement('a');
    original.className = 'secondary-button';
    original.href = topic.externalUrl;
    original.textContent = '浏览器打开';
    header.append(titleBox, original);
    section.append(header);

    const posts = node('div', 'post-list');
    (topic.posts || []).forEach((post) => posts.append(createPost(post)));
    if (!topic.posts?.length) posts.append(node('div', 'empty', '这个主题暂时没有可显示的帖子。'));
    const loadMore = node('div', 'load-more');
    loadMore.id = 'load-more';
    section.append(posts, loadMore);
    setContent(section);
    appendCacheNotice(titleBox, meta.cacheInfo);
    topicState = {
      id: Number(topic.id),
      remainingPostIds: [...(topic.remainingPostIds || [])],
      totalPostCount: Number(topic.totalPostCount || topic.posts?.length || 0),
      loadedPostCount: topic.posts?.length || 0,
      loading: false,
      error: '',
      autoMore: createAutoMoreGate()
    };
    currentPageCacheable = true;
    displayedEntryId = Number(meta.entryId) || currentEntryId;
    updateLoadMoreFooter();
  }

  function createPost(post) {
    const article = node('section', 'post');
    article.dataset.postId = String(post.id || '');
    const header = node('header', 'post-header');
    if (post.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'avatar post-avatar';
      avatar.src = post.avatar;
      avatar.alt = '';
      avatar.loading = 'lazy';
      header.append(avatar);
    }
    const identity = node('div', 'post-identity');
    identity.append(node('strong', '', post.displayName || post.username), node('span', '', `@${post.username || 'unknown'}`));
    const info = node('div', 'post-info');
    info.append(node('span', '', `#${post.number || ''}`), node('time', '', formatDate(post.createdAt)));
    header.append(identity, info);

    const body = node('div', 'post-body');
    body.append(sanitizeCooked(post.cooked || ''));
    article.append(header, body);
    return article;
  }

  function requestMorePosts(source = 'manual') {
    if (!topicState || topicState.loading || !topicState.remainingPostIds.length) return;
    const postIds = topicState.remainingPostIds.slice(0, 20);
    topicState.loading = true;
    resetAutoMoreGate(topicState);
    topicState.error = '';
    updateLoadMoreFooter();
    vscode.postMessage({ type: 'loadMorePosts', topicId: topicState.id, postIds, source });
  }

  function appendMorePosts(message) {
    if (!topicState || Number(message.topicId) !== topicState.id) return;
    const requested = new Set((message.requestedPostIds || []).map(Number));
    topicState.remainingPostIds = topicState.remainingPostIds.filter((postId) => !requested.has(Number(postId)));
    topicState.loading = false;
    topicState.error = '';
    resetAutoMoreGate(topicState);

    const postList = content.querySelector('.post-list');
    postList.querySelector('.empty')?.remove();
    const existing = new Set([...postList.querySelectorAll('[data-post-id]')].map((element) => Number(element.dataset.postId)));
    const posts = [...(message.posts || [])].sort((left, right) => Number(left.number) - Number(right.number));
    for (const post of posts) {
      if (!existing.has(Number(post.id))) {
        postList.append(createPost(post));
        existing.add(Number(post.id));
        topicState.loadedPostCount += 1;
      }
    }
    updateLoadMoreFooter();
  }

  function showMorePostsError(message) {
    if (!topicState || Number(message.topicId) !== topicState.id) return;
    topicState.loading = false;
    topicState.error = String(message.message || '加载失败，请重试。');
    updateLoadMoreFooter();
  }

  function updateLoadMoreFooter() {
    const footer = document.getElementById('load-more');
    if (!footer || !topicState) return;
    disconnectLoadMoreObserver();
    footer.replaceChildren();

    if (topicState.error) {
      footer.append(node('span', 'load-more-error', topicState.error));
    }
    if (topicState.remainingPostIds.length) {
      const button = node('button', 'load-more-button');
      button.type = 'button';
      button.dataset.loadMore = 'true';
      button.disabled = topicState.loading;
      button.textContent = topicState.loading
        ? '正在加载…'
        : `加载更多 · 剩余 ${topicState.remainingPostIds.length}`;
      footer.append(button);
      if (!topicState.loading) {
        loadMoreObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            topicState.autoMore.footerVisible = entry.isIntersecting;
            if (!entry.isIntersecting) topicState.autoMore.sawExit = true;
            if (entry.isIntersecting && canAutoLoadMore(topicState)) requestMorePosts('auto');
          });
        }, { rootMargin: '120px 0px' });
        loadMoreObserver.observe(footer);
      }
    } else {
      footer.append(node('span', 'load-complete', `已显示全部 ${topicState.totalPostCount || topicState.loadedPostCount} 条帖子`));
    }
  }

  function disconnectLoadMoreObserver() {
    loadMoreObserver?.disconnect();
    loadMoreObserver = undefined;
  }

  function requestMoreTopics(source = 'manual') {
    if (!topicListState || topicListState.loading || !topicListState.hasMore) return;
    topicListState.loading = true;
    resetAutoMoreGate(topicListState);
    topicListState.error = '';
    updateTopicListFooter();
    vscode.postMessage({ type: 'loadMoreTopics', source });
  }

  function appendMoreTopics(message) {
    if (!topicListState) return;
    const list = content.querySelector('.topic-list');
    if (!list) return;
    const existing = new Set([...list.querySelectorAll('[data-topic-id]')].map((element) => Number(element.dataset.topicId)));
    for (const topic of message.topics || []) {
      if (!existing.has(Number(topic.id))) {
        list.append(createTopicRow(topic));
        existing.add(Number(topic.id));
        topicListState.loadedTopicCount += 1;
      }
    }
    topicListState.loading = false;
    topicListState.hasMore = Boolean(message.hasMore);
    topicListState.error = '';
    updateTopicListFooter();
  }

  function showMoreTopicsError(message) {
    if (!topicListState) return;
    topicListState.loading = false;
    topicListState.error = String(message.message || '加载失败，请重试。');
    updateTopicListFooter();
  }

  function updateTopicListFooter() {
    const footer = document.getElementById('topic-list-load-more');
    if (!footer || !topicListState) return;
    disconnectTopicListObserver();
    footer.replaceChildren();
    if (topicListState.error) footer.append(node('span', 'load-more-error', topicListState.error));

    if (topicListState.hasMore) {
      const button = node('button', 'load-more-button');
      button.type = 'button';
      button.dataset.loadMoreTopics = 'true';
      button.disabled = topicListState.loading;
      button.textContent = topicListState.loading ? '正在加载更多主题…' : '加载更多主题';
      footer.append(button);
      if (!topicListState.loading) {
        topicListObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            topicListState.autoMore.footerVisible = entry.isIntersecting;
            if (!entry.isIntersecting) topicListState.autoMore.sawExit = true;
            if (entry.isIntersecting && canAutoLoadMore(topicListState)) requestMoreTopics('auto');
          });
        }, { rootMargin: '160px 0px' });
        topicListObserver.observe(footer);
      }
    } else {
      footer.append(node('span', 'load-complete', `已显示 ${topicListState.loadedTopicCount} 个主题`));
    }
  }

  function disconnectTopicListObserver() {
    topicListObserver?.disconnect();
    topicListObserver = undefined;
  }

  function createAutoMoreGate() {
    return { lastScrollY: window.scrollY, downwardPixels: 0, sawExit: false, footerVisible: false };
  }

  function resetAutoMoreGate(state) {
    if (!state) return;
    state.autoMore = createAutoMoreGate();
  }

  function recordMoreScrollIntent() {
    const currentY = window.scrollY;
    [[topicState, requestMorePosts], [topicListState, requestMoreTopics]].forEach(([state, requestMore]) => {
      if (!state?.autoMore) return;
      if (currentY > state.autoMore.lastScrollY) state.autoMore.downwardPixels += currentY - state.autoMore.lastScrollY;
      state.autoMore.lastScrollY = currentY;
      if (state.autoMore.footerVisible && canAutoLoadMore(state)) requestMore('auto');
    });
  }

  function canAutoLoadMore(state) {
    if (!state || state.loading || !state.autoMore) return false;
    const threshold = Math.min(240, window.innerHeight * 0.5);
    return state.autoMore.sawExit || state.autoMore.downwardPixels >= threshold;
  }

  function appendCacheNotice(container, cacheInfo) {
    if (!cacheInfo || cacheInfo.source === 'network' || !Number(cacheInfo.storedAt)) return;
    const label = cacheInfo.reason === 'rate-limit'
      ? '正在显示受限前缓存'
      : cacheInfo.reason === 'cloudflare-protection'
        ? '正在显示临时保护前缓存'
      : cacheInfo.reason === 'offline'
        ? '正在显示离线缓存'
        : '正在显示本机缓存';
    const notice = node('p', 'page-subtitle cache-notice', `${label} · ${formatDate(new Date(cacheInfo.storedAt).toISOString())}`);
    container.append(notice);
    if (!['rate-limit', 'cloudflare-protection'].includes(cacheInfo.reason) || !Number.isFinite(Number(cacheInfo.retryAt))) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((Number(cacheInfo.retryAt) - Date.now()) / 1000));
      notice.textContent = `${label} · ${formatDate(new Date(cacheInfo.storedAt).toISOString())}${seconds ? ` · 恢复倒计时 ${seconds} 秒` : ' · 可以重试'}`;
      if (!seconds) clearInterval(rateLimitTimer);
    };
    clearInterval(rateLimitTimer);
    update();
    if (Number(cacheInfo.retryAt) > Date.now()) rateLimitTimer = setInterval(update, 1_000);
  }

  function showStatusBanner(message) {
    clearInterval(rateLimitTimer);
    let banner = document.getElementById('reader-status-banner');
    if (!banner) {
      banner = node('div', 'reader-status-banner');
      banner.id = 'reader-status-banner';
      content.prepend(banner);
    }
    banner.replaceChildren(node('span', 'spinner'), node('span', '', message));
  }

  function showRateLimitBanner(message, retryAt, allowVerification = false) {
    clearInterval(rateLimitTimer);
    let banner = document.getElementById('reader-status-banner');
    if (!banner) {
      banner = node('div', 'reader-status-banner');
      banner.id = 'reader-status-banner';
      content.prepend(banner);
    }
    const detail = node('span', '', String(message || '暂时无法加载。'));
    const retry = actionButton('重试', () => vscode.postMessage({ type: 'refresh' }));
    retry.classList.add('banner-retry');
    let setup;
    if (allowVerification) {
      setup = actionButton('更新参数', () => vscode.postMessage({ type: 'cloudflareSetup' }));
      setup.className = 'secondary-button banner-retry';
    }
    const countdown = node('span', 'banner-countdown');
    const update = () => {
      if (!Number.isFinite(Number(retryAt))) {
        countdown.textContent = '';
        return;
      }
      const seconds = Math.max(0, Math.ceil((Number(retryAt) - Date.now()) / 1000));
      countdown.textContent = seconds ? `恢复倒计时 ${seconds} 秒` : '可以重试';
      if (!seconds) clearInterval(rateLimitTimer);
    };
    update();
    if (Number(retryAt) > Date.now()) rateLimitTimer = setInterval(update, 1_000);
    banner.replaceChildren(detail, countdown, retry, ...(setup ? [setup] : []));
  }

  function navigate(message) {
    saveCurrentPage();
    vscode.postMessage(message);
  }

  function saveCurrentPage() {
    if (!currentPageCacheable || !Number.isInteger(displayedEntryId)) return;
    pageCache.delete(displayedEntryId);
    pageCache.set(displayedEntryId, {
      nodes: [...content.childNodes],
      scrollY: window.scrollY,
      topicState: cloneTopicState(topicState),
      topicListState: cloneTopicListState(topicListState)
    });
    while (pageCache.size > 20) {
      pageCache.delete(pageCache.keys().next().value);
    }
  }

  function restoreCachedPage(entryId) {
    const snapshot = pageCache.get(entryId);
    if (!snapshot) return false;
    disconnectLoadMoreObserver();
    disconnectTopicListObserver();
    content.replaceChildren(...snapshot.nodes);
    topicState = cloneTopicState(snapshot.topicState);
    topicListState = cloneTopicListState(snapshot.topicListState);
    currentPageCacheable = true;
    displayedEntryId = Number(entryId);
    if (topicState) updateLoadMoreFooter();
    if (topicListState) updateTopicListFooter();
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: snapshot.scrollY, behavior: 'instant' })));
    return true;
  }

  function cloneTopicState(value) {
    if (!value) return undefined;
    return { ...value, remainingPostIds: [...value.remainingPostIds], loading: false };
  }

  function cloneTopicListState(value) {
    if (!value) return undefined;
    return { ...value, loading: false };
  }

  function sanitizeCooked(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowedTags = new Set([
      'P', 'BR', 'A', 'IMG', 'PRE', 'CODE', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
      'STRONG', 'EM', 'B', 'I', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
      'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DIV', 'SPAN', 'DETAILS',
      'SUMMARY', 'DEL', 'INS', 'KBD', 'MARK', 'SUP', 'SUB', 'FIGURE', 'FIGCAPTION'
    ]);
    const allowedAttributes = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'class', 'loading']);

    [...template.content.querySelectorAll('*')].forEach((element) => {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(...element.childNodes);
        return;
      }
      [...element.attributes].forEach((attribute) => {
        if (!allowedAttributes.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      });
      if (element.hasAttribute('href') && !safeHttpUrl(element.getAttribute('href'))) {
        element.removeAttribute('href');
      }
      if (element.hasAttribute('src') && !safeImageUrl(element.getAttribute('src'))) {
        element.removeAttribute('src');
      }
      if (element.tagName === 'IMG') {
        element.loading = 'lazy';
      }
    });
    return template.content;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value, 'https://linux.do');
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function safeImageUrl(value) {
    if (/^data:image\/(png|gif|jpe?g|webp);base64,/i.test(value || '')) return true;
    return safeHttpUrl(value);
  }

  function parseLinuxDoTopic(value) {
    try {
      const url = new URL(value);
      if (url.hostname !== 'linux.do') return null;
      const match = url.pathname.match(/^\/t\/(?:([^/]+)\/)?(\d+)/);
      return match ? { slug: match[1] || 'topic', id: Number(match[2]) } : null;
    } catch {
      return null;
    }
  }

  function actionButton(label, handler) {
    const button = node('button', 'primary-button', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function iconAction(label, title, handler) {
    const button = node('button', 'secondary-button compact-icon-button', label);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', handler);
    return button;
  }

  function stat(value, label) {
    return node('span', 'stat', [node('strong', '', value), node('small', '', label)]);
  }

  function node(tag, className = '', children) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (Array.isArray(children)) element.append(...children);
    else if (children instanceof Node) element.append(children);
    else if (children !== undefined) element.textContent = String(children);
    return element;
  }

  function setContent(element) {
    clearInterval(rateLimitTimer);
    disconnectLoadMoreObserver();
    disconnectTopicListObserver();
    topicState = undefined;
    topicListState = undefined;
    currentPageCacheable = false;
    content.replaceChildren(element);
    content.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN', { notation: Number(value) >= 10_000 ? 'compact' : 'standard' }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function relativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const seconds = Math.round((date.valueOf() - Date.now()) / 1000);
    if (!Number.isFinite(seconds)) return '';
    const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
    const ranges = [[86400 * 365, 'year'], [86400 * 30, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [amount, unit] of ranges) {
      if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
    }
    return formatter.format(seconds, 'second');
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#888888';
  }

  vscode.postMessage({ type: 'ready' });
})();
