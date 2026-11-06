# 私有 GitHub 账本

公开演示与私有账本站点分别部署。私有版先验证 GitHub 登录，只允许账本仓库所有者的数字用户 ID；同名账号或其他 GitHub 用户不能读取账本。

原始 Beancount 文件保留在 GitHub。同步过程用官方引擎完整校验，再生成可重建的 JSON 快照文件，作为 Worker 后端模块发布。无需财务数据库，也不需要把本机 GitHub Token 交给 Worker。快照不进入网页静态资源、Git 提交或 PWA 缓存。

## 首次同步

先按 README 安装 Node.js、Python 和官方 Beancount；确认 `gh` 已登录并有私有账本仓库的读取权限。

```sh
npm run cloud:sync -- --repository owner/beancount --entry main.beancount --ref master --deploy
```

脚本只读克隆目录，保留 include 结构，用官方引擎校验并关闭自定义插件。成功后构建独立的 `dist-private/`，发布 `wrangler.private.json` 中的 Worker。校验失败不发布部分账本；临时克隆会清理。

来源配置、快照和实际部署地址位于已排除 Git 的 `.countwell/cloud/`，目录权限 0700，文件权限 0600。首次部署没有完整登录配置时，财务接口一律返回 401。

## GitHub 登录

Worker 需要三个 Secret：

| 名称 | 来源 |
| --- | --- |
| `SESSION_SECRET` | 随机生成、至少 32 字节的会话签名密钥 |
| `GITHUB_CLIENT_ID` | 自己创建的 GitHub OAuth 应用 |
| `GITHUB_CLIENT_SECRET` | 该 OAuth 应用生成的 Client Secret |

通过 `wrangler secret put NAME --config wrangler.private.json` 设置，不要把值写进 Wrangler 配置、前端变量或仓库。

在 [GitHub OAuth 应用设置](https://github.com/settings/applications/new) 创建应用，Homepage URL 使用实际部署地址，Authorization callback URL 使用同一地址下的 `/api/auth/github/callback`。实际地址也可在 `.countwell/cloud/deployment.json` 查看。应用描述是 `Count well. Live well.`。

登录只申请 `read:user`，用于识别用户，不申请私有仓库权限。同步脚本通过仓库所有者 ID 设置 `GITHUB_ALLOWED_USER_ID`；已有来源若发生所有者变化会停止同步。

## 提交后自动更新

自动工作流安装在账本私有仓库中，监听默认分支提交。GitHub 托管环境使用官方引擎完整校验、生成私有快照并构建界面，成功后更新已有私有 Worker。电脑无需开机。

首次安装默认跟随 Countwell 的 `main` 分支：

```sh
npm run cloud:auto:install -- --app-ref main --account-id <Cloudflare账号ID>
```

安装器沿用 `.countwell/cloud/source.json` 中的来源与固定账号 ID，仅添加 `.github/workflows/countwell-sync.yml`，不修改账本原文或其他工作流。首次只开放手动验证；在 Actions 的 Run workflow 中选择 `validate_only=true` 可以先验证读取、校验和构建。

为 CI 创建专用的 Cloudflare Account API Token，授予已有私有 Worker 的 **Editor** 权限，并将资源范围限定为该 Worker。在账本私库的 `Settings → Secrets and variables → Actions → New repository secret` 中，将它保存为 `CLOUDFLARE_API_TOKEN`；应保存到账本仓库，而非 Countwell 应用仓库。无需将本机 Cloudflare OAuth 凭证、GitHub PAT 或站点的三个登录／会话 Secret 复制到 CI。

安装器负责配置非敏感仓库变量：

| 变量 | 用途 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 部署目标账号 |
| `COUNTWELL_ALLOWED_USER_ID` | 不随仓库转移改变的允许登录账号 |
| `COUNTWELL_LEDGER_ENTRY` | Beancount 入口相对路径 |
| `COUNTWELL_SITE_URL` | 发布后的登录保护检查 |
| `COUNTWELL_AUTO_SYNC_ENABLED` | 自动发布开关 |

凭证准备好后启用：

```sh
npm run cloud:auto:install -- --activate
```

启用会添加默认分支的 `push` 触发；之后提交账本即可更新网站。也支持手动 Run workflow。校验失败时不会执行发布，线上继续使用此前快照；生产任务串行运行，发布前再次检查分支 HEAD，过期任务不会覆盖新版本。

工作流只申请 GitHub `contents: read`。GitHub 临时 Token 只用于私库读取和版本检查，Cloudflare Token 只提供给发布步骤。依赖缓存只包含 npm／pip，不缓存或上传账本工作目录。官方 Actions 固定为完整提交 SHA；应用代码按配置跟随 `main` 或固定提交。

跟随 `main` 时，每次账本发布开始都读取最新主分支，运行测试和构建，并在任务日志与摘要记录实际使用的应用提交。发布前再次核对 `main`；构建期间若出现新提交，会停止本次发布，重新运行任务即可使用更新后的代码。Countwell 自身的提交仍只触发应用检查，网站发布由账本提交或手动 Run workflow 触发。

已有固定版本的安装可用以下命令切换；以后无需逐次修改版本号：

```sh
npm run cloud:auto:install -- --app-ref main --activate
```

若需固定应用版本，仍可使用 `--app-ref <完整提交SHA> --activate`。后续运行安装器时省略 `--app-ref` 会保留已保存的选择。

## 网页记账

已配置记账工作流和 Worker 的 `COUNTWELL_GITHUB_ACTIONS_TOKEN` 时，私有 GitHub 站点可以录入支出。工作流串行校验和提交账本，随后触发网站更新。首次更新记账功能时，请同时更新账本仓库中的 `countwell-record.yml` 和 `countwell-sync.yml`，让发布任务接收可选的 `request_id` 输入。先将应用代码推到所配置的应用版本，再在账本仓库的默认分支上一起提交两个工作流。

提交期间，在同一个标签页刷新或切回记账页会恢复查询。关闭标签页后，可以在同一个浏览器的「最近提交」查找最近 20 笔记录。浏览器仅保存提交编号、时间和上次查询状态。如果需要重新填写并重试，请填写同一笔支出，页面会继续使用原编号。如果页面显示“已入账，网站更新失败”，可以运行账本仓库中的 **Update Countwell private ledger** 重新发布。发布后可在交易页查看该笔支出。

## 手动更新

提交 Beancount 修改到 GitHub 后，在本机运行：

```sh
npm run cloud:sync -- --deploy
```

省略来源参数时沿用上次配置。此命令可用于手动发布；自动同步启用后，日常提交无需执行它。网页中的“刷新账本”读取最新已部署快照，不会在云端启动 Python 或拉取 GitHub。

登录后可在「设置 → 账本来源」核对当前界面的应用版本、已加载的账本版本和账本同步时间。安装的 PWA 可能仍在使用缓存的界面版本，看到更新提示后可在设置页更新。

## 访问与缓存

GitHub OAuth 使用 state 与 PKCE。成功后设置 8 小时的 Secure、HttpOnly 会话 Cookie；所有财务接口先验证身份与会话 token，变更请求还验证同源。财务响应均为 `no-store, private`。云端不提供修改数据源、执行插件或删除来源的接口。

PWA 缓存只包含公开应用壳，真实账本仅在已登录页面内存中展示。会话失效会清空页面中的账本；离线刷新需要重新连接并登录。原文查看与导出同样位于登录保护之后。

参考：[创建 OAuth 应用](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)、[授权 OAuth 应用](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[Cloudflare GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[Worker 级权限](https://developers.cloudflare.com/workers/authorization/workers/)。
