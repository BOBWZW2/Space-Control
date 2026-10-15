# 不绑卡的 Netlify Free 部署路径

当前路径：Netlify 原生 Node.js TDR API，原 GitHub Pages 网页直接调用。Render 因 HTTP 402 要求付款信息而停止；Cloudflare 的 GitHub 登录返回“Unable to sign in”，因此完整查询也由 Netlify 承载，无需修改原 Worker。

已部署的代理地址为 https://helpful-tapioca-edac80.netlify.app/ 。浏览器诊断和未携带 Netlify 登录 Cookie 的服务器诊断均已通过真实 Allegro TLS 校验，登录页返回 HTTP 200；未携带代理密钥时诊断接口返回 HTTP 401。完整 API v2.4.2 已发布并使用真实账号验证：XPAG2639W / THLCH 返回 4 条货量记录，页面显示 DG 3；整个 WB bound 的 THLCH、SGSIN、MYPKG 均完成请求。SGSIN 返回未导入 TDR/船期未更新，MYPKG 按现有船期规则显示未离港（ETD 10/20 08:45）。未替用户决定 CUC 计入 LILIAN 或 SOC，未改动业务分类规则。未将数量或吨位与另一份 Allegro 导出逐项独立对账。

## 原生 TDR API

- `tdr-relay/netlify/functions/tdr.mjs` 复用原 Worker 的 TDR 数据提取与 NDJSON 格式，通过 Node 原生 HTTPS 补齐已验证的中间证书。
- GitHub Pages 的 `TDR_API_BASE` 指向上述 Netlify 地址；同步、船期和历史数据仍使用原有同步端点。
- `tdr-batch-client.js` 在用户点击一次后每两个口岸发起一组请求，同组共享登录、航次和码头列表，最多同时读取两个口岸，按完成顺序流式返回。结果保留原口岸索引；失败不会丢弃其他已成功口岸，认证失败停止后续请求。遇到尚未更新的单港 API 自动降为逐港模式。
- v2.5.0 在每次请求内创建独立 HTTPS keepalive 连接池，结束或取消时销毁；不跨用户、跨请求保存登录或会话。两个口岸正常只需 8 次 Allegro 请求，原逐港方式需要 12 次；这属于调用次数验证，并非真实耗时承诺。
- Netlify 的单次执行上限为 60 秒，因此一组最多两个口岸，内部保留 45 秒总截止时间。整个 bound 由网页完成分组调度。
- `/space-control.html` 是同一界面的部署验证入口，根地址继续提供不含 Allegro 账号的连接诊断。
- 代理服务密钥仅供服务器调用旧的 `/v1/*` 接口；网页直接调用 `/api/tdr*` 时发送用户在原网页填写的 Allegro 账号，不公开服务密钥。

## 网页部署

可以通过这个部署入口创建你的代理项目：

https://app.netlify.com/start/deploy?repository=https://github.com/BOBWZW2/Space-Control&branch=fix%2Ftdr-node-relay&base=tdr-relay#RELAY_ACCESS_TOKEN=

1. 使用 GitHub 注册或登录 Netlify，选择 **Free**。不要选择需要付款的方案。部署入口会在你的 GitHub 下复制项目，并连接新的 Netlify 项目；也可以直接导入既有仓库，步骤见下方。
2. 为提示的 `RELAY_ACCESS_TOKEN` 设置至少 32 个字符的随机访问密钥。只填入你的云端设置，不要贴到聊天或代码中。该密钥仅用于 `/v1/*` 诊断及可选代理接口；直接 TDR 查询不需要把服务密钥放入网页。
3. 当前生产项目使用 `main` 分支，Base directory 为 `tdr-relay`。Build command 为 `node prepare-netlify.mjs`，Publish directory 为 `netlify/public`，Functions directory 为 `netlify/functions`。
4. 部署完成后打开生成的 `https://你的项目.netlify.app`。在连接检查页输入访问密钥，点击“检查 Allegro 连接”。该检查不提交 Allegro 账号密码。
5. 只有看到“连接检查通过”之后，才把新代理接回原控舱网页。`/health` 仅表示配置就绪，不代表能访问 Allegro。

如果使用既有 GitHub 仓库：Netlify 的 Add new project → Import an existing project → GitHub → `BOBWZW2/Space-Control`，选择上述分支。在项目环境变量中添加 `RELAY_ACCESS_TOKEN`，包含 Functions 运行时作用域，然后部署。

免费方案不会允许匿名云函数长期运行：这条路径仍需要 Netlify 账号。若特定账户的实际流程要求付款信息，应停止，不添加银行卡、不升级套餐。

## 可选：接回现有 Cloudflare

诊断通过后，在原 `space-control-tdr` Worker 使用本分支的 `tdr-worker/worker.js`（v2.4.2），保留原有绑定，并设置：

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
- `cd tdr-relay && npm test`：32 项检查，包括本地真实 TLS 连接复用、证书拒绝、双港共享登录、乱序结果、部分超时与取消连接。
- `node --test tdr-batch-client.test.mjs`：6 项小批次、流式字符解码、部分失败、认证停止与旧接口兼容检查。
- `node prepare-netlify.mjs` 生成静态检查页和内嵌证书模块；这些生成文件不作为源码提交。

参考：

- https://www.netlify.com/pricing/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- https://docs.netlify.com/build/functions/configuration/
- https://docs.netlify.com/deploy/create-deploys/
