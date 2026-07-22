/**
 * O'right 演練紀錄 → Google Sheet 歸檔（Google Apps Script Web App）
 *
 * 【設定步驟】
 * 1. 開啟要歸檔的 Google 試算表，看網址列：
 *      https://docs.google.com/spreadsheets/d/【這一長串就是 SHEET_ID】/edit
 *    把那串 ID 複製，貼到下方 SHEET_ID = "..." 裡（一定要填，才不會寫錯地方）。
 * 2. 該試算表上方選單「擴充功能 → Apps Script」，把本檔全部內容貼進去（取代預設程式）、按存檔。
 * 3. 先在編輯器上方函式選單選「testAppend」按「執行」測試：
 *      - 第一次會跳授權，按同意（允許存取你的試算表）。
 *      - 回試算表看有沒有多出一列「測試」假資料。有 → 寫入端 OK，把那列刪掉。
 *        沒有或報錯 → 多半是 SHEET_ID 沒填或填錯，先修好再往下。
 * 4. 右上「部署 → 新增部署作業」：
 *      - 類型選「網頁應用程式」
 *      - 「執行身分」選「我」
 *      - 「誰可以存取」選「所有人」（App 才呼叫得到；網址含隨機長字串，不會被猜到）
 *    按「部署」，複製產生的「網頁應用程式 URL」（https://script.google.com/macros/s/…/exec）。
 * 5. 【推薦】把該 URL 設為 App 的環境變數 APPS_SCRIPT_URL（Render → Environment）。
 *    App 會把整理好的欄位直接送來（免 n8n、繞過公司防火牆）。本檔 doPost 直接收「已整理好的欄位」。
 *    （舊做法：若仍走 n8n，把 URL 貼到 n8n「寫入 Google Sheet」節點亦可，兩者格式相同。）
 *
 * ⚠️ 之後每次「修改本程式」，都要「部署 → 管理部署作業 → 右上鉛筆編輯
 *    → 版本改選『新版本』→ 部署」，/exec 網址才會跑到新程式（這是最常見的『改了沒生效』原因）。
 */

// ← ★ 必填：貼上你的試算表 ID（見上方步驟 1）。留空會退回用「目前作用中的試算表」。
const SHEET_ID = "";

const SHEET_NAME = "演練紀錄"; // 要寫入的工作表分頁名稱，可自行修改

const HEADERS = [
  "時間", "業務", "主題", "模式", "總分",
  "層級", "層級說明", "待加強面向", "各面向分數", "逐字稿"
];

function getSheet_() {
  const ss = SHEET_ID
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("找不到試算表：請在程式最上方填入 SHEET_ID");
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const sheet = getSheet_();
    sheet.appendRow(HEADERS.map((h) => (data[h] != null ? String(data[h]) : "")));
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** 在瀏覽器直接開 /exec 網址時會看到這行，代表部署成功、網址正確 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, msg: "O'right 歸檔 endpoint 運作中，請用 POST 傳資料" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 在 Apps Script 編輯器直接執行這個函式，可測試寫入是否正常（不經過 n8n） */
function testAppend() {
  const fake = {
    "時間": "2026/07/17 15:00", "業務": "測試", "主題": "陌生開發", "模式": "新人",
    "總分": "82", "層級": "L2", "層級說明": "L2 穩定", "待加強面向": "成交引導",
    "各面向分數": "同理客戶:◎18、提問能力:○15", "逐字稿": "業務：您好…\n店長：嗯。"
  };
  const e = { postData: { contents: JSON.stringify(fake) } };
  Logger.log(doPost(e).getContent());
}
