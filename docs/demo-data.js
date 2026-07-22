// GitHub Pages 靜態展示版 — 固定腳本資料轉接
// app.js 偵測到 window.DEMO_DATA 存在時，所有 API 呼叫都會改走這裡（無伺服器、無真實 AI）。
// 設定資料（themes/difficulties/quizModules/qaSuggestions）需與 config/trainer-config.json 保持同步。
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CONFIG = {
    demo: true,
    roster: [
      "任俊傑", "蕭詩穎", "黃琡媖", "楊皓閔", "曹智傑", "高永馨", "游筱惠", "林采築",
      "李仁智", "張沛恩", "吳怡萱", "吳承祐", "李麗真", "楊詩佳", "陳富琮", "張雅雯",
      "蘇家蓁", "廖雅慧", "彭于菲", "林淑雅", "李元宏", "黃藍瑩", "王建明", "林巧燕"
    ],
    themes: [
      {
        id: "cold-call", icon: "🚪", name: "陌生開發",
        description: "開發新沙龍：第一次拜訪、破冰、品牌介紹、建立信任、處理拒絕與爭取下一步。",
        opening_by_difficulty: {
          beginner: "你好～請問你是哪間公司的？今天過來是？",
          intermediate: "你好，我們店裡用的品牌都固定了耶。你是哪家的？有什麼事嗎？",
          advanced: "（正在忙，瞄了一眼）……業務喔？我們跟現在的品牌配合很多年了，暫時沒有要換。有什麼事快說。"
        }
      },
      {
        id: "sentence-ender", icon: "🧊", name: "句點王模式",
        description: "店長有問必答，但每句話都把話題收掉、不給延續空間。訓練你用開放式提問打開對話。",
        opening_by_difficulty: {
          beginner: "你好你好，請坐。……今天是有什麼事嗎？",
          intermediate: "你好。喔，業務喔。我們用的品牌都固定了。",
          advanced: "（點頭）嗯，你好。我等等有客人，你講重點。"
        }
      },
      {
        id: "soft-nail", icon: "🪺", name: "軟釘子模式",
        description: "店長嘴上稱讚品牌卻始終不合作。訓練辨識假性興趣、把話題拉回合作。",
        opening_by_difficulty: {
          beginner: "哎唷是 O'right 的啊！你們品牌我真的很欣賞，理念做得很好。來來來坐。",
          intermediate: "O'right 喔！你們真的很厲害，之前那個綠建築我還有看到報導。今天來是？",
          advanced: "（熱情握手）唉唷～你們葛董真的很有遠見！我常跟設計師說你們的理念超棒。啊不過我們最近比較忙啦，你先坐。"
        }
      }
    ],
    difficulties: {
      beginner: { label: "新人模式", sub: "低階", description: "店長防備度中等、多帶多鼓勵，回饋以基礎話術為主，像主管帶新人。" },
      intermediate: { label: "中階模式", sub: "進階", description: "店長務實精明、有真實異議，回饋直接具體，鼓勵與挑戰並重。" },
      advanced: { label: "資深模式", sub: "高階", description: "情境接近真實現場：當場砍價、拿競品比較、老闆在旁、時間很趕。回饋少鼓勵、多挑戰。" }
    },
    quizModules: [
      { id: "brand", name: "品牌", scope: "O'right｜PRO 品牌定位、專業、綠色、時尚、永續理念、品牌語調、綠建築、認證與 ESG 價值" },
      { id: "treatment", name: "療程", scope: "鎏金護髮、頭皮養護、翎羽燙、五公升洗髮精、兩公升 VIP 洗護系列、療程流程與沙龍應用情境" },
      { id: "product", name: "產品", scope: "各產品分類、1 至 6 號系列、頭皮噴霧、氣墊梳、身體按摩油、沐浴露、養髮液與造型品" },
      { id: "cold-call", name: "陌生開發", scope: "開發新沙龍、第一次拜訪、破冰、品牌介紹、建立信任、處理拒絕與爭取下一步" },
      { id: "faq", name: "FAQ 與標準回答", scope: "業務常見問題、標準回答、禁用話術與注意事項" },
      { id: "ingredient", name: "成分與規格", scope: "產品成分、分類、容量、價格、補充包與現行狀態" },
      { id: "script", name: "話術", scope: "話術訓練、L1/L2/L3 層級、可以這樣說與進階說法" }
    ],
    qaSuggestions: [
      { id: "product", label: "產品知識", icon: "🧴", questions: ["咖啡因養髮液怎麼跟客人介紹？", "沁涼舒活洗髮露（PRO 6號）適合什麼客人？", "4S 翎羽燙跟一般燙髮差在哪？"] },
      { id: "spec", label: "價格與規格", icon: "🏷️", questions: ["咖啡因養髮液有哪些容量跟價格？", "補充包目前有哪些包裝？", "咖啡因麥拉寧養髮液多少錢？"] },
      { id: "green", label: "綠色關鍵", icon: "🌱", questions: ["USDA Biobased 怎麼跟店長說明？", "PCR 再生瓶器的賣點怎麼講？", "零碳綠工廠可以怎麼連結合作價值？"] },
      { id: "script", label: "話術應對", icon: "💬", questions: ["店長說「太貴了」我可以怎麼回？", "第一次拜訪的開場白怎麼說比較好？", "客人問頭皮出油要推薦什麼？"] },
      { id: "forbidden", label: "禁用話術", icon: "🚫", questions: ["「治療掉髮」可以講嗎？替代說法是什麼？", "抗菌相關話術有什麼限制？", "哪些醫療式宣稱絕對不能說？"] }
    ]
  };

  const TURN = {
    reply: "嗯……你們跟我現在用的牌子差在哪？大家不是都說自己天然？",
    coaching: {
      comment: "有說明來意，但一開場就進入產品介紹，還沒接住店長的立場。",
      suggestion: "先用一個問題了解店家現況，再帶出差異點。",
      better_example: "老師，我知道您現在的品牌用得很順，我今天不是要您換掉它。想先請教一下，店裡最近在頭皮養護這塊，客人的詢問度高嗎？"
    },
    correction: { triggered: false, note: "" },
    should_end: false
  };

  const TURN_CORRECTION = {
    reply: "你這樣講我更不敢用了，治掉髮？你們是藥品喔？",
    coaching: {
      comment: "出現醫療式宣稱：「治療掉髮」是禁用話術，現場這樣講會有法規風險，必須立刻修正。",
      suggestion: "改用「頭皮養護、髮肌健康」等保養型說法，並以實證資料佐證。",
      better_example: "老師不好意思我修正一下：咖啡因養髮液是頭皮養護產品，重點是維持頭皮健康環境，我們有 SGS 相關測試資料，我帶給您參考。"
    },
    correction: { triggered: true, note: "「治療掉髮」屬醫療式宣稱（禁用話術），應改為頭皮養護、髮肌保養等說法。" },
    should_end: false
  };

  const EVAL_BASE = {
    constructs: [
      { name: "同理客戶", mark: "◎", score: 16, observation: "能先認同店長立場，降低防備。" },
      { name: "提問能力", mark: "○", score: 13, observation: "提問比例可再提升，多讓店長先說需求。" },
      { name: "產品連結", mark: "○", score: 14, observation: "有帶到綠色關鍵，但未連結到這間沙龍的具體需求。" },
      { name: "異議處理", mark: "○", score: 14, observation: "面對比較型異議沒有慌，但回應可更精煉。" },
      { name: "成交引導", mark: "△", score: 12, observation: "結尾停在介紹，未推進到明確下一步。" }
    ],
    total_score: 69,
    level: "L1",
    level_note: "L1 尾段，接近 L2",
    overall_observation: "資訊表達完整，下一步是把「介紹」轉成「對話」，先問再說。",
    checkpoints: [
      { name: "開場破冰", done: true, note: "" },
      { name: "需求探索", done: false, note: "本次未測到，建議增加提問" },
      { name: "產品／療程連結", done: true, note: "" },
      { name: "品牌綠色差異說明", done: true, note: "有提到 PCR 再生瓶器" },
      { name: "異議處理", done: true, note: "" },
      { name: "推進下一步", done: false, note: "本次未測到" }
    ],
    improvements: [
      "回答先聚焦，再展開說明。",
      "增加提問比例，讓店長先說需求。",
      "每輪結束時明確推進下一步，例如試做、示範、教育或確認品項。"
    ],
    overall_judgment: "具備基本開發架構與品牌知識，目前以產品導向為主。若能提升提問能力並在每輪推進明確下一步，可望穩定進入 L2。（此為靜態展示版範例，完整版將依真實對話與知識庫產生評估）",
    next_steps: [
      { direction: "提問能力", method: "練習每次介紹產品前，先問出沙龍目前最想改善的服務或銷售缺口。" },
      { direction: "異議處理", method: "針對「產品很齊」「庫存壓力」「設計師很忙」建立 30 秒回應版本。" },
      { direction: "成交引導", method: "每輪演練最後都要推進到一個明確下一步，例如試做、教育或確認品項。" }
    ]
  };
  const EVAL_ROUND = {
    marks: { empathy: "○", questioning: "△", product: "○", objection: "○", closing: "△" },
    level: "L1", score: 66,
    observation: "開場清楚但直接進入產品介紹，未先探詢店家現況。（靜態展示版範例）"
  };

  const QA_ANSWER =
    "【業務理解】\n咖啡因養髮液是頭皮養護型產品，適合在意頭皮健康、髮量視覺的顧客，協助沙龍切入居家養護市場。\n\n【產品重點】\n定位：頭皮養護／容量與價格：請以最新 PRO 目錄為準（靜態展示版無法查詢知識庫）。\n\n【可以這樣說】\n「老師，現在客人洗完頭最常問的就是頭皮跟髮量。這支咖啡因養髮液可以當作店裡頭皮療程的居家延伸，客人天天用、感受才會持續。」\n\n【進階說法】\n「與其說賣一支產品，不如說是幫店裡建立『療程＋居家』的頭皮養護流程，客人回購，設計師也有話題跟客人維繫。」\n\n【提醒】\n避免「治療掉髮、生髮」等醫療式宣稱，統一用「頭皮養護、髮肌健康」。\n\n（此為靜態展示版固定回覆，完整版會依知識庫即時作答）";

  const QUIZ_QUESTIONS = [
    {
      module: "品牌", type: "知識題",
      question: "客人問：「你們說的『綠色』到底是什麼意思？跟其他天然品牌差在哪？」請用業務的話回答，至少講出兩個 O'right 的綠色關鍵。",
      focus: "能否具體講出綠色關鍵（如 USDA Biobased、PCR 再生瓶器、零碳綠工廠、RE100）而非空泛形容",
      reference: "O'right 的綠是可驗證的：USDA Biobased 生物基認證與碳-14 檢測、PCR 再生瓶器、零碳綠工廠與 RE100 再生能源承諾，全部有第三方認證可查。"
    },
    {
      module: "話術", type: "判斷題",
      question: "設計師跟客人說：「這瓶養髮液可以治療掉髮，用一個月就長出來。」這句話有什麼問題？現場你會怎麼修正？",
      focus: "能否辨識醫療式宣稱（治療、生髮）屬禁用話術，並給出合規替代說法",
      reference: "「治療掉髮」「長出來」屬醫療式宣稱，是禁用話術。應改為頭皮養護、髮肌健康等保養型說法，並以實證資料輔助說明。"
    },
    {
      module: "陌生開發", type: "情境題",
      question: "第一次拜訪的沙龍店長說：「我們跟現在的品牌配合十年了，不會換。」你的下一句話會怎麼說？",
      focus: "能否先認同店長立場、不硬碰硬，再用提問或低門檻提案（試用、教育）打開空間",
      reference: "先接住立場（配合十年代表穩定），表明不是要求更換，再以開放式問題探詢缺口，或提出低門檻下一步（小型教育、單一品項試用）。"
    }
  ];

  const QUIZ_GRADE = {
    comment: "有講到概念方向，但缺少具體、可驗證的關鍵字。（靜態展示版固定範例評語，不論實際輸入內容皆顯示此評語）",
    level: "L1",
    reference_answer: "完整版會依知識庫批改並給出具體參考答案；此為靜態展示版固定內容。",
    correct: false
  };

  // 報表儀表板：靜態展示版固定範例（密碼 12890464）。名單外練習者一併示範。
  const DASHBOARD_DEMO = (() => {
    const roster = CONFIG.roster.map((name) => ({
      name, count: 0, practiced: false,
      last_score: null, last_level: null, last_weak: [], last_date: null
    }));
    roster[0] = { name: "任俊傑", count: 3, practiced: true, last_score: 82, last_level: "L2", last_weak: ["提問能力", "異議處理"], last_date: "2026-07-10" };
    roster[3] = { name: "楊皓閔", count: 1, practiced: true, last_score: 74, last_level: "L1", last_weak: ["需求探詢", "臨門一腳"], last_date: "2026-07-08" };
    const practiced = roster.filter((r) => r.practiced).length;
    return {
      summary: {
        roster_total: roster.length,
        practiced,
        not_practiced: roster.length - practiced,
        total_records: 4
      },
      roster,
      others: [
        { name: "王小明（訪客）", count: 1, practiced: true, last_score: 68, last_level: "L1", last_weak: ["表達結構", "價值傳遞", "臨門一腳"], last_date: "2026-07-05" }
      ]
    };
  })();

  // 知識庫管理：靜態展示版範例檔案清單（唯讀）
  const KB_DEMO_FILES = [
    { name: "01_品牌與業務定位.md", size: 75776, sha: null },
    { name: "03_業務FAQ與標準回答.md", size: 48231, sha: null },
    { name: "04_產品成分與分類表.md", size: 36102, sha: null },
    { name: "10_PRO目錄.md", size: 128994, sha: null }
  ];

  window.DEMO_DATA = {
    async handle(path, body) {
      switch (path) {
        case "/api/config":
          await sleep(150);
          return CONFIG;
        case "/api/roleplay/turn": {
          await sleep(900);
          const salesTurns = body.history.filter((m) => m.role === "sales").length;
          const last = [...body.history].reverse().find((m) => m.role === "sales");
          const isBad = /治療|生髮|治掉髮|藥|療效保證/.test(last ? last.text : "");
          return isBad ? TURN_CORRECTION : { ...TURN, should_end: salesTurns >= 4 };
        }
        case "/api/roleplay/evaluate": {
          await sleep(1500);
          const roundCount = body.history.filter((m) => m.role === "sales").length;
          return { ...EVAL_BASE, rounds: Array.from({ length: roundCount }, () => EVAL_ROUND) };
        }
        case "/api/qa":
          await sleep(900);
          return { answer: QA_ANSWER };
        case "/api/quiz/next": {
          await sleep(700);
          const asked = body.asked || [];
          const next = QUIZ_QUESTIONS.find((q) => !asked.includes(q.question)) || QUIZ_QUESTIONS[asked.length % QUIZ_QUESTIONS.length];
          return next;
        }
        case "/api/quiz/grade":
          await sleep(800);
          return QUIZ_GRADE;
        case "/api/records":
        case "/api/quiz/record":
          await sleep(200);
          return { ok: true, demo: true };
        case "/api/report/dashboard": {
          await sleep(300);
          if (!body || body.password !== "12890464") {
            const err = new Error("密碼錯誤");
            err.status = 401;
            throw err;
          }
          return { role: "admin", ...DASHBOARD_DEMO };
        }
        case "/api/admin/overview":
          await sleep(250);
          return {
            flags: { roleplay: true, qa: true, quiz: true, announcement: "" },
            roster: CONFIG.roster,
            audit: [
              { time: "2026-07-17T02:10:00Z", role: "admin", action: "登入後台", detail: "管理員" },
              { time: "2026-07-16T08:30:00Z", role: "admin", action: "知識庫上傳", detail: "13_夏季活動方案.md（新增）" },
              { time: "2026-07-16T08:00:00Z", role: "admin", action: "資料備份", detail: "手動備份，4 筆" },
              { time: "2026-07-15T06:00:00Z", role: "viewer", action: "登入後台", detail: "主管" }
            ],
            backup: { records: 4, lastBackupAt: "2026-07-16T08:00:00Z", store: "github" },
            admin_password_set: true
          };
        case "/api/admin/flags":
        case "/api/admin/roster":
        case "/api/admin/backup":
          await sleep(300);
          throw new Error("靜態展示版無法變更設定或備份，請使用完整部署版本。");
        case "/api/assignments/active":
          await sleep(200);
          return { assignments: [
            { id: "demo-a1", title: "模擬話術演練｜精華油升級版銷售說明", brief: "請模擬你正在向沙龍店家介紹「豐盈彈韌精華油升級版」，說明升級價值與 10mL／70mL 銷售應用。", minutes: 5, focus: "USDA 認證、質地升級、價格價值" }
          ] };
        case "/api/assignment/submit":
          await sleep(1200);
          return { ok: true, demo: true, submissionId: "demo-s1", evaluation: {
            criteria_scores: [
              { point: "USDA Biobased 認證", mark: "◎", comment: "清楚帶出天然來源與可驗證的永續價值。（靜態展示版固定範例）" },
              { point: "兩款髮質差異", mark: "○", comment: "有區分但可再具體到適用髮質。（範例）" },
              { point: "價格價值升級", mark: "◎", comment: "成功把調價包裝成整體價值升級。（範例）" }
            ],
            construct_scores: [ { name: "產品連結", mark: "◎", score: 18 }, { name: "成交引導", mark: "○", score: 15 } ],
            total_score: 88, level: "L2",
            strengths: ["結構完整、賣點連到可驗證依據"],
            improvements: ["兩款差異可再具體到髮質情境"],
            overall: "整體表現穩定，價值傳達清楚。（此為靜態展示版固定範例；完整版由 AI 依題目評分重點評分）"
          } };
        case "/api/admin/assignments":
          await sleep(200);
          return { assignments: [
            { id: "demo-a1", title: "模擬話術演練｜精華油升級版銷售說明", brief: "介紹精華油升級版…", focus: "USDA 認證、質地、價格價值", minutes: 5, active: true, submissionCount: 2 }
          ] };
        case "/api/admin/submissions":
          await sleep(200);
          return { submissions: [
            { id: "demo-s1", name: "任俊傑", date: "2026-07-16T08:30:00Z", total_score: 88, level: "L2", nominated: true, approved: false, transcript: "老師您好，這次精華油升級最大重點是通過 USDA Biobased 認證…（靜態展示版範例逐字稿）" },
            { id: "demo-s2", name: "楊皓閔", date: "2026-07-15T06:00:00Z", total_score: 74, level: "L1", nominated: false, approved: false, transcript: "我們的精華油升級了，用起來比較不油…（範例）" }
          ] };
        case "/api/transcribe":
          await sleep(600);
          throw new Error("靜態展示版無法轉寫音檔，請使用完整部署版本。");
        case "/api/admin/assignment/save":
        case "/api/admin/assignment/delete":
        case "/api/admin/submission/nominate":
        case "/api/admin/submission/approve":
          await sleep(300);
          throw new Error("靜態展示版無法變更指定演練，請使用完整部署版本。");
        case "/api/knowledge/list":
          await sleep(250);
          if (!body || body.password !== "12890464") { const e = new Error("密碼錯誤"); throw e; }
          return { files: KB_DEMO_FILES, store: "demo", repo: null };
        case "/api/knowledge/get":
          await sleep(200);
          return { filename: body.filename, content: "（靜態展示版）此為範例內容，完整版會顯示知識檔實際內容。" };
        case "/api/knowledge/upload":
          await sleep(400);
          throw new Error("靜態展示版無法上傳知識檔，請使用完整部署版本。");
        case "/api/knowledge/delete":
          await sleep(200);
          throw new Error("靜態展示版無法刪除知識檔，請使用完整部署版本。");
        default:
          throw new Error("靜態展示版不支援此功能，請使用完整部署版本。");
      }
    }
  };
})();
