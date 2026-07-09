// O'right｜PRO 業務教育教練 — 前端邏輯（手機優先版）
// 若頁面載入了 demo-data.js（GitHub Pages 靜態展示版），所有 API 呼叫會改走固定腳本。
let CONFIG = null;

const state = {
  // 情境演練
  themeId: null,
  difficulty: null,
  name: "",
  history: [],    // [{role:'sales'|'manager', text}]
  feedbacks: [],  // 對應每句業務發言 {coaching, correction}
  evaluation: null,
  ended: false,
  // 知識問答
  qaHistory: [],  // [{role:'user'|'assistant', text}]
  // 測驗
  quizModule: null,
  quizModuleLabel: "",
  quizQuestion: null,
  quizAsked: [],
  quizCount: 0,
  quizCorrect: 0,
  quizPrefetch: null,
  quizItems: [],   // 逐題作答歷史（供產出測驗報告）
  // 全域
  busy: false
};

const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };

// ───────────────── API（含靜態展示版轉接） ─────────────────
async function api(path, body) {
  if (window.DEMO_DATA) return window.DEMO_DATA.handle(path, body);
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "連線發生問題，請再試一次");
  return data;
}

async function apiBlob(path, body) {
  if (window.DEMO_DATA) throw new Error("靜態展示版無法產生檔案，請使用完整部署版本。");
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "檔案產生失敗，請再試一次");
  }
  return res.blob();
}

// ───────────────── Toast 與 Modal ─────────────────
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

function confirmModal({ title, body, okText = "確定", cancelText = "取消" }, onOk) {
  $("modal-title").textContent = title;
  $("modal-body").textContent = body;
  $("modal-ok").textContent = okText;
  $("modal-cancel").textContent = cancelText;
  $("modal").classList.remove("hidden");
  $("modal-ok").onclick = () => { $("modal").classList.add("hidden"); onOk(); };
  $("modal-cancel").onclick = () => $("modal").classList.add("hidden");
}

// ───────────────── 畫面導覽 ─────────────────
const SCREEN_META = {
  "home":       { brand: true },
  "rp-theme":   { title: "情境演練", back: "home" },
  "rp-mode":    { title: "情境演練", back: "rp-theme" },
  "rp-name":    { title: "情境演練", back: "rp-mode" },
  "chat":       { title: "", back: "home", action: true },
  "progress":   { title: "產出報告" },
  "result":     { title: "訓練評估報告", back: "home" },
  "qa":         { title: "知識問答", back: "home" },
  "quiz-setup":  { title: "隨機測驗", back: "home" },
  "quiz-play":   { title: "隨機測驗", back: "quiz-setup" },
  "quiz-result": { title: "測驗成績", back: "home" }
};
const SCREEN_IDS = Object.keys(SCREEN_META);
let currentScreen = "home";

function go(name) {
  currentScreen = name;
  SCREEN_IDS.forEach((s) => $(`screen-${s}`).classList.toggle("hidden", s !== name));
  const meta = SCREEN_META[name];
  $("appbar-brand").classList.toggle("hidden", !meta.brand);
  $("appbar-title").classList.toggle("hidden", !!meta.brand);
  $("nav-back").classList.toggle("hidden", !meta.back);
  $("btn-finish").classList.toggle("hidden", !meta.action);
  if (!meta.brand) $("appbar-title").textContent = meta.titleOverride || meta.title;
}

$("nav-back").onclick = () => {
  const meta = SCREEN_META[currentScreen];
  if (!meta.back) return;
  // 進行中的演練／測驗，離開前先確認
  if (currentScreen === "chat" && state.history.some((m) => m.role === "sales") && !state.evaluation) {
    confirmModal(
      { title: "要離開演練嗎？", body: "目前的對話還沒有評分，離開後紀錄不會保存。", okText: "離開", cancelText: "留下" },
      () => go("home")
    );
    return;
  }
  if (currentScreen === "quiz-play" && state.quizCount > 0) {
    confirmModal(
      { title: "要結束測驗嗎？", body: `目前已作答 ${state.quizCount} 題、答對 ${state.quizCorrect} 題。`, okText: "結束測驗", cancelText: "繼續作答" },
      () => go("quiz-setup")
    );
    return;
  }
  go(meta.back);
};

