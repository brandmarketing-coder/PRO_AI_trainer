// 報告產生模組：O'right｜PRO 業務訓練評估報告（固定評分標準版，十一節）
// Word 與 PDF 共用同一份資料；另含題庫 Word 輸出。
// data = { name, date, modeLabel, themeName, situation,
//          rounds: [{no, sales, manager}], evaluation: {...} }
const fs = require("fs");

const GREEN = "1B7A43";

// ─── 固定內容（依主管模版逐字） ───
const FIXED_S1 = [
  ["五大構面", "同理客戶、提問能力、產品連結、異議處理、成交引導。每項滿分 20 分，合計 100 分。"],
  ["100 分制", "用來呈現本次演練的量化結果。每一構面依現場表現給 0–20 分，不再使用「加權分數」這個說法。"],
  ["L1／L2／L3", "用來判斷業務話術層級與思維成熟度，與 100 分制並行使用。"],
  ["逐輪紀錄", "每一輪必須保留「業務夥伴」與「店長」完整原文對話，不可只寫摘要。"]
];

const FIXED_S2 = [
  ["L1：產品導向", "以產品、成分、功能或特色為主，較少連結沙龍需求。", "像在介紹型錄，資訊有講到，但沒有問出店長真正需求。", "60–74 分"],
  ["L2：需求導向", "能根據沙龍或顧客需求，說明產品或療程如何對應問題。", "能問需求，也能把產品、療程與沙龍現場情境連起來。", "75–89 分"],
  ["L3：價值導向", "能連結沙龍經營、顧客體驗、品牌理念、長期信任與永續價值。", "不只賣產品，而是讓店長看到合作價值與下一步行動。", "90–100 分"]
];
const S2_NOTE = "提醒：分數區間為參考，不是硬性規則。若某輪話術層級達 L3，但成交引導不足，總分仍可能低於 90 分。";

const FIXED_S3 = [
  ["同理客戶", "20 分", "能先接住店長立場、情緒與顧慮，再進入說明。", "急著反駁或推銷，沒有承接對方擔心。"],
  ["提問能力", "20 分", "能問出沙龍現況、顧客需求、品項缺口或合作卡點。", "自說自話，只介紹品牌或產品，沒有挖需求。"],
  ["產品連結", "20 分", "能把產品、療程、綠色關鍵與顧客／沙龍需求連起來。", "只講特色，沒有說明為何適合這間沙龍。"],
  ["異議處理", "20 分", "能承接拒絕點，並轉化成試做、教育或小品項切入。", "遇到拒絕就停住，或用過度宣稱硬推。"],
  ["成交引導", "20 分", "能推進到明確下一步，例如試做、示範、教育或確認品項。", "只停在聊天或介紹，沒有具體下一步。"]
];

const ROUND_SCORE_HEADERS = ["同理客戶", "提問能力", "產品連結", "異議處理", "成交引導", "本輪層級", "本輪分數", "本輪觀察與建議"];
const MARK_KEYS = ["empathy", "questioning", "product", "objection", "closing"];

