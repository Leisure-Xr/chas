# LINUX DO 游客阅读器

在 VS Code 中浏览 `linux.do` 的公开内容，无需登录。

## 功能

- 查看最新主题、热门主题和站点分类
- 搜索公开主题
- 可选的随机休息提醒（31–60 分钟），默认关闭
- 内置 2048、贪吃蛇、单道路闪避、像素跳跃和扫雷
- 五款游戏统一支持开始倒计时、暂停、重新开始、屏幕控制、失焦自动暂停和本地最高分
- 为当前公开主题生成 10 分钟至 7 天有效的跨插件分享码
- 在 VS Code 内阅读帖子
- 使用返回按钮或 `Alt+左箭头` 回到上一个列表、分类或搜索结果
- 返回时保留此前已加载的主题、帖子和滚动位置
- 首页、热门和分类列表滚动到底自动续页
- 长主题滚动到底自动续载，每批最多加载 20 条帖子
- 默认使用紧凑信息流，可从工具栏切换显示密度
- 在系统浏览器中打开原文或外部链接
- 不读取日常浏览器数据，仅加密保存游客验证白名单 Cookie；不保存账号、密码或登录令牌

## 遇到 Cloudflare 403

VS Code 版本不会启动、控制或读取任何外部浏览器。Cloudflare 验证在你自己的 Chrome、Edge 或 Brave 中完成，参数通过 VS Code 的验证设置页手动粘贴。扩展只发送公开 GET 请求，不会保存登录状态。

### Windows 获取参数

1. 在浏览器打开 `https://linux.do/latest`，完成 Cloudflare 验证；不要在隐私模式和普通窗口之间切换。
2. 按 `F12`（部分电脑需要 `Fn+F12`），打开 **Network / 网络**，勾选 Preserve log / 保留日志，然后刷新页面。
3. 推荐选择名称为 **`latest.json`**、类型为 `fetch`、响应类型为 `application/json` 的请求。不要选择图片、脚本、分析请求，也不要把 `/categories.json` 的标头与 `/latest.json` 的 Cookie 混用。
4. 打开 **Headers / 标头 → Request Headers / 请求标头**。复制完整的 `cookie:` 和 `user-agent:` 两行；若浏览器支持，右键请求选择 **Copy → Copy request headers**，可一次复制整个请求标头块。
5. 在 VS Code 执行 `LINUX DO: 设置 Cloudflare 验证`，把整个标头块粘贴到“请求标头”框，点击 **解析标头**。检查两个输入框，再点击 **保存并测试**。
6. 测试会请求公开的 `/latest.json`；成功后才保存参数。若站点暂时返回 403，可确认参数来自同一浏览器后点击 **仅保存**，稍后回阅读器刷新重试。

![Network 面板选择 latest.json](https://raw.githubusercontent.com/Leisure-Xr/chas/main/linuxdo-guest-browser/vscode/media/docs/cf-network-request.png)

![Request Headers 中复制 Cookie 与 User-Agent](https://raw.githubusercontent.com/Leisure-Xr/chas/main/linuxdo-guest-browser/vscode/media/docs/cf-request-headers.png)

### 为什么不同接口的标头不一样

`/latest.json`、`/categories.json`、主题 JSON 和主文档请求的 `Accept`、`Referer`、`sec-fetch-*`、缓存头可能不同，这是正常的。插件不要求你手动填写这些易变化的头，只需要同一次验证中的 `cookie` 与 `user-agent`；插件会自己生成公开 GET 请求的普通头。必须从 **Request Headers** 复制，不要从 Response Headers 复制，也不要从两个浏览器或两个时间点拼接。

### 手动填写与清除

- Cookie 输入框支持完整 Cookie 或仅 `cf_clearance=...`；解析时只保留 `cf_clearance`、`__cf_bm`、`__cfuvid`、`_cfuvid`、`_bypass_cache` 和未登录的 `_forum_session`。
- `_t`、`auth_token`、`remember_user_token`、Stripe 字段永远不会写入 SecretStorage；检测到登录令牌时会丢弃 `_forum_session`。
- 已保存值只显示“已保存”，不会回显原文；输入框留空表示保留原值。
- **清除 Cookie**、**清除 User-Agent**、**全部清除** 会立即删除对应 SecretStorage 参数；阅读器刷新后会重新显示 Cloudflare 提示。
- 参数只在 VS Code 的 SecretStorage 中保存，不创建临时浏览器配置目录，也不会读取日常浏览器数据。

## 使用

安装扩展后，点击活动栏中的 LINUX DO 图标，选择“最新主题”“热门主题”或“浏览分类”。也可以打开命令面板，执行 `LINUX DO: 打开游客阅读器`。

阅读器工具栏中的时钟按钮用于开启或关闭休息提醒，方格按钮可以随时打开小游戏。也可以在 VS Code 设置中搜索 `LINUX DO 休息提醒` 修改开关。提醒开启后会随机等待 31–60 分钟；选择“10 分钟后提醒”只会执行一次短暂延后。

打开主题后，工具栏分享按钮或命令 `LINUX DO: 分享当前主题` 可生成限时分享码并复制到剪贴板。使用 `LINUX DO: 打开临时分享码` 可从剪贴板读取或手动粘贴分享码。分享码不是加密链接，只用于校验内容完整性和插件内过期时间。

小游戏参考成熟开源项目的玩法与交互并采用独立实现，不下载外部代码、音效或素材；详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。插件只保存每款游戏的最高分整数，不保存进行中的游戏。

此扩展通过站点公开的 Discourse JSON 接口读取游客可见内容。站点临时不可用、限制公开接口或要求人机验证时，扩展会显示相应错误。

## 本地开发

1. 用 VS Code 打开本目录。
2. 按 `F5` 启动 Extension Development Host。
3. 执行 `npm run check` 做语法检查。
4. 执行 `npm run package`，通过 `npx` 按需使用官方打包工具生成 VSIX。

本项目与 LINUX DO 官方无隶属关系。请遵守站点服务条款和访问频率限制。
