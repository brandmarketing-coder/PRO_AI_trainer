const path = require("path");
// 明確指定 .env 路徑（不能只用預設的 process.cwd()）——
// 有些啟動方式（例如從上層目錄用 `node oright-salon-trainer/server.js` 執行）
// 的工作目錄不是這個專案資料夾，預設行為會抓不到 .env。
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const config = require("./config/trainer-config.json");
const { loadKnowledge, searchKnowledge, KNOWLEDGE_DIR } = require("./knowledge");
const prompts = require("./prompts");
const { buildDocx, buildPdf, buildQuizBankDocx, buildQuizReportDocx } = require("./report");

const MODEL = process.env.MODEL || "claude-opus-4-8";
const PORT = process.env.PORT || 3000;

let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  const Anthropic = require("@anthropic-ai/sdk");
  anthropic = new Anthropic();
}

const KNOWLEDGE = loadKnowledge();

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 系統提示 = [角色核心＋知識庫目錄索引（快取區塊，所有功能共用）] + [功能專屬指令]
// 注意：不把整包知識庫塞進 system prompt——713KB 原文換算超過 20 萬 token，
// 會直接超過部分模型（如 Haiku）的上下文上限，且即使模型上下文夠大也是浪費成本。
// 改成只放章節目錄，AI 需要具體事實時呼叫 search_knowledge 工具查詢。
function systemBlocks(featureText) {
  return [
    {
      type: "text",
      text: prompts.ROLE_CORE + "\n\n" + KNOWLEDGE.indexText,
      cache_control: { type: "ephemeral" }
    },
    { type: "text", text: featureText }
  ];
}

const SEARCH_TOOL = {
  name: "search_knowledge",
  description:
    "在 O'right｜PRO 業務教育知識庫中搜尋關鍵字，取得相關章節的實際內文（產品名稱、成分、規格、容量、價格、綠色關鍵、話術、FAQ、禁用詞等）。回答任何具體事實前必須先用這個工具確認，不能憑記憶回答或編造。通常查 1～2 次就該有足夠資訊，最多查 3 次。",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "要搜尋的關鍵字或問題，例如「咖啡因養髮液 容量 價格」" },
      file: { type: "string", description: "可選。只在指定的知識檔案內搜尋，例如「10_PRO目錄.md」" }
    },
    required: ["query"],
    additionalProperties: false
  }
};

// 通用的「工具＋結構化輸出」對話迴圈：模型可先呼叫 search_knowledge 查資料，
// 查夠了再依 schema 給出最終結構化答案（schema 為 null 時回傳純文字）。
// 最後一輪強制拿掉工具，逼模型用目前查到的資料直接給答案，避免無止盡查詢後噴錯給使用者。
// maxIterations 從 6 降到 4：一次 API 呼叫最多 3 次 search（第 4 次強制不給工具直接回答），
// 大幅降低單次功能的 token 消耗，同時仍能應付大多數問題。
async function callAgentic(featureText, initialMessages, schema, { maxTokens = 6000, maxIterations = 4 } = {}) {
  const messages = [...initialMessages];
  for (let i = 0; i < maxIterations; i++) {
    const isLastChance = i === maxIterations - 1;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemBlocks(featureText + (isLastChance ? "\n\n（已達查詢次數上限，請直接依目前已查到的資訊給出最終答案，查不到的部分請說明「目前資料中沒有看到明確說明」。）" : "")),
      messages,
      ...(isLastChance ? {} : { tools: [SEARCH_TOOL] }),
      ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {})
    });
    if (response.stop_reason === "refusal") throw new Error("模型拒絕回應此內容");

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolResults = response.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: searchKnowledge(KNOWLEDGE.sections, b.input.query, { file: b.input.file })
        }));
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    if (schema) {
      const text = response.content.find((b) => b.type === "text");
      return JSON.parse(text.text);
    }
    return response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  throw new Error("查詢知識庫次數過多，請簡化問題後再試一次。");
}

// 不帶工具的單次呼叫：用於已備妥所有素材、不需查知識庫的快速任務（例如測驗批改）
async function callDirect(featureText, messages, schema, maxTokens = 4000) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemBlocks(featureText),
    messages,
    ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {})
  });
  if (response.stop_reason === "refusal") throw new Error("模型拒絕回應此內容");
  if (schema) {
    const text = response.content.find((b) => b.type === "text");
    return JSON.parse(text.text);
  }
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
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

