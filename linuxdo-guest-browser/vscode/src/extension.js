'use strict';

const vscode = require('vscode');
const {
  GuestRequestSession,
  CloudflareError,
  RateLimitError,
  TransientProtectionError,
  CLEARANCE_SECRET,
  GUEST_COOKIE_NAMES,
  GUEST_COOKIE_SECRET,
  SITE_ORIGIN,
  USER_AGENT_SECRET,
  REQUEST_PROFILE_SECRET,
  fetchGuestResponse,
  isLinuxDoUrl
} = require('./guest-session');
const {
  GuestRequestTransport,
  NativeBrowserSession,
  NativeBrowserUnavailableError
} = require('./native-browser-session');
const { createRequestProfile, parseCapturedRequest } = require('./request-profile');
const { createShareCode, generatePassword, parseShareCode, validatePassword } = require('./share-code');
const {
  addHistoryEntry,
  createHistoryEntry,
  normalizePublicUrl,
  normalizeStoredHistory
} = require('./reader-history');
const { VerificationPanel } = require('./verification-panel');

const MANUAL_GUEST_COOKIE_NAMES = GUEST_COOKIE_NAMES;
const HISTORY_STATE_KEY = 'linuxdoGuest.readerHistory';
const SHARE_DURATIONS = [
  { label: '1 小时', description: '默认', milliseconds: 60 * 60 * 1000 },
  { label: '10 分钟', milliseconds: 10 * 60 * 1000 },
  { label: '24 小时', milliseconds: 24 * 60 * 60 * 1000 },
  { label: '7 天', milliseconds: 7 * 24 * 60 * 60 * 1000 }
];
const REQUEST_MODE_OPTIONS = [
  { label: '智能', value: 'smart', description: '默认从均衡开始，根据明确限流自动降速和恢复。' },
  { label: '流畅', value: 'fluent', description: '最多短突发 2 次，之后每 4 秒平滑恢复 1 次。' },
  { label: '均衡', value: 'balanced', description: '最多短突发 2 次，之后每 5 秒平滑恢复 1 次。' },
  { label: '稳妥', value: 'careful', description: '不短突发，每 8 秒平滑恢复 1 次。' }
];
const REQUEST_ENGINE_OPTIONS = [
  { label: '自动（推荐）', value: 'auto', description: '新版桌面 VS Code 优先使用原生浏览器，不可用时回退到手动参数。' },
  { label: 'VS Code 原生浏览器', value: 'native', description: '使用隔离的 Integrated Browser 会话，不回退到 Node 请求。' },
  { label: '手动参数', value: 'manual', description: '继续使用 Cookie、User-Agent 与 Node 请求。' }
];

class LinuxDoApi {
  constructor(browserSession) {
    this.browserSession = browserSession;
  }

  async request(path, options) {
    const url = new URL(path, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) {
      throw new Error('拒绝访问非 LINUX DO 接口。');
    }

    return this.browserSession.request(url, options);
  }

  async list(kind, categoryId, options) {
    let path;
    if (kind === 'top') {
      path = '/top.json?period=weekly';
    } else if (kind === 'category' && Number.isInteger(categoryId)) {
      path = `/c/${categoryId}/l/latest.json`;
    } else {
      path = '/latest.json';
    }
    const data = await this.request(path, options);
    return normalizeTopicList(data, kind);
  }

  async categories(options) {
    const data = await this.request('/categories.json', options);
    return (data.category_list?.categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      color: normalizeColor(category.color),
      description: stripText(category.description_text || category.description || ''),
      topicCount: category.topic_count || 0
    }));
  }

  async search(query, options) {
    const data = await this.request(`/search.json?q=${encodeURIComponent(query)}`, options);
    return normalizeTopicList({ topic_list: { topics: data.topics || [] }, users: data.users || [] }, 'search');
  }

  async topic(id, slug, options) {
    const safeId = Number(id);
    if (!Number.isInteger(safeId) || safeId <= 0) {
      throw new Error('主题编号无效。');
    }
    const safeSlug = typeof slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(slug) ? slug : 'topic';
    const data = await this.request(`/t/${safeSlug}/${safeId}.json`, options);
    const posts = (data.post_stream?.posts || []).map(normalizePost);
    const loadedPostIds = new Set(posts.map((post) => post.id));
    const remainingPostIds = (data.post_stream?.stream || [])
      .map(Number)
      .filter((postId) => Number.isInteger(postId) && postId > 0 && !loadedPostIds.has(postId));
    return {
      id: data.id,
      slug: data.slug || safeSlug,
      title: data.title || '未命名主题',
      categoryId: data.category_id,
      createdAt: data.created_at,
      views: data.views || 0,
      replyCount: data.reply_count || 0,
      likeCount: data.like_count || 0,
      posts,
      remainingPostIds,
      totalPostCount: posts.length + remainingPostIds.length,
      externalUrl: `${SITE_ORIGIN}/t/${data.slug || safeSlug}/${data.id || safeId}`
    };
  }

  async topicPosts(topicId, postIds, options) {
    const safeTopicId = Number(topicId);
    if (!Number.isInteger(safeTopicId) || safeTopicId <= 0) {
      throw new Error('主题编号无效。');
    }
    const safePostIds = [...new Set((postIds || []).map(Number))]
      .filter((postId) => Number.isInteger(postId) && postId > 0)
      .slice(0, 20);
    if (!safePostIds.length) return [];
    const query = safePostIds.map((postId) => `post_ids%5B%5D=${postId}`).join('&');
    const data = await this.request(`/t/${safeTopicId}/posts.json?${query}`, options);
    return (data.post_stream?.posts || data.posts || []).map(normalizePost);
  }

  async topicListPage(morePath, kind, options) {
    const safePath = normalizeMoreTopicsPath(morePath);
    if (!safePath) throw new Error('主题分页地址无效。');
    const data = await this.request(safePath, options);
    return normalizeTopicList(data, kind);
  }
}

