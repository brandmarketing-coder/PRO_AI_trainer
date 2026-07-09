const path = require("path");
// 明確指定 .env 路徑（不能只用預設的 process.cwd()）——
// 有些啟動方式（例如從上層目錄用 `node oright-salon-trainer/server.js` 執行）
// 的工作目錄不是這個專案資料夾，預設行為會抓不到 .env。
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const config = require("./config/trainer-config.json");
const { loadKnowledge, retrieve, KNOWLEDGE_DIR } = require("./knowledge");
const prompts = require("./prompts");
const { buildDocx, buildPdf, buildQuizReportDocx } = require("./report");
const fs = require("fs");

const PORT = process.env.PORT || 3000;

// ────────────────────────── LLM Provider（可切換 OpenAI / Anthropic） ──────────────────────────
// 用 PROVIDER 環境變數選擇；未指定時依現有金鑰自動判斷（OpenAI 優先）。
// 兩家的訊息格式、結構化輸出、回應解析都不同，這裡抽象成同一個 llm.generate() 介面。
let PROVIDER = (process.env.PROVIDER || "").toLowerCase();
if (!PROVIDER) {
  if (process.env.OPENAI_API_KEY) PROVIDER = "openai";
  else if (process.env.ANTHROPIC_API_KEY) PROVIDER = "anthropic";
}

let llm = null;      // { generate({systemStable, systemDynamic, messages, schema, schemaName, maxTokens}) }
let MODEL = "";      // 目前使用的模型 ID（顯示用）

if (PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
  const OpenAI = require("openai");
  const client = new OpenAI();
  MODEL = process.env.OPENAI_MODEL || "gpt-4o";
  llm = {
    provider: "openai",
    model: MODEL,
    async generate({ systemStable, systemDynamic, messages, schema, schemaName, maxTokens }) {
      // OpenAI：system 併進 messages 陣列開頭；結構化輸出用 response_format json_schema strict
      const oaiMessages = [
        { role: "system", content: systemStable + "\n\n" + systemDynamic },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ];
      const req = { model: MODEL, max_tokens: maxTokens, messages: oaiMessages };
      if (schema) {
        req.response_format = {
          type: "json_schema",
          json_schema: { name: schemaName || "result", strict: true, schema }
        };
      }
      const res = await client.chat.completions.create(req);
      const msg = res.choices[0].message;
      if (msg.refusal) throw new Error("模型拒絕回應此內容");
      const text = msg.content || "";
      return schema ? JSON.parse(text) : text;
    }
  };
} else if (PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  MODEL = process.env.MODEL || "claude-opus-4-8";
  llm = {
    provider: "anthropic",
    model: MODEL,
    async generate({ systemStable, systemDynamic, messages, schema, maxTokens }) {
      // Anthropic：system 為獨立參數（ROLE_CORE 放快取區塊）；結構化輸出用 output_config.format
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: systemStable, cache_control: { type: "ephemeral" } },
          { type: "text", text: systemDynamic }
        ],
        messages,
        ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {})
      });
      if (response.stop_reason === "refusal") throw new Error("模型拒絕回應此內容");
      if (schema) {
        const t = response.content.find((b) => b.type === "text");
        return JSON.parse(t.text);
      }
      return response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
  };
}

const KNOWLEDGE = loadKnowledge();

// ── 知識問答 FAQ 快取 ──
// config/faq.json 是預先產好答案的常見問題庫（不顯示在畫面上，純加速用）。
// 使用者提問時先比對 FAQ，命中就「零 API 呼叫、瞬間回覆」；沒命中才走即時檢索生成。
// 由 scripts/build-faq.js 依知識庫產生，可隨時擴充題目後重新產生。
let FAQ = [];
(function loadFaq() {
  try {
    const p = path.join(__dirname, "config", "faq.json");
    if (fs.existsSync(p)) {
      FAQ = JSON.parse(fs.readFileSync(p, "utf8"));
      console.log(`[faq] 已載入 ${FAQ.length} 題常見問答快取`);
    }
  } catch (e) {
    console.warn("[faq] 載入失敗：", e.message);
  }
})();

