// O'right｜PRO 業務教育教練 — 前端邏輯
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
  quizQuestion: null,
  quizAsked: [],
  quizCount: 0,
  quizCorrect: 0
};

const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };

async function init() {
  const res = await fetch("/api/config");
  CONFIG = await res.json();
  if (CONFIG.demo) $("demo-badge").classList.remove("hidden");
  renderThemes();
  renderModes();
  renderQuizModules();
}

// ---------- 畫面切換 ----------
const SCREENS = ["home", "setup", "chat", "result", "qa", "quiz"];
function showScreen(name) {
  SCREENS.forEach((s) => $(`screen-${s}`).classList.toggle("hidden", s !== name));
  $("btn-home").classList.toggle("hidden", name === "home");
}
$("btn-home").onclick = () => showScreen("home");
document.querySelectorAll(".feature-card").forEach((btn) => {
  btn.onclick = () => showScreen(btn.dataset.goto);
});

function setLoading(on, text) {
  $("loading").classList.toggle("hidden", !on);
  if (text) $("loading-text").textContent = text;
}

// ════════════════ 情境演練 ════════════════
function renderThemes() {
  const wrap = $("theme-list");
  wrap.innerHTML = "";
  CONFIG.themes.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "scenario-card";
    btn.innerHTML = `<div class="s-name">${t.icon} ${esc(t.name)}</div><div class="s-desc">${esc(t.description)}</div>`;
    btn.onclick = () => {
      state.themeId = t.id;
      wrap.querySelectorAll(".scenario-card").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      updateStartButton();
    };
    wrap.appendChild(btn);
  });
}

function renderModes() {
  const wrap = $("mode-list");
  wrap.innerHTML = "";
  Object.entries(CONFIG.difficulties).forEach(([id, m]) => {
    const btn = document.createElement("button");
    btn.className = "mode-card";
    btn.innerHTML = `<div class="m-label">${esc(m.label)}<span class="m-sub">${esc(m.sub)}</span></div><div class="m-desc">${esc(m.description)}</div>`;
    btn.onclick = () => {
      state.difficulty = id;
      wrap.querySelectorAll(".mode-card").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      updateStartButton();
    };
    wrap.appendChild(btn);
  });
}

function updateStartButton() {
  $("btn-start").disabled = !(state.themeId && state.difficulty);
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
  $("chat-title").textContent = `${theme.icon} ${theme.name}（${diff.label}）`;
  $("chat-sub").textContent = theme.description;
  $("chat-window").innerHTML = "";

  addBubble("manager", theme.opening_by_difficulty[state.difficulty]);
  showScreen("chat");
  $("chat-input").focus();
};

function addBubble(role, text, win = "chat-window", salesLabel) {
  const row = document.createElement("div");
  row.className = `msg-row ${role === "manager" || role === "assistant" ? "manager" : "sales"}`;
  const inner = document.createElement("div");
  const speaker = document.createElement("div");
  speaker.className = "speaker";
  speaker.textContent =
    role === "manager" ? "店長" :
    role === "assistant" ? "教育教練" :
    role === "user" ? "你" :
    salesLabel || `${state.name || "業務夥伴"}（你）`;
  if (role === "sales" || role === "user") speaker.style.textAlign = "right";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  inner.appendChild(speaker);
  inner.appendChild(bubble);
  row.appendChild(inner);
  $(win).appendChild(row);
  scrollWin(win);
}

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
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.justifyContent = "flex-end";
  wrap.appendChild(box);
  $("chat-window").appendChild(wrap);
  scrollWin("chat-window");
}

function scrollWin(id) { const w = $(id); w.scrollTop = w.scrollHeight; }

