# 连接真实账本

Countwell 的网页与加载服务使用 TypeScript；完整解析与校验由官方 Python Beancount v3 引擎执行。原始文件保持在本地目录、GitHub 或 WebDAV，不导入财务数据库。

## 安装与启动

需要 Node.js 22.12+、Python 3.10+。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run build
npm start
```

打开 `http://127.0.0.1:4173/#settings`，在“连接真实账本”中配置。开发时使用 `npm run dev`，地址为 `http://127.0.0.1:5173/`，同一进程提供 Vite 和账本接口。

如 Python 不在项目 `.venv` 中，设置 `COUNTWELL_PYTHON` 为已安装 requirements 的 Python 可执行文件。Windows 对应 `.venv/Scripts/python.exe`。

## 本地目录

输入已有账本的入口文件，例如 `/Users/yourname/ledger/main.beancount` 或 `~/ledger/main.beancount`。无需复制进 `src/data`，也不应把私人账本加入本项目的前端资源。

官方加载器处理相对、绝对、嵌套及通配符 include。例如：

```text
ledger/
  books/main.beancount
  common/accounts.beancount
  years/2026/index.bean
  years/2026/months/oct.bean
```

`books/main.beancount`：

```beancount
include "../common/*.beancount"
include "../years/2026/index.bean"
```

`years/2026/index.bean`：

```beancount
include "months/*.bean"
```

可先用仓库中的 `examples/multi-file-ledger/books/main.beancount` 验证此流程；该示例所有金额与账户均为虚构。本地路径指运行服务的电脑，不是打开网页的手机。

## GitHub

填写 `owner/repository`、可选分支／标签／commit、相对于仓库根目录的入口路径。分支留空时使用默认分支。私有仓库填写有该仓库 Contents 只读权限的 token。

每次读取先固定为一个 commit，再从该提交物化完整目录树，因此同次加载不会混用两个版本。多层目录、兄弟目录和 glob include 保留原样。加载成功后可看到提交号；“重新读取”会重新解析所选分支并获取新的提交。

目录树被截断时逐层获取；文件内容校验 Git blob SHA。不支持 Git 子模块、符号链接和 LFS 对象展开。凭证只发送到 GitHub 官方 API，不转发至响应中提供的其他地址。

## WebDAV

填写容纳完整账本目录树的根 URL、入口相对路径，以及 Basic 用户名／密码或 Bearer token。两种认证方式不能同时使用。

例如 URL 为 `https://dav.example.com/finance/`，入口为 `books/main.beancount`。所有 include 必须位于这棵根目录树内；需要兄弟目录时请把根 URL 设在它们的共同父目录。

通过 `PROPFIND Depth: 1` 递归枚举，再逐文件只读 GET，不依赖服务器支持 `Depth: infinity`。支持 Unicode 和空格路径。远程 URL 需要 HTTPS，本机测试允许 loopback HTTP；重定向、跨来源和超出根目录的文件会明确拒绝。

远程默认限额：2000 文件、1000 目录、64 MiB 文件总量、8 MiB 单文件、32 层目录、单次请求 20 秒、完整读取 120 秒。超过限额会停止整个加载，不展示截断账本。附件也在远程物化限额内，建议将账本树与大体积附件分别组织。

## 校验、插件与刷新

- 所有数据源都走官方完整加载、金额补全、批次匹配和最终校验；有错误不会展示部分结果。
- 插件默认不执行。确认账本与插件可信后，勾选“信任并允许账本中的 Python 插件”。插件拥有服务进程权限，Countwell 不是插件沙箱。
- 加密文件应先在本机解密，本流程不会自动调用解密程序。
- 修改源文件后点击“重新读取”。浏览器刷新仅获取加载服务中的快照，不隐式重新执行插件。
- 重新读取失败时保留上次成功快照，并显示失败原因、相对文件路径和行号。首次加载失败则不展示真实账本结果。
- 页面按币种独立计算。成本或价格使日常收支口径不可汇总时，明确显示不可用，原始完整分录仍可查看。

## 配置与隐私

默认配置位于 `.countwell/source.json`，包含源配置和需要持久化的凭证；目录权限 0700，文件权限 0600，已加入 `.gitignore`。接口返回配置时只返回“凭证已保存”的标记，不回显 token 或密码。修改源地址后需要重新输入凭证；同一来源可勾选复用已保存凭证。

可通过 `COUNTWELL_CONFIG_DIR` 更改配置目录，`COUNTWELL_PORT` 更改本机端口。删除连接（“使用演示账本”）会清除本机保存的当前连接配置。

加载服务只监听 127.0.0.1，校验 Host／Origin，财务快照及变更接口需要同源会话 token。所有 `/api/` 响应 no-store；真实数据不写入前端构建、localStorage 或 PWA 缓存。页面内存可保留上次成功快照，离线刷新则需要重新连接后端，不会悄悄用演示数字替代。

原文查看可切换所有已加载文件；导出多个文件时使用 ZIP 保留相对目录结构。附件、插件程序和连接凭证不包含在该导出中，原始文件不被修改。

## Cloudflare 部署范围

当前真实账本加载服务需要 Node.js + Python。`wrangler deploy` 的静态部署仍然只部署前端与虚构演示资源，不能读取浏览者电脑上的路径，也不能执行此官方 Python 引擎。远程使用需部署带 Python 的加载服务并加入访问控制，例如后续使用 Cloudflare Containers；不要将本机加载接口直接无认证暴露到公网。
