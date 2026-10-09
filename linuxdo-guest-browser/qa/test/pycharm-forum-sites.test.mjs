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
  assert.match(handler, /challengeTimer\.setInitialDelay\(challengeTimeoutMillis\);\s*challengeTimer\.restart\(\)/);
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
// 但只有确实读到了响应头才能这样判断，读不到时必须继续按验证页等待。
test('a 403 without a Cloudflare challenge header is reported instead of awaited', () => {
  const denied = methodBody(factorySource, 'private boolean deniedWithoutChallenge');
  assert.match(denied, /httpStatusCode == 403 && mitigated != null/);
  assert.match(factorySource, /mainFrameCfMitigated = headers\.isEmpty\(\) \? null : mitigated;/);
  assert.match(factorySource, /isChallengeStatus\(httpStatusCode\) && !deniedWithoutChallenge\(httpStatusCode\)/);
});
