// Cloudflare 验证流程的本地端到端回归：在隔离 PyCharm 中把四个论坛的主机名经 --proxy-server 引到本地夹具，
// 依次检查冷启动、验证后放行、没有验证特征的 403、持续验证与主题页分享入口，断言插件日志。
// 需要本机已安装 PyCharm 和 openssl；不访问真实论坛，也不碰日常 IDE 的配置与 cef_server。
//   node qa/scripts/verify-challenge-flow.mjs [--zip <plugin.zip>] [--ide /Applications/PyCharm.app] [--sites linuxdo,v2ex] [--keep]
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateCertificate, startConnectProxy, startFixtureServer } from '../src/challenge-fixture.mjs';
import { inspectPyCharm } from '../src/environment.mjs';
import { launchForumSandbox, stopForumSandbox } from '../src/forum-sandbox.mjs';
import { challengeRound, diagnosticUrl, findEntry, parsePluginLog, scriptOutputInChallenge } from '../src/plugin-log.mjs';
import { assertSafeContent } from '../src/security.mjs';

const SITES = [
  { id: 'linuxdo', home: 'https://linux.do/latest', denied: 'https://linux.do/t/topic/403', topic: 'https://linux.do/t/topic/1' },
  { id: 'idcflare', home: 'https://idcflare.com/latest', denied: 'https://idcflare.com/t/topic/403', topic: 'https://idcflare.com/t/topic/1' },
  { id: 'nodeseek', home: 'https://www.nodeseek.com/', denied: 'https://www.nodeseek.com/post-403-1', topic: 'https://www.nodeseek.com/post-1-1' },
  { id: 'v2ex', home: 'https://www.v2ex.com/?tab=all', denied: 'https://www.v2ex.com/t/403', topic: 'https://www.v2ex.com/t/1' }
];
const FORUM_PAGE = /^https:\/\/(?:linux\.do|idcflare\.com|www\.nodeseek\.com|www\.v2ex\.com)\//;

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const descriptor = await readFile(resolve(projectRoot, 'pycharm/src/main/resources/META-INF/plugin.xml'), 'utf8');
const version = /<version>([^<]+)<\/version>/.exec(descriptor)[1];
const artifact = resolve(option('zip', resolve(projectRoot, `dist/linuxdo-guest-browser-pycharm-${version}.zip`)));
const ide = await inspectPyCharm(option('ide', '/Applications/PyCharm.app'));
const wanted = option('sites', SITES.map(site => site.id).join(',')).split(',');
const sites = SITES.filter(site => wanted.includes(site.id));
const keep = argv.includes('--keep');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const output = resolve(projectRoot, 'qa/artifacts/challenge-flow', stamp);
const scratch = await mkdtemp(resolve(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'ldqa-challenge-'));

const results = [];
let sandbox = null;
let fixture = null;
let proxy = null;
let entries = [];
const dailyServer = await dailyCefServer();

try {
  const certificate = await generateCertificate(scratch);
  fixture = await startFixtureServer(certificate);
  proxy = await startConnectProxy({ targetPort: fixture.port });
  const debugPort = await freePort();
  sandbox = await launchForumSandbox({
    ide, artifact, root: resolve(scratch, 'ide'), site: sites[0].id, debugPort,
    jcefArgs: [`--proxy-server=http://127.0.0.1:${proxy.port}`, '--ignore-certificate-errors']
  });

  // 冷启动：插件自己的第一次导航必须发出（不再被丢弃），遇到验证页后放行并完成。
  const first = sites[0];
  await step(`${first.id}: 冷启动首个页面`, async () => {
    const requested = await waitFor(message => message === `JCEF navigation requested: ${diagnosticUrl(first.home)}`, 0, 120_000);
    await expectChallengePass(first.home, requested);
  });

  for (const [index, site] of sites.entries()) {
    if (index > 0) {
      await step(`${site.id}: 首页验证后放行`, async () => {
        const from = entries.length;
        await navigate(debugPort, site.home);
        await expectChallengePass(site.home, from);
      });
    }
    await step(`${site.id}: 没有验证特征的 403 显示拒绝访问`, async () => {
      const from = entries.length;
      await navigate(debugPort, site.denied);
      const failed = await waitFor(message => message.startsWith(`JCEF main frame failed: ${diagnosticUrl(site.denied)}, reason=HTTP 403`), from, 20_000);
      const challenged = findEntry(entries, message => message.startsWith(`JCEF challenge detected: ${diagnosticUrl(site.denied)}`), from);
      if (challenged >= 0 && challenged < failed) throw new Error('a plain 403 was treated as a challenge');
    });
    await step(`${site.id}: 持续验证时轮次递增`, async () => {
      const from = entries.length;
      await navigate(debugPort, `${new URL(site.home).origin}/loop`);
      await waitFor(message => message.startsWith(`JCEF challenge navigation GET, still awaiting verification: ${new URL(site.home).origin}/loop`)
        && challengeRound(message) >= 3, from, 30_000);
      if (index === 0) await waitFor(message => message.startsWith('JCEF challenge awaiting user interaction'), from, 40_000);
    });
    await step(`${site.id}: 主题页放行且可分享`, async () => {
      const from = entries.length;
      await navigate(debugPort, site.topic);
      await waitFor(message => message.startsWith(`JCEF document completed: ${diagnosticUrl(site.topic)}`), from, 30_000);
      await waitFor(message => message === `JCEF share available: ${diagnosticUrl(site.topic)}`, from, 10_000);
      await waitFor(message => message.startsWith('LEXIAO_READER_STATE {"reason":"stable"'), from, 15_000);
    });
  }

  await step('全程：验证页内没有插件脚本，也没有误报加载超时', async () => {
    await refresh();
    const leaked = scriptOutputInChallenge(entries);
    if (leaked.length) throw new Error(`plugin script ran in a challenge page: ${leaked[0].message.slice(0, 160)}`);
    if (findEntry(entries, message => message.startsWith('JCEF page script skipped in challenge document')) < 0) {
      throw new Error('no injection was skipped, so the challenge guard was never exercised');
    }
    if (findEntry(entries, message => message.includes('reason=加载超时')) >= 0) throw new Error('a load timed out');
  });
} catch (error) {
  results.push({ step: '运行', ok: false, detail: error.message });
} finally {
  await refresh().catch(() => {});
  await stopForumSandbox(sandbox, { remove: !keep }).catch(() => {});
  await proxy?.close().catch(() => {});
  await fixture?.close().catch(() => {});
  if (!keep) await rm(scratch, { recursive: true, force: true });
}