async function sendMessage() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || state.ended) return;
  input.value = "";

  state.history.push({ role: "sales", text });
  addBubble("sales", text);
  setLoading(true, "店長思考中…");

  try {
    const res = await fetch("/api/roleplay/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: state.themeId, difficulty: state.difficulty, history: state.history })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "發生錯誤");

    state.feedbacks.push({ coaching: data.coaching, correction: data.correction });
    if (data.correction && data.correction.triggered) addCorrectionBanner(data.correction.note);
    addCoachBox(data.coaching);
    state.history.push({ role: "manager", text: data.reply });
    addBubble("manager", data.reply);

    if (data.should_end) {
      state.ended = true;
      const note = document.createElement("div");
      note.className = "end-note";
      note.textContent = "🎬 這段演練已告一段落，點右上角「結束演練並產出報告」看看你的表現！";
      $("chat-window").appendChild(note);
      scrollWin("chat-window");
    }
  } catch (err) {
    alert("發生錯誤：" + err.message);
    state.history.pop();
  } finally {
    setLoading(false);
  }
}

$("btn-send").onclick = sendMessage;
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ---------- 評分 ----------
$("btn-finish").onclick = async () => {
  if (state.history.filter((m) => m.role === "sales").length < 1) {
    alert("至少要進行一輪對話才能產出報告喔！");
    return;
  }
  setLoading(true, "教育長評估中，請稍候…");
  try {
    const res = await fetch("/api/roleplay/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: state.themeId, difficulty: state.difficulty, history: state.history })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "發生錯誤");
    state.evaluation = data;
    renderResult();
    showScreen("result");
  } catch (err) {
    alert("評分失敗：" + err.message);
  } finally {
    setLoading(false);
  }
};

function renderResult() {
  const ev = state.evaluation;
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  $("result-meta").textContent =
    `${state.name || "未填寫姓名"}｜${todayStr()}｜${theme.name}｜${diff.label}`;
  $("result-total").innerHTML =
    `總分：${ev.total_score} / 100　<span class="level-badge">${esc(ev.level_note)}</span>`;

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

// ---------- 報告下載與分享 ----------
function reportPayload() {
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  // 組成逐輪資料：一輪 = 業務一句 + 店長一句
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

async function downloadReport(type) {
  setLoading(true, "報告產生中…");
  try {
    const res = await fetch(`/api/report/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload())
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "報告產生失敗");
    }
    const blob = await res.blob();
    const filename = `OrightPRO業務訓練評估報告_${state.name || "業務夥伴"}_${todayStr().replaceAll("/", "")}.${type === "pdf" ? "pdf" : "docx"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    setLoading(false);
  }
}

$("btn-pdf").onclick = () => downloadReport("pdf");
$("btn-docx").onclick = () => downloadReport("docx");

$("btn-share").onclick = async () => {
  const ev = state.evaluation;
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  const summary =
    `【O'right｜PRO 業務訓練評估報告】\n` +
    `業務夥伴：${state.name || "未填寫"}\n日期：${todayStr()}\n` +
    `主題：${theme.name}（${diff.label}）\n總分：${ev.total_score} / 100（${ev.level_note}）\n` +
    ev.constructs.map((c) => `・${c.name}：${c.mark} ${c.score}/20`).join("\n") +
    `\n整體判斷：${ev.overall_judgment}`;

  setLoading(true, "準備分享內容…");
  try {
    const res = await fetch("/api/report/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload())
    });
    const blob = await res.blob();
    const file = new File([blob], `OrightPRO訓練報告_${state.name || "業務夥伴"}.pdf`, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "O'right｜PRO 業務訓練評估報告", text: summary, files: [file] });
      return;
    }
  } catch (e) { /* 不支援或使用者取消 → 改用複製 */ }
  finally { setLoading(false); }
  await navigator.clipboard.writeText(summary);
  alert("此裝置不支援直接分享檔案，已將報告摘要複製到剪貼簿。\n可直接貼到 LINE 群組，完整報告請下載 Word/PDF 後傳送。");
};

$("btn-restart").onclick = () => showScreen("setup");

// ════════════════ 知識問答 ════════════════
async function sendQa() {
  const input = $("qa-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  state.qaHistory.push({ role: "user", text });
  addBubble("user", text, "qa-window");
  setLoading(true, "查找知識庫中…");
  try {
    const res = await fetch("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: state.qaHistory })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "發生錯誤");
    state.qaHistory.push({ role: "assistant", text: data.answer });
    addBubble("assistant", data.answer, "qa-window");
  } catch (err) {
    alert("發生錯誤：" + err.message);
    state.qaHistory.pop();
  } finally {
    setLoading(false);
  }
}
$("btn-qa-send").onclick = sendQa;
$("qa-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQa(); }
});

// ════════════════ 隨機測驗 ════════════════
function renderQuizModules() {
  const wrap = $("quiz-module-list");
  wrap.innerHTML = "";
  const all = [{ id: "random", name: "🎲 綜合隨機", scope: "從七大模組隨機抽題" }, ...CONFIG.quizModules];
  all.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "mode-card";
    btn.innerHTML = `<div class="m-label">${esc(m.name)}</div><div class="m-desc">${esc(m.scope)}</div>`;
    btn.onclick = () => {
      state.quizModule = m.id;
      wrap.querySelectorAll(".mode-card").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      $("btn-quiz-start").disabled = false;
    };
    wrap.appendChild(btn);
  });
}

$("btn-quiz-start").onclick = () => {
  state.quizAsked = [];
  state.quizCount = 0;
  state.quizCorrect = 0;
  $("quiz-setup").classList.add("hidden");
  $("quiz-play").classList.remove("hidden");
  nextQuizQuestion();
};

async function nextQuizQuestion() {
  setLoading(true, "出題中…");
  $("quiz-feedback").classList.add("hidden");
  $("btn-quiz-next").classList.add("hidden");
  $("btn-quiz-submit").classList.remove("hidden");
  $("quiz-answer").value = "";
  $("quiz-answer").disabled = false;
  try {
    const res = await fetch("/api/quiz/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: state.quizModule, asked: state.quizAsked })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "發生錯誤");
    state.quizQuestion = data;
    state.quizAsked.push(data.question);
    state.quizCount++;
    $("quiz-progress").textContent = `第 ${state.quizCount} 題｜答對 ${state.quizCorrect} 題`;
    $("quiz-question").innerHTML =
      `<div class="q-tag">${esc(data.module)}｜${esc(data.type)}</div><div class="q-text">${esc(data.question)}</div>`;
  } catch (err) {
    alert("出題失敗：" + err.message);
  } finally {
    setLoading(false);
  }
}

$("btn-quiz-submit").onclick = async () => {
  const answer = $("quiz-answer").value.trim();
  if (!answer) { alert("請先輸入回答！"); return; }
  setLoading(true, "批改中…");
  try {
    const res = await fetch("/api/quiz/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: state.quizQuestion, answer })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "發生錯誤");
    if (data.correct) state.quizCorrect++;
    $("quiz-progress").textContent = `第 ${state.quizCount} 題｜答對 ${state.quizCorrect} 題`;
    $("quiz-feedback").classList.remove("hidden");
    $("quiz-feedback").innerHTML =
      `<div class="qf-head ${data.correct ? "qf-ok" : "qf-no"}">${data.correct ? "✓ 掌握不錯" : "△ 還要加強"}　<span class="level-badge">${esc(data.level)}</span></div>` +
      `<div class="qf-comment">${esc(data.comment)}</div>` +
      `<div class="qf-ref"><b>參考回答方向：</b>${esc(data.reference_answer)}</div>`;
    $("quiz-answer").disabled = true;
    $("btn-quiz-submit").classList.add("hidden");
    $("btn-quiz-next").classList.remove("hidden");
  } catch (err) {
    alert("批改失敗：" + err.message);
  } finally {
    setLoading(false);
  }
};

$("btn-quiz-next").onclick = nextQuizQuestion;
$("btn-quiz-end").onclick = () => {
  $("quiz-play").classList.add("hidden");
  $("quiz-setup").classList.remove("hidden");
  if (state.quizCount > 0) alert(`本次測驗共 ${state.quizCount} 題，答對 ${state.quizCorrect} 題，繼續加油！`);
};

$("btn-quiz-bank").onclick = async () => {
  if (!confirm("題庫產生需要數分鐘（七大模組共 70 題），要開始嗎？")) return;
  setLoading(true, "題庫產生中（約需數分鐘，請勿關閉頁面）…");
  try {
    const res = await fetch("/api/quiz/bank", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "題庫產生失敗");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OrightPRO業務訓練題庫_${todayStr().replaceAll("/", "")}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    setLoading(false);
  }
};

init();