function normalizePost(post) {
  return {
    id: post.id,
    number: post.post_number,
    username: post.username,
    displayName: post.name || post.username,
    avatar: avatarUrl(post.avatar_template, 72),
    createdAt: post.created_at,
    cooked: post.cooked || '',
    reads: post.reads || 0
  };
}

function normalizeTopicList(data, kind) {
  const users = new Map((data.users || []).map((user) => [user.id, user]));
  const topics = data.topic_list?.topics || [];
  return {
    kind,
    morePath: normalizeMoreTopicsPath(data.topic_list?.more_topics_url),
    topics: topics.filter((topic) => !topic.pinned_globally || topic.visible !== false).map((topic) => {
      const poster = users.get(topic.posters?.[0]?.user_id);
      return {
        id: topic.id,
        slug: topic.slug || 'topic',
        title: topic.title || '未命名主题',
        excerpt: stripText(topic.excerpt || ''),
        categoryId: topic.category_id,
        postsCount: topic.posts_count || 0,
        replyCount: topic.reply_count || 0,
        views: topic.views || 0,
        likeCount: topic.like_count || 0,
        bumpedAt: topic.bumped_at || topic.last_posted_at || topic.created_at,
        poster: poster ? {
          username: poster.username,
          name: poster.name || poster.username,
          avatar: avatarUrl(poster.avatar_template, 48)
        } : undefined
      };
    })
  };
}