// 把問句正規化（去標點空白、轉小寫）後比對；完全相同或高度重疊即視為命中
function normalizeQ(s) {
  return String(s || "").toLowerCase().replace(/[\s,，。、！？!?~～．.：:「」『』（）()]/g, "");
}
function matchFaq(question) {
  if (!FAQ.length) return null;
  const nq = normalizeQ(question);
  if (!nq) return null;
  // 1) 完全相同
  let hit = FAQ.find((f) => normalizeQ(f.q) === nq);
  if (hit) return hit.a;
  // 2) 互為包含（使用者問句包含 FAQ 題目、或反之），且長度接近
  hit = FAQ.find((f) => {
    const nf = normalizeQ(f.q);
    return (nq.includes(nf) || nf.includes(nq)) && Math.abs(nf.length - nq.length) <= 4;
  });
  return hit ? hit.a : null;
}

// 去除模型偶爾夾帶的 Markdown 記號（gpt-4o 特別愛用），確保知識問答維持乾淨純文字
function stripMarkdown(text) {
  return String(text || "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")      // 標題 #
    .replace(/^\s{0,3}>\s?/gm, "")           // 引用 >
    .replace(/\*\*(.+?)\*\*/g, "$1")          // 粗體 **
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1$2") // 斜體 *
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")   // 行內 code `
    .replace(/^\s{0,3}[-*+]\s+/gm, "・")      // 項目符號 - * + → ・
    .replace(/\n{3,}/g, "\n\n")               // 過多空行收斂
    .trim();
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 組出「本次動態 system 內容」＝功能指令 + （本地檢索到的知識庫參考資料）。
// contextQuery 為空或查無相關資料時，不注入知識庫內容（例如純寒暄），prompt 更小更快。
function buildDynamicSystem(featureText, contextQuery, retrieveOpts = {}) {
  let feature = featureText;
  if (contextQuery) {
    const ctx = retrieve(KNOWLEDGE.sections, contextQuery, retrieveOpts);
    if (ctx) {
      feature +=
        "\n\n【本次知識庫參考資料（回答涉及產品事實時，一律以這裡為準；這裡沒有的就說「目前資料中沒有看到明確說明」，不要臆測）】\n" +
        ctx;
    }
  }
  return feature;
}

// 單次生成呼叫（無工具、無多趟往返）。schema 為 null 時回傳純文字。
async function callGen(featureText, messages, schema, { maxTokens = 4000, contextQuery = null, retrieveOpts = {}, schemaName } = {}) {
  return llm.generate({
    systemStable: prompts.ROLE_CORE,
    systemDynamic: buildDynamicSystem(featureText, contextQuery, retrieveOpts),
    messages,
    schema,
    schemaName,
    maxTokens
  });
}

// 從對話歷史取出業務講過的話（供檢索用；店長的話不列入檢索關鍵字）
function salesQuery(history) {
  return history.filter((m) => m.role === "sales").map((m) => m.text).join(" ").slice(-600);
}

function getTheme(id) {
  return config.themes.find((t) => t.id === id);
}

function toApiMessages(history) {
  // history: [{role:'sales'|'manager', text}]；開場白由系統提示交代，訊息以業務(user)開頭
  return history.map((m) => ({
    role: m.role === "sales" ? "user" : "assistant",
    content: m.text
  }));
}

// ────────────────────────── Schemas ──────────────────────────
const MARK = { type: "string", enum: ["◎", "○", "△"] };
const LEVEL = { type: "string", enum: ["L1", "L2", "L3"] };

const TURN_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "店長的口語回覆" },
    coaching: {
      type: "object",
      properties: {
        comment: { type: "string", description: "一句文字評價" },
        suggestion: { type: "string", description: "一個建議" },
        better_example: { type: "string", description: "建議回話範例" }
      },
      required: ["comment", "suggestion", "better_example"],
      additionalProperties: false
    },
    correction: {
      type: "object",
      properties: {
        triggered: { type: "boolean" },
        note: { type: "string" }
      },
      required: ["triggered", "note"],
      additionalProperties: false
    },
    should_end: { type: "boolean" }
  },
  required: ["reply", "coaching", "correction", "should_end"],
  additionalProperties: false
};

