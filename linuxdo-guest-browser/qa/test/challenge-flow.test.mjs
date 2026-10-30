import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import test from 'node:test';
import { CLEARANCE_COOKIE, FORUM_HOSTS, fixtureResponse, isDenialPath, startConnectProxy } from '../src/challenge-fixture.mjs';
import { challengeRound, diagnosticUrl, findEntry, parsePluginLog, scriptOutputInChallenge } from '../src/plugin-log.mjs';

const forumSite = await readFile(new URL('../../pycharm/src/main/java/studio/lexiao/linuxdo/ForumSite.java', import.meta.url), 'utf8');

// 夹具的验证页必须被插件按真实规则认出来：标题与 ForumSite.CHALLENGE_TITLE 一致，地址参数以 __cf_chl_ 开头。
const pluginTitlePattern = (() => {
  const literal = /CHALLENGE_TITLE = Pattern\.compile\("((?:[^"\\]|\\.)*)"/.exec(forumSite)[1];
  return new RegExp(literal.replace(/\\\\/g, '\\'), 'i');
})();
const titleOf = body => /<title>([^<]*)<\/title>/.exec(body)[1];

test('the fixture serves a Cloudflare-shaped challenge until the clearance cookie is set', () => {
  for (const host of FORUM_HOSTS) {
    const challenge = fixtureResponse({ host, path: '/latest?order=created' });
    assert.equal(challenge.status, 403, host);
    assert.equal(challenge.headers['cf-mitigated'], 'challenge');
    assert.match(titleOf(challenge.body), pluginTitlePattern, 'the plugin must recognise the fixture title');
    assert.match(challenge.body, /__cf_chl_rt_tk=fixture/);
    assert.match(challenge.body, /search\?'&':'\?'/, 'existing query parameters are kept, as Cloudflare does');
    assert.match(challenge.body, new RegExp(`document\\.cookie='${CLEARANCE_COOKIE}=1; path=/'`));

    const cleared = fixtureResponse({ host, path: '/latest', cookie: `a=b; ${CLEARANCE_COOKIE}=1` });
    assert.equal(cleared.status, 200, host);
    assert.doesNotMatch(titleOf(cleared.body), pluginTitlePattern);
    for (const root of ['id="main-outlet"', 'class="topic-list"', 'id="Main"', 'class="box"', 'id="nsk-body"', 'class="post-list-item"']) {
      assert.ok(cleared.body.includes(root), `${host} page lacks ${root}`);
    }
  }
  assert.equal(fixtureResponse({ host: 'linux.do', path: '/latest', cookie: `${CLEARANCE_COOKIE}=10` }).kind, 'challenge');
});

test('denied pages are a plain 403 without any challenge marker', () => {
  const rows = [
    ['/t/topic/403', true], ['/post-403-1', true], ['/t/403', true], ['/t/403/', true],
    ['/t/topic/4031', false], ['/post-1403-1', false], ['/latest', false], ['/loop', false]
  ];
  for (const [path, denied] of rows) assert.equal(isDenialPath(path), denied, path);
  const denied = fixtureResponse({ host: 'www.nodeseek.com', path: '/post-403-1', cookie: `${CLEARANCE_COOKIE}=1` });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers['cf-mitigated'], undefined);
  assert.doesNotMatch(titleOf(denied.body), pluginTitlePattern);
  assert.doesNotMatch(denied.body, /__cf_chl_/);
});

test('the loop page keeps challenging and never grants clearance', () => {
  const loop = fixtureResponse({ host: 'idcflare.com', path: '/loop', cookie: `${CLEARANCE_COOKIE}=1` });
  assert.equal(loop.status, 403);
  assert.equal(loop.kind, 'loop');
  assert.match(titleOf(loop.body), pluginTitlePattern);
  assert.doesNotMatch(loop.body, /document\.cookie/);
  assert.match(loop.body, /location\.reload\(\)/);
});

async function exchange(port, request) {
  const socket = connect(port, '127.0.0.1');
  await new Promise(done => socket.once('connect', done));
  socket.write(request);
  return new Promise(done => socket.once('data', data => done({ socket, reply: data.toString('latin1') })));
}

