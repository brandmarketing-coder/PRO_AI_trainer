// 知識庫載入：不再把整包知識庫塞進 system prompt（會超過模型上下文上限，且浪費成本），
// 改成「目錄索引＋搜尋工具」模式——system prompt 只放章節目錄，AI 需要具體事實時
// 呼叫 search_knowledge 工具查詢，只取回相關章節。
const fs = require("fs");
const path = require("path");

// 優先順序：環境變數指定 > 本機真實知識庫資料夾（若存在，方便本機直接編輯即生效）> 隨repo附帶的知識庫副本（雲端部署用）
const LOCAL_LIVE_DIR = "C:/Users/oright/Desktop/沙龍/教育訓練機器人/Markdown";
const BUNDLED_DIR = path.join(__dirname, "knowledge");
const KNOWLEDGE_DIR =
  process.env.KNOWLEDGE_DIR ||
  (fs.existsSync(LOCAL_LIVE_DIR) ? LOCAL_LIVE_DIR : BUNDLED_DIR);

// 查找優先順序（依機器人指令）：10 > 最新年度簡報(2026>2025>2024) > 06 > 04 > 12 > 03 > 01 > 02 > 05
const PRIORITY_ORDER = [
  "10_PRO目錄.md",
  "08_產品上市簡報_2026.md",
  "07_產品上市簡報_2025.md",
  "09_產品上市簡報_2024.md",
  "06_重要實證與禁用話術索引.md",
  "04_產品成分與分類表.md",
  "12_產品索引總表.md",
  "03_業務FAQ與標準回答.md",
  "01_品牌與業務定位.md",
  "02_產品與療程總覽.md",
  "05_話術訓練與L1L2L3評分.md"
];

// 許多知識檔案幾乎沒有 Markdown 標題（像是投影片/PDF 轉出的純文字，段落間只靠空行區隔），
// 若只依標題切，單一章節可能整份檔案都算一段（例如 130KB 的檔案只有 1 個標題）。
// 所以先依標題切出「小節」，小節內容仍過長時再依空行段落進一步切成 ~CHUNK_TARGET 字的小塊，
// 段落本身過長（無空行可切）則直接依字數硬切，確保每個可搜尋單位都夠小。
const CHUNK_TARGET = 900;

function chunkText(text, target = CHUNK_TARGET) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > target) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.flatMap((c) => {
    if (c.length <= target * 1.6) return [c];
    const parts = [];
    for (let i = 0; i < c.length; i += target) parts.push(c.slice(i, i + target));
    return parts;
  });
}

// 依 Markdown 標題（# ~ ####）先切出「小節」（region），回傳 { heading, text }[]
function splitRegions(file, content) {
  const lines = content.split(/\r?\n/);
  const regions = [];
  let current = { heading: file, body: [] };
  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.*)/);
    if (m) {
      if (current.body.join("\n").trim()) regions.push(current);
      current = { heading: m[2].trim() || file, body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("\n").trim()) regions.push(current);
  return regions.map((r) => ({ heading: r.heading, text: r.body.join("\n").trim() })).filter((r) => r.text);
}

// 小節再依段落大小切成可搜尋的小塊，回傳 { file, heading, text }[]
function splitSections(file, content) {
  const regions = splitRegions(file, content);
  const sections = [];
  regions.forEach((region) => {
    const chunks = chunkText(region.text);
    chunks.forEach((chunk, i) => {
      const heading = chunks.length > 1 ? `${region.heading}（第 ${i + 1}/${chunks.length} 段）` : region.heading;
      sections.push({ file, heading, text: chunk });
    });
  });
  return sections;
}

function loadKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.warn(`[knowledge] 找不到知識庫資料夾：${KNOWLEDGE_DIR}`);
    return { files: [], sections: [], indexText: "" };
  }
  const available = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md"));
  const ordered = [
    ...PRIORITY_ORDER.filter((f) => available.includes(f)),
    ...available.filter((f) => !PRIORITY_ORDER.includes(f))
  ];

  const sections = [];
  const indexLines = [];
  ordered.forEach((file, priorityIdx) => {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), "utf8");
    const fileSections = splitSections(file, content);
    fileSections.forEach((s) => sections.push({ ...s, priority: priorityIdx }));
    // 索引只列小節層級的標題（去掉切塊編號），避免同一小節被切成很多塊時塞爆索引
    const regionHeadings = [...new Set(splitRegions(file, content).map((r) => r.heading))].slice(0, 15);
    indexLines.push(`${priorityIdx + 1}. ${file}（約 ${fileSections.length} 個可搜尋段落）：${regionHeadings.join("、")}`);
  });

  const indexText =
    `以下是 O'right｜PRO 業務教育知識庫的檔案與章節目錄（依查找優先順序排列，前面優先；若不同檔案資訊衝突，以排序在前者為準）：\n\n` +
    indexLines.join("\n") +
    `\n\n你目前「只看得到上面的標題」，沒有看到內文。凡是要回答具體事實——產品名稱、成分、規格、容量、價格、綠色關鍵、香氛、上市年份、現行狀態、話術、禁用詞、FAQ 標準答案等——都必須先呼叫 search_knowledge 工具查詢內文，不能憑記憶回答或編造。查不到時，直接說「目前資料中沒有看到明確說明」。`;

  console.log(`[knowledge] 已載入 ${ordered.length} 個檔案、切成 ${sections.length} 個章節（${KNOWLEDGE_DIR}）`);
  return { files: ordered, sections, indexText };
}

// 簡易關鍵字搜尋：依標題+內文的關鍵字命中數評分，優先序高的檔案同分時排前面
// 為了控制 token 消耗，回傳限制在 3 段 × 800 字（原本 5 × 1800 字太多）
function searchKnowledge(sections, query, { file, limit = 3 } = {}) {
  if (!sections || !sections.length) return "知識庫尚未載入或找不到資料夾。";
  let candidates = sections;
  if (file) {
    candidates = candidates.filter((s) => s.file === file);
    if (!candidates.length) return `找不到檔案「${file}」，請確認檔名是否正確。`;
  }
  const q = (query || "").trim();
  const terms = q.toLowerCase().split(/[\s,，、。/／()（）]+/).filter(Boolean);
  const scored = candidates
    .map((s) => {
      const hay = (s.heading + " " + s.text).toLowerCase();
      let score = 0;
      if (q && hay.includes(q.toLowerCase())) score += 10;
      terms.forEach((t) => { if (t && hay.includes(t)) score += 1; });
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.priority - b.priority);

  if (!scored.length) return `沒有找到符合「${q}」的內容。可能是拼寫不同或此知識庫沒有這項資料，請換個關鍵字再試一次，或直接回答「目前資料中沒有看到明確說明」。`;

  return scored
    .slice(0, limit)
    .map((s) => `【${s.file} - ${s.heading}】\n${s.text.slice(0, 800)}`)
    .join("\n\n──────────\n\n");
}

module.exports = { loadKnowledge, searchKnowledge, KNOWLEDGE_DIR };
