function normOneLine(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLines(lines) {
  if (!lines?.length) return [];
  return lines.map((line) => normOneLine(line)).filter(Boolean);
}

function formatCaptureText(lines) {
  const normalized = normalizeLines(lines);
  if (!normalized.length) return "";
  return normalized.map((line, i) => (i === 0 ? line : `\t${line}`)).join("\n");
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
    const normalized = normalizeLines(resp.lines || []);
    const text = formatCaptureText(normalized);
    return { ok: true, text, lines: normalized };
  } catch {
    return { ok: false, error: "无法读取联想（请先刷新 google.com 页面再试）" };
  }
}

async function expandQueryInActiveTab(queryText) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: "没有活动标签页" };
  const url = tab.url || "";
  if (!url.startsWith("https://www.google.com/")) {
    return { ok: false, error: "仅支持 https://www.google.com/" };
  }

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: "EXPAND_QUERY",
      text: queryText
    });
    if (!resp?.ok) return { ok: false, error: resp?.error || "展开失败" };
    return { ok: true, lines: normalizeLines(resp.lines || []) };
  } catch {
    return { ok: false, error: "页面未响应（请确认当前标签为 google.com 并已刷新）" };
  }
}

async function persistCapture(text, lines) {
  const normalized = normalizeLines(lines || []);
  const finalText = text || formatCaptureText(normalized);
  if (!finalText && !normalized.length) return;
  await chrome.storage.local.remove(["lastError"]);
  await chrome.storage.local.set({
    lastCapture: finalText,
    lastCaptureAt: Date.now(),
    lastCaptureLines: normalized
  });
}

function $(id) {
  return document.getElementById(id);
}

/** @typedef {{ text: string, children: TreeNode[], loading?: boolean, expanded?: boolean }} TreeNode */

/** 当前联想树（仅内存；关闭弹窗后清空） */
let treeRoot = null;

function branchIsExpanded(node) {
  return node.expanded !== false;
}

function toggleBranchExpanded(node) {
  node.expanded = !branchIsExpanded(node);
}

function newLeafNode(text) {
  return { text, children: [], loading: false };
}

function linesToTreeRoot(lines) {
  const n = normalizeLines(lines);
  if (!n.length) return null;
  return {
    text: n[0],
    children: n.slice(1).map((t) => newLeafNode(t)),
    loading: false,
    expanded: true
  };
}

/** 先序遍历整棵树：根 0 个 Tab，每深一层多一个 Tab */
function serializeTreeToTabText(root) {
  if (!root) return "";
  const lines = [];
  function walk(node, depth) {
    const t = normOneLine(node.text);
    if (!t) return;
    lines.push("\t".repeat(depth) + t);
    const kids = node.children || [];
    for (const ch of kids) {
      walk(ch, depth + 1);
    }
  }
  walk(root, 0);
  return lines.join("\n");
}

function renderTreeFromData() {
  const wrap = $("tree-wrap");
  const rootEl = $("tree-root");
  const ul = $("tree-children");
  const rootToggle = $("root-branch-toggle");
  if (!wrap || !rootEl || !ul) return;

  if (!treeRoot) {
    wrap.hidden = true;
    rootEl.textContent = "";
    ul.replaceChildren();
    ul.hidden = false;
    if (rootToggle) {
      rootToggle.hidden = true;
    }
    return;
  }

  wrap.hidden = false;
  rootEl.textContent = treeRoot.text;

  const hasFirstLevel = treeRoot.children.length > 0;
  if (rootToggle) {
    rootToggle.hidden = !hasFirstLevel;
    if (hasFirstLevel) {
      const open = branchIsExpanded(treeRoot);
      rootToggle.textContent = open ? "▼" : "▶";
      rootToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    rootEl.setAttribute("aria-expanded", hasFirstLevel ? (branchIsExpanded(treeRoot) ? "true" : "false") : "false");
  }
  ul.hidden = hasFirstLevel && !branchIsExpanded(treeRoot);

  ul.replaceChildren();
  if (!ul.hidden) {
    for (const child of treeRoot.children) {
      ul.appendChild(renderTreeNode(child, 2));
    }
  }
}

function renderTreeNode(node, level) {
  const li = document.createElement("li");
  li.className = "tree-row";

  const head = document.createElement("div");
  head.className = "tree-row-head";

  const hasBranch = !!(node.children && node.children.length > 0);
  if (hasBranch) {
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "tree-caret";
    const open = branchIsExpanded(node);
    caret.textContent = open ? "▼" : "▶";
    caret.setAttribute("aria-expanded", open ? "true" : "false");
    caret.setAttribute("aria-label", "展开或折叠子联想");
    caret.title = "展开 / 折叠子项";
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBranchExpanded(node);
      renderTreeFromData();
    });
    head.appendChild(caret);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "tree-caret-spacer";
    spacer.setAttribute("aria-hidden", "true");
    head.appendChild(spacer);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tree-item" + (node.loading ? " is-loading" : "");
  btn.textContent = node.loading ? `${node.text} …` : node.text;
  btn.setAttribute("role", "treeitem");
  btn.setAttribute("aria-level", String(level));
  btn.setAttribute("aria-expanded", hasBranch ? (branchIsExpanded(node) ? "true" : "false") : "false");
  btn.disabled = !!node.loading;
  btn.title = "点击：将该词填入 Google 搜索框并加载下一层联想";
  btn.addEventListener("click", () => onTreeItemClick(node));

  head.appendChild(btn);
  li.appendChild(head);

  if (hasBranch && branchIsExpanded(node)) {
    const sub = document.createElement("ul");
    sub.className = "tree-children";
    sub.setAttribute("role", "group");
    for (const ch of node.children) {
      sub.appendChild(renderTreeNode(ch, level + 1));
    }
    li.appendChild(sub);
  }

  return li;
}

