# O'right｜PRO 業務教育教練（網頁版）

教育長的 AI 分身：知識學習、情境演練、隨機測驗、話術優化與訓練報告，取代原本的 ChatGPT 機器人。

🔎 **靜態展示版（僅預覽介面，非真實 AI）**：https://brandmarketing-coder.github.io/PRO_AI_trainer/
🚀 **完整可用版本**：需自行部署 Node 伺服器，見下方「部署完整版本」。

## 三大功能

1. **情境演練**：陌生開發／句點王模式／軟釘子模式 × 新人（低階）／中階／資深（高階）
   - 演練中不評分；每句話可展開「💡 看看怎麼說可以更好」（一句評價＋一個建議＋示範說法）
   - 講出禁用話術、錯誤綠色關鍵或醫療式宣稱時自動跳出「即時糾錯」
   - 陌生開發內建六大關卡追蹤（開場破冰→需求探索→產品連結→綠色差異→異議處理→推進下一步）
   - 結束後產出「O'right｜PRO 業務訓練評估報告（固定評分標準版）」：100 分制五大構面 + L1/L2/L3 並行、逐輪完整原文與逐輪評分，共十節，格式與主管 Word 模版一致，可下載 Word／PDF 或分享
2. **知識問答**：依知識庫優先順序查找（10_PRO目錄 > 最新年度簡報 > 06 實證與禁用話術 > …），產品題以【業務理解】【產品重點】【可以這樣說】【進階說法】【提醒】結構回答
3. **隨機測驗**：七大模組（品牌／療程／產品／陌生開發／FAQ／成分規格／話術）逐題測驗、逐題評分講解；結束產出測驗成績報告 Word

## 本機安裝與啟動

```bash
npm install
copy .env.example .env   # 設定 PROVIDER 與對應金鑰（見下方）
npm start                # http://localhost:3000
```

> 未設定 API 金鑰時以「示範模式」運作（固定腳本），可先測介面。

### 選擇 AI Provider（OpenAI 或 Claude）

本專案支援兩家 AI，用 `.env` 的 `PROVIDER` 切換，程式不用改：

| PROVIDER | 需要的金鑰 | 模型變數（選填） | 取得金鑰 |
|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL`（預設 `gpt-4o`） | platform.openai.com |
| `anthropic` | `ANTHROPIC_API_KEY` | `MODEL`（預設 `claude-opus-4-8`） | platform.claude.com |

`PROVIDER` 未指定時會自動判斷：有 `OPENAI_API_KEY` 就用 OpenAI，否則用 Anthropic。兩家的金鑰是不同系統、不能互用。切換 provider 後重啟伺服器即可；啟動訊息會顯示目前用的是哪家哪個模型。

## 部署完整版本

這是 Node.js／Express 應用，**無法**部署在 GitHub Pages（純靜態）上——GitHub Pages 只能放展示用的靜態頁面（見上方連結），無法執行伺服器程式或安全存放 API 金鑰。要讓同事真正使用 AI 對練，請部署到有 Node 執行環境的平台：

### 方式一：Render（推薦，有免費方案）

1. 到 [render.com](https://render.com) 用 GitHub 帳號登入，選 **New → Web Service**，連結 `brandmarketing-coder/PRO_AI_trainer`
2. Render 會讀到本專案的 `render.yaml` 自動帶入設定（Build：`npm install`／Start：`npm start`）
3. 在環境變數加入：`PROVIDER=openai` ＋ `OPENAI_API_KEY`（用 OpenAI）；或 `PROVIDER=anthropic` ＋ `ANTHROPIC_API_KEY`（用 Claude）。模型變數選填
4. 部署完成後會得到一個 `https://xxx.onrender.com` 網址，這就是完整可用版本

### 方式二：Railway

