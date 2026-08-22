'use strict';

const vscode = require('vscode');
const {
  GuestRequestSession,
  CloudflareError,
  CLEARANCE_SECRET,
  GUEST_COOKIE_NAMES,
  GUEST_COOKIE_SECRET,
  SITE_ORIGIN,
  USER_AGENT_SECRET,
  isLinuxDoUrl
} = require('./guest-session');
const { createShareCode, parseShareCode } = require('./share-code');
const { VerificationPanel } = require('./verification-panel');

const MANUAL_GUEST_COOKIE_NAMES = GUEST_COOKIE_NAMES;
const SHARE_DURATIONS = [
  { label: '1 小时', description: '默认', milliseconds: 60 * 60 * 1000 },
  { label: '10 分钟', milliseconds: 10 * 60 * 1000 },
  { label: '24 小时', milliseconds: 24 * 60 * 60 * 1000 },
  { label: '7 天', milliseconds: 7 * 24 * 60 * 60 * 1000 }
];

class LinuxDoApi {
  constructor(browserSession) {
    this.browserSession = browserSession;
  }

  async request(path) {
    const url = new URL(path, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) {
      throw new Error('拒绝访问非 LINUX DO 接口。');
    }

    return this.browserSession.request(url);
  }

  async list(kind, categoryId) {
    let path;
    if (kind === 'top') {
      path = '/top.json?period=weekly';
    } else if (kind === 'category' && Number.isInteger(categoryId)) {
      path = `/c/${categoryId}/l/latest.json`;
    } else {
      path = '/latest.json';
    }
    const data = await this.request(path);
    return normalizeTopicList(data, kind);
  }

