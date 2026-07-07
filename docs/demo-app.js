// O'right｜PRO 業務教育教練 — 靜態展示版（GitHub Pages）
// 純前端執行，沒有伺服器、沒有真正呼叫 Claude API。所有「AI 回覆」都是固定示範腳本，
// 只用來展示介面與操作流程。完整可用版本需部署 Node 伺服器（見 README）。

const FULL_VERSION_NOTE =
  "靜態展示版沒有伺服器，無法產生 Word／PDF 或呼叫真正的 AI。\n請依 README 指示部署完整版本（例如 Render／Railway）後使用此功能。";

// ── 與 config/trainer-config.json 內容相同，內嵌以便純靜態頁面使用 ──
const CONFIG = {
  themes: [
    {
      id: "cold-call", icon: "🚪", name: "陌生開發",
      description: "開發新沙龍：第一次拜訪、破冰、品牌介紹、建立信任、處理拒絕與爭取下一步。",
      opening_by_difficulty: {
        beginner: "你好～請問你是哪間公司的？今天過來是？",
        intermediate: "你好，我們店裡用的品牌都固定了耶。你是哪家的？有什麼事嗎？",
        advanced: "（正在忙，瞄了一眼）……業務喔？我們跟現在的品牌配合很多年了，暫時沒有要換。有什麼事快說。"
      }
    },
    {
      id: "sentence-ender", icon: "🧊", name: "句點王模式",
      description: "店長話很少、常句點你。訓練追問需求、延伸對話與推進下一步的能力。",
      opening_by_difficulty: {
        beginner: "嗯，你好。",
        intermediate: "嗯。",
        advanced: "……（點了一下頭，繼續滑手機）"
      }
    },
    {
      id: "soft-nail", icon: "🪺", name: "軟釘子模式",
      description: "店長嘴上稱讚品牌卻始終不合作。訓練辨識假性興趣、把話題拉回合作。",
      opening_by_difficulty: {
        beginner: "哎唷是 O'right 的啊！你們品牌我真的很欣賞，理念做得很好。來來來坐。",
        intermediate: "O'right 喔！你們真的很厲害，之前那個綠建築我還有看到報導。今天來是？",
        advanced: "（熱情握手）唉唷～你們葛董真的很有遠見！我常跟設計師說你們的理念超棒。啊不過我們最近比較忙啦，你先坐。"
      }
    }
  ],
  difficulties: {
    beginner: { label: "新人模式", sub: "低階", description: "店長防備度中等、多帶多鼓勵，回饋以基礎話術為主，像主管帶新人。" },
    intermediate: { label: "中階模式", sub: "進階", description: "店長務實精明、有真實異議，回饋直接具體，鼓勵與挑戰並重。" },
    advanced: { label: "資深模式", sub: "高階", description: "情境接近真實現場：當場砍價、拿競品比較、老闆在旁、時間很趕。回饋少鼓勵、多挑戰。" }
  },
  quizModules: [
    { id: "brand", name: "品牌", scope: "O'right｜PRO 品牌定位、專業、綠色、時尚、永續理念、品牌語調、綠建築、認證與 ESG 價值" },
    { id: "treatment", name: "療程", scope: "鎏金護髮、頭皮養護、翎羽燙、五公升洗髮精、兩公升 VIP 洗護系列、療程流程與沙龍應用情境" },
    { id: "product", name: "產品", scope: "各產品分類、1 至 6 號系列、頭皮噴霧、氣墊梳、身體按摩油、沐浴露、養髮液與造型品" },
    { id: "cold-call", name: "陌生開發", scope: "開發新沙龍、第一次拜訪、破冰、品牌介紹、建立信任、處理拒絕與爭取下一步" },
    { id: "faq", name: "FAQ 與標準回答", scope: "業務常見問題、標準回答、禁用話術與注意事項" },
    { id: "ingredient", name: "成分與規格", scope: "產品成分、分類、容量、價格、補充包與現行狀態" },
    { id: "script", name: "話術", scope: "話術訓練、L1/L2/L3 層級、可以這樣說與進階說法" }
  ]
};