document.querySelectorAll(".feature-card").forEach((btn) => {
  btn.onclick = () => {
    if (btn.dataset.goto === "qa") resetQa();
    go(btn.dataset.goto);
  };
});

// 進入知識問答前清空上一次的對話與快速提問，回到起始建議畫面
function resetQa() {
  state.qaHistory = [];
  const win = $("qa-window");
  win.innerHTML =
    '<div id="qa-starter" class="qa-starter">' +
    '<p class="qa-starter-title">想問什麼？先從這些方向開始：</p>' +
    '<div id="qa-categories"></div></div>';
  $("qa-chips").classList.add("hidden");
  $("qa-chips").innerHTML = "";
  renderQaStarter();
}

// ───────────────── 通用 UI 元件 ─────────────────
function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 108) + "px";
}

function scrollWin(id) {
  const w = $(id);
  w.scrollTop = w.scrollHeight;
}

function addBubble(role, text, win = "chat-window") {
  const row = document.createElement("div");
  const isLeft = role === "manager" || role === "assistant";
  row.className = `msg-row ${isLeft ? "manager" : "sales"}`;
  const inner = document.createElement("div");
  const speaker = document.createElement("div");
  speaker.className = "speaker";
  speaker.textContent =
    role === "manager" ? "店長" :
    role === "assistant" ? "教育教練" :
    state.name || "你";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  // 全部純文字呈現（AI 已被要求不產生 Markdown）；換行靠 CSS white-space: pre-wrap 保留
  bubble.textContent = text;
  if (role === "assistant") bubble.classList.add("qa-answer");
  inner.appendChild(speaker);
  inner.appendChild(bubble);
  row.appendChild(inner);
  $(win).appendChild(row);
  scrollWin(win);
}

// 「輸入中…」動畫（像通訊軟體）
function showTyping(win, speakerName) {
  hideTyping();
  const row = document.createElement("div");
  row.className = "msg-row manager";
  row.id = "typing-row";
  row.innerHTML =
    `<div><div class="speaker">${esc(speakerName)}</div>` +
    `<div class="bubble typing"><span></span><span></span><span></span></div></div>`;
  $(win).appendChild(row);
  scrollWin(win);
}
function hideTyping() {
  const el = document.getElementById("typing-row");
  if (el) el.remove();
}

// 語音輸入（Web Speech API，zh-TW；不支援的瀏覽器自動隱藏按鈕）
function setupMic(btnId, taId) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $(btnId);
  if (!SR) { btn.classList.add("hidden"); return; }
  let rec = null;
  let active = false;
  btn.onclick = () => {
    if (active) { rec.stop(); return; }
    const ta = $(taId);
    const base = ta.value ? ta.value + (ta.value.endsWith("\n") ? "" : "") : "";
    rec = new SR();
    rec.lang = "zh-TW";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let text = "";
      for (const r of e.results) text += r[0].transcript;
      ta.value = base + text;
      autosize(ta);
    };
    rec.onend = () => { active = false; btn.classList.remove("recording"); };
    rec.onerror = (e) => {
      active = false;
      btn.classList.remove("recording");
      if (e.error === "not-allowed") toast("需要麥克風權限才能使用語音輸入");
    };
    active = true;
    btn.classList.add("recording");
    rec.start();
  };
}

// ═════════════════ 情境演練 ═════════════════
function renderThemes() {
  const wrap = $("theme-list");
  wrap.innerHTML = "";
  CONFIG.themes.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "option-card";
    btn.innerHTML =
      `<span class="o-icon">${t.icon}</span>` +
      `<span class="o-body"><span class="o-name">${esc(t.name)}</span>` +
      `<span class="o-desc">${esc(t.description)}</span></span>`;
    btn.onclick = () => { state.themeId = t.id; go("rp-mode"); };
    wrap.appendChild(btn);
  });
}

function renderModes() {
  const wrap = $("mode-list");
  wrap.innerHTML = "";
  Object.entries(CONFIG.difficulties).forEach(([id, m]) => {
    const btn = document.createElement("button");
    btn.className = "option-card";
    btn.innerHTML =
      `<span class="o-body"><span class="o-name">${esc(m.label)}<span class="o-tag">${esc(m.sub)}</span></span>` +
      `<span class="o-desc">${esc(m.description)}</span></span>`;
    btn.onclick = () => { state.difficulty = id; renderSummary(); go("rp-name"); };
    wrap.appendChild(btn);
  });
}

