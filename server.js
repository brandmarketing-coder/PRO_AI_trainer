const path = require("path");
// 明確指定 .env 路徑（不能只用預設的 process.cwd()）——
// 有些啟動方式（例如從上層目錄用 `node oright-salon-trainer/server.js` 執行）
// 的工作目錄不是這個專案資料夾，預設行為會抓不到 .env。
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const config = require("./config/trainer-config.json");
const { loadKnowledge, retrieve, topSections, KNOWLEDGE_DIR } = require("./knowledge");
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
let openaiClient = null;   // 供音檔轉逐字稿（Whisper）使用；僅 PROVIDER=openai 時有值

if (PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
  const OpenAI = require("openai");
  const client = new OpenAI();
  openaiClient = client;
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

// ── 訓練紀錄歸檔（供報表後台與 n8n）──
// 每次演練評分完成後寫入 data/records.json（逐筆 append）。
// ⚠️ Render 免費方案磁碟是暫存的，重新部署／休眠會清空；長期保存請靠 N8N_WEBHOOK_URL 串到 Google Sheet。
const REPORT_PASSWORD = process.env.REPORT_PASSWORD || "12890464";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";   // App 直接把演練紀錄寫進 Google Sheet（免 n8n）
const DATA_DIR = path.join(__dirname, "data");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");
const SUBMISSIONS_FILE = path.join(DATA_DIR, "submissions.json");   // 指定演練繳交（納入備份）

// ── 權限：兩級密碼 ──
// REPORT_PASSWORD＝主管（viewer，只看分數彙整）
// ADMIN_PASSWORD＝管理員（admin，知識庫/系統管理/備份/出題/優良話術匯出與收錄）
// 未設定 ADMIN_PASSWORD 時，主管密碼直接視為管理員（與舊版相容，交接後請務必設定）。
function roleOf(password) {
  if (!password) return null;
  if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) return "admin";
  if (password === REPORT_PASSWORD) return ADMIN_PASSWORD ? "viewer" : "admin";
  return null;
}

// ── 操作稽核日誌（data/audit.json，最多保留 500 筆，納入備份） ──
function readAudit() {
  try {
    return fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8")) : [];
  } catch { return []; }
}
function audit(action, detail, role, req) {
  try {
    const list = readAudit();
    list.push({
      time: new Date().toISOString(),
      role: role || "unknown",
      action,
      detail: String(detail || ""),
      ip: req ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim() : ""
    });
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(list.slice(-500), null, 2));
  } catch (e) {
    console.warn("[audit] 寫入失敗：", e.message);
  }
}

// ── 功能開關與維護公告（config/feature-flags.json；後台可即時修改並存回 GitHub） ──
const FLAGS_FILE = path.join(__dirname, "config", "feature-flags.json");
const DEFAULT_FLAGS = { roleplay: true, qa: true, quiz: true, announcement: "" };
let flags = { ...DEFAULT_FLAGS };
try { flags = { ...DEFAULT_FLAGS, ...JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8")) }; } catch {}

function readRecords() {
  try {
    return fs.existsSync(RECORDS_FILE) ? JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8")) : [];
  } catch { return []; }
}
// 指定演練繳交紀錄
function readSubmissions() {
  try {
    return fs.existsSync(SUBMISSIONS_FILE) ? JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf8")) : [];
  } catch { return []; }
}
function writeSubmissions(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(list, null, 2));
}
// 把一筆演練紀錄整理成 Google Sheet 的一列（欄名需與 Apps Script 的 HEADERS 一致）。
// 這段原本在 n8n 的 Code 節點；改成 App 直接送 Apps Script 後搬進來。
function formatRecordRow(rec) {
  let when = rec.date || "";
  if (when) {
    try {
      when = new Date(when).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
      }).replace(/-/g, "/");
    } catch {}
  }
  const transcript = Array.isArray(rec.transcript)
    ? rec.transcript.map((t) => {
        if (t && (t.sales !== undefined || t.manager !== undefined)) {
          return `業務：${t.sales || ""}\n店長：${t.manager || ""}`;
        }
        return `${t.role === "sales" ? "業務" : "店長"}：${t.text || ""}`;
      }).join("\n")
    : "";
  const cs = Array.isArray(rec.construct_scores)
    ? rec.construct_scores.map((c) => `${c.name}:${c.mark || ""}${c.score != null ? c.score : ""}`).join("、")
    : "";
  return {
    "時間": when,
    "業務": rec.name || "",
    "主題": rec.theme || "",
    "模式": rec.mode || "",
    "總分": rec.total_score != null ? rec.total_score : "",
    "層級": rec.level || "",
    "層級說明": rec.level_note || "",
    "待加強面向": Array.isArray(rec.weak_areas) ? rec.weak_areas.join("、") : "",
    "各面向分數": cs,
    "逐字稿": transcript
  };
}

// 送一列資料到 Google Sheet 的指定分頁（Apps Script 端依 _sheet 決定寫哪個分頁與標題列）
async function sendToSheet(sheetName, row) {
  if (!APPS_SCRIPT_URL) return { sent: false, reason: "未設定 APPS_SCRIPT_URL" };
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _sheet: sheetName, ...row }),
      redirect: "follow"   // Apps Script /exec 會 302 轉址，需跟隨
    });
    const body = await r.text().catch(() => "");
    const ok = r.ok && !/"ok"\s*:\s*false/.test(body);
    if (ok) { console.log(`[sheet] 已寫入 Google Sheet「${sheetName}」：${body.slice(0, 80)}`); return { sent: true, via: "apps_script", status: r.status, response: body.slice(0, 120) }; }
    console.warn(`[sheet] Apps Script 回應異常 HTTP ${r.status}：${body.slice(0, 120)}`);
    return { sent: false, via: "apps_script", status: r.status, reason: body.slice(0, 120) || `HTTP ${r.status}` };
  } catch (e) {
    console.warn("[sheet] Apps Script 寫入失敗：", e.message);
    return { sent: false, via: "apps_script", reason: e.message };
  }
}

// 台北時區好讀時間
function taipeiTime(iso) {
  try {
    return new Date(iso || Date.now()).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).replace(/-/g, "/");
  } catch { return String(iso || ""); }
}

// 歸檔到 Google Sheet：優先「App 直接送 Apps Script」（APPS_SCRIPT_URL，繞過公司防火牆、免 n8n）；
// 未設時退回舊的 n8n webhook（送原始 rec，由 n8n 整理）。成功與失敗都寫 log 方便在 Render Logs 排查。
async function forwardRecord(rec) {
  if (APPS_SCRIPT_URL) return sendToSheet("演練紀錄", formatRecordRow(rec));
  if (N8N_WEBHOOK_URL) {
    try {
      const r = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec)
      });
      if (r.ok) { console.log(`[records] 已轉送 n8n（HTTP ${r.status}）：${rec.name}`); return { sent: true, via: "n8n", status: r.status }; }
      console.warn(`[records] n8n 回應異常 HTTP ${r.status}`);
      return { sent: false, via: "n8n", status: r.status, reason: `n8n 回應 HTTP ${r.status}` };
    } catch (e) {
      console.warn("[records] n8n 轉送失敗：", e.message);
      return { sent: false, via: "n8n", reason: e.message };
    }
  }
  console.log("[records] 未設定 APPS_SCRIPT_URL／N8N_WEBHOOK_URL，略過外部歸檔（仍有本機＋GitHub 備份）");
  return { sent: false, reason: "未設定歸檔目的地" };
}

