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

  console.log(`[knowledge] 已載入 ${ordered.length} 個檔案、切成 ${sections.length} 個章節（${KNOWLEDGE_DIR}）`);
  return { files: ordered, sections };
}

// 依查詢字串對章節評分（標題命中權重較高、完整片語命中加分，優先序高的檔案同分排前）
function scoreSections(sections, query, file) {
  let candidates = sections;
  if (file) candidates = candidates.filter((s) => s.file === file);
  const q = (query || "").trim().toLowerCase();
  // 中文無空白斷詞，除了用分隔符切，也用 2-gram 補抓片語命中
  const rough = q.split(/[\s,，、。/／()（）:：「」【】?？!！~～]+/).filter(Boolean);
  const terms = new Set(rough);
  rough.forEach((w) => {
    for (let i = 0; i + 2 <= w.length; i++) terms.add(w.slice(i, i + 2));
  });
  return candidates
    .map((s) => {
      const hay = (s.heading + " " + s.text).toLowerCase();
      let score = 0;
      if (q && hay.includes(q)) score += 12;
      terms.forEach((t) => { if (t.length >= 2 && hay.includes(t)) score += 1; });
      // 標題命中額外加分
      const head = s.heading.toLowerCase();
      terms.forEach((t) => { if (t.length >= 2 && head.includes(t)) score += 1; });
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.priority - b.priority);
}

// 檢索並回傳可直接注入 prompt 的參考資料字串；查無足夠相關內容時回傳空字串（不注入雜訊）。
// 這是「先檢索、再一次生成」架構的核心——取代原本讓模型多趟呼叫 search 工具的做法。
function retrieve(sections, query, { file, limit = 3, minScore = 2, maxChars = 800 } = {}) {
  if (!sections || !sections.length) return "";
  const scored = scoreSections(sections, query, file);
  if (!scored.length || scored[0].score < minScore) return "";
  return scored
    .slice(0, limit)
    .map((s) => `【${s.file}｜${s.heading}】\n${s.text.slice(0, maxChars)}`)
    .join("\n\n──────────\n\n");
}

// 保留 searchKnowledge 供舊呼叫相容（內部改用 scoreSections）
function searchKnowledge(sections, query, { file, limit = 3 } = {}) {
  const r = retrieve(sections, query, { file, limit, minScore: 1 });
  return r || `沒有找到符合「${query}」的內容，請換個關鍵字或回答「目前資料中沒有看到明確說明」。`;
}

module.exports = { loadKnowledge, retrieve, searchKnowledge, KNOWLEDGE_DIR };
