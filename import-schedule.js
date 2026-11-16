// ============================================================================
// import-schedule.js — Đọc file Word (.docx) hoặc PDF chứa "THÔNG BÁO lịch
// công tác của Thường trực Tỉnh uỷ" (đúng mẫu đang dùng) và tách thành dữ
// liệu theo từng ngày / từng buổi để tự động điền vào biểu mẫu nhập liệu.
//
// Lưu ý quan trọng: hàm này CHỈ đọc và phân tích file, KHÔNG tự lưu vào
// Firestore — kết quả trả về được dùng để điền vào currentWeekData rồi
// admin.js gọi renderDaysEditor() để biên tập viên xem lại, sau đó mới bấm
// nút "Lưu" như bình thường.
// ============================================================================

const PDFJS_VERSION = "6.2.108";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build`;
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

let _pdfjsLibPromise = null;
function loadPdfJs() {
  if (!_pdfjsLibPromise) {
    _pdfjsLibPromise = import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return _pdfjsLibPromise;
}

let _jszipPromise = null;
function loadJSZip() {
  if (!_jszipPromise) {
    _jszipPromise = import(/* @vite-ignore */ JSZIP_URL).then((mod) => mod.default || mod);
  }
  return _jszipPromise;
}
// ---------------------------------------------------------------------------
// Nhận diện nhãn buổi (Sáng / Chiều / Tối) trong nội dung mỗi ô lịch
// ---------------------------------------------------------------------------

const SESSION_MARKERS = [
  { key: "morning", label: "Sáng", re: /^s[áa]ng\s*:?\s*/i },
  { key: "afternoon", label: "Chiều", re: /^chi[eề]u\s*:?\s*/i },
  { key: "evening", label: "Tối", re: /^t[ôo]i\s*:?\s*/i },
];

const WEEKDAY_PATTERNS = [
  [/th[ứu]\s*hai/i, "Thứ Hai"],
  [/th[ứu]\s*ba/i, "Thứ Ba"],
  [/th[ứu]\s*t[ưu]/i, "Thứ Tư"],
  [/th[ứu]\s*n[ăa]m/i, "Thứ Năm"],
  [/th[ứu]\s*s[áa]u/i, "Thứ Sáu"],
  [/th[ứu]\s*b[ảa]y/i, "Thứ Bảy"],
  [/ch[ủu]\s*nh[ậa]t/i, "Chủ Nhật"],
];

// Gộp các đoạn văn bản thô của một ô (mỗi đoạn tương đương 1 paragraph Word
// hoặc 1 dòng văn bản PDF) thành { morning, afternoon, eveningNote, wholeDay }
function splitCellIntoSessions(paragraphs) {
  const clean = paragraphs
    .map((p) => String(p || "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const result = { morning: "", afternoon: "" };
  let eveningNote = "";
  let current = null;
  let sawMarker = false;
  const preMarkerLines = [];

  for (const p of clean) {
    let matched = null;
    for (const m of SESSION_MARKERS) {
      if (m.re.test(p)) { matched = m; break; }
    }
    if (matched) {
      sawMarker = true;
      const rest = p.replace(matched.re, "").trim();
      if (matched.key === "evening") {
        eveningNote = eveningNote ? eveningNote + "\n" + rest : rest;
        current = "evening";
      } else {
        current = matched.key;
        result[current] = result[current] ? result[current] + "\n" + rest : rest;
      }
    } else if (current === "evening") {
      eveningNote = eveningNote ? eveningNote + "\n" + p : p;
    } else if (current) {
      result[current] = result[current] ? result[current] + "\n" + p : p;
    } else {
      preMarkerLines.push(p);
    }
  }

  if (!sawMarker) {
    const whole = preMarkerLines.join("\n");
    return { morning: whole, afternoon: whole, eveningNote: "", wholeDay: true };
  }
  if (preMarkerLines.length) {
    const extra = preMarkerLines.join("\n");
    result.morning = result.morning ? extra + "\n" + result.morning : extra;
  }
  // Mẫu lịch hiện tại chỉ có 2 buổi (Sáng/Chiều). Nếu văn bản có thêm mục
  // "Tối: ...", ghép vào cuối phần Chiều (có ghi rõ nhãn "Tối:") để KHÔNG
  // làm mất nội dung — biên tập viên xem lại và điều chỉnh nếu cần.
  if (eveningNote) {
    result.afternoon = result.afternoon
      ? result.afternoon + "\nTối: " + eveningNote
      : "Tối: " + eveningNote;
  }
  return result;
}

function matchWeekday(text) {
  for (const [re, label] of WEEKDAY_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

function parseDateDM(text) {
  const m = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  return { day: Number(m[1]), month: Number(m[2]) };
}
// ---------------------------------------------------------------------------
// DOCX — đọc trực tiếp cấu trúc bảng trong word/document.xml (đáng tin cậy)
// ---------------------------------------------------------------------------

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function wChildren(el, local) {
  const out = [];
  for (const c of el.children) {
    if (c.localName === local && c.namespaceURI === NS_W) out.push(c);
  }
  return out;
}

function getParagraphText(pEl) {
  let out = "";
  const walk = (node) => {
    for (const child of node.children) {
      if (child.localName === "t" && child.namespaceURI === NS_W) out += child.textContent;
      else if (child.localName === "tab" && child.namespaceURI === NS_W) out += " ";
      else if (child.localName === "br" && child.namespaceURI === NS_W) out += "\n";
      else walk(child);
    }
  };
  walk(pEl);
  return out;
}

function getCellParagraphTexts(tcEl) {
  return wChildren(tcEl, "p").map(getParagraphText);
}

async function parseDocxFile(file) {
  const warnings = [];
  const JSZip = await loadJSZip();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file("word/document.xml");
  if (!entry) {
    return { ok: false, error: "Không đọc được cấu trúc file Word (thiếu word/document.xml)." };
  }
  const xml = await entry.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    return { ok: false, error: "File Word bị lỗi định dạng, không thể phân tích." };
  }

  // Tiêu đề: "(Tuần 47, từ ngày 16/11/2026 đến ngày 22/11/2026)"
  const body = doc.getElementsByTagNameNS(NS_W, "body")[0];
  let weekNumber = null, startDateStr = null, endDateStr = null;
  if (body) {
    for (const p of wChildren(body, "p")) {
      const t = getParagraphText(p);
      const m = t.match(/Tu[ầa]n\s*(\d+).*?t[ừu]\s*ngày\s*(\d{1,2}\/\d{1,2}\/\d{4}).*?đến\s*ngày\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (m) { weekNumber = Number(m[1]); startDateStr = m[2]; endDateStr = m[3]; break; }
    }
  }

  // Bảng lịch chính: bảng có >=2 dòng và dòng đầu có >= 3 cột
  const tables = [];
  for (const tblEl of doc.getElementsByTagNameNS(NS_W, "tbl")) {
    const rows = [];
    for (const trEl of wChildren(tblEl, "tr")) {
      rows.push(wChildren(trEl, "tc").map(getCellParagraphTexts));
    }
    tables.push(rows);
  }
  const schedule = tables.find((t) => t.length >= 2 && t[0] && t[0].length >= 3);
  if (!schedule) {
    return { ok: false, error: "Không tìm thấy bảng lịch công tác (5 cột: Thời gian + 4 lãnh đạo) trong file Word." };
  }

  const headerRow = schedule[0];
  const leaderNamesInDoc = headerRow.slice(1).map((paras) => (paras[0] || "").trim());

  const days = [];
  for (let ri = 1; ri < schedule.length; ri++) {
    const row = schedule[ri];
    const col0 = row[0]?.join(" ") || "";
    const weekday = matchWeekday(col0);
    const dm = parseDateDM(col0);
    const sessionsByLeader = [];
    for (let ci = 1; ci < row.length && ci <= 4; ci++) {
      sessionsByLeader.push(splitCellIntoSessions(row[ci] || []));
    }
    days.push({ weekday, dm, sessionsByLeader });
  }

  if (!weekNumber || !startDateStr) {
    warnings.push("Không xác định được số tuần / ngày bắt đầu từ tiêu đề file — sẽ áp dụng vào tuần đang mở trên màn hình.");
  }
  if (days.length !== 7) {
    warnings.push(`Chỉ tìm thấy ${days.length} ngày trong bảng (thường là 7 ngày Thứ Hai → Chủ nhật) — vui lòng kiểm tra lại.`);
  }

  return {
    ok: true,
    source: "docx",
    weekNumber,
    startDateStr,
    endDateStr,
    leaderNamesInDoc,
    days,
    warnings,
  };
}
// ---------------------------------------------------------------------------
// PDF — dựng lại các dòng kẻ bảng (từ nội dung vẽ trong PDF) để xác định
// chính xác ranh giới từng hàng/cột, sau đó gộp văn bản theo đúng cột.
// Độ chính xác phụ thuộc vào cách phần mềm tạo PDF (ví dụ Word in ra PDF)
// vẽ bảng — nếu không tìm được đường kẻ, sẽ báo và trả về phần đã đọc được
// để biên tập viên tự kiểm tra kỹ hơn.
// ---------------------------------------------------------------------------

function mat3mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
function mat3apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Mã các lệnh vẽ path nội bộ của pdf.js (ổn định qua nhiều bản, nhưng vẫn là
// chi tiết triển khai — có bọc try/catch để không làm hỏng toàn bộ import
// nếu một phiên bản pdf.js khác đi thay đổi cách mã hoá này).
const DrawOPS = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

async function getFullWidthHorizontalLines(pdfjsLib, page) {
  const OPS = pdfjsLib.OPS;
  const opList = await page.getOperatorList();
  const fnNameOf = (code) => {
    for (const k in OPS) if (OPS[k] === code) return k;
    return null;
  };
  let CTM = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const hLines = [];
  try {
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(CTM);
      else if (fn === OPS.restore) CTM = stack.pop() || CTM;
      else if (fn === OPS.transform) CTM = mat3mul(args, CTM);
      else if (fn === OPS.constructPath) {
        const paintFn = args[0];
        if (paintFn !== OPS.stroke && paintFn !== OPS.closeStroke) continue;
        const buf = args[1] && args[1][0];
        if (!buf || !buf.length) continue;
        const pts = [];
        let bi = 0;
        while (bi < buf.length) {
          const code = buf[bi++];
          if (code === DrawOPS.moveTo || code === DrawOPS.lineTo) pts.push([buf[bi++], buf[bi++]]);
          else if (code === DrawOPS.curveTo) bi += 6;
        }
        if (pts.length < 2) continue;
        const devPts = pts.map(([x, y]) => mat3apply(CTM, x, y));
        for (let k = 0; k < devPts.length - 1; k++) {
          const [x0, y0] = devPts[k], [x1, y1] = devPts[k + 1];
          const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
          if (dy < 0.6 && dx > 1) hLines.push({ y: (y0 + y1) / 2, x0: Math.min(x0, x1), x1: Math.max(x0, x1) });
        }
      }
    }
  } catch (_) {
    return null; // không decode được — báo cho caller biết để dùng phương án dự phòng
  }
  const pageWidth = page.view[2] - page.view[0];
  const full = hLines.filter((l) => l.x1 - l.x0 > pageWidth * 0.8);
  const ySet = [];
  for (const l of full) if (!ySet.some((y) => Math.abs(y - l.y) < 1)) ySet.push(l.y);
  ySet.sort((a, b) => b - a);
  return ySet;
}

function colIndexForX(x, bounds) {
  for (let i = 0; i < bounds.length - 1; i++) if (x >= bounds[i] && x < bounds[i + 1]) return i;
  return bounds.length - 2;
}
async function getColumnLines(page, bounds) {
  const content = await page.getTextContent();
  const items = content.items.filter((it) => it.str.trim() !== "");
  const perCol = bounds.slice(0, -1).map(() => []);
  for (const it of items) perCol[colIndexForX(it.transform[4], bounds)].push(it);
  return perCol.map((colItems) => {
    const sorted = [...colItems].sort((a, b) => b.transform[5] - a.transform[5]);
    const lns = [];
    for (const it of sorted) {
      const y = it.transform[5];
      let line = lns.find((l) => Math.abs(l.y - y) <= 2.5);
      if (!line) { line = { y, items: [] }; lns.push(line); }
      line.items.push(it);
    }
    for (const l of lns) l.items.sort((a, b) => a.transform[4] - b.transform[4]);
    lns.sort((a, b) => b.y - a.y);
    return lns.map((l) => {
      let text = "";
      let prevEndX = null;
      for (const it of l.items) {
        const x = it.transform[4];
        if (prevEndX !== null && x - prevEndX > 1.2 && !text.endsWith(" ") && it.str && !it.str.startsWith(" ")) {
          text += " ";
        }
        text += it.str;
        prevEndX = x + (it.width || 0);
      }
      return { y: l.y, text: text.replace(/\s+/g, " ").trim() };
    });
  });
}

// Ranh giới 5 cột (Thời gian + 4 lãnh đạo) tính theo tỉ lệ % độ rộng trang —
// dựa trên tỉ lệ thực tế của mẫu THÔNG BÁO hiện tại (trang A4 ngang).
function estimateColumnBounds(pageWidth) {
  const ratios = [0, 0.1162, 0.3453, 0.5556, 0.7811, 1.0001];
  return ratios.map((r) => r * pageWidth);
}
async function parsePdfFile(file) {
  const warnings = [];
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

  // Tiêu đề tuần: tìm trên văn bản của trang đầu
  let weekNumber = null, startDateStr = null, endDateStr = null;
  {
    const page1 = await pdfDoc.getPage(1);
    const content = await page1.getTextContent();
    const fullText = content.items.map((it) => it.str).join(" ");
    const m = fullText.match(/Tu[ầa]n\s*(\d+)[^đ]*?(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})[^đ]*?đến[^đ]*?ngày\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i);
    if (m) {
      weekNumber = Number(m[1]);
      startDateStr = m[2].replace(/\s+/g, "");
      endDateStr = m[3].replace(/\s+/g, "");
    }
  }

  const rows = [];
  let currentRow = null;
  let usedLineDetection = true;

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const pageWidth = page.view[2] - page.view[0];
    const bounds = estimateColumnBounds(pageWidth);
    const ySet = await getFullWidthHorizontalLines(pdfjsLib, page);
    const colLinesAll = await getColumnLines(page, bounds);

    if (!ySet || ySet.length < 2) {
      usedLineDetection = false;
      continue;
    }

    let headerSkipped = false;
    for (let bi = 0; bi < ySet.length - 1; bi++) {
      const yTop = ySet[bi], yBot = ySet[bi + 1];
      const inBand = (y) => y <= yTop + 0.5 && y >= yBot - 0.5;
      const col0Text = colLinesAll[0].filter((l) => inBand(l.y)).map((l) => l.text).join(" ");

      if (!headerSkipped) {
        if (/th[ờơ]i\s*gian/i.test(col0Text)) headerSkipped = true;
        continue;
      }
      const weekday = matchWeekday(col0Text);
      const dm = parseDateDM(col0Text);

      if (weekday) {
        currentRow = { weekday, dm, colRaw: [[], [], [], []] };
        rows.push(currentRow);
      }
      if (!currentRow) continue;
      for (let c = 1; c <= 4; c++) {
        const colText = colLinesAll[c].filter((l) => inBand(l.y)).map((l) => l.text);
        currentRow.colRaw[c - 1].push(...colText);
      }
    }
  }

  if (!usedLineDetection || rows.length === 0) {
    return {
      ok: false,
      error: "Không xác định được các đường kẻ của bảng trong file PDF này, nên không thể tự tách theo từng ngày một cách chắc chắn. Vui lòng dùng file Word (.docx) nếu có — độ chính xác cao hơn nhiều.",
    };
  }

  const days = rows.map((r) => ({
    weekday: r.weekday,
    dm: r.dm,
    sessionsByLeader: r.colRaw.map((paras) => splitCellIntoSessions(paras)),
  }));

  if (!weekNumber || !startDateStr) {
    warnings.push("Không xác định được số tuần / ngày bắt đầu từ tiêu đề file — sẽ áp dụng vào tuần đang mở trên màn hình.");
  }
  if (days.length !== 7) {
    warnings.push(`Chỉ tách được ${days.length} ngày từ file PDF (thường là 7 ngày) — vui lòng kiểm tra kỹ lại toàn bộ nội dung trước khi lưu.`);
  }
  warnings.push("Dữ liệu đọc từ PDF có thể sai sót nhiều hơn so với file Word — vui lòng kiểm tra kỹ từng ô trước khi bấm Lưu.");

  return {
    ok: true,
    source: "pdf",
    weekNumber,
    startDateStr,
    endDateStr,
    leaderNamesInDoc: [],
    days,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// API chung
// ---------------------------------------------------------------------------

export async function parseScheduleFile(file) {
  const name = (file.name || "").toLowerCase();
  try {
    if (name.endsWith(".docx")) return await parseDocxFile(file);
    if (name.endsWith(".pdf")) return await parsePdfFile(file);
    return { ok: false, error: "Chỉ hỗ trợ file .docx hoặc .pdf." };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Lỗi khi đọc file: " + (e?.message || e) };
  }
}