function appendRecord(rec) {
  const list = readRecords();
  list.push(rec);
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    console.warn("[records] 寫入失敗：", e.message);
  }
  // 每日自動備份：距上次備份超過 24 小時就順手備份一次（非阻塞）
  if (Date.now() - lastBackupAt > 24 * 3600 * 1000) {
    runBackup("每日自動備份").catch((e) => console.warn("[backup] 自動備份失敗：", e.message));
  }
  // 非阻塞地歸檔到 Google Sheet，失敗不影響主流程
  return forwardRecord(rec);
}

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
// no-cache：讓瀏覽器每次都向伺服器驗證 html/js/css 是否有更新（未變回 304、變了拿新版），
// 避免部署新版後使用者仍看到瀏覽器快取的舊畫面。
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
  }
}));

// 組出「本次動態 system 內容」＝功能指令 + （本地檢索到的知識庫參考資料）。
// contextQuery 為空或查無相關資料時，不注入知識庫內容（例如純寒暄），prompt 更小更快。
function buildDynamicSystem(featureText, contextQuery, retrieveOpts = {}) {
  let feature = featureText;
  if (contextQuery) {
    // retrieveOpts.files：限定只從這些知識檔檢索（自訂測驗範圍用）
    const { files, ...opts } = retrieveOpts;
    const pool = Array.isArray(files) && files.length
      ? KNOWLEDGE.sections.filter((s) => files.includes(s.file))
      : KNOWLEDGE.sections;
    const ctx = retrieve(pool, contextQuery, opts);
    if (ctx) {
      feature +=
        "\n\n【本次知識庫參考資料（回答涉及產品事實時，一律以這裡為準；這裡沒有的就說「目前資料中沒有看到明確說明」，不要臆測）】\n" +
        ctx;
    }
  }
  return feature;
}

// 簡轉繁：保證所有 AI 輸出都是繁體字（gpt-4o 有時會夾帶簡體，光靠提示詞不夠保險）
const s2t = require("opencc-js").Converter({ from: "cn", to: "tw" });
function toTraditional(v) {
  if (typeof v === "string") return s2t(v);
  if (Array.isArray(v)) return v.map(toTraditional);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = toTraditional(v[k]);
    return o;
  }
  return v;
}

// 單次生成呼叫（無工具、無多趟往返）。schema 為 null 時回傳純文字。輸出一律簡轉繁。
async function callGen(featureText, messages, schema, { maxTokens = 4000, contextQuery = null, retrieveOpts = {}, schemaName } = {}) {
  const out = await llm.generate({
    systemStable: prompts.ROLE_CORE,
    systemDynamic: buildDynamicSystem(featureText, contextQuery, retrieveOpts),
    messages,
    schema,
    schemaName,
    maxTokens
  });
  return toTraditional(out);
}

// 從對話歷史取出業務講過的話（供檢索用；店長的話不列入檢索關鍵字）
function salesQuery(history) {
  return history.filter((m) => m.role === "sales").map((m) => m.text).join(" ").slice(-600);
}

function getTheme(id, customTopic) {
  if (id === "custom") {
    // 自訂題目：由使用者輸入的題目／情境動態組出一個店長人設
    const topic = (customTopic || "").trim() || "業務想針對特定產品或活動進行的自訂情境演練";
    return {
      id: "custom",
      icon: "✏️",
      name: "自訂題目",
      description: topic,
      persona:
        `你扮演一位沙龍店長。本次演練的題目／情境由業務自訂如下：\n「${topic}」\n` +
        `請依這個題目進入對應的沙龍店長角色（可能是針對某項產品、某個活動、某種顧客狀況的演練）。` +
        `依難度展現合理的態度與提問，像真實店長一樣回應，幫助業務練習這個特定主題。`,
      opening_by_difficulty: {
        beginner: "你好你好，請坐～今天想跟我聊什麼？",
        intermediate: "你好，今天來是有什麼事嗎？",
        advanced: "（正在忙）嗯，你說，今天什麼事？我時間不多。"
      }
    };
  }
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
    headline: { type: "string", description: "一句白話總結：這位業務會什麼、差什麼。不要用 L1/L2/L3 或構面術語，像主管當面講的一句話。" },
    strengths: { type: "array", items: { type: "string" }, description: "1~2 個這次做得好的亮點（白話、具體、引用對話）" },
    top_priority: {
      type: "object",
      description: "這次最該改的『一件事』——從最弱或最關鍵的地方挑一個",
      properties: {
        title: { type: "string", description: "重點短語（10 字內），例如「把產品講進店長心坎裡」" },
        detail: { type: "string", description: "為什麼＋下次具體怎麼做，兩三句" }
      },
      required: ["title", "detail"],
      additionalProperties: false
    },
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
    "headline", "strengths", "top_priority",
    "rounds", "checkpoints", "improvements", "overall_judgment", "next_steps"
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

// 指定演練評分：依「題目自訂重點」逐項評分 + 保留五大構面參考 + 總分/總評
const ASSIGNMENT_EVAL_SCHEMA = {
  type: "object",
  properties: {
    criteria_scores: {
      type: "array",
      description: "逐項對照題目的評分重點",
      items: {
        type: "object",
        properties: {
          point: { type: "string", description: "評分重點項目" },
          mark: MARK,
          comment: { type: "string", description: "針對這一項的具體點評，引用逐字稿佐證" }
        },
        required: ["point", "mark", "comment"],
        additionalProperties: false
      }
    },
    construct_scores: {
      type: "array",
      description: "五大構面（同理客戶、提問能力、產品連結、異議處理、成交引導）參考評分",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          mark: MARK,
          score: { type: "integer" }
        },
        required: ["name", "mark", "score"],
        additionalProperties: false
      }
    },
    total_score: { type: "integer", description: "0~100 綜合分數" },
    level: LEVEL,
    strengths: { type: "array", items: { type: "string" }, description: "做得好的地方" },
    improvements: { type: "array", items: { type: "string" }, description: "可改善的地方" },
    overall: { type: "string", description: "一段整體評語" }
  },
  required: ["criteria_scores", "construct_scores", "total_score", "level", "strengths", "improvements", "overall"],
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
  overall_judgment: "具備基本開發架構與品牌知識，目前以產品導向為主。若能提升提問能力並在每輪推進明確下一步，可望穩定進入 L2。（此為示範模式範例，設定 API 金鑰後將產生真實評估）",
  headline: "品牌知識夠，但太快進入介紹——先學會問出店長的需求，再開口推。",
  strengths: ["開場有清楚說明來意與品牌立場", "有主動帶出綠色關鍵（PCR 再生瓶器）"],
  top_priority: { title: "先問需求再介紹", detail: "這場幾乎都是你在講。下次開場後先問一句「老師目前店裡最想加強的是頭皮養護還是燙後護理？」，讓店長先說，你再對症推薦。" },
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

