// 依 config/faq-questions.json 的題目，用目前設定的 AI provider（.env 的 PROVIDER）＋知識庫，
// 預先產生每題的標準答案，寫入 config/faq.json。
// 用途：讓知識問答的常見問題「零 API 呼叫、瞬間回覆」。
// 執行：node scripts/build-faq.js   （需要 .env 有可用的 API 金鑰）
// 題目改了就重跑一次即可更新。答案是純文字、與哪家 provider 無關，故用哪家產生都可以。

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const { loadKnowledge, retrieve } = require("../knowledge");
const prompts = require("../prompts");

const KNOWLEDGE = loadKnowledge();

// ── 建立 llm（與 server.js 同邏輯的精簡版） ──
let PROVIDER = (process.env.PROVIDER || "").toLowerCase();
if (!PROVIDER) PROVIDER = process.env.OPENAI_API_KEY ? "openai" : (process.env.ANTHROPIC_API_KEY ? "anthropic" : "");

let generate = null;
if (PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
  const OpenAI = require("openai");
  const client = new OpenAI();
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  generate = async (system, user) => {
    const r = await client.chat.completions.create({
      model, max_tokens: 1500,
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    });
    return r.choices[0].message.content || "";
  };
} else if (PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const model = process.env.MODEL || "claude-sonnet-4-6";
  generate = async (system, user) => {
    const r = await client.messages.create({
      model, max_tokens: 1500,
      system, messages: [{ role: "user", content: user }]
    });
    return r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  };
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1$2")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^\s{0,3}[-*+]\s+/gm, "・")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

(async () => {
  if (!generate) {
    console.error("找不到可用的 API 金鑰（請在 .env 設定 PROVIDER 與對應的 OPENAI_API_KEY 或 ANTHROPIC_API_KEY）");
    process.exit(1);
  }
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "faq-questions.json"), "utf8"));
  const questions = seed.questions || [];
  console.log(`使用 ${PROVIDER} 產生 ${questions.length} 題 FAQ 答案…\n`);

  const dest = path.join(__dirname, "..", "config", "faq.json");
  // 逐題即時存檔：中途中斷（例如額度用完）也能保留已完成的部分，重跑會沿用既有結果、只補未完成的
  const existing = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, "utf8")) : [];
  const byQ = new Map(existing.map((e) => [e.q, e]));

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (byQ.has(q)) { console.log(`[${i + 1}/${questions.length}] ⏭ 已有，略過 ${q}`); continue; }
    try {
      const ctx = retrieve(KNOWLEDGE.sections, q, { limit: 3, minScore: 2 });
      const system =
        prompts.ROLE_CORE + "\n\n" + prompts.FAQ_BUILD_INSTRUCTIONS +
        (ctx ? "\n\n【本次知識庫參考資料（回答涉及產品事實時一律以這裡為準，沒有的就說沒看到，不要臆測）】\n" + ctx : "");
      const ans = stripMarkdown(await generate(system, q));
      byQ.set(q, { q, a: ans });
      fs.writeFileSync(dest, JSON.stringify([...byQ.values()], null, 2)); // 每題成功即存檔
      console.log(`[${i + 1}/${questions.length}] ✓ ${q}`);
    } catch (e) {
      console.error(`[${i + 1}/${questions.length}] ✗ ${q} — ${e.message}`);
    }
  }

  console.log(`\n完成，已寫入 ${dest}（共 ${byQ.size} 題；未完成的下次重跑會自動補齊）`);
})();