function normalizeMoreTopicsPath(value) {
  if (!value) return undefined;
  try {
    const url = new URL(String(value), SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN || !/^\/(?:latest|top|c\/)/.test(url.pathname)) return undefined;
    if (!url.pathname.endsWith('.json')) url.pathname = `${url.pathname}.json`;
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function avatarUrl(template, size) {
  if (!template) {
    return '';
  }
  const value = String(template).replace('{size}', String(size));
  try {
    return new URL(value, SITE_ORIGIN).toString();
  } catch {
    return '';
  }
}

function stripText(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeColor(value) {
  const color = String(value || '').replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : '#888888';
}

class GuestReaderPanel {
  static current;

  static createOrShow(context, browserSession, initialView = 'latest') {
    if (GuestReaderPanel.current) {
      GuestReaderPanel.current.panel.reveal(vscode.ViewColumn.One);
      GuestReaderPanel.current.navigate(initialView);
      return GuestReaderPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'linuxdoGuest.reader',
      'LINUX DO 游客阅读器',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );
    GuestReaderPanel.current = new GuestReaderPanel(panel, context, browserSession, initialView);
    return GuestReaderPanel.current;
  }

  constructor(panel, context, browserSession, initialView) {
    this.panel = panel;
    this.context = context;
    this.browserSession = browserSession;
    this.api = new LinuxDoApi(browserSession);
    this.initialView = initialView;
    this.initialAction = undefined;
    this.ready = false;
    this.sequence = 0;
    this.moreSequence = 0;
    this.listMoreSequence = 0;
    this.retryTimer = undefined;
    this.entryCounter = 0;
    this.currentAction = undefined;
    this.history = [];
    this.browsingHistory = normalizeStoredHistory(context.globalState.get(HISTORY_STATE_KEY));
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => {
      this.cancelScheduledRetry();
      GuestReaderPanel.current = undefined;
      void Promise.allSettled([
        this.browserSession.stop(),
        activeRequestTransport?.stop()
      ]);
    }, null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, context.subscriptions);
  }

  updateBreakReminderSetting() {
    this.post({
      type: 'breakReminderState',
      enabled: vscode.workspace.getConfiguration('linuxdoGuest').get('breakReminder.enabled', false)
    });
  }

  navigate(view) {
    const allowed = ['latest', 'top', 'categories'];
    const target = allowed.includes(view) ? view : 'latest';
    if (!this.ready) {
      this.initialView = target;
      return;
    }
    return this.openAction({ type: 'view', view: target });
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        this.ready = true;
        this.updateBreakReminderSetting();
        await this.openAction(this.initialAction || { type: 'view', view: this.initialView }, false);
        this.initialAction = undefined;
        break;
      case 'navigate':
        this.navigate(message.view);
        break;
      case 'category':
        await this.openAction({ type: 'category', id: Number(message.id), name: String(message.name || '分类') });
        break;
      case 'topic':
        await this.openAction({ type: 'topic', id: Number(message.id), slug: String(message.slug || 'topic') });
        break;
      case 'search':
        await this.openAction({ type: 'search', query: String(message.query || '').trim() });
        break;
      case 'back':
        await this.goBack();
        break;
      case 'restoreResult':
        await this.handleRestoreResult(message.entryId, Boolean(message.restored));
        break;
      case 'refresh':
        await this.refresh();
        break;
      case 'setBreakReminder':
        await vscode.workspace.getConfiguration('linuxdoGuest').update(
          'breakReminder.enabled',
          Boolean(message.enabled),
          vscode.ConfigurationTarget.Global
        );
        this.updateBreakReminderSetting();
        break;
      case 'external':
        await this.openExternal(message.url);
        break;
      case 'cloudflareSetup':
        await configureCloudflare(this.context, this.browserSession, () => this.refresh(false));
        break;
      case 'nativeVerification':
        await activeNativeBrowserSession?.revealVerification();
        break;
      case 'shareCurrent':
        await this.shareCurrentTopic();
        break;
      case 'openShare':
        await openShareCode(this.context, this.browserSession);
        break;
      case 'shareHelp':
        await showShareHelp();
        break;
      case 'historyRequest':
        this.sendHistory();
        break;
      case 'historyOpen':
        await this.openHistoryEntry(message.url);
        break;
      case 'historyCopy':
        await this.copyHistoryUrl(message.url);
        break;
      case 'historyClear':
        await this.clearBrowsingHistory();
        break;
      case 'loadMorePosts':
        await this.loadMorePosts(message.topicId, message.postIds, message.source);
        break;
      case 'loadMoreTopics':
        await this.loadMoreTopics(message.source);
        break;
    }
  }

  async refresh(force = true) {
    if (!this.currentAction) return this.navigate(this.initialView);
    return this.loadAction(this.currentAction, true, { force });
  }

  async openAction(action, recordHistory = true) {
    this.cancelScheduledRetry();
    this.browserSession.cancelPendingRequests(['navigation', 'topic-more', 'list-more', 'manual-more']);
    if (recordHistory && this.currentAction && !sameAction(this.currentAction, action)) {
      this.history.push(this.currentAction);
      if (this.history.length > 50) this.history.shift();
    }
    const nextAction = action.entryId ? action : { ...action, entryId: ++this.entryCounter };
    this.currentAction = nextAction;
    this.moreSequence += 1;
    this.listMoreSequence += 1;
    this.post({ type: 'navigationState', canGoBack: this.history.length > 0, entryId: nextAction.entryId });
    return this.loadAction(nextAction, true);
  }

  openSharedTopic(topic) {
    const action = { type: 'topic', id: Number(topic.id), slug: String(topic.slug), title: String(topic.title) };
    if (!this.ready) {
      this.initialAction = action;
      return;
    }
    return this.openAction(action);
  }

  async shareCurrentTopic() {
    const action = this.currentAction;
    if (action?.type !== 'topic' || !action.title) {
      vscode.window.showInformationMessage('请先打开一个主题，再生成加密分享内容。');
      return;
    }
    const duration = await vscode.window.showQuickPick(SHARE_DURATIONS, {
      title: '选择加密分享有效期',
      placeHolder: '默认 1 小时'
    });
    if (!duration) return;
    const password = await promptSharePassword();
    if (password === undefined) return;
    let code;
    try {
      code = createShareCode(action, password, duration.milliseconds);
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    const expiresAt = new Date(Date.now() + duration.milliseconds).toLocaleString('zh-CN', { hour12: false });
    await vscode.env.clipboard.writeText(code);
    for (;;) {
      const choice = await vscode.window.showInformationMessage(
        `加密分享内容已复制，将于 ${expiresAt} 失效。密码不会保存，请通过另一渠道发送。`,
        '复制分享内容',
        '复制密码',
        '查看分享教程',
        '完成'
      );
      if (choice === '复制分享内容') {
        await vscode.env.clipboard.writeText(code);
        continue;
      }
      if (choice === '复制密码') {
        await vscode.env.clipboard.writeText(password);
        vscode.window.showInformationMessage('分享密码已复制。');
        continue;
      }
      if (choice === '查看分享教程') {
        await showShareHelp();
        continue;
      }
      break;
    }
  }

  recordVisit(action, title, url) {
    const entry = createHistoryEntry(action, title, url);
    if (!entry) return;
    this.browsingHistory = addHistoryEntry(this.browsingHistory, entry);
    void this.context.globalState.update(HISTORY_STATE_KEY, this.browsingHistory);
    this.sendHistory();
  }

  sendHistory() {
    this.post({
      type: 'historyData',
      entries: this.browsingHistory.map(({ url, title, visitedAt }) => ({ url, title, visitedAt }))
    });
  }

  async openHistoryEntry(rawUrl) {
    const url = normalizePublicUrl(rawUrl);
    const entry = url && this.browsingHistory.find((candidate) => candidate.url === url);
    if (!entry) {
      vscode.window.showWarningMessage('这条历史记录已不存在。');
      this.sendHistory();
      return;
    }
    await this.openAction(entry.action);
  }

  async copyHistoryUrl(rawUrl) {
    const url = normalizePublicUrl(rawUrl);
    const entry = url && this.browsingHistory.find((candidate) => candidate.url === url);
    if (!entry) return;
    await vscode.env.clipboard.writeText(entry.url);
    this.post({ type: 'historyCopied', url: entry.url });
  }

  async clearBrowsingHistory() {
    const answer = await vscode.window.showWarningMessage(
      '清除本机保存的全部 LINUX DO 浏览历史？',
      { modal: true },
      '清除全部'
    );
    if (answer !== '清除全部') return;
    this.browsingHistory = [];
    await this.context.globalState.update(HISTORY_STATE_KEY, undefined);
    this.sendHistory();
  }

  async loadAction(action, resetListCursor, requestOptions) {
    if (resetListCursor) action.topicListCursor = undefined;
    if (action.type === 'topic') return this.loadTopic(action.id, action.slug, requestOptions);
    if (action.type === 'category') return this.loadList('category', action.id, action.name, requestOptions);
    if (action.type === 'search') return this.loadSearch(action.query, requestOptions);
    if (action.view === 'categories') return this.loadCategories(requestOptions);
    return this.loadList(action.view === 'top' ? 'top' : 'latest', undefined, undefined, requestOptions);
  }

  async goBack() {
    const previous = this.history.pop();
    if (!previous) return;
    this.browserSession.cancelPendingRequests(['navigation', 'topic-more', 'list-more', 'manual-more']);
    this.cancelScheduledRetry();
    this.currentAction = previous;
    this.moreSequence += 1;
    this.listMoreSequence += 1;
    this.post({ type: 'restorePage', canGoBack: this.history.length > 0, entryId: previous.entryId });
  }

  async handleRestoreResult(entryId, restored) {
    if (!this.currentAction || this.currentAction.entryId !== Number(entryId)) return;
    if (!restored) await this.loadAction(this.currentAction, true);
  }

  async loadMorePosts(topicId, rawPostIds, source) {
    const safeTopicId = Number(topicId);
    if (this.currentAction?.type !== 'topic' || this.currentAction.id !== safeTopicId) return;
    const postIds = [...new Set(Array.isArray(rawPostIds) ? rawPostIds.map(Number) : [])]
      .filter((postId) => Number.isInteger(postId) && postId > 0)
      .slice(0, 20);
    if (!postIds.length) return;
    const current = ++this.moreSequence;
    try {
      const posts = await this.api.topicPosts(safeTopicId, postIds, {
        requestLane: source === 'auto' ? 'topic-more' : 'manual-more',
        continuation: true,
        cancelPendingLanes: ['topic-more', 'manual-more']
      });
      if (current === this.moreSequence) {
        this.post({ type: 'morePosts', topicId: safeTopicId, posts, requestedPostIds: postIds });
      }
    } catch (error) {
      if (current === this.moreSequence) {
        this.post({ type: 'morePostsError', topicId: safeTopicId, message: friendlyError(error) });
      }
    }
  }

  async loadMoreTopics(source) {
    const action = this.currentAction;
    if (!action || action.type === 'topic' || action.type === 'search' || !action.topicListCursor) return;
    const current = ++this.listMoreSequence;
    try {
      const kind = action.type === 'category' ? 'category' : action.view === 'top' ? 'top' : 'latest';
      const data = await this.api.topicListPage(action.topicListCursor, kind, {
        requestLane: source === 'auto' ? 'list-more' : 'manual-more',
        continuation: true,
        cancelPendingLanes: ['list-more', 'manual-more']
      });
      if (current === this.listMoreSequence && this.currentAction?.entryId === action.entryId) {
        action.topicListCursor = data.morePath;
        this.post({ type: 'moreTopics', topics: data.topics, hasMore: Boolean(data.morePath) });
      }
    } catch (error) {
      if (current === this.listMoreSequence && this.currentAction?.entryId === action.entryId) {
        this.post({ type: 'moreTopicsError', message: friendlyError(error) });
      }
    }
  }

  async runLoad(loader, resultType, meta = {}, onSuccess) {
    const current = ++this.sequence;
    this.post({ type: 'loading' });
    try {
      const data = await loader();
      if (current === this.sequence) {
        if (activeRequestTransport?.lastEngine === 'native') returnFocusToReader(this.panel);
        onSuccess?.(data);
        if (this.currentAction?.entryId) this.currentAction.hasRenderedResult = true;
        this.post({ type: resultType, data, entryId: this.currentAction?.entryId, cacheInfo: this.browserSession.consumeLastResponseInfo(), ...meta });
      }
    } catch (error) {
      if (current === this.sequence) {
        if (activeRequestTransport?.lastEngine === 'native') returnFocusToReader(this.panel);
        if (error instanceof CloudflareError) {
          this.post({ type: 'cloudflareRequired', message: error.message, hasClearance: error.hasClearance });
        } else {
          const retryableProtection = error instanceof TransientProtectionError;
          const timedError = error instanceof RateLimitError || retryableProtection;
          this.post({
            type: 'error',
            message: friendlyError(error),
            retryAt: timedError ? error.retryAt : undefined,
            verificationAction: retryableProtection ? error.verificationAction : undefined
          });
          if (timedError && this.currentAction && !this.currentAction.hasRenderedResult && !this.currentAction.autoRetryUsed) {
            this.currentAction.autoRetryUsed = true;
            this.scheduleOneRetry(this.currentAction, error.retryAt);
          }
        }
      }
    }
  }

  cancelScheduledRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  scheduleOneRetry(action, retryAt) {
    const delay = Math.max(1_000, Number(retryAt) - Date.now());
    this.cancelScheduledRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.currentAction?.entryId === action.entryId) void this.loadAction(action, true, { force: true });
    }, delay);
  }

  loadList(kind, categoryId, categoryName, requestOptions) {
    const action = this.currentAction;
    return this.runLoad(
      () => this.api.list(kind, categoryId, navigationRequestOptions(requestOptions)),
      'topicList',
      { kind, categoryName },
      (data) => {
        if (this.currentAction?.entryId === action?.entryId) {
          action.topicListCursor = data.morePath;
          const title = kind === 'top'
            ? '本周热门'
            : kind === 'category'
              ? `${categoryName || '分类'} · 分类主题`
              : '最新主题';
          this.recordVisit(action, title);
        }
      }
    );
  }

  loadCategories(requestOptions) {
    const action = this.currentAction;
    return this.runLoad(() => this.api.categories(navigationRequestOptions(requestOptions)), 'categories', {}, () => {
      if (this.currentAction?.entryId === action?.entryId) this.recordVisit(action, '浏览分类');
    });
  }

  loadTopic(id, slug, requestOptions) {
    const action = this.currentAction;
    return this.runLoad(
      () => this.api.topic(id, slug, navigationRequestOptions(requestOptions)),
      'topic',
      {},
      (data) => {
        if (this.currentAction?.entryId === action?.entryId) {
          action.slug = data.slug;
          action.title = data.title;
          this.recordVisit(action, data.title, data.externalUrl);
        }
      }
    );
  }

  loadSearch(query, requestOptions) {
    if (!query) {
      this.post({ type: 'error', message: '请输入搜索关键词。' });
      return;
    }
    const action = this.currentAction;
    return this.runLoad(() => this.api.search(query, navigationRequestOptions(requestOptions)), 'topicList', { kind: 'search', query }, () => {
      if (this.currentAction?.entryId === action?.entryId) this.recordVisit(action, `搜索：${query}`);
    });
  }

  async openExternal(rawUrl) {
    try {
      const url = new URL(String(rawUrl));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('unsupported protocol');
      }
      await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
    } catch {
      vscode.window.showWarningMessage('无法打开这个链接。');
    }
  }

  post(message) {
    this.panel.webview.postMessage(message);
  }

  getHtml() {
    const webview = this.panel.webview;
    const nonce = randomNonce();
    const gameCoreUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'game-core.js'));
    const gameUiUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'game-ui.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css'));
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>LINUX DO 游客阅读器</title>
</head>
<body>
  <header class="toolbar">
    <button id="back" type="button" class="icon-button back-button" title="返回 (Alt+左箭头)" aria-label="返回" disabled>←</button>
    <button id="history" type="button" class="icon-button" title="浏览历史" aria-label="浏览历史">◴</button>
    <div class="brand" aria-label="LINUX DO 游客阅读器">
      <span class="brand-mark">L</span>
      <span class="brand-name">LINUX DO</span>
      <span class="guest-badge">只读</span>
    </div>
    <nav class="nav" aria-label="内容导航">
      <button type="button" data-view="latest">最新</button>
      <button type="button" data-view="top">热门</button>
      <button type="button" data-view="categories">分类</button>
    </nav>
    <form id="search-form" class="search" role="search">
      <input id="search-input" type="search" maxlength="100" placeholder="搜索公开主题" aria-label="搜索公开主题">
      <button type="submit" class="icon-button" title="搜索" aria-label="搜索">⌕</button>
    </form>
    <button id="break-reminder" type="button" class="icon-button" title="开启休息提醒" aria-label="开启休息提醒" aria-pressed="false">◷</button>
    <button id="share-topic" type="button" class="icon-button" title="分享当前主题" aria-label="分享当前主题">↗</button>
    <button id="open-share" type="button" class="icon-button" title="打开加密分享" aria-label="打开加密分享">⌁</button>
    <button id="open-game" type="button" class="icon-button game-button" title="打开休息小游戏" aria-label="打开休息小游戏">▦</button>
    <button id="density" type="button" class="icon-button" title="切换显示密度" aria-label="切换显示密度">≡</button>
    <button id="more-tools" type="button" class="icon-button" title="更多阅读设置" aria-label="更多阅读设置" aria-expanded="false">⋯</button>
    <button id="refresh" type="button" class="icon-button" title="刷新" aria-label="刷新">↻</button>
  </header>
  <main id="content" tabindex="-1">
    <div class="loading"><span class="spinner"></span><span>正在连接 LINUX DO…</span></div>
  </main>
  <script nonce="${nonce}" src="${gameCoreUri}"></script>
  <script nonce="${nonce}" src="${gameUiUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function sameAction(left, right) {
  return left?.type === right?.type &&
    left?.view === right?.view &&
    left?.id === right?.id &&
    left?.slug === right?.slug &&
    left?.query === right?.query;
}

