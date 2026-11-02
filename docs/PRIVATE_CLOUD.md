# 私有 GitHub 账本

公开演示与私有账本站点分别部署。私有版先验证 GitHub 登录，只允许账本仓库所有者的数字用户 ID；同名账号或其他 GitHub 用户不能读取账本。

原始 Beancount 文件保留在 GitHub。本机用官方引擎完整校验，再生成可重建的 JSON 快照文件，作为 Worker 后端模块发布。无需财务数据库，也不需要把本机 GitHub Token 交给 Worker。快照不进入网页静态资源、Git 提交或 PWA 缓存。

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

## 更新账本

提交 Beancount 修改到 GitHub 后，在本机运行：

```sh
npm run cloud:sync -- --deploy
```

省略来源参数时沿用上次配置。网页中的“刷新账本”读取最新已部署快照，不会在云端启动 Python 或拉取 GitHub。当前没有开启自动同步流水线。

## 访问与缓存

GitHub OAuth 使用 state 与 PKCE。成功后设置 8 小时的 Secure、HttpOnly 会话 Cookie；所有财务接口先验证身份与会话 token，变更请求还验证同源。财务响应均为 `no-store, private`。云端不提供修改数据源、执行插件或删除来源的接口。

PWA 缓存只包含公开应用壳，真实账本仅在已登录页面内存中展示。会话失效会清空页面中的账本；离线刷新需要重新连接并登录。原文查看与导出同样位于登录保护之后。

参考：[创建 OAuth 应用](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)、[授权 OAuth 应用](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。
