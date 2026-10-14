# IDE 兼容性测试工程

本目录用可执行 JavaScript 用例维护 VS Code 和 PyCharm 插件的兼容性测试。自动化负责版本与制品校验、隔离安装、稳定断言和报告生成；Cloudflare、JCEF 视觉行为等无法可靠无人值守的部分由同一 runner 引导人工确认。

## 环境

- Node.js 20 或更高版本。
- macOS 真实桌面，或带交互桌面的 Windows 实体机/虚拟机。
- 访问 VS Code、JetBrains 官方发布源以及 `linux.do` 的网络。
- 真实联网测试必须使用全新游客配置，不得使用论坛账号或把 Cookie、请求头、完整 User-Agent 放入证据。

首次运行先安装锁定的纯 Node ZIP 解析依赖：

```bash
npm --prefix qa ci
```

## 常用命令

```bash
node qa/bin/qa.mjs validate
node qa/bin/qa.mjs resolve --target vscode-1.114
node qa/bin/qa.mjs provision --target vscode-1.114
node qa/bin/qa.mjs inspect --product vscode --ide "/Applications/Visual Studio Code.app"
node qa/bin/qa.mjs run --product vscode --target vscode-latest \
  --ide "/Applications/Visual Studio Code.app" --release 0.3.0 --mode all --interactive --launch
node qa/bin/qa.mjs report --release 0.3.0 --gate
```

`resolve` 只更新显式指定的目标；`--all` 也是一次显式的全量更新。官方元数据写入 `ide-lock.json`，下载后 `provision` 会计算 SHA-256 并补回锁文件。日常测试必须使用锁定版本，不会自动跟随最新版漂移。

IDE 下载和安装保存在忽略提交的 `qa/.cache/`。每次 `run` 的 user-data、插件和日志使用系统临时目录下的短哈希路径，避免 macOS Unix socket 路径上限，也不会复用日常 IDE 状态。

下载默认优先使用系统 `curl` 的断点续传和失败重试；没有 `curl` 时回退到 Node 流式下载器。设置 `LINUXDO_QA_NODE_DOWNLOAD=1` 可以强制测试 Node 路径。中断后重新执行同一条 `provision` 命令即可继续部分文件。

## 用例维护

用例源码位于 `src/cases/`。每个用例必须有稳定 ID、产品、平台、P0/P1/P2 优先级、类型、能力标签、前置条件和最终预期。自动用例提供 `run()`；人工用例提供结构化步骤。修改后执行：

```bash
node qa/bin/qa.mjs docs
node qa/bin/qa.mjs validate
```

生成的 [测试用例目录](docs/test-cases.md) 和 [能力覆盖表](docs/coverage.md) 必须随代码提交。新功能必须增加或更新相关用例；仅修改生成文档不会通过校验。

### VS Code webview 可视检查

`fixtures/vscode-webview.html` 使用真实 `vscode/media/main.js` 和 `styles.css`，只模拟 VS Code 消息桥并注入公开主题、历史和收藏目录。它用于在不安装扩展、不触碰日常 IDE 配置时检查历史/收藏布局：

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

然后打开 `http://127.0.0.1:8765/qa/fixtures/vscode-webview.html`。夹具本身由 QA 单元测试检查必需控件、生产资源引用和敏感内容。

## 结果和证据

结构化运行记录及发布摘要保存在 `runs/<release>/`。人工用例标记 PASS 时至少需要一个证据文件；runner 只把文件名、大小、外部 URL 占位和 SHA-256 写入记录。原始截图、录屏和脱敏日志放在忽略提交的 `qa/artifacts/`，随后作为 CI 或 Release 附件上传并把 URL 回填到运行记录。

runner 会记录工作树是否干净，并从隔离 IDE 日志中提取、脱敏与插件有关的错误摘要。候选发布门禁不接受脏工作树产生的运行记录，也不接受尚未上传到 HTTPS 附件地址的人工证据。runner 自己新增的 `qa/runs/` 结果不计为源码脏状态，多个矩阵目标可以连续执行后统一提交。