function renderSummary() {
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  $("rp-summary").innerHTML =
    `<div class="summary-row"><span class="k">演練主題</span><span class="v">${theme.icon} ${esc(theme.name)}</span></div>` +
    `<div class="summary-row"><span class="k">訓練模式</span><span class="v">${esc(diff.label)}（${esc(diff.sub)}）</span></div>`;
}

function getTheme() { return CONFIG.themes.find((t) => t.id === state.themeId); }

$("btn-start").onclick = () => {
  state.name = $("trainee-name").value.trim();
  state.history = [];
  state.feedbacks = [];
  state.evaluation = null;
  state.ended = false;

  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  SCREEN_META.chat.titleOverride = `${theme.name}（${diff.label}）`;
  $("chat-context").textContent = theme.description;
  $("chat-window").innerHTML = "";

  addBubble("manager", theme.opening_by_difficulty[state.difficulty]);
  go("chat");
  $("chat-input").focus();
};

function addCorrectionBanner(note) {
  const div = document.createElement("div");
  div.className = "correction-banner";
  div.innerHTML = `⚠️ <b>即時糾錯</b>：${esc(note)}`;
  $("chat-window").appendChild(div);
  scrollWin("chat-window");
}

function addCoachBox(coaching) {
  const box = document.createElement("div");
  box.className = "coach-box";
  const toggle = document.createElement("button");
  toggle.className = "coach-toggle";
  toggle.textContent = "💡 看看怎麼說可以更好";
  const detail = document.createElement("div");
  detail.className = "coach-detail hidden";
  detail.innerHTML =
    `<div class="c-good">📌 評價：${esc(coaching.comment)}</div>` +
    `<div class="c-improve">▲ 建議：${esc(coaching.suggestion)}</div>` +
    `<span class="c-example">💬 可以這樣說：${esc(coaching.better_example)}</span>`;
  toggle.onclick = () => {
    detail.classList.toggle("hidden");
    toggle.textContent = detail.classList.contains("hidden") ? "💡 看看怎麼說可以更好" : "🔼 收起教練回饋";
  };
  box.appendChild(toggle);
  box.appendChild(detail);
  $("chat-window").appendChild(box);
  scrollWin("chat-window");
}

async function sendMessage() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || state.busy) return;
  if (state.ended) { toast("這段演練已結束，請點右上角「結束並評分」"); return; }
  input.value = "";
  autosize(input);

  state.busy = true;
  $("btn-send").disabled = true;
  state.history.push({ role: "sales", text });
  addBubble("sales", text);
  showTyping("chat-window", "店長");

  try {
    const data = await api("/api/roleplay/turn", {
      themeId: state.themeId,
      difficulty: state.difficulty,
      history: state.history
    });
    hideTyping();
    state.feedbacks.push({ coaching: data.coaching, correction: data.correction });
    if (data.correction && data.correction.triggered) addCorrectionBanner(data.correction.note);
    addCoachBox(data.coaching);
    state.history.push({ role: "manager", text: data.reply });
    addBubble("manager", data.reply);

    if (data.should_end) {
      state.ended = true;
      const note = document.createElement("div");
      note.className = "end-note";
      note.textContent = "🎬 這段演練告一段落了，點右上角「結束並評分」看看你的表現！";
      $("chat-window").appendChild(note);
      scrollWin("chat-window");
    }
  } catch (err) {
    hideTyping();
    toast(err.message);
    state.history.pop();
    input.value = text; // 還原輸入，讓使用者可以直接重送
    autosize(input);
  } finally {
    state.busy = false;
    $("btn-send").disabled = false;
  }
}

$("btn-send").onclick = sendMessage;
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$("chat-input").addEventListener("input", (e) => autosize(e.target));