1. 到 [railway.app](https://railway.app)，New Project → Deploy from GitHub repo → 選這個 repo
2. Variables 加入 `PROVIDER` 與對應金鑰（`OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`）
3. Railway 會自動偵測 Node 專案並執行 `npm install` + `npm start`

### 知識庫在雲端部署時如何運作

本機開發時，程式會優先讀取 `C:\Users\oright\Desktop\沙龍\教育訓練機器人\Markdown`（那台電腦上的即時知識庫，改檔案重啟伺服器就生效）。
**部署到雲端（Render/Railway）時該路徑不存在**，程式會自動改用隨 repo 一起上傳的 `knowledge/` 資料夾副本。
若要更新雲端版本的知識庫內容：更新 `knowledge/` 資料夾裡的 .md 檔、`git commit` + `git push` 即可（平台會自動重新部署）。

## 知識庫查找優先順序

`10_PRO目錄.md` > 最新年度上市簡報（2026>2025>2024）> `06_重要實證與禁用話術索引.md` > `04_產品成分與分類表.md` > `12_產品索引總表.md` > `03_業務FAQ與標準回答.md` > `01_品牌與業務定位.md` > `02_產品與療程總覽.md` > `05_話術訓練與L1L2L3評分.md`

知識庫以「章節目錄＋search_knowledge 工具」方式供 AI 查詢（RAG），system prompt 只放輕量索引並透過 prompt caching 快取。

## 後台管理（交接沙龍部門後的日常營運）

後台入口：網站右上角圖表 icon。權限分兩級（密碼設定在部署平台的環境變數）：

| 角色 | 環境變數 | 能做什麼 |
|---|---|---|
| 主管 | `REPORT_PASSWORD` | 看「分數彙整」（各業務練習狀況與分數） |
| 管理員 | `ADMIN_PASSWORD` | 以上＋指定演練出題、優良話術匯出與收錄、知識庫管理、系統管理、資料備份 |

> ⚠️ 未設定 `ADMIN_PASSWORD` 時，主管密碼會直接擁有完整管理權限（與舊版相容）。正式交接前務必在 Render 環境變數設定 `ADMIN_PASSWORD`。

## 指定演練（主管每週出題 → 業務錄音繳交 → AI 依重點評分 → 優良話術回饋）

這是給主管指派「本週演練題目」的完整流程，取代原本「人工收音檔、轉逐字稿、貼 GPT 評分」的作法：

1. **主管出題**（後台「指定演練」分頁）：填題目名稱、演練內容說明、**本題評分重點**（每題可不同，例如這次重點是 USDA 認證與價格價值升級），設定建議時間與是否開放。
2. **業務作答**（首頁「指定演練」卡）：選題目 → 上傳事先錄好的音檔（系統用 OpenAI Whisper 自動轉逐字稿，可修正錯字）或直接打字 → 送出。
3. **AI 評分**：依「本題評分重點」逐項評分（◎○△）＋五大構面參考＋總分／層級＋優缺點與整體評語。
4. **優良話術回饋 AI**：管理員在繳交紀錄中勾選優秀的演練 →「匯出勾選的話術」下載文字檔，主管整理後在群組或會議中給高層過目 → 確認後回後台「將勾選收錄進知識庫」→ 話術寫進 `knowledge/14_優良話術示範.md`，日後 AI 問答與演練回饋會參考。

> 音檔轉寫需要 `PROVIDER=openai`；模型預設 `whisper-1`，可用 `TRANSCRIBE_MODEL` 調整。上傳上限 25MB。

**系統管理分頁**（管理員）：
- **功能開關與公告**：可暫停情境演練／知識問答／隨機測驗任一功能（首頁隱藏＋API 暫停），並在首頁顯示公告。立即生效，且存回 GitHub 永久保存
- **業務名單管理**：直接增刪業務名單（一行一名），演練姓名選單與分數彙整同步更新
- **操作稽核日誌**：記錄最近 500 筆後台操作（登入、知識庫增刪、名單與開關變更、備份），後台顯示最近 100 筆

**資料備份分頁**（管理員）：
- Render 免費方案磁碟是暫存的，因此演練紀錄有三道保護：
  1. **每日自動備份**到 GitHub（`backups/records.json`，git 歷史即備份歷史）
  2. 知識庫／名單／開關**變更前自動備份**（這些操作會觸發重新部署）
  3. 網站重新部署後**自動從最新備份還原**演練紀錄
- 另有「立即備份」與「下載完整備份（JSON）」按鈕；建議每月下載一份存公司雲端
- 若已設定 Google Sheet 歸檔（見下），每筆演練紀錄也會即時寫進試算表，為最主要的長期保存

### 演練紀錄自動歸檔到 Google Sheet

每完成一場情境演練評分，紀錄會即時寫進 Google 試算表。有兩種接法，擇一：

| 做法 | 環境變數 | 說明 |
|---|---|---|
| **App 直接寫入（推薦）** | `APPS_SCRIPT_URL` | App 直接把整理好的欄位送進 Google Apps Script。免架 n8n，且因 Apps Script 是 Google 公開網址，**不受公司防火牆限制** |
| 經 n8n 中轉（舊做法） | `N8N_WEBHOOK_URL` | App 送原始資料給 n8n，由 n8n 整理後寫 Sheet。只有未設 `APPS_SCRIPT_URL` 時才會用 |

推薦做法設定步驟：
1. 依 `n8n/google-apps-script.gs` 檔頭說明，把 Apps Script 部署成網頁應用程式（填 `SHEET_ID`、存取權設「所有人」），複製 `/exec` 網址。
2. 在 Render → Environment 設 `APPS_SCRIPT_URL` = 該 `/exec` 網址，儲存後自動重新部署。
3. 完成一場演練後，紀錄就會出現在試算表；也可用後台「資料備份」作為第二道保存。

## 客製化

- **演練主題／難度／評分構面／六關卡／測驗模組／知識問答建議提問**：`config/trainer-config.json`
- **知識問答 FAQ 快取（常見問題預先產好答案、命中即秒回）**：題目清單放 `config/faq-questions.json`，執行 `node scripts/build-faq.js` 產生 `config/faq.json`；改題目後重跑即可更新
- **角色設定與各功能指令**：`prompts.js`
- **報告模版（十節）**：`report.js`
- **知識庫檔案**：`knowledge/`（雲端部署用副本）；本機開發預設讀取 Desktop 上的即時資料夾

## 專案結構

```
server.js          Express 伺服器與 API 路由（含知識庫搜尋工具迴圈）
prompts.js          角色設定與各功能提示詞
knowledge.js         知識庫載入與關鍵字搜尋（切塊索引）
report.js            Word／PDF 報告產生（演練評估報告、測驗成績報告）
scripts/build-faq.js 依知識庫預先產生知識問答 FAQ 快取
config/              演練/難度/評分/建議提問設定、FAQ 題目與快取
knowledge/           知識庫 Markdown 副本（雲端部署用）
fonts/               PDF 用中文字型（Noto Sans TC，確保任何平台皆可產生 PDF）
public/              完整版前端（server.js 提供）
docs/                GitHub Pages 靜態展示版（同一份前端 + demo-data.js 固定腳本）
```

> `docs/` 的 `index.html`／`app.js`／`style.css` 與 `public/` 為同一份程式碼，僅多載入 `demo-data.js`
> 攔截 API 呼叫改回固定腳本。改版時同步複製即可：`cp public/app.js public/style.css docs/`（index.html 需保留 docs 版開頭的靜態提示與 demo-data.js 標籤）。
