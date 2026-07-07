# O'right｜PRO 業務教育教練（網頁版）

教育長的 AI 分身：知識學習、情境演練、隨機測驗、話術優化與訓練報告，取代原本的 ChatGPT 機器人。

🔎 **靜態展示版（僅預覽介面，非真實 AI）**：https://brandmarketing-coder.github.io/PRO_AI_trainer/
🚀 **完整可用版本**：需自行部署 Node 伺服器，見下方「部署完整版本」。

## 三大功能

1. **情境演練**：陌生開發／句點王模式／軟釘子模式 × 新人（低階）／中階／資深（高階）
   - 演練中不評分；每句話可展開「💡 看看怎麼說可以更好」（一句評價＋一個建議＋示範說法）
   - 講出禁用話術、錯誤綠色關鍵或醫療式宣稱時自動跳出「即時糾錯」
   - 陌生開發內建六大關卡追蹤（開場破冰→需求探索→產品連結→綠色差異→異議處理→推進下一步）
   - 結束後產出「O'right｜PRO 業務訓練評估報告（固定評分標準版）」：100 分制五大構面 + L1/L2/L3 並行、逐輪完整原文與逐輪評分，共十一節，格式與主管 Word 模版一致，可下載 Word／PDF 或分享
2. **知識問答**：依知識庫優先順序查找（10_PRO目錄 > 最新年度簡報 > 06 實證與禁用話術 > …），產品題以【業務理解】【產品重點】【可以這樣說】【進階說法】【提醒】結構回答
3. **隨機測驗**：七大模組（品牌／療程／產品／陌生開發／FAQ／成分規格／話術）逐題測驗、逐題評分講解；可下載完整 70 題題庫 Word

## 本機安裝與啟動

```bash
npm install
copy .env.example .env   # 填入 ANTHROPIC_API_KEY
npm start                # http://localhost:3000
```

> 未設定 API 金鑰時以「示範模式」運作（固定腳本），可先測介面。

## 部署完整版本

這是 Node.js／Express 應用，**無法**部署在 GitHub Pages（純靜態）上——GitHub Pages 只能放展示用的靜態頁面（見上方連結），無法執行伺服器程式或安全存放 API 金鑰。要讓同事真正使用 AI 對練，請部署到有 Node 執行環境的平台：

### 方式一：Render（推薦，有免費方案）

1. 到 [render.com](https://render.com) 用 GitHub 帳號登入，選 **New → Web Service**，連結 `brandmarketing-coder/PRO_AI_trainer`
2. Render 會讀到本專案的 `render.yaml` 自動帶入設定（Build：`npm install`／Start：`npm start`）
3. 在環境變數加入 `ANTHROPIC_API_KEY`（必填）；`MODEL` 預設為 `claude-opus-4-8`，可不填
4. 部署完成後會得到一個 `https://xxx.onrender.com` 網址，這就是完整可用版本

### 方式二：Railway

1. 到 [railway.app](https://railway.app)，New Project → Deploy from GitHub repo → 選這個 repo
2. Variables 加入 `ANTHROPIC_API_KEY`
3. Railway 會自動偵測 Node 專案並執行 `npm install` + `npm start`

### 知識庫在雲端部署時如何運作

本機開發時，程式會優先讀取 `C:\Users\oright\Desktop\沙龍\教育訓練機器人\Markdown`（那台電腦上的即時知識庫，改檔案重啟伺服器就生效）。
**部署到雲端（Render/Railway）時該路徑不存在**，程式會自動改用隨 repo 一起上傳的 `knowledge/` 資料夾副本。
若要更新雲端版本的知識庫內容：更新 `knowledge/` 資料夾裡的 .md 檔、`git commit` + `git push` 即可（平台會自動重新部署）。

## 知識庫查找優先順序

`10_PRO目錄.md` > 最新年度上市簡報（2026>2025>2024）> `06_重要實證與禁用話術索引.md` > `04_產品成分與分類表.md` > `12_產品索引總表.md` > `03_業務FAQ與標準回答.md` > `01_品牌與業務定位.md` > `02_產品與療程總覽.md` > `05_話術訓練與L1L2L3評分.md`

知識庫整包放入 system prompt 並透過 prompt caching 快取，重複對話成本大幅降低。

## 客製化

- **演練主題／難度／評分構面／六關卡／測驗模組**：`config/trainer-config.json`
- **角色設定與各功能指令**：`prompts.js`
- **報告模版（十一節）**：`report.js`
- **知識庫檔案**：`knowledge/`（雲端部署用副本）；本機開發預設讀取 Desktop 上的即時資料夾

## 專案結構

```
server.js          Express 伺服器與 API 路由
prompts.js          角色設定與各功能提示詞
knowledge.js         知識庫載入邏輯
report.js            Word／PDF 報告產生（含題庫 Word）
config/              演練主題／難度／評分設定
knowledge/           知識庫 Markdown 副本（雲端部署用）
fonts/               PDF 用中文字型（Noto Sans TC，確保任何平台皆可產生 PDF）
public/              完整版前端（server.js 提供）
docs/                GitHub Pages 靜態展示版（固定腳本、無真實 AI）
```