// ───────────────── 結束演練 → 報告產出進度 ─────────────────
$("btn-finish").onclick = () => {
  if (state.history.filter((m) => m.role === "sales").length < 1) {
    toast("至少要進行一輪對話才能產出報告喔");
    return;
  }
  confirmModal(
    { title: "結束演練並產出報告？", body: "教育長會依這段對話進行五大構面評估，產出正式訓練報告。", okText: "產出報告", cancelText: "繼續練習" },
    runEvaluation
  );
};

const PROGRESS_STEPS = ["整理對話紀錄", "評估五大構面", "檢核關鍵環節", "彙整改善建議", "完成報告"];
let progressTimer = null;

async function runEvaluation() {
  go("progress");
  const list = $("progress-steps");
  list.innerHTML = PROGRESS_STEPS.map((s) => `<li>${esc(s)}</li>`).join("");
  const items = [...list.children];
  const fill = $("progress-fill");
  let step = 0;
  let pct = 10;
  items[0].classList.add("active");
  fill.style.width = pct + "%";
  clearInterval(progressTimer);
  // 步驟依序點亮到倒數第二步；同時進度條「持續」緩慢爬升（漸近逼近 95%），
  // 即使 API 還沒回來也不會看起來卡住不動。
  progressTimer = setInterval(() => {
    if (step < PROGRESS_STEPS.length - 2 && pct > 20 + step * 18) {
      items[step].classList.remove("active");
      items[step].classList.add("done");
      step++;
      items[step].classList.add("active");
    }
    // 每次往「剩餘距離」推進一小段，越接近 95% 走得越慢
    pct = Math.min(95, pct + Math.max(0.4, (95 - pct) * 0.06));
    fill.style.width = pct.toFixed(1) + "%";
  }, 400);

  const minDisplay = new Promise((r) => setTimeout(r, 3200));
  try {
    const [data] = await Promise.all([
      api("/api/roleplay/evaluate", { themeId: state.themeId, difficulty: state.difficulty, history: state.history }),
      minDisplay
    ]);
    clearInterval(progressTimer);
    items.forEach((li) => { li.classList.remove("active"); li.classList.add("done"); });
    fill.style.width = "100%";
    state.evaluation = data;
    setTimeout(() => { renderResult(); go("result"); }, 600);
  } catch (err) {
    clearInterval(progressTimer);
    toast("評分失敗：" + err.message);
    go("chat");
  }
}

// ───────────────── 評估報告畫面 ─────────────────
function renderResult() {
  const ev = state.evaluation;
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  $("result-meta").textContent =
    `${state.name || "未填寫姓名"}｜${todayStr()}｜${theme.name}｜${diff.label}`;
  $("result-total").innerHTML =
    `總分 ${ev.total_score} / 100<span class="level-badge">${esc(ev.level_note)}</span>`;

  const wrap = $("result-scores");
  wrap.innerHTML = "";
  ev.constructs.forEach((c) => {
    const div = document.createElement("div");
    div.className = "score-item";
    div.innerHTML = `
      <div class="sc-head"><span>${markSpan(c.mark)} ${esc(c.name)}</span><span>${c.score} / 20</span></div>
      <div class="score-bar"><div class="score-bar-fill" style="width:${c.score * 5}%"></div></div>
      <div class="sc-comment">${esc(c.observation)}</div>`;
    wrap.appendChild(div);
  });

  $("result-checkpoints").innerHTML = ev.checkpoints
    .map((c) => `<li class="${c.done ? "cp-done" : "cp-miss"}">${c.done ? "✓" : "✗"} ${esc(c.name)}${c.note ? `（${esc(c.note)}）` : ""}</li>`)
    .join("");
  $("result-improvements").innerHTML = ev.improvements.map((m) => `<li>${esc(m)}</li>`).join("");
  $("result-rewrite").textContent = `「${ev.rewrite_example}」`;
  $("result-overall").textContent = ev.overall_judgment;
  $("result-steps").innerHTML = ev.next_steps
    .map((s) => `<tr><td>${esc(s.direction)}</td><td>${esc(s.method)}</td></tr>`)
    .join("");
}