test('the CONNECT proxy tunnels forum hosts on 443 only', async () => {
  const echo = createServer(socket => socket.on('data', data => socket.write(`echo:${data}`)));
  await new Promise(done => echo.listen(0, '127.0.0.1', done));
  const proxy = await startConnectProxy({ targetPort: echo.address().port });
  try {
    const tunnel = await exchange(proxy.port, 'CONNECT linux.do:443 HTTP/1.1\r\nHost: linux.do:443\r\n\r\n');
    assert.match(tunnel.reply, /^HTTP\/1\.1 200 /);
    tunnel.socket.write('ping');
    assert.equal(await new Promise(done => tunnel.socket.once('data', data => done(data.toString()))), 'echo:ping');
    tunnel.socket.destroy();
    for (const request of ['CONNECT example.com:443 HTTP/1.1\r\n\r\n', 'CONNECT linux.do:80 HTTP/1.1\r\n\r\n', 'GET http://linux.do/ HTTP/1.1\r\n\r\n']) {
      const refused = await exchange(proxy.port, request);
      assert.match(refused.reply, /^HTTP\/1\.1 403 /, request);
      refused.socket.destroy();
    }
  } finally {
    await proxy.close();
    await new Promise(done => echo.close(done));
  }
});

const SAMPLE_LOG = [
  '2026-10-31 00:43:31,867 [   2404]   INFO - #studio.lexiao.linuxdo.LinuxDoToolWindowFactory - LINUX DO JCEF navigation requested: https://linux.do/latest',
  '2026-10-31 00:43:32,001 [   2538]   INFO - #c.i.o.SomethingElse - unrelated line',
  '2026-10-31 00:43:32,243 [   2780]   INFO - #studio.lexiao.linuxdo.LinuxDoToolWindowFactory - LINUX DO JCEF challenge detected: https://linux.do/latest, trigger=title, round=1',
  '2026-10-31 00:43:32,300 [   2837]   INFO - #studio.lexiao.linuxdo.LinuxDoToolWindowFactory - LINUX DO JCEF page script skipped in challenge document: probe',
  '2026-10-31 00:43:35,267 [   5804]   INFO - #studio.lexiao.linuxdo.LinuxDoToolWindowFactory - LINUX DO JCEF challenge navigation GET, still awaiting verification: https://linux.do/latest, round=2',
  '2026-10-31 00:43:35,295 [   5832]   INFO - #studio.lexiao.linuxdo.LinuxDoToolWindowFactory - LINUX DO JCEF challenge passed: rounds=2, seconds=3',
  '2026-10-31 00:43:35,400 [   5937]   INFO - #studio.lexiao.linuxdo.LinuxDoToolWindowFactory - LINUX DO LEXIAO_PAGE_PROBE {"reason":"settled","cfChallenge":false}'
].join('\n');

test('plugin log lines are parsed and checked the way the flow script expects', () => {
  const entries = parsePluginLog(SAMPLE_LOG);
  assert.equal(entries.length, 6);
  assert.equal(entries[0].time, '2026-10-31 00:43:31,867');
  assert.equal(entries[0].message, 'JCEF navigation requested: https://linux.do/latest');
  assert.equal(findEntry(entries, message => message.startsWith('JCEF challenge passed')), 4);
  assert.equal(findEntry(entries, message => message.startsWith('JCEF challenge passed'), 5), -1);
  assert.equal(challengeRound(entries[3].message), 2);
  assert.equal(challengeRound(entries[4].message), 0);
  assert.deepEqual(scriptOutputInChallenge(entries), []);
  const leaked = parsePluginLog(`${SAMPLE_LOG}\nx LinuxDoToolWindowFactory - LINUX DO LEXIAO_PAGE_PROBE {"reason":"settled","cfChallenge":true}`);
  assert.equal(scriptOutputInChallenge(leaked).length, 1);
  assert.equal(diagnosticUrl('https://www.v2ex.com/?tab=all#reply'), 'https://www.v2ex.com/');
  assert.equal(diagnosticUrl('https://linux.do/t/topic/1?__cf_chl_rt_tk=x'), 'https://linux.do/t/topic/1');
});
