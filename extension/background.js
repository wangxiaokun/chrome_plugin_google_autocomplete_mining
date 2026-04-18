function formatCaptureText(lines) {
  if (!lines?.length) return "";
  return lines
    .map((line) => normOneLine(line))
    .filter(Boolean)
    .map((line, i) => (i === 0 ? line : `\t${line}`))
    .join("\n");
}

function normOneLine(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  } catch (e) {
    return { ok: false, error: "无法读取联想（请先刷新 google.com 页面再试）" };
  }
}

async function persistCapture(text) {
  if (!text) return;
  await chrome.storage.local.set({
    lastCapture: text,
    lastCaptureAt: Date.now()
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-suggestions") return;
  const result = await captureActiveTab();
  if (!result.ok) {
    await chrome.storage.local.set({ lastError: result.error, lastErrorAt: Date.now() });
    return;
  }
  await persistCapture(result.text);
  await chrome.storage.local.remove(["lastError"]);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.action.setBadgeBackgroundColor({ color: "#137333", tabId: tab.id });
      await chrome.action.setBadgeText({ text: "OK", tabId: tab.id });
    } catch {
      // ignore
    }
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "", tabId: tab.id }).catch(() => {});
    }, 1600);
  }
});
