# 0.2.0 未完成项

- `2026-09-10` 从当前 macOS 环境对 `https://linux.do/latest.json` 执行一次游客探测，请求在 30 秒内未建立响应并超时。为避免重复访问站点，本轮未继续执行联网、Cloudflare 和动态内容用例。
- 当前没有可交互 Windows 实体机或虚拟机。Windows runner、用例选择和 CI portability 测试已实现，但 Windows 真实 IDE 安装、启动和 GUI 证据仍为 BLOCKED。
- macOS 已完成四个 VS Code 和三个 PyCharm 锁定版本的官方包校验、插件隔离安装、真实 IDE 启动、插件加载日志检查及确定性回归。视觉、历史持久化、游戏和跨 IDE 分享等人工引导用例尚未产生可审计证据，不能计为通过。

`summary.md` 中的 BLOCKED 是发布门禁的预期状态；补齐 Windows 和人工证据前，不应把完整声明范围描述为“已全部实测”。
