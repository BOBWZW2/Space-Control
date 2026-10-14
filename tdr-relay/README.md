# Allegro 云端代理（部署前验证版）

**最新部署路径：** 当前 Render 账户创建免费服务时返回 402，要求付款信息。用户不添加付款信息，因此改为准备 Netlify Free。请先看 [`NETLIFY.md`](./NETLIFY.md)；下方 Render 指南保留为原部署方式，当前不继续操作。代码已适配 Netlify；真实 Allegro 连通性仍待部署验证。

本服务供现有控舱网页使用。所有办公电脑仍只打开原网页，不需要安装助手。

2026-10-14 的实际结果：Cloudflare Worker 直连出现 526；v2.3.0 的 Browser Run 备用路径出现 `net::ERR_CONNECTION_RESET`，未打开登录页。这个 Node.js 代理改用另一云端出口，并补充官方 GeoTrust 中间证书，保留 TLS 证书、有效期及域名校验。它目前通过了本地 TLS 与接口测试，**尚未在 Render 上验证 Allegro 连通性、登录或真实 TDR 数据**。

## 先部署，再检查连接

1. 连接 ChatGPT 的 Render 集成，或在 Render 网页使用 GitHub 登录。
2. 创建 Blueprint，选择 `BOBWZW2/Space-Control`、分支 `fix/tdr-node-relay`，使用根目录 `render.yaml`。也可创建 Web Service，Root Directory=`tdr-relay`，Runtime=Node，Build Command=`node --check server.mjs && node --check upstream.mjs`，Start Command=`npm start`，Region=Singapore，**Instance Type=Free**。
3. Blueprint 已设 `plan: free`，自动产生 `RELAY_ACCESS_TOKEN`。若手工创建服务，请在环境变量加入至少 32 个字符的随机 `RELAY_ACCESS_TOKEN`。不要把它写入代码或发到聊天里。
4. 服务部署后先打开它的 `/health`。这只确认代理启动，不代表 Allegro 可连接。
5. 打开服务根地址的网页，在“代理访问密钥”填 Render 环境变量 `RELAY_ACCESS_TOKEN` 的值，点击“检查 Allegro 连接”。该检查仅 GET Allegro 登录页，不会发送 Allegro 账号、密码或 Cookie。必须看到“连接检查通过”才继续。对应接口为 `GET /v1/diagnostics`，请求头为 `Authorization: Bearer <访问密钥>`；成功时返回 `ok: true`、`tlsVerified: true`、`loginPageAvailable: true`。

如果连接 Render 集成，可由助手读取服务状态并完成诊断。诊断失败时先检查明确的错误代码，**不要升级套餐、切换网页或反复提交账号密码来碰运气**。免费服务的首次唤醒约需一分钟，测试时先等待服务启动。

## 诊断通过后，接回原网页

1. Cloudflare 的 `space-control-tdr` Worker 更新为本分支 `tdr-worker/worker.js`（v2.4.0）。保留既有 `SYNC_BACKEND` 和 `BROWSER` 绑定。
2. 在 Worker 的 Variables and Secrets 新增：
   - `ALLEGRO_RELAY_URL`（Text）：实际 Render 服务根地址，如 `https://你的服务.onrender.com`，不要附路径、查询参数或密钥。
   - `ALLEGRO_RELAY_TOKEN`（Secret）：与 Render 的 `RELAY_ACCESS_TOKEN` 完全一致。
3. 部署后 `/api/health` 应显示 `version: "2.4.0"`、`relayConfigured: true`。这仍然只是配置状态。
4. 原网页先查询 THLCH 单个港口，对照 Allegro 的真实 TDR。完成这一项后才视为修复。

配置代理后，Allegro 请求直接走代理，不再先触发 526 或占用 Browser Run 时长。未配置时保留 v2.3.0 的原有直连和浏览器备用行为。

## 证书与访问控制

- 证书来源：`https://cacerts.digicert.com/GeoTrustG2TLSCNRSA4096SHA2562022CA1.crt`，转为 PEM 后随代码部署。SHA-256：`05:DC:9E:DC:0F:DD:FA:97:5A:14:32:EF:80:6E:C7:80:07:8B:53:62:AD:45:AF:76:DB:15:C9:07:63:0D:B2:5D`。
- 启动时验证中间证书的有效期、CA 属性和来自 Node 内置根证书的签名。请求始终使用 `rejectUnauthorized: true`，域名固定为 `ops.culines.com`，至少 TLS 1.2。
- 不使用 `NODE_TLS_REJECT_UNAUTHORIZED=0`，不覆盖域名检查。
- 仅允许 GET 登录页，以及 POST `/oceans/general.signon`、`/serviceEndpoint/json`；拒绝任意目的地址、额外请求头和重定向。
- 账号、密码和会话 Cookie 仅在一次请求链的内存中传递，不写日志、磁盘、数据库或环境变量。访问密钥通过请求头传递。
- `/health` 公开；诊断及代理接口要求访问密钥。服务未设置足够长的访问密钥时拒绝启动。

## 本地验证

`cd tdr-relay && npm test`。测试通过临时 OpenSSL CA 和本地 HTTPS 服务重现缺少中间证书的问题，并检查补齐后的成功连接、错误域名、过期证书、超时、重定向、鉴权和错误信息脱敏。测试所用私钥保存在临时目录并清理，不随项目发布。

Render 免费方案用于这次验证；闲置会休眠，且有用量限制。当前配置没有付费服务或数据库；如需付费或保证持续可用，应另行决定。