// ── 固定示範資料（與完整版 server.js 的 DEMO_* 對齊） ──
const DEMO_TURN = {
  reply: "嗯……你們跟我現在用的牌子差在哪？大家不是都說自己天然？",
  coaching: {
    comment: "有說明來意，但一開場就進入產品介紹，還沒接住店長的立場。",
    suggestion: "先用一個問題了解店家現況，再帶出差異點。",
    better_example: "老師，我知道您現在的品牌用得很順，我今天不是要您換掉它。想先請教一下，店裡最近在頭皮養護這塊，客人的詢問度高嗎？"
  },
  correction: { triggered: false, note: "" },
  should_end: false
};

const DEMO_TURN_CORRECTION = {
  reply: "你這樣講我更不敢用了，治掉髮？你們是藥品喔？",
  coaching: {
    comment: "出現醫療式宣稱：「治療掉髮」是禁用話術，現場這樣講會有法規風險，必須立刻修正。",
    suggestion: "改用「頭皮養護、髮肌健康」等保養型說法，並以實證資料佐證。",
    better_example: "老師不好意思我修正一下：咖啡因養髮液是頭皮養護產品，重點是維持頭皮健康環境，我們有 SGS 相關測試資料，我帶給您參考。"
  },
  correction: { triggered: true, note: "「治療掉髮」屬醫療式宣稱（禁用話術），應改為頭皮養護、髮肌保養等說法。" },
  should_end: false
};

const DEMO_EVAL_BASE = {
  constructs: [
    { name: "同理客戶", mark: "◎", score: 16, observation: "能先認同店長立場，降低防備。" },
    { name: "提問能力", mark: "○", score: 13, observation: "提問比例可再提升，多讓店長先說需求。" },
    { name: "產品連結", mark: "○", score: 14, observation: "有帶到綠色關鍵，但未連結到這間沙龍的具體需求。" },
    { name: "異議處理", mark: "○", score: 14, observation: "面對比較型異議沒有慌，但回應可更精煉。" },
    { name: "成交引導", mark: "△", score: 12, observation: "結尾停在介紹，未推進到明確下一步。" }
  ],
  total_score: 69,
  level: "L1",
  level_note: "L1 尾段，接近 L2",
  overall_observation: "資訊表達完整，下一步是把「介紹」轉成「對話」，先問再說。",
  round_template: {
    marks: { empathy: "○", questioning: "△", product: "○", objection: "○", closing: "△" },
    level: "L1", score: 66,
    observation: "開場清楚但直接進入產品介紹，未先探詢店家現況。（示範模式範例）"
  },
  checkpoints: [
    { name: "開場破冰", done: true, note: "" },
    { name: "需求探索", done: false, note: "本次未測到，建議增加提問" },
    { name: "產品／療程連結", done: true, note: "" },
    { name: "品牌綠色差異說明", done: true, note: "有提到 PCR 再生瓶器" },
    { name: "異議處理", done: true, note: "" },
    { name: "推進下一步", done: false, note: "本次未測到" }
  ],
  improvements: [
    "回答先聚焦，再展開說明。",
    "增加提問比例，讓店長先說需求。",
    "每輪結束時明確推進下一步，例如試做、示範、教育或確認品項。"
  ],
  rewrite_example: "老師，我知道您現在合作品牌已經很穩定，所以我今天不是要您馬上更換，而是想先了解店內目前在哪一塊最想提升：頭皮養護、燙後護理，還是顧客居家回購？如果有一個品項能同時讓顧客感受到專業效果，又能帶出 O'right｜PRO 的 USDA Biobased、PCR 再生瓶器與零碳綠工廠差異，我會建議我們先從一場小型教育或試做開始，讓老師們自己感受再決定。",
  overall_judgment: "具備基本開發架構與品牌知識，目前以產品導向為主。若能提升提問能力並在每輪推進明確下一步，可望穩定進入 L2。（此為靜態展示版範例，完整版將依真實對話與知識庫產生評估）",
  next_steps: [
    { direction: "提問能力", method: "練習每次介紹產品前，先問出沙龍目前最想改善的服務或銷售缺口。" },
    { direction: "異議處理", method: "針對「產品很齊」「庫存壓力」「設計師很忙」建立 30 秒回應版本。" },
    { direction: "成交引導", method: "每輪演練最後都要推進到一個明確下一步，例如試做、教育或確認品項。" }
  ]
};

