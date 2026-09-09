# IDE 兼容性测试工程

本目录用可执行 JavaScript 用例维护 VS Code 和 PyCharm 插件的兼容性测试。自动化负责版本与制品校验、隔离安装、稳定断言和报告生成；Cloudflare、JCEF 视觉行为等无法可靠无人值守的部分由同一 runner 引导人工确认。

## 环境

- Node.js 20 或更高版本。
- macOS 真实桌面，或带交互桌面的 Windows 实体机/虚拟机。
- 访问 VS Code、JetBrains 官方发布源以及 `linux.do` 的网络。
- 真实联网测试必须使用全新游客配置，不得使用论坛账号或把 Cookie、请求头、完整 User-Agent 放入证据。

## 常用命令

```bash
node qa/bin/qa.mjs validate
node qa/bin/qa.mjs resolve --target vscode-1.114
node qa/bin/qa.mjs provision --target vscode-1.114
node qa/bin/qa.mjs inspect --product vscode --ide "/Applications/Visual Studio Code.app"
node qa/bin/qa.mjs run --product vscode --target vscode-latest \
  --ide "/Applications/Visual Studio Code.app" --release 0.2.0 --mode all --interactive --launch
node qa/bin/qa.mjs report --release 0.2.0 --gate
```

`resolve` 只更新显式指定的目标；`--all` 也是一次显式的全量更新。官方元数据写入 `ide-lock.json`，下载后 `provision` 会计算 SHA-256 并补回锁文件。日常测试必须使用锁定版本，不会自动跟随最新版漂移。

下载默认优先使用系统 `curl` 的断点续传和失败重试；没有 `curl` 时回退到 Node 流式下载器。设置 `LINUXDO_QA_NODE_DOWNLOAD=1` 可以强制测试 Node 路径。中断后重新执行同一条 `provision` 命令即可继续部分文件。

## 用例维护

用例源码位于 `src/cases/`。每个用例必须有稳定 ID、产品、平台、P0/P1/P2 优先级、类型、能力标签、前置条件和最终预期。自动用例提供 `run()`；人工用例提供结构化步骤。修改后执行：

```bash
node qa/bin/qa.mjs docs
node qa/bin/qa.mjs validate
```

生成的 [测试用例目录](docs/test-cases.md) 和 [能力覆盖表](docs/coverage.md) 必须随代码提交。新功能必须增加或更新相关用例；仅修改生成文档不会通过校验。

## 结果和证据

结构化运行记录及发布摘要保存在 `runs/<release>/`。人工用例标记 PASS 时至少需要一个证据文件；runner 只把文件名、大小、外部 URL 占位和 SHA-256 写入记录。原始截图、录屏和脱敏日志放在忽略提交的 `qa/artifacts/`，随后作为 CI 或 Release 附件上传并把 URL 回填到运行记录。

runner 会记录工作树是否干净，并从隔离 IDE 日志中提取、脱敏与插件有关的错误摘要。候选发布门禁不接受脏工作树产生的运行记录，也不接受尚未上传到 HTTPS 附件地址的人工证据。runner 自己新增的 `qa/runs/` 结果不计为源码脏状态，多个矩阵目标可以连续执行后统一提交。

检测到 Cookie 请求头、`cf_clearance`、论坛会话、Authorization、Bearer token 或完整 User-Agent 的文本证据会被拒绝。FAIL、BLOCKED 和 SKIP 必须写明原因；缺少 Windows 节点、宿主系统无法启动旧 IDE、或站点挑战无法完成时只能记为 BLOCKED。

## 发布门禁

每个矩阵目标都必须在 macOS 和 Windows 上完成全部适用 P0/P1。`report --gate` 对未解析版本、未校验 IDE 下载文件、缺少运行记录、人工 PASS 无证据及任何未通过用例返回失败。提交级 CI 不访问 `linux.do`；联网矩阵只在候选发布阶段执行。

GitHub Actions 定义位于 `chas/.github/workflows/linuxdo-guest-browser-tests.yml`。提交任务运行确定性测试与打包；带 `release` 输入的手动任务执行已经提交的 macOS/Windows 矩阵门禁。