const DEMO_ASSIGNMENT_EVAL = {
  criteria_scores: [
    { point: "USDA Biobased 認證", mark: "○", comment: "有提到天然來源，但沒明確帶出 USDA Biobased 認證與可驗證性。（示範模式範例）" },
    { point: "價格調整說明", mark: "△", comment: "只說了漲價，未說明是價值與使用感受同步升級。（示範模式範例）" }
  ],
  construct_scores: [
    { name: "同理客戶", mark: "○", score: 14 },
    { name: "產品連結", mark: "○", score: 15 }
  ],
  total_score: 76,
  level: "L2",
  strengths: ["整體結構完整，有依序帶到主要重點"],
  improvements: ["把每個賣點連到可驗證的認證或數據", "價格調整改用價值升級的說法"],
  overall: "具備基本陳述架構，若能把賣點連結到可驗證依據、並把漲價包裝成價值升級，可穩定進入 L2~L3。（此為示範模式範例，設定 API 金鑰後將產生真實評估）"
};

// ────────────────────────── API ──────────────────────────
app.get("/api/config", (req, res) => {
  res.json({
    roster: config.roster || [],
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
    model: MODEL,
    flags,                               // 功能開關與維護公告（前端據此隱藏功能卡、顯示公告）
    archive: APPS_SCRIPT_URL ? "apps_script" : N8N_WEBHOOK_URL ? "n8n" : "none",   // 歸檔目的地（不外洩網址）
    build: "2026-07-23-stable"            // 部署版本標記，用於確認新版已上線
  });
});

// 功能開關檢查：關閉中的功能擋在入口（進行中的評分／批改／報告不受影響）
function featureGate(key, label) {
  return (req, res, next) => {
    if (flags[key]) return next();
    res.status(503).json({ error: `${label}目前暫停開放${flags.announcement ? `：${flags.announcement}` : "，請稍後再試"}` });
  };
}