function markSpan(mark) {
  const cls = mark === "◎" ? "mk-good" : mark === "○" ? "mk-ok" : "mk-weak";
  return `<span class="${cls}">${mark}</span>`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// ───────────────── 報告下載與分享 ─────────────────
function reportPayload() {
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  const rounds = [];
  let current = null;
  state.history.forEach((m) => {
    if (m.role === "sales") {
      current = { no: rounds.length + 1, sales: m.text, manager: "" };
      rounds.push(current);
    } else if (current) {
      current.manager = m.text;
    }
  });
  return {
    name: state.name,
    date: todayStr(),
    modeLabel: diff.label,
    themeName: theme.name,
    situation: theme.description,
    rounds,
    evaluation: state.evaluation
  };
}

async function downloadReport(type, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "產生中…";
  try {
    const blob = await apiBlob(`/api/report/${type}`, reportPayload());
    const filename = `OrightPRO業務訓練評估報告_${state.name || "業務夥伴"}_${todayStr().replaceAll("/", "")}.${type === "pdf" ? "pdf" : "docx"}`;
    triggerDownload(blob, filename);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$("btn-pdf").onclick = (e) => downloadReport("pdf", e.currentTarget);
$("btn-docx").onclick = (e) => downloadReport("docx", e.currentTarget);

$("btn-share").onclick = async (e) => {
  const btn = e.currentTarget;
  const ev = state.evaluation;
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  const summary =
    `【O'right｜PRO 業務訓練評估報告】\n` +
    `業務夥伴：${state.name || "未填寫"}\n日期：${todayStr()}\n` +
    `主題：${theme.name}（${diff.label}）\n總分：${ev.total_score} / 100（${ev.level_note}）\n` +
    ev.constructs.map((c) => `・${c.name}：${c.mark} ${c.score}/20`).join("\n") +
    `\n整體判斷：${ev.overall_judgment}`;

  btn.disabled = true;
  btn.textContent = "準備中…";
  try {
    const blob = await apiBlob("/api/report/pdf", reportPayload());
    const file = new File([blob], `OrightPRO訓練報告_${state.name || "業務夥伴"}.pdf`, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "O'right｜PRO 業務訓練評估報告", text: summary, files: [file] });
      return;
    }
    await navigator.clipboard.writeText(summary);
    toast("此裝置不支援直接分享檔案，已將報告摘要複製到剪貼簿，可貼到 LINE 群組");
  } catch (err) {
    if (err.name !== "AbortError") {
      try {
        await navigator.clipboard.writeText(summary);
        toast("已將報告摘要複製到剪貼簿，可貼到 LINE 群組");
      } catch { toast(err.message); }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "分享給主管";
  }
};

$("btn-restart").onclick = () => go("rp-theme");

// ═════════════════ 知識問答 ═════════════════
function renderQaStarter() {
  const wrap = $("qa-categories");
  wrap.innerHTML = "";
  (CONFIG.qaSuggestions || []).forEach((cat) => {
    const sec = document.createElement("div");
    sec.className = "qa-cat";
    const header = document.createElement("div");
    header.className = "qa-cat-label";
    header.innerHTML = `<span class="qa-cat-icon">${cat.icon}</span>${esc(cat.label)}`;
    const chips = document.createElement("div");
    chips.className = "qa-cat-chips";
    cat.questions.forEach((q) => {
      const btn = document.createElement("button");
      btn.className = "qa-chip";
      btn.textContent = q;
      btn.onclick = () => sendQa(q);
      chips.appendChild(btn);
    });
    sec.appendChild(header);
    sec.appendChild(chips);
    wrap.appendChild(sec);
  });
}

function renderQaChips() {
  const bar = $("qa-chips");
  bar.innerHTML = "";
  const all = (CONFIG.qaSuggestions || []).flatMap((c) => c.questions);
  // 隨機挑 6 個當快速提問
  const picked = all.sort(() => Math.random() - 0.5).slice(0, 6);
  picked.forEach((q) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = q;
    chip.onclick = () => sendQa(q);
    bar.appendChild(chip);
  });
  bar.classList.remove("hidden");
}

async function sendQa(presetText) {
  const input = $("qa-input");
  const text = (presetText || input.value).trim();
  if (!text || state.busy) return;
  if (!presetText) { input.value = ""; autosize(input); }

  // 第一次發問後收起起始建議、改顯示快速提問列
  const starter = $("qa-starter");
  if (starter) starter.remove();
  if ($("qa-chips").classList.contains("hidden")) renderQaChips();

  state.busy = true;
  $("btn-qa-send").disabled = true;
  state.qaHistory.push({ role: "user", text });
  addBubble("user", text, "qa-window");
  showTyping("qa-window", "教育教練");

  try {
    const data = await api("/api/qa", { history: state.qaHistory });
    hideTyping();
    state.qaHistory.push({ role: "assistant", text: data.answer });
    addBubble("assistant", data.answer, "qa-window");
  } catch (err) {
    hideTyping();
    toast(err.message);
    state.qaHistory.pop();
  } finally {
    state.busy = false;
    $("btn-qa-send").disabled = false;
  }
}

$("btn-qa-send").onclick = () => sendQa();
$("qa-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQa(); }
});
$("qa-input").addEventListener("input", (e) => autosize(e.target));