// ══════════════════════════ Word ══════════════════════════
async function buildDocx(data) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType
  } = require("docx");

  const font = "Microsoft JhengHei";
  const run = (text, opts = {}) => new TextRun({ text: String(text), font, size: 21, ...opts });
  const p = (text, opts = {}) =>
    new Paragraph({ children: [run(text, opts)], spacing: { after: 100 } });
  const heading = (text) =>
    new Paragraph({
      children: [run(text, { bold: true, size: 26, color: GREEN })],
      spacing: { before: 280, after: 140 }
    });

  const cell = (text, { bold = false, fill, width, color } = {}) =>
    new TableCell({
      ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
      ...(fill ? { shading: { fill } } : {}),
      children: [new Paragraph({ children: [run(text, { bold, ...(color ? { color } : {}) })] })]
    });

  // 表格列避免被分頁切開（就是圖 2 表頭跑到上一頁、內容留在下一頁的問題根源）
  const row = (children, opts = {}) =>
    new TableRow({ children, cantSplit: true, ...(opts.header ? { tableHeader: true } : {}) });

  const headerRow = (labels, widths) =>
    new TableRow({
      children: labels.map((t, i) =>
        cell(t, { bold: true, fill: GREEN, color: "FFFFFF", width: widths ? widths[i] : undefined })
      ),
      tableHeader: true,   // 換頁時自動重複表頭
      cantSplit: true
    });

  const table = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });

  const ev = data.evaluation;
  const children = [];

  // 標題
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run("O'right｜PRO 業務訓練評估報告", { bold: true, size: 36, color: GREEN })],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run("固定評分標準版", { size: 22, color: "666666" })],
      spacing: { after: 240 }
    })
  );

  // 一、固定評分標準
  children.push(heading("一、固定評分標準（報告先看這裡）"));
  children.push(p("每份訓練報告皆先依下列標準評估，再填入後續表格；避免主管、教育長與業務夥伴對分數理解不同。"));
  children.push(
    table([
      headerRow(["評分項目", "固定說明"], [20, 80]),
      ...FIXED_S1.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, { bold: true, fill: "EAF5EE", width: 20 }), cell(v)] }))
    ])
  );

  // 二、L1/L2/L3 判定標準
  children.push(heading("二、L1／L2／L3 判定標準"));
  children.push(
    table([
      headerRow(["層級", "判定標準", "常見表現", "分數參考區間"], [16, 34, 34, 16]),
      ...FIXED_S2.map(
        (r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i === 0 ? { bold: true, fill: "EAF5EE" } : {})) })
      )
    ])
  );
  children.push(p(S2_NOTE, { italics: true, color: "666666" }));

  // 三、100 分制構面標準
  children.push(heading("三、100 分制構面標準"));
  children.push(
    table([
      headerRow(["構面", "滿分", "高分標準", "低分常見狀況"], [14, 10, 38, 38]),
      ...FIXED_S3.map(
        (r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i === 0 ? { bold: true, fill: "EAF5EE" } : {})) })
      )
    ])
  );

  // 四、訓練基本資料
  children.push(heading("四、訓練基本資料"));
  const info = [
    ["業務夥伴", data.name || "未填寫"],
    ["訓練日期", data.date],
    ["訓練模式", data.modeLabel],
    ["演練主題", data.themeName],
    ["情境", data.situation],
    ["報告版本", "固定評分標準版"]
  ];
  children.push(
    table([
      headerRow(["欄位", "內容"], [20, 80]),
      ...info.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, { bold: true, fill: "EAF5EE", width: 20 }), cell(v)] }))
    ])
  );

  // 五、五大構面總評
  children.push(heading("五、五大構面總評"));
  children.push(p("以下分數以五大構面各 20 分計算，合計滿分 100 分。"));
  children.push(
    table([
      headerRow(["構面", "評估", "本項分數", "觀察"], [16, 14, 14, 56]),
      ...ev.constructs.map(
        (c) =>
          new TableRow({
            cantSplit: true,
            children: [
              cell(c.name, { bold: true }),
              cell(markLabel(c.mark)),
              cell(`${c.score}／20`),
              cell(c.observation)
            ]
          })
      ),
      new TableRow({
        cantSplit: true,
        children: [
          cell("總分", { bold: true, fill: "EAF5EE" }),
          cell(ev.level_note, { fill: "EAF5EE" }),
          cell(`${ev.total_score}／100`, { bold: true, fill: "EAF5EE" }),
          cell(ev.overall_observation, { fill: "EAF5EE" })
        ]
      })
    ])
  );

  // 六、逐輪完整對話紀錄與評分
  children.push(heading("六、逐輪完整對話紀錄與評分"));
  children.push(p("重要規則：此區必須逐輪保留業務夥伴與店長完整原文，不可改寫成摘要。", { bold: true }));
  data.rounds.forEach((r, i) => {
    const score = ev.rounds[i];
    // keepNext：讓「第 X 輪」標題跟後面的表格保持在同一頁，避免標題落在頁尾、表格跑到下一頁
    children.push(new Paragraph({
      keepNext: true,
      children: [run(`第 ${r.no} 輪`, { bold: true, size: 23 })],
      spacing: { before: 200, after: 100 }
    }));
    children.push(
      table([
        headerRow(["角色", "完整原文對話"], [16, 84]),
        new TableRow({ cantSplit: true, children: [cell("業務夥伴", { bold: true, fill: "EAF5EE", width: 16 }), cell(r.sales)] }),
        new TableRow({ cantSplit: true, children: [cell("店長", { bold: true, fill: "EAF5EE", width: 16 }), cell(r.manager || "（本輪店長未回覆）")] })
      ])
    );
    if (score) {
      children.push(
        table([
          headerRow(ROUND_SCORE_HEADERS, [9, 9, 9, 9, 9, 9, 10, 36]),
          new TableRow({
            cantSplit: true,
            children: [
              ...MARK_KEYS.map((k) => cell(score.marks[k])),
              cell(score.level),
              cell(`${score.score}／100`),
              cell(score.observation)
            ]
          })
        ])
      );
    }
    children.push(p("", {}));
  });

  // 七、關鍵環節完成度
  children.push(heading("七、關鍵環節完成度"));
  ev.checkpoints.forEach((c) => {
    const mark = c.done ? "✓" : "✗";
    const note = c.note ? `（${c.note}）` : "";
    children.push(p(`${mark} ${c.name}${note}`, { color: c.done ? "1B7A43" : "AA3333" }));
  });

  // 八、可改善方向
  children.push(heading("八、可改善方向"));
  ev.improvements.forEach((m) => children.push(p(`• ${m}`)));

  // 九、建議改寫
  children.push(heading("九、建議改寫"));
  children.push(p("可以這樣說：", { bold: true }));
  children.push(p(`「${ev.rewrite_example}」`));

  // 十、整體評估
  children.push(heading("十、整體評估"));
  children.push(
    table([
      headerRow(["項目", "評估內容"], [20, 80]),
      new TableRow({ cantSplit: true, children: [cell("整體層級", { bold: true, fill: "EAF5EE", width: 20 }), cell(ev.level_note)] }),
      new TableRow({ cantSplit: true, children: [cell("總分", { bold: true, fill: "EAF5EE", width: 20 }), cell(`${ev.total_score}／100`)] }),
      new TableRow({ cantSplit: true, children: [cell("整體判斷", { bold: true, fill: "EAF5EE", width: 20 }), cell(ev.overall_judgment)] })
    ])
  );

  // 十一、下一步訓練建議
  children.push(heading("十一、下一步訓練建議"));
  children.push(
    table([
      headerRow(["訓練方向", "建議做法"], [24, 76]),
      ...ev.next_steps.map(
        (s) => new TableRow({ cantSplit: true, children: [cell(s.direction, { bold: true, width: 24 }), cell(s.method)] })
      )
    ])
  );

  const doc = new Document({
    creator: "O'right｜PRO 業務教育教練",
    sections: [{ children }] // 預設直式 A4
  });
  return Packer.toBuffer(doc);
}

