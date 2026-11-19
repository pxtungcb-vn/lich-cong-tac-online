// ======================================// ============================================================================
// shared.js — Các hàm & hằng số dùng chung giữa trang hiển thị và trang nhập liệu
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
// Dùng long-polling thay vì kênh streaming (WebChannel) mặc định: một số
// mạng nội bộ cơ quan / proxy chặn kết nối streaming khiến Firestore báo
// "client is offline" dù mạng vẫn thông — long-polling tương thích rộng hơn.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
export const auth = getAuth(app);

export const WEEKDAY_LABELS = [
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
  "Chủ Nhật",
];

export const SESSIONS = [
  { key: "morning", label: "Sáng" },
  { key: "afternoon", label: "Chiều" },
];

// --- Tiện ích ngày/tuần (theo chuẩn ISO 8601, tuần bắt đầu từ Thứ Hai) ------

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDMY(d) {
  if (typeof d === "string") d = fromDateStr(d);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Trả về Thứ Hai của tuần chứa ngày `date`
export function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Chủ nhật, 1 = Thứ 2, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Số tuần ISO 8601
export function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

export function getISOWeekYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

// Tạo weekId dạng "2026-W47" cho một ngày bất kỳ trong tuần đó
export function getWeekId(date) {
  const year = getISOWeekYear(date);
  const week = getISOWeekNumber(date);
  return `${year}-W${pad2(week)}`;
}

// Tạo cấu trúc tuần rỗng (7 ngày x 2 buổi) bắt đầu từ ngày Thứ Hai `monday`
export function buildEmptyWeek(monday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push({
      date: toDateStr(d),
      weekday: WEEKDAY_LABELS[i],
      sessions: {
        morning: {},
        afternoon: {},
      },
    });
  }
  const weekNumber = getISOWeekNumber(monday);
  const weekYear = getISOWeekYear(monday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    weekNumber,
    year: weekYear,
    startDate: toDateStr(monday),
    endDate: toDateStr(sunday),
    days,
  };
}

export function weekIdToMonday(weekId) {
  // weekId: "YYYY-Www"
  const [yearStr, wStr] = weekId.split("-W");
  const year = Number(yearStr);
  const week = Number(wStr);
  // ISO: ngày 4/1 luôn thuộc tuần 1
  const jan4 = new Date(year, 0, 4);
  const mondayWeek1 = getMonday(jan4);
  const monday = new Date(mondayWeek1);
  monday.setDate(mondayWeek1.getDate() + (week - 1) * 7);
  return monday;
}

export function neighborWeekId(weekId, offsetWeeks) {
  const monday = weekIdToMonday(weekId);
  monday.setDate(monday.getDate() + offsetWeeks * 7);
  return getWeekId(monday);
}

// --- Bộ đếm lượt xem trang công khai (đơn giản, không thu thập thông tin cá nhân) ---

const VIEW_SEEN_KEY = "lctOnlineViewerSeen_v1";

// Ghi nhận 1 lượt xem trang công khai — gọi 1 lần khi trang index.html tải xong.
// - totalViews: tăng mỗi lần trang được mở (kể cả tải lại trang).
// - uniqueVisitors: chỉ tăng ở lần mở đầu tiên trên mỗi trình duyệt (dựa vào một cờ
//   lưu trong localStorage của trình duyệt đó — không thu thập hay định danh ai).
export async function recordPageView() {
  try {
    const isFirstVisit = !localStorage.getItem(VIEW_SEEN_KEY);
    if (isFirstVisit) localStorage.setItem(VIEW_SEEN_KEY, "1");
    const ref = doc(db, "stats", "viewCounter");
    try {
      await updateDoc(ref, {
        totalViews: increment(1),
        ...(isFirstVisit ? { uniqueVisitors: increment(1) } : {}),
      });
    } catch (e) {
      // Chưa có tài liệu (lượt xem đầu tiên của cả hệ thống) — tạo mới.
      await setDoc(ref, { totalViews: 1, uniqueVisitors: 1 }, { merge: true });
    }
  } catch (e) {
    console.warn("Không ghi nhận được lượt xem:", e);
  }
}

// Đọc số liệu bộ đếm lượt xem — dùng ở trang nhập liệu, mục "Thống kê lượt xem".
export async function getPageViewStats() {
  try {
    const snap = await getDoc(doc(db, "stats", "viewCounter"));
    if (!snap.exists()) return { totalViews: 0, uniqueVisitors: 0 };
    const d = snap.data();
    return { totalViews: d.totalViews || 0, uniqueVisitors: d.uniqueVisitors || 0 };
  } catch (e) {
    console.warn("Không đọc được thống kê lượt xem:", e);
    return null;
  }
}
