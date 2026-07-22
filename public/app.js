// O'right｜PRO 業務教育教練 — 前端邏輯（手機優先版）
// 若頁面載入了 demo-data.js（GitHub Pages 靜態展示版），所有 API 呼叫會改走固定腳本。
let CONFIG = null;

const state = {
  // 情境演練
  themeId: null,
  customTopic: "",
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
  // 指定演練
  assignActive: [],   // 開放中的題目
  assignCurrent: null,
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
  "rp-custom":  { title: "自訂題目", back: "rp-theme" },
  "rp-mode":    { title: "情境演練", back: "rp-theme" },
  "rp-name":    { title: "情境演練", back: "rp-mode" },
  "chat":       { title: "", back: "home", action: true },
  "progress":   { title: "產出報告" },
  "result":     { title: "訓練評估報告", back: "home" },
  "qa":         { title: "知識問答", back: "home" },
  "quiz-setup":  { title: "隨機測驗", back: "home" },
  "quiz-play":   { title: "隨機測驗", back: "quiz-setup" },
  "quiz-result": { title: "測驗成績", back: "home" },
  "assign-list":   { title: "指定演練", back: "home" },
  "assign-do":     { title: "指定演練", back: "assign-list" },
  "assign-result": { title: "演練成績", back: "home" },
  "report":      { title: "報表", back: "home" }
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
  // 報表 icon 只在首頁顯示（避免演練/報告畫面誤觸）
  $("btn-report").classList.toggle("hidden", name !== "home");
  if (!meta.brand) $("appbar-title").textContent = meta.titleOverride || meta.title;
  // 回首頁時刷新指定演練卡（主管剛出題／關題，回首頁就看得到，不用重整）
  if (name === "home" && CONFIG) refreshAssignCard();
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
    if (btn.dataset.goto === "assign-list") renderAssignList();
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
    btn.onclick = () => { state.themeId = t.id; state.customTopic = ""; go("rp-mode"); };
    wrap.appendChild(btn);
  });
  // 自訂題目：讓業務針對單一品項或活動自訂情境
  const custom = document.createElement("button");
  custom.className = "option-card";
  custom.innerHTML =
    `<span class="o-icon">✏️</span>` +
    `<span class="o-body"><span class="o-name">自訂題目</span>` +
    `<span class="o-desc">自己出題：針對某個產品、活動或顧客狀況，設定想練的情境。</span></span>`;
  custom.onclick = () => { state.themeId = "custom"; $("custom-topic").value = state.customTopic || ""; go("rp-custom"); };
  wrap.appendChild(custom);
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
    (state.themeId === "custom"
      ? `<div class="summary-row"><span class="k">自訂題目</span><span class="v">${esc(state.customTopic)}</span></div>`
      : "") +
    `<div class="summary-row"><span class="k">訓練模式</span><span class="v">${esc(diff.label)}（${esc(diff.sub)}）</span></div>`;
}

// 取得目前主題；自訂題目回傳合成物件（名稱固定、描述＝使用者輸入的題目）
function getTheme() {
  if (state.themeId === "custom") {
    return { id: "custom", icon: "✏️", name: "自訂題目", description: state.customTopic || "自訂情境" };
  }
  return CONFIG.themes.find((t) => t.id === state.themeId);
}

// 自訂題目：輸入題目後進入選模式
$("btn-custom-next").onclick = () => {
  const topic = $("custom-topic").value.trim();
  if (!topic) { toast("請先輸入你想練習的題目或情境"); return; }
  state.customTopic = topic;
  go("rp-mode");
};

$("btn-start").onclick = () => {
  state.name = $("trainee-name").value.trim();
  state.history = [];
  state.feedbacks = [];
  state.evaluation = null;
  state.ended = false;

  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  SCREEN_META.chat.titleOverride = `${theme.name}（${diff.label}）`;
  $("chat-context").textContent = state.themeId === "custom" ? `自訂題目：${theme.description}` : theme.description;
  $("chat-window").innerHTML = "";

  // 自訂題目沒有預設開場白，用一句通用開場（後續由 AI 依題目與難度接續）
  const CUSTOM_OPENING = {
    beginner: "你好你好，請坐～今天想跟我聊什麼？",
    intermediate: "你好，今天來是有什麼事嗎？",
    advanced: "（正在忙）嗯，你說，今天什麼事？我時間不多。"
  };
  const opening = state.themeId === "custom"
    ? CUSTOM_OPENING[state.difficulty]
    : theme.opening_by_difficulty[state.difficulty];
  addBubble("manager", opening);
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
    `<div class="c-improve">▲ 調整建議：${esc(coaching.suggestion)}</div>` +
    `<span class="c-example">💬 這句可以這樣講：${esc(coaching.better_example)}</span>`;
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
      history: state.history,
      customTopic: state.customTopic
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
    { title: "結束演練並產出報告？", body: "Jenny 老師會依這段對話進行五大構面評估，產出正式訓練報告。", okText: "產出報告", cancelText: "繼續練習" },
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
      api("/api/roleplay/evaluate", { themeId: state.themeId, difficulty: state.difficulty, history: state.history, customTopic: state.customTopic }),
      minDisplay
    ]);
    clearInterval(progressTimer);
    items.forEach((li) => { li.classList.remove("active"); li.classList.add("done"); });
    fill.style.width = "100%";
    state.evaluation = data;
    submitRecord(data);   // 歸檔：寫入後台紀錄（供報表與 n8n）
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

