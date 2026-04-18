/**
 * 从 Google 首页搜索框读取当前可见的联想列表（顺序自上而下）。
 * 优先使用 input/textarea 的 aria-controls 指向的 listbox（较稳定）。
 */

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
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
    return uniqueSequential(Array.from(opts).map((el) => el.textContent || ""));
  }

  const lis = root.querySelectorAll("li");
  if (lis.length) {
    return uniqueSequential(
      Array.from(lis).map((li) => {
        const hit =
          li.querySelector('[role="presentation"] span') ||
          li.querySelector(".sbqs_c") ||
          li.querySelector("span") ||
          li;
        return hit.textContent || "";
      })
    );
  }

  return [];
}

function findVisibleListboxNearInput(input) {
  if (!input) return null;

  const controls = input.getAttribute("aria-controls");
  if (controls) {
    const byId = document.getElementById(controls);
    if (byId && byId.getAttribute("role") === "listbox") return byId;
  }

  const owns = input.getAttribute("aria-owns");
  if (owns) {
    const ids = owns.split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.getAttribute("role") === "listbox") return el;
      const lb = el.querySelector?.('[role="listbox"]');
      if (lb) return lb;
    }
  }

  const candidates = Array.from(document.querySelectorAll('[role="listbox"]'));
  const visible = candidates.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const st = window.getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0)
      return false;
    return true;
  });

  if (!visible.length) return null;

  const ir = input.getBoundingClientRect();
  let best = visible[0];
  let bestScore = Infinity;
  for (const el of visible) {
    const r = el.getBoundingClientRect();
    const dy = Math.abs(r.top - ir.bottom);
    const dx = Math.abs(r.left - ir.left);
    const score = dy * 2 + dx;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "CAPTURE") return;
  try {
    const lines = captureSuggestions();
    sendResponse({ ok: true, lines });
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
  return true;
});
