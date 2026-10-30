import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../pycharm/src/main/${path}`, import.meta.url), 'utf8');
const factorySource = await read('java/studio/lexiao/linuxdo/LinuxDoToolWindowFactory.java');
const breakOverlay = await read('resources/break-overlay.js');

function methodBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start > 0, `${signature} must exist`);
  return source.slice(start, start + source.slice(start).indexOf('\n        }'));
}

// 休息遮罩靠一次假导航把按钮动作交回 Java。地址写死成 linux.do 时，在其它论坛上
// 这次导航会被导航守卫当成站外链接拦下，“继续”和“稍后提醒”就失灵了。
test('break overlay posts actions to the current forum, not a fixed host', () => {
  assert.ok(breakOverlay.includes('__LEXIAO_BREAK_BASE__'));
  assert.ok(!breakOverlay.includes('linux.do'));
  assert.match(factorySource, /replace\("__LEXIAO_BREAK_BASE__", jsString\(siteFor\(url\)\.origin\(\) \+ BREAK_ACTION_PATH\)\)/);
});

test('the challenge timeout comes from the forum being verified', () => {
  const handler = methodBody(factorySource, 'private void handleChallengeResponse');
  assert.match(handler, /documentLoadState\.challengeReceived\(System\.nanoTime\(\), siteFor\(cefBrowser\.getURL\(\)\)\.challengeTimeoutMillis\(\)\)/);
  const watchdog = methodBody(factorySource, 'private void handleChallengeTimeout');
  assert.match(watchdog, /documentLoadState\.challengeRemainingMillis\(System\.nanoTime\(\)\)/);
  assert.match(watchdog, /challengeTimer\.setInitialDelay\(remaining\)/);
});

test('automatic challenge navigation keeps the deadline and generic settle cannot clear verification', () => {
  const navigation = methodBody(factorySource, 'public boolean onBeforeBrowse');
  assert.ok(!navigation.includes('challengeTimer.stop()'));
  assert.match(navigation, /if \(documentLoadState\.isChallengeActive\(\)\) \{[^}]*return false;/);
  assert.match(methodBody(factorySource, 'private void handleSettleTimeout'), /documentLoadState\.isChallengeActive\(\)\) return;/);
  assert.match(factorySource, /if \(demoMode && !documentLoadState\.isChallengeActive\(\)\) applyLoadingPrivacyStyle/);
});

test('the automatic deadline preserves the live challenge and offers explicit retry and stop actions', () => {
  const watchdog = methodBody(factorySource, 'private void handleChallengeTimeout');
  assert.match(watchdog, /documentLoadState\.requestChallengeInteraction\(\)/);
  assert.ok(!watchdog.includes('showLoadFailure('));
  const notice = methodBody(factorySource, 'private JPanel createChallengeNotice');
  assert.match(notice, /reloadCurrentPage\(\)/);
  assert.match(notice, /showLoadFailure\("已停止站点验证"/);
  assert.match(factorySource, /pageArea\.add\(createChallengeNotice\(\), BorderLayout\.NORTH\)/);
});

// JCEF 的 Cookie 库全 IDE 共用：清理必须覆盖所有论坛（含 .linux.do 这类域 Cookie），
// 但绝不能整库清空，把其它功能的登录状态一起删掉。
test('guest cleanup sweeps every forum and never wipes the shared cookie store', () => {
  assert.ok(!factorySource.includes('"linux.do'), 'forum hosts belong in ForumSite');
  assert.ok(!/deleteCookies\(\s*null/.test(factorySource), 'never delete every cookie in the IDE');
  assert.match(methodBody(factorySource, 'private void clearForumCookies'), /GuestSessionCleanup\.clearForumCookies\(store\)/);
  assert.match(methodBody(factorySource, 'public void dispose()'), /for \(ForumSite site : ForumSite\.values\(\)\)/);
});

// NodeSeek 需要登录的帖子直接回 403。把它当成 Cloudflare 验证会让用户白等一个超时；
// 但验证页的标题和 __cf_chl_ 地址可能晚于加载结束才到，所以先等一小会儿再判定。
test('a 403 without challenge markers is reported instead of awaited', () => {
  const denied = methodBody(factorySource, 'private void checkDenialAfterSettling');
  assert.match(denied, /navigation != mainFrameNavigations/, 'a later navigation cancels the pending verdict');
  assert.match(denied, /challengeDocument \|\| ForumSite\.isChallengeTitle\(currentPageTitle\)\) \{\s*handleChallengeResponse/);
  assert.match(denied, /HTTP 403：站点拒绝了游客访问/);
  assert.ok(!denied.includes('stopLoad'));
  assert.match(factorySource, /DENIAL_CHECK_MILLIS = 1_500/);
});

// 16.2 为了读 cf-mitigated 给每个主框架导航挂了响应观察器。挂上后 CEF 改走拦截通道转发导航，
// linux.do 的 Cloudflare 在 A/B 实测中每次都要求验证、也不承认刚下发的 cf_clearance；去掉后直接放行。
test('main-frame navigations are not routed through a resource request handler', () => {
  const handler = methodBody(factorySource, 'public CefResourceRequestHandler getResourceRequestHandler');
  assert.match(handler, /return ForumSite\.isAuthenticationWrite\(request\.getMethod\(\), request\.getURL\(\)\) \? authenticationBlocker : null;/);
  assert.ok(!handler.includes('isNavigation &&'), 'navigations must use the default network path');
  assert.ok(!factorySource.includes('onResourceResponse'));
});

// CEF 对 POST 结果页的 reload() 是空操作；CefBrowser.loadURL 在浏览器创建前会被丢掉。
test('refresh, retry and navigation load a clean URL through the deferred loader', () => {
  assert.ok(!/\.reload\(\)/.test(factorySource), 'reload() silently does nothing on POST results');
  assert.ok(!factorySource.includes('getCefBrowser().loadURL'), 'navigation before browser creation is dropped');
  assert.match(methodBody(factorySource, 'private void loadCleanUrl'), /browser\.loadURL\(ForumSite\.reloadUrl\(url\)\)/);
  assert.match(methodBody(factorySource, 'private void reloadCurrentPage'), /loadCleanUrl\(url\)/);
  assert.match(methodBody(factorySource, 'private void navigateTo'), /loadCleanUrl\(url\)/);
  const navigation = methodBody(factorySource, 'public boolean onBeforeBrowse');
  const challengeBranch = navigation.slice(navigation.indexOf('if (documentLoadState.isChallengeActive())'));
  assert.ok(!challengeBranch.slice(0, challengeBranch.indexOf('return false;')).includes('lastRequestedUrl'),
    "an automatic challenge reload must not replace the user's target URL");
});

test('encrypted sharing is offered on every forum', () => {
  assert.ok(!factorySource.includes('暂仅支持 LINUX DO'));
  assert.match(methodBody(factorySource, 'private void updateNavigationState'), /ShareCode\.fromTopicUrl\(currentUrl, safeCurrentTitle\(\)\) != null/);
});
