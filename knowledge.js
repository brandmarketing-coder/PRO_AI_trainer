// 知識庫載入：從 KNOWLEDGE_DIR 讀取 Markdown 檔，依查找優先順序組成系統提示。
// 檔案順序即優先順序（前面優先）。若資料衝突，以排在前面的檔案為準。
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

function loadKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.warn(`[knowledge] 找不到知識庫資料夾：${KNOWLEDGE_DIR}`);
    return { text: "", files: [] };
  }
  const available = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md"));
  // 先照優先順序，再補上清單外的其他檔案
  const ordered = [
    ...PRIORITY_ORDER.filter((f) => available.includes(f)),
    ...available.filter((f) => !PRIORITY_ORDER.includes(f))
  ];
  const parts = [];
  const files = [];
  for (const file of ordered) {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), "utf8");
    parts.push(`\n\n════════════════════════════\n【知識檔案：${file}】\n════════════════════════════\n${content}`);
    files.push(file);
  }
  console.log(`[knowledge] 已載入 ${files.length} 個知識檔案（${KNOWLEDGE_DIR}）`);
  return {
    text:
      `以下為 O'right｜PRO 業務教育知識庫，檔案已依查找優先順序排列（越前面優先）。` +
      `若不同檔案資訊衝突，以排序在前的檔案為準。若知識庫中沒有明確答案，請直接說「目前資料中沒有看到明確說明」，不要自行編造。` +
      parts.join(""),
    files
  };
}

module.exports = { loadKnowledge, KNOWLEDGE_DIR };
