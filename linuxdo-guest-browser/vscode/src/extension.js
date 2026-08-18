'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SITE_ORIGIN = 'https://linux.do';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const CLEARANCE_SECRET = 'linuxdoGuest.cloudflare.clearance';
const GUEST_COOKIE_SECRET = 'linuxdoGuest.cloudflare.guestCookies';
const USER_AGENT_SECRET = 'linuxdoGuest.cloudflare.userAgent';
const VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;
const MANUAL_GUEST_COOKIE_NAMES = new Set([
  'cf_clearance',
  '__cf_bm',
  '__cfuvid',
  '_cfuvid',
  '_bypass_cache',
  '_forum_session'
]);
const AUTOMATIC_GUEST_COOKIE_NAMES = new Set([
  ...MANUAL_GUEST_COOKIE_NAMES,
  '_forum_session'
]);

class CloudflareError extends Error {
  constructor(hasClearance) {
    super(hasClearance
      ? 'Cloudflare 验证未通过，验证可能已过期，或 User-Agent 与获取验证时不一致。'
      : 'Cloudflare 要求人机验证。');
    this.name = 'CloudflareError';
    this.hasClearance = hasClearance;
  }
}

class LinuxDoApi {
  constructor(secrets) {
    this.secrets = secrets;
  }

  async request(path) {
    const url = new URL(path, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) {
      throw new Error('拒绝访问非 LINUX DO 接口。');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const guestCookies = await this.secrets.get(GUEST_COOKIE_SECRET);
      const legacyClearance = await this.secrets.get(CLEARANCE_SECRET);
      const savedUserAgent = await this.secrets.get(USER_AGENT_SECRET);
      const headers = {
        Accept: 'application/json',
        'User-Agent': savedUserAgent || defaultUserAgent()
      };
      if (guestCookies) {
        headers.Cookie = guestCookies;
      } else if (legacyClearance) {
        headers.Cookie = `cf_clearance=${legacyClearance}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
        headers
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new CloudflareError(Boolean(guestCookies || legacyClearance));
        }
        if (response.status === 429) {
          throw new Error('站点请求过于频繁（HTTP 429），请稍后再试。');
        }
        throw new Error(`LINUX DO 返回 HTTP ${response.status}。`);
      }

      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error('站点返回的数据过大，已停止加载。');
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('站点返回的数据过大，已停止加载。');
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error('站点没有返回可识别的公开数据，可能正在进行人机验证。');
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('连接 LINUX DO 超时。');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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

function defaultUserAgent() {
  const chromeVersion = process.versions.chrome || '120.0.0.0';
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
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

  static createOrShow(context, initialView = 'latest') {
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
    GuestReaderPanel.current = new GuestReaderPanel(panel, context, initialView);
    return GuestReaderPanel.current;
  }

  constructor(panel, context, initialView) {
    this.panel = panel;
    this.context = context;
    this.api = new LinuxDoApi(context.secrets);
    this.initialView = initialView;
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
    }, null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, context.subscriptions);
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
        await this.openAction({ type: 'view', view: this.initialView }, false);
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
      case 'external':
        await this.openExternal(message.url);
        break;
      case 'cloudflareSetup':
        await configureCloudflare(this.context, () => this.refresh());
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
    return this.runLoad(() => this.api.topic(id, slug), 'topic');
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
    <button id="density" type="button" class="icon-button" title="切换显示密度" aria-label="切换显示密度">≡</button>
    <button id="refresh" type="button" class="icon-button" title="刷新" aria-label="刷新">↻</button>
  </header>
  <main id="content" tabindex="-1">
    <div class="loading"><span class="spinner"></span><span>正在连接 LINUX DO…</span></div>
  </main>
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

async function configureCloudflare(context, onSaved) {
  const choice = await vscode.window.showInformationMessage(
    '扩展可以打开独立的临时浏览器并自动获取 Cloudflare 验证，不会读取日常浏览器数据。',
    '自动验证',
    '手动粘贴',
    '清除验证'
  );

  if (choice === '自动验证') {
    try {
      const result = await acquireCloudflareClearance();
      if (!result) return;
      await context.secrets.store(GUEST_COOKIE_SECRET, result.cookieHeader);
      await context.secrets.delete(CLEARANCE_SECRET);
      await context.secrets.store(USER_AGENT_SECRET, result.userAgent);
      vscode.window.showInformationMessage('Cloudflare 验证已自动获取，正在重新加载。');
      await onSaved?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`自动验证失败：${message}`);
    }
    return;
  }
  if (choice === '清除验证') {
    await clearCloudflare(context);
    return;
  }
  if (choice !== '手动粘贴') {
    return;
  }

  const rawCookies = await vscode.window.showInputBox({
    title: '粘贴 Cloudflare 验证',
    prompt: '粘贴 cf_clearance 的值或完整 Cookie。扩展只保留游客白名单字段；检测到登录字段时会丢弃论坛会话。',
    password: true,
    ignoreFocusOut: true,
    validateInput: validateGuestCookieInput
  });
  if (rawCookies === undefined) {
    return;
  }
  const cookieHeader = filterGuestCookieHeader(rawCookies, MANUAL_GUEST_COOKIE_NAMES);

  const userAgent = await vscode.window.showInputBox({
    title: '粘贴浏览器 User-Agent',
    prompt: 'F12 → Network/网络 → linux.do 文档请求 → Request Headers，复制 user-agent；也可在控制台执行 navigator.userAgent。',
    value: await context.secrets.get(USER_AGENT_SECRET) || defaultUserAgent(),
    ignoreFocusOut: true,
    validateInput: validateUserAgent
  });
  if (userAgent === undefined) {
    return;
  }

  await context.secrets.store(GUEST_COOKIE_SECRET, cookieHeader);
  await context.secrets.delete(CLEARANCE_SECRET);
  await context.secrets.store(USER_AGENT_SECRET, userAgent.trim());
  vscode.window.showInformationMessage('Cloudflare 游客验证已安全保存；登录和无关 Cookie 已丢弃。正在重新加载。');
  await onSaved?.();
}

async function acquireCloudflareClearance() {
  const executable = findChromiumExecutable();
  if (!executable) {
    throw new Error('未找到 Google Chrome、Chromium、Microsoft Edge 或 Brave，请使用手动粘贴。');
  }
  if (typeof WebSocket !== 'function') {
    throw new Error('当前 VS Code 版本不支持自动读取验证结果，请升级 VS Code 或使用手动粘贴。');
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxdo-guest-cf-'));
  const browser = spawn(executable, [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--new-window',
    `${SITE_ORIGIN}/latest`
  ], {
    detached: false,
    stdio: 'ignore'
  });
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  let browserWebSocketUrl;

  try {
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: '请在临时浏览器中完成 LINUX DO 验证',
      cancellable: true
    }, async (progress, cancellationToken) => {
      progress.report({ message: '正在启动独立游客会话…' });
      const activePort = await waitForDevTools(activePortFile, browser, cancellationToken);
      browserWebSocketUrl = `ws://127.0.0.1:${activePort.port}${activePort.browserPath}`;
      progress.report({ message: '等待 Cloudflare 验证完成…' });

      const startedAt = Date.now();
      while (Date.now() - startedAt < VERIFICATION_TIMEOUT_MS) {
        if (cancellationToken.isCancellationRequested) {
          return undefined;
        }
        const result = await readClearanceFromBrowser(activePort.port).catch(() => undefined);
        if (result) {
          progress.report({ message: '已取得验证，正在清理临时会话…' });
          return result;
        }
        await delay(900);
      }
      throw new Error('等待验证超时，请重试。');
    });
  } finally {
    await closeTemporaryBrowser(browser, browserWebSocketUrl, profileDir);
  }
}