const DEMO_QA =
  "【業務理解】\n咖啡因養髮液是頭皮養護型產品，適合在意頭皮健康、髮量視覺的顧客，協助沙龍切入居家養護市場。\n\n【產品重點】\n定位：頭皮養護／容量與價格：請以最新 PRO 目錄為準（靜態展示版無法查詢知識庫）。\n\n【可以這樣說】\n「老師，現在客人洗完頭最常問的就是頭皮跟髮量。這支咖啡因養髮液可以當作店裡頭皮療程的居家延伸，客人天天用、感受才會持續。」\n\n【進階說法】\n「與其說賣一支產品，不如說是幫店裡建立『療程＋居家』的頭皮養護流程，客人回購，設計師也有話題跟客人維繫。」\n\n【提醒】\n避免「治療掉髮、生髮」等醫療式宣稱，統一用「頭皮養護、髮肌健康」。\n\n（此為靜態展示版固定回覆，完整版會依知識庫即時作答）";

const DEMO_QUIZ_Q = {
  module: "品牌", type: "知識題",
  question: "客人問：「你們說的『綠色』到底是什麼意思？跟其他天然品牌差在哪？」請用業務的話回答，至少講出兩個 O'right 的綠色關鍵。",
  focus: "能否具體講出綠色關鍵（如 USDA Biobased、PCR 再生瓶器、零碳綠工廠、RE100）而非空泛形容"
};

const DEMO_QUIZ_GRADE = {
  comment: "有講到綠色概念，但停留在「天然、環保」等形容詞，沒有講出具體可驗證的綠色關鍵。（靜態展示版固定範例，不論實際輸入內容皆顯示此評語）",
  level: "L1",
  reference_answer: "可回答：O'right 的綠不是形容詞，是可驗證的：例如 USDA Biobased 生物基認證與碳-14 檢測證明成分來源、PCR 再生瓶器、零碳綠工廠與 RE100 再生能源承諾。與一般「天然」品牌的差異在於全部有第三方認證可查。",
  correct: false
};

// ════════════════════════ 以下邏輯與完整版 public/app.js 相同，僅資料來源改為本機固定值 ════════════════════════
const state = {
  themeId: null, difficulty: null, name: "",
  history: [], feedbacks: [], evaluation: null, ended: false,
  qaHistory: [],
  quizModule: null, quizQuestion: null, quizAsked: [], quizCount: 0, quizCorrect: 0
};

const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function init() {
  renderThemes();
  renderModes();
  renderQuizModules();
}

const SCREENS = ["home", "setup", "chat", "result", "qa", "quiz"];
function showScreen(name) {
  SCREENS.forEach((s) => $(`screen-${s}`).classList.toggle("hidden", s !== name));
  $("btn-home").classList.toggle("hidden", name === "home");
}
$("btn-home").onclick = () => showScreen("home");
document.querySelectorAll(".feature-card").forEach((btn) => { btn.onclick = () => showScreen(btn.dataset.goto); });

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

function updateStartButton() { $("btn-start").disabled = !(state.themeId && state.difficulty); }
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