检测到 Cookie 请求头、`cf_clearance`、论坛会话、Authorization、Bearer token 或完整 User-Agent 的文本证据会被拒绝。FAIL、BLOCKED 和 SKIP 必须写明原因；缺少 Windows 节点、宿主系统无法启动旧 IDE、或站点挑战无法完成时只能记为 BLOCKED。

## 发布门禁

每个矩阵目标都必须在 macOS 和 Windows 上完成全部适用 P0/P1。`report --gate` 对未解析版本、未校验 IDE 下载文件、缺少运行记录、人工 PASS 无证据及任何未通过用例返回失败。提交级 CI 不访问 `linux.do`；联网矩阵只在候选发布阶段执行。

GitHub Actions 定义位于 `chas/.github/workflows/linuxdo-guest-browser-tests.yml`。提交任务运行确定性测试与打包；带 `release` 输入的手动任务执行已经提交的 macOS/Windows 矩阵门禁。


## PyCharm 收藏夹原生面板检查

在 macOS 上使用已安装的 PyCharm 2026.1 SDK：

```bash
bash pycharm/scripts/build-local.sh
python3 pycharm/scripts/verify-favorites-ui.py
```

以上命令从 `linuxdo-guest-browser/` 执行。检查直接实例化正式 `FavoritesPanel`，加载 IDE 的亮暗主题，验证 320/480/760 宽度、长标题、30 个目录、大字体、空状态、表单校验、跨目录搜索、重命名/删除、打开/复制回调、滚动保持和数据格式往返。PNG 输出在 `pycharm/build/favorites-ui/screenshots/`。这些是原生组件离屏渲染，不是 HTML 原型，也不代替真实 IDE 的菜单焦点、系统剪贴板、网页导航和重启检查；对应手工用例为 `PYC-013`。

## 多论坛候选包校验

16.1 安装包包含多论坛支持、统一隐私布局和验证等待修复；旧 16.0 ZIP 保留用于回退。`npm test` 的安装包测试校验包结构与版本元数据，提交的 16.1 包及新构建还必须执行源码资源校验：

```bash
bash pycharm/scripts/build-local.sh
bash pycharm/scripts/verify-package.sh pycharm/build/distributions/linuxdo-guest-browser-pycharm-16.1.zip --source
```

本地构建脚本已自动执行第二步，CI 也对新生成的 ZIP 执行同样检查。检查要求包含 `ForumSite.class`，并逐字节核对全部非 `plugin.xml` 资源，包括六份站点 CSS、阅读脚本和名称资源；`plugin.xml` 由 Gradle 改写，因此其版本与构建范围继续由 QA 元数据检查负责。旧发布包仍可以不加 `--source` 做基础完整性校验。

本地构建同时兼容 2026.2 将 JCEF 拆分到 `plugins/jcef-plugin` 的 SDK 目录结构。

## 多论坛隐私排版检查

`fixtures/pycharm-reader.html` 加载正式阅读 CSS 和 JS，用三个论坛引擎的代表性结构模拟原站字体、固定列宽、嵌套 Markdown、长链接和宽表格。它是离线布局夹具，不等同于真实站点完整快照。

从 `linuxdo-guest-browser/` 启动 `python3 -m http.server 8765 --bind 127.0.0.1`，打开
`http://127.0.0.1:8765/qa/fixtures/pycharm-reader.html?site=v2ex&view=topic&scheme=dark`。
`site` 支持 `linuxdo/idcflare/nodeseek/v2ex`，`view` 支持 `list/topic`，`scheme` 支持 `light/dark`。

安装了 Playwright 的环境可运行 `node qa/scripts/verify-reader-layout.mjs`。也可通过 `PLAYWRIGHT_MODULE` 指定模块入口绝对路径，通过 `CHROME_BIN` 指定已安装 Chromium 浏览器。脚本使用独立的无头浏览器执行 48 个布局组合，检查字体、横向溢出、图片、代码、表格及关闭阅读布局后的恢复；截图和结果在 `qa/artifacts/reader-layout/`。