const after = await dailyCefServer();
if (dailyServer && after !== dailyServer) results.push({ step: '日常 IDE 的 cef_server 未受影响', ok: false, detail: `${dailyServer} -> ${after}` });
const summary = {
  plugin: { version, artifact: artifact.slice(projectRoot.length) },
  ide: { version: ide.version, build: ide.build },
  passed: results.every(result => result.ok),
  results,
  fixtureRequests: fixture?.requests.length ?? 0
};
const pluginLog = entries.map(entry => `${entry.time} ${entry.message}`).join('\n');
assertSafeContent(JSON.stringify(summary), 'challenge-flow summary');
assertSafeContent(pluginLog, 'challenge-flow plugin log');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(resolve(output, 'plugin.log'), `${pluginLog}\n`);
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.step}${result.ok ? ` (${result.seconds}s)` : `: ${result.detail}`}`);
console.log(`${summary.passed ? 'PASS' : 'FAIL'}: ${results.filter(result => result.ok).length}/${results.length}，记录在 ${output.slice(projectRoot.length)}`);
process.exit(summary.passed ? 0 : 1);

async function step(name, body) {
  const started = Date.now();
  try {
    await body();
    results.push({ step: name, ok: true, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    results.push({ step: name, ok: false, detail: error.message });
  }
}

async function refresh() {
  if (!sandbox) return;
  entries = parsePluginLog(await readFile(sandbox.logPath, 'utf8').catch(() => ''));
}

async function expectChallengePass(url, from) {
  const detected = await waitFor(message => message.startsWith(`JCEF challenge detected: ${diagnosticUrl(url)}`), from, 30_000);
  const passed = await waitFor(message => message.startsWith('JCEF challenge passed:'), detected, 30_000);
  await waitFor(message => message.startsWith(`JCEF document completed: ${diagnosticUrl(url)}`), passed, 15_000);
}

async function waitFor(predicate, from, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await refresh();
    const index = findEntry(entries, predicate, from);
    if (index >= 0) return index;
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s (last: ${entries.at(-1)?.message.slice(0, 120) ?? 'no plugin log'})`);
}

// 代替无法自动点击的界面操作：经 JCEF 调试端口让阅读器页面导航，与插件的 loadURL 一样是浏览器发起的导航。
async function navigate(port, url) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page' && FORUM_PAGE.test(target.url))
    || targets.find(target => target.type === 'page' && target.url === 'about:blank');
  if (!page) throw new Error('reader page not found on the JCEF debug port');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
  const reply = await new Promise(done => { socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id === 1) done(message); }; });
  socket.close();
  if (reply.error || reply.result?.errorText) throw new Error(`navigation to ${url} failed: ${JSON.stringify(reply.error || reply.result.errorText)}`);
}

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

// 日常 PyCharm 的进程外 JCEF 服务；回归前后 PID 必须一致。
async function dailyCefServer() {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await promisify(execFile)('pgrep', ['-f', 'cef_server --port']);
    return stdout.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}
