# 多论坛测试与链路联调记录

日期：2026-10-08。环境：macOS arm64，当前未提交工作树。范围：PyCharm 的 LINUX DO、NodeSeek、V2EX、IDC Flare，以及 VS Code 原功能回归。

**结论：自动化与构建检查通过，真实网页端到端验收尚未完成。** 本记录不是发布门禁通过记录，也不将既有 `runs/` 中的历史结果视为本次结果。

## 已通过

| 检查 | 结果 | 验证范围 |
| --- | --- | --- |
| VS Code `npm run check` | 115/115 | 语法、共享资源、请求会话、缓存、图片代理、历史收藏、加密分享、游戏 |
| QA `npm run check` | 49/49；37 条用例、14 份已有记录结构校验通过 | 阅读布局状态机、页面探针、论坛集成约束、隔离环境、包元数据与 runner |
| PyCharm 2022.3.3 | 10/10 Java 测试类 | 针对该 SDK 编译并在该 IDE 自带 Java 上运行；不是完整 IDE GUI 验收 |
| PyCharm 2024.2.6 | 10/10 Java 测试类 | 同上 |
| PyCharm 2026.1.4 | 10/10 Java 测试类，打包通过 | 使用本机 SDK 完成最终候选包构建 |
| PyCharm 2026.2.2 | 10/10 Java 测试类，打包通过 | 包含新版独立 JCEF 库目录；隔离 IDE 日志确认插件被发现并加载 |
| 收藏夹原生组件 | 亮暗主题矩阵通过 | 320/480/760 宽、30 个目录、大字体、空状态、表单、搜索、回调、滚动与数据往返；抽查亮色 760 和暗色 320 截图 |
| 候选包资源一致性 | 通过 | ForumSite 类、6 份站点 CSS、阅读脚本及其他非描述符资源与当前源码一致 |
| 候选包负向校验 | 3/3 | 旧 16.0 包、缺失 V2EX CSS、过期 V2EX CSS 均被拒绝 |

新增跨论坛链路测试直接调用生产实现：四站使用相同数字主题 ID，依次完成 URL 规范化 → 历史记录 → 收藏 → 分页/别名链接去重 → 序列化/恢复 → 站点名搜索 → 校验重新打开地址。最终保留四个不同主题；按 NodeSeek 原始分页链接移除收藏只影响该站收藏，不影响历史。

## 本次修复

1. **游客导航放行带凭据 URL。** 新增测试先复现 `https://guest:secret@论坛域名/` 被放行；现在四站统一拒绝带凭据地址与非 HTTP(S) 协议，正常游客导航和原有 HTTP 兼容性保留。
2. **旧包会通过版本元数据检查。** `dist` 中已发布的 16.0 不包含 ForumSite 和站点 CSS。增加 `verify-package.sh <ZIP> --source`，本地构建及 CI 新包检查自动执行；旧发布包基础完整性检查仍可单独使用。
3. **2026.2 本地构建找不到 JCEF。** 该 SDK 已将相关库移动到 `plugins/jcef-plugin`。构建脚本自动追加其库目录，已在 2026.1 与 2026.2 完成打包验证。

## 实际联网结果与剩余项

使用全新、无论坛凭据的 HTTP 请求，通过本机已有系统代理检查公开页面；直接网络连接超时。以下 HTTP 结果不代表内嵌 JCEF 页面交互已通过。

| 论坛 | 实测结果 | 结论 |
| --- | --- | --- |
| LINUX DO | `/latest` 返回 403，页面为 Cloudflare `Just a moment...` | 公开正文阅读受验证页阻挡 |
| NodeSeek | `/` 返回 403，页面为 Cloudflare `Just a moment...` | 同上 |
| IDC Flare | `/latest` 返回 403，页面为 Cloudflare `Just a moment...` | 同上 |
| V2EX | 首页、公开主题、`/planes` 均为 200；公开 HTML 包含配置使用的内容结构 | HTTP 导航及页面结构检查通过 |
| V2EX 登录墙 | `/go/chamber` 返回 302，目标为 `/signin` | 与游客拦截规则一致；未登录或绕过 |

仍需在真实工具窗口验收 PYC-014～017：菜单切站、网页跨站链接、四站正文与分页、挑战完成后的恢复、登录墙错误页、小游戏按钮、重启后的站点恢复、升级/回退。隔离 IDE 启动检查未获得完整 GUI 操作证据；尝试的临时类加载探针未运行到输出结果，不计为通过。Windows 未执行，2026.3 也未执行。

## 交付与复现

最终候选包：`pycharm/build/distributions/linuxdo-guest-browser-pycharm-16.0.zip`。

SHA-256：`ad1ccb6ea409ad136aa61580cf5b2bf4b4351aef6d3cf9bdfbd56ea175177999`。

候选包仍使用源码声明的 16.0 版本号，内容与 `dist` 的旧 16.0 不同。本次未替换旧发布包、提交代码或发布新版本。

从 `linuxdo-guest-browser/` 执行：

```bash
npm --prefix vscode run check
npm --prefix qa run check
bash pycharm/scripts/build-local.sh
bash pycharm/scripts/verify-package.sh pycharm/build/distributions/linuxdo-guest-browser-pycharm-16.0.zip --source
python3 pycharm/scripts/verify-favorites-ui.py
```

通过 `PYCHARM_HOME` 可选择其他已安装 SDK。测试日志保存在本地忽略提交的 `qa/artifacts/multiforum-20261008/`；原生组件图片在 `pycharm/build/favorites-ui/screenshots/`。
