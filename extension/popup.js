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

function buildCaptureLines(query, suggestions) {
  const rootText = normOneLine(query);
  const kids = normalizeLines(suggestions || []);
  if (!rootText) return kids;
  return [rootText, ...kids];
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
    const query = normOneLine(resp.query);
    const suggestions = normalizeLines(resp.lines || []);
    if (!query) return { ok: false, error: "搜索框为空，请先输入种子词。" };
    const lines = buildCaptureLines(query, suggestions);
    const text = formatCaptureText(lines);
    return { ok: true, text, lines, query, suggestions };
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

const STORAGE_KEYS = [
  "lastCapture",
  "lastCaptureAt",
  "lastCaptureLines",
  "lastError",
  "lastErrorAt"
];

async function clearAllStoredData() {
  await chrome.storage.local.remove(STORAGE_KEYS);
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

function createLevelBadge(level) {
  const badge = document.createElement("span");
  badge.className = "tree-level-badge";
  badge.textContent = `第${level}层`;
  badge.title = `当前处于第 ${level} 层`;
  return badge;
}

function createDepthBadge(depthBelow) {
  const badge = document.createElement("span");
  badge.className = "tree-depth-badge";
  if (depthBelow <= 0) {
    badge.textContent = "无下级";
    badge.title = "尚未加载子联想";
  } else {
    badge.textContent = `下${depthBelow}层`;
    badge.title = `其下已加载 ${depthBelow} 层子联想`;
  }
  return badge;
}

/** 计算节点之下已加载子树的最大深度（叶子为 0，仅有直接子节点为 1） */
function countLevelsBelow(node) {
  const kids = node?.children || [];
  if (!kids.length) return 0;
  let max = 0;
  for (const ch of kids) {
    max = Math.max(max, 1 + countLevelsBelow(ch));
  }
  return max;
}

function setNodeLabel(el, text, level, depthBelow) {
  el.replaceChildren();
  const textEl = document.createElement("span");
  textEl.className = "tree-node-text";
  textEl.textContent = text;
  el.appendChild(textEl);
  if (level != null) {
    el.classList.add("has-level");
    const badges = document.createElement("span");
    badges.className = "tree-node-badges";
    badges.appendChild(createLevelBadge(level));
    badges.appendChild(createDepthBadge(depthBelow ?? 0));
    el.appendChild(badges);
  } else {
    el.classList.remove("has-level");
  }
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

function linesToTreeRoot(query, suggestions) {
  const rootText = normOneLine(query);
  const kids = normalizeLines(suggestions);
  if (!rootText) return null;
  return {
    text: rootText,
    children: kids.map((t) => newLeafNode(t)),
    loading: false,
    expanded: true
  };
}

function linesToTreeRootFromStored(lines) {
  const n = normalizeLines(lines);
  if (!n.length) return null;
  return linesToTreeRoot(n[0], n.slice(1));
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
    rootEl.replaceChildren();
    rootEl.classList.remove("has-level");
    ul.replaceChildren();
    ul.hidden = false;
    if (rootToggle) {
      rootToggle.hidden = true;
    }
    return;
  }

  wrap.hidden = false;
  const hasFirstLevel = treeRoot.children.length > 0;
  setNodeLabel(rootEl, treeRoot.text, 1, countLevelsBelow(treeRoot));
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
  setNodeLabel(btn, node.loading ? `${node.text} …` : node.text, level, countLevelsBelow(node));
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
  treeRoot = linesToTreeRootFromStored(lines);
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
    if (Object.prototype.hasOwnProperty.call(changes, "lastCaptureLines")) {
      const lines = changes.lastCaptureLines.newValue;
      if (lines == null) {
        treeRoot = null;
        renderTreeFromData();
      } else {
        renderTree(lines || []);
      }
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
      renderTree([result.query].filter(Boolean));
      return;
    }
    renderTree(result.lines);
    await persistCapture(result.text, result.lines);
    const suggestionCount = result.suggestions?.length ?? Math.max(0, result.lines.length - 1);
    if (status) status.textContent = `已抓取：第1层「${result.query}」，${suggestionCount} 条第2层联想。`;
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

  $("clear-all").addEventListener("click", async () => {
    if (
      !confirm(
        "确定要彻底清空所有已保存的抓取数据吗？\n\n将删除本地存储的联想树、抓取记录与错误信息，此操作不可恢复。"
      )
    ) {
      return;
    }
    await clearAllStoredData();
    treeRoot = null;
    renderTreeFromData();
    if (status) status.textContent = "已清空全部数据。";
  });
}

main();
