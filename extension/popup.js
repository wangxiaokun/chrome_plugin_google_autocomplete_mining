function formatCaptureText(lines) {
  if (!lines?.length) return "";
  return lines
    .map((line) =>
      String(line || "")
        .replace(/\r\n/g, "\n")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .map((line, i) => (i === 0 ? line : `\t${line}`))
    .join("\n");
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: "没有活动标签页" };
  const url = tab.url || "";
  if (!url.startsWith("https://www.google.com/")) {
    return { ok: false, error: "仅支持 https://www.google.com/" };
  }

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE" });
    if (!resp?.ok) return { ok: false, error: resp?.error || "页面未响应" };
    const text = formatCaptureText(resp.lines || []);
    return { ok: true, text, lines: resp.lines || [] };
  } catch {
    return { ok: false, error: "无法读取联想（请先刷新 google.com 页面再试）" };
  }
}

async function persistCapture(text) {
  if (!text) return;
  await chrome.storage.local.remove(["lastError"]);
  await chrome.storage.local.set({
    lastCapture: text,
    lastCaptureAt: Date.now()
  });
}

function $(id) {
  return document.getElementById(id);
}

async function refreshFromStorage() {
  const { lastCapture, lastError } = await chrome.storage.local.get(["lastCapture", "lastError"]);
  const out = $("out");
  const status = $("status");

  if (lastError) {
    status.textContent = String(lastError);
  }

  // 若本地有最近一次抓取，且文本框为空，则预填，方便复制
  if (lastCapture && !out.value) {
    out.value = lastCapture;
  }
}

async function main() {
  const out = $("out");
  const status = $("status");

  await refreshFromStorage();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lastCapture?.newValue) {
      out.value = changes.lastCapture.newValue;
      status.textContent = "已更新为最近一次抓取。";
    }
    if (Object.prototype.hasOwnProperty.call(changes, "lastError")) {
      const err = changes.lastError?.newValue;
      status.textContent = err ? String(err) : "";
    }
  });

  $("capture").addEventListener("click", async () => {
    status.textContent = "正在抓取…";
    const result = await captureActiveTab();
    if (!result.ok) {
      status.textContent = result.error;
      await chrome.storage.local.set({ lastError: result.error });
      return;
    }
    if (!result.text) {
      status.textContent = "未读取到联想（可能已关闭下拉，或 DOM 不匹配）。试试快捷键。";
      return;
    }
    out.value = result.text;
    await persistCapture(result.text);
    status.textContent = `已抓取 ${result.lines.length} 条。`;
  });

  $("copy").addEventListener("click", async () => {
    const text = out.value || "";
    if (!text) {
      status.textContent = "没有可复制内容。";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "已复制到剪贴板。";
    } catch {
      status.textContent = "复制失败：请手动全选复制。";
    }
  });

  $("clear").addEventListener("click", () => {
    out.value = "";
    status.textContent = "已清空展示（不影响已保存的最近一次抓取记录）。";
  });
}

main();
