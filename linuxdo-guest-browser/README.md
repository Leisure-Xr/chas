# LINUX DO Guest Browser

在 VS Code 和 PyCharm 中以游客身份浏览 [LINUX DO](https://linux.do/)。无需论坛账号，不保存登录凭据。

## 下载

- [VS Code 0.8.0](dist/linuxdo-guest-browser-vscode-0.8.0.vsix)
- [PyCharm 0.4.0](dist/linuxdo-guest-browser-pycharm-0.4.0.zip)

### VS Code

打开扩展面板，选择右上角菜单中的 `Install from VSIX...`，然后选择 VSIX 文件。

VS Code 版使用公开 Discourse JSON 接口，支持列表续页、主题续载、页面状态恢复和 Cloudflare 游客验证。验证后，公开接口请求会在同一个最小化的独立 Chromium 游客会话中执行；关闭阅读器时会话与临时数据会一并清理。扩展运行时没有第三方依赖。

### PyCharm

打开 `Settings > Plugins > gear icon > Install Plugin from Disk...`，选择 ZIP 文件并重启 PyCharm。不要解压 ZIP。

PyCharm 版使用内嵌 JCEF 浏览器，保留网页原生滚动和浏览历史。工具栏与 VS Code 版统一，提供最新、热门、分类、搜索、紧凑模式和刷新。插件会拦截登录、注册、OAuth 和会话写入，并在游客会话开始和结束时清理 `linux.do` Cookie。

### 休息提醒与小游戏

两个版本都提供默认关闭的休息提醒开关。开启后会随机等待 31–60 分钟，再显示可跳过或延后 10 分钟的休息提示。小游戏也可以随时打开，包括 2048、贪吃蛇、车道闪避、像素跳跃和扫雷；关闭游戏不会丢失当前阅读页面和滚动状态。

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
- 只持久化休息提醒开关，不记录游戏过程或使用时长。
- 不包含分析、遥测或广告代码。

本项目与 LINUX DO 官方无隶属关系。使用时请遵守站点服务条款和访问频率限制。
