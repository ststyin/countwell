# 手机 PWA 与离线演示

Countwell 第一版是可安装的只读演示应用，内置账本全部为虚构数据。手机和电脑使用同一个应用，页面以 hash 路由切换。真实 GitHub 账本同步与网页记账尚未接入；离线演示不代表已经读取用户的 GitHub 仓库。

## 本地验证

先构建生产版本，再启动 preview。开发服务器不注册 Service Worker，避免旧缓存干扰代码修改。

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

打开 preview 地址，等待设置页出现“离线演示已就绪”（Service Worker 已激活并接管当前页面）；之后关闭网络并重新打开相同地址，仍可切换页面、月份和查看内置演示数据。首次尚未联网加载过的设备无法凭空获得演示账本。

PWA 安装需要 HTTPS，或本地开发使用 localhost／127.0.0.1。电脑上的 `127.0.0.1` 地址指向电脑本身，手机不能直接访问这个地址；在手机上验证独立窗口和安装体验时，需要部署到 HTTPS 域名。

- iPhone/iPad：通过浏览器分享菜单选择“添加到主屏幕”。不同浏览器、系统版本的安装入口可能不同。
- Android/Chromium：满足浏览器安装条件后，设置页面的安装按钮会调用原生安装提示。浏览器也可能在菜单或地址栏提供安装入口。
- 安装状态、离线提示和新版本提示均来自浏览器状态，不以按钮点击模拟安装成功。

## 缓存范围

`public/sw.js` 仅缓存应用入口、manifest、公开图标、离线提示页，以及 Vite 生成的 `/assets/` 静态资源。内置虚构账本被打包进演示资源，因此可以离线查看。

下列请求不会进入此缓存逻辑：第三方域名、GitHub API、带查询参数的请求、带 Authorization 头的请求、任意 JSON 数据、非 GET 请求。响应带 `Cache-Control: no-store` 时也不会写入应用缓存。

未来接入真实账本时，需要单独设计用户同意、数据过期、退出登录与清除离线数据的行为，不能把当前的公开静态资源缓存扩大为所有财务数据缓存。

## 更新方式

已打开页面不会被自动刷新。每个构建使用独立的缓存版本，安装时先完整保存入口 HTML 及它引用的静态资源；根导航优先使用这个完整版本的入口，避免新 HTML 和旧资源混用。浏览器存储被清除时可从网络恢复，但不会单独把新 HTML 写进旧版本缓存。

新 Service Worker 完整安装后，应用收到 `updateAvailable`；用户选择更新时，`applyUpdate()` 才发送 `SKIP_WAITING`，待新 worker 激活并接管后重新加载页面。

生产构建会根据入口和静态资源内容，自动把构建 hash 注入产物 `dist/sw.js` 的 `SHELL_VERSION`；修改应用内容并重新构建即可触发新的离线版本，不需要手动修改版本字符串。激活时只会清理 `countwell-shell-` 前缀的旧缓存，不删除其他应用的数据。

## 模块约定

- 入口文件调用 `registerPwa()` 一次；函数会去重注册并处理注册失败。
- React 组件调用 `usePwa()`，获得 `installAvailable`、`install()`、`updateAvailable`、`applyUpdate()`、`offline`、`offlineReady`、`isStandalone`、`installed`、`ios` 和 `registrationError`。
- `offlineReady` 仅在当前页面的 Service Worker controller 已激活时为 `true`，并随接管和状态变化更新；注册请求返回成功本身不代表离线资源已就绪。
- `install()` 返回 `accepted`、`dismissed` 或 `unavailable`。iOS 无安装提示事件时使用系统操作说明。
- 网站应在入口 HTML 引用 `/manifest.webmanifest`、`/icons/icon.svg` 和 `/icons/icon-192.png`（Apple touch icon），并设置 `viewport-fit=cover`、`theme-color`；布局需为设备安全区预留空间。

参考：[MDN 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[Service Worker 生命周期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)、[安装提示事件](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)。
