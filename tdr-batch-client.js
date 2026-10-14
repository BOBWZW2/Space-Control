// One click still queries every selected port. Separate server invocations keep
// a slow port within its own deadline and preserve already completed results.
async function* fetchTdrBatchLines(base, credentials, queryChoices, fetchImpl = fetch) {
  for (let index = 0; index < queryChoices.length; index += 1) {
    const choice = queryChoices[index];
    let authenticationFailed = false;
    let received = false;
    try {
      const response = await fetchImpl(`${base}/api/tdr/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credentials, queries: [{ vvd: choice.vvd, pol: choice.port }] })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw Object.assign(new Error(payload.error || `TDR 查询失败 (${response.status})`), { code: payload.code || "TDR_QUERY_FAILED" });
      }
      const parse = (text) => {
        const line = JSON.parse(text);
        if (line.index !== 0 || typeof line.ok !== "boolean") throw new Error("TDR 返回格式无效");
        return { ...line, index };
      };
      if (!response.body?.getReader) {
        for (const text of (await response.text()).split(/\r?\n/).filter(line => line.trim())) {
          const line = parse(text);
          received = true;
          authenticationFailed ||= ["AUTH_FAILED", "AUTH_REQUIRED"].includes(line.code);
          yield line;
        }
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const parts = buffer.split("\n");
            buffer = parts.pop();
            if (done && buffer.trim()) { parts.push(buffer); buffer = ""; }
            for (const text of parts.filter(line => line.trim())) {
              const line = parse(text);
              received = true;
              authenticationFailed ||= ["AUTH_FAILED", "AUTH_REQUIRED"].includes(line.code);
              yield line;
            }
            if (done) break;
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      if (!received) throw new Error("TDR 服务未返回查询结果");
    } catch (error) {
      if (!received) {
        const code = error.code || "TDR_QUERY_FAILED";
        authenticationFailed ||= ["AUTH_FAILED", "AUTH_REQUIRED"].includes(code);
        yield { index, ok: false, code, error: error.message || "TDR 查询失败" };
      }
    }
    if (authenticationFailed) return;
  }
}