async function onTreeItemClick(node) {
  if (node.loading) return;

  const status = $("status");
  node.loading = true;
  node.children = [];
  renderTreeFromData();
  if (status) status.textContent = `正在载入「${node.text}」的联想…`;

  const result = await expandQueryInActiveTab(node.text);
  node.loading = false;

  if (!result.ok) {
    if (status) status.textContent = mapExpandError(result.error);
    renderTreeFromData();
    return;
  }

  if (!result.lines.length) {
    if (status) status.textContent = "未获取到联想，请重试。";
    renderTreeFromData();
    return;
  }

  node.expanded = true;
  node.children = result.lines.map((text) => newLeafNode(text));
  if (status) {
    status.textContent = `「${node.text}」下已加载 ${result.lines.length} 条子联想。`;
  }
  renderTreeFromData();
}

function mapExpandError(err) {
  const s = String(err || "");
  if (s.includes("TIMEOUT_SUGGESTIONS")) return "等待联想超时，请确认搜索框下拉已出现后再试。";
  if (s.includes("NO_SEARCH_INPUT")) return "未找到搜索框。";
  if (s.includes("EMPTY_QUERY")) return "词条为空。";
  return s || "展开失败。";
}

function renderTree(lines) {
  treeRoot = linesToTreeRoot(lines);
  renderTreeFromData();
}

async function refreshFromStorage() {
  const { lastCaptureLines, lastError } = await chrome.storage.local.get([
    "lastCaptureLines",
    "lastError"
  ]);
  const status = $("status");

  if (lastError && status) {
    status.textContent = String(lastError);
  }

  if (Array.isArray(lastCaptureLines) && lastCaptureLines.length) {
    renderTree(lastCaptureLines);
  }
}

function bindRootBranchToggle() {
  const rootToggle = $("root-branch-toggle");
  if (!rootToggle || rootToggle.dataset.bound === "1") return;
  rootToggle.dataset.bound = "1";
  rootToggle.addEventListener("click", (e) => {
    e.preventDefault();
    if (!treeRoot || !treeRoot.children.length) return;
    toggleBranchExpanded(treeRoot);
    renderTreeFromData();
  });
}

async function main() {
  const status = $("status");

  bindRootBranchToggle();
  await refreshFromStorage();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lastCaptureLines?.newValue != null) {
      renderTree(changes.lastCaptureLines.newValue || []);
    }
    if (Object.prototype.hasOwnProperty.call(changes, "lastError")) {
      const err = changes.lastError?.newValue;
      if (status) status.textContent = err ? String(err) : "";
    }
    if (changes.lastCapture?.newValue && status) {
      status.textContent = "已更新为最近一次抓取。";
    }
  });

  $("capture").addEventListener("click", async () => {
    if (status) status.textContent = "正在抓取…";
    const result = await captureActiveTab();
    if (!result.ok) {
      if (status) status.textContent = result.error;
      await chrome.storage.local.set({ lastError: result.error });
      return;
    }
    if (!result.text) {
      if (status) {
        status.textContent = "未读取到联想（可能已关闭下拉，或 DOM 不匹配）。试试快捷键。";
      }
      renderTree([]);
      return;
    }
    renderTree(result.lines);
    await persistCapture(result.text, result.lines);
    if (status) status.textContent = `已抓取 ${result.lines.length} 条。`;
  });

  $("copy").addEventListener("click", async () => {
    const text = serializeTreeToTabText(treeRoot);
    if (!text) {
      if (status) status.textContent = "没有可复制的联想树，请先抓取。";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (status) status.textContent = "已复制整棵树（Tab 表示层级）。";
    } catch {
      if (status) status.textContent = "复制失败：请重试或检查权限。";
    }
  });

  $("clear").addEventListener("click", () => {
    treeRoot = null;
    renderTreeFromData();
    if (status) status.textContent = "已清空展示（不影响已保存的最近一次抓取记录）。";
  });
}

main();
