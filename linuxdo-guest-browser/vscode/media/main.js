(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const backButton = document.getElementById('back');
  const densityButton = document.getElementById('density');
  const refreshButton = document.getElementById('refresh');
  let savedState = vscode.getState() || {};
  let topicState;
  let loadMoreObserver;
  let topicListState;
  let topicListObserver;
  let currentEntryId;
  let currentPageCacheable = false;
  const pageCache = new Map();

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
  densityButton.addEventListener('click', () => {
    const compact = !document.body.classList.contains('compact');
    document.body.classList.toggle('compact', compact);
    densityButton.classList.toggle('active', compact);
    savedState = { ...savedState, compact };
    vscode.setState(savedState);
  });
  densityButton.classList.toggle('active', document.body.classList.contains('compact'));

  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.key === 'ArrowLeft' && !backButton.disabled) {
      event.preventDefault();
      navigate({ type: 'back' });
    }
  });

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
      case 'loading':
        renderLoading();
        break;
      case 'error':
        renderError(message.message);
        break;
      case 'cloudflareRequired':
        renderCloudflare(message);
        break;
      case 'navigationState':
        backButton.disabled = !message.canGoBack;
        currentEntryId = Number(message.entryId);
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
        renderCategories(message.data);
        break;
      case 'topic':
        renderTopic(message.data);
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

  function renderLoading() {
    setContent(node('div', 'loading', [node('span', 'spinner'), node('span', '', '正在加载公开内容…')]));
  }

  function renderCloudflare(message) {
    const wrapper = node('section', 'state-page');
    wrapper.append(
      node('div', 'state-icon shield-icon', '✓'),
      node('h1', '', '需要 Cloudflare 验证'),
      node('p', '', String(message.message || '请先在浏览器中完成人机验证。')),
      actionButton(message.hasClearance ? '更新验证' : '自动或手动验证', () => vscode.postMessage({ type: 'cloudflareSetup' }))
    );
    const note = node('p', 'privacy-note', '只保留游客验证白名单，不读取或保存论坛登录状态。');
    wrapper.append(note);
    setContent(wrapper);
  }

  function renderError(message) {
    const wrapper = node('section', 'state-page');
    wrapper.append(
      node('div', 'state-icon', '!'),
      node('h1', '', '暂时无法加载'),
      node('p', '', String(message || '未知错误')),
      actionButton('重试', () => vscode.postMessage({ type: 'refresh' }))
    );
    setContent(wrapper);
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
    topicListState = {
      hasMore: Boolean(data?.morePath),
      loading: false,
      loadedTopicCount: topics.length,
      error: ''
    };
    currentPageCacheable = true;
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

  function renderCategories(categories) {
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
    currentPageCacheable = true;
  }

  function renderTopic(topic) {
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
    topicState = {
      id: Number(topic.id),
      remainingPostIds: [...(topic.remainingPostIds || [])],
      totalPostCount: Number(topic.totalPostCount || topic.posts?.length || 0),
      loadedPostCount: topic.posts?.length || 0,
      loading: false,
      error: ''
    };
    currentPageCacheable = true;
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

  function requestMorePosts() {
    if (!topicState || topicState.loading || !topicState.remainingPostIds.length) return;
    const postIds = topicState.remainingPostIds.slice(0, 20);
    topicState.loading = true;
    topicState.error = '';
    updateLoadMoreFooter();
    vscode.postMessage({ type: 'loadMorePosts', topicId: topicState.id, postIds });
  }

  function appendMorePosts(message) {
    if (!topicState || Number(message.topicId) !== topicState.id) return;
    const requested = new Set((message.requestedPostIds || []).map(Number));
    topicState.remainingPostIds = topicState.remainingPostIds.filter((postId) => !requested.has(Number(postId)));
    topicState.loading = false;
    topicState.error = '';

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
          if (entries.some((entry) => entry.isIntersecting)) requestMorePosts();
        }, { rootMargin: '600px 0px' });
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

  function requestMoreTopics() {
    if (!topicListState || topicListState.loading || !topicListState.hasMore) return;
    topicListState.loading = true;
    topicListState.error = '';
    updateTopicListFooter();
    vscode.postMessage({ type: 'loadMoreTopics' });
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
          if (entries.some((entry) => entry.isIntersecting)) requestMoreTopics();
        }, { rootMargin: '800px 0px' });
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

  function navigate(message) {
    saveCurrentPage();
    vscode.postMessage(message);
  }

  function saveCurrentPage() {
    if (!currentPageCacheable || !Number.isInteger(currentEntryId)) return;
    pageCache.delete(currentEntryId);
    pageCache.set(currentEntryId, {
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
