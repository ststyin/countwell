# 手机 PWA 与离线演示

Countwell 第一版是可安装的只读演示应用，内置账本全部为虚构数据。手机和电脑使用同一个应用，页面以 hash 路由切换。真实 GitHub 账本同步与网页记账尚未接入；离线演示不代表已经读取用户的 GitHub 仓库。

## 本地验证

先构建生产版本，再启动 preview。开发服务器不注册 Service Worker，避免旧缓存干扰代码修改。

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

打开 preview 地址，等待 Service Worker 激活后刷新一次；之后关闭网络并重新打开相同地址，仍可切换页面、月份和查看内置演示数据。首次尚未联网加载过的设备无法凭空获得演示账本。

PWA 安装需要 HTTPS，或本地开发使用 localhost／127.0.0.1。电脑上的 `127.0.0.1` 地址指向电脑本身，手机不能直接访问这个地址；在手机上验证独立窗口和安装体验时，需要部署到 HTTPS 域名。

- iPhone/iPad：通过浏览器分享菜单选择“添加到主屏幕”。不同浏览器、系统版本的安装入口可能不同。
- Android/Chromium：满足浏览器安装条件后，设置页面的安装按钮会调用原生安装提示。浏览器也可能在菜单或地址栏提供安装入口。
- 安装状态、离线提示和新版本提示均来自浏览器状态，不以按钮点击模拟安装成功。

## 缓存范围

`public/sw.js` 仅缓存应用入口、manifest、公开图标、离线提示页，以及 Vite 生成的 `/assets/` 静态资源。内置虚构账本被打包进演示资源，因此可以离线查看。

下列请求不会进入此缓存逻辑：第三方域名、GitHub API、带查询参数的请求、带 Authorization 头的请求、任意 JSON 数据、非 GET 请求。响应带 `Cache-Control: no-store` 时也不会写入应用缓存。

未来接入真实账本时，需要单独设计用户同意、数据过期、退出登录与清除离线数据的行为，不能把当前的公开静态资源缓存扩大为所有财务数据缓存。

## 更新方式

已打开页面不会被自动刷新。新 Service Worker 安装完成后，应用收到 `updateAvailable`；用户选择更新时，`applyUpdate()` 才发送 `SKIP_WAITING`，待新 worker 接管后重新加载页面。

更新应用壳或发布新的构建时，需要同时更新 `public/sw.js` 的 `SHELL_VERSION`，或在构建流程中根据构建产物注入版本。激活时只会清理 `countwell-shell-` 前缀的旧缓存，不删除其他应用的数据。

## 模块约定

- 入口文件调用 `registerPwa()` 一次；函数会去重注册并处理注册失败。
- React 组件调用 `usePwa()`，获得 `installAvailable`、`install()`、`updateAvailable`、`applyUpdate()`、`offline`、`isStandalone`、`installed`、`ios` 和 `registrationError`。
- `install()` 返回 `accepted`、`dismissed` 或 `unavailable`。iOS 无安装提示事件时使用系统操作说明。
- 网站应在入口 HTML 引用 `/manifest.webmanifest`、`/icons/icon.svg` 和 `/icons/icon-192.png`（Apple touch icon），并设置 `viewport-fit=cover`、`theme-color`；布局需为设备安全区预留空间。

参考：[MDN 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[Service Worker 生命周期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)、[安装提示事件](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)。
