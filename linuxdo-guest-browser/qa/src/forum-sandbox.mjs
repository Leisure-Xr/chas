import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractArchive } from './archive.mjs';
import { renderVmOptions } from './environment.mjs';
import { spawnDetached } from './process.mjs';

// 独立 config/system/plugins/logs 的 PyCharm：启动即打开阅读器工具窗口，并直接进入指定论坛。
// 默认用进程内 JCEF。进程外模式下，第二个 IDE 会尝试连接（甚至换缓存目录重启）日常 IDE 正在用的
// cef_server，因此只有在确认没有其它 PyCharm 运行时才能传 outOfProcess。
export async function launchForumSandbox({
  ide, artifact, root, site = 'linuxdo', debugPort = null, jcefArgs = [], vmOptions = [], outOfProcess = false
}) {
  await rm(root, { recursive: true, force: true });
  const dirs = Object.fromEntries(['config', 'system', 'plugins', 'logs', 'project', 'tmp']
    .map(name => [name, resolve(root, name)]));
  await Promise.all(Object.values(dirs).map(path => mkdir(path, { recursive: true })));
  await Promise.all([
    mkdir(resolve(dirs.config, 'options'), { recursive: true }),
    mkdir(resolve(dirs.config, 'workspace'), { recursive: true }),
    mkdir(resolve(dirs.project, '.idea'), { recursive: true })
  ]);
  await extractArchive(artifact, dirs.plugins);

  const options = resolve(dirs.config, 'options');
  await writeFile(resolve(options, 'proxy.settings.xml'),
    '<application>\n  <component name="HttpConfigurable">\n    <option name="USE_PROXY_PAC" value="true" />\n  </component>\n</application>\n');
  const siteKey = site === 'linuxdo' ? '' : `\n    "linuxdo.guest.site": "${site}"`;
  await writeFile(resolve(options, 'other.xml'),
    `<application>\n  <component name="PropertyService"><![CDATA[{\n  "keyToString": {${siteKey}\n  }\n}]]></component>\n</application>\n`);
  // macOS 的 /tmp 是 /private/tmp 的链接，IDE 可能按任一形式比对。
  const trusted = [dirs.project, ...(dirs.project.startsWith('/tmp/') ? [`/private${dirs.project}`] : [])];
  await writeFile(resolve(options, 'trusted-paths.xml'),
    '<application>\n  <component name="Trusted.Paths.Settings">\n    <option name="TRUSTED_PATHS">\n      <list>\n'
    + trusted.map(path => `        <option value="${path}" />\n`).join('')
    + '      </list>\n    </option>\n  </component>\n</application>\n');

  // 新项目里工具窗口默认隐藏：预置项目 ID 和窗口布局，阅读器启动即可见并自动导航。
  const projectId = [...randomBytes(27)].map(byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[byte % 62]).join('');
  await writeFile(resolve(dirs.project, '.idea', 'workspace.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="ProjectId" id="${projectId}" />\n</project>\n`);
  await writeFile(resolve(dirs.config, 'workspace', `${projectId}.xml`),
    '<project version="4">\n  <component name="ToolWindowManager">\n    <layoutV2>\n'
    + '      <window_info active="true" anchor="right" id="LINUX DO" order="6" visible="true" weight="0.32" />\n'
    + '      <unified_weights right="0.32" />\n    </layoutV2>\n  </component>\n</project>\n');

  const extras = [
    '-Didea.trust.all.projects=true',
    '-Dide.show.tips.on.startup.default.value=false',
    '-Didea.initially.ask.config=never',
    ...(outOfProcess ? [] : ['-Dide.browser.jcef.out-of-process.enabled=false']),
    ...(debugPort ? [`-Dide.browser.jcef.debug.port=${debugPort}`] : []),
    ...(jcefArgs.length ? [`-Dide.browser.jcef.extra.args=${jcefArgs.join(',')}`] : []),
    ...vmOptions
  ];
  const properties = resolve(root, 'idea.properties');
  const vmOptionsPath = resolve(root, 'pycharm.vmoptions');
  // properties 文件里反斜杠是转义符，Windows 路径一律写成正斜杠。
  const propertyPath = value => value.replaceAll('\\', '/');
  await writeFile(properties, [
    `idea.config.path=${propertyPath(dirs.config)}`,
    `idea.system.path=${propertyPath(dirs.system)}`,
    `idea.plugins.path=${propertyPath(dirs.plugins)}`,
    `idea.log.path=${propertyPath(dirs.logs)}`,
    'ide.no.platform.update=true',
    ''
  ].join('\n'));
  await writeFile(vmOptionsPath, renderVmOptions(await readFile(ide.vmOptionsPath, 'utf8'), extras));
  const pid = await spawnDetached(ide.launcher, [dirs.project], {
    env: {
      ...process.env,
      TMPDIR: `${dirs.tmp}/`,
      [`${ide.envVarBaseName}_PROPERTIES`]: properties,
      [`${ide.envVarBaseName}_VM_OPTIONS`]: vmOptionsPath
    }
  });
  return { root, pid, logPath: resolve(dirs.logs, 'idea.log') };
}

export async function stopForumSandbox(sandbox, { remove = true } = {}) {
  if (!sandbox?.pid) return;
  const alive = () => {
    try {
      process.kill(sandbox.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (alive()) process.kill(sandbox.pid, 'SIGTERM');
  for (let waited = 0; waited < 20_000 && alive(); waited += 250) {
    await new Promise(done => setTimeout(done, 250));
  }
  if (alive()) process.kill(sandbox.pid, 'SIGKILL');
  // 沙箱里有本轮会话的 Cookie 库，不留在临时目录里。
  if (remove) await rm(sandbox.root, { recursive: true, force: true });
}