const EVAL_SCHEMA = {
  type: "object",
  properties: {
    constructs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          mark: MARK,
          score: { type: "integer" },
          observation: { type: "string" }
        },
        required: ["name", "mark", "score", "observation"],
        additionalProperties: false
      }
    },
    total_score: { type: "integer" },
    level: LEVEL,
    level_note: { type: "string" },
    overall_observation: { type: "string" },
    rounds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          marks: {
            type: "object",
            properties: {
              empathy: MARK, questioning: MARK, product: MARK, objection: MARK, closing: MARK
            },
            required: ["empathy", "questioning", "product", "objection", "closing"],
            additionalProperties: false
          },
          level: LEVEL,
          score: { type: "integer" },
          observation: { type: "string" }
        },
        required: ["marks", "level", "score", "observation"],
        additionalProperties: false
      }
    },
    checkpoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          done: { type: "boolean" },
          note: { type: "string" }
        },
        required: ["name", "done", "note"],
        additionalProperties: false
      }
    },
    improvements: { type: "array", items: { type: "string" } },
    rewrite_example: { type: "string" },
    overall_judgment: { type: "string" },
    next_steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          direction: { type: "string" },
          method: { type: "string" }
        },
        required: ["direction", "method"],
        additionalProperties: false
      }
    }
  },
  required: [
    "constructs", "total_score", "level", "level_note", "overall_observation",
    "rounds", "checkpoints", "improvements", "rewrite_example", "overall_judgment", "next_steps"
  ],
  additionalProperties: false
};

const QUIZ_Q_SCHEMA = {
  type: "object",
  properties: {
    module: { type: "string" },
    type: { type: "string" },
    question: { type: "string" },
    focus: { type: "string" },
    reference: { type: "string", description: "出題時依知識庫查證的參考答案，批改時直接使用（不顯示給作答者）" }
  },
  required: ["module", "type", "question", "focus", "reference"],
  additionalProperties: false
};

const QUIZ_GRADE_SCHEMA = {
  type: "object",
  properties: {
    comment: { type: "string" },
    level: LEVEL,
    reference_answer: { type: "string" },
    correct: { type: "boolean" }
  },
  required: ["comment", "level", "reference_answer", "correct"],
  additionalProperties: false
};

// ────────────────────────── Demo 資料（未設 API 金鑰時） ──────────────────────────
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

const DEMO_EVAL = {
  constructs: [
    { name: "同理客戶", mark: "◎", score: 16, comment: "", observation: "能先認同店長立場，降低防備。" },
    { name: "提問能力", mark: "○", score: 13, observation: "提問比例可再提升，多讓店長先說需求。" },
    { name: "產品連結", mark: "○", score: 14, observation: "有帶到綠色關鍵，但未連結到這間沙龍的具體需求。" },
    { name: "異議處理", mark: "○", score: 14, observation: "面對比較型異議沒有慌，但回應可更精煉。" },
    { name: "成交引導", mark: "△", score: 12, observation: "結尾停在介紹，未推進到明確下一步。" }
  ].map((c) => ({ name: c.name, mark: c.mark, score: c.score, observation: c.observation })),
  total_score: 69,
  level: "L1",
  level_note: "L1 尾段，接近 L2",
  overall_observation: "資訊表達完整，下一步是把「介紹」轉成「對話」，先問再說。",
  rounds: [
    {
      marks: { empathy: "○", questioning: "△", product: "○", objection: "○", closing: "△" },
      level: "L1", score: 66,
      observation: "開場清楚但直接進入產品介紹，未先探詢店家現況。（示範模式範例）"
    }
  ],
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
  overall_judgment: "具備基本開發架構與品牌知識，目前以產品導向為主。若能提升提問能力並在每輪推進明確下一步，可望穩定進入 L2。（此為示範模式範例，設定 API 金鑰後將產生真實評估）",
  next_steps: [
    { direction: "提問能力", method: "練習每次介紹產品前，先問出沙龍目前最想改善的服務或銷售缺口。" },
    { direction: "異議處理", method: "針對「產品很齊」「庫存壓力」「設計師很忙」建立 30 秒回應版本。" },
    { direction: "成交引導", method: "每輪演練最後都要推進到一個明確下一步，例如試做、教育或確認品項。" }
  ]
};

