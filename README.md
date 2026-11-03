# Countwell

Count well. Live well.

[在线演示](https://countwell-demo.0x1st.workers.dev) · 虚构账本 · PWA

以月度收支为中心的个人财务工具。主应用与加载服务使用 TypeScript，真实账本由官方 Beancount v3 完整加载与校验。支持本地、GitHub、WebDAV、多文件 include、手机与电脑布局和 PWA；内置虚构 demo 可直接体验。

## 安装与运行

需要 Node.js 22.12+、Python 3.10+。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run build
npm start
```

打开 `http://127.0.0.1:4173/#settings`，在 **连接真实账本** 中选择数据源并填写入口文件。开发使用 `npm run dev`，地址为 `http://127.0.0.1:5173/`。两个命令均提供同源的网页与账本加载接口。

| 来源 | 如何填写 |
| --- | --- |
| 本地 | 保留原有账本目录，填写 `/你的/账本/main.beancount` 或 `~/ledger/main.beancount` |
| GitHub | `owner/repository`、可选 ref、相对仓库根目录的入口路径；私库需要只读 Contents token |
| WebDAV | 完整目录树的 HTTPS 根 URL、入口相对路径、Basic 或 Bearer 凭证 |

本地 include 可跨多个原有目录。GitHub 固定一次 commit 后获取完整树；WebDAV 以 Depth:1 递归物化完整根目录树。远程 include 支持兄弟目录、嵌套和 glob，但必须位于所选远程根目录内。

第一次可用 `examples/multi-file-ledger/books/main.beancount` 验证跨目录加载，该示例是虚构数据。完整操作、远程限额、权限和部署范围见 [数据源说明](docs/DATA_SOURCES.md)。

## 使用流程

1. 进入设置，选择数据源，填写入口。
2. 账本中有可信 Python 插件时，明确勾选信任选项；默认拒绝执行插件。
3. 点击“连接并校验账本”。官方引擎执行 include、金额补全、批次匹配和最终校验。
4. 成功后，所有页面切换为真实快照，显示来源、文件数、版本与加载时间。
5. 修改文件后点击“重新读取”。失败会显示文件与行号，并保留上次成功快照，不展示部分账本。

原文查看可切换已加载的多个文件，导出 ZIP 保留它们的相对目录结构。导出不含附件、插件程序或连接凭证。整个流程不修改原始账本。

## 功能

- 自然月或自定义账单周期的收入、净支出、结余、分类、每日趋势和前期比较。
- 首页直接显示现金与存款、待还款和净资产。
- 交易搜索、账户／类型／待核对筛选、分页与完整复式分录。
- 持仓保留官方已匹配的成本批次、日期、标签与直接报价。
- 账户显示全部账本余额与最新报价，不受账单月限制；账户明细可查看全部时间。
- 逐币种计算，不混加单位；无法可靠汇总的成本或价格收支显示不可用。
- 深浅主题、全局金额隐藏、手机底部导航和安全区适配。
- PWA 安装与应用壳离线能力。虚构 demo 可离线查看；真实数据仅在当前页面内存中保留，离线刷新需重新连接后端。

在「设置 → 账单周期」分别选择开始日和结束日，默认 1 日至 1 日为自然月。结束日不计入本期，例如 25 日至 25 日的 11 月统计 10 月 25 日至 11 月 24 日。起止日不同时相邻周期可能重叠或存在空档，短月份取月末。周期偏好保存在当前浏览器。

## 账本与隐私

账本保持为 Beancount 文本，不存入财务数据库。本地直接只读加载；远程文件仅暂存于私有临时目录，完成后清理。金额使用十进制字符串与 decimal.js；页面常规金额显示两位小数，分录详情保留加载精度。

配置和需要保存的凭证位于 `.countwell/source.json`，权限 0600，目录权限 0700，已排除 Git。接口不会回显 token／密码，财务接口使用同源会话 token 并返回 no-store；真实数据不会进入构建资源、localStorage 或 PWA 缓存。

插件会执行代码，拥有运行服务的用户权限，只应为可信账本启用。加密文件需先解密。加载使用官方 v3 无缓存内部入口；升级 Beancount 后应运行回归测试。

`COUNTWELL_PYTHON` 可指定引擎 Python，`COUNTWELL_CONFIG_DIR` 可修改私有配置目录，`COUNTWELL_PORT` 可调整本机端口。本地路径指运行加载服务的电脑，不是手机上的目录。

## 验证

```sh
npm test
npm run build
```

测试覆盖真实官方引擎、多目录 include、GitHub/WebDAV 回环 HTTP、凭证与目录保护、财务口径和 PWA。详情见 [验证记录](docs/VALIDATION.md)。

## Cloudflare

演示版已部署到 Workers Static Assets，包含界面、PWA 和内置虚构账本。

`npm run deploy:check` 验证静态构建，`npm run deploy` 可将前端与虚构 demo 发布到 Workers Static Assets。**纯静态部署不包含 Node/Python 加载服务，不能读取电脑上的本地路径。**

若需在云端即时读取 GitHub／WebDAV 原始文件，需要带 Python 的后端及访问控制，例如 Cloudflare Containers。本机加载服务仅监听 127.0.0.1，请勿直接无认证暴露到公网。PWA 更新与缓存见 [docs/PWA.md](docs/PWA.md)。

私有 GitHub 账本支持通过 GitHub Actions 在提交后自动校验、更新受保护 Worker 快照，无需本机开机、云端 Python 服务或财务数据库。使用独立的私有 Worker、GitHub 登录与服务器端快照文件，配置步骤见 [私有云账本](docs/PRIVATE_CLOUD.md)。