// 歸檔：評分完成後把紀錄（含逐字稿）送到後端，供報表後台與 n8n。失敗不影響使用者流程。
function submitRecord(evaluation) {
  try {
    const p = reportPayload();
    api("/api/records", {
      name: state.name,
      themeName: p.themeName,
      modeLabel: p.modeLabel,
      evaluation,
      transcript: p.rounds
    }).catch(() => {});
  } catch { /* 靜默 */ }
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
  const qn = $("quiz-name").value.trim();
  if (qn) state.name = qn;
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
  // 非阻塞歸檔測驗成績（供主管報表與 Google Sheet），失敗不影響使用者
  api("/api/quiz/record", {
    name: state.name,
    moduleLabel: state.quizModuleLabel,
    total: state.quizItems.length,
    correct: state.quizItems.filter((it) => it.correct).length,
    items: state.quizItems.map((it) => ({ question: it.question, correct: it.correct }))
  }).catch(() => {});
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

// ═════════════════ 指定演練（業務：看題→錄/傳音檔→轉寫→評分） ═════════════════
const MARK_CLASS = (m) => (m === "◎" ? "mk-good" : m === "○" ? "mk-ok" : "mk-weak");

function renderAssignList() {
  const wrap = $("assign-list");
  wrap.innerHTML = `<p class="hint">載入中…</p>`;
  api("/api/assignments/active").then((d) => {
    state.assignActive = d.assignments || [];
    if (!state.assignActive.length) {
      wrap.innerHTML = `<p class="hint">目前沒有開放中的指定演練。等主管出題後再來看看。</p>`;
      return;
    }
    wrap.innerHTML = "";
    state.assignActive.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "option-card";
      btn.innerHTML =
        `<span class="o-icon">🎯</span>` +
        `<span class="o-body"><span class="o-name">${esc(a.title)}</span>` +
        `<span class="o-desc">${esc((a.brief || "").slice(0, 60))}${(a.brief || "").length > 60 ? "…" : ""}　·　建議 ${a.minutes || 5} 分鐘</span></span>`;
      btn.onclick = () => startAssignment(a);
      wrap.appendChild(btn);
    });
  }).catch((err) => { wrap.innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`; });
}

function startAssignment(a) {
  state.assignCurrent = a;
  $("assign-do-title").textContent = a.title;
  $("assign-do-meta").textContent = `建議演練時間 ${a.minutes || 5} 分鐘`;
  $("assign-do-brief").textContent = a.brief || "";
  $("assign-name").value = state.name || "";
  $("assign-transcript").value = "";
  $("assign-transcribe-msg").textContent = "";
  $("assign-audio").value = "";
  go("assign-do");
}

// 音檔上傳 → base64 → 後端 Whisper 轉逐字稿
$("assign-audio").onchange = async () => {
  const file = $("assign-audio").files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast("音檔超過 25MB，請壓縮或縮短"); return; }
  const box = $("assign-upload-box");
  const msg = $("assign-transcribe-msg");
  box.classList.add("uploading");
  msg.textContent = "🎧 轉寫中…（音檔越長越久，請稍候）";
  try {
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const d = await api("/api/transcribe", { audio: b64, filename: file.name });
    const ta = $("assign-transcript");
    ta.value = (ta.value ? ta.value + "\n" : "") + (d.transcript || "");
    autosize(ta);
    msg.textContent = "✓ 已轉成逐字稿，請確認內容（可修正錯字）後送出評分。";
  } catch (err) {
    msg.textContent = "轉寫失敗：" + err.message;
  } finally {
    box.classList.remove("uploading");
  }
};

$("btn-assign-submit").onclick = async (e) => {
  const name = $("assign-name").value.trim();
  const transcript = $("assign-transcript").value.trim();
  if (!name) { toast("請填寫姓名"); return; }
  if (!transcript) { toast("請先上傳音檔或輸入逐字稿"); return; }
  state.name = name;
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "評分中…";
  try {
    const d = await api("/api/assignment/submit", {
      assignmentId: state.assignCurrent.id, name, transcript
    });
    renderAssignResult(d.evaluation);
    go("assign-result");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "送出評分";
  }
};

function renderAssignResult(ev) {
  $("assign-result-meta").textContent = `${state.name}｜${state.assignCurrent.title}｜${todayStr()}`;
  $("assign-result-total").innerHTML = `${ev.total_score} 分<span class="level-badge">${esc(ev.level || "")}</span>`;
  $("assign-result-criteria").innerHTML = (ev.criteria_scores || []).map((c) =>
    `<div class="score-item"><div class="sc-head"><span>${esc(c.point)}</span><span class="${MARK_CLASS(c.mark)}">${c.mark}</span></div>` +
    `<div class="sc-comment">${esc(c.comment)}</div></div>`
  ).join("") || `<p class="hint">—</p>`;
  $("assign-result-constructs").innerHTML = (ev.construct_scores || []).map((c) =>
    `<div class="score-item"><div class="sc-head"><span>${esc(c.name)}</span><span><span class="${MARK_CLASS(c.mark)}">${c.mark}</span>　${c.score}/20</span></div></div>`
  ).join("") || `<p class="hint">—</p>`;
  $("assign-result-strengths").innerHTML = (ev.strengths || []).map((s) => `<li>${esc(s)}</li>`).join("") || `<li class="hint">—</li>`;
  $("assign-result-improvements").innerHTML = (ev.improvements || []).map((s) => `<li>${esc(s)}</li>`).join("") || `<li class="hint">—</li>`;
  $("assign-result-overall").textContent = ev.overall || "";
}

$("btn-assign-again").onclick = () => { renderAssignList(); go("assign-list"); };
$("btn-assign-home").onclick = () => go("home");

// ═════════════════ 報表後台（主管＝分數彙整；管理員＝全部分頁） ═════════════════
let reportPw = "";   // 解鎖後暫存密碼，供後台 API 沿用
let reportRole = ""; // "viewer"（主管）或 "admin"（管理員）
const REPORT_PW_KEY = "oright-report-pw";   // 記在 sessionStorage：同分頁有效、關閉分頁即清除

function showReportLock() {
  reportPw = "";
  reportRole = "";
  try { sessionStorage.removeItem(REPORT_PW_KEY); } catch {}
  $("report-lock").classList.remove("hidden");
  $("report-content").classList.add("hidden");
  $("report-pw").value = "";
  document.querySelectorAll(".admin-tab").forEach((t) => t.classList.add("hidden"));
}

// 用密碼解鎖（手動輸入或 sessionStorage 記住的都走這裡，每次都經伺服器驗證）
async function unlockWith(pw, { silent = false } = {}) {
  try {
    const data = await api("/api/report/dashboard", { password: pw });
    reportPw = pw;
    reportRole = data.role || "admin";
    try { sessionStorage.setItem(REPORT_PW_KEY, pw); } catch {}
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("hidden", reportRole !== "admin"));
    renderDashboard(data);
    $("report-lock").classList.add("hidden");
    $("report-content").classList.remove("hidden");
    return true;
  } catch (err) {
    try { sessionStorage.removeItem(REPORT_PW_KEY); } catch {}
    if (!silent) toast(err.message === "密碼錯誤" ? "密碼錯誤，請再試一次" : ("讀取失敗：" + err.message));
    return false;
  }
}

$("btn-report").onclick = async () => {
  switchReportTab("scores");
  go("report");
  // 這個分頁已經登入過就直接進（仍會重新向伺服器驗證一次）；沒有才要求輸入密碼
  const saved = (() => { try { return sessionStorage.getItem(REPORT_PW_KEY) || ""; } catch { return ""; } })();
  if (saved && await unlockWith(saved, { silent: true })) return;
  showReportLock();
  $("report-pw").focus();
};

async function unlockReport() {
  const pw = $("report-pw").value.trim();
  if (!pw) { toast("請輸入密碼"); return; }
  const btn = $("btn-report-unlock");
  btn.disabled = true;
  btn.textContent = "驗證中…";
  await unlockWith(pw);
  btn.disabled = false;
  btn.textContent = "進入報表";
}
$("btn-report-unlock").onclick = unlockReport;
$("report-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockReport(); });
$("btn-report-logout").onclick = () => { showReportLock(); toast("已登出報表"); $("report-pw").focus(); };

// ── 報表分頁切換 ──
const REPORT_TABS = ["scores", "assign", "kb", "admin", "backup"];
function switchReportTab(which) {
  REPORT_TABS.forEach((t) => {
    $("tab-" + t).classList.toggle("active", t === which);
    $("pane-" + t).classList.toggle("hidden", t !== which);
  });
  if (which === "assign") loadAssignAdmin();
  if (which === "kb") loadKbList();
  if (which === "admin") loadAdmin();
  if (which === "backup") loadBackup();
}
REPORT_TABS.forEach((t) => { $("tab-" + t).onclick = () => switchReportTab(t); });

// ── 指定演練（後台：出題／檢視繳交／核可優良話術）──
function loadAssignAdmin() {
  const box = $("asg-list");
  box.innerHTML = `<p class="hint">載入中…</p>`;
  $("asg-subs-block").style.display = "none";
  api("/api/admin/assignments", { password: reportPw }).then((d) => {
    const list = d.assignments || [];
    if (!list.length) { box.innerHTML = `<p class="hint">還沒有題目，用上方表單發布第一題。</p>`; return; }
    box.innerHTML = list.map((a) =>
      `<div class="asg-item">` +
      `<div class="asg-item-main"><div class="asg-item-title">${esc(a.title)} ${a.active ? '<span class="asg-on">開放中</span>' : '<span class="asg-off">已關閉</span>'}</div>` +
      `<div class="asg-item-sub">${a.submissionCount || 0} 份繳交　·　建議 ${a.minutes || 5} 分鐘</div></div>` +
      `<div class="asg-item-actions">` +
      `<button class="kb-btn" data-subs="${esc(a.id)}">繳交</button>` +
      `<button class="kb-btn" data-edit="${esc(a.id)}">編輯</button>` +
      `<button class="kb-btn kb-del" data-del="${esc(a.id)}">刪除</button>` +
      `</div></div>`
    ).join("");
    box.querySelectorAll("[data-subs]").forEach((b) => b.onclick = () => loadAssignSubs(b.dataset.subs, list.find((x) => x.id === b.dataset.subs)));
    box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => editAssignment(list.find((x) => x.id === b.dataset.edit)));
    box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => deleteAssignment(b.dataset.del, list.find((x) => x.id === b.dataset.del)));
  }).catch((err) => { box.innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`; });
}

