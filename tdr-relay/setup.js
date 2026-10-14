const form = document.querySelector("#check");
const button = document.querySelector("#button");
const output = document.querySelector("#result");
form.addEventListener("submit", async event => {
  event.preventDefault();
  const field = document.querySelector("#token");
  const token = field.value.trim();
  field.value = "";
  if (token.length < 32) { output.textContent = "请使用云端环境变量中完整的代理访问密钥。"; return; }
  button.disabled = true;
  output.textContent = "正在检查登录页连接，尚未提交 Allegro 账号密码……";
  try {
    const response = await fetch("/v1/diagnostics", { headers: { Authorization: "Bearer " + token }, cache: "no-store", redirect: "error" });
    const result = await response.json();
    if (result.ok && result.tlsVerified && result.loginPageAvailable) {
      output.textContent = "连接检查通过：证书校验成功，已打开 Allegro 登录页。\n下一步：把代理地址和访问密钥配置到原 Cloudflare Worker，再测试真实 TDR 查询。";
    } else if (response.status === 401) {
      output.textContent = "代理访问密钥不正确，请核对云端的 RELAY_ACCESS_TOKEN。";
    } else {
      output.textContent = "连接检查未通过：" + (result.code || "HTTP " + result.status) + "\n" + JSON.stringify(result, null, 2);
    }
  } catch { output.textContent = "代理尚未就绪或连接中断，请确认服务已部署，再重试。"; }
  finally { button.disabled = false; }
});