  async categories() {
    const data = await this.request('/categories.json');
    return (data.category_list?.categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      color: normalizeColor(category.color),
      description: stripText(category.description_text || category.description || ''),
      topicCount: category.topic_count || 0
    }));
  }

  async search(query) {
    const data = await this.request(`/search.json?q=${encodeURIComponent(query)}`);
    return normalizeTopicList({ topic_list: { topics: data.topics || [] }, users: data.users || [] }, 'search');
  }

  async topic(id, slug) {
    const safeId = Number(id);
    if (!Number.isInteger(safeId) || safeId <= 0) {
      throw new Error('主题编号无效。');
    }
    const safeSlug = typeof slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(slug) ? slug : 'topic';
    const data = await this.request(`/t/${safeSlug}/${safeId}.json`);
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

  async topicPosts(topicId, postIds) {
    const safeTopicId = Number(topicId);
    if (!Number.isInteger(safeTopicId) || safeTopicId <= 0) {
      throw new Error('主题编号无效。');
    }
    const safePostIds = [...new Set((postIds || []).map(Number))]
      .filter((postId) => Number.isInteger(postId) && postId > 0)
      .slice(0, 20);
    if (!safePostIds.length) return [];
    const query = safePostIds.map((postId) => `post_ids%5B%5D=${postId}`).join('&');
    const data = await this.request(`/t/${safeTopicId}/posts.json?${query}`);
    return (data.post_stream?.posts || data.posts || []).map(normalizePost);
  }

  async topicListPage(morePath, kind) {
    const safePath = normalizeMoreTopicsPath(morePath);
    if (!safePath) throw new Error('主题分页地址无效。');
    const data = await this.request(safePath);
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
    this.entryCounter = 0;
    this.currentAction = undefined;
    this.history = [];
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => {
      GuestReaderPanel.current = undefined;
      void this.browserSession.stop();
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
        await configureCloudflare(this.context, this.browserSession, () => this.refresh());
        break;
      case 'shareCurrent':
        await this.shareCurrentTopic();
        break;
      case 'loadMorePosts':
        await this.loadMorePosts(message.topicId, message.postIds);
        break;
      case 'loadMoreTopics':
        await this.loadMoreTopics();
        break;
    }
  }

  async refresh() {
    if (!this.currentAction) return this.navigate(this.initialView);
    return this.loadAction(this.currentAction, true);
  }

  async openAction(action, recordHistory = true) {
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
      vscode.window.showInformationMessage('请先打开一个主题，再生成临时分享码。');
      return;
    }
    const duration = await vscode.window.showQuickPick(SHARE_DURATIONS, {
      title: '选择分享码有效期',
      placeHolder: '默认 1 小时'
    });
    if (!duration) return;
    const code = createShareCode(action, duration.milliseconds);
    await vscode.env.clipboard.writeText(code);
    const expiresAt = new Date(Date.now() + duration.milliseconds).toLocaleString('zh-CN', { hour12: false });
    vscode.window.showInformationMessage(`临时分享码已复制，将于 ${expiresAt} 失效。`);
  }

  async loadAction(action, resetListCursor) {
    if (resetListCursor) action.topicListCursor = undefined;
    if (action.type === 'topic') return this.loadTopic(action.id, action.slug);
    if (action.type === 'category') return this.loadList('category', action.id, action.name);
    if (action.type === 'search') return this.loadSearch(action.query);
    if (action.view === 'categories') return this.loadCategories();
    return this.loadList(action.view === 'top' ? 'top' : 'latest');
  }

  async goBack() {
    const previous = this.history.pop();
    if (!previous) return;
    this.currentAction = previous;
    this.moreSequence += 1;
    this.listMoreSequence += 1;
    this.post({ type: 'restorePage', canGoBack: this.history.length > 0, entryId: previous.entryId });
  }

  async handleRestoreResult(entryId, restored) {
    if (!this.currentAction || this.currentAction.entryId !== Number(entryId)) return;
    if (!restored) await this.loadAction(this.currentAction, true);
  }

  async loadMorePosts(topicId, rawPostIds) {
    const safeTopicId = Number(topicId);
    if (this.currentAction?.type !== 'topic' || this.currentAction.id !== safeTopicId) return;
    const postIds = [...new Set(Array.isArray(rawPostIds) ? rawPostIds.map(Number) : [])]
      .filter((postId) => Number.isInteger(postId) && postId > 0)
      .slice(0, 20);
    if (!postIds.length) return;
    const current = ++this.moreSequence;
    try {
      const posts = await this.api.topicPosts(safeTopicId, postIds);
      if (current === this.moreSequence) {
        this.post({ type: 'morePosts', topicId: safeTopicId, posts, requestedPostIds: postIds });
      }
    } catch (error) {
      if (current === this.moreSequence) {
        this.post({ type: 'morePostsError', topicId: safeTopicId, message: friendlyError(error) });
      }
    }
  }

  async loadMoreTopics() {
    const action = this.currentAction;
    if (!action || action.type === 'topic' || action.type === 'search' || !action.topicListCursor) return;
    const current = ++this.listMoreSequence;
    try {
      const kind = action.type === 'category' ? 'category' : action.view === 'top' ? 'top' : 'latest';
      const data = await this.api.topicListPage(action.topicListCursor, kind);
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
        onSuccess?.(data);
        this.post({ type: resultType, data, ...meta });
      }
    } catch (error) {
      if (current === this.sequence) {
        if (error instanceof CloudflareError) {
          this.post({ type: 'cloudflareRequired', message: error.message, hasClearance: error.hasClearance });
        } else {
          this.post({ type: 'error', message: friendlyError(error) });
        }
      }
    }
  }

  loadList(kind, categoryId, categoryName) {
    const action = this.currentAction;
    return this.runLoad(
      () => this.api.list(kind, categoryId),
      'topicList',
      { kind, categoryName },
      (data) => {
        if (this.currentAction?.entryId === action?.entryId) action.topicListCursor = data.morePath;
      }
    );
  }

  loadCategories() {
    return this.runLoad(() => this.api.categories(), 'categories');
  }

  loadTopic(id, slug) {
    const action = this.currentAction;
    return this.runLoad(
      () => this.api.topic(id, slug),
      'topic',
      {},
      (data) => {
        if (this.currentAction?.entryId === action?.entryId) {
          action.slug = data.slug;
          action.title = data.title;
        }
      }
    );
  }

  loadSearch(query) {
    if (!query) {
      this.post({ type: 'error', message: '请输入搜索关键词。' });
      return;
    }
    return this.runLoad(() => this.api.search(query), 'topicList', { kind: 'search', query });
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
    <button id="open-game" type="button" class="icon-button game-button" title="打开休息小游戏" aria-label="打开休息小游戏">▦</button>
    <button id="density" type="button" class="icon-button" title="切换显示密度" aria-label="切换显示密度">≡</button>
    <button id="refresh" type="button" class="icon-button" title="刷新" aria-label="刷新">↻</button>
  </header>
  <main id="content" tabindex="-1">
    <div class="loading"><span class="spinner"></span><span>正在连接 LINUX DO…</span></div>
  </main>
  <script nonce="${nonce}" src="${gameCoreUri}"></script>
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
  const currentCookie = async () => {
    const saved = await context.secrets.get(GUEST_COOKIE_SECRET);
    if (saved) return saved;
    const legacy = await context.secrets.get(CLEARANCE_SECRET);
    return legacy ? `cf_clearance=${legacy}` : '';
  };
  return {
    getState: async () => ({
      hasCookie: Boolean(await currentCookie()),
      hasUserAgent: Boolean(await context.secrets.get(USER_AGENT_SECRET))
    }),
    save: async ({ cookie, userAgent, validate }) => {
      const cookieHeader = cookie.trim()
        ? filterGuestCookieHeader(cookie, MANUAL_GUEST_COOKIE_NAMES)
        : await currentCookie();
      const expectedUserAgent = userAgent.trim() || await context.secrets.get(USER_AGENT_SECRET) || '';
      const cookieError = validateGuestCookieInput(cookieHeader);
      if (cookieError) throw new Error(cookieError);
      const userAgentError = validateUserAgent(expectedUserAgent);
      if (userAgentError) throw new Error(userAgentError);
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: validate ? '正在测试 Cloudflare 游客参数' : '正在保存 Cloudflare 游客参数',
        cancellable: false
      }, () => browserSession.saveManualVerification({
        cookieHeader,
        userAgent: expectedUserAgent,
        validate: Boolean(validate)
      }));
      await onSaved?.();
    },
    clear: async (target) => {
      await browserSession.stop();
      if (target === 'cookie' || target === 'all') {
        await context.secrets.delete(CLEARANCE_SECRET);
        await context.secrets.delete(GUEST_COOKIE_SECRET);
      }
      if (target === 'userAgent' || target === 'all') await context.secrets.delete(USER_AGENT_SECRET);
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
  await context.secrets.delete(CLEARANCE_SECRET);
  await context.secrets.delete(GUEST_COOKIE_SECRET);
  await context.secrets.delete(USER_AGENT_SECRET);
  vscode.window.showInformationMessage('Cloudflare 验证已清除。');
}

