// ============================================================================
// display.js — Logic cho trang hiển thị công khai (index.html)
// ============================================================================

import {
  doc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, SESSIONS, getWeekId, getMonday, formatDMY, weekIdToMonday, recordPageView } from "./shared.js";
import { DEFAULT_LEADERS } from "./firebase-config.js";

const els = {
  weekRangeText: document.getElementById("weekRangeText"),
  statusArea: document.getElementById("statusArea"),
  loadingArea: document.getElementById("loadingArea"),
  tableWrap: document.getElementById("tableWrap"),
  tableHeadRow: document.getElementById("tableHeadRow"),
  tableBody: document.getElementById("tableBody"),
  dayCards: document.getElementById("dayCards"),
  officialWrap: document.getElementById("officialWrap"),
  officialWeekText: document.getElementById("officialWeekText"),
  officialHeadRow: document.getElementById("officialHeadRow"),
  officialBody: document.getElementById("officialBody"),
  viewCardBtn: document.getElementById("viewCardBtn"),
  viewOfficialBtn: document.getElementById("viewOfficialBtn"),
  prevBtn: document.getElementById("prevWeekBtn"),
  nextBtn: document.getElementById("nextWeekBtn"),
  thisBtn: document.getElementById("thisWeekBtn"),
};

const VIEW_MODE_KEY = "lctOnlineViewMode";
let viewMode = localStorage.getItem(VIEW_MODE_KEY) === "official" ? "official" : "card";

let currentWeekId = getWeekId(new Date());
let unsubscribeWeek = null;
let leaders = DEFAULT_LEADERS;
let leadersLoaded = false;