const DEMO_QA =
  "【業務理解】\n咖啡因養髮液是頭皮養護型產品，適合在意頭皮健康、髮量視覺的顧客，協助沙龍切入居家養護市場。\n\n【產品重點】\n定位：頭皮養護／容量與價格：請以最新 PRO 目錄為準（示範模式無法查詢知識庫）。\n\n【可以這樣說】\n「老師，現在客人洗完頭最常問的就是頭皮跟髮量。這支咖啡因養髮液可以當作店裡頭皮療程的居家延伸，客人天天用、感受才會持續。」\n\n【進階說法】\n「與其說賣一支產品，不如說是幫店裡建立『療程＋居家』的頭皮養護流程，客人回購，設計師也有話題跟客人維繫。」\n\n【提醒】\n避免「治療掉髮、生髮」等醫療式宣稱，統一用「頭皮養護、髮肌健康」。\n\n（此為示範模式回答，設定 API 金鑰後會依知識庫作答）";

const DEMO_QUIZ_Q = {
  module: "品牌",
  type: "知識題",
  question: "客人問：「你們說的『綠色』到底是什麼意思？跟其他天然品牌差在哪？」請用業務的話回答，至少講出兩個 O'right 的綠色關鍵。",
  focus: "能否具體講出綠色關鍵（如 USDA Biobased、PCR 再生瓶器、零碳綠工廠、RE100）而非空泛形容",
  reference: "O'right 的綠是可驗證的：USDA Biobased 生物基認證與碳-14 檢測證明成分來源、PCR 再生瓶器、零碳綠工廠與 RE100 再生能源承諾。與一般「天然」品牌的差異在於全部有第三方認證可查。"
};

const DEMO_QUIZ_GRADE = {
  comment: "有講到綠色概念，但停留在「天然、環保」等形容詞，沒有講出具體可驗證的綠色關鍵。（示範模式範例評語）",
  level: "L1",
  reference_answer: "可回答：O'right 的綠不是形容詞，是可驗證的：例如 USDA Biobased 生物基認證與碳-14 檢測證明成分來源、PCR 再生瓶器、零碳綠工廠與 RE100 再生能源承諾。與一般「天然」品牌的差異在於全部有第三方認證可查。",
  correct: false
};

// ────────────────────────── API ──────────────────────────
app.get("/api/config", (req, res) => {
  res.json({
    themes: config.themes,
    difficulties: config.difficulties,
    constructs: config.constructs,
    levels: config.levels,
    checkpoints: config.checkpoints,
    quizModules: config.quizModules,
    qaSuggestions: config.qaSuggestions,
    knowledgeFiles: KNOWLEDGE.files,
    knowledgeDir: KNOWLEDGE_DIR,
    demo: !llm,
    model: MODEL
  });
});