function addBubble(role, text, win = "chat-window") {
  const row = document.createElement("div");
  row.className = `msg-row ${role === "manager" || role === "assistant" ? "manager" : "sales"}`;
  const inner = document.createElement("div");
  const speaker = document.createElement("div");
  speaker.className = "speaker";
  speaker.textContent =
    role === "manager" ? "店長" :
    role === "assistant" ? "教育教練" :
    role === "user" ? "你" :
    `${state.name || "業務夥伴"}（你）`;
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

// 固定腳本版的「AI 回合」：模擬與完整版相同的判斷邏輯（禁用話術偵測、第 4 輪結束）
function getDemoTurn(history) {
  const salesTurns = history.filter((m) => m.role === "sales").length;
  const lastSales = [...history].reverse().find((m) => m.role === "sales");
  const isBad = /治療|生髮|治掉髮|藥|療效保證/.test(lastSales ? lastSales.text : "");
  return isBad ? DEMO_TURN_CORRECTION : { ...DEMO_TURN, should_end: salesTurns >= 4 };
}

async function sendMessage() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || state.ended) return;
  input.value = "";

  state.history.push({ role: "sales", text });
  addBubble("sales", text);
  setLoading(true, "店長思考中…");
  await sleep(500); // 模擬回應延遲，讓流程感覺一致

  const data = getDemoTurn(state.history);
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
  setLoading(false);
}

$("btn-send").onclick = sendMessage;
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

$("btn-finish").onclick = async () => {
  if (state.history.filter((m) => m.role === "sales").length < 1) {
    alert("至少要進行一輪對話才能產出報告喔！");
    return;
  }
  setLoading(true, "教育長評估中，請稍候…");
  await sleep(600);
  const roundCount = state.history.filter((m) => m.role === "sales").length;
  state.evaluation = {
    ...DEMO_EVAL_BASE,
    rounds: Array.from({ length: roundCount }, () => DEMO_EVAL_BASE.round_template)
  };
  renderResult();
  showScreen("result");
  setLoading(false);
};

function renderResult() {
  const ev = state.evaluation;
  const theme = getTheme();
  const diff = CONFIG.difficulties[state.difficulty];
  $("result-meta").textContent = `${state.name || "未填寫姓名"}｜${todayStr()}｜${theme.name}｜${diff.label}`;
  $("result-total").innerHTML = `總分：${ev.total_score} / 100　<span class="level-badge">${esc(ev.level_note)}</span>`;

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
  $("result-steps").innerHTML = ev.next_steps.map((s) => `<tr><td>${esc(s.direction)}</td><td>${esc(s.method)}</td></tr>`).join("");
}

function markSpan(mark) {
  const cls = mark === "◎" ? "mk-good" : mark === "○" ? "mk-ok" : "mk-weak";
  return `<span class="${cls}">${mark}</span>`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// 報告下載／分享／題庫下載：靜態展示版無伺服器可用，一律提示改用完整版
$("btn-pdf").onclick = () => alert(FULL_VERSION_NOTE);
$("btn-docx").onclick = () => alert(FULL_VERSION_NOTE);
$("btn-share").onclick = () => alert(FULL_VERSION_NOTE);
$("btn-quiz-bank").onclick = () => alert(FULL_VERSION_NOTE);
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
  await sleep(500);
  state.qaHistory.push({ role: "assistant", text: DEMO_QA });
  addBubble("assistant", DEMO_QA, "qa-window");
  setLoading(false);
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
  await sleep(400);
  state.quizQuestion = DEMO_QUIZ_Q;
  state.quizCount++;
  $("quiz-progress").textContent = `第 ${state.quizCount} 題｜答對 ${state.quizCorrect} 題`;
  $("quiz-question").innerHTML =
    `<div class="q-tag">${esc(DEMO_QUIZ_Q.module)}｜${esc(DEMO_QUIZ_Q.type)}</div><div class="q-text">${esc(DEMO_QUIZ_Q.question)}</div>`;
  setLoading(false);
}

$("btn-quiz-submit").onclick = async () => {
  const answer = $("quiz-answer").value.trim();
  if (!answer) { alert("請先輸入回答！"); return; }
  setLoading(true, "批改中…");
  await sleep(500);
  const data = DEMO_QUIZ_GRADE;
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
  setLoading(false);
};

$("btn-quiz-next").onclick = nextQuizQuestion;
$("btn-quiz-end").onclick = () => {
  $("quiz-play").classList.add("hidden");
  $("quiz-setup").classList.remove("hidden");
  if (state.quizCount > 0) alert(`本次測驗共 ${state.quizCount} 題，答對 ${state.quizCorrect} 題，繼續加油！`);
};

init();
