// 知識庫健檢工具：檢查載入狀態、切塊品質，並用代表性查詢做檢索煙霧測試。
// 用法：node scripts/check-knowledge.js
// 何時跑：新增/大改知識檔後、懷疑 AI 答錯來源時、交接驗收時。
// 結果全部 PASS 代表：檔案讀得到、切塊正常、代表性問題都能檢索到正確的知識檔。
const { loadKnowledge, topSections, KNOWLEDGE_DIR } = require("../knowledge");

const K = loadKnowledge();
let failures = 0;
const warn = (msg) => console.log("  [注意] " + msg);
const fail = (msg) => { failures++; console.log("  [失敗] " + msg); };

console.log("═══ 一、載入健檢 ═══");
console.log(`  知識庫位置：${KNOWLEDGE_DIR}`);
console.log(`  檔案數：${K.files.length}；可搜尋段落數：${K.sections.length}`);
if (!K.files.length) fail("沒有載入任何知識檔");

// 每檔統計
console.log("\n  各檔段落數：");
K.files.forEach((f) => {
  const secs = K.sections.filter((s) => s.file === f);
  const chars = secs.reduce((n, s) => n + s.text.length, 0);
  console.log(`    ${f}：${secs.length} 段（約 ${(chars / 1000).toFixed(0)}k 字）`);
  if (!secs.length) fail(`${f} 切不出任何段落（檔案是空的或格式異常）`);
});

// 切塊品質
const oversized = K.sections.filter((s) => s.text.length > 1600);
if (oversized.length) warn(`${oversized.length} 個段落超過 1600 字（檢索可截斷，不影響正確性）`);
const tiny = K.sections.filter((s) => s.text.length < 30);
if (tiny.length > K.sections.length * 0.1) warn(`${tiny.length} 個段落小於 30 字（碎塊偏多，可能是格式雜訊）`);

console.log("\n═══ 二、檢索煙霧測試（代表性問題 → 應命中的知識檔） ═══");
// expect：前 3 名命中其中任一檔即 PASS（檔名子字串比對）
const CASES = [
  // 產品資訊多檔皆有；優先序高的（10目錄/08最新簡報/12索引/03FAQ）任一命中即算對
  { q: "咖啡因養髮液有哪些容量跟價格", expect: ["10_PRO目錄", "12_產品索引", "08_產品上市簡報", "03_業務FAQ"] },
  { q: "治療掉髮可以講嗎", expect: ["06_重要實證與禁用話術"] },
  { q: "USDA Biobased 認證是什麼", expect: [""] },   // 任一檔命中即可（多檔都有提到）
  { q: "沁涼舒活洗髮露適合什麼客人", expect: ["10_PRO目錄", "02_產品與療程", "12_產品索引", "03_業務FAQ", "08_產品上市簡報"] },
  { q: "PCR 再生瓶器", expect: [""] },
  { q: "店長說太貴了怎麼回", expect: ["03_業務FAQ", "05_話術訓練", "01_品牌與業務定位"] },   // 口語→同義詞擴充案例
  { q: "補充包目前有哪些包裝", expect: ["10_PRO目錄", "04_產品成分", "03_業務FAQ", "12_產品索引", "05_話術訓練"] },
  { q: "麥拉寧養髮液多少錢", expect: ["10_PRO目錄", "12_產品索引", "08_產品上市簡報"] },
  { q: "客人頭很油要用什麼", expect: ["10_PRO目錄", "02_產品與療程", "08_產品上市簡報", "03_業務FAQ", "12_產品索引"] }   // 口語擴充
];
CASES.forEach(({ q, expect }) => {
  const hits = topSections(K.sections, q, { limit: 3, minScore: 2 });
  if (!hits.length) { fail(`「${q}」→ 查無結果`); return; }
  const files = hits.map((h) => h.file);
  const ok = expect.some((e) => files.some((f) => f.includes(e)));
  console.log(`  ${ok ? "PASS" : "FAIL"} 「${q}」→ ${[...new Set(files)].join("、")}`);
  if (!ok) fail(`「${q}」預期命中 ${expect.join(" 或 ")}，實際 ${files.join("、")}`);
});

console.log("\n═══ 三、檢索效能（知識庫變大時關注這裡） ═══");
const t0 = process.hrtime.bigint();
const ROUNDS = 200;
for (let i = 0; i < ROUNDS; i++) topSections(K.sections, CASES[i % CASES.length].q, { limit: 3 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / ROUNDS;
console.log(`  平均每次檢索 ${ms.toFixed(1)} ms（${K.sections.length} 段）`);
if (ms > 50) warn("單次檢索超過 50ms；若知識庫已達數千段，可考慮建倒排索引");
else console.log("  （檢索為記憶體線性掃描，1 萬段以內都遠低於 50ms，目前規模非常安全）");

console.log(failures ? `\n結果：${failures} 項失敗，請檢查上方 [失敗] 項目` : "\n結果：全部通過");
process.exit(failures ? 1 : 0);
