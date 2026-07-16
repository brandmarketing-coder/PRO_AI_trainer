/**
 * O'right 演練紀錄 → Google Sheet 歸檔（Google Apps Script Web App）
 *
 * 【設定步驟】
 * 1. 開啟（或新建）要歸檔的 Google 試算表
 * 2. 上方選單「擴充功能 → Apps Script」，把本檔全部內容貼進去（取代預設程式）
 * 3. 右上「部署 → 新增部署作業」：
 *    - 類型選「網頁應用程式」
 *    - 「執行身分」選「我」
 *    - 「誰可以存取」選「所有人」（n8n 才呼叫得到；網址含隨機長字串，不會被猜到）
 * 4. 按「部署」，複製產生的「網頁應用程式 URL」（https://script.google.com/macros/s/…/exec）
 * 5. 把該 URL 貼到 n8n workflow「寫入 Google Sheet（Apps Script）」節點的 URL 欄位
 *
 * 之後每收到一筆演練紀錄就自動 append 一列；工作表與標題列不存在時會自動建立。
 * 修改程式後要「部署 → 管理部署作業 → 編輯 → 版本選新版本」重新部署才會生效。
 */

const SHEET_NAME = "演練紀錄"; // 要寫入的工作表名稱，可自行修改

const HEADERS = [
  "時間", "業務", "主題", "模式", "總分",
  "層級", "層級說明", "待加強面向", "各面向分數", "逐字稿"
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }
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

/** 在 Apps Script 編輯器直接執行這個函式，可測試寫入是否正常（不經過 n8n） */
function testAppend() {
  const fake = {
    "時間": "2026/07/16 15:00", "業務": "測試", "主題": "陌生開發", "模式": "新人",
    "總分": "82", "層級": "L2", "層級說明": "L2 穩定", "待加強面向": "成交引導",
    "各面向分數": "同理客戶:◎18、提問能力:○15", "逐字稿": "業務：您好…\n店長：嗯。"
  };
  const e = { postData: { contents: JSON.stringify(fake) } };
  Logger.log(doPost(e).getContent());
}
