import { execFile } from 'node:child_process';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer as createTcpServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

// 本地夹具：按 Cloudflare 托管验证页的形状应答四个论坛的主机名，用来在隔离 IDE 里确定性地
// 复现“验证 → 放行”“没有验证特征的 403”“持续验证”三种情况。只经沙箱 JCEF 的 --proxy-server 访问。
export const FORUM_HOSTS = Object.freeze(['linux.do', 'idcflare.com', 'www.nodeseek.com', 'nodeseek.com', 'www.v2ex.com', 'v2ex.com']);
export const CLEARANCE_COOKIE = 'fx_clear';
export const CHALLENGE_PASS_MILLIS = 3_000;
export const LOOP_RELOAD_MILLIS = 2_000;

const SITE_NAMES = {
  'linux.do': 'LINUX DO', 'idcflare.com': 'IDC Flare',
  'www.nodeseek.com': 'NodeSeek', 'nodeseek.com': 'NodeSeek',
  'www.v2ex.com': 'V2EX', 'v2ex.com': 'V2EX'
};

// 主题编号或末段为 403 的地址模拟“需要登录的帖子”：直接 403，没有任何验证页特征。
export function isDenialPath(pathname) {
  return /(?:^|[/-])403(?:-1)?\/?$/.test(pathname);
}

export function fixtureResponse({ host, path, cookie = '' }) {
  const url = new URL(path, `https://${host}`);
  const site = SITE_NAMES[host] || host;
  const html = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (isDenialPath(url.pathname)) {
    return { kind: 'denied', status: 403, headers: html, body: page('Forbidden', '<p>需要登录才能查看。</p>') };
  }
  if (url.pathname === '/loop') {
    return { kind: 'loop', status: 403, headers: { ...html, 'cf-mitigated': 'challenge' }, body: challengePage(LOOP_RELOAD_MILLIS, false) };
  }
  const cleared = new RegExp(`(?:^|;\\s*)${CLEARANCE_COOKIE}=1(?:;|$)`).test(cookie);
  if (!cleared) {
    return { kind: 'challenge', status: 403, headers: { ...html, 'cf-mitigated': 'challenge' }, body: challengePage(CHALLENGE_PASS_MILLIS, true) };
  }
  return { kind: 'page', status: 200, headers: html, body: contentPage(`${url.pathname} - ${site}`) };
}

// 与真实验证页相同：内联脚本先把地址换成带 __cf_chl_rt_tk 的形式（保留原查询参数），随后恢复；
// 验证“通过”时写入放行 Cookie 再 location.reload()。
function challengePage(reloadAfterMillis, clears) {
  const script = '(function(){var search=location.search,original=location.pathname+search;'
    + "history.replaceState(null,null,original+(search?'&':'?')+'__cf_chl_rt_tk=fixture');"
    + 'setTimeout(function(){history.replaceState(null,null,original);},150);'
    + `setTimeout(function(){${clears ? `document.cookie='${CLEARANCE_COOKIE}=1; path=/';` : ''}location.reload();},${reloadAfterMillis});`
    + '})();';
  return page('Just a moment...', `<div class="container"><div class="main-content">Verifying you are human.</div></div><script>${script}</script>`);
}

// 放行后的页面同时带三种论坛的阅读根节点与内容节点，阅读布局在任一站点都能进入 stable。
function contentPage(title) {
  return page(title, '<div id="main-outlet"><table class="topic-list"><tbody><tr><td><a href="/t/topic/1">Fixture topic</a></td></tr></tbody></table>'
    + '<div id="topic-title"><h1>Fixture topic</h1></div><div class="topic-post"><div class="cooked"><p>Fixture body.</p></div></div></div>'
    + '<div id="Main"><div class="box"><div class="cell">Fixture V2EX topic.</div></div></div>'
    + '<div id="nsk-body"><div class="post-list-item">Fixture NodeSeek post.</div><div class="nsk-post">Fixture body.</div></div>');
}

function page(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

export async function generateCertificate(directory) {
  const key = resolve(directory, 'fixture-key.pem');
  const cert = resolve(directory, 'fixture-cert.pem');
  const names = FORUM_HOSTS.map(host => `DNS:${host}`).join(',');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '2', '-subj', '/CN=linux.do', '-addext', `subjectAltName=${names}`]);
  return { key, cert };
}

export async function startFixtureServer({ key, cert }) {
  const requests = [];
  const server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    const host = String(request.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    const reply = fixtureResponse({ host, path: request.url, cookie: request.headers.cookie });
    requests.push({ host, path: new URL(request.url, 'https://fixture').pathname, kind: reply.kind, status: reply.status });
    response.writeHead(reply.status, reply.headers);
    response.end(reply.body);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { port: server.address().port, requests, close: () => new Promise(done => server.close(done)) };
}

// 只隧道转发受支持论坛的 443 端口，其余主机一律 403，沙箱里的页面不会连到真实网络。
export async function startConnectProxy({ targetPort, hosts = FORUM_HOSTS }) {
  const allowed = new Set(hosts);
  const sockets = new Set();
  const server = createTcpServer(client => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    client.once('data', chunk => {
      const match = chunk.toString('latin1').match(/^CONNECT ([^:\s]+):(\d+) HTTP\/1\.[01]\r\n/);
      if (!match || !allowed.has(match[1].toLowerCase()) || match[2] !== '443') {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = connect(targetPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client);
        client.pipe(upstream);
      });
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.on('error', () => client.destroy());
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {
    port: server.address().port,
    close: () => new Promise(done => {
      sockets.forEach(socket => socket.destroy());
      server.close(done);
    })
  };
}
