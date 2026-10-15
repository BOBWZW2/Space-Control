// Small batches share one Allegro login and return each port as it completes.
// The server caps parallel reads at two and keeps a 45-second batch deadline.
async function* fetchTdrBatchLines(base, credentials, queryChoices, fetchImpl = fetch) {
  async function* readBatch(choices, start) {
    const received = new Set();
    try {
      const response = await fetchImpl(`${base}/api/tdr/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credentials, queries: choices.map(choice => ({ vvd: choice.vvd, pol: choice.port })) })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw Object.assign(new Error(payload.error || `TDR 查询失败 (${response.status})`), { code: payload.code || "TDR_QUERY_FAILED" });
      }
      const parse = (text) => {
        const line = JSON.parse(text);
        if (!Number.isInteger(line.index) || line.index < 0 || line.index >= choices.length
          || received.has(line.index) || typeof line.ok !== "boolean") throw new Error("TDR 返回格式无效");
        received.add(line.index);
        return { ...line, index: start + line.index };
      };
      if (!response.body?.getReader) {
        for (const text of (await response.text()).split(/\r?\n/).filter(line => line.trim())) yield parse(text);
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
            for (const text of parts.filter(line => line.trim())) yield parse(text);
            if (done) break;
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      if (received.size < choices.length) throw new Error("TDR 服务未返回部分口岸的查询结果");
    } catch (error) {
      // Old deployments reject multiple ports before contacting Allegro.
      if (error.code === "BATCH_LIMIT" && choices.length > 1) throw error;
      for (let index = 0; index < choices.length; index += 1) {
        if (!received.has(index)) yield { index: start + index, ok: false,
          code: error.code || "TDR_QUERY_FAILED", error: error.message || "TDR 查询失败" };
      }
    }
  }
  let batchSize = 2;
  for (let start = 0; start < queryChoices.length;) {
    const choices = queryChoices.slice(start, start + batchSize);
    try {
      for await (const line of readBatch(choices, start)) {
        yield line;
        if (["AUTH_FAILED", "AUTH_REQUIRED"].includes(line.code)) return;
      }
    } catch (error) {
      if (error.code !== "BATCH_LIMIT") throw error;
      batchSize = 1;
      continue;
    }
    start += choices.length;
  }
}
