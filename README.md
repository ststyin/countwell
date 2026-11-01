# Countwell

一个以月度收支为中心的个人财务 **TypeScript demo**。手机优先，支持桌面布局和 PWA。所有展示数据均为虚构。

## 本机运行

需要 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run dev
```

打开终端打印的 `http://127.0.0.1:5173/`。默认展示 2026 年 10 月，可以切换月份和 CNY / USD。

验证生产版本与离线能力：

```sh
npm test
npm run build
npm run preview
```

打开 `http://127.0.0.1:4173/`。Service Worker 仅在生产构建注册；开发模式保持热更新。第一次联网打开并完成离线准备后，内置演示账本可离线浏览。PWA 安装入口在设置页；iPhone 在浏览器分享菜单中选择“添加到主屏幕”。手机实际安装应使用部署后的 HTTPS 地址，本机 127.0.0.1 地址只代表当前设备。

## 已实现

- 月度收入、净支出和结余；每日支出图、分类、上月比较和近期记录。
- 首页常驻现金与存款、待还款和净资产，余额不藏在深层菜单。
- 交易搜索、精确账户和类型筛选、待核对筛选、分页展开和原始复式分录。
- 账户余额及月度变化、信用卡待还或溢缴、按已有直接报价估值的投资持仓。
- 深浅色、全局隐藏金额、只读查看与下载 Beancount 文本。
- 手机底部导航、安全区、320px 至桌面适配、PWA 安装指南、离线应用壳和更新提醒。

## 数据与边界

`src/data/demo.beancount` 是数据来源，页面在本机从该文本计算，未使用财务数据库。金额计算使用 `decimal.js`，数据层保留十进制字符串；日常界面显示两位小数。收入转为日常正向表达，退款冲减支出，转账、还款和投资本金不计为消费，不跨币种加总。

样例本身通过官方 Beancount 3.2.3 校验。**当前 TypeScript 读取器是严格限定语法的演示读取器，不是完整 Beancount 引擎**：不支持 include、插件、自动补全、卖出批次匹配等，遇到未知语法会拒绝。没有开放真实账本导入，避免把不完整结果当成真实财务。生产接入应使用官方引擎生成标准快照，替换数据来源，保留现有展示与查询模块。

当前**没有连接 GitHub、登录或网页记账**。设置页会明确显示数据源未连接。GitHub 私有账本接入属于后续集成，网页写回属于第二阶段。未来原始账本继续保存在 GitHub，衍生报表可以重建。

浏览器只在 localStorage 保存界面偏好；PWA 缓存已打包的公开虚构 demo 和应用资源，不缓存 API、鉴权响应或任意 JSON。应用不加载外部字体或遥测。

## 项目结构

```text
src/data/          虚构的纯文本 Beancount 账本
src/domain/        演示读取器、精确计算、按月查询与类型
src/pages/         收支、交易、账户、偏好四个视图
src/components/    共享金额、图标与分录展示
src/pwa.ts         真实安装、离线和更新状态
public/sw.js      版本化的应用壳缓存
tests/            会计口径与数据边界回归
```

## Cloudflare

`npm run build` 生成静态 `dist/`，可部署到 Cloudflare Pages 或 Workers Static Assets。本仓库附带 `wrangler.jsonc`；在自己的 Cloudflare 账户中执行：

```sh
npm run build
npx wrangler deploy
```

这只会部署公开虚构 demo。连接私人账本前，需要先加入访问控制、服务器端 GitHub 授权和官方 Beancount 计算流程。请勿把真实私人账本直接打包进公开静态资源。

PWA 缓存与发布更新细节见 [docs/PWA.md](docs/PWA.md)。
