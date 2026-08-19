# LINUX DO Guest Browser

在 VS Code 和 PyCharm 中以游客身份浏览 [LINUX DO](https://linux.do/)。无需论坛账号，不保存登录凭据。

## 下载

- [VS Code 0.9.0](dist/linuxdo-guest-browser-vscode-0.9.0.vsix)
- [PyCharm 0.5.0](dist/linuxdo-guest-browser-pycharm-0.5.0.zip)

### VS Code

打开扩展面板，选择右上角菜单中的 `Install from VSIX...`，然后选择 VSIX 文件。

VS Code 版使用公开 Discourse JSON 接口，支持列表续页、主题续载、页面状态恢复和 Cloudflare 游客验证。验证设置页支持手动填写 Cookie、User-Agent 与来源浏览器，也提供自动验证备用入口。参数通过浏览器内 `/latest.json` 校验后才会保存；验证后的公开请求始终在同一个最小化游客会话中执行。

### PyCharm

打开 `Settings > Plugins > gear icon > Install Plugin from Disk...`，选择 ZIP 文件并重启 PyCharm。不要解压 ZIP。

PyCharm 版使用内嵌 JCEF 浏览器，保留网页原生滚动和浏览历史。工具栏与 VS Code 版统一，提供最新、热门、分类、搜索、分享和刷新。启动清理 Cookie 期间点击导航也会保留最后一次请求，不再固定跳回最新页。

### 休息提醒与小游戏

两个版本都提供默认关闭的休息提醒开关。开启后会随机等待 31–60 分钟，再显示可跳过或延后 10 分钟的休息提示。五款小游戏支持倒计时、暂停、重新开始、屏幕控制和本地最高分；失焦时自动暂停，不含音效。

### 限时分享

主题工具栏可生成 10 分钟、1 小时、24 小时或 7 天有效的 `LDGS1` 分享码，另一个插件用户粘贴后即可打开同一公开主题。分享码仅包含主题编号、slug、标题和时间，不包含 Cookie、UA、列表状态或阅读历史。校验和用于发现误粘贴和篡改，不是加密或访问控制。

## 源码

- [`vscode/`](vscode/)：VS Code 扩展
- [`pycharm/`](pycharm/)：PyCharm 插件

## 构建

VS Code：

```bash
cd vscode
npm run check
npm run package
```

`npm run package` 会按需通过 `npx` 下载官方 VS Code 打包工具，不会在仓库中保存依赖目录。

PyCharm（macOS，使用已安装的 PyCharm SDK）：

```bash
cd pycharm
./scripts/build-local.sh
./scripts/verify-package.sh
```

可以通过 `PYCHARM_HOME` 指定其他 PyCharm 安装位置。

## 隐私

- 不要求或保存论坛账号、密码和登录令牌。
- VS Code 仅保存游客验证白名单 Cookie，使用 SecretStorage 加密存储。
- PyCharm 会清理其 JCEF 配置中的 `linux.do` Cookie，不影响系统浏览器。
- 只持久化休息提醒开关和五款游戏的最高分整数，不记录游戏过程或使用时长。
- 不包含分析、遥测或广告代码。

本项目与 LINUX DO 官方无隶属关系。使用时请遵守站点服务条款和访问频率限制。