// 題庫改成每個模組各出一次（10 題／次），而非一次生 70 題——
// 一次生 70 題需要在單一 system prompt 下涵蓋全部七大模組的查詢，容易讓 AI 查詢範圍過廣、
// 品質下降，且單次輸出量大；拆成 7 次呼叫讓每次的知識庫搜尋更聚焦，no/module 由伺服器統一編號。
const QUIZ_BANK_MODULE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          question: { type: "string" },
          focus: { type: "string" },
          reference: { type: "string" },
          l1: { type: "string" },
          l2: { type: "string" },
          l3: { type: "string" }
        },
        required: ["type", "question", "focus", "reference", "l1", "l2", "l3"],
        additionalProperties: false
      }
    }
  },
  required: ["items"],
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
    demo: !anthropic,
    model: MODEL
  });
});

app.post("/api/roleplay/turn", async (req, res) => {
  try {
    const { themeId, difficulty, history } = req.body;
    const theme = getTheme(themeId);
    if (!theme || !config.difficulties[difficulty])
      return res.status(400).json({ error: "主題或難度不存在" });

    if (!anthropic) {
      const salesTurns = history.filter((m) => m.role === "sales").length;
      const lastSales = history.filter((m) => m.role === "sales").pop();
      const isBad = /治療|生髮|治掉髮|藥|療效保證/.test(lastSales ? lastSales.text : "");
      return res.json(isBad ? DEMO_TURN_CORRECTION : { ...DEMO_TURN, should_end: salesTurns >= 4 });
    }

    const result = await callAgentic(
      prompts.buildRoleplayTurn(theme, difficulty),
      toApiMessages(history),
      TURN_SCHEMA
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
    if (!anthropic) return res.json({ ...DEMO_EVAL, rounds: Array.from({ length: roundCount }, () => DEMO_EVAL.rounds[0]) });

    const messages = toApiMessages(history);
    messages.push({
      role: "user",
      content: `（演練結束。以上共 ${roundCount} 輪（每輪＝業務一句＋店長一句），請依評分邏輯輸出完整評估。）`
    });
    const result = await callAgentic(
      prompts.buildEvaluate(theme, difficulty, roundCount),
      messages,
      EVAL_SCHEMA,
      { maxTokens: 16000 }
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
    if (!anthropic) return res.json({ answer: DEMO_QA });
    const messages = history.map((m) => ({ role: m.role, content: m.text }));
    const answer = await callAgentic(prompts.QA_INSTRUCTIONS, messages, null);
    res.json({ answer });
  } catch (err) {
    console.error("qa error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

app.post("/api/quiz/next", async (req, res) => {
  try {
    const { module, asked } = req.body;
    if (!anthropic) return res.json(DEMO_QUIZ_Q);
    const result = await callAgentic(
      prompts.buildQuizNext(module, asked || []),
      [{ role: "user", content: "請出下一題。" }],
      QUIZ_Q_SCHEMA
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
    if (!anthropic) return res.json(DEMO_QUIZ_GRADE);
    // 批改直接使用出題時查證好的參考答案，不再查知識庫（單次呼叫，速度快）
    const result = await callDirect(
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
      QUIZ_GRADE_SCHEMA
    );
    res.json(result);
  } catch (err) {
    console.error("quiz/grade error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

app.post("/api/quiz/bank", async (req, res) => {
  try {
    let items;
    if (!anthropic) {
      items = config.quizModules.map((m, i) => ({
        no: i + 1, module: m.name, type: "知識題",
        question: `（示範題）請說明「${m.name}」模組的一個重點。`,
        focus: "示範模式範例", reference: "設定 API 金鑰後將依知識庫產生完整 70 題題庫。",
        l1: "只講產品/知識本身", l2: "能連結需求", l3: "能連結價值與下一步"
      }));
    } else {
      // 依模組逐一產生（每次 10 題），讓每次的知識庫搜尋範圍聚焦在單一模組
      items = [];
      for (const mod of config.quizModules) {
        const result = await callAgentic(
          prompts.buildQuizBankModule(mod),
          [{ role: "user", content: `請針對「${mod.name}」模組出 10 題。` }],
          QUIZ_BANK_MODULE_SCHEMA,
          { maxTokens: 8000 }
        );
        result.items.forEach((it) => items.push({ ...it, no: items.length + 1, module: mod.name }));
      }
    }
    const buffer = await buildQuizBankDocx(items);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", "attachment; filename=quiz-bank.docx");
    res.send(buffer);
  } catch (err) {
    console.error("quiz/bank error:", err);
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
  console.log(anthropic ? `AI 模式（${MODEL}）` : "示範模式：未設定 ANTHROPIC_API_KEY，將使用固定腳本回覆");
});