function findChromiumExecutable() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ]
    : process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Chromium/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware/Brave-Browser/Application/brave.exe')
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
          '/usr/bin/brave-browser'
        ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function waitForDevTools(activePortFile, browser, cancellationToken) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (cancellationToken.isCancellationRequested) {
      throw new Error('已取消验证。');
    }
    if (browser.exitCode !== null) {
      throw new Error(`浏览器提前退出（代码 ${browser.exitCode}）。`);
    }
    try {
      const [portLine, browserPath] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && browserPath?.startsWith('/devtools/browser/')) {
        return { port, browserPath };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(200);
  }
  throw new Error('无法连接临时浏览器。');
}

async function readClearanceFromBrowser(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) return undefined;
  const targets = await response.json();
  const target = targets.find((item) => item.type === 'page' && isLinuxDoUrl(item.url));
  if (!target?.webSocketDebuggerUrl) return undefined;

  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await client.send('Network.enable');
    const [cookieResult, userAgentResult] = await Promise.all([
      client.send('Network.getCookies', { urls: [`${SITE_ORIGIN}/`] }),
      client.send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })
    ]);
    const cookies = (cookieResult.cookies || []).filter((cookie) =>
      AUTOMATIC_GUEST_COOKIE_NAMES.has(cookie.name) &&
      (cookie.domain === 'linux.do' || cookie.domain === '.linux.do')
    );
    const clearance = cookies.find((cookie) =>
      cookie.name === 'cf_clearance' && (cookie.domain === 'linux.do' || cookie.domain === '.linux.do')
    );
    const userAgent = userAgentResult.result?.value;
    if (!clearance?.value || validateUserAgent(userAgent)) return undefined;
    const cookieHeader = cookies
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    return { cookieHeader, userAgent: userAgent.trim() };
  } finally {
    client.close();
  }
}

function isLinuxDoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'linux.do' || url.hostname.endsWith('.linux.do'));
  } catch {
    return false;
  }
}

class CdpClient {
  static async connect(url) {
    const client = new CdpClient(url);
    await client.open();
    return client;
  }

  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接浏览器调试端口超时。')), 3_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('无法读取浏览器验证结果。'));
      }, { once: true });
      this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
      this.socket.addEventListener('close', () => this.rejectPending());
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器命令超时：${method}`));
      }, 3_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  handleMessage(rawData) {
    let message;
    try {
      message = JSON.parse(typeof rawData === 'string' ? rawData : Buffer.from(rawData).toString('utf8'));
    } catch {
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || '浏览器命令失败。'));
    else pending.resolve(message.result || {});
  }

  rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('浏览器调试连接已关闭。'));
    }
    this.pending.clear();
  }

  close() {
    this.socket.close();
  }
}

async function closeTemporaryBrowser(browser, browserWebSocketUrl, profileDir) {
  if (browserWebSocketUrl) {
    try {
      const client = await CdpClient.connect(browserWebSocketUrl);
      await client.send('Browser.close');
      client.close();
    } catch {
      // The user may already have closed the temporary browser.
    }
  }
  if (browser.exitCode === null) {
    browser.kill('SIGTERM');
  }
  await waitForProcessExit(browser, 3_000);
  if (isOwnedTemporaryProfile(profileDir)) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome can briefly retain files after exit; stale OS temp files are harmless.
    }
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function isOwnedTemporaryProfile(profileDir) {
  const relative = path.relative(os.tmpdir(), profileDir);
  return relative.startsWith('linuxdo-guest-cf-') && !relative.includes(`..${path.sep}`) && !path.isAbsolute(relative);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function clearCloudflare(context) {
  await context.secrets.delete(CLEARANCE_SECRET);
  await context.secrets.delete(GUEST_COOKIE_SECRET);
  await context.secrets.delete(USER_AGENT_SECRET);
  vscode.window.showInformationMessage('Cloudflare 验证已清除。');
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
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('linuxdoGuest.explorer', provider),
    vscode.commands.registerCommand('linuxdoGuest.open', () => {
      const defaultView = vscode.workspace.getConfiguration('linuxdoGuest').get('defaultView', 'latest');
      GuestReaderPanel.createOrShow(context, defaultView);
    }),
    vscode.commands.registerCommand('linuxdoGuest.openLatest', () => GuestReaderPanel.createOrShow(context, 'latest')),
    vscode.commands.registerCommand('linuxdoGuest.openTop', () => GuestReaderPanel.createOrShow(context, 'top')),
    vscode.commands.registerCommand('linuxdoGuest.openCategories', () => GuestReaderPanel.createOrShow(context, 'categories')),
    vscode.commands.registerCommand('linuxdoGuest.refresh', () => {
      provider.refresh();
      GuestReaderPanel.current?.refresh();
    }),
    vscode.commands.registerCommand('linuxdoGuest.setCloudflareClearance', () => configureCloudflare(context, () => GuestReaderPanel.current?.refresh())),
    vscode.commands.registerCommand('linuxdoGuest.clearCloudflareClearance', () => clearCloudflare(context)),
    provider.changeEmitter
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  LinuxDoApi,
  CdpClient,
  extractClearance,
  filterGuestCookieHeader,
  findChromiumExecutable,
  isLinuxDoUrl,
  isOwnedTemporaryProfile,
  validateClearanceInput,
  validateGuestCookieInput,
  validateUserAgent
};