function markLabel(mark) {
  return mark === "◎" ? "◎ 到位" : mark === "○" ? "○ 基本" : "△ 待加強";
}

// ══════════════════════════ 題庫 Word ══════════════════════════
async function buildQuizBankDocx(items) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType
  } = require("docx");
  const font = "Microsoft JhengHei";
  const run = (text, opts = {}) => new TextRun({ text: String(text), font, size: 21, ...opts });
  const cellOf = (text, opts = {}) =>
    new TableCell({
      ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
      ...(opts.fill ? { shading: { fill: opts.fill } } : {}),
      children: [new Paragraph({ children: [run(text, { bold: !!opts.bold, ...(opts.color ? { color: opts.color } : {}) })] })]
    });

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run("O'right｜PRO 業務訓練題庫（七大模組）", { bold: true, size: 32, color: GREEN })],
      spacing: { after: 240 }
    })
  ];

  items.forEach((q) => {
    children.push(
      new Paragraph({
        children: [run(`第 ${q.no} 題｜${q.module}｜${q.type}`, { bold: true, size: 24, color: GREEN })],
        spacing: { before: 240, after: 100 }
      })
    );
    const rows = [
      ["題目", q.question],
      ["評分重點", q.focus],
      ["參考回答方向", q.reference],
      ["L1 表現", q.l1],
      ["L2 表現", q.l2],
      ["L3 表現", q.l3]
    ];
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(
          ([k, v]) =>
            new TableRow({ cantSplit: true, children: [cellOf(k, { bold: true, fill: "EAF5EE", width: 20 }), cellOf(v)] })
        )
      })
    );
  });

  const doc = new Document({ creator: "O'right｜PRO 業務教育教練", sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ══════════════════════════ 測驗報告 Word ══════════════════════════
// data = { name, date, moduleLabel, total, correct, items: [{no, question, my_answer, comment, level, reference_answer, correct}] }
async function buildQuizReportDocx(data) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType
  } = require("docx");
  const font = "Microsoft JhengHei";
  const run = (text, opts = {}) => new TextRun({ text: String(text), font, size: 21, ...opts });
  const p = (text, opts = {}) => new Paragraph({ children: [run(text, opts)], spacing: { after: 100 } });
  const heading = (text) => new Paragraph({
    children: [run(text, { bold: true, size: 26, color: GREEN })],
    spacing: { before: 260, after: 140 }
  });
  const cellOf = (text, opts = {}) =>
    new TableCell({
      ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
      ...(opts.fill ? { shading: { fill: opts.fill } } : {}),
      children: [new Paragraph({ children: [run(text, { bold: !!opts.bold, ...(opts.color ? { color: opts.color } : {}) })] })]
    });

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run("O'right｜PRO 業務訓練測驗報告", { bold: true, size: 36, color: GREEN })],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(`${data.moduleLabel}｜${data.correct} / ${data.total} 題答對`, { size: 22, color: "666666" })],
      spacing: { after: 240 }
    })
  ];

  // 基本資料
  children.push(heading("測驗資訊"));
  const info = [
    ["業務夥伴", data.name || "未填寫"],
    ["測驗日期", data.date],
    ["出題範圍", data.moduleLabel],
    ["答題總數", `${data.total} 題`],
    ["答對題數", `${data.correct} 題`],
    ["正確率", data.total > 0 ? `${Math.round((data.correct / data.total) * 100)}%` : "—"]
  ];
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ cantSplit: true, tableHeader: true, children: [
          cellOf("欄位", { bold: true, fill: GREEN, color: "FFFFFF", width: 20 }),
          cellOf("內容", { bold: true, fill: GREEN, color: "FFFFFF", width: 80 })
        ]}),
        ...info.map(([k, v]) => new TableRow({ cantSplit: true, children: [
          cellOf(k, { bold: true, fill: "EAF5EE", width: 20 }),
          cellOf(v)
        ]}))
      ]
    })
  );

  // 逐題明細
  children.push(heading("逐題作答明細"));
  data.items.forEach((it) => {
    children.push(new Paragraph({
      keepNext: true,
      children: [run(`第 ${it.no} 題｜${it.module}｜${it.type}　`, { bold: true, size: 23 }),
                 run(it.correct ? "✓ 掌握不錯" : "△ 還要加強", { bold: true, size: 22, color: it.correct ? "1B7A43" : "AA3333" })],
      spacing: { before: 200, after: 100 }
    }));
    const rows = [
      ["題目", it.question],
      ["我的回答", it.my_answer || "（未作答）"],
      ["層級", it.level || "—"],
      ["評語", it.comment || "—"],
      ["參考回答", it.reference_answer || "—"]
    ];
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(([k, v]) => new TableRow({ cantSplit: true, children: [
        cellOf(k, { bold: true, fill: "EAF5EE", width: 20 }),
        cellOf(v)
      ]}))
    }));
  });

  const doc = new Document({ creator: "O'right｜PRO 業務教育教練", sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ══════════════════════════ PDF ══════════════════════════
// 優先使用隨репо附帶的 Noto Sans TC（跨平台皆可用，雲端部署不依賴系統字型），
// 找不到才退回 Windows 系統字型（本機開發時字型檔較清晰的備援）。
const path = require("path");
const FONT_CANDIDATES = [
  { path: path.join(__dirname, "fonts", "NotoSansTC-Regular.ttf"), family: undefined },
  { path: "C:/Windows/Fonts/msjh.ttc", family: "MicrosoftJhengHeiRegular" },
  { path: "C:/Windows/Fonts/msjh.ttf", family: undefined },
  { path: "C:/Windows/Fonts/mingliu.ttc", family: "PMingLiU" }
];
const FONT_BOLD_CANDIDATES = [
  { path: path.join(__dirname, "fonts", "NotoSansTC-Bold.ttf"), family: undefined },
  { path: "C:/Windows/Fonts/msjhbd.ttc", family: "MicrosoftJhengHeiBold" },
  { path: "C:/Windows/Fonts/msjhbd.ttf", family: undefined }
];
const pickFont = (cands) => cands.find((c) => fs.existsSync(c.path)) || null;

async function buildPdf(data) {
  const PDFDocument = require("pdfkit");
  const zh = pickFont(FONT_CANDIDATES);
  const zhBold = pickFont(FONT_BOLD_CANDIDATES) || zh;
  if (!zh) throw new Error("找不到可用的中文字型（msjh.ttc）");

  const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.registerFont("zh", zh.path, zh.family);
  doc.registerFont("zh-bold", zhBold.path, zhBold.family);

  const green = "#1B7A43";
  const W = doc.page.width - 112;
  const ev = data.evaluation;

  const ensureSpace = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const heading = (text) => {
    ensureSpace(46);
    doc.moveDown(0.9);
    doc.font("zh-bold").fontSize(13.5).fillColor(green).text(text, 56);
    doc.moveDown(0.25);
  };
  const body = (text, opts = {}) =>
    doc.font("zh").fontSize(10).fillColor(opts.color || "#222").text(text, opts.x || 56, doc.y, { width: opts.width || W, ...opts });
  const kv = (k, v) => {
    ensureSpace(20);
    doc.font("zh-bold").fontSize(10).fillColor("#555").text(`${k}：`, 56, doc.y, { continued: true });
    doc.font("zh").fillColor("#222").text(String(v));
  };

  // 簡易表格（依欄寬比例畫框線）
  function pdfTable(headers, rows, widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    const colW = widths.map((w) => (w / total) * W);
    const drawRow = (cells, { header = false, fill } = {}) => {
      doc.font(header ? "zh-bold" : "zh").fontSize(8.8);
      const heights = cells.map((c, i) => doc.heightOfString(String(c), { width: colW[i] - 8 }));
      const rowH = Math.max(...heights) + 8;
      ensureSpace(rowH + 2);
      const y = doc.y;
      let x = 56;
      cells.forEach((c, i) => {
        if (header) { doc.rect(x, y, colW[i], rowH).fill(green); }
        else if (fill) { doc.rect(x, y, colW[i], rowH).fill(fill); }
        doc.rect(x, y, colW[i], rowH).stroke("#BBBBBB");
        doc.font(header ? "zh-bold" : "zh").fontSize(8.8).fillColor(header ? "#FFFFFF" : "#222")
          .text(String(c), x + 4, y + 4, { width: colW[i] - 8 });
        x += colW[i];
      });
      doc.y = y + rowH;
      doc.x = 56;
    };
    if (headers) drawRow(headers, { header: true });
    rows.forEach((r) => drawRow(r.cells || r, r.cells ? { fill: r.fill } : {}));
    doc.moveDown(0.4);
  }

  // 標題
  doc.font("zh-bold").fontSize(20).fillColor(green).text("O'right｜PRO 業務訓練評估報告", { align: "center" });
  doc.font("zh").fontSize(11).fillColor("#666").text("固定評分標準版", { align: "center" });
  doc.moveDown(0.8);

  heading("一、固定評分標準（報告先看這裡）");
  body("每份訓練報告皆先依下列標準評估，再填入後續表格；避免主管、教育長與業務夥伴對分數理解不同。");
  doc.moveDown(0.3);
  pdfTable(["評分項目", "固定說明"], FIXED_S1, [2, 8]);

  heading("二、L1／L2／L3 判定標準");
  pdfTable(["層級", "判定標準", "常見表現", "分數參考區間"], FIXED_S2, [2, 3.4, 3.4, 1.6]);
  body(S2_NOTE, { color: "#666" });

  heading("三、100 分制構面標準");
  pdfTable(["構面", "滿分", "高分標準", "低分常見狀況"], FIXED_S3, [1.5, 1, 3.8, 3.8]);

  heading("四、訓練基本資料");
  pdfTable(["欄位", "內容"], [
    ["業務夥伴", data.name || "未填寫"],
    ["訓練日期", data.date],
    ["訓練模式", data.modeLabel],
    ["演練主題", data.themeName],
    ["情境", data.situation],
    ["報告版本", "固定評分標準版"]
  ], [2, 8]);

  heading("五、五大構面總評");
  pdfTable(
    ["構面", "評估", "本項分數", "觀察"],
    [
      ...ev.constructs.map((c) => [c.name, markLabel(c.mark), `${c.score}／20`, c.observation]),
      { cells: ["總分", ev.level_note, `${ev.total_score}／100`, ev.overall_observation], fill: "#EAF5EE" }
    ],
    [1.6, 1.5, 1.4, 5.5]
  );

  heading("六、逐輪完整對話紀錄與評分");
  body("重要規則：此區必須逐輪保留業務夥伴與店長完整原文，不可改寫成摘要。", { color: "#AA3333" });
  doc.moveDown(0.3);
  data.rounds.forEach((r, i) => {
    const score = ev.rounds[i];
    ensureSpace(60);
    doc.font("zh-bold").fontSize(11).fillColor("#222").text(`第 ${r.no} 輪`, 56);
    doc.moveDown(0.2);
    pdfTable(["角色", "完整原文對話"], [
      ["業務夥伴", r.sales],
      ["店長", r.manager || "（本輪店長未回覆）"]
    ], [1.6, 8.4]);
    if (score) {
      pdfTable(ROUND_SCORE_HEADERS, [
        [...MARK_KEYS.map((k) => score.marks[k]), score.level, `${score.score}／100`, score.observation]
      ], [1, 1, 1, 1, 1, 1, 1.1, 4]);
    }
  });

  heading("七、關鍵環節完成度");
  ev.checkpoints.forEach((c) => {
    // msjh 字型無 ✓/✗ 字符，PDF 改用文字標示
    const mark = c.done ? "【完成】" : "【未完成】";
    body(`${mark} ${c.name}${c.note ? `（${c.note}）` : ""}`, { color: c.done ? "#1B7A43" : "#AA3333" });
  });

  heading("八、可改善方向");
  ev.improvements.forEach((m) => body(`• ${m}`));

  heading("九、建議改寫");
  doc.font("zh-bold").fontSize(10).fillColor("#222").text("可以這樣說：", 56);
  body(`「${ev.rewrite_example}」`);

  heading("十、整體評估");
  pdfTable(["項目", "評估內容"], [
    ["整體層級", ev.level_note],
    ["總分", `${ev.total_score}／100`],
    ["整體判斷", ev.overall_judgment]
  ], [2, 8]);

  heading("十一、下一步訓練建議");
  pdfTable(["訓練方向", "建議做法"], ev.next_steps.map((s) => [s.direction, s.method]), [2.4, 7.6]);

  doc.moveDown(1);
  doc.font("zh").fontSize(8.5).fillColor("#999")
    .text(`本報告由 O'right｜PRO 業務教育教練自動產生｜${data.date}`, 56, doc.y, { width: W, align: "center" });

  doc.end();
  return done;
}

module.exports = { buildDocx, buildPdf, buildQuizBankDocx, buildQuizReportDocx };
