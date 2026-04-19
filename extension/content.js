/**
 * 从 Google 首页搜索框读取当前可见的联想列表（顺序自上而下）。
 * 优先使用 input/textarea 的 aria-controls 指向的 listbox（较稳定）。
 */

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** 用于判断「联想首条是否已是当前词条」（兼容不可见字符、NFKC） */
function normalizeForMatch(s) {
  return norm(String(s || ""))
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff\u2060]/g, "")
    .toLowerCase();
}

function stripHtmlToText(html) {
  if (!html) return "";
  return norm(String(html).replace(/<[^>]*>/g, ""));
}

/**
 * 只取「搜索联想主文案」，不包含 Google 在行内展示的实体说明（否则会与主文案拼在一起）。
 * 优先用无障碍属性 aria-label（与页面展示的主查询一致）。
 */
function primaryTextFromSuggestionRow(el) {
  const opt =
    el && el.getAttribute && el.getAttribute("role") === "option"
      ? el
      : el?.querySelector?.('[role="option"]');

  const node = opt || el;
  if (!node) return "";

  const aria = node.getAttribute?.("aria-label");
  if (aria && norm(aria)) return norm(aria);

  const wm = node.querySelector?.(
    'div.wM6W7d[role="presentation"] span, div.wM6W7d span, .wM6W7d span'
  );
  if (wm) {
    const fromHtml = stripHtmlToText(wm.innerHTML || "");
    if (fromHtml) return fromHtml;
    const t = norm(wm.textContent || "");
    if (t) return t;
  }

  const sbqs = node.querySelector?.(".sbqs_c");
  if (sbqs) {
    const t = norm(sbqs.textContent || "");
    if (t) return t;
  }

  return norm(node.textContent || "");
}

function uniqueSequential(items) {
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const t = norm(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function getSearchControl() {
  return (
    document.querySelector('textarea[name="q"]') ||
    document.querySelector('input[name="q"]') ||
    document.querySelector('textarea#APjFqb') ||
    document.querySelector('input#APjFqb')
  );
}

function textsFromListbox(root) {
  if (!root) return [];

  const opts = root.querySelectorAll('[role="option"]');
  if (opts.length) {
    return uniqueSequential(Array.from(opts).map((el) => primaryTextFromSuggestionRow(el)));
  }

  const lis = root.querySelectorAll("li");
  if (lis.length) {
    return uniqueSequential(Array.from(lis).map((li) => primaryTextFromSuggestionRow(li)));
  }

  return [];
}

function isListboxElementVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  const st = window.getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
  return true;
}

/** 搜索框关联的 listbox（aria-controls / aria-owns），可见时返回 */
function resolveListboxFromAria(input) {
  if (!input) return null;

  const controls = input.getAttribute("aria-controls");
  if (controls) {
    const byId = document.getElementById(controls);
    if (byId?.getAttribute("role") === "listbox" && isListboxElementVisible(byId)) return byId;
    const inner = byId?.querySelector?.('[role="listbox"]');
    if (inner && isListboxElementVisible(inner)) return inner;
  }

  const owns = input.getAttribute("aria-owns");
  if (owns) {
    const ids = owns.split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.getAttribute("role") === "listbox" && isListboxElementVisible(el)) return el;
      const lb = el.querySelector?.('[role="listbox"]');
      if (lb && isListboxElementVisible(lb)) return lb;
    }
  }

  return null;
}

/** 页面上所有可见的联想 listbox，按与搜索框的距离排序（近者优先） */
function listVisibleListboxesNearInput(input) {
  const candidates = Array.from(document.querySelectorAll('[role="listbox"]')).filter(isListboxElementVisible);
  if (!input || !candidates.length) return candidates;

  const ir = input.getBoundingClientRect();
  return candidates
    .map((el) => {
      const r = el.getBoundingClientRect();
      const dy = Math.abs(r.top - ir.bottom);
      const dx = Math.abs(r.left - ir.left);
      return { el, score: dy * 2 + dx };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.el);
}

function findVisibleListboxNearInput(input) {
  const fromAria = resolveListboxFromAria(input);
  if (fromAria) return fromAria;
  const list = listVisibleListboxesNearInput(input);
  return list[0] || null;
}

/**
 * 在多个可见 listbox 中，找到「首条联想」已与 query 一致的那一份（解决误读旧下拉层导致超时）。
 */
function captureSuggestionsWhenFirstLineMatchesQuery(query) {
  const input = getSearchControl();
  if (!input) return [];
  const qm = normalizeForMatch(query);
  if (!qm) return [];

  const seen = new Set();
  const boxes = [];
  const push = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    boxes.push(el);
  };

  push(resolveListboxFromAria(input));
  for (const el of listVisibleListboxesNearInput(input)) push(el);

  for (const lb of boxes) {
    const lines = textsFromListbox(lb);
    if (!lines.length) continue;
    if (normalizeForMatch(lines[0]) === qm) return lines;
  }

  return [];
}

function captureSuggestions() {
  const input = getSearchControl();
  const listbox = findVisibleListboxNearInput(input);
  const fromAria = textsFromListbox(listbox);
  if (fromAria.length) return fromAria;

  // 兜底：页面上可见的 listbox（可能误匹配，但优于完全失败）
  const any = findVisibleListboxNearInput(document.body);
  return textsFromListbox(any);
}

function setNativeValue(el, value) {
  const str = String(value);
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, str);
  else el.value = str;
}

/**
 * 把词条写入 Google 搜索框并触发联想（不跳转结果页）。
 */
function setSearchQuery(text) {
  const input = getSearchControl();
  if (!input) throw new Error("NO_SEARCH_INPUT");

  const q = norm(String(text));
  if (!q) throw new Error("EMPTY_QUERY");

  input.focus();
  setNativeValue(input, q);

  try {
    input.setSelectionRange(q.length, q.length);
  } catch {
    // ignore
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertReplacementText",
      data: q
    })
  );
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function inputValueMatchesQuery(input, query) {
  if (!input) return false;
  return normalizeForMatch(input.value) === normalizeForMatch(query);
}

/**
 * 写入词条后轮询，直到某一可见下拉的「首条」与词条一致（表示已针对新词刷新）。
 */
async function waitForSuggestionsForQuery(query, timeoutMs = 8000, intervalMs = 80) {
  const deadline = Date.now() + timeoutMs;
  const qm = normalizeForMatch(query);

  await new Promise((r) => setTimeout(r, 50));

  while (Date.now() < deadline) {
    const input = getSearchControl();
    if (!inputValueMatchesQuery(input, query)) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const lines = captureSuggestionsWhenFirstLineMatchesQuery(query);
    if (lines.length && normalizeForMatch(lines[0]) === qm) return lines;

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("TIMEOUT_SUGGESTIONS");
}

async function expandQueryFromPage(queryText) {
  const q = norm(String(queryText));
  setSearchQuery(q);
  return waitForSuggestionsForQuery(q);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE") {
    try {
      const lines = captureSuggestions();
      sendResponse({ ok: true, lines });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
    return false;
  }

  if (msg?.type === "EXPAND_QUERY") {
    expandQueryFromPage(msg.text)
      .then((lines) => sendResponse({ ok: true, lines }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  return false;
});