app.post("/api/roleplay/turn", async (req, res) => {
  try {
    const { themeId, difficulty, history } = req.body;
    const theme = getTheme(themeId);
    if (!theme || !config.difficulties[difficulty])
      return res.status(400).json({ error: "主題或難度不存在" });

    if (!llm) {
      const salesTurns = history.filter((m) => m.role === "sales").length;
      const lastSales = history.filter((m) => m.role === "sales").pop();
      const isBad = /治療|生髮|治掉髮|藥|療效保證/.test(lastSales ? lastSales.text : "");
      return res.json(isBad ? DEMO_TURN_CORRECTION : { ...DEMO_TURN, should_end: salesTurns >= 4 });
    }

    // 依業務最新一句檢索（若提到產品才會帶出參考資料，用於精準糾錯／示範）
    const lastSales = history.filter((m) => m.role === "sales").pop();
    const result = await callGen(
      prompts.buildRoleplayTurn(theme, difficulty),
      toApiMessages(history),
      TURN_SCHEMA,
      { maxTokens: 2000, contextQuery: lastSales ? lastSales.text : null, retrieveOpts: { limit: 2, minScore: 3 } }
    );
    res.json(result);
  } catch (err) {
    console.error("roleplay/turn error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

app.post("/api/roleplay/evaluate", async (req, res) => {
  try {
    const { themeId, difficulty, history } = req.body;
    const theme = getTheme(themeId);
    if (!theme || !config.difficulties[difficulty])
      return res.status(400).json({ error: "主題或難度不存在" });

    const roundCount = history.filter((m) => m.role === "sales").length;
    if (!llm) return res.json({ ...DEMO_EVAL, rounds: Array.from({ length: roundCount }, () => DEMO_EVAL.rounds[0]) });

    const messages = toApiMessages(history);
    messages.push({
      role: "user",
      content: `（演練結束。以上共 ${roundCount} 輪（每輪＝業務一句＋店長一句），請依評分邏輯輸出完整評估。）`
    });
    const result = await callGen(
      prompts.buildEvaluate(theme, difficulty, roundCount),
      messages,
      EVAL_SCHEMA,
      { maxTokens: 8000, contextQuery: salesQuery(history), retrieveOpts: { limit: 2, minScore: 3 } }
    );
    res.json(result);
  } catch (err) {
    console.error("roleplay/evaluate error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

app.post("/api/qa", async (req, res) => {
  try {
    const { history } = req.body; // [{role:'user'|'assistant', text}]
    const lastUser = [...history].reverse().find((m) => m.role === "user");

    // 先查 FAQ 快取：命中就瞬間回覆、不呼叫 AI（僅在單輪提問時套用，多輪追問走即時生成以保留上下文）
    const userTurns = history.filter((m) => m.role === "user").length;
    if (lastUser && userTurns === 1) {
      const cached = matchFaq(lastUser.text);
      if (cached) return res.json({ answer: cached, cached: true });
    }

    if (!llm) return res.json({ answer: DEMO_QA });
    const messages = history.map((m) => ({ role: m.role, content: m.text }));
    let answer = await callGen(prompts.QA_INSTRUCTIONS, messages, null, {
      maxTokens: 2000,
      contextQuery: lastUser ? lastUser.text : null,
      retrieveOpts: { limit: 3, minScore: 2 }
    });
    answer = stripMarkdown(answer);
    res.json({ answer });
  } catch (err) {
    console.error("qa error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

app.post("/api/quiz/next", async (req, res) => {
  try {
    const { module, asked } = req.body;
    if (!llm) return res.json(DEMO_QUIZ_Q);
    const mod = config.quizModules.find((x) => x.id === module);
    const result = await callGen(
      prompts.buildQuizNext(module, asked || []),
      [{ role: "user", content: "請出下一題。" }],
      QUIZ_Q_SCHEMA,
      { maxTokens: 2000, contextQuery: mod ? mod.scope : "品牌 產品 療程 話術", retrieveOpts: { limit: 3, minScore: 1 } }
    );
    res.json(result);
  } catch (err) {
    console.error("quiz/next error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

app.post("/api/quiz/grade", async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!llm) return res.json(DEMO_QUIZ_GRADE);
    // 批改直接使用出題時查證好的參考答案，不再查知識庫（單次呼叫，速度快）
    const result = await callGen(
      prompts.buildQuizGrade(),
      [
        {
          role: "user",
          content:
            `題目（${question.module}｜${question.type}）：${question.question}\n` +
            `評分重點：${question.focus}\n` +
            `出題時查證的參考答案（依此批改）：${question.reference || "（未提供，請依評分重點批改）"}\n\n` +
            `我的回答：${answer}`
        }
      ],
      QUIZ_GRADE_SCHEMA,
      { maxTokens: 1500 }
    );
    res.json(result);
  } catch (err) {
    console.error("quiz/grade error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});


app.post("/api/report/docx", async (req, res) => {
  try {
    const buffer = await buildDocx(req.body);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", "attachment; filename=report.docx");
    res.send(buffer);
  } catch (err) {
    console.error("docx error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/report/pdf", async (req, res) => {
  try {
    const buffer = await buildPdf(req.body);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=report.pdf");
    res.send(buffer);
  } catch (err) {
    console.error("pdf error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 測驗報告 Word：把作答歷史打包成 Word 檔（無需 AI 呼叫，全部由後端組表）
app.post("/api/quiz/report", async (req, res) => {
  try {
    const buffer = await buildQuizReportDocx(req.body);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", "attachment; filename=quiz-report.docx");
    res.send(buffer);
  } catch (err) {
    console.error("quiz/report error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`O'right｜PRO 業務教育教練 http://localhost:${PORT}`);
  console.log(llm ? `AI 模式（${PROVIDER} / ${MODEL}）` : "示範模式：未設定 API 金鑰（OPENAI_API_KEY 或 ANTHROPIC_API_KEY），將使用固定腳本回覆");
});
