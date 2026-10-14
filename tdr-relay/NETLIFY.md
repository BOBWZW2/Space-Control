# 不绑卡的 Netlify Free 部署路径

当前状态：代码和本地检查已完成；尚未在 Netlify 部署，也未验证真实 Allegro 登录或 TDR 数据。Render 创建 Free 服务时对当前账户要求付款信息（HTTP 402）；用户明确不添加付款信息，因此停止 Render 路径。

## 网页部署

可以通过这个部署入口创建你的代理项目：

https://app.netlify.com/start/deploy?repository=https://github.com/BOBWZW2/Space-Control&branch=fix%2Ftdr-node-relay&base=tdr-relay#RELAY_ACCESS_TOKEN=

1. 使用 GitHub 注册或登录 Netlify，选择 **Free**。不要选择需要付款的方案。部署入口会在你的 GitHub 下复制项目，并连接新的 Netlify 项目；也可以直接导入既有仓库，步骤见下方。
2. 为提示的 `RELAY_ACCESS_TOKEN` 设置至少 32 个字符的随机访问密钥。只填入你的云端设置，不要贴到聊天或代码中。后续 Cloudflare 会用同一密钥连接代理。
3. 确认分支为 `fix/tdr-node-relay`，Base directory 为 `tdr-relay`。Build command 为 `node prepare-netlify.mjs`，Publish directory 为 `netlify/public`，Functions directory 为 `netlify/functions`。
4. 部署完成后打开生成的 `https://你的项目.netlify.app`。在连接检查页输入访问密钥，点击“检查 Allegro 连接”。该检查不提交 Allegro 账号密码。
5. 只有看到“连接检查通过”之后，才把新代理接回原控舱网页。`/health` 仅表示配置就绪，不代表能访问 Allegro。

如果使用既有 GitHub 仓库：Netlify 的 Add new project → Import an existing project → GitHub → `BOBWZW2/Space-Control`，选择上述分支。在项目环境变量中添加 `RELAY_ACCESS_TOKEN`，包含 Functions 运行时作用域，然后部署。

免费方案不会允许匿名云函数长期运行：这条路径仍需要 Netlify 账号。若特定账户的实际流程要求付款信息，应停止，不添加银行卡、不升级套餐。

## 接回现有 Cloudflare

诊断通过后，在原 `space-control-tdr` Worker 使用本分支的 `tdr-worker/worker.js`（v2.4.1），保留原有绑定，并设置：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `ALLEGRO_RELAY_URL` | Text | Netlify 根地址，例如 `https://你的项目.netlify.app` |
| `ALLEGRO_RELAY_TOKEN` | Secret | 与 Netlify 的 `RELAY_ACCESS_TOKEN` 完全相同 |

部署后回到原网页，先查单个港口，再查整个 bound，对照 Allegro 的真实数量和吨位。真实登录、数据正确性仍必须完成这一轮部署后验证。

## 免费额度和数据处理

当前 Netlify Free 为每月 300 credits 的硬上限，用完会暂停项目；额度与账户其他项目共享。每日 10–15 次 TDR 约为每月 300–450 次用户查询，但一次 TDR 需要多次登录/数据接口调用。最终消耗取决于每次连接耗时和响应大小，不能仅按查询按钮次数保证额度足够。

本方案只使用 Node.js Functions 和静态连接检查页，不创建数据库、AI 服务、域名订阅或付费扩展。原网页继续在 GitHub Pages，办公电脑不安装程序。

函数内保留证书有效期、域名及信任链校验。中间证书在构建时打包进函数，避免运行时文件路径或证书下载问题。账号、密码、Cookie 仅在单次请求内传递，不写日志或持久化；代理接口要求访问密钥。超过函数响应上限会明确失败，不会截断 TDR 后返回不完整数据。

## 本地验证

- `cd tdr-worker && npm test`：23 项检查。
- `cd tdr-relay && npm test`：21 项检查，包括本地真实 TLS 握手与 Netlify handler 检查。
- `node prepare-netlify.mjs` 生成静态检查页和内嵌证书模块；这些生成文件不作为源码提交。

参考：

- https://www.netlify.com/pricing/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- https://docs.netlify.com/build/functions/configuration/
- https://docs.netlify.com/deploy/create-deploys/