function resetAsgForm() {
  $("asg-id").value = "";
  $("asg-title").value = "";
  $("asg-brief").value = "";
  $("asg-focus").value = "";
  $("asg-minutes").value = "5";
  $("asg-active").checked = true;
  $("btn-asg-save").textContent = "發布題目";
  $("btn-asg-cancel").classList.add("hidden");
  $("asg-msg").textContent = "";
}

function editAssignment(a) {
  if (!a) return;
  $("asg-id").value = a.id;
  $("asg-title").value = a.title || "";
  $("asg-brief").value = a.brief || "";
  $("asg-focus").value = a.focus || "";
  $("asg-minutes").value = a.minutes || 5;
  $("asg-active").checked = a.active !== false;
  $("btn-asg-save").textContent = "儲存修改";
  $("btn-asg-cancel").classList.remove("hidden");
  $("asg-title").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("btn-asg-cancel").onclick = resetAsgForm;

$("btn-asg-save").onclick = async (e) => {
  const title = $("asg-title").value.trim();
  if (!title) { toast("請填題目名稱"); return; }
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "發布中…";
  try {
    const r = await api("/api/admin/assignment/save", {
      password: reportPw,
      id: $("asg-id").value || undefined,
      title,
      brief: $("asg-brief").value.trim(),
      focus: $("asg-focus").value.trim(),
      minutes: Number($("asg-minutes").value) || 5,
      active: $("asg-active").checked
    });
    $("asg-msg").textContent = `✓ 已發布「${r.assignment.title}」${r.persisted ? "，已永久保存" : "（未設 GITHUB_TOKEN，重新部署後會還原）"}。`;
    resetAsgForm();
    loadAssignAdmin();
    refreshAssignCard();   // 首頁的指定演練卡立即更新
  } catch (err) {
    $("asg-msg").textContent = "發布失敗：" + err.message;
  } finally {
    btn.disabled = false; btn.textContent = $("asg-id").value ? "儲存修改" : "發布題目";
  }
};

function deleteAssignment(id, a) {
  confirmModal({
    title: "刪除題目？", body: `確定刪除「${a ? a.title : ""}」？已繳交的紀錄會保留，但業務不會再看到這題。`,
    okText: "刪除", cancelText: "取消"
  }, async () => {
    try { await api("/api/admin/assignment/delete", { password: reportPw, id }); toast("已刪除"); loadAssignAdmin(); refreshAssignCard(); }
    catch (err) { toast("刪除失敗：" + err.message); }
  });
}

let currentSubsAssignment = null;
function loadAssignSubs(assignmentId, a) {
  currentSubsAssignment = a || { id: assignmentId };
  const block = $("asg-subs-block");
  block.style.display = "";
  $("asg-subs-title").textContent = `繳交紀錄：${a ? a.title : ""}`;
  $("asg-subs").innerHTML = `<p class="hint">載入中…</p>`;
  block.scrollIntoView({ behavior: "smooth", block: "start" });
  api("/api/admin/submissions", { password: reportPw, assignmentId }).then((d) => {
    const subs = d.submissions || [];
    currentSubsList = subs;
    if (!subs.length) { $("asg-subs").innerHTML = `<p class="hint">尚無繳交。</p>`; return; }
    $("asg-subs").innerHTML = subs.map((s) => renderSubCard(s)).join("") + subActionsHtml(subs);
    wireSubCards();
  }).catch((err) => { $("asg-subs").innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`; });
}

let currentSubsList = [];   // 目前顯示中的繳交清單（供匯出／批次收錄）

function renderSubCard(s) {
  const state1 = s.approved ? `<span class="asg-on">已收錄</span>` : s.nominated ? `<span class="asg-nom">優良</span>` : "";
  const check = s.approved
    ? ""
    : `<label class="sub-check"><input type="checkbox" data-nominate="${esc(s.id)}" ${s.nominated ? "checked" : ""} /><span>優良</span></label>`;
  return `<div class="sub-card">` +
    `<div class="sub-head"><span>${check}<b>${esc(s.name)}</b>　${s.total_score}分 <span class="lv-badge">${esc(s.level || "")}</span> ${state1}</span>` +
    `<span class="sub-date">${fmtDateTime(s.date)}</span></div>` +
    `<button class="kb-btn sub-view" data-view='${esc(s.id)}'>看逐字稿與評分</button>` +
    `<div class="sub-detail hidden" id="subd-${esc(s.id)}"><pre class="sub-transcript">${esc(s.transcript)}</pre></div>` +
    `</div>`;
}

// 勾選＝標記優良（即存檔）。流程：勾選 → 匯出文字檔給高層過目 → 確認後「將勾選收錄進知識庫」
function subActionsHtml(subs) {
  const picked = subs.filter((s) => s.nominated && !s.approved).length;
  return `<div class="sub-actions">` +
    `<button id="btn-subs-export" class="btn-outline" ${picked ? "" : "disabled"}>匯出勾選的話術（${picked}）</button>` +
    `<button id="btn-subs-collect" class="btn-primary" ${picked ? "" : "disabled"}>將勾選收錄進知識庫</button>` +
    `</div>` +
    `<p class="hint">勾「優良」即儲存標記 → 「匯出」下載文字檔，整理後在群組或會議給高層過目 → 確認後「收錄」寫進知識庫，AI 之後會參考這些示範。</p>`;
}

function wireSubCards() {
  const box = $("asg-subs");
  box.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => {
    const d = $("subd-" + b.dataset.view);
    d.classList.toggle("hidden");
    b.textContent = d.classList.contains("hidden") ? "看逐字稿與評分" : "收起";
  });
  box.querySelectorAll("[data-nominate]").forEach((cb) => cb.onchange = async () => {
    try {
      await api("/api/admin/submission/nominate", { password: reportPw, id: cb.dataset.nominate, nominate: cb.checked });
      reloadCurrentSubs();
    } catch (err) { toast(err.message); cb.checked = !cb.checked; }
  });
  const exportBtn = $("btn-subs-export");
  if (exportBtn) exportBtn.onclick = () => {
    const picked = currentSubsList.filter((s) => s.nominated && !s.approved);
    if (!picked.length) return;
    const text = `【指定演練優良話術】${currentSubsAssignment ? currentSubsAssignment.title : ""}\n匯出時間：${fmtDateTime(new Date().toISOString())}\n\n` +
      picked.map((s, i) =>
        `${i + 1}. ${s.name}（${fmtDateTime(s.date)}，${s.total_score}分／${s.level}）\n${"-".repeat(24)}\n${s.transcript.trim()}\n`
      ).join("\n");
    triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), `優良話術_${todayStr().replaceAll("/", "")}.txt`);
  };
  const collectBtn = $("btn-subs-collect");
  if (collectBtn) collectBtn.onclick = () => {
    const picked = currentSubsList.filter((s) => s.nominated && !s.approved);
    if (!picked.length) return;
    confirmModal({
      title: `收錄 ${picked.length} 段話術？`,
      body: "收錄後會寫進知識庫「優良話術示範」，供 AI 問答與演練回饋參考。建議先匯出給高層過目確認後再收錄。",
      okText: "確認收錄", cancelText: "取消"
    }, async () => {
      let ok = 0, fail = 0;
      for (const s of picked) {
        try { await api("/api/admin/submission/approve", { password: reportPw, id: s.id }); ok++; }
        catch { fail++; }
      }
      toast(fail ? `已收錄 ${ok} 段，${fail} 段失敗` : `✓ 已收錄 ${ok} 段進知識庫`);
      reloadCurrentSubs();
    });
  };
}

function reloadCurrentSubs() {
  if (currentSubsAssignment) loadAssignSubs(currentSubsAssignment.id, currentSubsAssignment);
}

// ── 系統管理 ──
async function loadAdmin() {
  $("audit-list").innerHTML = `<p class="hint">載入中…</p>`;
  try {
    const d = await api("/api/admin/overview", { password: reportPw });
    $("flag-roleplay").checked = d.flags.roleplay !== false;
    $("flag-qa").checked = d.flags.qa !== false;
    $("flag-quiz").checked = d.flags.quiz !== false;
    $("flag-announcement").value = d.flags.announcement || "";
    $("roster-edit").value = (d.roster || []).join("\n");
    renderAudit(d.audit || []);
  } catch (err) {
    $("audit-list").innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`;
  }
}

function renderAudit(list) {
  if (!list.length) {
    $("audit-list").innerHTML = `<p class="hint">目前沒有紀錄。</p>`;
    return;
  }
  const rows = list.map((a) =>
    `<tr><td class="audit-time">${fmtDateTime(a.time)}</td>` +
    `<td><span class="audit-tag">${esc(a.action)}</span></td>` +
    `<td>${esc(a.detail || "—")}</td>` +
    `<td>${a.role === "admin" ? "管理員" : a.role === "viewer" ? "主管" : "—"}</td></tr>`
  ).join("");
  $("audit-list").innerHTML =
    `<div class="table-scroll"><table class="report-table audit-table">` +
    `<thead><tr><th>時間</th><th>動作</th><th>內容</th><th>身分</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

$("btn-flags-save").onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "儲存中…";
  $("flags-msg").textContent = "";
  try {
    const r = await api("/api/admin/flags", {
      password: reportPw,
      flags: {
        roleplay: $("flag-roleplay").checked,
        qa: $("flag-qa").checked,
        quiz: $("flag-quiz").checked,
        announcement: $("flag-announcement").value.trim()
      }
    });
    $("flags-msg").textContent = `✓ 已儲存並立即生效${r.persisted ? "，已永久保存到 GitHub" : "（未設 GITHUB_TOKEN，重新部署後會還原）"}。`;
    CONFIG.flags = r.flags;   // 立即套用回首頁（功能卡與公告），不用重整
    applyFlags();
  } catch (err) {
    $("flags-msg").textContent = "儲存失敗：" + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "儲存開關與公告";
  }
};

$("btn-roster-save").onclick = async (e) => {
  const roster = $("roster-edit").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!roster.length) { toast("名單不可為空"); return; }
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "儲存中…";
  $("roster-msg").textContent = "";
  try {
    const r = await api("/api/admin/roster", { password: reportPw, roster });
    $("roster-msg").textContent = `✓ 已儲存 ${r.roster.length} 人並立即生效${r.persisted ? "，已永久保存到 GitHub" : "（未設 GITHUB_TOKEN，重新部署後會還原）"}。`;
    $("roster-edit").value = r.roster.join("\n");
    CONFIG.roster = r.roster;   // 立即套用回姓名選單，不用重整
    applyRoster();
  } catch (err) {
    $("roster-msg").textContent = "儲存失敗：" + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "儲存名單";
  }
};

// ── 資料備份 ──
async function loadBackup() {
  $("backup-status").innerHTML = `<p class="hint">載入中…</p>`;
  try {
    const d = await api("/api/admin/overview", { password: reportPw });
    const b = d.backup || {};
    const archiveLabel = b.archive === "apps_script" ? "Google Sheet（Apps Script 直連）"
      : b.archive === "n8n" ? "n8n → Google Sheet"
      : "⚠️ 未設定（僅本機＋GitHub 備份）";
    $("backup-status").innerHTML =
      `<div class="bk-row"><span class="bk-k">情境演練紀錄</span><span class="bk-v">${b.records ?? 0} 筆</span></div>` +
      `<div class="bk-row"><span class="bk-k">指定演練繳交</span><span class="bk-v">${b.submissions ?? 0} 筆</span></div>` +
      `<div class="bk-row"><span class="bk-k">上次備份</span><span class="bk-v">${b.lastBackupAt ? fmtDateTime(b.lastBackupAt) : "本次啟動後尚未備份"}</span></div>` +
      `<div class="bk-row"><span class="bk-k">備份位置</span><span class="bk-v">${b.store === "github" ? "GitHub（永久保存）" : "⚠️ 僅本機（未設 GITHUB_TOKEN，重新部署會遺失）"}</span></div>` +
      `<div class="bk-row${b.archive === "none" ? " bk-warn" : ""}"><span class="bk-k">即時歸檔</span><span class="bk-v">${archiveLabel}</span></div>` +
      (d.admin_password_set ? "" : `<div class="bk-row bk-warn"><span class="bk-k">權限提醒</span><span class="bk-v">尚未設定 ADMIN_PASSWORD，目前主管密碼即有完整管理權限</span></div>`);
  } catch (err) {
    $("backup-status").innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`;
  }
}

$("btn-backup-now").onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "備份中…";
  $("backup-msg").textContent = "";
  try {
    const r = await api("/api/admin/backup", { password: reportPw });
    $("backup-msg").textContent = r.ok
      ? `✓ 已備份 ${r.count} 筆演練紀錄到 GitHub。`
      : `備份未完成：${r.error || "未知原因"}`;
    loadBackup();
  } catch (err) {
    $("backup-msg").textContent = "備份失敗：" + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "立即備份到 GitHub";
  }
};