app.post("/api/roleplay/turn", featureGate("roleplay", "情境演練"), async (req, res) => {
  try {
    const { themeId, difficulty, history, customTopic } = req.body;
    const theme = getTheme(themeId, customTopic);
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
    const { themeId, difficulty, history, customTopic } = req.body;
    const theme = getTheme(themeId, customTopic);
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
    res.json(applyScoreCaps(result, history));
  } catch (err) {
    console.error("roleplay/evaluate error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

// 程式端評分硬上限：不信任模型自律，投入量不足的演練由程式強制壓分。
// 規則與 prompts 的「評分紀律」一致：內容僅寒暄（<20字）→ 總分 ≤10；發言 <3 輪 → 總分 ≤40。
function applyScoreCaps(result, history) {
  try {
    const salesTexts = history.filter((m) => m.role === "sales").map((m) => String(m.text || ""));
    const totalChars = salesTexts.join("").replace(/\s/g, "").length;
    let cap = 100;
    const reasons = [];
    if (salesTexts.length < 3) { cap = Math.min(cap, 40); reasons.push("業務發言少於 3 輪"); }
    if (totalChars < 20) { cap = Math.min(cap, 10); reasons.push("內容僅寒暄或單句"); }
    if (result.total_score > cap) {
      const perConstruct = Math.floor(cap / 5);
      (result.constructs || []).forEach((c) => { c.score = Math.min(c.score, perConstruct); });
      result.total_score = (result.constructs || []).reduce((s, c) => s + (c.score || 0), 0);
      if (result.total_score < 60) { result.level = "L1"; result.level_note = "未達 L1 門檻"; }
      result.overall_judgment = `${result.overall_judgment || ""}（系統依評分紀律套用總分上限 ${cap} 分：${reasons.join("、")}。）`;
    }
    // 符號一律跟著分數走（模型偶爾給低分卻標 ○，會導致「待加強面向」抓不到 △ 而空白）
    (result.constructs || []).forEach((c) => {
      c.mark = c.score >= 17 ? "◎" : c.score >= 12 ? "○" : "△";
    });
  } catch (e) { console.warn("[evaluate] 套用評分上限失敗：", e.message); }
  return result;
}

// 待加強面向：先取評 △ 的構面；一個都沒有時（全 ○ 的中段成績）取分數最低的構面，
// 除非全部 ◎（真的沒有明顯弱項）。確保報表與 Google Sheet 永遠有可讀的待加強資訊。
function deriveWeakAreas(constructs) {
  const cs = constructs || [];
  let weak = cs.filter((c) => c.mark === "△").map((c) => c.name);
  if (!weak.length && cs.length) {
    const min = Math.min(...cs.map((c) => (c.score != null ? c.score : 20)));
    if (min < 17) weak = cs.filter((c) => c.score === min).map((c) => c.name);
  }
  return weak;
}

app.post("/api/qa", featureGate("qa", "知識問答"), async (req, res) => {
  try {
    const { history } = req.body; // [{role:'user'|'assistant', text}]
    const lastUser = [...history].reverse().find((m) => m.role === "user");

    // 先查 FAQ 快取：命中就瞬間回覆、不呼叫 AI（僅在單輪提問時套用，多輪追問走即時生成以保留上下文）
    const userTurns = history.filter((m) => m.role === "user").length;
    if (lastUser && userTurns === 1) {
      const cached = matchFaq(lastUser.text);
      if (cached) return res.json({ answer: cached, cached: true, sources: ["常見問答庫"] });
    }

    if (!llm) return res.json({ answer: DEMO_QA });
    // 顯示用的資料來源（與 callGen 內部檢索同一套邏輯，讓業務知道答案依據哪些知識檔、可追溯）
    const hits = lastUser ? topSections(KNOWLEDGE.sections, lastUser.text, { limit: 3, minScore: 2 }) : [];
    const sources = [...new Set(hits.map((h) => h.file.replace(/\.md$/i, "")))];
    const messages = history.map((m) => ({ role: m.role, content: m.text }));
    let answer = await callGen(prompts.QA_INSTRUCTIONS, messages, null, {
      maxTokens: 2000,
      contextQuery: lastUser ? lastUser.text : null,
      retrieveOpts: { limit: 3, minScore: 2 }
    });
    answer = stripMarkdown(answer);
    res.json({ answer, sources });
  } catch (err) {
    console.error("qa error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

// ── 訓練紀錄歸檔 ──
app.post("/api/records", async (req, res) => {
  try {
    const { name, themeName, modeLabel, evaluation, transcript, debug_archive, debug_n8n } = req.body || {};
    if (!evaluation) return res.status(400).json({ error: "缺少評估資料" });
    const rec = {
      name: (name || "").trim() || "未填寫",
      date: new Date().toISOString(),
      theme: themeName || "",
      mode: modeLabel || "",
      total_score: evaluation.total_score,
      level: evaluation.level,
      level_note: evaluation.level_note,
      // 待加強面向＝評為 △ 的構面
      weak_areas: deriveWeakAreas(evaluation.constructs),
      construct_scores: (evaluation.constructs || []).map((c) => ({ name: c.name, mark: c.mark, score: c.score })),
      transcript: transcript || []   // 逐字稿（供 n8n / AI Agent 分析）
    };
    const forward = appendRecord(rec);
    // debug 模式：等歸檔完成並回報結果（排查用）；一般使用不等待
    if (debug_archive || debug_n8n) return res.json({ ok: true, archive: await forward });
    res.json({ ok: true });
  } catch (err) {
    console.error("records error:", err);
    res.status(500).json({ error: err.message || "伺服器錯誤" });
  }
});

// ── 報表後台（需密碼；主管/管理員皆可看分數彙整）──
app.post("/api/report/dashboard", (req, res) => {
  const role = roleOf((req.body || {}).password);
  if (!role) {
    audit("登入失敗", "密碼錯誤", "unknown", req);
    return res.status(401).json({ error: "密碼錯誤" });
  }
  audit("登入後台", role === "admin" ? "管理員" : "主管", role, req);

  const roster = config.roster || [];
  const records = readRecords();
  const byName = new Map();
  records.forEach((r) => {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  });

  // 每位業務彙整：練習次數、最近分數、最近層級、待加強面向（取最近一次）
  const rosterStats = roster.map((name) => {
    const recs = (byName.get(name) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const latest = recs[recs.length - 1] || null;
    const avg = recs.length ? Math.round(recs.reduce((s, r) => s + (r.total_score || 0), 0) / recs.length) : null;
    return {
      name,
      count: recs.length,
      practiced: recs.length > 0,
      avg_score: avg,
      last_score: latest ? latest.total_score : null,
      last_level: latest ? latest.level : null,
      last_weak: latest ? latest.weak_areas : [],
      last_date: latest ? latest.date : null
    };
  });

  // 名單外（自訂姓名）也列出來，方便主管看到
  const others = [...byName.keys()].filter((n) => !roster.includes(n)).map((name) => {
    const recs = byName.get(name);
    const latest = recs[recs.length - 1];
    return { name, count: recs.length, practiced: true, last_score: latest.total_score, last_level: latest.level, last_weak: latest.weak_areas, last_date: latest.date };
  });

  const practicedCount = rosterStats.filter((r) => r.practiced).length;
  // 最近的指定演練繳交（主管在分數彙整頁一眼看到誰交了、幾分）
  const recentSubs = readSubmissions().slice(-20).reverse().map((s) => ({
    name: s.name, title: s.assignmentTitle, score: s.total_score, level: s.level,
    date: s.date, nominated: !!s.nominated, approved: !!s.approved
  }));
  res.json({
    role,   // viewer＝只能看分數彙整；admin＝所有後台分頁
    submissions_recent: recentSubs,
    summary: {
      roster_total: roster.length,
      practiced: practicedCount,
      not_practiced: roster.length - practicedCount,
      total_records: records.length
    },
    roster: rosterStats,
    others,
    constructs: config.constructs.map((c) => c.name),
    levels: config.levels
  });
});

// ══════════════════ 知識庫管理（主管後台上傳 → 存回 GitHub） ══════════════════
// 設計說明：Render 磁碟是暫存的，直接寫本機檔案重新部署就會消失。因此正式環境把知識檔
// 存回 GitHub repo 的 knowledge/ 目錄（透過 GitHub Contents API），commit 後 Render 會自動
// 重新部署並載入新知識。未設 GITHUB_TOKEN 時（本機開發）退回寫入本機 KNOWLEDGE_DIR。
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "brandmarketing-coder/PRO_AI_trainer";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GH_KNOWLEDGE_DIR = (process.env.GITHUB_KNOWLEDGE_DIR || "knowledge").replace(/^\/|\/$/g, "");
const useGitHub = () => !!GITHUB_TOKEN;

async function ghApi(method, urlPath, body) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oright-salon-trainer",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `GitHub API ${res.status}`);
  return data;
}
const ghPath = (name) => `/repos/${GITHUB_REPO}/contents/${GH_KNOWLEDGE_DIR}/${encodeURIComponent(name)}`;

async function listKnowledge() {
  if (useGitHub()) {
    const data = await ghApi("GET", `/repos/${GITHUB_REPO}/contents/${GH_KNOWLEDGE_DIR}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    return (Array.isArray(data) ? data : [])
      .filter((f) => f.type === "file" && /\.md$/i.test(f.name))
      .map((f) => ({ name: f.name, size: f.size, sha: f.sha }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  return fs.readdirSync(KNOWLEDGE_DIR)
    .filter((f) => /\.md$/i.test(f))
    .map((f) => ({ name: f, size: fs.statSync(path.join(KNOWLEDGE_DIR, f)).size, sha: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
async function getKnowledge(filename) {
  const safe = path.basename(filename);
  if (useGitHub()) {
    const data = await ghApi("GET", `${ghPath(safe)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    return Buffer.from(data.content || "", "base64").toString("utf8");
  }
  return fs.readFileSync(path.join(KNOWLEDGE_DIR, safe), "utf8");
}
async function saveKnowledge(filename, content) {
  const safe = path.basename(filename);
  if (useGitHub()) {
    let sha;
    try { sha = (await ghApi("GET", `${ghPath(safe)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`)).sha; } catch {}
    const body = {
      message: `知識庫：${sha ? "更新" : "新增"} ${safe}（後台上傳）`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    const r = await ghApi("PUT", ghPath(safe), body);
    return { updated: !!sha, commit: r.commit && r.commit.sha };
  }
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  const dest = path.join(KNOWLEDGE_DIR, safe);
  const existed = fs.existsSync(dest);
  fs.writeFileSync(dest, content);
  return { updated: existed };
}
async function deleteKnowledge(filename, sha) {
  const safe = path.basename(filename);
  if (useGitHub()) {
    if (!sha) sha = (await ghApi("GET", `${ghPath(safe)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`)).sha;
    await ghApi("DELETE", ghPath(safe), { message: `知識庫：刪除 ${safe}（後台）`, sha, branch: GITHUB_BRANCH });
    return;
  }
  const p = path.join(KNOWLEDGE_DIR, safe);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// 把非 Markdown 的原始資料（貼上的文字、.txt/.csv 等）轉成 Markdown 知識檔。
// 【原則：一字不刪】只做格式排版（標題層級、條列、表格、去亂碼），內容必須完整保留。
// 長文切段逐段轉換再拼回，避免單次輸出上限造成內容被截斷或被 AI 濃縮。
function splitForConvert(text, maxLen = 6000) {
  const chunks = [];
  let rest = String(text).replace(/\r\n/g, "\n");
  while (rest.length > maxLen) {
    // 優先在段落邊界切，找不到再往前找換行，最後硬切
    let cut = rest.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.5) cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

async function convertToMarkdown(rawText, filename) {
  const instr =
    "你是排版助理。把使用者提供的原始資料（可能來自 Word、Excel、PDF、網頁或雜亂純文字）轉成繁體中文 Markdown。\n" +
    "【最重要的規則：內容一字不刪】\n" +
    "• 所有句子、段落、數字、清單項目、話術、註解都必須完整保留，輸出內容量應與輸入相當。\n" +
    "• 嚴禁摘要、濃縮、改寫、合併段落、省略「重複或次要」內容——你沒有資格判斷什麼是次要的。\n" +
    "• 你唯一可以做的：加上合理的 #/##/### 標題層級、把清單改成「-」條列、把表格資料排成 Markdown 表格、移除亂碼/頁碼/連續空白。\n" +
    "• 不得杜撰或補充原文沒有的內容。\n" +
    "• 這是長文件的其中一段時，接續排版即可，不要加開場或結尾語。\n" +
    "只輸出 Markdown 本文，不要加任何說明。";
  const chunks = splitForConvert(rawText);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const out = await llm.generate({
      systemStable: prompts.ROLE_CORE,
      systemDynamic: instr,
      messages: [{
        role: "user",
        content: `檔名：${filename}（第 ${i + 1}/${chunks.length} 段）\n\n原始內容：\n${chunks[i]}`
      }],
      maxTokens: 12000
    });
    parts.push(typeof out === "string" ? out : String(out || ""));
  }
  return toTraditional(parts.join("\n\n"));
}

// 權限閘：need="viewer"|"admin"。回傳角色字串，未通過回 null（並已回應 401/403）。
const gate = (req, res, need = "viewer") => {
  const role = roleOf((req.body || {}).password);
  if (!role) { res.status(401).json({ error: "密碼錯誤" }); return null; }
  if (need === "admin" && role !== "admin") {
    res.status(403).json({ error: "權限不足：此功能需要管理員密碼" });
    return null;
  }
  return role;
};

app.post("/api/knowledge/list", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  try {
    res.json({ files: await listKnowledge(), store: useGitHub() ? "github" : "local", repo: useGitHub() ? GITHUB_REPO : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/knowledge/get", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  try {
    const content = await getKnowledge(req.body.filename);
    audit("知識庫檢視", req.body.filename, "admin", req);
    res.json({ filename: req.body.filename, content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 前端動作補記稽核（白名單，避免被塞任意內容）
const CLIENT_AUDIT_ACTIONS = new Set(["匯出優良話術"]);
app.post("/api/admin/log", (req, res) => {
  const role = gate(req, res, "admin");
  if (!role) return;
  const { action, detail } = req.body || {};
  if (!CLIENT_AUDIT_ACTIONS.has(action)) return res.status(400).json({ error: "不支援的動作" });
  audit(action, String(detail || "").slice(0, 200), role, req);
  res.json({ ok: true });
});

app.post("/api/knowledge/upload", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  const { filename, content, convert } = req.body || {};
  if (!filename || !content || !String(content).trim()) return res.status(400).json({ error: "缺少檔名或內容" });
  try {
    let name = String(filename).trim().replace(/[\\/]/g, "_");
    const isMd = /\.md$/i.test(name);
    let md = String(content);
    let converted = false;
    if (!isMd || convert) {
      if (!llm) return res.status(503).json({ error: "尚未設定 AI 金鑰，無法自動轉換；請上傳 .md 檔" });
      md = await convertToMarkdown(content, name);
      name = name.replace(/\.[^.]+$/, "") + ".md";
      converted = true;
    } else {
      md = toTraditional(md); // .md 直接上傳也統一轉繁體
    }
    if (!/\.md$/i.test(name)) name += ".md";
    await backupBeforeRedeploy();   // 存回 GitHub 會觸發重新部署，先備份演練紀錄避免遺失
    const result = await saveKnowledge(name, md);
    audit("知識庫上傳", `${name}（${result.updated ? "更新" : "新增"}${converted ? "，AI 整理" : ""}）`, "admin", req);
    res.json({ ok: true, filename: name, converted, store: useGitHub() ? "github" : "local", ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/knowledge/delete", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  if (!req.body.filename) return res.status(400).json({ error: "缺少檔名" });
  try {
    await backupBeforeRedeploy();
    await deleteKnowledge(req.body.filename, req.body.sha);
    audit("知識庫刪除", req.body.filename, "admin", req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════ 系統管理與資料備份（管理員專用） ══════════════════
// 通用 GitHub 檔案讀寫（知識庫以外的檔案：備份、名單、功能開關）
const ghAnyPath = (repoPath) => `/repos/${GITHUB_REPO}/contents/${repoPath.split("/").map(encodeURIComponent).join("/")}`;
async function ghGetFile(repoPath) {
  try {
    const data = await ghApi("GET", `${ghAnyPath(repoPath)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    return Buffer.from(data.content || "", "base64").toString("utf8");
  } catch { return null; }   // 檔案不存在
}
async function ghSaveFile(repoPath, content, message) {
  let sha;
  try { sha = (await ghApi("GET", `${ghAnyPath(repoPath)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`)).sha; } catch {}
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  return ghApi("PUT", ghAnyPath(repoPath), body);
}

// ── 資料備份：backups/records.json（含演練紀錄＋稽核日誌）──
// Render 免費方案磁碟是暫存的：任何重新部署都會清空 data/。因此：
// ① 每日自動＋手動備份到 GitHub；② 任何會觸發重新部署的後台操作前先備份；③ 開機時自動還原。
const BACKUP_PATH = "backups/records.json";
let lastBackupAt = 0;
let backupInFlight = null;   // 同時觸發的備份（例如每日自動＋手動撞在一起）合併成一次，避免 GitHub 寫入衝突

async function runBackup(trigger, req) {
  if (!useGitHub()) return { ok: false, error: "未設定 GITHUB_TOKEN，無法備份到 GitHub（仍可用「下載完整備份」手動保存）" };
  if (backupInFlight) return backupInFlight;
  backupInFlight = (async () => {
    const records = readRecords();
    // 備份瘦身：演練紀錄不含逐字稿（完整逐字稿以 Google Sheet 歸檔為準），並設筆數上限；
    // 指定演練繳交保留逐字稿（後續勾選匯出／收錄需要），同樣設上限。
    const payload = {
      savedAt: new Date().toISOString(),
      note: "records 為摘要（不含逐字稿），完整資料以 Google Sheet 歸檔為準",
      records: records.slice(-500).map(({ transcript, ...r }) => r),
      audit: readAudit(),
      submissions: readSubmissions().slice(-200)
    };
    const r = await ghSaveFile(BACKUP_PATH, JSON.stringify(payload, null, 2), `[skip render] 資料備份：${records.length} 筆演練紀錄（${trigger}）`);
    lastBackupAt = Date.now();
    audit("資料備份", `${trigger}，${records.length} 筆`, "admin", req);
    console.log(`[backup] 已備份 ${records.length} 筆演練紀錄到 GitHub（${trigger}）`);
    return { ok: true, count: records.length, commit: r.commit && r.commit.sha };
  })().finally(() => { backupInFlight = null; });
  return backupInFlight;
}

// 會觸發 Render 重新部署的操作（知識庫、名單、開關存回 GitHub）前先備份，避免部署間隔遺失紀錄。
// 注意：只要演練紀錄「或」指定演練繳交任一有資料就要備份（原本只看演練紀錄，
// 導致沒有演練紀錄時繳交狀態不備份、重新部署後收錄狀態被舊備份蓋掉）。
async function backupBeforeRedeploy() {
  if (!useGitHub()) return;
  if (readRecords().length === 0 && readSubmissions().length === 0) return;
  try { await runBackup("設定變更前自動備份"); } catch (e) { console.warn("[backup] 變更前備份失敗：", e.message); }
}

// 開機還原：本機沒有紀錄（＝剛重新部署）且 GitHub 有備份時，把紀錄還原回來
async function restoreFromBackup() {
  try {
    if (!useGitHub() || readRecords().length > 0) return;
    const txt = await ghGetFile(BACKUP_PATH);
    if (!txt) return;
    const data = JSON.parse(txt);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (Array.isArray(data.records) && data.records.length) {
      fs.writeFileSync(RECORDS_FILE, JSON.stringify(data.records, null, 2));
    }
    if (Array.isArray(data.audit) && data.audit.length && readAudit().length === 0) {
      fs.writeFileSync(AUDIT_FILE, JSON.stringify(data.audit, null, 2));
    }
    if (Array.isArray(data.submissions) && data.submissions.length && readSubmissions().length === 0) {
      writeSubmissions(data.submissions);
    }
    lastBackupAt = Date.parse(data.savedAt) || 0;
    console.log(`[backup] 已從 GitHub 還原 ${(data.records || []).length} 筆演練紀錄（備份於 ${data.savedAt}）`);
  } catch (e) {
    console.warn("[backup] 開機還原失敗：", e.message);
  }
}

// ── 管理端點 ──
// 總覽：功能開關、名單、稽核日誌、備份狀態一次帶回
app.post("/api/admin/overview", (req, res) => {
  if (!gate(req, res, "admin")) return;
  res.json({
    flags,
    roster: config.roster || [],
    audit: readAudit().slice(-100).reverse(),
    backup: {
      records: readRecords().length,
      submissions: readSubmissions().length,
      lastBackupAt: lastBackupAt ? new Date(lastBackupAt).toISOString() : null,
      store: useGitHub() ? "github" : "local",
      archive: APPS_SCRIPT_URL ? "apps_script" : N8N_WEBHOOK_URL ? "n8n" : "none",
      auto: "每日自動備份一次；知識庫／名單／開關變更時也會先自動備份"
    },
    admin_password_set: !!ADMIN_PASSWORD
  });
});

// 功能開關與公告：立即生效（記憶體）＋ 存回 GitHub（重新部署後仍有效）
app.post("/api/admin/flags", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  const f = req.body.flags || {};
  try {
    flags = {
      roleplay: f.roleplay !== false,
      qa: f.qa !== false,
      quiz: f.quiz !== false,
      announcement: String(f.announcement || "").slice(0, 200)
    };
    const json = JSON.stringify(flags, null, 2);
    try { fs.writeFileSync(FLAGS_FILE, json); } catch {}
    if (useGitHub()) {
      await backupBeforeRedeploy();
      await ghSaveFile("config/feature-flags.json", json, "[skip render] 系統管理：更新功能開關與公告（後台）");
    }
    audit("功能開關", `演練:${flags.roleplay ? "開" : "關"} 問答:${flags.qa ? "開" : "關"} 測驗:${flags.quiz ? "開" : "關"}${flags.announcement ? `，公告：${flags.announcement}` : ""}`, "admin", req);
    res.json({ ok: true, flags, persisted: useGitHub() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 業務名單：立即生效（記憶體）＋ 存回 GitHub 的 trainer-config.json
app.post("/api/admin/roster", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  const roster = Array.isArray(req.body.roster)
    ? [...new Set(req.body.roster.map((n) => String(n).trim()).filter(Boolean))]
    : null;
  if (!roster || !roster.length) return res.status(400).json({ error: "名單不可為空" });
  try {
    const before = config.roster || [];
    const added = roster.filter((n) => !before.includes(n));
    const removed = before.filter((n) => !roster.includes(n));
    config.roster = roster;
    const json = JSON.stringify(config, null, 2);
    try { fs.writeFileSync(path.join(__dirname, "config", "trainer-config.json"), json); } catch {}
    if (useGitHub()) {
      await backupBeforeRedeploy();
      await ghSaveFile("config/trainer-config.json", json, `[skip render] 系統管理：更新業務名單（${before.length} → ${roster.length} 人，後台）`);
    }
    audit("名單更新", `${before.length} → ${roster.length} 人${added.length ? `，新增：${added.join("、")}` : ""}${removed.length ? `，移除：${removed.join("、")}` : ""}`, "admin", req);
    res.json({ ok: true, roster, persisted: useGitHub() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 手動備份
app.post("/api/admin/backup", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  try { res.json(await runBackup("手動備份", req)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 下載完整備份（JSON 檔：演練紀錄＋稽核日誌＋指定演練繳交）
app.post("/api/admin/backup/download", (req, res) => {
  if (!gate(req, res, "admin")) return;
  audit("下載備份", `${readRecords().length} 筆`, "admin", req);
  const payload = { savedAt: new Date().toISOString(), records: readRecords(), audit: readAudit(), submissions: readSubmissions() };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=oright-trainer-backup-${new Date().toISOString().slice(0, 10)}.json`);
  res.send(JSON.stringify(payload, null, 2));
});

// ══════════════════ 指定演練（主管出題 → 業務錄音繳交 → AI 依重點評分 → 優良話術收錄） ══════════════════
const ASSIGNMENTS_FILE = path.join(__dirname, "config", "assignments.json");
const EXEMPLAR_KB = "14_優良話術示範.md";   // 核可後收錄的知識檔名
let assignments = [];
try { assignments = JSON.parse(fs.readFileSync(ASSIGNMENTS_FILE, "utf8")).assignments || []; } catch {}

function saveAssignmentsLocal() {
  try { fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify({ assignments }, null, 2)); } catch {}
}
async function persistAssignments() {
  saveAssignmentsLocal();
  if (useGitHub()) {
    await backupBeforeRedeploy();
    await ghSaveFile("config/assignments.json", JSON.stringify({ assignments }, null, 2), "[skip render] 指定演練：更新題目（後台）");
  }
}
const genId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── 音檔轉逐字稿（OpenAI Whisper）──
// 前端把音檔轉成 base64 傳來（避免加 multipart 依賴）；此路由單獨用較大的 body limit。
app.post("/api/transcribe", express.json({ limit: "30mb" }), async (req, res) => {
  try {
    if (!openaiClient) return res.status(503).json({ error: "音檔轉寫需要 OpenAI 金鑰（PROVIDER=openai）" });
    const { audio, filename } = req.body || {};
    if (!audio) return res.status(400).json({ error: "缺少音檔" });
    const b64 = String(audio).includes(",") ? String(audio).split(",")[1] : String(audio);
    const buf = Buffer.from(b64, "base64");
    if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: "音檔過大（上限 25MB），請壓縮或縮短" });
    const { toFile } = require("openai");
    const file = await toFile(buf, filename || "audio.webm");
    const out = await openaiClient.audio.transcriptions.create({
      file,
      model: process.env.TRANSCRIBE_MODEL || "whisper-1",
      language: "zh"
    });
    res.json({ transcript: toTraditional(out.text || "") });
  } catch (err) {
    console.error("transcribe error:", err);
    res.status(500).json({ error: err.message || "轉寫失敗" });
  }
});

// ── 業務端：目前開放中的指定演練 ──
app.get("/api/assignments/active", (req, res) => {
  res.json({
    assignments: assignments
      .filter((a) => a.active)
      .map((a) => ({ id: a.id, title: a.title, brief: a.brief, minutes: a.minutes, focus: a.focus }))
  });
});

// ── 業務端：繳交演練（逐字稿）→ 依題目重點＋五大構面評分 ──
app.post("/api/assignment/submit", async (req, res) => {
  try {
    const { assignmentId, name, transcript } = req.body || {};
    const a = assignments.find((x) => x.id === assignmentId);
    if (!a) return res.status(404).json({ error: "找不到此題目（可能已關閉）" });
    if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: "缺少演練內容" });

    let evaluation;
    if (!llm) {
      evaluation = { ...DEMO_ASSIGNMENT_EVAL };
    } else {
      evaluation = await callGen(
        prompts.buildAssignmentEval(a, config.constructs),
        [{ role: "user", content: `業務「${name || "未填寫"}」的演練逐字稿：\n\n${String(transcript).slice(0, 12000)}` }],
        ASSIGNMENT_EVAL_SCHEMA,
        { maxTokens: 3000, contextQuery: `${a.title} ${a.focus || ""}`.slice(0, 200), retrieveOpts: { limit: 3, minScore: 1 } }
      );
    }

    const submission = {
      id: genId(),
      assignmentId: a.id,
      assignmentTitle: a.title,
      name: (name || "").trim() || "未填寫",
      date: new Date().toISOString(),
      transcript: String(transcript),
      total_score: evaluation.total_score,
      level: evaluation.level,
      criteria_scores: evaluation.criteria_scores || [],
      construct_scores: evaluation.construct_scores || [],
      strengths: evaluation.strengths || [],
      improvements: evaluation.improvements || [],
      overall: evaluation.overall || "",
      nominated: false,
      approved: false
    };
    const list = readSubmissions();
    list.push(submission);
    writeSubmissions(list);
    if (Date.now() - lastBackupAt > 24 * 3600 * 1000) runBackup("每日自動備份").catch(() => {});
    // 非阻塞歸檔到 Google Sheet「指定演練」分頁
    sendToSheet("指定演練", {
      "時間": taipeiTime(submission.date),
      "業務": submission.name,
      "題目": submission.assignmentTitle,
      "總分": submission.total_score != null ? submission.total_score : "",
      "層級": submission.level || "",
      "重點評分": submission.criteria_scores.map((c) => `${c.point}:${c.mark}`).join("、"),
      "做得好": submission.strengths.join("；"),
      "待加強": submission.improvements.join("；"),
      "整體評語": submission.overall,
      "逐字稿": submission.transcript
    }).catch(() => {});
    res.json({ ok: true, submissionId: submission.id, evaluation });
  } catch (err) {
    console.error("assignment/submit error:", err);
    res.status(500).json({ error: err.message || "評分失敗" });
  }
});

// ── 出題管理（管理員）──
app.post("/api/admin/assignments", (req, res) => {
  if (!gate(req, res, "admin")) return;
  const subs = readSubmissions();
  const withCounts = assignments.map((a) => ({
    ...a,
    submissionCount: subs.filter((s) => s.assignmentId === a.id).length
  }));
  res.json({ assignments: withCounts });
});

app.post("/api/admin/assignment/save", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  const { id, title, brief, focus, minutes, active } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "缺少題目名稱" });
  try {
    const data = {
      title: String(title).trim(),
      brief: String(brief || "").trim(),
      focus: String(focus || "").trim(),
      minutes: Number(minutes) || 5,
      active: active !== false
    };
    let saved;
    if (id) {
      const a = assignments.find((x) => x.id === id);
      if (!a) return res.status(404).json({ error: "找不到題目" });
      Object.assign(a, data);
      saved = a;
    } else {
      saved = { id: genId(), createdAt: new Date().toISOString(), ...data };
      assignments.push(saved);
    }
    await persistAssignments();
    audit("指定演練出題", `${id ? "更新" : "新增"}：${saved.title}（${saved.active ? "開放" : "關閉"}）`, "admin", req);
    res.json({ ok: true, assignment: saved, persisted: useGitHub() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/assignment/delete", async (req, res) => {
  if (!gate(req, res, "admin")) return;
  const { id } = req.body || {};
  const a = assignments.find((x) => x.id === id);
  if (!a) return res.status(404).json({ error: "找不到題目" });
  try {
    assignments = assignments.filter((x) => x.id !== id);
    await persistAssignments();
    audit("指定演練刪題", a.title, "admin", req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 繳交檢視（管理員）──
app.post("/api/admin/submissions", (req, res) => {
  if (!gate(req, res, "admin")) return;
  const { assignmentId } = req.body || {};
  let list = readSubmissions();
  if (assignmentId) list = list.filter((s) => s.assignmentId === assignmentId);
  res.json({ submissions: list.slice().reverse() });
});

// ── 兩段式收錄：① 管理員標記優良候選 ──
app.post("/api/admin/submission/nominate", (req, res) => {
  const role = gate(req, res, "admin");
  if (!role) return;
  const { id, nominate } = req.body || {};
  const list = readSubmissions();
  const s = list.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: "找不到繳交紀錄" });
  s.nominated = nominate !== false;
  if (!s.nominated) s.approved = false;
  writeSubmissions(list);
  audit("優良話術候選", `${s.nominated ? "標記" : "取消"}：${s.name}／${s.assignmentTitle}`, role, req);
  res.json({ ok: true, nominated: s.nominated });
});

// 收錄時寫進知識檔的段落標題（收錄與取消收錄共用同一格式，才能精準找到並移除）
function exemplarHeading(s) {
  return `## ${s.assignmentTitle}｜${s.name}（${new Date(s.date).toISOString().slice(0, 10)}，${s.total_score}分／${s.level}）`;
}

// ── 收錄：管理員核可 → 收錄進知識庫（流程：後台勾選優良 → 匯出給高層過目 → 回來批次收錄）──
app.post("/api/admin/submission/approve", async (req, res) => {
  const role = gate(req, res, "admin");
  if (!role) return;
  const { id } = req.body || {};
  const list = readSubmissions();
  const s = list.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: "找不到繳交紀錄" });
  if (!s.nominated) return res.status(400).json({ error: "此繳交尚未被標記為優良候選" });
  // 順序很重要：先寫入狀態→再備份（快照才含 approved=true）→最後寫知識庫（會觸發重新部署）。
  // 反過來的話，重新部署後會從「收錄前」的備份還原，收錄狀態就消失了。
  s.approved = true;
  s.approvedAt = new Date().toISOString();
  writeSubmissions(list);
  try {
    let existing = "";
    try { existing = await getKnowledge(EXEMPLAR_KB); } catch {}
    if (!existing) existing = "# 優良話術示範\n\n經核可收錄的業務優良演練話術，供 AI 問答與演練回饋參考。\n";
    await backupBeforeRedeploy();
    // 防重複：知識檔已有同一段（例如狀態曾被舊備份蓋掉後重按收錄）就不再附加
    if (!existing.includes(exemplarHeading(s))) {
      const block = `\n\n${exemplarHeading(s)}\n\n${s.transcript.trim()}\n`;
      await saveKnowledge(EXEMPLAR_KB, existing + block);
    }
    audit("優良話術收錄", `核可並收錄：${s.name}／${s.assignmentTitle}`, role, req);
    res.json({ ok: true, filename: EXEMPLAR_KB });
  } catch (e) {
    // 知識庫寫入失敗 → 回滾狀態，避免「顯示已收錄但知識庫沒有」
    s.approved = false;
    delete s.approvedAt;
    writeSubmissions(list);
    res.status(500).json({ error: e.message });
  }
});

// ── 取消收錄：從知識庫的優良話術檔移除該段，繳交狀態退回「優良候選」──
app.post("/api/admin/submission/unapprove", async (req, res) => {
  const role = gate(req, res, "admin");
  if (!role) return;
  const { id } = req.body || {};
  const list = readSubmissions();
  const s = list.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: "找不到繳交紀錄" });
  if (!s.approved) return res.status(400).json({ error: "此繳交尚未收錄" });
  // 同 approve：先寫狀態→備份→最後寫知識庫（會觸發重新部署），失敗回滾
  s.approved = false;
  delete s.approvedAt;
  writeSubmissions(list);
  try {
    let removed = false;
    let content = "";
    try { content = await getKnowledge(EXEMPLAR_KB); } catch {}
    if (content) {
      const heading = exemplarHeading(s);
      const start = content.indexOf(heading);
      if (start >= 0) {
        // 移除從本段標題到下一個「## 」標題（或檔尾）之間的內容
        const next = content.indexOf("\n## ", start + heading.length);
        const before = content.slice(0, start).replace(/\n+$/, "\n");
        const after = next >= 0 ? "\n" + content.slice(next + 1) : "";
        await backupBeforeRedeploy();
        await saveKnowledge(EXEMPLAR_KB, (before + after).trim() + "\n");
        removed = true;
      }
    }
    audit("優良話術取消收錄", `${s.name}／${s.assignmentTitle}${removed ? "" : "（知識檔中未找到對應段落，可能已被手動編輯）"}`, role, req);
    res.json({
      ok: true, removed,
      note: removed ? "已從知識庫移除該段話術" : "繳交狀態已退回候選；但知識檔中找不到對應段落（可能已被手動編輯），請至知識庫管理檢視 " + EXEMPLAR_KB
    });
  } catch (e) {
    s.approved = true;
    s.approvedAt = new Date().toISOString();
    writeSubmissions(list);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/quiz/next", featureGate("quiz", "隨機測驗"), async (req, res) => {
  try {
    const { module, asked, files, direction } = req.body;
    if (!llm) return res.json(DEMO_QUIZ_Q);
    const isCustom = module === "custom";
    const customFiles = isCustom && Array.isArray(files)
      ? files.filter((f) => (KNOWLEDGE.files || []).includes(f))
      : null;
    if (isCustom && (!customFiles || !customFiles.length)) {
      return res.status(400).json({ error: "自訂範圍至少要勾選一個知識檔" });
    }
    const mod = config.quizModules.find((x) => x.id === module);
    const result = await callGen(
      prompts.buildQuizNext(module, asked || [], { files: customFiles, direction }),
      [{ role: "user", content: "請出下一題。" }],
      QUIZ_Q_SCHEMA,
      {
        maxTokens: 2000,
        contextQuery: isCustom
          ? (direction && direction.trim() ? direction : "產品 價格 容量 特色 話術 重點 注意事項")
          : (mod ? mod.scope : "品牌 產品 療程 話術"),
        retrieveOpts: isCustom
          ? { limit: 3, minScore: 0, files: customFiles }
          : { limit: 3, minScore: 1 }
      }
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


// 測驗結束歸檔：前端在成績頁產生時回報，寫進 Google Sheet「測驗成績」分頁（非阻塞、失敗不影響使用者）
app.post("/api/quiz/record", async (req, res) => {
  try {
    const { name, moduleLabel, total, correct, items, debug_archive } = req.body || {};
    if (!total) return res.json({ ok: true, skipped: true });
    const summary = Array.isArray(items)
      ? items.map((it, i) => `${i + 1}.${it.correct ? "✓" : "✗"} ${String(it.question || "").slice(0, 40)}`).join("\n")
      : "";
    const send = sendToSheet("測驗成績", {
      "時間": taipeiTime(),
      "業務": (name || "").trim() || "未填寫",
      "測驗範圍": moduleLabel || "",
      "題數": total,
      "答對": correct != null ? correct : "",
      "正確率": total ? Math.round(((correct || 0) / total) * 100) + "%" : "",
      "逐題摘要": summary
    });
    if (debug_archive) return res.json({ ok: true, archive: await send });   // 排查用：等結果並回報
    send.catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true });   // 歸檔失敗不影響使用者
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
  if (!ADMIN_PASSWORD) console.warn("⚠️ 未設定 ADMIN_PASSWORD：REPORT_PASSWORD 目前具有完整管理權限。交接前請在環境變數設定 ADMIN_PASSWORD 以啟用兩級權限。");
  restoreFromBackup();   // 重新部署後從 GitHub 備份還原演練紀錄（非阻塞）
});
