// ============================================================================
// admin.js — Logic cho trang nhập liệu (admin.html)
// ============================================================================

import {
  initializeApp,
  deleteApp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  db,
  auth,
  SESSIONS,
  getWeekId,
  getMonday,
  formatDMY,
  weekIdToMonday,
  buildEmptyWeek,
  getPageViewStats,
} from "./shared.js";
import { DEFAULT_LEADERS, firebaseConfig } from "./firebase-config.js";
import { parseScheduleFile } from "./import-schedule.js";

const els = {
  loginView: document.getElementById("loginView"),
  editorView: document.getElementById("editorView"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginBtn: document.getElementById("loginBtn"),
  loginStatus: document.getElementById("loginStatus"),
  whoEmail: document.getElementById("whoEmail"),
  logoutBtn: document.getElementById("logoutBtn"),
  saveStatus: document.getElementById("saveStatus"),
  weekRangeText: document.getElementById("weekRangeText"),
  prevBtn: document.getElementById("prevWeekBtn"),
  nextBtn: document.getElementById("nextWeekBtn"),
  thisBtn: document.getElementById("thisWeekBtn"),
  copyPrevBtn: document.getElementById("copyPrevBtn"),
  seedSampleBtn: document.getElementById("seedSampleBtn"),
  toggleImportBtn: document.getElementById("toggleImportBtn"),
  importPanel: document.getElementById("importPanel"),
  importFileInput: document.getElementById("importFileInput"),
  importFileBtn: document.getElementById("importFileBtn"),
  importStatus: document.getElementById("importStatus"),
  toggleLeadersBtn: document.getElementById("toggleLeadersBtn"),
  leadersPanel: document.getElementById("leadersPanel"),
  leadersForm: document.getElementById("leadersForm"),
  saveLeadersBtn: document.getElementById("saveLeadersBtn"),
  daysEditor: document.getElementById("daysEditor"),
  saveWeekBtn: document.getElementById("saveWeekBtn"),
  toggleAccountsBtn: document.getElementById("toggleAccountsBtn"),
  accountsPanel: document.getElementById("accountsPanel"),
  accountsStatus: document.getElementById("accountsStatus"),
  accountsList: document.getElementById("accountsList"),
  newAccName: document.getElementById("newAccName"),
  newAccPosition: document.getElementById("newAccPosition"),
  newAccEmail: document.getElementById("newAccEmail"),
  newAccPassword: document.getElementById("newAccPassword"),
  addAccountBtn: document.getElementById("addAccountBtn"),
  toggleStatsBtn: document.getElementById("toggleStatsBtn"),
  statsPanel: document.getElementById("statsPanel"),
  statsContent: document.getElementById("statsContent"),
};

let leaders = DEFAULT_LEADERS;
let currentWeekId = getWeekId(new Date());
let currentWeekData = null;
let currentAccount = null; // { uid, email, displayName, position, role, disabled }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function banner(el, msg, type) {
  if (!msg) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="status-banner ${type}">${escapeHtml(msg)}</div>`;
}
// ---------------- Đăng nhập / đăng xuất ----------------

els.loginBtn.addEventListener("click", async () => {
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) {
    banner(els.loginStatus, "Vui lòng nhập email và mật khẩu.", "error");
    return;
  }
  els.loginBtn.disabled = true;
  banner(els.loginStatus, "Đang đăng nhập…", "info");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    banner(els.loginStatus, "Đăng nhập thất bại: email hoặc mật khẩu không đúng.", "error");
  } finally {
    els.loginBtn.disabled = false;
  }
});

els.logoutBtn.addEventListener("click", () => signOut(auth));

async function loadCurrentAccount(user) {
  try {
    const snap = await getDoc(doc(db, "accounts", user.uid));
    if (!snap.exists() || snap.data().disabled === true) {
      banner(
        els.loginStatus,
        "Tài khoản của bạn chưa được cấp quyền hoặc đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.",
        "error"
      );
      currentAccount = null;
      return false;
    }
    currentAccount = { uid: user.uid, email: user.email, ...snap.data() };
    return true;
  } catch (e) {
    console.error(e);
    banner(els.loginStatus, "Lỗi khi kiểm tra quyền tài khoản: " + e.message, "error");
    currentAccount = null;
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const ok = await loadCurrentAccount(user);
    if (!ok) {
      await signOut(auth);
      return;
    }
    els.loginView.style.display = "none";
    els.editorView.style.display = "";
    els.whoEmail.textContent = currentAccount.displayName
      ? `${currentAccount.displayName} (${user.email})`
      : user.email;
    await loadLeaders();
    renderLeadersForm();
    await loadWeek(currentWeekId);
    await loadAccountsList();
  } else {
    els.loginView.style.display = "";
    els.editorView.style.display = "none";
    currentAccount = null;
  }
});

// ---------------- Danh sách lãnh đạo ----------------

async function loadLeaders() {
  try {
    const snap = await getDoc(doc(db, "settings", "leaders"));
    if (snap.exists() && Array.isArray(snap.data().leaders) && snap.data().leaders.length) {
      leaders = snap.data().leaders;
    }
  } catch (e) {
    console.warn(e);
  }
}

function renderLeadersForm() {
  els.leadersForm.innerHTML = leaders.map((l, i) => `
    <div class="leader-form-row">
      <input type="text" data-idx="${i}" data-field="name" value="${escapeHtml(l.name)}" placeholder="Tên (VD: Đ/c Nguyễn Văn A)" />
      <input type="text" data-idx="${i}" data-field="title" value="${escapeHtml(l.title)}" placeholder="Chức danh" />
    </div>
  `).join("");
}

els.toggleLeadersBtn.addEventListener("click", () => {
  const show = els.leadersPanel.style.display === "none";
  els.leadersPanel.style.display = show ? "" : "none";
  els.toggleLeadersBtn.textContent = show ? "Sửa danh sách 4 chức danh ▴" : "Sửa danh sách 4 chức danh ▾";
});

els.saveLeadersBtn.addEventListener("click", async () => {
  const inputs = els.leadersForm.querySelectorAll("input");
  const updated = leaders.map((l) => ({ ...l }));
  inputs.forEach((inp) => {
    const idx = Number(inp.dataset.idx);
    updated[idx][inp.dataset.field] = inp.value.trim();
  });
  leaders = updated;
  try {
    await setDoc(doc(db, "settings", "leaders"), { leaders });
    banner(els.saveStatus, "Đã lưu danh sách chức danh.", "success");
    renderDaysEditor();
  } catch (e) {
    console.error(e);
    banner(els.saveStatus, "Lỗi khi lưu danh sách chức danh: " + e.message, "error");
  }
});
// ---------------- Quản lý tài khoản đăng nhập ----------------

els.toggleAccountsBtn.addEventListener("click", () => {
  const show = els.accountsPanel.style.display === "none";
  els.accountsPanel.style.display = show ? "" : "none";
  els.toggleAccountsBtn.textContent = show ? "Quản lý tài khoản đăng nhập ▴" : "Quản lý tài khoản đăng nhập ▾";
  if (show) loadAccountsList();
});

function roleLabel(role) {
  return role === "superadmin" ? "Quản trị cấp cao" : "Biên tập viên";
}

async function loadAccountsList() {
  if (!currentAccount) return;
  try {
    const snap = await getDocs(collection(db, "accounts"));
    const accounts = [];
    snap.forEach((d) => accounts.push({ uid: d.id, ...d.data() }));
    accounts.sort((a, b) => {
      if (a.role !== b.role) return a.role === "superadmin" ? -1 : 1;
      return (a.displayName || "").localeCompare(b.displayName || "", "vi");
    });
    renderAccountsList(accounts);
  } catch (e) {
    console.error(e);
    banner(els.accountsStatus, "Không tải được danh sách tài khoản: " + e.message, "error");
  }
}

function renderAccountsList(accounts) {
  const isSuper = currentAccount?.role === "superadmin";
  els.accountsList.innerHTML = accounts.map((a) => `
    <div class="account-row ${a.disabled ? "disabled" : ""}">
      <div class="account-info">
        <div class="account-name">${escapeHtml(a.displayName || "(Chưa cập nhật)")} <span class="role-badge ${a.role}">${roleLabel(a.role)}</span>${a.disabled ? ' <span class="role-badge disabled-badge">Đã vô hiệu hóa</span>' : ""}</div>
        <div class="account-meta">${escapeHtml(a.position || "(Chưa cập nhật chức vụ)")} — ${escapeHtml(a.email || "")}</div>
      </div>
      ${isSuper && a.role !== "superadmin" ? `
        <button class="btn ${a.disabled ? "" : "ghost"}" data-uid="${a.uid}" data-action="${a.disabled ? "enable" : "disable"}">
          ${a.disabled ? "Kích hoạt lại" : "Vô hiệu hóa"}
        </button>` : ""}
    </div>
  `).join("") || '<p class="hint">Chưa có tài khoản nào.</p>';

  els.accountsList.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => onToggleAccountDisabled(btn.dataset.uid, btn.dataset.action === "disable"));
  });
}

async function onToggleAccountDisabled(uid, disable) {
  const msg = disable
    ? "Vô hiệu hóa tài khoản này? Người này sẽ không thể đăng nhập/cập nhật lịch công tác nữa."
    : "Kích hoạt lại tài khoản này?";
  if (!confirm(msg)) return;
  try {
    await updateDoc(doc(db, "accounts", uid), { disabled: disable });
    banner(els.accountsStatus, disable ? "Đã vô hiệu hóa tài khoản." : "Đã kích hoạt lại tài khoản.", "success");
    await loadAccountsList();
  } catch (e) {
    console.error(e);
    banner(els.accountsStatus, "Lỗi: " + e.message, "error");
  }
}

els.addAccountBtn.addEventListener("click", async () => {
  const displayName = els.newAccName.value.trim();
  const position = els.newAccPosition.value.trim();
  const email = els.newAccEmail.value.trim();
  const password = els.newAccPassword.value;

  if (!displayName || !position || !email || !password) {
    banner(els.accountsStatus, "Vui lòng nhập đầy đủ Họ và tên, Chức vụ, Email, Mật khẩu.", "error");
    return;
  }
  if (password.length < 6) {
    banner(els.accountsStatus, "Mật khẩu phải có ít nhất 6 ký tự.", "error");
    return;
  }

  els.addAccountBtn.disabled = true;
  banner(els.accountsStatus, "Đang tạo tài khoản…", "info");

  const secondaryApp = initializeApp(firebaseConfig, "Secondary-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    await setDoc(doc(db, "accounts", uid), {
      email,
      displayName,
      position,
      role: "editor",
      disabled: false,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.email || "unknown",
    });
    banner(els.accountsStatus, `Đã tạo tài khoản cho ${displayName} (${email}).`, "success");
    els.newAccName.value = "";
    els.newAccPosition.value = "";
    els.newAccEmail.value = "";
    els.newAccPassword.value = "";
    await loadAccountsList();
  } catch (e) {
    console.error(e);
    let msg = "Lỗi khi tạo tài khoản: " + e.message;
    if (e.code === "auth/email-already-in-use") msg = "Email này đã có tài khoản.";
    if (e.code === "auth/invalid-email") msg = "Email không hợp lệ.";
    if (e.code === "auth/weak-password") msg = "Mật khẩu quá yếu (tối thiểu 6 ký tự).";
    banner(els.accountsStatus, msg, "error");
  } finally {
    try { await deleteApp(secondaryApp); } catch (_) {}
    els.addAccountBtn.disabled = false;
  }
});

// ---------------- Thống kê lượt xem ----------------

els.toggleStatsBtn.addEventListener("click", async () => {
  const show = els.statsPanel.style.display === "none";
  els.statsPanel.style.display = show ? "" : "none";
  els.toggleStatsBtn.textContent = show ? "Thống kê lượt xem ▴" : "Thống kê lượt xem ▾";
  if (show) await loadStats();
});

async function loadStats() {
  els.statsContent.textContent = "Đang tải…";
  const stats = await getPageViewStats();
  if (!stats) {
    els.statsContent.textContent = "Không tải được số liệu.";
    return;
  }
  els.statsContent.innerHTML = `
    <div class="stats-row"><strong>${stats.totalViews.toLocaleString("vi-VN")}</strong> lượt xem trang (tổng số lần trang được mở)</div>
    <div class="stats-row"><strong>${stats.uniqueVisitors.toLocaleString("vi-VN")}</strong> người xem khác nhau (ước tính theo trình duyệt)</div>
  `;
}
// ---------------- Tải / điều hướng tuần ----------------

async function loadWeek(weekId) {
  currentWeekId = weekId;
  const monday = weekIdToMonday(weekId);
  els.weekRangeText.textContent = `Tuần ${weekId.split("-W")[1]} — từ ${formatDMY(monday)}`;
  banner(els.saveStatus, "Đang tải dữ liệu tuần…", "info");
  try {
    const snap = await getDoc(doc(db, "weeks", weekId));
    if (snap.exists()) {
      currentWeekData = snap.data();
    } else {
      currentWeekData = buildEmptyWeek(monday);
    }
    els.weekRangeText.textContent =
      `Tuần ${currentWeekData.weekNumber} — từ ${formatDMY(currentWeekData.startDate)} đến ${formatDMY(currentWeekData.endDate)}`;
    banner(els.saveStatus, "");
    renderDaysEditor();
  } catch (e) {
    console.error(e);
    banner(els.saveStatus, "Không tải được dữ liệu tuần: " + e.message, "error");
  }
}

els.prevBtn.addEventListener("click", () => {
  const monday = weekIdToMonday(currentWeekId);
  monday.setDate(monday.getDate() - 7);
  loadWeek(getWeekId(monday));
});

els.nextBtn.addEventListener("click", () => {
  const monday = weekIdToMonday(currentWeekId);
  monday.setDate(monday.getDate() + 7);
  loadWeek(getWeekId(monday));
});

els.thisBtn.addEventListener("click", () => loadWeek(getWeekId(new Date())));

els.copyPrevBtn.addEventListener("click", async () => {
  if (!confirm("Sao chép toàn bộ nội dung của tuần trước vào tuần hiện tại? Nội dung hiện tại (chưa lưu) sẽ bị thay thế.")) return;
  const monday = weekIdToMonday(currentWeekId);
  const prevMonday = new Date(monday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevWeekId = getWeekId(prevMonday);
  try {
    const snap = await getDoc(doc(db, "weeks", prevWeekId));
    if (!snap.exists()) {
      banner(els.saveStatus, "Tuần trước chưa có dữ liệu để sao chép.", "error");
      return;
    }
    const prevData = snap.data();
    const newWeek = buildEmptyWeek(monday);
    newWeek.days.forEach((day, i) => {
      const prevDay = prevData.days?.[i];
      if (prevDay) day.sessions = JSON.parse(JSON.stringify(prevDay.sessions));
    });
    currentWeekData = newWeek;
    renderDaysEditor();
    banner(els.saveStatus, "Đã sao chép nội dung từ tuần trước. Nhớ bấm Lưu để áp dụng.", "success");
  } catch (e) {
    console.error(e);
    banner(els.saveStatus, "Lỗi khi sao chép: " + e.message, "error");
  }
});
// ---------------- Dữ liệu mẫu (demo nhanh, dựa trên tuần 47/2026) ----------------

const SAMPLE_WEEK_SESSIONS = [
  { // Thứ Hai 16/11
    l1: { morning: "(07h30) Dự khai mạc Triển lãm mỹ thuật “Hồ Chí Minh - Chân dung một con người” hưởng ứng “Ngày Văn hóa Việt Nam” năm 2026; (08h00) Chủ trì Kỳ họp thứ 8 (chuyên đề) HĐND tỉnh khóa XVIII, nhiệm kỳ 2026 - 2031", afternoon: "Dự Ngày hội Đại đoàn kết toàn dân tộc tại khu dân cư Phố Thầu, phường Thục Phán" },
    l2: { morning: "(07h30) Dự khai mạc Triển lãm mỹ thuật “Hồ Chí Minh - Chân dung một con người” hưởng ứng “Ngày Văn hóa Việt Nam” năm 2026; (08h00) Dự Kỳ họp thứ 8 (chuyên đề) HĐND tỉnh khóa XVIII, nhiệm kỳ 2026 - 2031", afternoon: "Làm việc tại cơ quan" },
    l3: { morning: "Dự Hội nghị quán triệt, triển khai Quyết định số 170/QĐ-TTg ngày 24/9/2026 của Thủ tướng Chính phủ tại Hà Nội", afternoon: "Đi công tác ngoài tỉnh" },
    l4: { morning: "Dự Ngày hội Đại đoàn kết toàn dân tộc tại xã Bảo Lâm", afternoon: "Dự Lễ khánh thành Trường THPT Bản Ngà" },
  },
  { // Thứ Ba 17/11
    l1: { morning: "Dự Lễ công bố Quyết định thành lập và ra mắt Trung đoàn CSCĐ dự bị chiến đấu thuộc Công an tỉnh", afternoon: "Làm việc tại cơ quan" },
    l2: { morning: "Đi công tác ngoài tỉnh (cả ngày)", afternoon: "Đi công tác ngoài tỉnh (cả ngày)" },
    l3: { morning: "Dự Chương trình kỷ niệm 44 năm ngày Nhà giáo Việt Nam (20/11/1982 - 20/11/2026) và ra mắt chính thức nền tảng Tammi OA ngành Giáo dục và Đào tạo tỉnh Cao Bằng", afternoon: "- Dự Hội nghị đánh giá, xếp loại chất lượng tập thể, lãnh đạo Công an tỉnh;\n- Làm việc với TikTok Việt Nam" },
    l4: { morning: "Làm việc tại cơ quan", afternoon: "Họp xử lý các dự án chậm tiến độ, có khó khăn, vướng mắc; cơ sở nhà đất cần đánh giá lại hiệu quả kinh tế" },
  },
  { // Thứ Tư 18/11
    l1: { morning: "Tham gia Đoàn công tác của Phó Thủ tướng Chính dự Ngày hội Đại đoàn kết toàn dân tộc gắn với Ngày Văn hóa Việt Nam tại xã Quang Trung", afternoon: "Chủ trì họp Thường trực Tỉnh ủy, Hội nghị BTV Tỉnh ủy" },
    l2: { morning: "Đi công tác ngoài tỉnh", afternoon: "Họp Thường trực Tỉnh ủy; Hội nghị Ban Thường vụ Tỉnh ủy" },
    l3: { morning: "Tham gia Đoàn công tác của Phó Thủ tướng Chính dự Ngày hội Đại đoàn kết toàn dân tộc gắn với Ngày Văn hóa Việt Nam tại xã Quang Trung", afternoon: "Họp Thường trực Tỉnh ủy; Hội nghị Ban Thường vụ Tỉnh ủy" },
    l4: { morning: "Làm việc tại cơ quan", afternoon: "Họp Thường trực Tỉnh ủy; Hội nghị Ban Thường vụ Tỉnh ủy" },
  },
  { // Thứ Năm 19/11
    l1: { morning: "Làm việc tại cơ quan", afternoon: "Làm việc tại cơ quan" },
    l2: { morning: "Làm việc tại cơ quan", afternoon: "Đi công tác ngoài tỉnh" },
    l3: { morning: "", afternoon: "Dự Phiên họp UBND cho ý kiến các nội dung trình Kỳ họp HĐND tỉnh thường lệ cuối năm" },
    l4: { morning: "Làm việc tại cơ quan", afternoon: "Làm việc tại cơ quan" },
  },
  { // Thứ Sáu 20/11
    l1: { morning: "Thăm, chúc mừng Ngày Nhà giáo Việt Nam tại Trường phổ thông nội trú Tiểu học và Trung học cơ sở Đức Long", afternoon: "Làm việc tại cơ quan" },
    l2: { morning: "Dự Kỳ họp thứ 2, Quốc hội khóa XVI", afternoon: "Dự Kỳ họp thứ 2, Quốc hội khóa XVI" },
    l3: { morning: "Làm việc với Thanh tra Chính phủ tại địa phương", afternoon: "Làm việc tại cơ quan" },
    l4: { morning: "Thăm, chúc mừng Ngày Nhà giáo Việt Nam tại Trường THPT Trà Lĩnh", afternoon: "Làm việc tại cơ quan" },
  },
  { // Thứ Bảy 21/11
    l1: { morning: "Nghỉ", afternoon: "Nghỉ" },
    l2: { morning: "Dự Kỳ họp thứ 2, Quốc hội khóa XVI", afternoon: "Dự Kỳ họp thứ 2, Quốc hội khóa XVI" },
    l3: { morning: "Nghỉ", afternoon: "Nghỉ" },
    l4: { morning: "Nghỉ", afternoon: "Nghỉ" },
  },
  { // Chủ Nhật 22/11
    l1: { morning: "Nghỉ", afternoon: "Nghỉ" },
    l2: { morning: "Nghỉ", afternoon: "Nghỉ" },
    l3: { morning: "Nghỉ", afternoon: "Nghỉ" },
    l4: { morning: "Nghỉ", afternoon: "Nghỉ" },
  },
];

els.seedSampleBtn.addEventListener("click", () => {
  if (!confirm("Nạp dữ liệu mẫu của Tuần 47 (16/11 - 22/11/2026) vào tuần đang chọn? Nội dung hiện tại (chưa lưu) sẽ bị thay thế. Sau khi xem thử, nhớ bấm Lưu để áp dụng, hoặc điều hướng sang tuần khác để nhập dữ liệu thật.")) return;
  const monday = weekIdToMonday(currentWeekId);
  const newWeek = buildEmptyWeek(monday);
  newWeek.days.forEach((day, i) => {
    const sample = SAMPLE_WEEK_SESSIONS[i];
    if (!sample) return;
    day.sessions.morning = {};
    day.sessions.afternoon = {};
    for (const leaderId of Object.keys(sample)) {
      day.sessions.morning[leaderId] = sample[leaderId].morning;
      day.sessions.afternoon[leaderId] = sample[leaderId].afternoon;
    }
  });
  currentWeekData = newWeek;
  renderDaysEditor();
  banner(els.saveStatus, "Đã nạp dữ liệu mẫu. Xem thử rồi bấm “Lưu lịch công tác tuần này” để áp dụng.", "success");
});
// ---------------- Nhập dữ liệu từ file Word/PDF ----------------

els.toggleImportBtn.addEventListener("click", () => {
  const show = els.importPanel.style.display === "none";
  els.importPanel.style.display = show ? "" : "none";
  els.toggleImportBtn.textContent = show ? "Nhập dữ liệu từ file Word/PDF ▴" : "Nhập dữ liệu từ file Word/PDF ▾";
});

els.importFileBtn.addEventListener("click", async () => {
  const file = els.importFileInput.files && els.importFileInput.files[0];
  if (!file) {
    banner(els.importStatus, "Vui lòng chọn file Word (.docx) hoặc PDF trước.", "error");
    return;
  }
  els.importFileBtn.disabled = true;
  banner(els.importStatus, "Đang đọc và phân tích file… (có thể mất vài giây)", "info");
  try {
    const result = await parseScheduleFile(file);
    if (!result.ok) {
      banner(els.importStatus, result.error || "Không đọc được nội dung file.", "error");
      return;
    }

    let targetMonday = weekIdToMonday(currentWeekId);

    if (result.startDateStr) {
      const m = result.startDateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) {
        const monday = getMonday(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
        const weekId = getWeekId(monday);
        if (weekId !== currentWeekId) {
          const ok = confirm(
            `File này là lịch của Tuần ${result.weekNumber || "?"} (từ ngày ${result.startDateStr}), khác với tuần đang mở trên màn hình.\n\n` +
            `Bấm OK để chuyển sang đúng tuần đó rồi điền dữ liệu (nội dung tuần đó sẽ được tải lại từ Firestore, nội dung chưa lưu trên màn hình hiện tại sẽ mất).\n` +
            `Bấm Cancel để huỷ và tự điều hướng tuần bằng tay.`
          );
          if (!ok) {
            banner(els.importStatus, "Đã huỷ — chưa điền dữ liệu nào.", "info");
            return;
          }
          await loadWeek(weekId);
          targetMonday = monday;
        }
      }
    }

    if (!confirm('Điền dữ liệu đọc được từ file vào các ô bên dưới? Nội dung đang soạn trên màn hình (chưa lưu) sẽ bị thay thế. Sau khi xem lại, nhớ bấm "Lưu lịch công tác tuần này" để áp dụng.')) {
      banner(els.importStatus, "Đã huỷ — chưa điền dữ liệu nào.", "info");
      return;
    }

    const newWeek = buildEmptyWeek(targetMonday);
    const warnings = [...(result.warnings || [])];
    const unmatchedDays = [];

    (result.days || []).forEach((parsedDay, idx) => {
      let dayIdx = idx < newWeek.days.length ? idx : -1;
      if (parsedDay.dm) {
        const found = newWeek.days.findIndex((d) => {
          const [, mm, dd] = d.date.split("-").map(Number);
          return dd === parsedDay.dm.day && mm === parsedDay.dm.month;
        });
        if (found >= 0) dayIdx = found;
      }
      const day = dayIdx >= 0 ? newWeek.days[dayIdx] : null;
      if (!day) {
        unmatchedDays.push(parsedDay.weekday || `dòng ${idx + 1}`);
        return;
      }
      day.sessions.morning = day.sessions.morning || {};
      day.sessions.afternoon = day.sessions.afternoon || {};
      leaders.forEach((l, li) => {
        const s = parsedDay.sessionsByLeader && parsedDay.sessionsByLeader[li];
        if (!s) return;
        if (s.morning) day.sessions.morning[l.id] = s.morning;
        if (s.afternoon) day.sessions.afternoon[l.id] = s.afternoon;
      });
    });

    if (unmatchedDays.length) {
      warnings.push(`Không xác định được vị trí của: ${unmatchedDays.join(", ")} — các ngày này chưa được điền, vui lòng nhập tay.`);
    }

    if (result.leaderNamesInDoc && result.leaderNamesInDoc.length === 4) {
      const norm = (s) => String(s || "").normalize("NFC").replace(/^đ\/c\s*/i, "").replace(/\s+/g, " ").trim().toLowerCase();
      result.leaderNamesInDoc.forEach((nameInDoc, i) => {
        const configured = leaders[i]?.name || "";
        if (nameInDoc && configured && norm(configured) !== norm(nameInDoc)) {
          warnings.push(`Cột ${i + 1} trong file ghi tên "${nameInDoc}", khác với "${configured}" đang cấu hình ở vị trí này — vui lòng kiểm tra thứ tự 4 chức danh.`);
        }
      });
    }

    currentWeekData = newWeek;
    renderDaysEditor();

    const warnMsg = warnings.length ? " Lưu ý: " + warnings.join(" ") : "";
    banner(
      els.importStatus,
      `Đã điền dữ liệu từ file ${result.source === "docx" ? "Word" : "PDF"} vào các ô bên dưới. Vui lòng xem lại kỹ từng ô, rồi bấm "Lưu lịch công tác tuần này" để áp dụng.${warnMsg}`,
      warnings.length ? "info" : "success"
    );
  } catch (e) {
    console.error(e);
    banner(els.importStatus, "Lỗi khi đọc file: " + (e?.message || e), "error");
  } finally {
    els.importFileBtn.disabled = false;
  }
});
// ---------------- Soạn / lưu lịch tuần ----------------

function renderDaysEditor() {
  if (!currentWeekData) return;
  els.daysEditor.innerHTML = currentWeekData.days.map((day, dayIdx) => {
    const blocks = leaders.map((l) => {
      const fields = SESSIONS.map((s) => `
        <div class="session-field">
          <label>${s.label}</label>
          <textarea
            data-day="${dayIdx}" data-leader="${l.id}" data-session="${s.key}"
            placeholder="Nội dung ${s.label.toLowerCase()}…"
          >${escapeHtml(day.sessions?.[s.key]?.[l.id] || "")}</textarea>
        </div>
      `).join("");
      return `
        <div class="leader-edit-block">
          <div class="lname">${escapeHtml(l.name)}</div>
          <div class="session-pair">${fields}</div>
        </div>`;
    }).join("");

    return `
      <div class="day-editor-card">
        <div class="day-editor-head">
          <span>${day.weekday}</span>
          <span>${formatDMY(day.date)}</span>
        </div>
        ${blocks}
      </div>`;
  }).join("");
}

function collectWeekDataFromForm() {
  const data = JSON.parse(JSON.stringify(currentWeekData));
  els.daysEditor.querySelectorAll("textarea").forEach((ta) => {
    const dayIdx = Number(ta.dataset.day);
    const leaderId = ta.dataset.leader;
    const sessionKey = ta.dataset.session;
    if (!data.days[dayIdx].sessions[sessionKey]) data.days[dayIdx].sessions[sessionKey] = {};
    data.days[dayIdx].sessions[sessionKey][leaderId] = ta.value;
  });
  return data;
}

els.saveWeekBtn.addEventListener("click", async () => {
  const data = collectWeekDataFromForm();
  data.updatedAt = serverTimestamp();
  data.updatedBy = auth.currentUser?.email || "unknown";
  els.saveWeekBtn.disabled = true;
  banner(els.saveStatus, "Đang lưu…", "info");
  try {
    await setDoc(doc(db, "weeks", currentWeekId), data);
    currentWeekData = data;
    banner(els.saveStatus, `Đã lưu lịch công tác tuần ${data.weekNumber} thành công — đã hiển thị trực tiếp cho mọi người.`, "success");
  } catch (e) {
    console.error(e);
    banner(els.saveStatus, "Lỗi khi lưu dữ liệu: " + e.message, "error");
  } finally {
    els.saveWeekBtn.disabled = false;
  }
});