$("btn-backup-download").onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "產生中…";
  try {
    const blob = await apiBlob("/api/admin/backup/download", { password: reportPw });
    triggerDownload(blob, `oright-trainer-backup-${todayStr().replaceAll("/", "")}.json`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "下載完整備份（JSON）";
  }
};

// ── 知識庫管理 ──
async function loadKbList() {
  const box = $("kb-list");
  box.innerHTML = `<p class="hint">載入中…</p>`;
  try {
    const data = await api("/api/knowledge/list", { password: reportPw });
    const store = data.store === "github" ? `GitHub（${esc(data.repo)}）` : "本機（暫存）";
    if (!data.files.length) {
      box.innerHTML = `<p class="hint">目前沒有知識檔。儲存位置：${store}</p>`;
      return;
    }
    const rows = data.files.map((f) => {
      const kb = (f.size / 1024).toFixed(f.size < 10240 ? 1 : 0);
      return `<tr>` +
        `<td>${esc(f.name)}</td>` +
        `<td>${kb} KB</td>` +
        `<td class="kb-actions">` +
        `<button class="kb-btn" data-view="${esc(f.name)}">檢視</button>` +
        `<button class="kb-btn kb-del" data-del="${esc(f.name)}" data-sha="${esc(f.sha || "")}">刪除</button>` +
        `</td></tr>`;
    }).join("");
    box.innerHTML =
      `<p class="hint">儲存位置：${store}</p>` +
      `<div class="table-scroll"><table class="report-table">` +
      `<thead><tr><th>檔名</th><th>大小</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    box.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => viewKb(b.dataset.view));
    box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => deleteKb(b.dataset.del, b.dataset.sha));
  } catch (err) {
    box.innerHTML = `<p class="hint">讀取失敗：${esc(err.message)}</p>`;
  }
}

async function uploadKb() {
  const file = $("kb-file").files[0];
  const paste = $("kb-paste").value.trim();
  let content = "", srcName = "", isMdFile = false;
  if (file) {
    content = await file.text();
    srcName = file.name;
    isMdFile = /\.(md|markdown)$/i.test(file.name);
  } else if (paste) {
    content = paste;
  } else {
    toast("請選擇檔案或貼上內容"); return;
  }
  let filename = ($("kb-name").value.trim() || srcName).trim();
  if (!filename) { toast("請輸入檔名"); return; }
  const convert = !isMdFile; // 非 .md 檔或貼上文字 → 交給 AI 整理

  const btn = $("btn-kb-upload");
  const msg = $("kb-upload-msg");
  btn.disabled = true;
  btn.textContent = convert ? "AI 整理中…" : "上傳中…";
  msg.textContent = "";
  try {
    const r = await api("/api/knowledge/upload", { password: reportPw, filename, content, convert });
    const where = r.store === "github" ? "已存回 GitHub，網站將於重新部署後（約數分鐘）套用" : "已存入本機";
    msg.textContent = `✓ ${r.converted ? "已由 AI 整理並" : ""}上傳「${r.filename}」（${r.updated ? "更新" : "新增"}）。${where}。`;
    $("kb-file").value = "";
    $("kb-paste").value = "";
    $("kb-name").value = "";
    loadKbList();
  } catch (err) {
    msg.textContent = "上傳失敗：" + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "上傳並整理";
  }
}
$("btn-kb-upload").onclick = uploadKb;

// 把知識檔的 Markdown 轉成好讀的 HTML（僅支援檢視需要的子集：標題／粗體／條列／表格／分隔線）
function kbMdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let list = null, table = null;
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const flushList = () => { if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    out.push(
      `<div class="kbv-tablewrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
      `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    );
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|.*\|$/.test(line.trim())) {
      flushList();
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 分隔列
      (table = table || []).push(cells);
      continue;
    }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushList(); out.push("<hr>"); continue; }
    const li = line.match(/^\s*(?:[-*]\s+|・\s*)(.*)/);
    if (li) { (list = list || []).push(`<li>${inline(li[1])}</li>`); continue; }
    flushList();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flushList(); flushTable();
  return out.join("");
}

function openViewer(title, html) {
  $("viewer-title").textContent = title;
  $("viewer-body").innerHTML = html;
  $("viewer").classList.remove("hidden");
  $("viewer-body").scrollTop = 0;
}
$("viewer-close").onclick = () => $("viewer").classList.add("hidden");
$("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) $("viewer").classList.add("hidden"); });

async function viewKb(name) {
  openViewer(name, `<p class="hint">載入中…</p>`);
  try {
    const data = await api("/api/knowledge/get", { password: reportPw, filename: name });
    const truncated = data.content.length > 60000;
    const html = kbMdToHtml(truncated ? data.content.slice(0, 60000) : data.content) +
      (truncated ? `<p class="hint">…（檔案較大，僅顯示前段）</p>` : "");
    openViewer(name, html);
  } catch (err) {
    $("viewer").classList.add("hidden");
    toast("讀取失敗：" + err.message);
  }
}

function deleteKb(name, sha) {
  confirmModal({
    title: `刪除知識檔？`,
    body: `確定刪除「${name}」？此動作會從儲存位置移除該檔案，需重新部署後生效。`,
    okText: "刪除", cancelText: "取消"
  }, async () => {
    try {
      await api("/api/knowledge/delete", { password: reportPw, filename: name, sha: sha || undefined });
      toast("已刪除");
      loadKbList();
    } catch (err) {
      toast("刪除失敗：" + err.message);
    }
  });
}

// ISO 時間 → 「2026/07/16 14:30」（依瀏覽器本地時區）
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderDashboard(data) {
  const rowsHtml = (list) => list.map((r) => {
    if (!r.practiced) {
      return `<tr class="row-miss"><td>${esc(r.name)}</td><td colspan="5">尚未練習</td></tr>`;
    }
    const weak = (r.last_weak && r.last_weak.length) ? r.last_weak.join("、") : "—";
    return `<tr>` +
      `<td>${esc(r.name)}</td>` +
      `<td>${r.count} 次</td>` +
      `<td>${fmtDateTime(r.last_date)}</td>` +
      `<td>${r.last_score != null ? r.last_score + " 分" : "—"}</td>` +
      `<td><span class="lv-badge">${esc(r.last_level || "—")}</span></td>` +
      `<td>${esc(weak)}</td>` +
      `</tr>`;
  }).join("");

  const header = `<thead><tr><th>業務</th><th>次數</th><th>最近練習時間</th><th>最近分數</th><th>層級</th><th>待加強面向</th></tr></thead>`;
  $("report-roster").innerHTML =
    `<div class="table-scroll"><table class="report-table">${header}<tbody>${rowsHtml(data.roster)}</tbody></table></div>`;

  if (data.others && data.others.length) {
    $("report-others").innerHTML =
      `<h3>名單外練習者</h3><div class="table-scroll"><table class="report-table">${header}<tbody>${rowsHtml(data.others)}</tbody></table></div>`;
  } else {
    $("report-others").innerHTML = "";
  }

  // 最近的指定演練繳交
  const subs = data.submissions_recent || [];
  if (subs.length) {
    $("report-submissions").innerHTML =
      `<h3>指定演練繳交（最近 ${subs.length} 筆）</h3>` +
      `<div class="table-scroll"><table class="report-table">` +
      `<thead><tr><th>業務</th><th>題目</th><th>分數</th><th>層級</th><th>繳交時間</th><th>狀態</th></tr></thead><tbody>` +
      subs.map((s) =>
        `<tr><td>${esc(s.name)}</td><td>${esc(s.title)}</td><td>${s.score != null ? s.score + " 分" : "—"}</td>` +
        `<td><span class="lv-badge">${esc(s.level || "—")}</span></td><td>${fmtDateTime(s.date)}</td>` +
        `<td>${s.approved ? '<span class="asg-on">已收錄</span>' : s.nominated ? '<span class="asg-nom">優良候選</span>' : "—"}</td></tr>`
      ).join("") +
      `</tbody></table></div>`;
  } else {
    $("report-submissions").innerHTML = "";
  }
}

// ═════════════════ 初始化 ═════════════════
async function init() {
  try {
    CONFIG = await api("/api/config");
  } catch (err) {
    toast("無法連線到伺服器，請重新整理頁面");
    return;
  }
  if (CONFIG.demo) $("demo-badge").classList.remove("hidden");
  applyFlags();
  applyRoster();
  renderThemes();
  renderModes();
  renderQaStarter();
  renderQuizModules();
  setupMic("mic-chat", "chat-input");
  setupMic("mic-qa", "qa-input");
  setupMic("mic-quiz", "quiz-answer");
  refreshAssignCard();
}

// ── 首頁狀態套用（init 與後台儲存後都會呼叫，雙向切換不用重整頁面） ──
// 功能開關：關閉中的功能從首頁隱藏；公告顯示在首頁最上方
function applyFlags() {
  const flags = CONFIG.flags || {};
  const flagMap = { "rp-theme": "roleplay", "qa": "qa", "quiz-setup": "quiz" };
  document.querySelectorAll(".feature-card").forEach((card) => {
    const key = flagMap[card.dataset.goto];
    if (key) card.classList.toggle("hidden", flags[key] === false);
  });
  const a = $("announcement");
  a.textContent = flags.announcement || "";
  a.classList.toggle("hidden", !flags.announcement);
}

// 業務姓名名單（演練／測驗姓名選單與報表統計依此）
function applyRoster() {
  $("roster-list").innerHTML = (CONFIG.roster || []).map((n) => `<option value="${esc(n)}"></option>`).join("");
}

// 指定演練卡：有開放題目才顯示並標示題數（init、回首頁、後台出題後都會刷新）
function refreshAssignCard() {
  api("/api/assignments/active").then((d) => {
    const list = d.assignments || [];
    state.assignActive = list;
    const card = document.querySelector(".feature-assign");
    const badge = $("assign-badge");
    card.classList.toggle("hidden", !list.length);
    badge.textContent = list.length;
    badge.classList.toggle("hidden", !list.length);
  }).catch(() => {});
}

init();