function navigationRequestOptions(options) {
  return {
    ...(options || {}),
    requestLane: 'navigation',
    cancelPendingLanes: ['navigation', 'topic-more', 'list-more', 'manual-more']
  };
}

async function configureRequestMode(browserSession) {
  const selected = await vscode.window.showQuickPick(REQUEST_MODE_OPTIONS, {
    title: '设置 LINUX DO 请求节奏',
    placeHolder: '智能模式会根据明确的站点限流自动调整'
  });
  if (!selected) return;
  await vscode.workspace.getConfiguration('linuxdoGuest').update(
    'requestMode',
    selected.value,
    vscode.ConfigurationTarget.Global
  );
  browserSession.setRequestMode(selected.value);
  vscode.window.showInformationMessage(`请求节奏已设置为：${selected.label}。`);
}

async function configureRequestEngine(browserSession, transport) {
  const selected = await vscode.window.showQuickPick(REQUEST_ENGINE_OPTIONS, {
    title: '设置 LINUX DO 请求引擎',
    placeHolder: '原生浏览器使用 VS Code 内置 Chromium，会话与 Cloudflare 指纹保持一致'
  });
  if (!selected) return;
  await vscode.workspace.getConfiguration('linuxdoGuest').update(
    'requestEngine',
    selected.value,
    vscode.ConfigurationTarget.Global
  );
  transport.setMode(selected.value);
  browserSession.resetRequestState();
  if (selected.value === 'manual') await transport.stop();
  vscode.window.showInformationMessage(`请求引擎已设置为：${selected.label}。`);
}

class GuestTreeProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  refresh() {
    this.changeEmitter.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    return [
      navItem('最新主题', 'linuxdoGuest.openLatest', 'clock', '游客可见的最新帖子'),
      navItem('热门主题', 'linuxdoGuest.openTop', 'flame', '本周热门帖子'),
      navItem('浏览分类', 'linuxdoGuest.openCategories', 'list-tree', '查看公开分类'),
      navItem('打开加密分享', 'linuxdoGuest.openShareCode', 'link-external', '粘贴分享内容和密码打开主题'),
      navItem('设置请求节奏', 'linuxdoGuest.setRequestMode', 'dashboard', '调整游客请求节奏'),
      navItem('设置请求引擎', 'linuxdoGuest.setRequestEngine', 'server-process', '切换原生浏览器或手动参数请求'),
      navItem('打开原生游客验证', 'linuxdoGuest.openNativeVerification', 'browser', '在 VS Code 内置浏览器中完成游客验证'),
      navItem('加密分享教程', 'linuxdoGuest.shareHelp', 'question', '了解如何跨插件分享公开主题'),
      navItem('打开阅读器', 'linuxdoGuest.open', 'globe', '打开默认页面')
    ];
  }
}

function navItem(label, command, icon, tooltip) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.command = { command, title: label };
  item.iconPath = new vscode.ThemeIcon(icon);
  item.tooltip = tooltip;
  return item;
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return '无法连接 LINUX DO，请检查网络、代理或 DNS 设置。';
  }
  return message;
}