// ═════════════════ 隨機測驗 ═════════════════
function renderQuizModules() {
  const wrap = $("quiz-module-list");
  wrap.innerHTML = "";
  const all = [{ id: "random", name: "綜合隨機", scope: "從七大模組隨機抽題，最接近實戰", icon: "🎲" }, ...CONFIG.quizModules.map((m) => ({ ...m, icon: "📖" }))];
  all.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "option-card";
    btn.innerHTML =
      `<span class="o-icon">${m.icon}</span>` +
      `<span class="o-body"><span class="o-name">${esc(m.name)}</span>` +
      `<span class="o-desc">${esc(m.scope)}</span></span>`;
    btn.onclick = () => startQuiz(m.id, m.name);
    wrap.appendChild(btn);
  });
}

function startQuiz(moduleId, moduleLabel) {
  state.quizModule = moduleId;
  state.quizModuleLabel = moduleLabel;
  state.quizAsked = [];
  state.quizCount = 0;
  state.quizCorrect = 0;
  state.quizPrefetch = null;
  state.quizItems = [];
  go("quiz-play");
  loadQuestion();
}

function fetchQuestion() {
  return api("/api/quiz/next", { module: state.quizModule, asked: state.quizAsked });
}

async function loadQuestion() {
  $("quiz-feedback").classList.add("hidden");
  $("btn-quiz-next").classList.add("hidden");
  $("quiz-answer-block").classList.remove("hidden");
  $("btn-quiz-submit").classList.remove("hidden");
  $("btn-quiz-submit").disabled = true;
  $("quiz-answer").value = "";
  $("quiz-answer").disabled = false;
  autosize($("quiz-answer"));
  // 出題時的骨架動畫
  $("quiz-question").innerHTML =
    `<div class="q-loading"><span class="dots"><span></span><span></span><span></span></span> 出題中…</div>` +
    `<div class="skeleton w60"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  $("quiz-progress").textContent = state.quizCount > 0
    ? `第 ${state.quizCount + 1} 題｜前 ${state.quizCount} 題答對 ${state.quizCorrect} 題`
    : "第 1 題";

  try {
    // 優先使用背景預載好的題目（幾乎零等待）
    const data = state.quizPrefetch ? await state.quizPrefetch : await fetchQuestion();
    state.quizPrefetch = null;
    state.quizQuestion = data;
    state.quizAsked.push(data.question);
    state.quizCount++;
    $("quiz-question").innerHTML =
      `<div class="q-tag">${esc(data.module)}｜${esc(data.type)}</div><div class="q-text">${esc(data.question)}</div>`;
    $("btn-quiz-submit").disabled = false;
    $("quiz-answer").focus();
    // 立刻在背景預載下一題，按「下一題」時不用等
    state.quizPrefetch = fetchQuestion().catch(() => null);
  } catch (err) {
    toast("出題失敗：" + err.message);
    go("quiz-setup");
  }
}

$("btn-quiz-submit").onclick = async () => {
  const answer = $("quiz-answer").value.trim();
  if (!answer) { toast("請先輸入回答"); return; }
  if (state.busy) return;
  state.busy = true;
  $("quiz-answer").disabled = true;
  // 批改中動畫（取代靜態的按鈕文字）
  $("btn-quiz-submit").classList.add("hidden");
  $("quiz-feedback").classList.remove("hidden");
  $("quiz-feedback").innerHTML =
    `<div class="qf-grading"><span class="dots"><span></span><span></span><span></span></span> 教練批改中…</div>`;

  try {
    const data = await api("/api/quiz/grade", { question: state.quizQuestion, answer });
    if (data.correct) state.quizCorrect++;
    // 記錄作答歷史（供產出測驗報告）
    state.quizItems.push({
      no: state.quizCount,
      module: state.quizQuestion.module,
      type: state.quizQuestion.type,
      question: state.quizQuestion.question,
      my_answer: answer,
      comment: data.comment,
      level: data.level,
      reference_answer: data.reference_answer,
      correct: data.correct
    });
    $("quiz-progress").textContent = `第 ${state.quizCount} 題｜答對 ${state.quizCorrect} 題`;
    $("quiz-feedback").innerHTML =
      `<div class="qf-head ${data.correct ? "qf-ok" : "qf-no"}">${data.correct ? "✓ 掌握不錯" : "△ 還要加強"}<span class="level-badge">${esc(data.level)}</span></div>` +
      `<div class="qf-comment">${esc(data.comment)}</div>` +
      `<div class="qf-ref"><b>參考回答方向：</b>${esc(data.reference_answer)}</div>`;
    $("btn-quiz-next").classList.remove("hidden");
    $("quiz-feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    toast("批改失敗：" + err.message);
    $("quiz-answer").disabled = false;
    $("btn-quiz-submit").classList.remove("hidden");
    $("quiz-feedback").classList.add("hidden");
  } finally {
    state.busy = false;
  }
};

$("btn-quiz-next").onclick = loadQuestion;

$("btn-quiz-finish").onclick = () => {
  if (state.quizItems.length === 0) {
    confirmModal(
      { title: "還沒有作答紀錄", body: "尚未完成任何一題，確定要離開測驗嗎？", okText: "離開", cancelText: "繼續作答" },
      () => go("quiz-setup")
    );
    return;
  }
  renderQuizResult();
  go("quiz-result");
};

function renderQuizResult() {
  const total = state.quizItems.length;
  const correct = state.quizItems.filter((it) => it.correct).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  $("quiz-result-meta").textContent = `${state.name || "業務夥伴"}｜${todayStr()}｜${state.quizModuleLabel}`;
  $("quiz-result-score").innerHTML = `答對 ${correct} / ${total} 題<span class="level-badge">${pct}%</span>`;
  $("quiz-result-bar").innerHTML = `<div class="qr-bar"><div class="qr-bar-fill" style="width:${pct}%"></div></div>`;
  $("quiz-result-items").innerHTML = state.quizItems.map((it) =>
    `<div class="qr-item">` +
    `<div class="qr-item-head ${it.correct ? "qf-ok" : "qf-no"}">${it.correct ? "✓" : "△"} 第 ${it.no} 題　<span class="qr-tag">${esc(it.module)}</span></div>` +
    `<div class="qr-q">${esc(it.question)}</div>` +
    `<div class="qr-a"><b>你的回答：</b>${esc(it.my_answer)}</div>` +
    `<div class="qr-c">${esc(it.comment)}</div>` +
    `</div>`
  ).join("");
}

$("btn-quiz-again").onclick = () => go("quiz-setup");

$("btn-quiz-report").onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "產生中…";
  try {
    const total = state.quizItems.length;
    const correct = state.quizItems.filter((it) => it.correct).length;
    const blob = await apiBlob("/api/quiz/report", {
      name: state.name,
      date: todayStr(),
      moduleLabel: state.quizModuleLabel,
      total, correct,
      items: state.quizItems
    });
    triggerDownload(blob, `OrightPRO測驗報告_${state.name || "業務夥伴"}_${todayStr().replaceAll("/", "")}.docx`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "下載測驗報告";
  }
};

// ═════════════════ 初始化 ═════════════════
async function init() {
  try {
    CONFIG = await api("/api/config");
  } catch (err) {
    toast("無法連線到伺服器，請重新整理頁面");
    return;
  }
  if (CONFIG.demo) $("demo-badge").classList.remove("hidden");
  renderThemes();
  renderModes();
  renderQaStarter();
  renderQuizModules();
  setupMic("mic-chat", "chat-input");
  setupMic("mic-qa", "qa-input");
  setupMic("mic-quiz", "quiz-answer");
}

init();