async function openShareCode(context, browserSession) {
  const clipboard = await vscode.env.clipboard.readText();
  const code = await vscode.window.showInputBox({
    title: '打开 LINUX DO 临时分享码',
    prompt: '粘贴 LDGS1 分享码；分享码只包含公开主题信息。',
    value: clipboard.trim().startsWith('LDGS1.') ? clipboard.trim() : '',
    ignoreFocusOut: true
  });
  if (code === undefined) return;
  try {
    const topic = parseShareCode(code);
    const panel = GuestReaderPanel.createOrShow(context, browserSession, 'latest');
    panel.openSharedTopic(topic);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
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
  const browserSession = new GuestRequestSession(context.secrets);
  activeBrowserSession = browserSession;
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
    vscode.commands.registerCommand('linuxdoGuest.setCloudflareClearance', () => configureCloudflare(context, browserSession, () => GuestReaderPanel.current?.refresh())),
    vscode.commands.registerCommand('linuxdoGuest.clearCloudflareClearance', () => clearCloudflare(context, browserSession)),
    vscode.commands.registerCommand('linuxdoGuest.shareCurrentTopic', () => GuestReaderPanel.current?.shareCurrentTopic() || vscode.window.showInformationMessage('请先打开一个主题。')),
    vscode.commands.registerCommand('linuxdoGuest.openShareCode', () => openShareCode(context, browserSession)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('linuxdoGuest.breakReminder.enabled')) {
        GuestReaderPanel.current?.updateBreakReminderSetting();
      }
    }),
    provider.changeEmitter,
    { dispose: () => void browserSession.stop() }
  );
}

let activeBrowserSession;

function deactivate() {
  return activeBrowserSession?.stop();
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
