# 0.3.0 未完成项

- `2026-09-12` 从当前 macOS 环境再次单次访问 `https://linux.do/latest.json`，20 秒内未建立响应并超时。IPv4 和 IPv6 直连均在 TCP 443 建连前超时，独立 Cloudflare/Google DoH 查询也被重置或超时；问题位于当前网络或 DNS 路径，不是插件返回的 HTTP/Cloudflare 错误。为避免反复请求站点，本轮未执行依赖在线主题的历史与收藏 GUI 验收。
- 同日应用内浏览器可以正常打开 `https://linux.do/latest` 和公开主题 `/t/topic/2891889`，证明站点本身可用；但系统授权服务不可用，无法启动并接管隔离的 VS Code/PyCharm GUI。桌面已有实例显示旧插件界面，为避免覆盖用户日常插件，未用其冒充 0.19.0/0.13.0 验收。
- 当前没有可交互 Windows 实体机或虚拟机。Windows 确定性测试由 GitHub Actions 执行，但真实 VS Code/PyCharm GUI 仍为 BLOCKED。
- macOS 已完成 VS Code 1.85.2、1.113.0、1.114.0、1.137.0，以及 PyCharm 2022.3.3、2024.2.6、2026.2.2 的最终安装包校验、隔离安装、真实启动和插件加载日志检查，全部为 CLEAN 且无失败。
- 历史 slug 回退、收藏目录增删改、主题去重、跨目录保存、序列化恢复和隐私过滤均有自动测试；需要人工视觉或站点交互的用例在 `summary.md` 中继续保持 BLOCKED，未伪报通过。
