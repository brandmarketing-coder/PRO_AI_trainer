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

// 中文常見填充/疑問詞——自然問句裡的這些字會產生雜訊 n-gram，比對前先移除，
// 讓真正的內容詞（產品名、規格詞）主導檢索排名。
const STOPWORDS = [
  "有哪些", "哪些", "怎麼", "為什麼", "什麼", "多少", "可以", "請問", "如何", "是否",
  "有沒有", "跟", "和", "與", "的", "了", "嗎", "呢", "喔", "啊", "要", "會", "能",
  "我", "你", "您", "他", "它", "這", "那", "些", "個", "還是", "或", "以及", "一下",
  "介紹", "說明", "告訴", "幫我", "想", "問", "回", "怎樣", "如果", "客人", "店長", "業務"
];

// 依查詢字串對章節評分。作法：去填充詞→取內容詞的 2~4-gram（長詞加重權重，
// 產品名等長字串命中最有代表性）→標題命中加成→高優先檔案同分排前。
function scoreSections(sections, query, file) {
  let candidates = sections;
  if (file) candidates = candidates.filter((s) => s.file === file);
  let q = (query || "").trim().toLowerCase();
  const rawFull = q;
  // 先移除填充/疑問詞，避免「有哪些、跟、多少」之類的 2-gram 污染排名
  STOPWORDS.forEach((w) => { q = q.split(w).join(" "); });
  const rough = q.split(/[\s,，、。/／()（）:：「」『』【】?？!！~～．.·、0-9]+/).filter((w) => w.length >= 2);
  // 每個內容詞取 2/3/4-gram，權重＝字數（4-gram 命中比 2-gram 更能代表相關性）
  const grams = new Map(); // gram -> weight
  rough.forEach((w) => {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n);
        grams.set(g, Math.max(grams.get(g) || 0, n));
      }
    }
    // 完整內容詞本身（如「咖啡因養髮液」）給更高權重
    if (w.length >= 2) grams.set(w, Math.max(grams.get(w) || 0, w.length + 2));
  });
  return candidates
    .map((s) => {
      const head = s.heading.toLowerCase();
      const hay = (head + " " + s.text).toLowerCase();
      let score = 0;
      if (rawFull.length >= 4 && hay.includes(rawFull)) score += 15; // 整句命中
      grams.forEach((weight, g) => {
        if (hay.includes(g)) score += weight;
        if (head.includes(g)) score += weight; // 標題命中再加成
      });
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
