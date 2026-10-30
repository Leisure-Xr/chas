// 读取隔离 IDE 的 idea.log 中插件自己的诊断行（"LINUX DO …"），供验证流程脚本与测试断言使用。
const MARKER = 'LinuxDoToolWindowFactory - LINUX DO ';

export function parsePluginLog(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    const at = line.indexOf(MARKER);
    if (at >= 0) entries.push({ time: line.slice(0, 23), message: line.slice(at + MARKER.length) });
  }
  return entries;
}

export function findEntry(entries, predicate, from = 0) {
  for (let index = Math.max(0, from); index < entries.length; index += 1) {
    if (predicate(entries[index].message)) return index;
  }
  return -1;
}

// 插件日志里的地址只保留协议、主机和路径（diagnosticUrl），比较前按同样规则处理。
export function diagnosticUrl(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
}

// 验证页里不应出现任何插件脚本的输出。探针会把标题为 “Just a moment…” 或带 _cf_chl_opt.cType 的页面
// 标成 cfChallenge，所以只要出现这样的探针行，就说明有脚本被注入了验证页。
export function scriptOutputInChallenge(entries) {
  return entries.filter(entry => entry.message.startsWith('LEXIAO_PAGE_PROBE') && entry.message.includes('"cfChallenge":true'));
}

export function challengeRound(message) {
  const match = /, round=(\d+)$/.exec(message);
  return match ? Number(match[1]) : 0;
}