async function configureCloudflare(context, browserSession, onSaved) {
  VerificationPanel.createOrShow(context, createVerificationHandlers(context, browserSession, onSaved));
}

function createVerificationHandlers(context, browserSession, onSaved) {
  return {
    getState: async () => {
      const profile = await browserSession.getStoredVerification();
      return {
        hasCookie: Boolean(profile.cookieHeader),
        hasUserAgent: Boolean(profile.userAgent),
        profileSummary: await browserSession.getStoredProfileSummary()
      };
    },
    save: async ({ capture, cookie, userAgent, sourceHint, validate }) => {
      const captured = String(capture || '').trim();
      const enteredCookie = String(cookie || '').trim();
      const enteredUserAgent = String(userAgent || '').trim();
      let candidate;
      if (captured) {
        candidate = parseCapturedRequest(captured, sourceHint);
      } else if (enteredCookie || enteredUserAgent) {
        if (!enteredCookie || !enteredUserAgent) {
          throw new Error('参数混用：修改 Cookie 或 User-Agent 时必须同时填写另一项，并确保来自同一次 /latest.json 请求。');
        }
        candidate = createRequestProfile({
          cookieHeader: enteredCookie,
          userAgent: enteredUserAgent,
          source: `manual:${String(sourceHint || 'auto')}`
        });
      } else {
        const existing = await browserSession.getStoredVerification();
        if (!existing.cookieHeader || !existing.userAgent) throw new Error('请粘贴完整请求档案，或同时填写 Cookie 与 User-Agent。');
        candidate = existing;
      }
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: validate ? '正在对 /latest.json 发起一次参数测试' : '正在保存未验证的游客请求档案',
        cancellable: false
      }, () => browserSession.saveManualVerification({
        cookieHeader: candidate.cookieHeader,
        userAgent: candidate.userAgent,
        clientHints: candidate.clientHints,
        source: candidate.source,
        validate: Boolean(validate)
      }));
      await onSaved?.();
    },
    clear: async (target) => {
      await browserSession.stop();
      await context.secrets.delete(REQUEST_PROFILE_SECRET);
      await context.secrets.delete(CLEARANCE_SECRET);
      await context.secrets.delete(GUEST_COOKIE_SECRET);
      await context.secrets.delete(USER_AGENT_SECRET);
      await onSaved?.();
    }
  };
}

function validateClearanceInput(value) {
  return validateGuestCookieInput(value);
}

function extractClearance(input) {
  const value = String(input).trim();
  const match = value.match(/(?:^|;\s*)cf_clearance=([^;]+)/i);
  return (match ? match[1] : value).trim();
}

function validateGuestCookieInput(value) {
  const input = String(value || '').trim();
  if (!input) return '请输入 cf_clearance 或 Cookie。';
  if (/[\r\n]/.test(input)) return 'Cookie 不能包含换行。';
  const cookieHeader = filterGuestCookieHeader(input, MANUAL_GUEST_COOKIE_NAMES);
  if (!/(?:^|;\s*)cf_clearance=/i.test(cookieHeader)) {
    return '没有找到有效的 cf_clearance。';
  }
  return undefined;
}