function showStatus(msg, type = "info") {
  if (!msg) {
    els.statusArea.innerHTML = "";
    return;
  }
  els.statusArea.innerHTML = `<div class="status-banner ${type}">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadLeaders() {
  try {
    const snap = await getDoc(doc(db, "settings", "leaders"));
    if (snap.exists() && Array.isArray(snap.data().leaders) && snap.data().leaders.length) {
      leaders = snap.data().leaders;
    }
  } catch (e) {
    console.warn("Không tải được danh sách lãnh đạo, dùng mặc định.", e);
  }
  leadersLoaded = true;
}

function renderHeader() {
  els.tableHeadRow.innerHTML = `<th style="width:90px;">Thời gian</th>` +
    leaders.map((l) => `
      <th>
        <span class="leader-name">${escapeHtml(l.name)}</span>
        <span class="leader-title">${escapeHtml(l.title)}</span>
      </th>`).join("");
}

function sessionHtml(text) {
  const t = (text || "").trim();
  if (!t) return `<span class="session-text empty">Chưa có nội dung</span>`;
  return `<span class="session-text">${escapeHtml(t)}</span>`;
}

function renderWeek(weekData) {
  renderHeader();

  const days = weekData?.days || [];

  // ---- desktop table ----
  els.tableBody.innerHTML = days.map((day) => {
    const cells = leaders.map((l) => {
      const blocks = SESSIONS.map((s) => `
        <div class="session-block">
          <div class="session-label">${s.label}</div>
          ${sessionHtml(day.sessions?.[s.key]?.[l.id])}
        </div>`).join("");
      return `<td>${blocks}</td>`;
    }).join("");
    return `
      <tr>
        <td class="day-cell">${day.weekday}<span class="d">(${formatDMY(day.date)})</span></td>
        ${cells}
      </tr>`;
  }).join("");

  // ---- mobile cards ----
  els.dayCards.innerHTML = days.map((day) => {
    const rows = leaders.map((l) => {
      const blocks = SESSIONS.map((s) => `
        <div class="session-block">
          <div class="session-label">${s.label}</div>
          ${sessionHtml(day.sessions?.[s.key]?.[l.id])}
        </div>`).join("");
      return `
        <div class="leader-row">
          <div class="leader-name">${escapeHtml(l.name)}</div>
          <div class="leader-title">${escapeHtml(l.title)}</div>
          ${blocks}
        </div>`;
    }).join("");
    return `
      <div class="day-card">
        <div class="day-head"><span>${day.weekday}</span><span class="d">${formatDMY(day.date)}</span></div>
        ${rows}
      </div>`;
  }).join("");
}

// ---- chế độ "Dạng bảng Thông báo" (khung văn bản hành chính truyền thống) ----

function renderOfficialHeader() {
  els.officialHeadRow.innerHTML = `<th style="width:90px;">Thời gian</th>` +
    leaders.map((l) => `
      <th>
        <div class="official-leader-name">${escapeHtml(l.name)}</div>
        <div class="official-leader-title">${escapeHtml(l.title)}</div>
      </th>`).join("");
}

function officialCellHtml(day, leaderId) {
  const m = (day.sessions?.morning?.[leaderId] || "").trim();
  const a = (day.sessions?.afternoon?.[leaderId] || "").trim();
  if (m && a && m === a) {
    return `<div class="official-line">${escapeHtml(m)}</div>`;
  }
  return (
    `<div class="official-line"><b>Sáng:</b> ${m ? escapeHtml(m) : ""}</div>` +
    `<div class="official-line"><b>Chiều:</b> ${a ? escapeHtml(a) : ""}</div>`
  );
}

function renderOfficialTable(weekData) {
  renderOfficialHeader();
  const days = weekData?.days || [];
  els.officialBody.innerHTML = days.map((day) => {
    const cells = leaders.map((l) => `<td>${officialCellHtml(day, l.id)}</td>`).join("");
    return `
      <tr>
        <td class="official-day-cell">
          <div>${day.weekday}</div>
          <div class="official-d">(${formatDMY(day.date)})</div>
        </td>
        ${cells}
      </tr>`;
  }).join("");
}

function updateOfficialHeaderText(weekData, weekId) {
  if (weekData) {
    els.officialWeekText.textContent =
      `(Tuần ${weekData.weekNumber}, từ ngày ${formatDMY(weekData.startDate)} đến ngày ${formatDMY(weekData.endDate)})`;
  } else {
    els.officialWeekText.textContent = `(Tuần ${weekId.split("-W")[1]} — chưa có dữ liệu)`;
  }
}

function applyViewMode() {
  const isOfficial = viewMode === "official";
  els.officialWrap.style.display = isOfficial ? "" : "none";
  els.tableWrap.style.display = isOfficial ? "none" : "";
  els.dayCards.style.display = isOfficial ? "none" : "";
  els.viewCardBtn.classList.toggle("active", !isOfficial);
  els.viewOfficialBtn.classList.toggle("active", isOfficial);
}

els.viewCardBtn.addEventListener("click", () => {
  viewMode = "card";
  localStorage.setItem(VIEW_MODE_KEY, viewMode);
  applyViewMode();
});

els.viewOfficialBtn.addEventListener("click", () => {
  viewMode = "official";
  localStorage.setItem(VIEW_MODE_KEY, viewMode);
  applyViewMode();
});

function updateWeekRangeLabel(weekData, weekId) {
  if (weekData) {
    els.weekRangeText.textContent =
      `Tuần ${weekData.weekNumber}, từ ngày ${formatDMY(weekData.startDate)} đến ngày ${formatDMY(weekData.endDate)}`;
  } else {
    const monday = weekIdToMonday(weekId);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    els.weekRangeText.textContent = `Tuần ${weekId.split("-W")[1]} (chưa có dữ liệu)`;
  }
}

function subscribeToWeek(weekId) {
  if (unsubscribeWeek) unsubscribeWeek();
  els.loadingArea.style.display = "";
  els.tableWrap.style.display = "none";
  els.dayCards.style.display = "none";
  els.officialWrap.style.display = "none";
  showStatus("");

  const ref = doc(db, "weeks", weekId);
  unsubscribeWeek = onSnapshot(
    ref,
    (snap) => {
      els.loadingArea.style.display = "none";
      if (snap.exists()) {
        const data = snap.data();
        updateWeekRangeLabel(data, weekId);
        updateOfficialHeaderText(data, weekId);
        renderWeek(data);
        renderOfficialTable(data);
      } else {
        updateWeekRangeLabel(null, weekId);
        updateOfficialHeaderText(null, weekId);
        renderWeek({ days: [] });
        renderOfficialTable({ days: [] });
        showStatus("Chưa có lịch công tác cho tuần này.", "info");
      }
      applyViewMode();
    },
    (err) => {
      els.loadingArea.style.display = "none";
      console.error(err);
      showStatus("Không thể tải dữ liệu lịch công tác. Vui lòng kiểm tra kết nối mạng hoặc liên hệ quản trị viên.", "error");
    }
  );
}

function goToWeek(weekId) {
  currentWeekId = weekId;
  subscribeToWeek(currentWeekId);
}

els.prevBtn.addEventListener("click", () => {
  const monday = weekIdToMonday(currentWeekId);
  monday.setDate(monday.getDate() - 7);
  goToWeek(getWeekId(monday));
});

els.nextBtn.addEventListener("click", () => {
  const monday = weekIdToMonday(currentWeekId);
  monday.setDate(monday.getDate() + 7);
  goToWeek(getWeekId(monday));
});

els.thisBtn.addEventListener("click", () => {
  goToWeek(getWeekId(new Date()));
});

(async function init() {
  recordPageView();
  await loadLeaders();
  subscribeToWeek(currentWeekId);
})();