function filterGuestCookieHeader(input, allowedNames = MANUAL_GUEST_COOKIE_NAMES) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.includes('=') || (!raw.includes(';') && !/^\s*[A-Za-z_][\w-]*=/.test(raw))) {
    return `cf_clearance=${raw}`;
  }

  const hasLoginCookie = /(?:^|;\s*)(?:_t|remember_user_token|auth_token)=/i.test(raw);
  const selected = new Map();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (allowedNames.has(name) && !(hasLoginCookie && name === '_forum_session') && value && !/[\r\n;]/.test(value)) {
      selected.set(name, value);
    }
  }
  return [...selected.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function validateUserAgent(value) {
  const input = String(value || '').trim();
  if (input.length < 20 || input.length > 1024 || /[\r\n]/.test(input)) {
    return 'User-Agent 格式不正确。';
  }
  return undefined;
}

async function clearCloudflare(context, browserSession) {
  await browserSession.stop();
  await context.secrets.delete(REQUEST_PROFILE_SECRET);
  await context.secrets.delete(CLEARANCE_SECRET);
  await context.secrets.delete(GUEST_COOKIE_SECRET);
  await context.secrets.delete(USER_AGENT_SECRET);
  vscode.window.showInformationMessage('Cloudflare 验证已清除。');
}

async function openShareCode(context, browserSession) {
  const clipboard = await vscode.env.clipboard.readText();
  const code = await vscode.window.showInputBox({
    title: '打开 LINUX DO 加密分享（第 1/2 步）',
    prompt: '粘贴对方发来的加密分享内容。内部格式标识无需手动填写或理解。',
    value: clipboard.trim().startsWith('LDGS2.') ? clipboard.trim() : '',
    ignoreFocusOut: true
  });
  if (code === undefined) return;
  if (code.trim().startsWith('LDGS1.')) {
    vscode.window.showErrorMessage('旧版分享内容没有密码加密，已停止支持。请让发送方使用新版插件重新生成。');
    return;
  }
  const password = await vscode.window.showInputBox({
    title: '打开 LINUX DO 加密分享（第 2/2 步）',
    prompt: '输入发送方通过另一渠道提供的分享密码。密码只用于本次解密，不会保存。',
    password: true,
    ignoreFocusOut: true,
    validateInput: passwordValidationMessage
  });
  if (password === undefined) return;
  try {
    const topic = parseShareCode(code, password);
    const panel = GuestReaderPanel.createOrShow(context, browserSession, 'latest');
    panel.openSharedTopic(topic);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function showShareHelp() {
  await vscode.window.showInformationMessage(
    '加密分享使用说明',
    {
      modal: true,
      detail: [
        '1. 打开一个公开主题，点击工具栏“分享”或执行“LINUX DO: 分享当前主题”。',
        '2. 选择 10 分钟、1 小时、24 小时或 7 天，并填写至少 12 个字符的分享密码；也可生成 20 位强密码。',
        '3. 插件把加密分享内容复制到剪贴板。把它发给对方，并通过另一渠道告知分享密码。',
        '4. 对方选择“打开加密分享”，粘贴分享内容并输入相同密码即可。',
        '',
        '主题、标题、生成时间和过期时间都使用 AES-256-GCM 加密。密码经随机盐和 600,000 次 PBKDF2-HMAC-SHA256 派生密钥；盐用于防预计算，密码不写入分享内容，也不会保存。只有分享内容而没有密码，即使知道算法和源码也无法直接还原主题。',
        '',
        '请使用不易猜测的密码并通过另一渠道发送。如果中间人同时取得分享内容和密码，或密码过于简单，纯客户端插件无法继续保密。到期后插件拒绝导入，但已打开或另行保存的公开 URL 无法撤回。'
      ].join('\n')
    }
  );
}

async function promptSharePassword() {
  const mode = await vscode.window.showQuickPick([
    { label: '自己填写密码', description: '至少 12 个字符', value: 'manual' },
    { label: '生成 20 位强密码', description: '生成后请先保存或通过另一渠道发送', value: 'generated' }
  ], {
    title: '设置分享密码',
    placeHolder: '密码不会写入分享内容或保存'
  });
  if (!mode) return undefined;
  if (mode.value === 'generated') {
    return promptGeneratedSharePassword();
  }

  const password = await vscode.window.showInputBox({
    title: '输入分享密码',
    prompt: '至少 12 个字符。请使用不易猜测且未在其他网站使用的密码。',
    password: true,
    ignoreFocusOut: true,
    validateInput: passwordValidationMessage
  });
  if (password === undefined) return undefined;
  const confirmation = await vscode.window.showInputBox({
    title: '确认分享密码',
    prompt: '再次输入相同密码。',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value !== password ? '两次输入的分享密码不一致。' : passwordValidationMessage(value)
  });
  return confirmation === undefined ? undefined : password;
}

function promptGeneratedSharePassword() {
  return new Promise((resolve) => {
    const input = vscode.window.createInputBox();
    const copyButton = {
      iconPath: new vscode.ThemeIcon('copy'),
      tooltip: '复制密码'
    };
    const regenerateButton = {
      iconPath: new vscode.ThemeIcon('refresh'),
      tooltip: '重新生成'
    };
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.dispose();
      resolve(value);
    };

    input.title = '生成分享密码';
    input.prompt = '请先点击“复制密码”保存，再按 Enter 使用；也可重新生成。';
    input.value = generatePassword();
    input.ignoreFocusOut = true;
    input.buttons = [copyButton, regenerateButton];
    input.onDidTriggerButton(async (button) => {
      if (button === regenerateButton) {
        input.value = generatePassword();
        input.validationMessage = '已生成新密码，请复制后再继续。';
        return;
      }
      try {
        await vscode.env.clipboard.writeText(input.value);
        input.validationMessage = '密码已复制到剪贴板。';
      } catch {
        input.validationMessage = '无法写入剪贴板，请手动选择并复制密码。';
      }
    });
    input.onDidAccept(() => {
      const message = passwordValidationMessage(input.value);
      if (message) {
        input.validationMessage = message;
        return;
      }
      finish(input.value);
    });
    input.onDidHide(() => finish(undefined));
    input.show();
  });
}

function passwordValidationMessage(value) {
  try {
    validatePassword(value);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function randomNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function activate(context) {
  const provider = new GuestTreeProvider();
  const nativeBrowserSession = new NativeBrowserSession(vscode, {
    onStatus: (message) => {
      GuestReaderPanel.current?.post({ type: 'nativeStatus', message });
      vscode.window.setStatusBarMessage(`LINUX DO：${message}`, 8_000);
    },
    onReady: async () => {
      // startDebugging may focus its debugger editor and the bottom panel.
      // Return focus to the reader after the browser editor has finished
      // activating, without closing the debug editor (closing it terminates
      // the CDP session on some VS Code builds).
      if (!GuestReaderPanel.current) return;
      await vscode.commands.executeCommand('workbench.action.closePanel').catch(() => {});
      returnFocusToReader(GuestReaderPanel.current.panel);
    }
  });
  const requestTransport = new GuestRequestTransport({
    nativeBrowser: nativeBrowserSession,
    manualFetch: fetchGuestResponse,
    mode: vscode.workspace.getConfiguration('linuxdoGuest').get('requestEngine', 'auto')
  });
  const browserSession = new GuestRequestSession(context.secrets, {
    requestMode: vscode.workspace.getConfiguration('linuxdoGuest').get('requestMode', 'smart'),
    fetchResponse: (url, verification) => requestTransport.fetchResponse(url, verification),
    onQueueWait: ({ waitMs, reason }) => GuestReaderPanel.current?.post({ type: 'queueWait', waitMs, reason })
  });
  activeBrowserSession = browserSession;
  activeNativeBrowserSession = nativeBrowserSession;
  activeRequestTransport = requestTransport;
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('linuxdoGuest.explorer', provider),
    vscode.commands.registerCommand('linuxdoGuest.open', () => {
      const defaultView = vscode.workspace.getConfiguration('linuxdoGuest').get('defaultView', 'latest');
      GuestReaderPanel.createOrShow(context, browserSession, defaultView);
    }),
    vscode.commands.registerCommand('linuxdoGuest.openLatest', () => GuestReaderPanel.createOrShow(context, browserSession, 'latest')),
    vscode.commands.registerCommand('linuxdoGuest.openTop', () => GuestReaderPanel.createOrShow(context, browserSession, 'top')),
    vscode.commands.registerCommand('linuxdoGuest.openCategories', () => GuestReaderPanel.createOrShow(context, browserSession, 'categories')),
    vscode.commands.registerCommand('linuxdoGuest.refresh', () => {
      provider.refresh();
      GuestReaderPanel.current?.refresh();
    }),
    vscode.commands.registerCommand('linuxdoGuest.setCloudflareClearance', () => configureCloudflare(context, browserSession, () => GuestReaderPanel.current?.refresh(false))),
    vscode.commands.registerCommand('linuxdoGuest.clearCloudflareClearance', () => clearCloudflare(context, browserSession)),
    vscode.commands.registerCommand('linuxdoGuest.setRequestMode', () => configureRequestMode(browserSession)),
    vscode.commands.registerCommand('linuxdoGuest.setRequestEngine', () => configureRequestEngine(browserSession, requestTransport)),
    vscode.commands.registerCommand('linuxdoGuest.openNativeVerification', async () => {
      try {
        await nativeBrowserSession.revealVerification();
      } catch (error) {
        const message = error instanceof NativeBrowserUnavailableError ? error.message : friendlyError(error);
        vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand('linuxdoGuest.shareCurrentTopic', () => GuestReaderPanel.current?.shareCurrentTopic() || vscode.window.showInformationMessage('请先打开一个主题。')),
    vscode.commands.registerCommand('linuxdoGuest.openShareCode', () => openShareCode(context, browserSession)),
    vscode.commands.registerCommand('linuxdoGuest.shareHelp', showShareHelp),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('linuxdoGuest.breakReminder.enabled')) {
        GuestReaderPanel.current?.updateBreakReminderSetting();
      }
      if (event.affectsConfiguration('linuxdoGuest.requestMode')) {
        browserSession.setRequestMode(vscode.workspace.getConfiguration('linuxdoGuest').get('requestMode', 'smart'));
      }
      if (event.affectsConfiguration('linuxdoGuest.requestEngine')) {
        requestTransport.setMode(vscode.workspace.getConfiguration('linuxdoGuest').get('requestEngine', 'auto'));
        browserSession.resetRequestState();
      }
    }),
    provider.changeEmitter,
    { dispose: () => void Promise.allSettled([browserSession.stop(), requestTransport.stop()]) }
  );
}

let activeBrowserSession;
let activeNativeBrowserSession;
let activeRequestTransport;

function returnFocusToReader(panel) {
  if (!panel) return;
  const reveal = () => {
    try {
      panel.reveal(vscode.ViewColumn.One, false);
      focusReaderEditor(vscode);
    } catch {
      // The user may have closed the reader while the delayed focus callback
      // was pending.
    }
  };
  reveal();
  setTimeout(reveal, 250);
  setTimeout(reveal, 1_000);
}

function focusReaderEditor(vscodeApi) {
  const groups = vscodeApi.window?.tabGroups?.all || [];
  const isReader = (tab) => {
    const label = String(tab?.label || '');
    const viewType = String(tab?.input?.viewType || '');
    return /LINUX DO 游客阅读器/.test(label) || /webview/i.test(viewType) && /linuxdo/i.test(label);
  };
  const group = groups.find((candidate) => (candidate.tabs || []).some(isReader))
    || vscodeApi.window?.tabGroups?.activeTabGroup
    || groups.find((candidate) => candidate.isActive)
    || groups[0];
  const tabs = group?.tabs || [];
  const index = tabs.findIndex(isReader);
  if (index < 0 || index >= 9) return;
  const activate = async () => {
    try {
      if (group && vscodeApi.window?.tabGroups?.show) await vscodeApi.window.tabGroups.show(group, false);
      await vscodeApi.commands.executeCommand(`workbench.action.openEditorAtIndex${index + 1}`);
    } catch {
      // The reader may already be focused or the active group may have changed.
    }
  };
  void activate();
}

function deactivate() {
  return Promise.allSettled([
    activeBrowserSession?.stop(),
    activeRequestTransport?.stop()
  ]);
}

module.exports = {
  activate,
  deactivate,
  LinuxDoApi,
  extractClearance,
  filterGuestCookieHeader,
  isLinuxDoUrl,
  openShareCode,
  validateClearanceInput,
  validateGuestCookieInput,
  validateUserAgent
};
